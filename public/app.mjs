import { calculate } from './totals.mjs';

const $ = id => document.getElementById(id);
const form = $('invoice');
const field = name => form.elements.namedItem(name);
const textFields = ['number','from','to','shipTo','date','due','payment','po','currency','notes','terms','discountMode'];
const numericFields = ['tax','discount','shipping','paid'];
let logo = '';
let current;
let dirty = false;
let busy = false;
let historyRequest = 0;
let nextPage;
let searchTimer;
let editorReady = false;

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function status(message, error = false, id = 'status') {
  $(id).textContent = message;
  $(id).classList.toggle('error', error);
}

function money(value, currency, scale) {
  return new Intl.NumberFormat(undefined, {style:'currency',currency}).format(value / scale);
}

function data() {
  const result = Object.fromEntries(textFields.map(name => [name, field(name).value.trim()]));
  for (const name of numericFields) result[name] = Number(field(name).value);
  result.logo = logo;
  result.items = [...$('items').rows].map(row => ({
    description:row.querySelector('.description').value.trim(),
    quantity:Number(row.querySelector('.quantity').value),
    rate:Number(row.querySelector('.rate').value)
  }));
  return result;
}

function totalsList(target, invoice, totals, compact = false) {
  target.replaceChildren();
  const lines = [
    ['Subtotal','subtotal'], ['Discount','discount'], ['Tax','tax'], ['Shipping','shipping'],
    ['Total','total'], ['Amount paid','paid'], ['Balance due','balance'], ['Overpayment','credit']
  ];
  for (const [label, key] of lines) {
    if (!totals[key] && (key === 'credit' || (compact && !['subtotal','total','balance'].includes(key)))) continue;
    const row = element('div', undefined, 'total-row ' + key);
    row.append(element('dt', label), element('dd', money(totals[key] * (key === 'discount' ? -1 : 1), invoice.currency, totals.scale)));
    target.append(row);
  }
}

function refresh() {
  field('discount').max = field('discountMode').value === 'percent' ? 100 : 100000000;
  field('due').min = field('date').value;
  const invoice = data();
  const totals = calculate(invoice);
  [...$('items').rows].forEach((row, index) => {
    row.querySelector('.amount').textContent = money(totals.lines[index], invoice.currency, totals.scale);
    row.querySelector('.remove').disabled = invoice.items.length === 1;
  });
  $('add').disabled = invoice.items.length >= 100;
  totalsList($('summary-totals'), invoice, totals);
}

function addItem(item = {description:'', quantity:1, rate:0}, focus = false) {
  const row = $('item-template').content.firstElementChild.cloneNode(true);
  for (const name of ['description','quantity','rate']) row.querySelector('.' + name).value = item[name];
  row.querySelector('.remove').addEventListener('click', () => {
    row.remove();
    changed();
  });
  $('items').append(row);
  if (focus) row.querySelector('.description').focus();
}

function changed() {
  dirty = true;
  status('');
  refresh();
}

function setLogo(value) {
  logo = value;
  $('logo-image').hidden = !value;
  $('remove-logo').hidden = !value;
  if (value) $('logo-image').src = value;
  else $('logo-image').removeAttribute('src');
}

function localDate() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth()+1).padStart(2,'0'), String(now.getDate()).padStart(2,'0')].join('-');
}

function editorTitle() {
  $('page-title').textContent = current ? 'Edit invoice' : 'Create invoice';
  $('save').textContent = current ? 'Save changes' : 'Save invoice';
  $('delete').hidden = !current;
}

function openEditor(record) {
  editorReady = true;
  form.reset();
  $('items').replaceChildren();
  $('logo-file').value = '';
  current = record ? {id:record._id, version:record.version} : null;
  if (record) {
    for (const name of [...textFields, ...numericFields]) field(name).value = record[name];
    record.items.forEach(item => addItem(item));
  } else {
    const today = localDate();
    const year = today.slice(0, 4);
    const fallback = `ZPR-${year}-001`;
    field('number').value = fallback;
    field('from').value = 'Zpruners';
    field('date').value = today;
    addItem();
    request('/next-number?year=' + encodeURIComponent(year))
      .then(({number}) => {
        if (!current && !dirty && field('number').value === fallback) field('number').value = number;
      })
      .catch(() => {});
  }
  setLogo(record?.logo || '');
  dirty = false;
  status('');
  showEditor();
  refresh();
}

