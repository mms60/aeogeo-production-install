'use strict';
const {stripeID, invoiceSubscription} = require('./billing-objects');
const {invoiceEnd} = require('./billing-sync');
const error = (status, text) => Object.assign(new Error(text), {status});
function billingReviewHandler({db, user, reply, stripe, billingAdmin, billingMode, invoiceForCharge}) {
 return async event => {
  if (!['GET','POST'].includes(event.httpMethod)) return reply(405, {error: 'GET or POST required'});
  let locked = null;
  try {
   const admin = await user(event);
   if (!billingAdmin(admin.email)) throw error(403, 'Billing owner access is required.');
   const mode = billingMode();if (!mode) throw error(503, 'Stripe payment mode is not configured.');
   if (event.httpMethod === 'GET') {
    const [reviews, holds] = await Promise.all([
     db('geo_billing_reviews?billing_mode=eq.' + mode + '&state=eq.open&order=created_at.asc&limit=101'),
     db('geo_billing_holds?billing_mode=eq.' + mode + '&active=eq.true&or=(expires_at.is.null,expires_at.gt.' + encodeURIComponent(new Date().toISOString()) + ')&order=updated_at.desc&limit=100')]);
    return reply(200, {mode, reviews: reviews.slice(0,100), moreReviews: reviews.length > 100, holds});
   }
   let b;try {b = JSON.parse(event.body || '{}');} catch {throw error(400, 'Invalid review request.');}
   if (typeof b.id !== 'string' || !/^refund:ch_[A-Za-z0-9]+$/.test(b.id) || !['keep','revoke'].includes(b.decision) || b.confirm !== (b.decision === 'keep' ? 'KEEP' : 'END')) throw error(400, 'Confirm a valid refund-review decision.');
   const url = 'geo_billing_reviews?id=eq.' + encodeURIComponent(b.id) + '&billing_mode=eq.' + mode;
   let [r] = await db(url);if (!r) throw error(404, 'Refund review not found.');
   const token = require('node:crypto').randomUUID();
   if (!await db('rpc/geo_billing_lock', {method:'POST',body:{p_user:r.user_id,p_token:token}})) throw error(409, 'Billing is being updated. Retry in a moment.');
   locked = {p_user:r.user_id,p_token:token};
   [r] = await db(url);
   if (!r || r.state !== 'open') throw error(409, 'This refund was already reviewed. Refresh the list.');
   const charge = await stripe('charges/' + encodeURIComponent(r.charge_id));
   if (stripeID(charge.customer) !== r.customer_id || charge.amount_refunded !== r.amount_refunded) throw error(409, 'Refund details changed. Refresh billing before reviewing this refund.');
   if (b.decision === 'revoke') {
    if (!r.full_refund || charge.amount <= 0 || charge.amount_refunded < charge.amount) throw error(400, 'This is not a full refund. Access cannot be ended with this action.');
    const refunds = await stripe('refunds?charge=' + encodeURIComponent(charge.id) + '&limit=100');
    const settled = (refunds.data || []).filter(x => x.status === 'succeeded').reduce((n,x) => n + x.amount, 0);
    if (refunds.has_more || settled < charge.amount) throw error(409, 'The full refund has not been verified as settled. Review its status in Stripe first.');
    const invoice = await invoiceForCharge(charge), end = invoiceEnd(invoice);
    if (invoiceSubscription(invoice) !== r.subscription_id || !end || Date.parse(end) !== Date.parse(r.period_end) || Date.parse(end) <= Date.now()) throw error(409, 'This refund is not verified for the current paid period. Review it in Stripe without changing current access here.');
    const [current] = await db('geo_subscriptions?user_id=eq.' + r.user_id + '&select=subscription_id,customer_id,billing_mode');
    if (current?.subscription_id !== r.subscription_id || current.customer_id !== r.customer_id || current.billing_mode !== mode) throw error(409, 'The customer now has a different subscription. Do not change it for this refund.');
    const subscription = await stripe('subscriptions/' + encodeURIComponent(r.subscription_id));
    if (subscription.metadata?.user_id !== r.user_id || stripeID(subscription.customer) !== r.customer_id) throw error(409, 'Subscription ownership could not be verified.');
    if (!['canceled','incomplete_expired'].includes(subscription.status) && !subscription.cancel_at_period_end)
     await stripe('subscriptions/' + encodeURIComponent(subscription.id), {method:'POST',data:{cancel_at_period_end:true}});
   }
   const ok = await db('rpc/geo_refund_review_decide', {method:'POST',body:{p_id:r.id,p_admin:admin.id,p_decision:b.decision,p_expected_amount:r.amount_refunded,p_token:token}});
   if (!ok) throw error(409, 'The review changed. Refresh and check Stripe before retrying.');
   return reply(200, {reviewed:true,decision:b.decision});
  } catch (e) {
   console.error('billing review',e.status || 'internal');
   return reply(e.status || 500, {error:e.status ? e.message : 'The review could not finish. Check the current subscription in Stripe before retrying.'});
  } finally {
   if (locked) try {await db('rpc/geo_billing_unlock', {method:'POST',body:locked});} catch {console.error('Billing review lease release failed.');}
  }
 };
}
module.exports = {billingReviewHandler};
