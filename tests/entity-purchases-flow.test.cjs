'use strict';

// Integration coverage for the paid AI Entity & Citation Authority Setup flow.
// The Stripe API and the Supabase auth/REST endpoints are replaced with
// in-memory fakes, so the webhook, claim, and entitlement path runs end to end
// without a live charge or a real account.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const purchases = require('../netlify/functions/lib/entity-purchases');
const stripeWebhook = require('../netlify/functions/stripe-webhook');

const SUPABASE_ORIGIN = 'https://fixture.supabase.co';
const STRIPE_ORIGIN = 'https://api.stripe.com';
const WEBHOOK_SECRET = 'whsec_fixture_only';
const SESSION_ID = 'cs_live_testfixture01';
const PAYMENT_INTENT = 'pi_live_fixture01';

const buyer = Object.freeze({
  id: '11111111-1111-4111-8111-111111111111',
  email: 'buyer@example.com',
  email_confirmed_at: '2026-02-01T00:00:00.000Z'
});

function paidSession(overrides = {}) {
  return {
    object: 'checkout.session',
    id: SESSION_ID,
    mode: 'payment',
    status: 'complete',
    payment_status: 'paid',
    livemode: true,
    currency: 'usd',
    amount_total: purchases.OFFERS.single.amount,
    metadata: { product: purchases.PRODUCT, plan: 'single', price: purchases.OFFERS.single.priceId },
    customer_details: { email: buyer.email },
    payment_intent: PAYMENT_INTENT,
    ...overrides
  };
}

function signedWebhook(event) {
  const raw = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac('sha256', WEBHOOK_SECRET)
    .update(timestamp + '.')
    .update(raw)
    .digest('hex');
  return {
    httpMethod: 'POST',
    headers: { 'stripe-signature': 't=' + timestamp + ',v1=' + signature, 'content-type': 'application/json' },
    body: raw,
    isBase64Encoded: false
  };
}