function showEditor() {
  clearTimeout(searchTimer);
  historyRequest++;
  $('editor').hidden = false;
  $('history').hidden = true;
  $('editor-nav').hidden = true;
  $('history-nav').removeAttribute('aria-current');
  editorTitle();
}

async function request(path, options) {
  const result = await fetch('/api/invoices' + path, options);
  const text = await result.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = null; }
  if (!result.ok) throw new Error(payload?.error || `Request failed (${result.status}).`);
  if (!payload) throw new Error('Invalid server response.');
  return payload;
}

function allowReplace() {
  return !busy && (!dirty || confirm('Discard unsaved changes?'));
}

function validInvoice() {
  if (!form.reportValidity()) return false;
  const invoice = data();
  if (!invoice.from || !invoice.to || !invoice.number || invoice.items.some(item => !item.description)) {
    status('Complete the invoice number, sender, customer and item descriptions.', true);
    return false;
  }
  return true;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !validInvoice()) return;
  busy = true;
  $('save').disabled = true;
  status('Saving invoice…');
  const invoice = data();
  try {
    const saved = await request(current ? '/' + current.id : '', {
      method:current ? 'PUT' : 'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...invoice, version:current?.version})
    });
    current = {id:saved._id, version:saved.version};
    dirty = JSON.stringify(invoice) !== JSON.stringify(data());
    if (!$('editor').hidden) editorTitle();
    status(dirty ? 'Saved. You have newer unsaved changes.' : 'Saved to MongoDB.');
  } catch (error) {
    status(error.message, true);
  } finally {
    busy = false;
    $('save').disabled = false;
  }
});

form.addEventListener('input', event => {
  if (event.target !== $('logo-file')) changed();
});
field('currency').addEventListener('input', changed);
$('add').addEventListener('click', () => { addItem(undefined,true); changed(); });
$('remove-logo').addEventListener('click', () => { $('logo-file').value = ''; setLogo(''); changed(); });
$('logo-file').addEventListener('change', async () => {
  const file = $('logo-file').files[0];
  if (!file) return;
  if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 1024 * 1024) {
    $('logo-file').value = '';
    status('Choose a PNG, JPEG or WebP image up to 1 MB.', true);
    return;
  }
  const result = await new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
  if ($('logo-file').files[0] !== file) return;
  if (!result) return status('Could not read the logo file.', true);
  setLogo(result);
  changed();
});

$('editor-nav').addEventListener('click', showEditor);
function showHistory() {
  $('editor').hidden = true;
  $('history').hidden = false;
  $('editor-nav').hidden = !editorReady;
  $('history-nav').setAttribute('aria-current','page');
  $('page-title').textContent = 'Invoices';
  searchHistory();
}
$('history-nav').addEventListener('click', showHistory);
$('home-nav').addEventListener('click', event => {
  event.preventDefault();
  showHistory();
});
$('history-list').addEventListener('click', event => {
  if (event.target.closest('[data-create]') && allowReplace()) openEditor();
});
$('search-form').addEventListener('submit', event => {
  event.preventDefault();
  searchHistory();
});
$('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  historyRequest++;
  resetHistory();
  status('Searching invoices…', false, 'history-status');
  searchTimer = setTimeout(searchHistory, 250);
});
$('more').addEventListener('click', () => loadHistory(nextPage));

function resetHistory() {
  $('history-list').replaceChildren($('create-row').content.cloneNode(true));
  $('more').hidden = true;
}

function searchHistory() {
  clearTimeout(searchTimer);
  resetHistory();
  loadHistory();
}

function actionButton(labelText, iconSvg, ariaLabel, className) {
  const btn = element('button', undefined, className);
  btn.type = 'button';
  btn.title = labelText;
  btn.setAttribute('aria-label', ariaLabel);
  btn.innerHTML = iconSvg;
  btn.append(element('span', labelText, 'btn-label'));
  return btn;
}

const ICONS = {
  open: '<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  share: '<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
  del: '<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
};

