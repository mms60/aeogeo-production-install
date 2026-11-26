'use strict';

// Offline tests for Phase 5. Stripe and the database are injected fakes, so no
// credentials, network or live database are involved.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pricePreflight,
  createCheckout,
  confirmSession,
  entitlementFor,
  handleWebhook,
  REPORT_AMOUNT
} = require('../netlify/functions/lib/content-decay-purchases');

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '99999999-9999-4999-8999-999999999999';
const SCAN = '22222222-2222-4222-8222-222222222222';
const TEST_RUN = '33333333-3333-4333-8333-333333333333';
const PURCHASE = '44444444-4444-4444-8444-444444444444';
const ENTITLEMENT = '55555555-5555-4555-8555-555555555555';
const PRICE_ID = 'price_test_123';
const SESSION_ID = 'cs_test_abc123';
const EVENT_ID = 'evt_test_abc12345';

const price = overrides => ({
  id: PRICE_ID,
  active: true,
  type: 'one_time',
  currency: 'usd',
  unit_amount: REPORT_AMOUNT,
  livemode: false,
  ...overrides
});

const session = overrides => ({
  id: SESSION_ID,
  mode: 'payment',
  status: 'complete',
  payment_status: 'paid',
  amount_total: REPORT_AMOUNT,
  currency: 'usd',
  livemode: false,
  metadata: {
    product: 'content_decay',
    scan_id: SCAN,
    user_id: USER,
    environment: 'test'
  },
  line_items: {data: [{quantity: 1, price: {id: PRICE_ID}}]},
  customer_details: {email: 'buyer@example.com'},
  payment_intent: 'pi_test_1',
  ...overrides
});

const scan = overrides => ({
  id: SCAN,
  user_id: USER,
  status: 'completed',
  environment: 'test',
  test_run_id: TEST_RUN,
  hostname: 'example.com',
  target_url: 'https://example.com',
  ...overrides
});

function fakeClient(overrides = {}) {
  return {
    retrievePrice: async () => price(),
    retrieveSession: async () => session(),
    createCheckoutSession: async () => ({id: 'cs_test_new1', url: 'https://checkout.stripe.com/c/pay/1'}),
    ...overrides
  };
}

function fakeDatabase(routes) {
  const calls = [];
  const database = async (path, options = {}) => {
    calls.push({path, options});
    return routes(path, options, calls);
  };
  database.calls = calls;
  return database;
}

function defaultRoutes(overrides = {}) {
  const config = {
    scan: scan(),
    entitlements: [],
    purchases: [],
    intentPurchases: [],
    claim: true,
    refund: PURCHASE,
    dispute: PURCHASE,
    creditsByIntent: [],
    creditsByUser: [],
    ...overrides
  };
  return (path, options) => {
    if (path.startsWith('content_decay_scans?id=eq.')) {
      if (options.method === 'PATCH') {
        return config.scan && !config.scan.user_id ? [{...config.scan, ...options.body}] : [];
      }
      return config.scan ? [config.scan] : [];
    }
    if (path.startsWith('content_decay_entitlements?')) return config.entitlements;
    if (path.startsWith('content_decay_purchases?stripe_payment_intent=eq.')) return config.intentPurchases;
    if (path.startsWith('content_decay_purchases?stripe_session_id=eq.')) return config.purchases;
    if (path === 'content_decay_purchases') {
      return [{id: PURCHASE, ...options.body}];
    }
    // A refund or dispute first looks for a purchase, then for an unspent
    // report credit bought before any scan existed.
    if (path.startsWith('content_decay_report_credits?stripe_payment_intent=eq.')) {
      return config.creditsByIntent;
    }
    // A scan checkout first checks whether the buyer already paid for a credit.
    if (path.startsWith('content_decay_report_credits?user_id=eq.')) return config.creditsByUser;
    if (path === 'rpc/content_decay_grant_entitlement') return ENTITLEMENT;
    if (path === 'rpc/content_decay_refund_purchase') return config.refund;
    if (path === 'rpc/content_decay_dispute_purchase') return config.dispute;
    if (path === 'rpc/content_decay_claim_webhook') return config.claim;
    if (path.startsWith('content_decay_webhook_events?id=eq.')) return null;
    throw new Error('Unexpected database path: ' + path);
  };
}

