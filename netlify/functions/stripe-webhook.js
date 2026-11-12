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
  const studioResult = await require("./lib/studio-link").handleStudioWebhook(e);
  if (studioResult) return reply(200, {received: true, studio: true});
  const result = await configuredBillingSync().event(e);
  return reply(200, {received: true, ignored: !!result.ignored});
 } catch (err) {
  console.error('Stripe webhook reconciliation failed', e.id, err.status || 'internal');
  return reply(500, {error: 'Billing update could not finish. Stripe should retry.'});
 }
};