function confirmDelete(invoiceNumber) {
  return new Promise(resolve => {
    const dialog = $('confirm-dialog');
    $('confirm-message').textContent = `Are you sure you want to delete invoice ${invoiceNumber}? This cannot be undone.`;
    const cleanup = result => {
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onClose);
      $('confirm-cancel').removeEventListener('click', onCancel);
      $('confirm-ok').removeEventListener('click', onOk);
      resolve(result);
    };
    const onOk = () => { dialog.close(); cleanup(true); };
    const onCancel = event => { event.preventDefault(); dialog.close(); cleanup(false); };
    const onClose = () => cleanup(false);
    $('confirm-ok').addEventListener('click', onOk);
    $('confirm-cancel').addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', onClose);
    dialog.showModal();
    $('confirm-cancel').focus();
  });
}

async function loadHistory(cursor) {
  const token = ++historyRequest;
  $('more').hidden = true;
  status('Loading saved invoices…', false, 'history-status');
  try {
    const search = $('search').value.trim();
    const params = new URLSearchParams({q:search});
    if (cursor) params.set('before',cursor);
    const {rows,next} = await request('?' + params);
    if (token !== historyRequest) return;
    nextPage = next;
    $('more').hidden = !next;
    status(rows.length ? '' : search ? 'No invoices matched your search.' : 'No saved invoices yet.', false, 'history-status');
    for (const record of rows) {
      const row = element('tr');
      const action = row.insertCell();
      const actions = element('div', undefined, 'history-actions');
      const open = actionButton('Open', ICONS.open, 'Open invoice ' + record.number);
      const share = actionButton('Share', ICONS.share, 'Share invoice ' + record.number);
      const del = actionButton('Delete', ICONS.del, 'Delete invoice ' + record.number, 'danger');
      for (const value of [record.number, record.to.split('\n')[0], record.date,
        money(record.totals.total,record.currency,record.totals.scale)]) row.insertCell().textContent = value;
      open.addEventListener('click', async () => {
        if (!allowReplace()) return;
        const opening = ++historyRequest;
        status('Opening invoice…', false, 'history-status');
        try {
          const invoice = await request('/' + record._id);
          if (opening === historyRequest) openEditor(invoice);
        } catch (error) {
          if (opening === historyRequest) status(error.message,true,'history-status');
        }
      });
      share.addEventListener('click', () => shareInvoice({
        id: record._id,
        number: record.number,
        to: record.to,
        date: record.date,
        totalText: money(record.totals.total, record.currency, record.totals.scale),
        statusId: 'history-status',
        button: share
      }));
      del.addEventListener('click', async () => {
        if (busy || !(await confirmDelete(record.number))) return;
        del.disabled = true;
        status('Deleting invoice…', false, 'history-status');
        try {
          await request('/' + record._id, {method:'DELETE'});
          if (current?.id === record._id) {
            current = null;
            dirty = false;
            editorReady = false;
            $('editor-nav').hidden = true;
          }
          row.remove();
          status(`Deleted invoice ${record.number}.`, false, 'history-status');
        } catch (error) {
          del.disabled = false;
          status(error.message, true, 'history-status');
        }
      });
      actions.append(open, share, del);
      action.append(actions);
      $('history-list').append(row);
    }
  } catch (error) {
    if (token !== historyRequest) return;
    status(error.message,true,'history-status');
    $('more').hidden = !cursor;
  }
}

function printField(title, value) {
  const field = element('p',undefined,'print-field');
  field.append(element('strong',title), document.createTextNode(value));
  return field;
}