test('price preflight accepts an active one-time USD 49 test price', async () => {
  const result = await pricePreflight({
    priceId: PRICE_ID,
    mode: 'test',
    client: fakeClient()
  });
  assert.deepEqual(result, {id: PRICE_ID, amount: REPORT_AMOUNT, currency: 'usd', livemode: false});
});

test('price preflight rejects a wrong amount, inactive price or wrong mode', async () => {
  for (const bad of [
    price({unit_amount: 1900}),
    price({active: false}),
    price({type: 'recurring'}),
    price({livemode: true})
  ]) {
    const client = fakeClient({retrievePrice: async () => bad});
    await assert.rejects(
      pricePreflight({priceId: PRICE_ID, mode: 'test', client}),
      error => error.code === 'CONTENT_DECAY_PRICE_MISMATCH' && error.status === 503
    );
  }
});

test('checkout sends the fixed price and identity metadata, never an amount', async () => {
  let sent;
  const client = fakeClient({
    createCheckoutSession: async data => {
      sent = data;
      return {id: 'cs_test_new1', url: 'https://checkout.stripe.com/c/pay/1'};
    }
  });
  const result = await createCheckout({
    scanId: SCAN,
    user: {id: USER, email: 'buyer@example.com'},
    client,
    database: fakeDatabase(defaultRoutes()),
    mode: 'test',
    priceId: PRICE_ID,
    origin: 'https://aeogeosearch.com'
  });

  assert.equal(result.sessionId, 'cs_test_new1');
  assert.equal(result.url, 'https://checkout.stripe.com/c/pay/1');
  assert.equal(sent.mode, 'payment');
  assert.equal(sent['line_items[0][price]'], PRICE_ID);
  assert.equal(sent['line_items[0][quantity]'], 1);
  assert.equal(sent['metadata[product]'], 'content_decay');
  assert.equal(sent['metadata[scan_id]'], SCAN);
  assert.equal(sent['metadata[user_id]'], USER);
  assert.equal(sent['metadata[environment]'], 'test');
  assert.equal(sent.customer_email, 'buyer@example.com');
  assert.ok(sent.success_url.startsWith('https://aeogeosearch.com/content-decay/'));
  assert.equal('amount_total' in sent, false);
  assert.equal('amount' in sent, false);
});

test('checkout refuses a scan owned by another account', async () => {
  await assert.rejects(
    createCheckout({
      scanId: SCAN,
      user: {id: USER},
      client: fakeClient(),
      database: fakeDatabase(defaultRoutes({scan: scan({user_id: OTHER_USER})})),
      mode: 'test',
      priceId: PRICE_ID,
      origin: 'https://aeogeosearch.com'
    }),
    error => error.status === 403 && error.code === 'CONTENT_DECAY_SCAN_NOT_OWNED'
  );
});

test('checkout claims an anonymous scan for the buyer', async () => {
  const database = fakeDatabase(defaultRoutes({scan: scan({user_id: null})}));
  const result = await createCheckout({
    scanId: SCAN,
    user: {id: USER, email: 'buyer@example.com'},
    client: fakeClient(),
    database,
    mode: 'test',
    priceId: PRICE_ID,
    origin: 'https://aeogeosearch.com'
  });

  assert.equal(result.sessionId, 'cs_test_new1');
  const claim = database.calls.find(call => call.path.includes('user_id=is.null'));
  assert.equal(claim.path, 'content_decay_scans?id=eq.' + SCAN + '&user_id=is.null');
  assert.equal(claim.options.method, 'PATCH');
  assert.equal(claim.options.body.user_id, USER);
  assert.equal(claim.options.headers.Prefer, 'return=representation');
});

test('checkout refuses a scan another account claimed first', async () => {
  let loads = 0;
  const database = fakeDatabase((path, options) => {
    if (path.startsWith('content_decay_scans?id=eq.')) {
      if (options.method === 'PATCH') return [];
      loads += 1;
      return loads === 1 ? [scan({user_id: null})] : [scan({user_id: OTHER_USER})];
    }
    return defaultRoutes()(path, options);
  });

  await assert.rejects(
    createCheckout({
      scanId: SCAN,
      user: {id: USER},
      client: fakeClient(),
      database,
      mode: 'test',
      priceId: PRICE_ID,
      origin: 'https://aeogeosearch.com'
    }),
    error => error.status === 403 && error.code === 'CONTENT_DECAY_SCAN_NOT_OWNED'
  );
});

