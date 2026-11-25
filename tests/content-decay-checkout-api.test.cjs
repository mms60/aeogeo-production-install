'use strict';

// HTTP-level tests for POST action=checkout and POST action=confirm. The real
// API handler runs with the database, config and purchase modules stubbed, so
// these cover routing, origin checks, auth, status codes and response mapping
// while the purchase module's own behavior stays covered in
// content-decay-purchases.test.cjs.

const test = require('node:test');
const assert = require('node:assert/strict');

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '99999999-9999-4999-8999-999999999999';
const SCAN = '22222222-2222-4222-8222-222222222222';
const PURCHASE = '44444444-4444-4444-8444-444444444444';
const ENTITLEMENT = '55555555-5555-4555-8555-555555555555';
const SESSION_ID = 'cs_test_abc123';

process.env.PUBLIC_SITE_URL = 'https://aeogeosearch.com';

const state = {};

function reset(overrides = {}) {
  Object.assign(state, {
    session: {id: USER, email: 'buyer@example.com'},
    authError: null,
    checkoutResult: {
      sessionId: SESSION_ID,
      url: 'https://checkout.stripe.com/c/pay/1',
      scanId: SCAN
    },
    checkoutError: null,
    confirmResult: {
      paid: true,
      scanId: SCAN,
      purchaseId: PURCHASE,
      entitlementId: ENTITLEMENT,
      environment: 'test'
    },
    confirmError: null,
    creditCheckoutResult: {sessionId: SESSION_ID, url: 'https://checkout.stripe.com/c/pay/credit', credit: true},
    claimResult: {available: true, claimed: true, paid: true, scanId: SCAN, entitlementId: ENTITLEMENT},
    claimError: null,
    openCreditResult: {available: false},
    openCreditError: null,
    confirmCreditResult: {paid: true, credit: true, creditId: ENTITLEMENT, environment: 'test'},
    confirmCreditError: null,
    checkoutCalls: [],
    confirmCalls: [],
    creditCheckoutCalls: [],
    claimCalls: [],
    openCreditCalls: [],
    confirmCreditCalls: []
  }, overrides);
}

async function user() {
  if (state.authError) throw state.authError;
  return state.session;
}

// Both routes must delegate to the purchase module rather than query directly.
async function db() {
  throw new Error('These routes must not query the database directly.');
}

const reply = (statusCode, body) => ({
  statusCode,
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify(body)
});

const dbPath = require.resolve('../netlify/functions/lib/db');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    db,
    user,
    reply,
    UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    signature() {},
    verifySignature() {}
  }
};

const configPath = require.resolve('../netlify/functions/lib/content-decay-config');
require.cache[configPath] = {
  id: configPath,
  filename: configPath,
  loaded: true,
  exports: {
    environment: () => 'test',
    credential: () => ({key: 'sk_test_fake', mode: 'test'}),
    priceId: () => 'price_test_123',
    webhookSecret: () => 'whsec_fake',
    signingSecret: () => 'x'.repeat(32),
    freePageLimit: () => 10,
    describe: () => ({})
  }
};

const purchasesPath = require.resolve('../netlify/functions/lib/content-decay-purchases');
require.cache[purchasesPath] = {
  id: purchasesPath,
  filename: purchasesPath,
  loaded: true,
  exports: {
    async createCheckout(options) {
      state.checkoutCalls.push(options);
      if (state.checkoutError) throw state.checkoutError;
      return state.checkoutResult;
    },
    async confirmSession(options) {
      state.confirmCalls.push(options);
      if (state.confirmError) throw state.confirmError;
      return state.confirmResult;
    },
    async createCreditCheckout(options) {
      state.creditCheckoutCalls.push(options);
      if (state.checkoutError) throw state.checkoutError;
      return state.creditCheckoutResult;
    },
    async claimCredit(options) {
      state.claimCalls.push(options);
      if (state.claimError) throw state.claimError;
      return state.claimResult;
    },
    async openCreditFor(options) {
      state.openCreditCalls.push(options);
      if (state.openCreditError) throw state.openCreditError;
      return state.openCreditResult;
    },
    async confirmCredit(options) {
      state.confirmCreditCalls.push(options);
      if (state.confirmCreditError) throw state.confirmCreditError;
      return state.confirmCreditResult;
    }
  }
};

const api = require('../netlify/functions/content-decay-api');

