'use strict';

// The reconciliation CLI, driven end to end with stubbed I/O.
//
// The pure matching logic has its own tests. These cover the parts around it:
// Stripe session pagination, the credit-row and pending-row queries, the extra
// session reads for pending reservations, the printed report, and the exit
// codes (0 clean, 1 critical findings, 2 could not run). Nothing here reaches
// the network: the Stripe request, database and credential are all injected.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  run,
  creditRows,
  pendingRows,
  sessionsForPending,
  PENDING_RETRIEVE_MAX
} = require('../scripts/reconcile-content-decay-credits.cjs');

const NOW = Date.UTC(2026, 10, 26, 12, 0, 0); // 2026-11-26T12:00:00Z
const CREDIT_ID = 'df77106b-c5c9-4b69-b1bb-11e8f7075ccd';
const PENDING_ID = 'ac9cf0cf-6285-447f-b676-b0e257b157a8';

const session = (over = {}) => ({
  id: 'cs_live_a',
  status: 'complete',
  payment_status: 'paid',
  livemode: true,
  created: 1764000000,
  amount_total: 4999,
  currency: 'usd',
  metadata: {
    product: 'content_decay',
    kind: 'credit',
    credit_id: CREDIT_ID,
    user_id: '9db3f346-8fd2-4b6b-9750-1713dcde92b0'
  },
  ...over
});

const credit = (over = {}) => ({
  id: CREDIT_ID,
  status: 'open',
  environment: 'live',
  user_id: '9db3f346-8fd2-4b6b-9750-1713dcde92b0',
  stripe_session_id: 'cs_live_a',
  amount_total: 4999,
  currency: 'usd',
  created_at: '2026-11-25T21:50:17.944Z',
  ...over
});

function stripeStub({pages = [], sessions = {}} = {}) {
  const calls = [];
  let page = 0;
  const request = async (key, path) => {
    calls.push(path);
    if (path.startsWith('checkout/sessions?')) {
      if (page >= pages.length) throw new Error('Unexpected Stripe session list read');
      return pages[page++];
    }
    const id = decodeURIComponent(path.slice('checkout/sessions/'.length));
    if (!Object.prototype.hasOwnProperty.call(sessions, id)) {
      throw new Error('Unexpected Stripe read: ' + path);
    }
    if (sessions[id] instanceof Error) throw sessions[id];
    return sessions[id];
  };
  return {request, calls};
}

function databaseStub({windowRows = [], pendingRows: pending = []} = {}) {
  const calls = [];
  const query = async path => {
    calls.push(path);
    if (path.includes('status=eq.pending')) return pending;
    if (path.includes('created_at=gte.')) return windowRows;
    throw new Error('Unexpected database read: ' + path);
  };
  return {query, calls};
}

async function execute({argv = [], stripe, database, credential = () => ({key: 'sk_test_stub', mode: 'live'})}) {
  const out = [];
  const err = [];
  const code = await run({
    argv,
    credential,
    request: stripe.request,
    database: database.query,
    now: () => NOW,
    log: line => out.push(line),
    errorLog: line => err.push(line)
  });
  return {code, out, output: out.join('\n'), errors: err};
}

test('a clean run paginates Stripe sessions and reports nothing to reconcile', async () => {
  const other = session({
    id: 'cs_live_b',
    status: 'open',
    payment_status: 'unpaid',
    metadata: {product: 'content_decay', kind: 'credit', credit_id: 'credit-b'}
  });
  const stripe = stripeStub({
    pages: [
      {data: [session(), other], has_more: true},
      {data: [session({id: 'cs_live_c', metadata: {product: 'geo_audit'}})], has_more: false}
    ]
  });
  const database = databaseStub({windowRows: [credit()]});

  const result = await execute({argv: ['--days', '7'], stripe, database});

  assert.equal(result.code, 0);
  const listCalls = stripe.calls.filter(path => path.startsWith('checkout/sessions?'));
  assert.equal(listCalls.length, 2, 'the second page is requested when has_more is true');
  const second = new URLSearchParams(listCalls[1].split('?')[1]);
  assert.equal(second.get('starting_after'), 'cs_live_b', 'pagination continues from the last session');
  assert.equal(second.get('created[gte]'), String(Math.floor((NOW - 7 * 86400000) / 1000)));

  assert.match(result.output, /Window: last 7 days/);
  assert.match(result.output, /Stripe sessions read: 3 - paid credit payments: 1/);
  assert.match(result.output, /No missing or unopened credits found/);

  assert.equal(database.calls.length, 2, 'one window query and one pending query');
  assert.match(database.calls[0], /content_decay_report_credits\?environment=eq\.live/);
  assert.match(database.calls[0], /created_at=gte\./);
  assert.match(database.calls[0], /order=created_at\.desc&limit=1000&offset=0/);
  assert.match(database.calls[1], /status=eq\.pending/);
});

test('a paid credit with no row exits 1 and prints the finding as JSON', async () => {
  const stripe = stripeStub({pages: [{data: [session()], has_more: false}]});
  const database = databaseStub({windowRows: []});

  const result = await execute({argv: ['--json'], stripe, database});

  assert.equal(result.code, 1);
  const payload = JSON.parse(result.output);
  assert.equal(payload.days, 30);
  assert.equal(payload.environment, 'live');
  assert.equal(payload.findings.length, 1);
  assert.equal(payload.findings[0].kind, 'paid_without_credit');
  assert.equal(payload.findings[0].severity, 'critical');
  assert.equal(payload.counts.critical, 1);
});