test('checkout refuses an unfinished scan and an already purchased one', async () => {
  await assert.rejects(
    createCheckout({
      scanId: SCAN,
      user: {id: USER},
      client: fakeClient(),
      database: fakeDatabase(defaultRoutes({scan: scan({status: 'running'})})),
      mode: 'test',
      priceId: PRICE_ID,
      origin: 'https://aeogeosearch.com'
    }),
    error => error.code === 'CONTENT_DECAY_SCAN_NOT_READY'
  );

  let created = false;
  const result = await createCheckout({
    scanId: SCAN,
    user: {id: USER},
    client: fakeClient({createCheckoutSession: async () => { created = true; }}),
    database: fakeDatabase(defaultRoutes({
      entitlements: [{id: ENTITLEMENT, expires_at: null, environment: 'test'}]
    })),
    mode: 'test',
    priceId: PRICE_ID,
    origin: 'https://aeogeosearch.com'
  });
  assert.equal(result.alreadyPurchased, true);
  assert.equal(result.entitlementId, ENTITLEMENT);
  assert.equal(created, false);
});

test('confirm records the purchase and grants the entitlement', async () => {
  const database = fakeDatabase(defaultRoutes());
  const result = await confirmSession({
    sessionId: SESSION_ID,
    expectedUserId: USER,
    client: fakeClient(),
    database,
    priceId: PRICE_ID
  });

  assert.equal(result.paid, true);
  assert.equal(result.scanId, SCAN);
  assert.equal(result.purchaseId, PURCHASE);
  assert.equal(result.entitlementId, ENTITLEMENT);
  assert.equal(result.environment, 'test');

  const insert = database.calls.find(call => call.path === 'content_decay_purchases');
  assert.equal(insert.options.body.user_id, USER);
  assert.equal(insert.options.body.scan_id, SCAN);
  assert.equal(insert.options.body.stripe_session_id, SESSION_ID);
  assert.equal(insert.options.body.amount_total, REPORT_AMOUNT);
  assert.equal(insert.options.body.livemode, false);
  assert.equal(insert.options.body.environment, 'test');
  assert.equal(insert.options.body.test_run_id, TEST_RUN);
});

test('confirm rejects unpaid, underpaid, wrong-price and wrong-user sessions', async () => {
  const cases = [
    {client: fakeClient({retrieveSession: async () => session({status: 'open'})}), expectedUserId: USER},
    {client: fakeClient({retrieveSession: async () => session({payment_status: 'unpaid'})}), expectedUserId: USER},
    {client: fakeClient({retrieveSession: async () => session({amount_total: 100})}), expectedUserId: USER},
    {client: fakeClient({retrieveSession: async () => session({currency: 'eur'})}), expectedUserId: USER},
    {client: fakeClient({retrieveSession: async () => session({livemode: true})}), expectedUserId: USER},
    {client: fakeClient({retrieveSession: async () => session({line_items: {data: [{quantity: 1, price: {id: 'price_other'}}]}})}), expectedUserId: USER},
    {client: fakeClient(), expectedUserId: OTHER_USER}
  ];

  for (const item of cases) {
    await assert.rejects(
      confirmSession({
        sessionId: SESSION_ID,
        expectedUserId: item.expectedUserId,
        client: item.client,
        database: fakeDatabase(defaultRoutes()),
        priceId: PRICE_ID
      }),
      error => ['CONTENT_DECAY_NOT_PAID', 'CONTENT_DECAY_SCAN_NOT_OWNED'].includes(error.code),
      JSON.stringify(item)
    );
  }
});

test('confirm is idempotent for an already recorded session', async () => {
  const database = fakeDatabase(defaultRoutes({
    purchases: [{id: PURCHASE, user_id: USER, scan_id: SCAN}]
  }));
  const result = await confirmSession({
    sessionId: SESSION_ID,
    expectedUserId: USER,
    client: fakeClient(),
    database,
    priceId: PRICE_ID
  });
  assert.equal(result.purchaseId, PURCHASE);
  assert.equal(database.calls.some(call => call.path === 'content_decay_purchases'), false);
});

test('entitlementFor returns an active unexpired row and ignores expired ones', async () => {
  const active = await entitlementFor({
    userId: USER,
    scanId: SCAN,
    environment: 'test',
    database: fakeDatabase(defaultRoutes({
      entitlements: [{id: ENTITLEMENT, expires_at: null}]
    }))
  });
  assert.equal(active.id, ENTITLEMENT);

  const expired = await entitlementFor({
    userId: USER,
    scanId: SCAN,
    environment: 'test',
    database: fakeDatabase(defaultRoutes({
      entitlements: [{id: ENTITLEMENT, expires_at: '2020-01-01T00:00:00.000Z'}]
    }))
  });
  assert.equal(expired, null);
});

