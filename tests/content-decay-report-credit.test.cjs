'use strict';

// The $49 report is sold with "fully credited toward a brand service within 30
// days". These tests pin both halves of that promise: the lookup that finds the
// recent report, and the verification that accepts the reduced total instead of
// rejecting a legitimately discounted purchase.

const test = require('node:test');
const assert = require('node:assert/strict');

const state = {rows: [], queries: [], fail: false, user: null};

function stub(request, exports) {
  const path = require.resolve(request);
  require.cache[path] = {id: path, filename: path, loaded: true, exports};
}

stub('../netlify/functions/lib/db', {
  db: async path => {
    state.queries.push(path);
    if (state.fail) throw new Error('database unavailable');
    return state.rows;
  },
  user: async () => state.user,
  reply: (statusCode, body) => ({statusCode, body: JSON.stringify(body)}),
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
});

const checkout = require('../netlify/functions/entity-authority-checkout');
const purchases = require('../netlify/functions/lib/entity-purchases');

const USER = '11111111-1111-4111-8111-111111111111';

function paidSession(overrides = {}) {
  return {
    object: 'checkout.session',
    mode: 'payment',
    status: 'complete',
    payment_status: 'paid',
    livemode: true,
    currency: 'usd',
    amount_total: purchases.OFFERS.single.amount,
    metadata: {
      product: purchases.PRODUCT,
      plan: 'single',
      price: purchases.OFFERS.single.priceId
    },
    ...overrides
  };
}

test('a report bought in the last 30 days is worth the full $49 credit', async () => {
  state.rows = [{id: 'purchase-1'}];
  state.fail = false;
  state.queries = [];
  assert.equal(await checkout.reportCreditFor(USER), 4900);
  const [query] = state.queries;
  assert.match(query, /content_decay_purchases/);
  assert.match(query, /user_id=eq\./);
  assert.match(query, /status=eq\.paid/);
  assert.match(query, /livemode=eq\.true/);
  assert.match(query, /environment=eq\.live/);
  assert.match(query, /created_at=gte\./);
  assert.match(query, /limit=1/);
});

test('the credit window really is 30 days', async () => {
  state.rows = [];
  state.fail = false;
  state.queries = [];
  await checkout.reportCreditFor(USER);
  const raw = decodeURIComponent(/created_at=gte\.([^&]+)/.exec(state.queries[0])[1]);
  const since = new Date(raw).getTime();
  const days = (Date.now() - since) / (24 * 60 * 60 * 1000);
  assert.ok(days > 29.9 && days < 30.1, 'expected a 30 day window, got ' + days);
});

test('no recent report means no credit, not an error', async () => {
  state.rows = [];
  state.fail = false;
  assert.equal(await checkout.reportCreditFor(USER), 0);
});

test('a database failure withholds the credit instead of blocking checkout', async () => {
  state.fail = true;
  assert.equal(await checkout.reportCreditFor(USER), 0);
  state.fail = false;
});

test('the discounted $750 total is accepted for Single-Hub', () => {
  const session = paidSession({
    amount_total: purchases.OFFERS.single.amount - 4900,
    metadata: {
      product: purchases.PRODUCT,
      plan: 'single',
      price: purchases.OFFERS.single.priceId,
      report_credit: '4900'
    }
  });
  assert.equal(purchases.sessionIsPaid(session, purchases.OFFERS.single), true);
});

test('the discounted $1,150 total is accepted for Multi-Location', () => {
  const session = paidSession({
    amount_total: purchases.OFFERS.multi.amount - 4900,
    metadata: {
      product: purchases.PRODUCT,
      plan: 'multi',
      price: purchases.OFFERS.multi.priceId,
      report_credit: '4900'
    }
  });
  assert.equal(purchases.sessionIsPaid(session, purchases.OFFERS.multi), true);
});

test('a reduced total without the declared credit is still rejected', () => {
  const session = paidSession({amount_total: purchases.OFFERS.single.amount - 4900});
  assert.equal(purchases.sessionIsPaid(session, purchases.OFFERS.single), false);
});

test('a forged credit amount cannot claim more than $49', () => {
  for (const declared of ['999999', '4999', '-4900', 'nan']) {
    const session = paidSession({
      amount_total: 100,
      metadata: {
        product: purchases.PRODUCT,
        plan: 'single',
        price: purchases.OFFERS.single.priceId,
        report_credit: declared
      }
    });
    assert.equal(purchases.sessionIsPaid(session, purchases.OFFERS.single), false, declared);
  }
});

test('the credit does not stack on the Single-Hub upgrade', () => {
  const upgraded = paidSession({
    amount_total: checkout.UPGRADE.amount,
    metadata: {
      product: purchases.PRODUCT,
      plan: 'multi',
      price: purchases.OFFERS.multi.priceId,
      upgrade: '1',
      previous_plan: 'single',
      report_credit: '4900'
    }
  });
  assert.equal(purchases.sessionReportCredit(upgraded, purchases.OFFERS.multi), 0);
  assert.equal(purchases.sessionIsPaid(upgraded, purchases.OFFERS.multi), true);
});

test('the full undiscounted total is still accepted', () => {
  assert.equal(purchases.sessionIsPaid(paidSession(), purchases.OFFERS.single), true);
});

test('the report price lives in one place and is $49', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const config = fs.readFileSync(
    path.join(__dirname, '..', 'netlify', 'functions', 'lib', 'content-decay-config.js'), 'utf8');
  const purchasesSource = fs.readFileSync(
    path.join(__dirname, '..', 'netlify', 'functions', 'lib', 'content-decay-purchases.js'), 'utf8');
  assert.match(purchasesSource, /REPORT_AMOUNT = 4999/);
  assert.match(config, /LIVE_PRICE_FALLBACK = 'price_1UfLY5BIJX5f6Wmhc3WdQqsr'/);
  assert.doesNotMatch(config, /LIVE_PRICE_FALLBACK = 'price_1UdvRBBIJX5f6Wmhm4uU56Zj'/);
});

test('the page states the price and the 30 day credit', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'site', 'content-decay', 'index.html'), 'utf8');
  assert.match(html, /\$49/);
  assert.doesNotMatch(html, /\$19\.99/);
  assert.match(html, /credited toward/i);
  assert.match(html, /30 days/);
  assert.match(html, /Single-Hub/);
  assert.match(html, /Multi-Location/);
});
