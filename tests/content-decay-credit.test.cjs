'use strict';

// Offline tests for buying the $49 report before a scan exists. Stripe and the
// database are injected fakes, so no credentials, network or live database is
// involved. The report flow itself stays covered in
// content-decay-purchases.test.cjs.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createCreditCheckout,
  openCreditFor,
  confirmCredit,
  claimCredit,
  handleWebhook,
  REPORT_AMOUNT
} = require('../netlify/functions/lib/content-decay-purchases');

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '99999999-9999-4999-8999-999999999999';
const SCAN = '22222222-2222-4222-8222-222222222222';
const TEST_RUN = '33333333-3333-4333-8333-333333333333';
const PURCHASE = '44444444-4444-4444-8444-444444444444';
const ENTITLEMENT = '55555555-5555-4555-8555-555555555555';
const CREDIT = '66666666-6666-4666-8666-666666666666';
const PRICE_ID = 'price_test_123';

process.env.PUBLIC_SITE_URL = 'https://aegeosearch.com';
const SESSION_ID = 'cs_test_credit1';
const EVENT_ID = 'evt_test_credit12345';

const price = () => ({
  id: PRICE_ID,
  active: true,
  type: 'one_time',
  currency: 'usd',
  unit_amount: REPORT_AMOUNT,
  livemode: false
});

const creditSession = (overrides = {}) => ({
  id: SESSION_ID,
  mode: 'payment',
  status: 'complete',
  payment_status: 'paid',
  amount_total: REPORT_AMOUNT,
  currency: 'usd',
  livemode: false,
  metadata: {
    product: 'content_decay',
    kind: 'credit',
    user_id: USER,
    environment: 'test'
  },
  line_items: {data: [{quantity: 1, price: {id: PRICE_ID}}]},
  customer_details: {email: 'buyer@example.com'},
  payment_intent: 'pi_test_credit1',
  ...overrides
});

const reportSession = () => creditSession({
  id: 'cs_test_report1',
  metadata: {
    product: 'content_decay',
    scan_id: SCAN,
    user_id: USER,
    environment: 'test'
  }
});

const scan = (overrides = {}) => ({
  id: SCAN,
  user_id: USER,
  status: 'completed',
  environment: 'test',
  test_run_id: TEST_RUN,
  hostname: 'example.com',
  target_url: 'https://example.com',
  ...overrides
});

const openCredit = (overrides = {}) => ({
  id: CREDIT,
  stripe_session_id: SESSION_ID,
  stripe_payment_intent: 'pi_test_credit1',
  stripe_price_id: PRICE_ID,
  amount_total: REPORT_AMOUNT,
  currency: 'usd',
  livemode: false,
  email: 'buyer@example.com',
  status: 'open',
  ...overrides
});

function fakeClient(overrides = {}) {
  return {
    retrievePrice: async () => price(),
    retrieveSession: async () => creditSession(),
    createCheckoutSession: async () => ({
      id: SESSION_ID,
      url: 'https://checkout.stripe.com/c/pay/credit'
    }),
    ...overrides
  };
}

// Records every call and answers by path prefix, so a test can assert both the
// request the module made and the row it wrote.
function fakeDatabase(routes) {
  const calls = [];
  const database = async (path, options = {}) => {
    calls.push({path, options});
    return routes(path, options, calls);
  };
  database.calls = calls;
  return database;
}