test('the webhook ignores events for other products', async () => {
  const event = {
    id: EVENT_ID,
    type: 'checkout.session.completed',
    livemode: false,
    data: {object: {id: SESSION_ID, metadata: {product: 'competitor_intelligence'}}}
  };
  const database = fakeDatabase(defaultRoutes());
  const handled = await handleWebhook(event, {
    client: fakeClient(),
    database,
    priceId: PRICE_ID,
    environment: 'test'
  });
  assert.equal(handled, false);
  assert.equal(database.calls.length, 0);
});

test('the webhook claims the event, confirms the session and returns handled', async () => {
  const event = {
    id: EVENT_ID,
    type: 'checkout.session.completed',
    livemode: false,
    data: {object: {id: SESSION_ID, metadata: {product: 'content_decay', scan_id: SCAN}}}
  };
  const database = fakeDatabase(defaultRoutes());
  const handled = await handleWebhook(event, {
    client: fakeClient(),
    database,
    priceId: PRICE_ID,
    environment: 'test'
  });
  assert.equal(handled, true);
  const claim = database.calls.find(call => call.path === 'rpc/content_decay_claim_webhook');
  assert.equal(claim.options.body.p_event_id, EVENT_ID);
  assert.equal(claim.options.body.p_livemode, false);
  assert.equal(claim.options.body.p_test_run, TEST_RUN);
  assert.equal(database.calls.some(call => call.path === 'content_decay_purchases'), true);
});

test('a duplicate webhook delivery does not confirm twice', async () => {
  const event = {
    id: EVENT_ID,
    type: 'checkout.session.completed',
    livemode: false,
    data: {object: {id: SESSION_ID, metadata: {product: 'content_decay', scan_id: SCAN}}}
  };
  const database = fakeDatabase(defaultRoutes({claim: false}));
  const handled = await handleWebhook(event, {
    client: fakeClient(),
    database,
    priceId: PRICE_ID,
    environment: 'test'
  });
  assert.equal(handled, true);
  assert.equal(database.calls.some(call => call.path === 'content_decay_purchases'), false);
});

test('a failed confirmation releases the claim so Stripe can retry', async () => {
  const event = {
    id: EVENT_ID,
    type: 'checkout.session.completed',
    livemode: false,
    data: {object: {id: SESSION_ID, metadata: {product: 'content_decay', scan_id: SCAN}}}
  };
  const database = fakeDatabase(defaultRoutes());
  await assert.rejects(
    handleWebhook(event, {
      client: fakeClient({retrieveSession: async () => session({amount_total: 1})}),
      database,
      priceId: PRICE_ID,
      environment: 'test'
    }),
    error => error.code === 'CONTENT_DECAY_NOT_PAID'
  );
  const release = database.calls.find(call => call.path.startsWith('content_decay_webhook_events?id=eq.'));
  assert.equal(release.options.method, 'DELETE');
});

// ---- Refunds ------------------------------------------------------------

const REFUND_PURCHASE = {
  id: PURCHASE,
  status: 'paid',
  user_id: USER,
  scan_id: SCAN,
  environment: 'test',
  test_run_id: TEST_RUN
};

const refundEvent = (charge = {}) => ({
  id: 'evt_test_refund01',
  type: 'charge.refunded',
  livemode: false,
  data: {
    object: {
      id: 'ch_test_abc123',
      object: 'charge',
      livemode: false,
      amount: REPORT_AMOUNT,
      amount_refunded: REPORT_AMOUNT,
      payment_intent: 'pi_test_abc123',
      ...charge
    }
  }
});

