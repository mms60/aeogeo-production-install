'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { handler, OFFERS, validLivePrice } = require('../netlify/functions/entity-authority-checkout');

const validPrice = {
  id: OFFERS.single.priceId,
  product: OFFERS.single.productId,
  active: true,
  livemode: true,
  type: 'one_time',
  currency: 'usd',
  unit_amount: 79900,
  billing_scheme: 'per_unit',
  recurring: null,
  custom_unit_amount: null,
  transform_quantity: null
};

test('accepts only the active live one-time price for the selected offer', () => {
  assert.equal(validLivePrice(validPrice, OFFERS.single), true);
  assert.equal(validLivePrice({
    ...validPrice,
    id: OFFERS.multi.priceId,
    product: OFFERS.multi.productId,
    unit_amount: 119900
  }, OFFERS.multi), true);
  assert.equal(validLivePrice({ ...validPrice, unit_amount: 119900 }, OFFERS.single), false);
  assert.equal(validLivePrice({ ...validPrice, livemode: false }, OFFERS.single), false);
  assert.equal(validLivePrice({ ...validPrice, active: false }, OFFERS.single), false);
  assert.equal(validLivePrice({ ...validPrice, type: 'recurring' }, OFFERS.single), false);
  assert.equal(validLivePrice({ ...validPrice, currency: 'eur' }, OFFERS.single), false);
  assert.equal(validLivePrice({ ...validPrice, product: OFFERS.multi.productId }, OFFERS.single), false);
  assert.equal(validLivePrice({ ...validPrice, id: OFFERS.multi.priceId }, OFFERS.multi), false);
});

test('rejects missing or prototype plan values before contacting Stripe', async () => {
  for (const plan of ['', 'other', '__proto__', 'constructor']) {
    const response = await handler({
      httpMethod: 'GET',
      queryStringParameters: plan ? { plan } : {}
    });
    assert.equal(response.statusCode, 400);
    assert.match(response.headers['Cache-Control'], /no-store/);
  }
});

test('rejects unsupported methods', async () => {
  const response = await handler({ httpMethod: 'PUT' });
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, 'GET, POST');
});

test('pricing buttons require an account while the intake form remains available', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'site', 'ai-visibility-schema-studio.html'), 'utf8');
  assert.match(html, /id=(?:"ea-checkout-single"|ea-checkout-single)/);
  assert.match(html, /id=(?:"ea-checkout-multi"|ea-checkout-multi)/);
  assert.match(html, /data-ea-checkout="single"/);
  assert.match(html, /data-ea-checkout="multi"/);
  assert.match(html, /href="\/login\/\?next=%2Fai-visibility-schema-studio%23pricing"/);
  assert.doesNotMatch(html, /href="\/\.netlify\/functions\/entity-authority-checkout\?plan=/);
  assert.match(html, /id="ea-intake-form"/);
  assert.match(html, /Prefer to ask before buying\?/);
  assert.doesNotMatch(html, /href="#get-started" data-ea-plan="single"/);
  assert.doesNotMatch(html, /href="#get-started" data-ea-plan="multi"/);
});

test('a valid checkout request requires a signed-in account before contacting Stripe', async () => {
  const response = await handler({
    httpMethod: 'POST',
    headers: {},
    queryStringParameters: { plan: 'single' },
    body: '{}'
  });
  assert.equal(response.statusCode, 401);
  assert.equal(JSON.parse(response.body).code, 'SIGN_IN_REQUIRED');
  assert.match(response.headers['Cache-Control'], /no-store/);
});

test('a signed-in checkout binds the Stripe session to the buyer account', async () => {
  const saved = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL
  };
  const originalFetch = global.fetch;
  const requests = [];
  const buyer = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'buyer@example.com',
    email_confirmed_at: '2026-02-01T00:00:00.000Z'
  };

  Object.assign(process.env, {
    SUPABASE_URL: 'https://fixture.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_fixture_only',
    STRIPE_SECRET_KEY: 'sk_live_fixture_only',
    PUBLIC_SITE_URL: 'https://aeogeosearch.com'
  });

  global.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = String(init.method || 'GET').toUpperCase();
    requests.push({ url, method, body: init.body });

    if (url.origin === 'https://fixture.supabase.co' && url.pathname === '/auth/v1/user') {
      return Response.json(buyer);
    }
    if (url.origin === 'https://fixture.supabase.co' && url.pathname === '/rest/v1/entity_purchases') {
      return Response.json([]);
    }
    if (url.origin === 'https://api.stripe.com' && method === 'GET' && url.pathname === '/v1/prices/' + OFFERS.single.priceId) {
      return Response.json(validPrice);
    }
    if (url.origin === 'https://api.stripe.com' && method === 'POST' && url.pathname === '/v1/checkout/sessions') {
      return Response.json({
        id: 'cs_live_fixture01',
        url: 'https://checkout.stripe.com/c/pay/cs_live_fixture01',
        mode: 'payment',
        livemode: true,
        currency: 'usd',
        amount_total: OFFERS.single.amount
      });
    }
    throw new Error('Unexpected request: ' + method + ' ' + url.href);
  };

  try {
    const response = await handler({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'single' })
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      url: 'https://checkout.stripe.com/c/pay/cs_live_fixture01',
      plan: 'single',
      upgrade: false
    });

    const sessionRequest = requests.find(request => request.url.pathname === '/v1/checkout/sessions');
    assert.ok(sessionRequest, 'a Stripe checkout session must be created');
    const form = new URLSearchParams(String(sessionRequest.body || ''));
    assert.equal(form.get('customer_email'), buyer.email);
    assert.equal(form.get('client_reference_id'), buyer.id);
    assert.equal(form.get('metadata[user_id]'), buyer.id);
    assert.equal(form.get('metadata[plan]'), 'single');
    assert.equal(form.get('payment_intent_data[metadata][user_id]'), buyer.id);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
