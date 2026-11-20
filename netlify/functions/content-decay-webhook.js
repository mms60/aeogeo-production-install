'use strict';
// Content Decay Predictor - Stripe webhook endpoint (Phase 5).
//
// Dedicated endpoint rather than the shared stripe-webhook fan-out: it verifies
// with the product's own mode-aware signing secret (live or test), which keeps
// test-mode previews working without a second live secret on that deployment.
//
// Access is granted only here, after the session has been re-retrieved from
// Stripe and re-checked by content-decay-purchases.confirmSession().

const {reply} = require('./lib/db');
const {verifyWebhook} = require('./lib/stripe');
const config = require('./lib/content-decay-config');
const purchases = require('./lib/content-decay-purchases');

exports.handler = async event => {
  if (String(event.httpMethod || '').toUpperCase() !== 'POST') {
    return reply(405, {error: 'POST required'});
  }

  let secret;
  try {
    secret = config.webhookSecret();
  } catch (error) {
    console.error('Content decay webhook is not configured', error.code || 'config');
    return reply(503, {error: error.message, code: error.code});
  }

  const raw = Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8');
  if (!verifyWebhook(raw, event.headers?.['stripe-signature'], secret)) {
    return reply(400, {error: 'Invalid webhook signature'});
  }

  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    return reply(400, {error: 'Invalid event'});
  }
  if (typeof payload?.id !== 'string' || typeof payload?.type !== 'string') {
    return reply(400, {error: 'Invalid event'});
  }

  try {
    const handled = await purchases.handleWebhook(payload);
    return reply(200, {received: true, handled});
  } catch (error) {
    const status = Number(error?.status);
    console.error('Content decay webhook failed',
      payload.id, error?.code || 'internal', Number.isInteger(status) ? status : 500);
    if (Number.isInteger(status) && status >= 400 && status < 500) {
      return reply(status, {error: error.message, code: error.code});
    }
    return reply(500, {error: 'Billing update could not finish. Stripe should retry.'});
  }
};
