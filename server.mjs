import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import { fileURLToPath } from 'node:url';
import { calculate } from './public/totals.mjs';

const app = express();
app.disable('x-powered-by');
app.use(express.json({limit:'2mb'}));
app.use(express.static(fileURLToPath(new URL('./public/', import.meta.url))));
app.get('/vendor/jspdf.umd.min.js', (req, res) => {
  res.sendFile(fileURLToPath(new URL('./node_modules/jspdf/dist/jspdf.umd.min.js', import.meta.url)));
});
app.get('/favicon.ico', (req, res) => {
  res.sendFile(fileURLToPath(new URL('./public/brand/icon.png', import.meta.url)));
});

const uri = process.env.MONGODB_URI?.trim();
const client = uri ? new MongoClient(uri, {serverSelectionTimeoutMS:5000}) : null;
const invoices = client?.db(process.env.MONGODB_DB || 'zpruners').collection('invoices');
let index;
app.use('/api', async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!invoices) return res.status(503).json({error:'Set MONGODB_URI in .env and restart to enable storage.'});
  index ??= invoices.createIndex({number:1}, {unique:true, collation:{locale:'en', strength:2}})
    .catch(error => { index = undefined; throw error; });
  await index;
  next();
});

const invalid = message => { throw Object.assign(new Error(message), {status:400}); };
function clean(value) {
  const string = (input, max) => {
    if (typeof input !== 'string' || input.length > max) invalid('One or more text fields are invalid or too long.');
    return input.trim();
  };
  const number = (input, max, min = 0) => {
    if (typeof input !== 'number' || !Number.isFinite(input) || input < min || input > max) invalid('Check line item and adjustment values.');
    return input;
  };
  const date = (input, optional = false) => {
    if (optional && input === '') return '';
    if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) invalid('Enter valid invoice dates.');
    const d = new Date(input);
    if (!Number.isFinite(+d) || d.toISOString().slice(0,10) !== input) invalid('Enter valid invoice dates.');
    return input;
  };
  if (!value || !Array.isArray(value.items) || !value.items.length || value.items.length > 100) invalid('Enter between 1 and 100 line items.');
  const data = {
    number:string(value.number,80), from:string(value.from,2000), to:string(value.to,2000), shipTo:string(value.shipTo,2000),
    date:date(value.date), due:date(value.due,true), payment:string(value.payment,120), po:string(value.po,120),
    currency:string(value.currency,3), notes:string(value.notes,4000), terms:string(value.terms,4000),
    logo:string(value.logo,1400000), discountMode:value.discountMode,
    tax:number(value.tax,100), shipping:number(value.shipping,1e8), paid:number(value.paid,1e8),
    discount:number(value.discount,value.discountMode === 'percent' ? 100 : 1e8),
    items:value.items.map(item => ({
      description:string(item?.description,500), quantity:number(item?.quantity,100000,0.001), rate:number(item?.rate,1000000)
    }))
  };
  if (!data.number || !data.from || !data.to || data.items.some(item => !item.description)) invalid('Complete the invoice number, sender, customer and item descriptions.');
  if (data.due && data.due < data.date) invalid('The due date must be on or after the invoice date.');
  if (!['INR','USD','EUR','GBP','CAD','AUD','AED','SGD','JPY','KWD'].includes(data.currency)) invalid('Select a supported currency.');
  if (!['percent','fixed'].includes(data.discountMode)) invalid('Select a discount type.');
  if (data.logo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(data.logo)) invalid('Upload a PNG, JPEG or WebP logo.');
  return {...data, totals:calculate(data)};
}

app.get('/api/invoices', async (req, res) => {
  const query = req.query.before;
  if (query !== undefined && (typeof query !== 'string' || !ObjectId.isValid(query))) invalid('Invalid history cursor.');
  const search = req.query.q ?? '';
  if (typeof search !== 'string' || search.length > 100) invalid('Enter a search of up to 100 characters.');
  const filter = query ? {_id:{$lt:new ObjectId(query)}} : {};
  if (search.trim()) {
    const literal = search.trim().replace(/[.*+?^$\x7b\x7d()|[\]\\]/g, '\\$&');
    const contains = {$regex:literal, $options:'i'};
    filter.$or = [{number:contains}, {to:contains}];
  }
  const records = await invoices.find(filter, {projection:{number:1,to:1,date:1,currency:1,totals:1}})
    .sort({_id:-1}).limit(31).toArray();
  const more = records.length > 30;
  const rows = records.slice(0,30);
  res.json({rows, next:more ? rows.at(-1)._id : null});
});
app.get('/api/invoices/next-number', async (req, res) => {
  const year = typeof req.query.year === 'string' && /^\d{4}$/.test(req.query.year)
    ? req.query.year
    : String(new Date().getFullYear());
  const prefix = `ZPR-${year}-`;
  const matches = await invoices.find(
    {number:{$regex:`^${prefix}\\d+$`, $options:'i'}},
    {projection:{number:1}}
  ).toArray();
  let max = 0;
  for (const doc of matches) {
    const seq = Number(doc.number.slice(prefix.length));
    if (Number.isSafeInteger(seq) && seq > max) max = seq;
  }
  res.json({number:prefix + String(max + 1).padStart(3, '0')});
});
app.param('id', (req,res,next,id) => {
  if (!ObjectId.isValid(id)) return res.status(400).json({error:'Invalid invoice ID.'});
  req.invoiceId = new ObjectId(id);
  next();
});
app.get('/api/invoices/:id', async (req,res) => {
  const record = await invoices.findOne({_id:req.invoiceId});
  return record ? res.json(record) : res.status(404).json({error:'Invoice not found.'});
});
app.post('/api/invoices', async (req,res) => {
  const data = clean(req.body);
  const now = new Date();
  const record = {...data, createdAt:now, updatedAt:now, version:1};
  const result = await invoices.insertOne(record);
  res.status(201).json({...record, _id:result.insertedId});
});
app.put('/api/invoices/:id', async (req,res) => {
  const data = clean(req.body);
  if (!Number.isSafeInteger(req.body.version) || req.body.version < 1) invalid('Reopen the invoice before updating it.');
  const record = await invoices.findOneAndUpdate({_id:req.invoiceId, version:req.body.version},
    {$set:{...data, updatedAt:new Date()}, $inc:{version:1}}, {returnDocument:'after'});
  return record ? res.json(record) : res.status(409).json({error:'This invoice changed since you opened it. Reopen it from History.'});
});
app.delete('/api/invoices/:id', async (req,res) => {
  const result = await invoices.deleteOne({_id:req.invoiceId});
  return result.deletedCount ? res.json({deleted:true}) : res.status(404).json({error:'Invoice not found.'});
});
app.use('/api', (req, res) => res.status(404).json({error:'API endpoint not found.'}));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.code === 11000) return res.status(409).json({error:'This invoice number already exists.'});
  if (error.status === 400) return res.status(400).json({error:error.type ? 'Invalid request.' : error.message});
  if (error.status === 413) return res.status(413).json({error:'Invoice is too large.'});
  console.error('Invoice request failed:', error.name);
  res.status(503).json({error:'Storage is unavailable. Check your MongoDB connection and database access.'});
});

const port = Number(process.env.PORT || 3000);
const server = app.listen(port, '127.0.0.1', () => console.log('Zpruners Invoices at http://127.0.0.1:' + server.address().port));
