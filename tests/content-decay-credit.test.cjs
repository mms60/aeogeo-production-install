'use strict';

// Offline tests for buying the $49 report before a scan exists. Stripe and the
// database are injected fakes, so no credentials, network or live database is
// involved. The report flow itself stays covered in
// content-decay-purchases.test.cjs.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createCheckout,
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

const reportSession = (overrides = {}) => creditSession({
  id: 'cs_test_report1',
  metadata: {
    product: 'content_decay',
    scan_id: SCAN,
    user_id: USER,
    environment: 'test'
  },
  ...overrides
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
  created_at: new Date().toISOString(),
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
    // Answer for reopening a disputed purchase; undefined keeps the default.
    purchaseRestore: undefined,
    ...overrides
  };
  return (path, options = {}) => {
    if (path.startsWith('content_decay_scans?id=eq.')) return config.scan ? [config.scan] : [];
    if (path.startsWith('content_decay_entitlements?')) return config.entitlements;
    if (path.startsWith('content_decay_purchases?stripe_session_id=eq.')) return config.purchases;
    if (path.startsWith('content_decay_purchases?stripe_payment_intent=eq.')) return config.intentPurchases;
    if (path.startsWith('content_decay_purchases?id=eq.')) {
      if (config.purchaseRestore !== undefined) return config.purchaseRestore;
      return [{id: PURCHASE, status: 'paid', ...(options.body || {})}];
    }
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
    if (path === 'rpc/content_decay_dispute_purchase') return PURCHASE;
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

const APPROVED_PRICE = 'price_1UfLY5BIJX5f6Wmhc3WdQqsr';
const STALE_PRICE = 'price_1UdvRBBIJX5f6Wmhm4uU56Zj';

test('a stale configured price sells at the approved price and says so', async () => {
  let params;
  const client = fakeClient({
    retrievePrice: async id => (id === STALE_PRICE
      ? {id: STALE_PRICE, active: false, type: 'one_time', currency: 'usd', unit_amount: 1999, livemode: true}
      : {id: APPROVED_PRICE, active: true, type: 'one_time', currency: 'usd', unit_amount: REPORT_AMOUNT, livemode: true}),
    createCheckoutSession: async data => {
      params = data;
      return {id: SESSION_ID, url: 'https://checkout.stripe.com/c/pay/credit'};
    }
  });

  const result = await createCreditCheckout({
    user: {id: USER, email: 'buyer@example.com'},
    client,
    database: fakeDatabase(routes()),
    mode: 'live',
    priceId: STALE_PRICE,
    origin: 'https://aegeosearch.com'
  });

  assert.equal(params['line_items[0][price]'], APPROVED_PRICE,
    'the inactive $19.99 price is never charged');
  assert.equal(result.configuredPriceId, STALE_PRICE);
  assert.match(result.priceNotice, new RegExp(STALE_PRICE));
  assert.match(result.priceNotice, new RegExp(APPROVED_PRICE));
});

test('a configured price Stripe cannot read also falls back to the approved price', async () => {
  let params;
  const client = fakeClient({
    retrievePrice: async id => {
      if (id === STALE_PRICE) {
        throw Object.assign(new Error('No such price'), {status: 503, code: 'CONTENT_DECAY_STRIPE_REQUEST'});
      }
      return {id: APPROVED_PRICE, active: true, type: 'one_time', currency: 'usd', unit_amount: REPORT_AMOUNT, livemode: true};
    },
    createCheckoutSession: async data => {
      params = data;
      return {id: SESSION_ID, url: 'https://checkout.stripe.com/c/pay/credit'};
    }
  });

  const result = await createCreditCheckout({
    user: {id: USER, email: 'buyer@example.com'},
    client,
    database: fakeDatabase(routes()),
    mode: 'live',
    priceId: STALE_PRICE,
    origin: 'https://aegeosearch.com'
  });

  assert.equal(params['line_items[0][price]'], APPROVED_PRICE);
  assert.match(result.priceNotice, new RegExp(STALE_PRICE));
});

test('a valid configured price is used without a notice', async () => {
  const result = await createCreditCheckout({
    user: {id: USER, email: 'buyer@example.com'},
    client: fakeClient(),
    database: fakeDatabase(routes()),
    mode: 'test',
    priceId: PRICE_ID,
    origin: 'https://aegeosearch.com'
  });

  assert.equal(result.credit, true);
  assert.equal(result.priceNotice, undefined);
});

test('a payment at the approved price is accepted when the configured price was stale', async () => {
  const session = creditSession({
    livemode: true,
    metadata: {...creditSession().metadata, environment: 'live', credit_id: CREDIT},
    line_items: {data: [{quantity: 1, price: {id: APPROVED_PRICE}}]}
  });
  const store = creditStore([openCredit({
    id: CREDIT,
    user_id: USER,
    environment: 'live',
    status: 'pending',
    stripe_session_id: SESSION_ID
  })]);

  const result = await confirmCredit({
    sessionId: SESSION_ID,
    expectedUserId: USER,
    client: fakeClient({retrieveSession: async () => session}),
    database: store,
    priceId: STALE_PRICE
  });

  assert.equal(result.paid, true, 'a buyer who paid the approved price keeps their credit');
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
    database: fakeDatabase(routes({creditRows: [openCredit({created_at: '2026-11-25T10:00:00.000Z'})]})),
    mode: 'test'
  });

  assert.equal(found.available, true);
  assert.equal(found.creditId, CREDIT);
  assert.equal(found.amountTotal, REPORT_AMOUNT);
  assert.equal(found.currency, 'usd');

  const empty = await openCreditFor({
    user: {id: USER},
    database: fakeDatabase(routes({creditRows: []})),
    mode: 'test'
  });
  assert.deepEqual(empty, {available: false, pending: false});
});