test('a pending reservation outside the window reads its session and exits 1', async () => {
  const pending = credit({id: PENDING_ID, status: 'pending', stripe_session_id: 'cs_live_pending'});
  const stripe = stripeStub({
    pages: [{data: [], has_more: false}],
    sessions: {
      cs_live_pending: session({
        id: 'cs_live_pending',
        metadata: {product: 'content_decay', kind: 'credit', credit_id: PENDING_ID}
      })
    }
  });
  const database = databaseStub({windowRows: [], pendingRows: [pending]});

  const result = await execute({argv: ['--json'], stripe, database});

  assert.equal(result.code, 1);
  assert.ok(stripe.calls.includes('checkout/sessions/cs_live_pending'), 'the pending session is read');
  const payload = JSON.parse(result.output);
  assert.deepEqual(payload.findings.map(finding => finding.kind), ['pending_after_payment']);
  assert.equal(payload.counts.pending, 1);
});

test('an unreadable pending session is a warning, not a finding', async () => {
  const pending = credit({id: PENDING_ID, status: 'pending', stripe_session_id: 'cs_live_pending'});
  const stripe = stripeStub({
    pages: [{data: [], has_more: false}],
    sessions: {cs_live_pending: new Error('Stripe checkout/sessions/cs_live_pending failed: HTTP 404')}
  });
  const database = databaseStub({windowRows: [], pendingRows: [pending]});

  const result = await execute({argv: ['--json'], stripe, database});

  assert.equal(result.code, 0, 'a session that cannot be read is not proof of a payment');
  const payload = JSON.parse(result.output);
  assert.deepEqual(payload.findings, []);
  assert.equal(payload.warnings.length, 1);
  assert.match(payload.warnings[0], /Could not read pending credit session cs_live_pending/);
});

test('a missing credential exits 2 before any read', async () => {
  const stripe = stripeStub({pages: []});
  const database = databaseStub({});

  const result = await execute({
    stripe,
    database,
    credential: () => {
      throw new Error('Content Decay has no Stripe server key configured.');
    }
  });

  assert.equal(result.code, 2);
  assert.deepEqual(stripe.calls, []);
  assert.deepEqual(database.calls, []);
  assert.match(result.errors.join('\n'), /Reconciliation could not run: Content Decay has no Stripe server key/);
});

test('a database failure exits 2 with the reason', async () => {
  const stripe = stripeStub({pages: [{data: [], has_more: false}]});
  const database = {
    calls: [],
    query: async path => {
      database.calls.push(path);
      throw new Error('The audit database could not complete this request.');
    }
  };

  const result = await execute({stripe, database});

  assert.equal(result.code, 2);
  assert.match(result.errors.join('\n'), /Reconciliation could not run: The audit database could not complete this request\./);
});

test('the credit-row query pages through the whole window', async () => {
  const firstPage = Array.from({length: 1000}, (_, index) => ({id: 'credit-' + index}));
  const calls = [];
  const database = async path => {
    calls.push(path);
    const offset = Number(new URLSearchParams(path.split('?')[1]).get('offset'));
    return offset === 0 ? firstPage : [{id: 'credit-last'}];
  };

  const rows = await creditRows('live', '2026-11-01T00:00:00.000Z', database);

  assert.equal(rows.length, 1001);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /limit=1000&offset=0$/);
  assert.match(calls[1], /limit=1000&offset=1000$/);
  assert.match(calls[0], /select=id,status,environment,user_id,stripe_session_id,amount_total,currency,created_at/);
});

test('an empty pending result is treated as no reservations', async () => {
  assert.deepEqual(await pendingRows('live', async () => null), []);
});

test('pending-session reads skip rows already listed or without a session id', async () => {
  const calls = [];
  const request = async (key, path) => {
    calls.push(path);
    return session({id: decodeURIComponent(path.split('/').pop())});
  };
  const rows = [
    {id: 'known', stripe_session_id: 'cs_live_known'},
    {id: 'extra', stripe_session_id: 'cs_live_extra'},
    {id: 'none', stripe_session_id: null}
  ];

  const result = await sessionsForPending('sk_test_stub', rows, new Set(['cs_live_known']), request);

  assert.deepEqual(calls, ['checkout/sessions/cs_live_extra']);
  assert.equal(result.sessions.length, 1);
  assert.deepEqual(result.warnings, []);
});

test('pending-session reads stop at the cap and say so', async () => {
  const rows = Array.from({length: PENDING_RETRIEVE_MAX + 1}, (_, index) => ({
    id: 'credit-' + index,
    stripe_session_id: 'cs_live_' + index
  }));
  const calls = [];
  const request = async (key, path) => {
    calls.push(path);
    return session({id: decodeURIComponent(path.split('/').pop())});
  };

  const result = await sessionsForPending('sk_test_stub', rows, new Set(), request);

  assert.equal(calls.length, PENDING_RETRIEVE_MAX);
  assert.equal(result.sessions.length, PENDING_RETRIEVE_MAX);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Stopped after 100 pending-session reads/);
});

test('every read stays read-only', async () => {
  const stripe = stripeStub({pages: [{data: [session()], has_more: false}]});
  const database = databaseStub({windowRows: [credit()]});
  await execute({stripe, database});

  for (const path of stripe.calls) {
    assert.ok(
      path.startsWith('checkout/sessions?') || /^checkout\/sessions\/cs_[A-Za-z0-9_]+$/.test(path),
      'unexpected Stripe call: ' + path
    );
    assert.equal(path.includes('/expire'), false, 'the check must not expire a session');
  }
  for (const path of database.calls) {
    assert.match(path, /^content_decay_report_credits\?/, 'only credit-row reads are allowed');
  }
});
