const imageCache = new Map();

async function loadImage(src) {
  if (!src) return null;
  if (imageCache.has(src)) return imageCache.get(src);
  const loaded = await new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 1;
        canvas.height = img.naturalHeight || 1;
        canvas.getContext('2d').drawImage(img, 0, 0);
        resolve({dataUrl:canvas.toDataURL('image/png'), width:canvas.width, height:canvas.height});
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
  if (loaded) imageCache.set(src, loaded);
  return loaded;
}

export function preloadInvoiceAssets(logo) {
  loadImage('/brand/wordmark.png');
  loadImage('/brand/icon.png');
  if (logo) loadImage(logo);
}

preloadInvoiceAssets();

function formatAmount(value, currency, scale) {
  const num = new Intl.NumberFormat('en-US', {
    minimumFractionDigits:scale === 1 ? 0 : scale === 1000 ? 3 : 2,
    maximumFractionDigits:scale === 1 ? 0 : scale === 1000 ? 3 : 2
  }).format(value / scale);
  return `${currency} ${num}`;
}

function formatRate(value, currency) {
  const num = new Intl.NumberFormat('en-US', {maximumFractionDigits:12}).format(value);
  return `${currency} ${num}`;
}

export function buildInvoicePdf(invoice, totals) {
  const JsPDF = window.jspdf?.jsPDF;
  if (!JsPDF) throw new Error('PDF generator is still loading. Try again.');

  const doc = new JsPDF({unit:'pt', format:'a4'});
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;

  const wordmark = imageCache.get('/brand/wordmark.png') || null;
  const watermark = imageCache.get('/brand/icon.png') || null;
  const extraLogo = invoice.logo ? (imageCache.get(invoice.logo) || null) : null;

  const drawWatermark = () => {
    if (!watermark || !doc.GState) return;
    const size = Math.min(contentWidth * 0.72, 360);
    doc.saveGraphicsState();
    doc.setGState(new doc.GState({opacity:0.04}));
    doc.addImage(watermark.dataUrl, 'PNG', (pageWidth - size) / 2, (pageHeight - size) / 2, size, size);
    doc.restoreGraphicsState();
  };

  drawWatermark();
  let y = margin;

  // Header
  let logoX = margin;
  let headerBottom = y + 36;
  if (wordmark) {
    const h = 34;
    const w = (wordmark.width / wordmark.height) * h;
    doc.addImage(wordmark.dataUrl, 'PNG', logoX, y, w, h);
    logoX += w + 12;
  }
  if (extraLogo) {
    const h = 34;
    const w = Math.min((extraLogo.width / extraLogo.height) * h, 110);
    doc.addImage(extraLogo.dataUrl, 'PNG', logoX, y, w, h);
  }

  doc.setTextColor(32, 35, 24);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text('Invoice', pageWidth - margin, y + 18, {align:'right'});
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(88, 96, 74);
  doc.text('#' + invoice.number, pageWidth - margin, y + 34, {align:'right'});
  y = headerBottom + 18;

  const ensureSpace = needed => {
    if (y + needed <= pageHeight - margin) return;
    doc.addPage();
    drawWatermark();
    y = margin;
  };

  // Parties row
  const parties = [['From', invoice.from], ['Bill to', invoice.to], ...(invoice.shipTo ? [['Ship to', invoice.shipTo]] : [])];
  const colWidth = (contentWidth - (parties.length - 1) * 16) / parties.length;
  let maxPartyY = y;
  parties.forEach(([label, text], index) => {
    const x = margin + index * (colWidth + 16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(32, 35, 24);
    doc.text(label, x, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(55, 62, 46);
    const lines = doc.splitTextToSize(text, colWidth);
    doc.text(lines, x, y + 14);
    maxPartyY = Math.max(maxPartyY, y + 14 + lines.length * 12);
  });
  y = maxPartyY + 14;

  // Meta row
  const metas = [
    ['Invoice date', invoice.date],
    ...(invoice.due ? [['Due date', invoice.due]] : []),
    ...(invoice.payment ? [['Payment terms', invoice.payment]] : []),
    ...(invoice.po ? [['Purchase order', invoice.po]] : [])
  ];
  const metaColWidth = contentWidth / Math.min(metas.length, 4);
  metas.forEach(([label, val], index) => {
    const x = margin + index * metaColWidth;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(32, 35, 24);
    doc.text(label, x, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(55, 62, 46);
    doc.text(doc.splitTextToSize(val, metaColWidth - 8), x, y + 13);
  });
  y += 38;

  // Table header
  const drawTableHeader = () => {
    doc.setFillColor(48, 55, 36);
    doc.rect(margin, y, contentWidth, 24, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(255, 255, 255);
    doc.text('Description', margin + 8, y + 15);
    doc.text('Qty', margin + contentWidth * 0.56, y + 15, {align:'right'});
    doc.text('Rate', margin + contentWidth * 0.77, y + 15, {align:'right'});
    doc.text('Amount', pageWidth - margin - 8, y + 15, {align:'right'});
    y += 24;
  };
  drawTableHeader();

  // Table rows
  const descWidth = contentWidth * 0.48;
  invoice.items.forEach((item, index) => {
    const descLines = doc.splitTextToSize(item.description, descWidth);
    const rowHeight = Math.max(24, descLines.length * 13 + 10);
    if (y + rowHeight > pageHeight - margin) {
      doc.addPage();
      drawWatermark();
      y = margin;
      drawTableHeader();
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(32, 35, 24);
    doc.text(descLines, margin + 8, y + 15);
    doc.text(String(item.quantity), margin + contentWidth * 0.56, y + 15, {align:'right'});
    doc.text(formatRate(item.rate, invoice.currency), margin + contentWidth * 0.77, y + 15, {align:'right'});
    doc.text(formatAmount(totals.lines[index], invoice.currency, totals.scale), pageWidth - margin - 8, y + 15, {align:'right'});
    y += rowHeight;
    doc.setDrawColor(220, 226, 210);
    doc.line(margin, y, pageWidth - margin, y);
  });
  y += 18;

  // Totals
  const summaryRows = [
    ['Subtotal', 'subtotal'],
    ...(totals.discount ? [['Discount', 'discount']] : []),
    ...(totals.tax ? [['Tax', 'tax']] : []),
    ...(totals.shipping ? [['Shipping', 'shipping']] : []),
    ['Total', 'total'],
    ...(totals.paid ? [['Amount paid', 'paid']] : []),
    ['Balance due', 'balance'],
    ...(totals.credit ? [['Overpayment', 'credit']] : [])
  ];
  ensureSpace(summaryRows.length * 22 + 12);
  const totalsX = pageWidth - margin - 210;
  for (const [label, key] of summaryRows) {
    const isBalance = key === 'balance';
    const isTotal = key === 'total';
    if (isBalance) {
      doc.setFillColor(240, 247, 219);
      doc.rect(totalsX - 8, y - 12, 218, 22, 'F');
    }
    doc.setFont('helvetica', isBalance || isTotal ? 'bold' : 'normal');
    doc.setFontSize(10);
    doc.setTextColor(isBalance ? 57 : 32, isBalance ? 76 : 35, isBalance ? 6 : 24);
    doc.text(label, totalsX, y + 2);
    const val = formatAmount(totals[key] * (key === 'discount' ? -1 : 1), invoice.currency, totals.scale);
    doc.text(val, pageWidth - margin - 8, y + 2, {align:'right'});
    y += 22;
  }

  // Notes & Terms
  for (const [label, text] of [['Notes', invoice.notes], ['Terms', invoice.terms]]) {
    if (!text) continue;
    const lines = doc.splitTextToSize(text, contentWidth);
    ensureSpace(lines.length * 13 + 26);
    y += 8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(32, 35, 24);
    doc.text(label, margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(55, 62, 46);
    doc.text(lines, margin, y + 14);
    y += 14 + lines.length * 13;
  }

  const safeName = (invoice.number || 'invoice').replace(/[^a-zA-Z0-9._-]+/g, '-');
  return new File([doc.output('blob')], `${safeName}.pdf`, {type:'application/pdf'});
}

export async function createInvoicePdf(invoice, totals) {
  await Promise.all([
    loadImage('/brand/wordmark.png'),
    loadImage('/brand/icon.png'),
    invoice.logo ? loadImage(invoice.logo) : Promise.resolve(null)
  ]);
  return buildInvoicePdf(invoice, totals);
}
