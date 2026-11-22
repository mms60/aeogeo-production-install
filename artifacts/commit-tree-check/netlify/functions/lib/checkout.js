'use strict';
const crypto = require('node:crypto');
const {stripeID} = require('./billing-objects');
const {resolveSellablePrice} = require('./price-resolution');
const {priceLookupKey} = require('./plans');
const {checkoutDiagnostic} = require('./checkout-diagnostics');
const http = (status, message) => Object.assign(new Error(message), {status});
const liveMode = () => require('./stripe-credential').stripeKeyMode() === 'live';

function checkoutHandler({db, user, reply, UUID, PLANS, priceID, billingReady, stripe, origin}) {
 async function rpc(name, body) {return db('rpc/geo_checkout_' + name, {method: 'POST', body});}
 async function price(plan, interval) {
  // A configured price can be stale, inactive, or attached to an archived
  // product. In that case the plan's lookup key resolves the price on the
  // current product, and checkout fails rather than selling a dead product.
  return resolveSellablePrice({stripe, plan, interval, PLANS, priceID, priceLookupKey, live: liveMode});
 }
 return async event => {
  if (event.httpMethod !== 'POST') return reply(405, {error: 'POST required'});
  let stage = 'authenticate';
  try {
   const u = await user(event);
   stage = 'parse_request';
   let body;try {body = JSON.parse(event.body || '{}');} catch {throw http(400, 'Invalid checkout request.');}
   const {plan, interval, requestId} = body;
   if (!PLANS[plan] || !['month', 'year'].includes(interval)) throw http(400, 'Choose a valid plan and billing interval.');
   if (!UUID.test(requestId || '')) throw http(400, 'A request identifier is required.');
   stage = 'check_readiness';
   const blocked = billingReady(plan, u.email);if (blocked) throw http(503, blocked);
   stage = 'read_plan_catalog';
   const catalog = await db('geo_plan_catalog?id=eq.' + plan + '&select=approved');
   if (!catalog[0]?.approved && !require('./plans').sandboxCheckout(plan,u.email)) throw http(503, 'This plan has not been approved for checkout.');
   stage = 'read_existing_subscription';
   const [existing] = await db('geo_subscriptions?user_id=eq.' + u.id + '&select=subscription_id,paid_through');
   if (existing?.subscription_id && Date.parse(existing.paid_through || '') > Date.now())
    throw http(409, 'Your existing subscription still has paid access. Use Manage billing instead.');
   stage = 'validate_price';
   await price(plan, interval);
   // Changing plan/interval first expires the old Stripe session. Two live
   // payable URLs are never deliberately issued for the same account.
   for (let pass = 0; pass < 2; pass++) {
    const token = crypto.randomUUID();
    stage = 'claim_checkout';
    const claim = await rpc('claim', {p_user: u.id, p_lock: token, p_plan: plan, p_interval: interval, p_live: liveMode()});
    if (!claim.allowed) throw http(409, claim.reason === 'mode_changed'
     ? 'Test and live billing records must be reviewed before changing payment mode.'
     : 'Another checkout request is in progress. Wait a moment and try again.');
    const args = {p_user: u.id, p_lock: token};
    try {
     let customer = claim.customer_id;
     if (!customer) {
      stage = 'create_customer';
      const c = await stripe('customers', {method: 'POST', data: {email: u.email, 'metadata[user_id]': u.id}, idempotency: 'geo-customer-v1-' + (liveMode() ? 'live-' : 'test-') + u.id});
      customer = c.id;
      stage = 'record_customer';
      if (!await rpc('customer', {...args, p_customer: customer})) throw http(409, 'Checkout ownership changed. Please try again.');
     }
     stage = 'list_subscriptions';
     const subs = await stripe('subscriptions?customer=' + encodeURIComponent(customer) + '&status=all&limit=100');
     if (subs.has_more || (subs.data || []).some(s => !['canceled', 'incomplete_expired'].includes(s.status)))
      throw http(409, 'You already have a subscription or payment in progress. Use Manage billing instead.');
     let session;
     if (claim.stripe_id) {stage = 'load_existing_session';session = await stripe('checkout/sessions/' + encodeURIComponent(claim.stripe_id));}
     else {
      // Recover the same attempt after timeouts, rather than relying on the
      // browser's request UUID. Stripe idempotency is per persisted attempt.
      stage = 'validate_claim_plan';
      const oldBlocked = billingReady(claim.plan, u.email);if (oldBlocked) throw http(503, oldBlocked);
      stage = 'validate_claim_price';
      const selectedPrice = await price(claim.plan, claim.interval);
      stage = 'resolve_return_origin';
      const base = origin();
      const data = {mode: 'subscription', customer, 'payment_method_types[0]':'card', 'line_items[0][price]': selectedPrice, 'line_items[0][quantity]': 1,
       client_reference_id: u.id, 'subscription_data[metadata][user_id]': u.id, 'subscription_data[metadata][plan]': claim.plan,
       'metadata[user_id]': u.id, 'metadata[plan]': claim.plan, success_url: base + '/account/?checkout=success',
       cancel_url: base + '/geo-audit/#plans', allow_promotion_codes: false};
      stage = 'create_session';
      session = await stripe('checkout/sessions', {method: 'POST', data, idempotency: 'geo-checkout-v2-' + u.id + '-' + claim.attempt_id});
     }
     stage = 'validate_session';
     if (session.client_reference_id !== u.id || stripeID(session.customer) !== customer || session.livemode !== liveMode())
      throw http(503, 'Checkout ownership or payment mode could not be verified.');
     if (session.status === 'complete') {
      const prior = (subs.data || []).find(s => s.id === stripeID(session.subscription));
      if (prior && ['canceled', 'incomplete_expired'].includes(prior.status)) {
       if (!await rpc('reset', args)) throw http(409, 'Checkout changed. Please try again.');
       continue;
      }
      throw http(409, 'Your checkout completed. Open your account while payment confirmation is processed.');
     }
     if (session.status === 'expired') {
      if (!await rpc('reset', args)) throw http(409, 'Checkout changed. Please try again.');
      continue;
     }
     if (session.status !== 'open') throw http(503, 'The checkout session is not available.');
     const url = new URL(session.url);
     if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.username || url.password) throw http(503, 'Unexpected checkout destination.');
     if (!Number.isSafeInteger(session.expires_at)) throw http(503, 'Checkout expiry could not be verified.');
     stage = 'bind_session';
     if (!await rpc('bind', {...args, p_session: session.id, p_url: url.href, p_expires: new Date(session.expires_at * 1000).toISOString()}))
      throw http(409, 'Checkout ownership changed. Please try again.');
     if (claim.plan !== plan || claim.interval !== interval) {
      stage = 'expire_old_session';
      await stripe('checkout/sessions/' + encodeURIComponent(session.id) + '/expire', {method: 'POST'});
      if (!await rpc('reset', args)) throw http(409, 'Checkout changed. Please try again.');
      continue;
     }
     return reply(200, {url: url.href});
    } finally {
     try {await rpc('release', args);} catch {console.error('Checkout lease release failed; the short lease will expire.');}
    }
   }
   throw http(409, 'The previous checkout was closed. Choose your plan again.');
  } catch (e) {
   const diagnostic = checkoutDiagnostic(e, stage);
   console.error('checkout', e.status || 'internal', JSON.stringify(diagnostic));
   return reply(e.status || 500, {error: e.status ? e.message : 'Checkout could not open. No audit access has been granted. Reference: '+diagnostic.reference+'.', reference: diagnostic.reference});
  }
 };
}
module.exports = {checkoutHandler};
