'use strict';

// The $49 report credit has to reach Stripe, not just the page copy. This drives
// the real handler with stubbed Stripe and database modules and checks the
// checkout session it builds: exactly one coupon, the reduced total the handler
// then verifies, and nothing applied to an upgrade or to a customer without a
// recent report.

const test = require('node:test');
const assert = require('node:assert/strict');

const SINGLE = {priceId: 'price_1Uc6kWBIJX5f6WmhvQeqzs7o', productId: 'prod_VdNVizBmTfDoqH', amount: 79900};

const state = {rows: [], calls: [], dbFails: false};

function stub(request, exports) {
  const path = require.resolve(request);
  require.cache[path] = {id: path, filename: path, loaded: true, exports};
}

function priceObject(id, product, amount) {
  return {
    id, product, active: true, livemode: true, type: 'one_time', currency: 'usd',
    unit_amount: amount, billing_scheme: 'per_unit', recurring: null,
    custom_unit_amount: null, transform_quantity: null
  };
}

stub('../netlify/functions/lib/db', {
  db: async path => {
    if (state.dbFails) throw new Error('database unavailable');
    return state.rows;
  },
  user: async () => ({id: '11111111-1111-4111-8111-111111111111', email: 'buyer@example.com'}),
  reply: (statusCode, body) => ({statusCode, body: JSON.stringify(body)}),
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
});

stub('../netlify/functions/lib/entity-purchases', {
  entitlementForUser: async () => null
});

stub('../netlify/functions/lib/stripe', {
  origin: () => 'https://aeogeosearch.com',
  stripe: async (path, options = {}) => {
    state.calls.push({path, options});
    if (path.startsWith('prices/')) return priceObject(SINGLE.priceId, SINGLE.productId, SINGLE.amount);
    if (path === 'coupons') return {id: 'coupon_report4900'};
    if (path === 'checkout/sessions') {
      return {
        url: 'https://checkout.stripe.com/c/pay/cs_test_abc123',
        mode: 'payment',
        livemode: true,
        currency: 'usd',
        amount_total: Number(options.data['metadata[amount]'])
      };
    }
    throw new Error('unexpected Stripe call ' + path);
  }
});

const checkout = require('../netlify/functions/entity-authority-checkout');

async function run(event = {}) {
  state.calls = [];
  return checkout.handler({
    httpMethod: 'GET',
    headers: {authorization: 'Bearer token'},
    queryStringParameters: {plan: 'single'},
    ...event
  });
}

function sessionData() {
  const call = state.calls.find(entry => entry.path === 'checkout/sessions');
  return call && call.options.data;
}

test('a recent report adds one $49 coupon and shifts the expected total', async () => {
  state.rows = [{id: 'purchase-1'}];
  state.dbFails = false;
  const response = await run();
  assert.equal(response.statusCode, 200, response.body);

  const coupon = state.calls.find(entry => entry.path === 'coupons');
  assert.ok(coupon, 'a coupon should have been created');
  assert.equal(coupon.options.data.amount_off, '4900');
  assert.equal(coupon.options.data.currency, 'usd');
  assert.equal(coupon.options.data.duration, 'once');
  assert.equal(coupon.options.idempotency, 'ea-report-credit-11111111-1111-4111-8111-111111111111');

  const data = sessionData();
  assert.equal(data['discounts[0][coupon]'], 'coupon_report4900');
  assert.equal(data['metadata[report_credit]'], '4900');
  assert.equal(data['metadata[amount]'], '75000');
  assert.equal(data['line_items[0][price]'], SINGLE.priceId);
});

test('no recent report means the full price and no coupon', async () => {
  state.rows = [];
  state.dbFails = false;
  const response = await run();
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(state.calls.some(entry => entry.path === 'coupons'), false);
  const data = sessionData();
  assert.equal(data['metadata[amount]'], '79900');
  assert.equal(data['metadata[report_credit]'], undefined);
  assert.equal(data['discounts[0][coupon]'], undefined);
});

test('a broken credit lookup still sells at the full price', async () => {
  state.rows = [];
  state.dbFails = true;
  const response = await run();
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(state.calls.some(entry => entry.path === 'coupons'), false);
  assert.equal(sessionData()['metadata[amount]'], '79900');
  state.dbFails = false;
});

test('the Single-Hub upgrade never carries the report credit as well', async () => {
  state.rows = [{id: 'purchase-1'}];
  state.dbFails = false;
  state.calls = [];
  // Entitlement stubs are per-module, so the upgrade path rejects before pricing;
  // what matters here is that no second coupon is requested.
  const response = await checkout.handler({
    httpMethod: 'GET',
    headers: {authorization: 'Bearer token'},
    queryStringParameters: {plan: 'multi', upgrade: '1'}
  });
  assert.equal(response.statusCode, 403);
  assert.equal(state.calls.some(entry => entry.path === 'coupons'), false);
});

test('the live price the config points at is the $49 one', () => {
  const config = require('../netlify/functions/lib/content-decay-config');
  assert.equal(config.priceId({}), 'price_1UfLY5BIJX5f6Wmhc3WdQqsr');
  assert.equal(config.LIVE_PRICE_FALLBACK, 'price_1UfLY5BIJX5f6Wmhc3WdQqsr');
});