// Minimal PostgREST and Stripe API stand-ins. entity_purchases is a real table
// with upsert, filtered reads, and status updates; unrelated tables return [] so
// the other webhook handlers in stripe-webhook.js can decline the event.
function createBackend({ session = paidSession(), lineItems, user = buyer } = {}) {
  const rows = [];
  const requests = { stripe: [], rest: [] };
  const originalFetch = global.fetch;
  let auth = { status: 200, body: user };

  function matching(search) {
    const filters = [];
    for (const [key, value] of search) {
      if (value === 'is.null') filters.push([key, null]);
      else if (value.startsWith('eq.')) filters.push([key, value.slice(3)]);
    }
    return rows.filter(row => filters.every(([key, value]) => {
      if (value === null) return row[key] == null;
      return String(row[key] ?? '') === value;
    }));
  }

  function entityPurchases(url, method, init) {
    requests.rest.push(method + ' ' + url.pathname + url.search);
    if (method === 'POST') {
      const body = JSON.parse(init.body);
      for (const item of Array.isArray(body) ? body : [body]) {
        const existing = rows.find(row => row.stripe_session_id === item.stripe_session_id);
        if (existing) Object.assign(existing, item);
        else rows.push({ id: crypto.randomUUID(), created_at: new Date().toISOString(), status: 'paid', ...item });
      }
      return new Response('', { status: 201 });
    }
    if (method === 'PATCH') {
      const patch = JSON.parse(init.body);
      const selected = matching(url.searchParams);
      for (const row of selected) Object.assign(row, patch);
      const representation = String(init.headers?.Prefer || '').includes('return=representation');
      return representation ? Response.json(selected) : new Response(null, { status: 204 });
    }
    return Response.json(matching(url.searchParams));
  }

  global.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = String(init.method || 'GET').toUpperCase();

    if (url.origin === STRIPE_ORIGIN) {
      const path = url.pathname.replace(/^\/v1\//, '');
      requests.stripe.push(method + ' ' + path);
      if (method === 'GET' && path === 'checkout/sessions/' + encodeURIComponent(session.id)) {
        return Response.json(session);
      }
      if (method === 'GET' && path === 'checkout/sessions/' + encodeURIComponent(session.id) + '/line_items') {
        return Response.json(lineItems || {
          object: 'list',
          has_more: false,
          data: [{
            id: 'li_fixture',
            quantity: 1,
            price: {
              id: purchases.OFFERS[session.metadata.plan].priceId,
              product: purchases.OFFERS[session.metadata.plan].productId,
              unit_amount: purchases.OFFERS[session.metadata.plan].amount
            }
          }]
        });
      }
      throw new Error('Unexpected Stripe request: ' + method + ' ' + path);
    }

    if (url.origin === SUPABASE_ORIGIN) {
      if (url.pathname === '/auth/v1/user') {
        return new Response(JSON.stringify(auth.body), {
          status: auth.status,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (url.pathname === '/rest/v1/entity_purchases') {
        return entityPurchases(url, method, init);
      }
      if (url.pathname.startsWith('/rest/v1/')) {
        requests.rest.push(method + ' ' + url.pathname);
        if (method === 'GET') return Response.json([]);
        throw new Error('Unexpected write outside entity_purchases: ' + method + ' ' + url.pathname);
      }
    }

    throw new Error('Unexpected request: ' + method + ' ' + url.href);
  };

  return {
    rows,
    requests,
    setUser(next) { auth = { status: 200, body: next }; },
    setAuth(status, body) { auth = { status, body }; },
    restore() { global.fetch = originalFetch; }
  };
}

let claimEndpoint;
let entitlementEndpoint;
let implementationEndpoint;
const envKeys = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_ANON_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'PUBLIC_SITE_URL'
];
const savedEnv = {};

before(async () => {
  for (const key of envKeys) savedEnv[key] = process.env[key];
  Object.assign(process.env, {
    SUPABASE_URL: SUPABASE_ORIGIN,
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_fixture_only',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture_only',
    STRIPE_SECRET_KEY: 'sk_test_fixture_only',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    PUBLIC_SITE_URL: 'https://aeogeosearch.com'
  });
  delete process.env.SUPABASE_ANON_KEY;
  claimEndpoint = (await import('../netlify/functions/entity-purchase-claim.mjs')).default;
  entitlementEndpoint = (await import('../netlify/functions/entity-entitlement.mjs')).default;
  implementationEndpoint = (await import('../netlify/functions/entity-implementation.mjs')).default;
});

after(() => {
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

async function claim(backend, sessionId, user = buyer) {
  backend.setUser(user);
  const response = await claimEndpoint(new Request('https://aeogeosearch.com/.netlify/functions/entity-purchase-claim', {
    method: 'POST',
    headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId })
  }));
  return { status: response.status, body: await response.json() };
}

async function entitlement(backend, user = buyer) {
  backend.setUser(user);
  const response = await entitlementEndpoint(new Request('https://aeogeosearch.com/.netlify/functions/entity-entitlement', {
    headers: { authorization: 'Bearer fixture-token' }
  }));
  return { status: response.status, body: await response.json() };
}

test('paid studio flow: the webhook records the charge, verified email restores it, and explicit claim remains idempotent', async () => {
  const backend = createBackend();
  try {
    const event = {
      id: 'evt_fixture_checkout',
      type: 'checkout.session.completed',
      data: { object: paidSession() }
    };
    const delivered = await stripeWebhook.handler(signedWebhook(event));
    assert.equal(delivered.statusCode, 200);
    assert.deepEqual(JSON.parse(delivered.body), { received: true, entityPurchase: true });

    assert.equal(backend.rows.length, 1);
    assert.equal(backend.rows[0].status, 'paid');
    assert.equal(backend.rows[0].user_id, undefined);

    const otherAccount = { id: '22222222-2222-4222-8222-222222222222', email: 'other@example.com', email_confirmed_at: buyer.email_confirmed_at };
    assert.deepEqual(await entitlement(backend, otherAccount), {
      status: 200,
      body: { active: false, plan: null, limits: null }
    });
    assert.equal(backend.rows[0].user_id, undefined);

    assert.deepEqual(await entitlement(backend, buyer), {
      status: 200,
      body: { active: true, plan: 'single', limits: purchases.LIMITS.single }
    });
    assert.equal(backend.rows[0].user_id, buyer.id, 'a confirmed email must restore an unlinked paid purchase');

    assert.deepEqual(await claim(backend, SESSION_ID), {
      status: 200,
      body: { active: true, plan: 'single', limits: purchases.LIMITS.single }
    });
    assert.equal(backend.rows.length, 1);
    assert.equal(backend.rows[0].user_id, buyer.id);

    const redelivered = await stripeWebhook.handler(signedWebhook(event));
    assert.equal(redelivered.statusCode, 200);
    assert.equal(backend.rows.length, 1);
    assert.equal(backend.rows[0].user_id, buyer.id, 'webhook redelivery must not unlink a claimed purchase');
  } finally {
    backend.restore();
  }
});

test('email recovery cannot take a linked purchase or bypass confirmation', async () => {
  const backend = createBackend();
  try {
    await purchases.handleWebhook({
      id: 'evt_fixture_email_claim',
      type: 'checkout.session.completed',
      data: { object: paidSession() }
    });
    assert.equal((await claim(backend, SESSION_ID)).status, 200);
    assert.equal(backend.rows[0].user_id, buyer.id);

    const sameEmail = { ...buyer, id: '22222222-2222-4222-8222-222222222222' };
    assert.deepEqual(await entitlement(backend, sameEmail), {
      status: 200,
      body: { active: false, plan: null, limits: null }
    });
    assert.equal(backend.rows[0].user_id, buyer.id);

    const unconfirmed = { ...buyer, id: '33333333-3333-4333-8333-333333333333', email_confirmed_at: null };
    assert.deepEqual(await entitlement(backend, unconfirmed), {
      status: 200,
      body: { active: false, plan: null, limits: null }
    });
    assert.equal(backend.rows[0].user_id, buyer.id);
  } finally {
    backend.restore();
  }
});

test('a paid webhook with metadata.user_id links the purchase directly without the email fallback', async () => {
  const stripePayerEmail = 'different-payer@example.com';
  const session = paidSession({
    metadata: { product: purchases.PRODUCT, plan: 'single', price: purchases.OFFERS.single.priceId, user_id: buyer.id },
    customer_details: { email: stripePayerEmail }
  });
  const backend = createBackend({ session });
  try {
    const event = {
      id: 'evt_fixture_direct_account',
      type: 'checkout.session.completed',
      data: { object: session }
    };
    const delivered = await stripeWebhook.handler(signedWebhook(event));
    assert.equal(delivered.statusCode, 200);
    assert.deepEqual(JSON.parse(delivered.body), { received: true, entityPurchase: true });

    assert.equal(backend.rows.length, 1);
    assert.equal(backend.rows[0].user_id, buyer.id);
    assert.equal(backend.rows[0].email, stripePayerEmail);
    assert.notEqual(backend.rows[0].email, buyer.email, 'the session email must differ from the account email');

    // A fallback would need to patch an unowned row by email. The linked row
    // must answer the entitlement read before that path is considered.
    backend.requests.rest.length = 0;
    assert.deepEqual(await entitlement(backend, buyer), {
      status: 200,
      body: { active: true, plan: 'single', limits: purchases.LIMITS.single }
    });
    assert.equal(backend.rows[0].user_id, buyer.id);
    assert.equal(backend.requests.rest.length, 1);
    assert.match(backend.requests.rest[0], /^GET \/rest\/v1\/entity_purchases\?/);
    assert.equal(backend.requests.rest.some(request => request.startsWith('PATCH ') || request.includes('user_id=is.null')), false);
  } finally {
    backend.restore();
  }
});

test('the webhook accepts only paid live sessions for the offered plan and amount', async () => {
  const backend = createBackend();
  try {
    for (const session of [
      paidSession({ payment_status: 'unpaid' }),
      paidSession({ status: 'open' }),
      paidSession({ livemode: false }),
      paidSession({ amount_total: 100 }),
      paidSession({ mode: 'subscription' }),
      paidSession({ metadata: { product: 'other', plan: 'single' } }),
      paidSession({ metadata: { product: purchases.PRODUCT, plan: 'multi' } })
    ]) {
      assert.equal(await purchases.handleWebhook({
        id: 'evt_fixture_ignored',
        type: 'checkout.session.completed',
        data: { object: session }
      }), false);
    }
    assert.equal(backend.rows.length, 0);

    assert.equal(await purchases.handleWebhook({
      id: 'evt_fixture_async',
      type: 'checkout.session.async_payment_succeeded',
      data: { object: paidSession() }
    }), true);
    assert.equal(backend.rows.length, 1);

    const tampered = signedWebhook({
      id: 'evt_fixture_tampered',
      type: 'checkout.session.completed',
      data: { object: paidSession() }
    });
    tampered.body = tampered.body.replace('paid', 'unpaid');
    const rejected = await stripeWebhook.handler(tampered);
    assert.equal(rejected.statusCode, 400);
    assert.equal(backend.rows.length, 1);
  } finally {
    backend.restore();
  }
});

test('the claim refuses a different email, an unconfirmed account, wrong items, and another account', async () => {
  const backend = createBackend();
  try {
    await purchases.handleWebhook({
      id: 'evt_fixture_claim',
      type: 'checkout.session.completed',
      data: { object: paidSession() }
    });

    assert.deepEqual(await claim(backend, SESSION_ID, {
      id: '22222222-2222-4222-8222-222222222222',
      email: 'someone-else@example.com',
      email_confirmed_at: buyer.email_confirmed_at
    }), {
      status: 403,
      body: { error: 'Sign in with the email address used at Stripe to claim this purchase.', code: 'EMAIL_MISMATCH' }
    });
    assert.equal(backend.rows[0].user_id, undefined);

    const unconfirmed = await claim(backend, SESSION_ID, { id: buyer.id, email: buyer.email });
    assert.equal(unconfirmed.status, 403);
    assert.equal(unconfirmed.body.code, 'EMAIL_CONFIRMATION_REQUIRED');

    assert.equal((await claim(backend, 'not-a-session')).status, 400);

    assert.equal((await claim(backend, SESSION_ID)).status, 200);
    assert.equal(backend.rows[0].user_id, buyer.id);

    const secondAccount = await claim(backend, SESSION_ID, {
      id: '33333333-3333-4333-8333-333333333333',
      email: buyer.email,
      email_confirmed_at: buyer.email_confirmed_at
    });
    assert.equal(secondAccount.status, 409);
    assert.equal(secondAccount.body.code, 'PURCHASE_TAKEN');
    assert.equal(backend.rows[0].user_id, buyer.id);
  } finally {
    backend.restore();
  }

  const wrongItems = createBackend({
    lineItems: {
      object: 'list',
      has_more: false,
      data: [{
        id: 'li_fixture',
        quantity: 1,
        price: {
          id: 'price_not_the_offer',
          product: purchases.OFFERS.single.productId,
          unit_amount: purchases.OFFERS.single.amount
        }
      }]
    }
  });
  try {
    await purchases.handleWebhook({
      id: 'evt_fixture_items',
      type: 'checkout.session.completed',
      data: { object: paidSession() }
    });
    const result = await claim(wrongItems, SESSION_ID);
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'CHECKOUT_ITEMS_MISMATCH');
    assert.equal(wrongItems.rows[0].user_id, undefined);
  } finally {
    wrongItems.restore();
  }

  const testMode = createBackend({ session: paidSession({ livemode: false }) });
  try {
    const result = await claim(testMode, SESSION_ID);
    assert.equal(result.status, 403);
    assert.equal(result.body.code, 'CHECKOUT_NOT_VERIFIED');
  } finally {
    testMode.restore();
  }
});

test('a refund revokes paid access and a won dispute restores it', async () => {
  const backend = createBackend();
  try {
    await purchases.handleWebhook({
      id: 'evt_fixture_paid',
      type: 'checkout.session.completed',
      data: { object: paidSession() }
    });
    assert.equal((await claim(backend, SESSION_ID)).status, 200);
    assert.equal((await entitlement(backend)).body.active, true);

    assert.equal(await purchases.handleWebhook({
      id: 'evt_fixture_refund',
      type: 'charge.refunded',
      data: { object: { id: 'ch_fixture', refunded: true, payment_intent: PAYMENT_INTENT } }
    }), true);
    assert.equal(backend.rows[0].status, 'revoked');
    assert.deepEqual((await entitlement(backend)).body, { active: false, plan: null, limits: null });

    assert.equal(await purchases.handleWebhook({
      id: 'evt_fixture_won',
      type: 'charge.dispute.closed',
      data: { object: { status: 'won', payment_intent: PAYMENT_INTENT } }
    }), true);
    assert.equal(backend.rows[0].status, 'paid');
    assert.equal((await entitlement(backend)).body.active, true);

    assert.equal(await purchases.handleWebhook({
      id: 'evt_fixture_dispute',
      type: 'charge.dispute.created',
      data: { object: { id: 'dp_fixture', payment_intent: PAYMENT_INTENT } }
    }), true);
    assert.equal((await entitlement(backend)).body.active, false);

    assert.equal(await purchases.handleWebhook({
      id: 'evt_fixture_lost',
      type: 'charge.dispute.closed',
      data: { object: { status: 'lost', payment_intent: PAYMENT_INTENT } }
    }), false);
    assert.equal((await entitlement(backend)).body.active, false);

    assert.equal(await purchases.handleWebhook({
      id: 'evt_fixture_other_refund',
      type: 'charge.refunded',
      data: { object: { refunded: true, payment_intent: 'pi_live_someone_else' } }
    }), false);
    assert.equal((await entitlement(backend)).body.active, false);
  } finally {
    backend.restore();
  }
});

test('entitlement reports the strongest active plan and ignores revoked purchases', async () => {
  const backend = createBackend();
  try {
    backend.rows.push(
      { id: crypto.randomUUID(), user_id: buyer.id, plan: 'single', status: 'paid', livemode: true, created_at: '2026-01-01T00:00:00.000Z' },
      { id: crypto.randomUUID(), user_id: buyer.id, plan: 'multi', status: 'paid', livemode: true, created_at: '2026-01-02T00:00:00.000Z' },
      { id: crypto.randomUUID(), user_id: buyer.id, plan: 'multi', status: 'revoked', livemode: true, created_at: '2026-01-03T00:00:00.000Z' },
      { id: crypto.randomUUID(), user_id: '44444444-4444-4444-8444-444444444444', plan: 'multi', status: 'paid', livemode: true, created_at: '2026-01-04T00:00:00.000Z' }
    );

    assert.deepEqual(await entitlement(backend), {
      status: 200,
      body: { active: true, plan: 'multi', limits: purchases.LIMITS.multi }
    });

    const direct = await purchases.entitlementForUser(buyer.id);
    assert.equal(direct.plan, 'multi');
    assert.equal(direct.purchases, 2);
    assert.deepEqual(direct.limits, purchases.LIMITS.multi);

    const anonymous = await entitlementEndpoint(new Request('https://aeogeosearch.com/.netlify/functions/entity-entitlement'));
    assert.equal(anonymous.status, 401);
  } finally {
    backend.restore();
  }
});

test('the claim refuses a checkout bound to a different account', async () => {
  const otherId = '22222222-2222-4222-8222-222222222222';
  const session = paidSession({
    metadata: { ...paidSession().metadata, user_id: otherId }
  });
  const backend = createBackend({ session });
  try {
    await purchases.handleWebhook({
      id: 'evt_fixture_bound_account',
      type: 'checkout.session.completed',
      data: { object: session }
    });
    assert.equal(backend.rows[0].user_id, otherId);

    const result = await claim(backend, SESSION_ID, buyer);
    assert.equal(result.status, 403);
    assert.equal(result.body.code, 'ACCOUNT_MISMATCH');
    assert.equal(backend.rows[0].user_id, otherId, 'a rejected claim must not relink the purchase');
  } finally {
    backend.restore();
  }
});

test('redelivering checkout.session.completed cannot restore a refunded purchase', async () => {
  const backend = createBackend();
  try {
    const completed = {
      id: 'evt_fixture_replay_completed',
      type: 'checkout.session.completed',
      data: { object: paidSession() }
    };
    assert.equal((await stripeWebhook.handler(signedWebhook(completed))).statusCode, 200);
    assert.equal((await claim(backend, SESSION_ID)).status, 200);
    assert.equal(backend.rows[0].status, 'paid');

    await purchases.handleWebhook({
      id: 'evt_fixture_replay_refund',
      type: 'charge.refunded',
      data: { object: { id: 'ch_fixture', refunded: true, payment_intent: PAYMENT_INTENT } }
    });
    assert.equal(backend.rows[0].status, 'revoked');

    assert.equal((await stripeWebhook.handler(signedWebhook(completed))).statusCode, 200);
    assert.equal(backend.rows[0].status, 'revoked', 'a replayed completion must not resurrect a revoked row');
    assert.deepEqual((await entitlement(backend)).body, { active: false, plan: null, limits: null });
  } finally {
    backend.restore();
  }
});

test('the claim and implementation endpoints preserve authentication statuses', async () => {
  const backend = createBackend();
  try {
    backend.setAuth(503, { message: 'auth service unavailable' });
    const unavailable = await claimEndpoint(new Request('https://aeogeosearch.com/.netlify/functions/entity-purchase-claim', {
      method: 'POST',
      headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: SESSION_ID })
    }));
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).code, 'AUTH_UNAVAILABLE');

    const noToken = await claimEndpoint(new Request('https://aeogeosearch.com/.netlify/functions/entity-purchase-claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: SESSION_ID })
    }));
    assert.equal(noToken.status, 401);

    const implementation = await implementationEndpoint(new Request('https://aeogeosearch.com/.netlify/functions/entity-implementation', {
      method: 'POST',
      headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json' },
      body: JSON.stringify({ input: {} })
    }));
    assert.equal(implementation.status, 503);
    assert.equal((await implementation.json()).code, 'AUTH_UNAVAILABLE');

    backend.setUser({ ...buyer, email_confirmed_at: null });
    const unconfirmed = await implementationEndpoint(new Request('https://aeogeosearch.com/.netlify/functions/entity-implementation', {
      method: 'POST',
      headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json' },
      body: JSON.stringify({ input: {} })
    }));
    assert.equal(unconfirmed.status, 403);
    assert.equal((await unconfirmed.json()).code, 'EMAIL_CONFIRMATION_REQUIRED');
  } finally {
    backend.restore();
  }
});