test('charge.refunded marks the purchase refunded and revokes its entitlement', async () => {
  const database = fakeDatabase(defaultRoutes({
    intentPurchases: [REFUND_PURCHASE],
    refund: PURCHASE
  }));

  const handled = await handleWebhook(refundEvent(), {
    client: fakeClient(),
    database,
    priceId: PRICE_ID,
    environment: 'test'
  });

  assert.equal(handled, true);

  const lookup = database.calls.find(call =>
    call.path.startsWith('content_decay_purchases?stripe_payment_intent=eq.'));
  assert.ok(lookup.path.includes('stripe_payment_intent=eq.pi_test_abc123'));
  assert.ok(lookup.path.includes('livemode=eq.false'));

  const claim = database.calls.find(call => call.path === 'rpc/content_decay_claim_webhook');
  assert.equal(claim.options.body.p_event_id, 'evt_test_refund01');
  assert.equal(claim.options.body.p_type, 'charge.refunded');
  assert.equal(claim.options.body.p_livemode, false);
  assert.equal(claim.options.body.p_test_run, TEST_RUN);

  const refund = database.calls.find(call => call.path === 'rpc/content_decay_refund_purchase');
  assert.deepEqual(refund.options.body, {
    p_payment_intent: 'pi_test_abc123',
    p_livemode: false
  });
  assert.equal(database.calls.some(call => call.path === 'rpc/content_decay_grant_entitlement'), false);
});

test('a partial refund leaves the report open and revokes nothing', async () => {
  // A partial refund is a deliberate goodwill amount. Ending a $49 report over
  // a $5 refund would take away more than was given back, so only a full
  // refund closes the report.
  const database = fakeDatabase(defaultRoutes({
    intentPurchases: [REFUND_PURCHASE],
    refund: PURCHASE
  }));

  const handled = await handleWebhook(refundEvent({amount_refunded: 500}), {
    client: fakeClient(),
    database,
    priceId: PRICE_ID,
    environment: 'test'
  });

  assert.equal(handled, false);
  assert.equal(database.calls.some(call => call.path === 'rpc/content_decay_claim_webhook'), false);
  assert.equal(database.calls.some(call => call.path === 'rpc/content_decay_refund_purchase'), false);
});

test('a charge with no readable amount falls back to the report price', async () => {
  // Webhook payloads follow the endpoint's API version. If a charge ever arrives
  // without `amount`, a full refund must still revoke instead of looking partial.
  const full = refundEvent();
  delete full.data.object.amount;
  const fullDatabase = fakeDatabase(defaultRoutes({intentPurchases: [REFUND_PURCHASE], refund: PURCHASE}));

  const handledFull = await handleWebhook(full, {
    client: fakeClient(),
    database: fullDatabase,
    priceId: PRICE_ID,
    environment: 'test'
  });

  assert.equal(handledFull, true);
  assert.equal(fullDatabase.calls.some(call => call.path === 'rpc/content_decay_refund_purchase'), true);

  const partial = refundEvent({amount_refunded: 500});
  delete partial.data.object.amount;
  const partialDatabase = fakeDatabase(defaultRoutes({intentPurchases: [REFUND_PURCHASE], refund: PURCHASE}));

  const handledPartial = await handleWebhook(partial, {
    client: fakeClient(),
    database: partialDatabase,
    priceId: PRICE_ID,
    environment: 'test'
  });

  assert.equal(handledPartial, false);
  assert.equal(partialDatabase.calls.some(call => call.path === 'rpc/content_decay_refund_purchase'), false);
});

test('a refund for another product or a zero-amount marker is ignored', async () => {
  for (const event of [refundEvent(), refundEvent({amount_refunded: 0})]) {
    const database = fakeDatabase(defaultRoutes({intentPurchases: []}));
    const handled = await handleWebhook(event, {
      client: fakeClient(),
      database,
      priceId: PRICE_ID,
      environment: 'test'
    });
    assert.equal(handled, false);
    assert.equal(database.calls.some(call => call.path === 'rpc/content_decay_claim_webhook'), false);
    assert.equal(database.calls.some(call => call.path === 'rpc/content_decay_refund_purchase'), false);
  }
});

test('a duplicate refund delivery does not refund twice', async () => {
  const database = fakeDatabase(defaultRoutes({
    intentPurchases: [REFUND_PURCHASE],
    claim: false
  }));

  const handled = await handleWebhook(refundEvent(), {
    client: fakeClient(),
    database,
    priceId: PRICE_ID,
    environment: 'test'
  });

  assert.equal(handled, true);
  assert.equal(database.calls.some(call => call.path === 'rpc/content_decay_refund_purchase'), false);
});