function routes(overrides = {}) {
  const config = {
    scan: scan(),
    entitlements: [],
    purchases: [],
    creditBySession: [],
    openCredits: [],
    // The pending-or-open reservation the checkout reads before Stripe.
    creditRows: [],
    intentPurchases: [],
    credit: null,
    claim: true,
    ...overrides
  };
  return (path, options = {}) => {
    if (path.startsWith('content_decay_scans?id=eq.')) return config.scan ? [config.scan] : [];
    if (path.startsWith('content_decay_entitlements?')) return config.entitlements;
    if (path.startsWith('content_decay_purchases?stripe_session_id=eq.')) return config.purchases;
    if (path.startsWith('content_decay_purchases?stripe_payment_intent=eq.')) return config.intentPurchases;
    if (path === 'content_decay_purchases') return [{id: PURCHASE, scan_id: SCAN}];
    if (path.includes('status=in.(pending,open)')) return config.creditRows;
    if (path.startsWith('content_decay_report_credits?stripe_session_id=eq.')) return config.creditBySession;
    if (path.startsWith('content_decay_report_credits?user_id=eq.')) return config.openCredits;
    if (path.startsWith('content_decay_report_credits?stripe_payment_intent=eq.')) {
      return config.credit ? [config.credit] : [];
    }
    if (path.startsWith('content_decay_report_credits?id=eq.')) {
      if (config.reservationUpdate !== undefined) return config.reservationUpdate;
      // The filtered update answers with the row it changed, as Postgres does.
      return [{id: CREDIT, status: 'pending', stripe_session_id: null, ...(options.body || {})}];
    }
    if (path === 'content_decay_report_credits') {
      return [{id: CREDIT, status: 'pending', checkout_url: null, created_at: new Date().toISOString()}];
    }
    if (path === 'rpc/content_decay_grant_entitlement') return ENTITLEMENT;
    if (path === 'rpc/content_decay_claim_webhook') return config.claim;
    throw new Error('Unexpected database path: ' + path);
  };
}

// ---- checkout -------------------------------------------------------------

test('a credit checkout needs no scan and carries no scan id', async () => {
  const client = fakeClient();
  let params;
  client.createCheckoutSession = async data => {
    params = data;
    return {id: SESSION_ID, url: 'https://checkout.stripe.com/c/pay/credit'};
  };

  const result = await createCreditCheckout({
    user: {id: USER, email: 'buyer@example.com'},
    client,
    database: fakeDatabase(routes()),
    mode: 'test',
    priceId: PRICE_ID,
    origin: 'https://aeogeosearch.com'
  });

  assert.equal(result.credit, true);
  assert.equal(result.url, 'https://checkout.stripe.com/c/pay/credit');
  assert.equal(params['metadata[kind]'], 'credit');
  assert.equal(params['metadata[user_id]'], USER);
  assert.equal(params['metadata[scan_id]'], undefined, 'a credit must not name a scan');
  assert.equal('metadata[scan_id]' in params, false);
  assert.match(params.success_url, /\/content-decay\/\?credit=1&session_id=\{CHECKOUT_SESSION_ID\}$/);
});

test('an existing open credit is returned instead of starting a second payment', async () => {
  let sessions = 0;
  const client = fakeClient({
    createCheckoutSession: async () => {
      sessions += 1;
      return {id: SESSION_ID, url: 'https://checkout.stripe.com/c/pay/credit'};
    }
  });
  const database = fakeDatabase(routes({creditRows: [openCredit()]}));

  const result = await createCreditCheckout({
    user: {id: USER, email: 'buyer@example.com'},
    client,
    database,
    mode: 'test',
    priceId: PRICE_ID,
    origin: 'https://aegeosearch.com'
  });

  assert.equal(result.alreadyCredited, true);
  assert.equal(result.creditId, CREDIT);
  assert.equal(result.url, undefined, 'no second payment link is created');
  assert.equal(sessions, 0, 'Stripe must not be called when a credit is already open');
});

test('the open credit lookup reports the buyer credit, or nothing', async () => {
  const found = await openCreditFor({
    user: {id: USER},
    database: fakeDatabase(routes({openCredits: [openCredit({created_at: '2026-11-25T10:00:00.000Z'})]})),
    mode: 'test'
  });

  assert.equal(found.available, true);
  assert.equal(found.creditId, CREDIT);
  assert.equal(found.amountTotal, REPORT_AMOUNT);
  assert.equal(found.currency, 'usd');

  const empty = await openCreditFor({
    user: {id: USER},
    database: fakeDatabase(routes({openCredits: []})),
    mode: 'test'
  });
  assert.deepEqual(empty, {available: false});
});

test('a signed-out buyer cannot look up a credit', async () => {
  await assert.rejects(
    () => openCreditFor({user: null, database: fakeDatabase(routes()), mode: 'test'}),
    error => error.status === 401
  );
});

test('a credit checkout refuses a signed-out caller before calling Stripe', async () => {
  let called = false;
  const client = fakeClient({createCheckoutSession: async () => { called = true; }});

  await assert.rejects(
    () => createCreditCheckout({user: null, client, database: fakeDatabase(routes()), mode: 'test', priceId: PRICE_ID}),
    error => error.status === 401 && error.code === 'CONTENT_DECAY_SIGN_IN_REQUIRED'
  );
  assert.equal(called, false);
});