const postEvent = (body, headers = {}) => ({
  httpMethod: 'POST',
  headers,
  body: typeof body === 'string' ? body : JSON.stringify(body)
});

const payloadOf = response => JSON.parse(response.body);

// ---- checkout ------------------------------------------------------------

test('POST action=checkout returns the created session for the signed-in account', async () => {
  reset();

  const response = await api.handler(postEvent({
    action: 'checkout',
    scan: SCAN,
    // Client-supplied identity and pricing must never reach the purchase module.
    user_id: OTHER_USER,
    amount: 1,
    price: 'price_other'
  }));
  const body = payloadOf(response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(body, {
    sessionId: SESSION_ID,
    url: 'https://checkout.stripe.com/c/pay/1',
    scanId: SCAN
  });
  assert.deepEqual(state.checkoutCalls, [{scanId: SCAN, user: state.session}]);
});

test('POST action=checkout passes through an already-purchased scan', async () => {
  reset({
    checkoutResult: {alreadyPurchased: true, entitlementId: ENTITLEMENT, scanId: SCAN}
  });

  const response = await api.handler(postEvent({action: 'checkout', scan: SCAN}));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(payloadOf(response), {
    alreadyPurchased: true,
    entitlementId: ENTITLEMENT,
    scanId: SCAN
  });
});

test('POST action=checkout refuses a signed-out caller before creating a session', async () => {
  reset({
    authError: Object.assign(new Error('Please sign in.'), {
      status: 401,
      code: 'sign_in_required'
    })
  });

  const response = await api.handler(postEvent({action: 'checkout', scan: SCAN}));
  const body = payloadOf(response);

  assert.equal(response.statusCode, 401);
  assert.equal(body.code, 'sign_in_required');
  assert.equal(state.checkoutCalls.length, 0);
});

test('POST action=checkout refuses a cross-origin request', async () => {
  reset();

  const response = await api.handler(
    postEvent({action: 'checkout', scan: SCAN}, {origin: 'https://evil.example'}));
  const body = payloadOf(response);

  assert.equal(response.statusCode, 403);
  assert.equal(body.code, 'CONTENT_DECAY_ORIGIN');
  assert.equal(state.checkoutCalls.length, 0);
});

test('POST action=checkout rejects an invalid scan before calling the purchase module', async () => {
  reset();

  for (const scan of [undefined, '', 'not-a-uuid', '../../etc/passwd']) {
    const response = await api.handler(postEvent({action: 'checkout', scan}));
    const body = payloadOf(response);
    assert.equal(response.statusCode, 400, 'scan value: ' + String(scan));
    assert.equal(body.code, 'CONTENT_DECAY_INVALID_REQUEST');
  }
  assert.equal(state.checkoutCalls.length, 0);
});

test('POST action=checkout maps a purchase-module refusal to its HTTP status', async () => {
  reset({
    checkoutError: Object.assign(new Error('This scan is not linked to your account.'), {
      status: 403,
      code: 'CONTENT_DECAY_SCAN_NOT_OWNED'
    })
  });

  const response = await api.handler(postEvent({action: 'checkout', scan: SCAN}));
  const body = payloadOf(response);

  assert.equal(response.statusCode, 403);
  assert.equal(body.code, 'CONTENT_DECAY_SCAN_NOT_OWNED');
  assert.equal(body.error, 'This scan is not linked to your account.');
});

test('POST action=checkout hides an internal purchase failure behind the service error', async () => {
  reset({
    checkoutError: Object.assign(new Error('Stripe is unavailable.'), {
      status: 503,
      code: 'CONTENT_DECAY_STRIPE_REQUEST'
    })
  });

  const response = await api.handler(postEvent({action: 'checkout', scan: SCAN}));
  const body = payloadOf(response);

  assert.equal(response.statusCode, 503);
  assert.equal(body.code, 'CONTENT_DECAY_UNAVAILABLE');
  assert.equal(body.error.includes('Stripe is unavailable.'), false);
});

test('POST action=checkout rejects malformed JSON and oversized bodies', async () => {
  reset();

  const malformed = await api.handler(postEvent('{"action": "checkout",'));
  assert.equal(malformed.statusCode, 400);
  assert.equal(payloadOf(malformed).code, 'CONTENT_DECAY_INVALID_REQUEST');

  const oversized = await api.handler(postEvent({
    action: 'checkout',
    scan: SCAN,
    padding: 'x'.repeat(8200)
  }));
  assert.equal(oversized.statusCode, 413);
  assert.equal(payloadOf(oversized).code, 'CONTENT_DECAY_REQUEST_TOO_LARGE');

  assert.equal(state.checkoutCalls.length, 0);
});

// ---- credit checkout and claim -------------------------------------------

test('POST action=checkout with credit buys the report before any scan exists', async () => {
  reset();

  const response = await api.handler(postEvent({action: 'checkout', credit: true}));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(payloadOf(response), state.creditCheckoutResult);
  assert.deepEqual(state.creditCheckoutCalls, [{user: state.session}]);
  assert.equal(state.checkoutCalls.length, 0, 'the scan checkout is not used');
});

test('POST action=checkout with credit returns the open credit instead of a session', async () => {
  reset({
    creditCheckoutResult: {alreadyCredited: true, creditId: ENTITLEMENT, amountTotal: 4999}
  });

  const response = await api.handler(postEvent({action: 'checkout', credit: true}));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(payloadOf(response), {
    alreadyCredited: true,
    creditId: ENTITLEMENT,
    amountTotal: 4999
  });
  assert.equal(payloadOf(response).url, undefined, 'no payment link is returned');
});

test('POST action=credit reports the credit the signed-in buyer already holds', async () => {
  reset({
    openCreditResult: {available: true, creditId: ENTITLEMENT, amountTotal: 4999, currency: 'usd'}
  });

  const response = await api.handler(postEvent({action: 'credit', user_id: OTHER_USER}));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(payloadOf(response), {
    available: true,
    creditId: ENTITLEMENT,
    amountTotal: 4999,
    currency: 'usd'
  });
  assert.deepEqual(state.openCreditCalls, [{user: state.session}],
    'identity comes from the session, never the body');
});

test('POST action=credit reports an unpaid checkout the page can continue', async () => {
  reset({
    openCreditResult: {
      available: false,
      pending: true,
      creditId: ENTITLEMENT,
      checkoutUrl: 'https://checkout.stripe.com/c/pay/credit'
    }
  });

  const response = await api.handler(postEvent({action: 'credit'}));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(payloadOf(response), {
    available: false,
    pending: true,
    creditId: ENTITLEMENT,
    checkoutUrl: 'https://checkout.stripe.com/c/pay/credit'
  });
});

test('POST action=confirm with credit confirms the reserved credit, not a scan', async () => {
  reset();

  const response = await api.handler(postEvent({
    action: 'confirm',
    sessionId: SESSION_ID,
    credit: true
  }));

  assert.equal(response.statusCode, 200);
  assert.equal(state.confirmCreditCalls.length, 1, 'the credit confirmation runs');
  assert.equal(state.confirmCalls.length, 0, 'a credit has no scan to confirm');
  assert.deepEqual(state.confirmCreditCalls[0], {sessionId: SESSION_ID, expectedUserId: USER});
  assert.equal(payloadOf(response).credit, true);
});

test('POST action=credit still needs a signed-in caller', async () => {
  reset({
    authError: Object.assign(new Error('Please sign in.'), {status: 401, code: 'sign_in_required'})
  });

  const response = await api.handler(postEvent({action: 'credit'}));

  assert.equal(response.statusCode, 401);
  assert.equal(state.openCreditCalls.length, 0);
});

test('POST action=checkout with credit still needs a signed-in caller', async () => {
  reset({
    authError: Object.assign(new Error('Please sign in.'), {status: 401, code: 'sign_in_required'})
  });

  const response = await api.handler(postEvent({action: 'checkout', credit: true}));

  assert.equal(response.statusCode, 401);
  assert.equal(state.creditCheckoutCalls.length, 0);
});

test('POST action=claim spends the credit on the named scan', async () => {
  reset();

  const response = await api.handler(postEvent({
    action: 'claim',
    scan: SCAN,
    // Client-supplied identity must never reach the purchase module.
    user_id: OTHER_USER
  }));

  assert.equal(response.statusCode, 200);
  assert.equal(payloadOf(response).claimed, true);
  assert.deepEqual(state.claimCalls, [{scanId: SCAN, user: state.session}]);
});

test('POST action=claim rejects an invalid scan and a cross-origin request', async () => {
  reset();

  for (const scan of [undefined, '', 'not-a-uuid']) {
    const response = await api.handler(postEvent({action: 'claim', scan}));
    assert.equal(response.statusCode, 400, 'scan value: ' + String(scan));
    assert.equal(payloadOf(response).code, 'CONTENT_DECAY_INVALID_REQUEST');
  }
  assert.equal(state.claimCalls.length, 0);

  const crossOrigin = await api.handler(
    postEvent({action: 'claim', scan: SCAN}, {origin: 'https://evil.example'}));
  assert.equal(crossOrigin.statusCode, 403);
  assert.equal(payloadOf(crossOrigin).code, 'CONTENT_DECAY_ORIGIN');
  assert.equal(state.claimCalls.length, 0);
});

// ---- confirm -------------------------------------------------------------

test('POST action=confirm returns the paid purchase result for the signed-in account', async () => {
  reset();

  const response = await api.handler(postEvent({
    action: 'confirm',
    sessionId: SESSION_ID,
    // A different user id in the body must be ignored.
    user_id: OTHER_USER
  }));
  const body = payloadOf(response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(body, {
    paid: true,
    scanId: SCAN,
    purchaseId: PURCHASE,
    entitlementId: ENTITLEMENT,
    environment: 'test'
  });
  assert.deepEqual(state.confirmCalls, [{sessionId: SESSION_ID, expectedUserId: USER}]);
});

test('POST action=confirm returns a refunded purchase without an error', async () => {
  reset({
    confirmResult: {
      paid: false,
      refunded: true,
      revoked: false,
      scanId: SCAN,
      purchaseId: PURCHASE,
      environment: 'test'
    }
  });

  const response = await api.handler(postEvent({action: 'confirm', sessionId: SESSION_ID}));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(payloadOf(response), {
    paid: false,
    refunded: true,
    revoked: false,
    scanId: SCAN,
    purchaseId: PURCHASE,
    environment: 'test'
  });
});

test('POST action=confirm rejects an invalid checkout session', async () => {
  reset();

  for (const sessionId of [undefined, '', 'ch_test_123', 'cs_']) {
    const response = await api.handler(postEvent({action: 'confirm', sessionId}));
    const body = payloadOf(response);
    assert.equal(response.statusCode, 400, 'session value: ' + String(sessionId));
    assert.equal(body.code, 'CONTENT_DECAY_INVALID_REQUEST');
  }
  assert.equal(state.confirmCalls.length, 0);
});

test('POST action=confirm refuses a signed-out caller before checking the session', async () => {
  reset({
    authError: Object.assign(new Error('Please sign in.'), {
      status: 401,
      code: 'sign_in_required'
    })
  });

  const response = await api.handler(postEvent({action: 'confirm', sessionId: SESSION_ID}));

  assert.equal(response.statusCode, 401);
  assert.equal(payloadOf(response).code, 'sign_in_required');
  assert.equal(state.confirmCalls.length, 0);
});

test('POST action=confirm refuses a cross-origin request', async () => {
  reset();

  const response = await api.handler(
    postEvent({action: 'confirm', sessionId: SESSION_ID}, {origin: 'https://evil.example'}));

  assert.equal(response.statusCode, 403);
  assert.equal(payloadOf(response).code, 'CONTENT_DECAY_ORIGIN');
  assert.equal(state.confirmCalls.length, 0);
});

test('POST action=confirm maps an unpaid or unknown checkout to its HTTP status', async () => {
  for (const [status, code] of [
    [409, 'CONTENT_DECAY_NOT_PAID'],
    [404, 'CONTENT_DECAY_SCAN_NOT_FOUND'],
    [403, 'CONTENT_DECAY_SCAN_NOT_OWNED']
  ]) {
    reset({
      confirmError: Object.assign(new Error('That checkout cannot be confirmed.'), {status, code})
    });

    const response = await api.handler(postEvent({action: 'confirm', sessionId: SESSION_ID}));
    const body = payloadOf(response);

    assert.equal(response.statusCode, status);
    assert.equal(body.code, code);
    assert.equal(body.error, 'That checkout cannot be confirmed.');
  }
});

test('POST action=confirm hides an internal failure behind the service error', async () => {
  reset({
    confirmError: Object.assign(new Error('The database is unavailable.'), {
      status: 503,
      code: 'CONTENT_DECAY_UNAVAILABLE'
    })
  });

  const response = await api.handler(postEvent({action: 'confirm', sessionId: SESSION_ID}));
  const body = payloadOf(response);

  assert.equal(response.statusCode, 503);
  assert.equal(body.code, 'CONTENT_DECAY_UNAVAILABLE');
  assert.equal(body.error.includes('The database is unavailable.'), false);
});