test('a failed refund releases the claim so Stripe can retry', async () => {
  const routes = defaultRoutes({intentPurchases: [REFUND_PURCHASE]});
  const database = fakeDatabase((path, options) => {
    if (path === 'rpc/content_decay_refund_purchase') {
      throw Object.assign(new Error('The database is unavailable.'), {status: 503});
    }
    return routes(path, options);
  });

  await assert.rejects(
    handleWebhook(refundEvent(), {
      client: fakeClient(),
      database,
      priceId: PRICE_ID,
      environment: 'test'
    }),
    error => error.status === 503
  );

  const release = database.calls.find(call => call.path.startsWith('content_decay_webhook_events?id=eq.'));
  assert.equal(release.options.method, 'DELETE');
});

test('a live refund cannot touch a test purchase', async () => {
  const database = fakeDatabase(defaultRoutes({intentPurchases: [REFUND_PURCHASE]}));
  const event = refundEvent({livemode: true});
  event.livemode = true;

  await assert.rejects(
    handleWebhook(event, {
      client: fakeClient(),
      database,
      priceId: PRICE_ID,
      environment: 'test'
    }),
    error => error.code === 'CONTENT_DECAY_MODE_MISMATCH'
  );
  assert.equal(database.calls.length, 0);
});

test('a refunded purchase is reported instead of being granted again', async () => {
  for (const [status, flag] of [['refunded', 'refunded'], ['revoked', 'revoked']]) {
    const database = fakeDatabase(defaultRoutes({
      purchases: [{id: PURCHASE, status, user_id: USER, scan_id: SCAN}]
    }));

    const result = await confirmSession({
      sessionId: SESSION_ID,
      expectedUserId: USER,
      client: fakeClient(),
      database,
      priceId: PRICE_ID
    });

    assert.equal(result.paid, false);
    assert.equal(result[flag], true);
    assert.equal(result.purchaseId, PURCHASE);
    assert.equal(database.calls.some(call => call.path === 'rpc/content_decay_grant_entitlement'), false);
  }
});

// ---- Disputes -----------------------------------------------------------

const disputeEvent = (dispute = {}) => ({
  id: 'evt_test_dispute1',
  type: 'charge.dispute.created',
  livemode: false,
  data: {
    object: {
      id: 'dp_test_abc123',
      object: 'dispute',
      livemode: false,
      amount: REPORT_AMOUNT,
      charge: 'ch_test_abc123',
      payment_intent: 'pi_test_abc123',
      reason: 'fraudulent',
      status: 'needs_response',
      ...dispute
    }
  }
});

test('charge.dispute.created revokes the purchase and its entitlement', async () => {
  const database = fakeDatabase(defaultRoutes({
    intentPurchases: [REFUND_PURCHASE],
    dispute: PURCHASE
  }));

  const handled = await handleWebhook(disputeEvent(), {
    client: fakeClient(),
    database,
    priceId: PRICE_ID,
    environment: 'test'
  });

  assert.equal(handled, true);

  const lookup = database.calls.find(call =>
    call.path.startsWith('content_decay_purchases?stripe_payment_intent=eq.'));
  assert.ok(lookup.path.includes('stripe_payment_intent=eq.pi_test_abc123'));
  assert.ok(lookup.path.includes('livemode=eq.false'));

  const claim = database.calls.find(call => call.path === 'rpc/content_decay_claim_webhook');
  assert.equal(claim.options.body.p_event_id, 'evt_test_dispute1');
  assert.equal(claim.options.body.p_type, 'charge.dispute.created');
  assert.equal(claim.options.body.p_livemode, false);
  assert.equal(claim.options.body.p_test_run, TEST_RUN);

  const dispute = database.calls.find(call => call.path === 'rpc/content_decay_dispute_purchase');
  assert.deepEqual(dispute.options.body, {
    p_payment_intent: 'pi_test_abc123',
    p_livemode: false
  });
  assert.equal(database.calls.some(call => call.path === 'rpc/content_decay_refund_purchase'), false);
  assert.equal(database.calls.some(call => call.path === 'rpc/content_decay_grant_entitlement'), false);
});

test('an expanded payment intent still links a dispute to its purchase', async () => {
  const database = fakeDatabase(defaultRoutes({
    intentPurchases: [REFUND_PURCHASE],
    dispute: PURCHASE
  }));

  const handled = await handleWebhook(
    disputeEvent({payment_intent: {id: 'pi_test_abc123', object: 'payment_intent'}}),
    {client: fakeClient(), database, priceId: PRICE_ID, environment: 'test'}
  );

  assert.equal(handled, true);
  const dispute = database.calls.find(call => call.path === 'rpc/content_decay_dispute_purchase');
  assert.equal(dispute.options.body.p_payment_intent, 'pi_test_abc123');
});