// ---- confirm --------------------------------------------------------------

test('confirming a credit session records an open credit', async () => {
  const database = fakeDatabase(routes());

  const result = await confirmCredit({
    sessionId: SESSION_ID,
    expectedUserId: USER,
    client: fakeClient(),
    database,
    priceId: PRICE_ID
  });

  assert.deepEqual(result, {paid: true, credit: true, creditId: CREDIT, environment: 'test'});
  const insert = database.calls.find(call => call.path === 'content_decay_report_credits');
  assert.ok(insert, 'the credit row is written');
  assert.equal(insert.options.body.status, 'open');
  assert.equal(insert.options.body.user_id, USER);
  assert.equal(insert.options.body.scan_id, undefined);
});

test('a report session is not accepted as a credit', async () => {
  await assert.rejects(
    () => confirmCredit({
      sessionId: 'cs_test_report1',
      expectedUserId: USER,
      client: fakeClient({retrieveSession: async () => reportSession()}),
      database: fakeDatabase(routes()),
      priceId: PRICE_ID
    }),
    error => error.status === 409 && error.code === 'CONTENT_DECAY_NOT_PAID'
  );
});

test('confirming a credit bought by another account is refused', async () => {
  await assert.rejects(
    () => confirmCredit({
      sessionId: SESSION_ID,
      expectedUserId: OTHER_USER,
      client: fakeClient(),
      database: fakeDatabase(routes()),
      priceId: PRICE_ID
    }),
    error => error.status === 409
  );
});

test('a refunded credit is reported as unpaid instead of reopened', async () => {
  const result = await confirmCredit({
    sessionId: SESSION_ID,
    expectedUserId: USER,
    client: fakeClient(),
    database: fakeDatabase(routes({
      creditBySession: [{id: CREDIT, status: 'refunded', user_id: USER, environment: 'test'}]
    })),
    priceId: PRICE_ID
  });

  assert.equal(result.paid, false);
  assert.equal(result.refunded, true);
});

// ---- claim ----------------------------------------------------------------

test('the first completed scan spends the open credit and grants access', async () => {
  const database = fakeDatabase(routes({openCredits: [openCredit()]}));

  const result = await claimCredit({scanId: SCAN, user: {id: USER}, database, mode: 'test'});

  assert.equal(result.available, true);
  assert.equal(result.claimed, true);
  assert.equal(result.paid, true);
  assert.equal(result.scanId, SCAN);
  assert.equal(result.entitlementId, ENTITLEMENT);

  const purchase = database.calls.find(call => call.path === 'content_decay_purchases');
  assert.ok(purchase, 'the purchase is recorded against the scan');
  assert.equal(purchase.options.body.scan_id, SCAN);
  assert.equal(purchase.options.body.stripe_session_id, SESSION_ID);
  assert.equal(purchase.options.body.test_run_id, TEST_RUN);

  const closed = database.calls.find(
    call => call.path.startsWith('content_decay_report_credits?id=eq.') && call.options.method === 'PATCH');
  assert.ok(closed, 'the credit is closed');
  assert.equal(closed.options.body.status, 'claimed');
  assert.equal(closed.options.body.claimed_scan_id, SCAN);
});

test('a scan with no open credit claims nothing and records no purchase', async () => {
  const database = fakeDatabase(routes({openCredits: []}));

  const result = await claimCredit({scanId: SCAN, user: {id: USER}, database, mode: 'test'});

  assert.deepEqual(result, {available: false});
  assert.equal(database.calls.some(call => call.path === 'content_decay_purchases'), false);
});

test('a scan that already has access is not charged a second credit', async () => {
  const database = fakeDatabase(routes({
    entitlements: [{id: ENTITLEMENT, purchase_id: PURCHASE, environment: 'test', expires_at: null}],
    openCredits: [openCredit()]
  }));

  const result = await claimCredit({scanId: SCAN, user: {id: USER}, database, mode: 'test'});

  assert.equal(result.claimed, true);
  assert.equal(result.alreadyPurchased, true);
  assert.equal(database.calls.some(call => call.path === 'content_decay_purchases'), false);
  assert.equal(database.calls.some(
    call => call.path.startsWith('content_decay_report_credits?id=eq.') && call.options.method === 'PATCH'), false);
});