test('the page is told about an unpaid checkout it can continue', async () => {
  const state = await openCreditFor({
    user: {id: USER},
    database: fakeDatabase(routes({
      creditRows: [openCredit({
        status: 'pending',
        checkout_url: 'https://checkout.stripe.com/c/pay/credit'
      })]
    })),
    mode: 'test'
  });

  assert.equal(state.available, false, 'an unpaid checkout is not a credit yet');
  assert.equal(state.pending, true);
  assert.equal(state.checkoutUrl, 'https://checkout.stripe.com/c/pay/credit');
  assert.equal(state.creditId, CREDIT);
  assert.ok(state.checkoutExpiresInSeconds > 0, 'the page is told when the link stops working');
  assert.ok(state.checkoutExpiresInSeconds <= 58 * 60, 'the offer ends before the session does');
});

test('an unpaid checkout without a link yet reports no url', async () => {
  const state = await openCreditFor({
    user: {id: USER},
    database: fakeDatabase(routes({
      creditRows: [openCredit({status: 'pending', checkout_url: null})]
    })),
    mode: 'test'
  });

  assert.equal(state.pending, true);
  assert.equal(state.checkoutUrl, null, 'the page never invents a payment link');
});

test('a paid credit is reported ahead of an unpaid checkout', async () => {
  const state = await openCreditFor({
    user: {id: USER},
    database: fakeDatabase(routes({
      creditRows: [
        openCredit({status: 'pending', checkout_url: 'https://checkout.stripe.com/c/pay/credit'}),
        openCredit({id: '88888888-8888-4888-8888-888888888888', status: 'open'})
      ]
    })),
    mode: 'test'
  });

  assert.equal(state.available, true);
  assert.equal(state.creditId, '88888888-8888-4888-8888-888888888888');
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
        amount: REPORT_AMOUNT,
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

test('a failed price check gives the reservation back so the next attempt works', async () => {
  const database = fakeDatabase(routes());
  let sessions = 0;
  const client = fakeClient({
    retrievePrice: async () => ({
      id: PRICE_ID, active: false, type: 'one_time', currency: 'usd', unit_amount: 1999, livemode: false
    }),
    createCheckoutSession: async () => {
      sessions += 1;
      return {id: SESSION_ID, url: 'https://checkout.stripe.com/c/pay/credit'};
    }
  });

  await assert.rejects(
    () => createCreditCheckout({
      user: {id: USER, email: 'buyer@example.com'},
      client,
      database,
      mode: 'test',
      priceId: PRICE_ID,
      origin: 'https://aegeosearch.com'
    }),
    error => error.status === 503 && error.code === 'CONTENT_DECAY_PRICE_MISMATCH'
  );

  assert.equal(sessions, 0, 'no payment is created for a price that is not the $49 report');
  const released = database.calls.find(
    call => call.path.startsWith('content_decay_report_credits?id=eq.') && call.options.method === 'PATCH');
  assert.ok(released, 'the reservation is given back');
  assert.equal(released.options.body.status, 'expired', 'a blocked buyer is not locked out');
});

test('a reservation with no payment link is reclaimed instead of blocking', async () => {
  const failed = openCredit({
    status: 'pending',
    stripe_session_id: null,
    checkout_url: null,
    created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString()
  });
  const store = creditStore([failed]);
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

  assert.equal(result.credit, true, 'the buyer can buy again after a failed attempt');
  assert.deepEqual(expired, [], 'there was no payment link to expire');
  assert.equal(store.rows.filter(row => row.status === 'expired').length, 1);
  assert.equal(store.rows.filter(row => row.status === 'pending').length, 1);
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

// ---- a scan checkout never charges a buyer who already paid ----------------

test('buying the report for a scan spends an open credit instead of charging again', async () => {
  let sessions = 0;
  const client = fakeClient({
    createCheckoutSession: async () => {
      sessions += 1;
      return {id: SESSION_ID, url: 'https://checkout.stripe.com/c/pay/credit'};
    }
  });
  const database = fakeDatabase(routes({
    creditRows: [openCredit()],
    openCredits: [openCredit()]
  }));

  const result = await createCheckout({
    scanId: SCAN,
    user: {id: USER, email: 'buyer@example.com'},
    client,
    database,
    mode: 'test',
    priceId: PRICE_ID,
    origin: 'https://aegeosearch.com'
  });

  assert.equal(result.alreadyPurchased, true, 'the paid credit is spent, not sold again');
  assert.equal(result.claimed, true);
  assert.equal(result.entitlementId, ENTITLEMENT);
  assert.equal(sessions, 0, 'no second payment is created for an already-paid report');
  const purchase = database.calls.find(call => call.path === 'content_decay_purchases');
  assert.ok(purchase, 'the purchase is recorded against the scan');
  assert.equal(purchase.options.body.scan_id, SCAN);
});

test('a scan checkout continues the unpaid checkout it already has', async () => {
  let sessions = 0;
  const client = fakeClient({
    createCheckoutSession: async () => {
      sessions += 1;
      return {id: SESSION_ID, url: 'https://checkout.stripe.com/c/pay/credit'};
    }
  });
  const database = fakeDatabase(routes({
    creditRows: [openCredit({status: 'pending', checkout_url: 'https://checkout.stripe.com/c/pay/credit'})]
  }));

  const result = await createCheckout({
    scanId: SCAN,
    user: {id: USER},
    client,
    database,
    mode: 'test',
    priceId: PRICE_ID,
    origin: 'https://aegeosearch.com'
  });

  assert.equal(result.pending, true);
  assert.equal(result.checkoutUrl, 'https://checkout.stripe.com/c/pay/credit');
  assert.equal(sessions, 0, 'an open payment is resumed, never duplicated');
});

test('a reservation still being created blocks a second payment instead of charging', async () => {
  let sessions = 0;
  const client = fakeClient({
    createCheckoutSession: async () => {
      sessions += 1;
      return {id: SESSION_ID, url: 'https://checkout.stripe.com/c/pay/credit'};
    }
  });
  const database = fakeDatabase(routes({
    creditRows: [openCredit({status: 'pending', checkout_url: null, stripe_session_id: null})]
  }));

  await assert.rejects(
    () => createCheckout({
      scanId: SCAN,
      user: {id: USER},
      client,
      database,
      mode: 'test',
      priceId: PRICE_ID,
      origin: 'https://aegeosearch.com'
    }),
    error => error.status === 409 && error.code === 'CONTENT_DECAY_CREDIT_PENDING'
  );
  assert.equal(sessions, 0, 'a second payment is never created');
});

// ---- a continue link is never handed out after its session lapses -----------

test('a lapsed checkout is not offered as continuable', async () => {
  // The gap this covers: the session lapsed at 60 minutes, and the page used to
  // keep offering it until 65.
  const lapsed = openCredit({
    status: 'pending',
    checkout_url: 'https://checkout.stripe.com/c/pay/lapsed',
    created_at: new Date(Date.now() - 62 * 60 * 1000).toISOString()
  });
  const store = creditStore([lapsed]);
  const expired = [];
  const client = fakeClient({
    expireSession: async id => {
      expired.push(id);
      return {id, status: 'expired'};
    }
  });

  const page = await openCreditFor({user: {id: USER}, database: store, mode: 'test', client});

  assert.deepEqual(page, {available: false, pending: false},
    'the page is never pointed at a session Stripe has already expired');
  assert.deepEqual(expired, [SESSION_ID], 'the lapsed session is ended at Stripe');
  assert.equal(store.rows[0].status, 'expired', 'the reservation no longer blocks a fresh checkout');
});

test('a checkout lapsed in the 60 to 65 minute gap starts a fresh payment', async () => {
  const lapsed = openCredit({
    status: 'pending',
    checkout_url: 'https://checkout.stripe.com/c/pay/lapsed',
    created_at: new Date(Date.now() - 61 * 60 * 1000).toISOString()
  });
  const store = creditStore([lapsed]);
  const expired = [];
  const client = fakeClient({
    expireSession: async id => {
      expired.push(id);
      return {id, status: 'expired'};
    },
    createCheckoutSession: async () => ({id: 'cs_test_fresh1', url: 'https://checkout.stripe.com/c/pay/fresh'})
  });

  const result = await createCreditCheckout({
    user: {id: USER, email: 'buyer@example.com'},
    client,
    database: store,
    mode: 'test',
    priceId: PRICE_ID,
    origin: 'https://aegeosearch.com'
  });

  assert.equal(result.credit, true, 'a fresh checkout replaces the dead link');
  assert.equal(result.url, 'https://checkout.stripe.com/c/pay/fresh');
  assert.deepEqual(expired, [SESSION_ID]);
  assert.equal(store.rows.filter(row => row.status === 'expired').length, 1);
  assert.equal(store.rows.filter(row => row.status === 'pending').length, 1);
});

test('a reservation with no session and no link is released instead of blocking', async () => {
  const stale = openCredit({
    status: 'pending',
    checkout_url: null,
    stripe_session_id: null,
    created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString()
  });
  const store = creditStore([stale]);
  const expired = [];
  const client = fakeClient({
    expireSession: async id => {
      expired.push(id);
      return {id, status: 'expired'};
    }
  });

  const page = await openCreditFor({user: {id: USER}, database: store, mode: 'test', client});

  assert.deepEqual(page, {available: false, pending: false});
  assert.deepEqual(expired, [], 'there was no Stripe session to end');
  assert.equal(store.rows[0].status, 'expired');
});

// ---- a spent credit is never offered again --------------------------------

test('a claim that cannot close the credit still grants the report, and the next load repairs it', async () => {
  const database = fakeDatabase(routes({openCredits: [openCredit()]}));
  let closes = 0;
  const wrapped = async (path, options = {}) => {
    if (path.startsWith('content_decay_report_credits?id=eq.') && options.method === 'PATCH') {
      closes += 1;
      return []; // the close is lost
    }
    return database(path, options);
  };

  const result = await claimCredit({scanId: SCAN, user: {id: USER}, database: wrapped, mode: 'test'});

  assert.equal(result.claimed, true, 'the buyer keeps the report they paid for');
  assert.equal(result.creditClosed, false);
  assert.equal(closes, 2, 'the close is retried once');

  // The purchase the claim wrote is proof the credit was spent, so the next
  // page load must close it instead of advertising it as waiting.
  const store = fakeDatabase(routes({
    creditRows: [openCredit()],
    purchases: [{id: PURCHASE, status: 'paid', user_id: USER, scan_id: SCAN}]
  }));

  const page = await openCreditFor({user: {id: USER}, database: store, mode: 'test'});

  assert.deepEqual(page, {available: false, pending: false}, 'a spent credit is never offered again');
  const repaired = store.calls.find(call =>
    call.path.startsWith('content_decay_report_credits?id=eq.') && call.options.method === 'PATCH');
  assert.ok(repaired, 'the stale open credit is closed');
  assert.equal(repaired.options.body.status, 'claimed');
  assert.equal(repaired.options.body.purchase_id, PURCHASE);
  assert.equal(repaired.options.body.claimed_scan_id, SCAN);
});

// ---- a lapsed Stripe session ----------------------------------------------

test('a session Stripe expires closes its reservation without waiting for a page load', async () => {
  const database = fakeDatabase(routes({creditBySession: [openCredit({status: 'pending'})]}));

  const handled = await handleWebhook({
    id: EVENT_ID,
    type: 'checkout.session.expired',
    livemode: false,
    data: {object: creditSession({status: 'expired', payment_status: 'unpaid'})}
  }, {client: fakeClient(), database, priceId: PRICE_ID, environment: 'test'});

  assert.equal(handled, true);
  const expired = database.calls.find(call =>
    call.path.startsWith('content_decay_report_credits?stripe_session_id=eq.')
    && call.options.method === 'PATCH');
  assert.ok(expired, 'the reservation is ended at the source of truth');
  assert.equal(expired.options.body.status, 'expired');
  assert.match(expired.path, /status=eq\.pending$/, 'a paid or refunded row is never expired');
});

test('a lapsed report checkout has no reservation to expire', async () => {
  const database = fakeDatabase(routes());

  const handled = await handleWebhook({
    id: EVENT_ID,
    type: 'checkout.session.expired',
    livemode: false,
    data: {object: reportSession({status: 'expired', payment_status: 'unpaid'})}
  }, {client: fakeClient(), database, priceId: PRICE_ID, environment: 'test'});

  assert.equal(handled, false);
  assert.equal(database.calls.length, 0);
});

// ---- a won dispute --------------------------------------------------------

const disputedPurchase = (overrides = {}) => ({
  id: PURCHASE,
  status: 'revoked',
  user_id: USER,
  scan_id: SCAN,
  environment: 'test',
  test_run_id: TEST_RUN,
  ...overrides
});

const disputeClosedEvent = (status, overrides = {}) => ({
  id: 'evt_test_disputeclosed1',
  type: 'charge.dispute.closed',
  livemode: false,
  data: {
    object: {
      id: 'dp_test_closed1',
      object: 'dispute',
      livemode: false,
      status,
      payment_intent: 'pi_test_credit1',
      ...overrides
    }
  }
});

test('a dispute the seller wins restores the purchase and its entitlement', async () => {
  const database = fakeDatabase(routes({intentPurchases: [disputedPurchase()]}));

  const handled = await handleWebhook(disputeClosedEvent('won'), {
    client: fakeClient(),
    database,
    priceId: PRICE_ID,
    environment: 'test'
  });

  assert.equal(handled, true);
  const restored = database.calls.find(call =>
    call.path.startsWith('content_decay_purchases?id=eq.') && call.options.method === 'PATCH');
  assert.ok(restored, 'the revoked purchase is reopened');
  assert.match(restored.path, /status=eq\.revoked$/, 'only a revoked purchase is reopened');
  assert.equal(restored.options.body.status, 'paid');
  const grant = database.calls.find(call => call.path === 'rpc/content_decay_grant_entitlement');
  assert.deepEqual(grant.options.body, {p_purchase: PURCHASE});
});

test('a dispute that was lost stays revoked', async () => {
  const database = fakeDatabase(routes({intentPurchases: [disputedPurchase()]}));

  const handled = await handleWebhook(disputeClosedEvent('lost'), {
    client: fakeClient(),
    database,
    priceId: PRICE_ID,
    environment: 'test'
  });

  assert.equal(handled, true);
  assert.ok(database.calls.some(call => call.path === 'rpc/content_decay_dispute_purchase'));
  assert.equal(database.calls.some(call => call.path === 'rpc/content_decay_grant_entitlement'), false);
});

test('a refunded purchase is never reopened by a won dispute', async () => {
  const database = fakeDatabase(routes({
    intentPurchases: [disputedPurchase({status: 'refunded'})],
    purchaseRestore: [] // the status=eq.revoked filter changes no row
  }));

  const handled = await handleWebhook(disputeClosedEvent('won'), {
    client: fakeClient(),
    database,
    priceId: PRICE_ID,
    environment: 'test'
  });

  assert.equal(handled, true);
  assert.equal(database.calls.some(call => call.path === 'rpc/content_decay_grant_entitlement'), false);
});

// ---- duplicate sessions ---------------------------------------------------

test('a credit checkout is tied to its reservation by an idempotency key', async () => {
  let options;
  const client = fakeClient({
    createCheckoutSession: async (data, opts) => {
      options = opts;
      return {id: SESSION_ID, url: 'https://checkout.stripe.com/c/pay/credit'};
    }
  });

  await createCreditCheckout({
    user: {id: USER, email: 'buyer@example.com'},
    client,
    database: fakeDatabase(routes()),
    mode: 'test',
    priceId: PRICE_ID,
    origin: 'https://aegeosearch.com'
  });

  assert.equal(options.idempotency, 'content-decay-credit-' + CREDIT);
});

test('two report checkouts in the same minute share one idempotency key', async () => {
  const keys = [];
  const client = fakeClient({
    createCheckoutSession: async (data, opts) => {
      keys.push(opts.idempotency);
      return {id: 'cs_test_report9', url: 'https://checkout.stripe.com/c/pay/report'};
    }
  });
  const database = fakeDatabase(routes());
  const options = {client, database, mode: 'test', priceId: PRICE_ID, origin: 'https://aegeosearch.com'};

  await createCheckout({scanId: SCAN, user: {id: USER}, ...options});
  await createCheckout({scanId: SCAN, user: {id: USER}, ...options});

  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1], 'a repeated submit is the same payment intent');
  assert.match(keys[0], new RegExp('^content-decay-report-' + SCAN + '-\\d+$'));
});