$('preview').addEventListener('click', () => {
  if (!validInvoice()) return;
  const invoice = data();
  const totals = calculate(invoice);
  const target = $('print-invoice');
  const header = element('div',undefined,'print-head');
  const brand = element('div');
  const wordmark = element('img');
  wordmark.src = '/brand/wordmark.png';
  wordmark.alt = 'Zpruners';
  brand.append(wordmark);
  if (logo) {
    const image = element('img');
    image.src = logo;
    image.alt = 'Business logo';
    brand.append(image);
  }
  const heading = element('div');
  heading.append(element('h2','Invoice'), element('p', '#' + invoice.number));
  header.append(brand,heading);
  const layout = [
    [['From','from'], ['Bill to','to'], ['Ship to','shipTo']],
    [['Invoice date','date'], ['Due date','due'], ['Payment terms','payment'], ['Purchase order','po']]
  ];
  target.replaceChildren(header);
  for (const group of layout) {
    const grid = element('div',undefined,'print-grid');
    for (const [label,key] of group) if (invoice[key]) grid.append(printField(label,invoice[key]));
    target.append(grid);
  }
  const table = element('table',undefined,'print-table');
  const labels = table.createTHead().insertRow();
  for (const title of ['Description','Qty','Rate','Amount']) {
    const label = element('th',title);
    label.scope = 'col';
    labels.append(label);
  }
  const body = table.createTBody();
  invoice.items.forEach((item,index) => {
    const row = body.insertRow();
    const rate = new Intl.NumberFormat(undefined,{style:'currency', currency:invoice.currency, maximumFractionDigits:12}).format(item.rate);
    for (const cell of [item.description,item.quantity,rate,money(totals.lines[index],invoice.currency,totals.scale)])
      row.insertCell().textContent = cell;
  });
  const list = element('dl',undefined,'print-totals');
  totalsList(list,invoice,totals,true);
  target.append(table,list);
  if (invoice.notes) target.append(printField('Notes',invoice.notes));
  if (invoice.terms) target.append(printField('Terms',invoice.terms));
  $('preview-dialog').showModal();
});
async function shareInvoice({id, number, to, date, totalText, statusId, button}) {
  const url = id ? new URL('?invoice=' + encodeURIComponent(id), location.origin).href : '';
  const customer = to ? to.split('\n')[0] : '';
  const summary = ['Invoice #' + number, customer && 'Customer: ' + customer, date && 'Date: ' + date, totalText && 'Total: ' + totalText].filter(Boolean).join('\n');
  try {
    if (navigator.share) {
      await navigator.share({title:'Invoice #' + number, text:summary, ...(url ? {url} : {})});
      if (statusId) status('Invoice shared.', false, statusId);
      return;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url || summary);
      if (statusId) status(url ? 'Invoice link copied to clipboard.' : 'Invoice summary copied to clipboard.', false, statusId);
      if (button) {
        const textNode = button.querySelector('.btn-label') || button;
        const label = textNode.textContent;
        textNode.textContent = url ? 'Copied!' : 'Copied';
        setTimeout(() => { if (textNode.textContent.startsWith('Copied')) textNode.textContent = label; }, 1800);
      }
      return;
    }
    if (statusId) status('Sharing is not supported in this browser.', true, statusId);
  } catch (error) {
    if (error?.name === 'AbortError') return;
    if (statusId) status('Could not share invoice.', true, statusId);
  }
}

$('share').addEventListener('click', () => {
  if (!validInvoice()) return;
  const invoice = data();
  const totals = calculate(invoice);
  shareInvoice({
    id: current?.id,
    number: invoice.number,
    to: invoice.to,
    date: invoice.date,
    totalText: money(totals.total, invoice.currency, totals.scale),
    button: $('share')
  });
});
$('delete').addEventListener('click', async () => {
  if (busy || !current) return;
  const num = field('number').value.trim();
  if (!(await confirmDelete(num))) return;
  busy = true;
  $('delete').disabled = true;
  $('save').disabled = true;
  status('Deleting invoice…');
  try {
    await request('/' + current.id, {method:'DELETE'});
    current = null;
    dirty = false;
    editorReady = false;
    showHistory();
  } catch (error) {
    status(error.message, true);
  } finally {
    busy = false;
    $('delete').disabled = false;
    $('save').disabled = false;
  }
});
$('print').addEventListener('click', () => window.print());
window.addEventListener('beforeunload', event => {
  if (dirty) event.preventDefault();
});

const sharedId = new URLSearchParams(location.search).get('invoice');
if (sharedId) {
  request('/' + encodeURIComponent(sharedId))
    .then(invoice => openEditor(invoice))
    .catch(error => {
      showHistory();
      status(error.message, true, 'history-status');
    });
} else {
  showHistory();
}
