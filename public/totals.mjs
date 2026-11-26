export function calculate(invoice) {
  const digits = new Intl.NumberFormat('en', {style:'currency', currency:invoice.currency}).resolvedOptions().maximumFractionDigits;
  const scale = 10 ** digits;
  const round = value => Math.round(value + 1e-8);
  const lines = invoice.items.map(item => round(item.quantity * item.rate * scale));
  const subtotal = lines.reduce((sum, value) => sum + value, 0);
  const discount = Math.min(subtotal, invoice.discountMode === 'percent'
    ? round(subtotal * invoice.discount / 100) : round(invoice.discount * scale));
  const tax = round((subtotal - discount) * invoice.tax / 100);
  const shipping = round(invoice.shipping * scale);
  const total = subtotal - discount + tax + shipping;
  const paid = round(invoice.paid * scale);
  return {lines, subtotal, discount, tax, shipping, total, paid, balance:Math.max(0,total-paid),
    credit:Math.max(0,paid-total), scale};
}
