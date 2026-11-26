'use strict';

// The live Stripe endpoint is shared by every product. These tests pin the
// Content Decay branch: its events are handled first, and every other product's
// event still reaches the existing handlers.

const test = require('node:test');
const assert = require('node:assert/strict');

const state = {
  contentDecayResult: true,
  contentDecayCalls: [],
  billingCalls: []
};

function stub(request, exports) {
  const path = require.resolve(request);
  require.cache[path] = {id: path, filename: path, loaded: true, exports};
}

const reply = (statusCode, body) => ({statusCode, body: JSON.stringify(body)});

stub('../netlify/functions/lib/db', {
  reply,
  db: async () => { throw new Error('The dispatcher must not query the database.'); },
  user: async () => null
});
stub('../netlify/functions/lib/stripe', {verifyWebhook: () => true});
stub('../netlify/functions/lib/billing-sync', {
  configuredBillingSync: () => ({
    event: async event => {
      state.billingCalls.push(event);
      return {ignored: true};
    }
  })
});

for (const [name, factory] of [
  ['competitor-intelligence', 'configuredCompetitorIntelligence'],
  ['content-service', 'configuredContentService'],
  ['guest-service-checkout', 'configuredGuestServiceCheckout'],
  ['service-checkout', 'configuredServiceCheckout']
]) {
  stub('../netlify/functions/lib/' + name, {
    [factory]: () => ({webhook: async () => false})
  });
}

stub('../netlify/functions/lib/entity-purchases', {handleWebhook: async () => false});
stub('../netlify/functions/lib/studio-link', {handleStudioWebhook: async () => false});
stub('../netlify/functions/lib/content-decay-purchases', {
  handleWebhook: async event => {
    state.contentDecayCalls.push(event);
    return state.contentDecayResult;
  }
});

const {handler} = require('../netlify/functions/stripe-webhook');

function reset(contentDecayResult = true) {
  state.contentDecayResult = contentDecayResult;
  state.contentDecayCalls = [];
  state.billingCalls = [];
  process.env.STRIPE_SECRET_KEY = 'sk_live_fake';
}

const checkout = (product = 'content_decay') => ({
  id: 'evt_checkout_12345',
  type: 'checkout.session.completed',
  livemode: true,
  data: {object: {metadata: {product}}}
});

const refund = () => ({
  id: 'evt_refund_12345',
  type: 'charge.refunded',
  livemode: true,
  data: {object: {payment_intent: 'pi_test_123'}}
});

const expired = (product = 'content_decay') => ({
  id: 'evt_expired_12345',
  type: 'checkout.session.expired',
  livemode: true,
  data: {object: {id: 'cs_live_expired1', metadata: {product}}}
});

const disputeClosed = (status = 'won') => ({
  id: 'evt_dispute_closed1',
  type: 'charge.dispute.closed',
  livemode: true,
  data: {object: {id: 'dp_live_closed1', status, payment_intent: 'pi_test_123'}}
});

function call(event) {
  return handler({
    httpMethod: 'POST',
    headers: {'stripe-signature': 'test'},
    body: JSON.stringify(event)
  });
}

test('a Content Decay checkout is handled before the other billing handlers', async () => {
  reset(true);
  const response = await call(checkout());
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {received: true, contentDecay: true});
  assert.equal(state.contentDecayCalls.length, 1);
  assert.equal(state.billingCalls.length, 0);
});

test('another product\'s checkout never reaches the Content Decay handler', async () => {
  reset(true);
  const response = await call(checkout('competitor_intelligence'));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {received: true, ignored: true});
  assert.equal(state.contentDecayCalls.length, 0);
  assert.equal(state.billingCalls.length, 1);
});

test('a Content Decay refund is handled', async () => {
  reset(true);
  const response = await call(refund());
  assert.deepEqual(JSON.parse(response.body), {received: true, contentDecay: true});
  assert.equal(state.contentDecayCalls.length, 1);
  assert.equal(state.billingCalls.length, 0);
});

test('another product\'s refund falls through after the Content Decay lookup', async () => {
  reset(false);
  const response = await call(refund());
  assert.deepEqual(JSON.parse(response.body), {received: true, ignored: true});
  assert.equal(state.contentDecayCalls.length, 1);
  assert.equal(state.billingCalls.length, 1);
});

test('a closed dispute is routed to Content Decay before billing', async () => {
  reset(true);
  const response = await call(disputeClosed('won'));
  assert.deepEqual(JSON.parse(response.body), {received: true, contentDecay: true});
  assert.equal(state.contentDecayCalls.length, 1);
  assert.equal(state.contentDecayCalls[0].type, 'charge.dispute.closed');
  assert.equal(state.billingCalls.length, 0);
});

test('a closed dispute for another product falls through after the Content Decay lookup', async () => {
  reset(false);
  const response = await call(disputeClosed('lost'));
  assert.deepEqual(JSON.parse(response.body), {received: true, ignored: true});
  assert.equal(state.contentDecayCalls.length, 1);
  assert.equal(state.billingCalls.length, 1);
});

test('a Content Decay checkout expiry is handled', async () => {
  reset(true);
  const response = await call(expired());
  assert.deepEqual(JSON.parse(response.body), {received: true, contentDecay: true});
  assert.equal(state.contentDecayCalls.length, 1);
  assert.equal(state.contentDecayCalls[0].type, 'checkout.session.expired');
});

test('another product\'s checkout expiry never reaches the Content Decay handler', async () => {
  reset(true);
  const response = await call(expired('audit'));
  assert.deepEqual(JSON.parse(response.body), {received: true, ignored: true});
  assert.equal(state.contentDecayCalls.length, 0);
  assert.equal(state.billingCalls.length, 1);
});

test('a deployment without a live Stripe key leaves the shared endpoint untouched', async () => {
  reset(true);
  delete process.env.STRIPE_SECRET_KEY;
  const response = await call(checkout());
  assert.deepEqual(JSON.parse(response.body), {received: true, ignored: true});
  assert.equal(state.contentDecayCalls.length, 0);
  assert.equal(state.billingCalls.length, 1);
});