test('a credit is never applied to another account\'s scan', async () => {
  const database = fakeDatabase(routes({scan: scan({user_id: OTHER_USER}), openCredits: [openCredit()]}));

  await assert.rejects(
    () => claimCredit({scanId: SCAN, user: {id: USER}, database, mode: 'test'}),
    error => error.status === 403 && error.code === 'CONTENT_DECAY_SCAN_NOT_OWNED'
  );
  assert.equal(database.calls.some(call => call.path === 'content_decay_purchases'), false);
});

// ---- webhook --------------------------------------------------------------

test('a credit checkout webhook records the credit without looking for a scan', async () => {
  const database = fakeDatabase(routes());
  const checked = [];
  const wrapped = async (path, options) => {
    checked.push(path);
    return database(path, options);
  };
  wrapped.calls = checked;

  const handled = await handleWebhook({
    id: EVENT_ID,
    type: 'checkout.session.completed',
    livemode: false,
    data: {object: creditSession()}
  }, {
    client: fakeClient(),
    database: wrapped,
    priceId: PRICE_ID,
    environment: 'test'
  });

  assert.equal(handled, true);
  assert.equal(checked.some(path => path.startsWith('content_decay_scans')), false,
    'a credit session has no scan to look up');
  assert.ok(checked.includes('content_decay_report_credits'));
});

test('a refund before the credit is spent voids it', async () => {
  const database = fakeDatabase(routes({credit: {id: CREDIT, status: 'open', user_id: USER, environment: 'test'}}));

  const handled = await handleWebhook({
    id: EVENT_ID,
    type: 'charge.refunded',
    livemode: false,
    data: {
      object: {
        id: 'ch_test_credit1',
        livemode: false,
        payment_intent: 'pi_test_credit1',
        amount_refunded: REPORT_AMOUNT
      }
    }
  }, {
    client: fakeClient(),
    database,
    priceId: PRICE_ID,
    environment: 'test'
  });

  assert.equal(handled, true);
  const voided = database.calls.find(
    call => call.path.startsWith('content_decay_report_credits?id=eq.') && call.options.method === 'PATCH');
  assert.ok(voided, 'the open credit is voided');
  assert.equal(voided.options.body.status, 'refunded');
});

// ---- one open credit per buyer --------------------------------------------