test('a dispute for another product is ignored', async () => {
  const database = fakeDatabase(defaultRoutes({intentPurchases: []}));

  const handled = await handleWebhook(disputeEvent(), {
    client: fakeClient(),
    database,
    priceId: PRICE_ID,
    environment: 'test'
  });

  assert.equal(handled, false);
  assert.equal(database.calls.some(call => call.path === 'rpc/content_decay_claim_webhook'), false);
  assert.equal(database.calls.some(call => call.path === 'rpc/content_decay_dispute_purchase'), false);
});

test('a dispute with no attributable dispute id or payment intent is ignored', async () => {
  for (const dispute of [
    {payment_intent: null},
    {id: 'ch_test_abc123'},
    {payment_intent: 'not-a-payment-intent'}
  ]) {
    const database = fakeDatabase(defaultRoutes({intentPurchases: [REFUND_PURCHASE]}));
    const handled = await handleWebhook(disputeEvent(dispute), {
      client: fakeClient(),
      database,
      priceId: PRICE_ID,
      environment: 'test'
    });
    assert.equal(handled, false);
    assert.equal(database.calls.some(call => call.path === 'rpc/content_decay_claim_webhook'), false);
  }
});

test('a duplicate dispute delivery does not revoke twice', async () => {
  const database = fakeDatabase(defaultRoutes({
    intentPurchases: [REFUND_PURCHASE],
    claim: false
  }));

  const handled = await handleWebhook(disputeEvent(), {
    client: fakeClient(),
    database,
    priceId: PRICE_ID,
    environment: 'test'
  });

  assert.equal(handled, true);
  assert.equal(database.calls.some(call => call.path === 'rpc/content_decay_dispute_purchase'), false);
});

test('a failed dispute update releases the claim so Stripe can retry', async () => {
  const routes = defaultRoutes({intentPurchases: [REFUND_PURCHASE]});
  const database = fakeDatabase((path, options) => {
    if (path === 'rpc/content_decay_dispute_purchase') {
      throw Object.assign(new Error('The database is unavailable.'), {status: 503});
    }
    return routes(path, options);
  });

  await assert.rejects(
    handleWebhook(disputeEvent(), {
      client: fakeClient(),
      database,
      priceId: PRICE_ID,
      environment: 'test'
    }),
    error => error.status === 503
  );

  const release = database.calls.find(call => call.path.startsWith('content_decay_webhook_events?id=eq.'));
  assert.equal(release.options.method, 'DELETE');
});

test('a live dispute cannot touch a test purchase', async () => {
  const database = fakeDatabase(defaultRoutes({intentPurchases: [REFUND_PURCHASE]}));
  const event = disputeEvent({livemode: true});
  event.livemode = true;

  await assert.rejects(
    handleWebhook(event, {
      client: fakeClient(),
      database,
      priceId: PRICE_ID,
      environment: 'test'
    }),
    error => error.code === 'CONTENT_DECAY_MODE_MISMATCH'
  );
  assert.equal(database.calls.length, 0);
});

test('a late checkout event cannot resurrect a refunded purchase', async () => {
  const event = {
    id: 'evt_test_late01',
    type: 'checkout.session.completed',
    livemode: false,
    data: {object: {id: SESSION_ID, metadata: {product: 'content_decay', scan_id: SCAN}}}
  };
  const database = fakeDatabase(defaultRoutes({
    purchases: [{id: PURCHASE, status: 'refunded', user_id: USER, scan_id: SCAN}]
  }));

  const handled = await handleWebhook(event, {
    client: fakeClient(),
    database,
    priceId: PRICE_ID,
    environment: 'test'
  });

  assert.equal(handled, true);
  assert.equal(database.calls.some(call => call.path === 'rpc/content_decay_grant_entitlement'), false);
});

test('a test-mode event is refused on a live deployment', async () => {
  const event = {
    id: EVENT_ID,
    type: 'checkout.session.completed',
    livemode: false,
    data: {object: {id: SESSION_ID, metadata: {product: 'content_decay', scan_id: SCAN}}}
  };
  await assert.rejects(
    handleWebhook(event, {
      client: fakeClient(),
      database: fakeDatabase(defaultRoutes()),
      priceId: PRICE_ID,
      environment: 'live'
    }),
    error => error.code === 'CONTENT_DECAY_MODE_MISMATCH'
  );
});
