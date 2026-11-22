'use strict';
const crypto = require('node:crypto');
const {stripeID, invoiceSubscription, isSubscriptionLine, paidInvoiceThrough} = require('./billing-objects');
const problem = text => Object.assign(new Error(text), {status: 503});
const iso = n => Number.isSafeInteger(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
function invoiceEnd(invoice) {
 if (!invoice) return null;
 if (invoice.lines?.has_more) throw problem('Invoice lines need complete review before billing can be reconciled.');
 const ends = (invoice.lines?.data || []).filter(isSubscriptionLine).map(l => l.period?.end).filter(n => Number.isSafeInteger(n) && n > 0);
 return ends.length ? iso(Math.max(...ends)) : iso(invoice.period_end);
}
function disputeHold(dispute, subscription, end) {
 const clear = ['won', 'warning_closed'].includes(dispute.status);
 return {id: 'dispute:' + dispute.id, kind: 'dispute', source_id: dispute.id, subscription_id: subscription,
  active: !clear, expires_at: dispute.status === 'lost' ? end : null,
  reason: clear ? 'The bank dispute closed without loss.' : dispute.status === 'lost' ? 'Paid access for the disputed period is unavailable after a lost dispute.' : 'New paid audits are paused while a bank dispute is open.'};
}
function refundReview(charge, sid, end) {
 if (!Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded <= 0) return null;
 return {id: 'refund:' + charge.id, charge_id: charge.id, subscription_id: sid, original_amount: charge.amount,
  amount_refunded: charge.amount_refunded, currency: charge.currency, full_refund: charge.amount > 0 && charge.amount_refunded >= charge.amount, period_end: end};
}
function makeBillingSync({db, stripe, fromPrice, fromLookupKey = () => null, PLANS, UUID, mode}) {
 async function invoiceForCharge(charge) {
  let invoice = charge.invoice;
  if (!invoice && stripeID(charge.payment_intent)) {
   const pi = await stripe('payment_intents/' + encodeURIComponent(stripeID(charge.payment_intent)));
   invoice = pi.invoice;
  }
  return typeof invoice === 'string' ? stripe('invoices/' + encodeURIComponent(invoice)) : invoice || null;
 }
 async function sidForCharge(charge) {
  const inv = await invoiceForCharge(charge);
  if (invoiceSubscription(inv)) return invoiceSubscription(inv);
  const customer = stripeID(charge.customer);
  if (!customer) return null;
  const [s] = await db('geo_subscriptions?customer_id=eq.' + encodeURIComponent(customer) + '&select=subscription_id');
  if (s?.subscription_id) return s.subscription_id;
  const [c] = await db('geo_checkout_sessions?customer_id=eq.' + encodeURIComponent(customer) + '&select=user_id');
  if (c) throw problem('A payment for this account needs invoice reconciliation.');
  return null; // Not a payment belonging to this application's customers.
 }
 async function sync(sid, {eventId = 'reconcile:' + crypto.randomUUID(), source = null} = {}) {
  const initial = await stripe('subscriptions/' + encodeURIComponent(sid));
  const uid = initial.metadata?.user_id, customer = stripeID(initial.customer);
  if (!UUID.test(uid || '') || !customer) return {ignored: true};
  const [prior] = await db('geo_subscriptions?user_id=eq.' + uid + '&select=*');
  const [checkout] = await db('geo_checkout_sessions?user_id=eq.' + uid + '&select=customer_id');
  if (prior?.customer_id !== customer && checkout?.customer_id !== customer) return {ignored: true};
  const token = crypto.randomUUID();
  if (!await db('rpc/geo_billing_lock', {method: 'POST', body: {p_user: uid, p_token: token}})) throw problem('Billing is being updated. Please retry in a moment.');
  try {
   // Serialize live reads and database writes per user, and fence expired workers.
   const sub = await stripe('subscriptions/' + encodeURIComponent(sid) + '?expand[]=latest_invoice.charge');
   if (sub.metadata?.user_id !== uid || stripeID(sub.customer) !== customer || sub.livemode !== (mode() === 'live')) throw problem('Subscription ownership or payment mode could not be verified.');
   if (sub.items?.has_more || sub.items?.data?.length !== 1) throw problem('Subscription items require manual billing review.');
   const p = sub.items.data[0].price, mapped = fromPrice(stripeID(p)) || fromLookupKey(p.lookup_key);
   if (!mapped) throw problem('The subscription price is not configured for this application.');
   const expected = mapped.interval === 'year' ? PLANS[mapped.plan].annual : PLANS[mapped.plan].monthly;
   if (p.currency !== 'usd' || p.unit_amount !== expected || p.recurring?.interval !== mapped.interval || p.recurring?.interval_count !== 1) throw problem('Subscription amount or interval does not match the configured plan.');
   const [existing] = await db('geo_subscriptions?user_id=eq.' + uid + '&select=*');
   let latest = sub.latest_invoice;
   if (typeof latest === 'string') latest = await stripe('invoices/' + encodeURIComponent(latest) + '?expand[]=charge');
   const mapPrice = id => id === stripeID(p) ? mapped : fromPrice(id);
   const through = paidInvoiceThrough(latest, mapped.plan, mapPrice);
   let paidInvoice = through ? latest : null;
   if (!paidInvoice && existing?.last_paid_invoice_id && existing.subscription_id === sid)
    paidInvoice = await stripe('invoices/' + encodeURIComponent(existing.last_paid_invoice_id) + '?expand[]=charge');
   const holds = [], reviews = [], disputes = new Set(), charges = new Set();
   const known = await db('geo_billing_holds?user_id=eq.' + uid + '&billing_mode=eq.' + mode() + '&kind=eq.dispute&active=eq.true&or=(expires_at.is.null,expires_at.gt.' + encodeURIComponent(new Date().toISOString()) + ')&select=source_id');
   for (const h of known) disputes.add(h.source_id);
   if (source?.kind === 'dispute') disputes.add(source.id);
   if (source?.kind === 'charge') charges.add(source.id);
   if (stripeID(paidInvoice?.charge)) charges.add(stripeID(paidInvoice.charge));
   // Bound server work; never silently ignore a large unresolved hold backlog.
   if (disputes.size + charges.size > 12) throw problem('Billing has multiple open cases and needs owner review.');
   const chargeCache = new Map();
   async function chargeInfo(id) {
    if (chargeCache.has(id)) return chargeCache.get(id);
    const charge = await stripe('charges/' + encodeURIComponent(id));
    if (stripeID(charge.customer) !== customer) throw problem('Payment customer ownership mismatch.');
    const invoice = await invoiceForCharge(charge);
    const info = {charge, invoice, sid: invoiceSubscription(invoice) || sid, end: invoiceEnd(invoice)};
    chargeCache.set(id, info);
    const review = refundReview(charge, info.sid, info.end);
    if (review) reviews.push(review); // Manual policy: NO access or renewal changes.
    return info;
   }
   for (const id of charges) {
    const info = await chargeInfo(id);
    if (info.charge.disputed) {
     const list = await stripe('disputes?charge=' + encodeURIComponent(id) + '&limit=100');
     if (list.has_more) throw problem('Dispute history needs complete owner review.');
     for (const d of list.data || []) disputes.add(d.id);
    }
   }
   let stopRenewal = false;
   for (const id of disputes) {
    const d = await stripe('disputes/' + encodeURIComponent(id));
    const chargeID = stripeID(d.charge);
    if (!chargeID) throw problem('Disputed payment could not be identified.');
    const info = await chargeInfo(chargeID);
    const hold = disputeHold(d, info.sid, info.end);
    holds.push(hold);
    if (hold.active && (!hold.expires_at || Date.parse(hold.expires_at) > Date.now())) stopRenewal = true;
   }
   if (stopRenewal) {
    // The owner approved stopping renewal on disputes, NOT on refunds.
    // Setting this boolean is naturally idempotent and does not issue a refund.
    const targets = new Set([sid]);
    if (existing?.subscription_id) targets.add(existing.subscription_id);
    for (const target of targets) {
     const s = target === sid ? sub : await stripe('subscriptions/' + encodeURIComponent(target));
     if (s.metadata?.user_id !== uid || stripeID(s.customer) !== customer) throw problem('Renewal ownership mismatch.');
     if (!['canceled', 'incomplete_expired'].includes(s.status) && !s.cancel_at_period_end)
      {await stripe('subscriptions/' + encodeURIComponent(target), {method: 'POST', data: {cancel_at_period_end: true}});if(target===sid)sub.cancel_at_period_end=true;}
    }
   }
   const selectedPlan = through ? mapped.plan : existing?.plan || mapped.plan;
   await db('rpc/geo_billing_apply', {method: 'POST', body: {p_event: eventId, p_user: uid, p_token: token,
    p_customer: customer, p_subscription: sid, p_plan: selectedPlan, p_status: sub.status, p_anchor: iso(sub.start_date),
    p_paid_through: through, p_mode: mode(), p_paid_invoice: through ? latest.id : null, p_holds: holds, p_reviews: reviews, p_cancel_at_period_end: !!sub.cancel_at_period_end}});
   return {userId: uid, holds: holds.filter(h => h.active).length, refundReviews: reviews.length};
  } finally {
   try {await db('rpc/geo_billing_unlock', {method: 'POST', body: {p_user: uid, p_token: token}});} catch {console.error('Billing lease release failed; the short lease will expire.');}
  }
 }
 async function event(e) {
  const object = e.data?.object;
  if (!object) throw problem('Invalid billing event.');
  let sid, source = null;
  if (e.type.startsWith('customer.subscription.')) sid = object.id;
  else if (e.type === 'charge.refunded') {sid = await sidForCharge(object);source = {kind: 'charge', id: object.id};}
  else if (e.type.startsWith('charge.dispute.')) {
   const d = await stripe('disputes/' + encodeURIComponent(object.id));
   const charge = await stripe('charges/' + encodeURIComponent(stripeID(d.charge)));
   sid = await sidForCharge(charge);source = {kind: 'dispute', id: d.id};
  } else if (e.type === 'checkout.session.expired') return {ignored: true}; // Recovered by the persisted checkout-session state machine.
  else sid = invoiceSubscription(object);
  return sid ? sync(sid, {eventId: e.id, source}) : {ignored: true};
 }
 async function account(uid) {
  const [s] = await db('geo_subscriptions?user_id=eq.' + uid + '&select=subscription_id,billing_mode');
  if (s?.subscription_id) {
   if (s.billing_mode !== mode()) return {modeMismatch: true};
   return sync(s.subscription_id);
  }
  const [c] = await db('geo_checkout_sessions?user_id=eq.' + uid + '&select=stripe_id,customer_id,livemode');
  if (!c?.stripe_id || c.livemode !== (mode() === 'live')) return {ignored: true};
  const session = await stripe('checkout/sessions/' + encodeURIComponent(c.stripe_id));
  if (session.client_reference_id !== uid || stripeID(session.customer) !== c.customer_id) throw problem('Checkout ownership mismatch.');
  return session.status === 'complete' && stripeID(session.subscription) ? sync(stripeID(session.subscription)) : {ignored: true};
 }
 return {sync, event, account, invoiceForCharge};
}
function configuredBillingSync() {
 const {db, UUID} = require('./db'), {stripe} = require('./stripe'), {fromPrice, fromLookupKey, PLANS, billingMode} = require('./plans');
 return makeBillingSync({db, stripe, fromPrice, fromLookupKey, PLANS, UUID, mode: billingMode});
}
module.exports = {makeBillingSync, configuredBillingSync, disputeHold, refundReview, invoiceEnd};