// A database that enforces the partial unique index from
// database/15-content-decay-credit-reservation.sql, so these tests exercise the
// guarantee instead of a stub that always answers yes.
function creditStore(seed = []) {
  const rows = seed.map(row => ({...row}));
  let serial = 0;

  const database = async (path, options = {}) => {
    const method = options.method || 'GET';

    if (path === 'content_decay_report_credits' && method === 'POST') {
      const body = options.body;
      const clash = rows.find(row => row.user_id === body.user_id
        && row.environment === body.environment
        && (row.status === 'pending' || row.status === 'open'));
      if (clash) {
        throw Object.assign(
          new Error('duplicate key value violates unique constraint "content_decay_report_credits_one_open_idx"'),
          {code: '23505', status: 409}
        );
      }
      serial += 1;
      const row = {
        id: '777777' + String(serial).padStart(2, '0') + '-7777-4777-8777-777777777777',
        stripe_session_id: null,
        checkout_url: null,
        created_at: new Date().toISOString(),
        ...body
      };
      rows.push(row);
      return [row];
    }

    const idMatch = /content_decay_report_credits\?id=eq\.([^&#]+)/.exec(path);
    if (idMatch) {
      const row = rows.find(item => item.id === decodeURIComponent(idMatch[1]));
      if (method === 'PATCH') {
        const wanted = /status=eq\.([a-z]+)/.exec(path);
        if (!row || (wanted && row.status !== wanted[1])) return [];
        Object.assign(row, options.body);
        return [row];
      }
      return row ? [row] : [];
    }

    if (path.startsWith('content_decay_report_credits?stripe_session_id=eq.')) {
      const id = decodeURIComponent(
        path.slice('content_decay_report_credits?stripe_session_id=eq.'.length).split('&')[0]
      );
      const row = rows.find(item => item.stripe_session_id === id);
      return row ? [row] : [];
    }

    if (path.startsWith('content_decay_report_credits?user_id=eq.')) {
      const wanted = /status=(?:eq|in)\.\(?([a-z,]+)\)?/.exec(path);
      const states = wanted ? wanted[1].split(',') : [];
      return rows.filter(row => !states.length || states.includes(row.status));
    }

    if (path.startsWith('content_decay_scans?id=eq.')) return [scan()];
    if (path.startsWith('content_decay_entitlements?')) return [];
    throw new Error('Unexpected database path: ' + path);
  };

  database.rows = rows;
  return database;
}

test('an insert refused by the one-open-credit index reuses the winner instead of paying', async () => {
  const winner = openCredit({
    status: 'pending',
    checkout_url: 'https://checkout.stripe.com/c/pay/credit',
    created_at: new Date().toISOString()
  });
  let sessions = 0;
  let reads = 0;
  const client = fakeClient({
    createCheckoutSession: async () => {
      sessions += 1;
      return {id: SESSION_ID, url: 'https://checkout.stripe.com/c/pay/credit'};
    }
  });
  // Both attempts read "no credit"; the second insert is refused by the index.
  const database = fakeDatabase(path => {
    if (path === 'content_decay_report_credits') {
      throw Object.assign(
        new Error('duplicate key value violates unique constraint "content_decay_report_credits_one_open_idx"'),
        {code: '23505'}
      );
    }
    if (path.includes('status=in.(pending,open)')) {
      reads += 1;
      return reads === 1 ? [] : [winner];
    }
    throw new Error('Unexpected database path: ' + path);
  });

  const result = await createCreditCheckout({
    user: {id: USER, email: 'buyer@example.com'},
    client,
    database,
    mode: 'test',
    priceId: PRICE_ID,
    origin: 'https://aegeosearch.com'
  });

  assert.equal(result.alreadyCredited, true);
  assert.equal(result.checkoutUrl, 'https://checkout.stripe.com/c/pay/credit');
  assert.equal(sessions, 0, 'the attempt that lost the race must not create a payment');
});

test('a second attempt resumes the unpaid checkout instead of starting another payment', async () => {
  const store = creditStore();
  let sessions = 0;
  const client = fakeClient({
    createCheckoutSession: async () => {
      sessions += 1;
      return {id: SESSION_ID, url: 'https://checkout.stripe.com/c/pay/credit'};
    }
  });
  const open = () => createCreditCheckout({
    user: {id: USER, email: 'buyer@example.com'},
    client,
    database: store,
    mode: 'test',
    priceId: PRICE_ID,
    origin: 'https://aegeosearch.com'
  });

  const first = await open();
  const second = await open();

  assert.equal(first.credit, true);
  assert.equal(second.alreadyCredited, true);
  assert.equal(second.checkoutUrl, first.url, 'the buyer is sent to the checkout they already have');
  assert.equal(sessions, 1, 'only one payment was ever created');
  assert.equal(store.rows.length, 1, 'the buyer holds one credit, not two');
});

test('two simultaneous checkouts create one payment and one credit', async () => {
  const store = creditStore();
  let sessions = 0;
  const client = fakeClient({
    createCheckoutSession: async () => {
      sessions += 1;
      // Hold the first call open so both attempts overlap in the way two tabs do.
      await new Promise(resolve => setTimeout(resolve, 5));
      return {id: SESSION_ID + sessions, url: 'https://checkout.stripe.com/c/pay/credit' + sessions};
    }
  });
  const open = () => createCreditCheckout({
    user: {id: USER, email: 'buyer@example.com'},
    client,
    database: store,
    mode: 'test',
    priceId: PRICE_ID,
    origin: 'https://aegeosearch.com'
  });

  const results = await Promise.all([open(), open()]);

  assert.equal(sessions, 1, 'two tabs must not create two payments');
  assert.equal(store.rows.length, 1, 'two tabs must not create two credits');
  assert.equal(store.rows[0].status, 'pending');
  assert.equal(results.filter(result => result.alreadyCredited).length, 1,
    'the losing attempt is answered with the existing checkout');
});

test('an abandoned checkout is expired and replaced instead of blocking the buyer', async () => {
  const abandoned = openCredit({
    status: 'pending',
    stripe_session_id: 'cs_test_abandoned1',
    checkout_url: 'https://checkout.stripe.com/c/pay/old',
    created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
  });
  const store = creditStore([abandoned]);
  const expired = [];
  const client = fakeClient({
    expireSession: async id => {
      expired.push(id);
      return {id, status: 'expired'};
    },
    createCheckoutSession: async () => ({id: SESSION_ID, url: 'https://checkout.stripe.com/c/pay/credit'})
  });

  const result = await createCreditCheckout({
    user: {id: USER, email: 'buyer@example.com'},
    client,
    database: store,
    mode: 'test',
    priceId: PRICE_ID,
    origin: 'https://aegeosearch.com'
  });

  assert.equal(result.credit, true);
  assert.deepEqual(expired, ['cs_test_abandoned1'], 'the old payment link cannot be paid');
  assert.equal(store.rows.filter(row => row.status === 'expired').length, 1);
  assert.equal(store.rows.filter(row => row.status === 'pending').length, 1,
    'exactly one usable attempt remains');
});

test('a session whose reservation moved on is expired instead of handed back', async () => {
  const expired = [];
  const client = fakeClient({
    expireSession: async id => {
      expired.push(id);
      return {id, status: 'expired'};
    },
    createCheckoutSession: async () => ({id: SESSION_ID, url: 'https://checkout.stripe.com/c/pay/credit'})
  });
  // The filtered update matched nothing: the reservation was voided in between.
  const database = fakeDatabase(routes({reservationUpdate: []}));

  await assert.rejects(
    () => createCreditCheckout({
      user: {id: USER, email: 'buyer@example.com'},
      client,
      database,
      mode: 'test',
      priceId: PRICE_ID,
      origin: 'https://aegeosearch.com'
    }),
    error => error.status === 409 && error.code === 'CONTENT_DECAY_CREDIT_RESERVATION_LOST'
  );

  assert.deepEqual(expired, [SESSION_ID], 'the payment link is ended, not returned');
});

test('a reservation that is no longer pending cannot receive a payment link', async () => {
  const expired = [];
  const client = fakeClient({
    expireSession: async id => {
      expired.push(id);
      return {id, status: 'expired'};
    },
    createCheckoutSession: async () => ({id: SESSION_ID, url: 'https://checkout.stripe.com/c/pay/credit'})
  });
  const database = fakeDatabase(routes({
    reservationUpdate: [{id: CREDIT, status: 'refunded', stripe_session_id: SESSION_ID}]
  }));

  await assert.rejects(
    () => createCreditCheckout({
      user: {id: USER, email: 'buyer@example.com'},
      client,
      database,
      mode: 'test',
      priceId: PRICE_ID,
      origin: 'https://aegeosearch.com'
    }),
    error => error.status === 409 && error.code === 'CONTENT_DECAY_CREDIT_RESERVATION_LOST'
  );

  assert.deepEqual(expired, [SESSION_ID], 'a refunded reservation never gets a payable link');
});

test('an unpaid reservation is not a credit the buyer can use', async () => {
  const store = creditStore([openCredit({status: 'pending'})]);

  const available = await openCreditFor({user: {id: USER}, database: store, mode: 'test'});
  assert.equal(available.available, false, 'a checkout that was not paid is never a credit');

  const claimed = await claimCredit({scanId: SCAN, user: {id: USER}, database: store, mode: 'test'});
  assert.deepEqual(claimed, {available: false});
});

test('a paid reservation becomes the open credit instead of a second row', async () => {
  const reserved = openCredit({
    id: CREDIT,
    user_id: USER,
    environment: 'test',
    status: 'pending',
    stripe_session_id: SESSION_ID,
    stripe_payment_intent: null,
    amount_total: null
  });
  const store = creditStore([reserved]);
  const client = fakeClient({
    retrieveSession: async () => creditSession({metadata: {...creditSession().metadata, credit_id: CREDIT}})
  });

  const result = await confirmCredit({
    sessionId: SESSION_ID,
    expectedUserId: USER,
    client,
    database: store,
    priceId: PRICE_ID
  });

  assert.equal(result.paid, true);
  assert.equal(store.rows.length, 1, 'the reservation is the credit, not a duplicate');
  assert.equal(store.rows[0].status, 'open');
  assert.equal(store.rows[0].stripe_payment_intent, 'pi_test_credit1');
  assert.equal(store.rows[0].amount_total, REPORT_AMOUNT);
});
