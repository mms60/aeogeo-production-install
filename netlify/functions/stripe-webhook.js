'use strict';
const {reply} = require('./lib/db');
const {verifyWebhook} = require('./lib/stripe');
const {configuredBillingSync} = require('./lib/billing-sync');
const supported = new Set(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.expired','invoice.paid','invoice.payment_failed','customer.subscription.updated','customer.subscription.deleted','charge.refunded','charge.dispute.created','charge.dispute.updated','charge.dispute.closed']);
exports.handler = async event => {
 if (event.httpMethod !== 'POST') return reply(405, {error: 'POST required'});
 const raw = Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8');
 if (!verifyWebhook(raw, event.headers?.['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)) return reply(400, {error: 'Invalid webhook signature'});
 let e;try {e = JSON.parse(raw.toString('utf8'));} catch {return reply(400, {error: 'Invalid event'});}
 if (typeof e.id !== 'string' || !e.id.startsWith('evt_') || typeof e.type !== 'string') return reply(400, {error: 'Invalid event'});
 if (!supported.has(e.type)) return reply(200, {received: true, ignored: true});
 try {
  const competitorResult = await require("./lib/competitor-intelligence").configuredCompetitorIntelligence().webhook(e);
  if (competitorResult) return reply(200, {received: true, competitorIntelligence: true});
  const contentResult = await require("./lib/content-service").configuredContentService().webhook(e);
  if (contentResult) return reply(200, {received: true, contentService: true});
  const guestResult = await require("./lib/guest-service-checkout").configuredGuestServiceCheckout().webhook(e);
  if (guestResult) return reply(200, {received: true, guestService: true});
  const serviceResult = await require("./lib/service-checkout").configuredServiceCheckout().webhook(e);
  if (serviceResult) return reply(200, {received: true, service: true});
  const entityPurchaseResult = await require("./lib/entity-purchases").handleWebhook(e);
  if (entityPurchaseResult) return reply(200, {received: true, entityPurchase: true});
  const studioResult = await require("./lib/studio-link").handleStudioWebhook(e);
  if (studioResult) return reply(200, {received: true, studio: true});
  // Content Decay shares this live endpoint. Stripe signs each endpoint
  // separately, and this is the endpoint already configured for checkout,
  // refund and dispute events. handleWebhook returns false for another
  // product's records, so the remaining handlers still run.
  if (e.livemode === true && process.env.STRIPE_SECRET_KEY) {
    // checkout.session.expired is routed only for this product's metadata,
    // because every product's checkout sessions expire. Refunds and disputes
    // carry no product metadata, so they are offered to this handler and fall
    // through when it does not recognise the payment.
    const isContentDecay = ((e.type === 'checkout.session.completed'
      || e.type === 'checkout.session.async_payment_succeeded'
      || e.type === 'checkout.session.expired')
      && e.data?.object?.metadata?.product === 'content_decay')
      || e.type === 'charge.refunded'
      || e.type === 'charge.dispute.created'
      || e.type === 'charge.dispute.closed';
    if (isContentDecay) {
      const contentDecayResult = await require("./lib/content-decay-purchases").handleWebhook(e);
      if (contentDecayResult) return reply(200, {received: true, contentDecay: true});
    }
  }
  const result = await configuredBillingSync().event(e);
  return reply(200, {received: true, ignored: !!result.ignored});
 } catch (err) {
  console.error('Stripe webhook reconciliation failed', e.id, err.status || 'internal');
  return reply(500, {error: 'Billing update could not finish. Stripe should retry.'});
 }
};
