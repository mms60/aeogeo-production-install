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

test('pricing buttons use checkout while the intake form remains available', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'site', 'ai-visibility-schema-studio.html'), 'utf8');
  assert.match(html, /entity-authority-checkout\?plan=single/);
  assert.match(html, /entity-authority-checkout\?plan=multi/);
  assert.match(html, /data-ea-checkout="single"/);
  assert.match(html, /data-ea-checkout="multi"/);
  assert.match(html, /id="ea-intake-form"/);
  assert.match(html, /Prefer to talk first\?/);
  assert.doesNotMatch(html, /href="#get-started" data-ea-plan="single"/);
  assert.doesNotMatch(html, /href="#get-started" data-ea-plan="multi"/);
});
