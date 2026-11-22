'use strict';
// Handle the legacy Acacia and newer invoice/event shapes. These helpers never
// grant access by themselves; the signed webhook and transactional database do.
function stripeID(value) {
 return typeof value === 'string' ? value : value && typeof value.id === 'string' ? value.id : null;
}
function invoiceSubscription(invoice) {
 return stripeID(invoice?.subscription) || stripeID(invoice?.parent?.subscription_details?.subscription);
}
function linePrice(line) {
 return stripeID(line?.price) || stripeID(line?.pricing?.price_details?.price);
}
function isSubscriptionLine(line) {
 return line?.type === 'subscription' || line?.parent?.type === 'subscription_item_details';
}
function paidInvoiceThrough(invoice, plan, mapPrice) {
 if (!invoice || invoice.status !== 'paid' || (invoice.paid !== true && !(invoice.paid === undefined && invoice.amount_remaining === 0))) return null;
 // Never silently compute an entitlement from an incomplete page of lines.
 if (invoice.lines?.has_more) throw new Error('Invoice lines need complete reconciliation before access can be granted.');
 const periods = (invoice.lines?.data || [])
  .filter(line => isSubscriptionLine(line) && mapPrice(linePrice(line))?.plan === plan)
  .map(line => line.period?.end)
  .filter(end => Number.isSafeInteger(end) && end > 0);
 return periods.length ? new Date(Math.max(...periods) * 1000).toISOString() : null;
}
module.exports = {stripeID, invoiceSubscription, linePrice, isSubscriptionLine, paidInvoiceThrough};
