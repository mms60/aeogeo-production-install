'use strict';

// The paid-content boundary is enforced by GET action=report, not by the
// purchase module. These tests call the real API handler with the database and
// session modules stubbed, so a change that reads findings before the
// entitlement check fails here even if the purchase tests still pass.

const test = require('node:test');
const assert = require('node:assert/strict');

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '99999999-9999-4999-8999-999999999999';
const SCAN = '22222222-2222-4222-8222-222222222222';
const TEST_RUN = '33333333-3333-4333-8333-333333333333';
const PURCHASE = '44444444-4444-4444-8444-444444444444';
const ENTITLEMENT = '55555555-5555-4555-8555-555555555555';
const RPC = 'rpc/content_decay_access';

const state = {};

function reset(overrides = {}) {
  Object.assign(state, {
    access: false,
    session: {id: USER, email: 'buyer@example.com'},
    authError: null,
    calls: [],
    scan: null,
    pages: [],
    findings: [],
    purchases: [],
    entitlements: []
  }, overrides);
}

async function db(path, options = {}) {
  state.calls.push({path, options});
  if (path === RPC) {
    // Most tests answer the access check directly. The refund test leaves it
    // undefined so this mirrors content_decay_access against real rows.
    if (state.access !== undefined) return state.access;
    const {p_user, p_scan, p_environment} = options.body || {};
    return state.entitlements.some(entitlement =>
      entitlement.status === 'active'
      && entitlement.user_id === p_user
      && entitlement.scan_id === p_scan
      && entitlement.environment === p_environment
      && state.purchases.some(purchase =>
        purchase.id === entitlement.purchase_id
        && purchase.status === 'paid'
        && purchase.environment === p_environment)
    );
  }
  if (path.startsWith('content_decay_scans?')) return state.scan ? [state.scan] : [];
  if (path.startsWith('content_decay_scan_pages?')) return state.pages;
  if (path.startsWith('content_decay_findings?')) return state.findings;
  throw new Error('Unexpected database path: ' + path);
}

async function user() {
  if (state.authError) throw state.authError;
  return state.session;
}

// Mirrors lib/db.reply: the handler's status and JSON body are what matter here.
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

// Required after the stubs above so the purchase module shares them.
const {handleWebhook, REPORT_AMOUNT} = require('../netlify/functions/lib/content-decay-purchases');
const api = require('../netlify/functions/content-decay-api');

const scanRow = () => ({
  id: SCAN,
  hostname: 'example.com',
  target_url: 'https://example.com',
  status: 'completed',
  pages_scanned: 2,
  overall_score: 61,
  summary: {pagesDiscovered: 4, undatedPages: 1},
  completed_at: '2026-11-19T12:00:00.000Z'
});

const pageRows = () => [
  {
    id: 'pppppppp-1111-4111-8111-111111111111',
    url: 'https://example.com/stale',
    title: 'Stale page',
    word_count: 210,
    declared_modified_at: '2023-04-02T00:00:00.000Z',
    page_score: 48,
    severity: 'critical'
  }
];

const findingRows = () => [
  {
    page_id: 'pppppppp-1111-4111-8111-111111111111',
    category: 'freshness',
    code: 'no_declared_date',
    severity: 'medium',
    priority: 10,
    title: 'No declared update date',
    detail: 'The page declares no date.',
    evidence: null,
    recommendation: 'Add a visible date.',
    suggested_replacement: null
  },
  {
    page_id: 'pppppppp-1111-4111-8111-111111111111',
    category: 'outdated_data',
    code: 'stale_statistic',
    severity: 'critical',
    priority: 5,
    title: 'Cited statistic is years old',
    detail: 'A 2022 figure is still presented as current.',
    evidence: '“63% of marketers…”',
    recommendation: 'Replace the figure with a current, linked source.',
    suggested_replacement: 'In 2026, 71% of marketers reported…'
  },
  {
    page_id: null,
    category: 'structure',
    code: 'weak_heading',
    severity: 'low',
    priority: 30,
    title: 'Question heading has no direct answer',
    detail: 'The section opens with background.',
    evidence: '“What does this do?”',
    recommendation: 'Open with a one-sentence answer.',
    suggested_replacement: null
  }
];

const reportEvent = (query = {}) => ({
  httpMethod: 'GET',
  headers: {authorization: 'Bearer session-token'},
  queryStringParameters: {action: 'report', scan: SCAN, ...query}
});

const pdfEvent = (query = {}) => ({
  httpMethod: 'GET',
  headers: {authorization: 'Bearer session-token'},
  queryStringParameters: {action: 'report.pdf', scan: SCAN, ...query}
});

const payloadOf = response => JSON.parse(response.body);

test('GET action=report returns 402 and no findings when content_decay_access is false', async () => {
  reset({access: false, scan: scanRow(), pages: pageRows(), findings: findingRows()});

  const response = await api.handler(reportEvent());
  const body = payloadOf(response);

  assert.equal(response.statusCode, 402);
  assert.equal(body.code, 'CONTENT_DECAY_PAYMENT_REQUIRED');
  assert.equal('findings' in body, false);
  assert.equal('pages' in body, false);
  assert.equal('scan' in body, false);
  assert.equal(body.error.includes('purchased'), true);

  // Nothing paid was read: one access check, and no scan/page/finding selects.
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].path, RPC);
  assert.deepEqual(state.calls[0].options.body, {
    p_user: USER,
    p_scan: SCAN,
    p_environment: 'test'
  });

  const raw = response.body;
  assert.equal(raw.includes('Cited statistic is years old'), false);
  assert.equal(raw.includes('https://example.com/stale'), false);
});

test('only a strict true from content_decay_access unlocks the report', async () => {
  for (const answer of ['true', 1, {}, null]) {
    reset({access: answer, scan: scanRow(), pages: pageRows(), findings: findingRows()});
    const response = await api.handler(reportEvent());
    assert.equal(response.statusCode, 402, 'access answer: ' + JSON.stringify(answer));
    assert.equal(state.calls.length, 1);
  }
});

test('the report scopes the access check to the signed-in user, ignoring client input', async () => {
  reset({access: false, session: {id: USER}});

  const response = await api.handler(reportEvent({user: OTHER_USER, userId: OTHER_USER}));

  assert.equal(response.statusCode, 402);
  assert.deepEqual(state.calls[0].options.body, {
    p_user: USER,
    p_scan: SCAN,
    p_environment: 'test'
  });
});

test('GET action=report returns mapped findings only after a true access check', async () => {
  reset({access: true, scan: scanRow(), pages: pageRows(), findings: findingRows()});

  const response = await api.handler(reportEvent());
  const body = payloadOf(response);

  assert.equal(response.statusCode, 200);

  // The access check happens first, then the paid selects.
  assert.equal(state.calls[0].path, RPC);
  assert.deepEqual(state.calls[0].options.body, {
    p_user: USER,
    p_scan: SCAN,
    p_environment: 'test'
  });
  assert.equal(state.calls.filter(call => call.path === RPC).length, 1);

  const scans = state.calls.find(call => call.path.startsWith('content_decay_scans?'));
  const pages = state.calls.find(call => call.path.startsWith('content_decay_scan_pages?'));
  const findings = state.calls.find(call => call.path.startsWith('content_decay_findings?'));
  assert.ok(scans.path.includes('id=eq.' + SCAN));
  assert.ok(scans.path.includes('user_id=eq.' + USER));
  assert.ok(pages.path.includes('scan_id=eq.' + SCAN));
  assert.ok(findings.path.includes('scan_id=eq.' + SCAN));

  assert.deepEqual(body.scan, {
    id: SCAN,
    hostname: 'example.com',
    targetUrl: 'https://example.com',
    status: 'completed',
    pagesScanned: 2,
    overallScore: 61,
    summary: {pagesDiscovered: 4, undatedPages: 1},
    completedAt: '2026-11-19T12:00:00.000Z'
  });

  assert.deepEqual(body.pages, [{
    id: 'pppppppp-1111-4111-8111-111111111111',
    url: 'https://example.com/stale',
    title: 'Stale page',
    wordCount: 210,
    declaredModifiedAt: '2023-04-02T00:00:00.000Z',
    pageScore: 48,
    severity: 'critical'
  }]);

  // Ordered by severity, then priority, and mapped to the UI's field names.
  assert.deepEqual(body.findings.map(finding => finding.severity), ['critical', 'medium', 'low']);
  assert.deepEqual(body.findings.map(finding => finding.title), [
    'Cited statistic is years old',
    'No declared update date',
    'Question heading has no direct answer'
  ]);
  assert.equal(body.findings[0].pageId, 'pppppppp-1111-4111-8111-111111111111');
  assert.equal(body.findings[0].evidence, '“63% of marketers…”');
  assert.equal(body.findings[0].suggestedReplacement, 'In 2026, 71% of marketers reported…');
  assert.equal(body.findings[1].suggestedReplacement, null);
  assert.equal(body.findings[2].pageId, null);
});

test('action=report.pdf returns 402 and no PDF when content_decay_access is false', async () => {
  reset({access: false, scan: scanRow(), pages: pageRows(), findings: findingRows()});

  const response = await api.handler(pdfEvent());
  const body = payloadOf(response);

  assert.equal(response.statusCode, 402);
  assert.equal(body.code, 'CONTENT_DECAY_PAYMENT_REQUIRED');
  assert.equal('findings' in body, false);
  assert.equal(response.isBase64Encoded, undefined);
  assert.notEqual(response.headers['Content-Type'], 'application/pdf');

  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].path, RPC);
  assert.deepEqual(state.calls[0].options.body, {
    p_user: USER,
    p_scan: SCAN,
    p_environment: 'test'
  });
});

test('a refunded purchase closes the PDF boundary through its revoked entitlement', async () => {
  const purchase = {
    id: PURCHASE,
    user_id: USER,
    scan_id: SCAN,
    status: 'paid',
    environment: 'test',
    livemode: false,
    test_run_id: TEST_RUN,
    stripe_payment_intent: 'pi_test_abc123'
  };
  const entitlement = {
    id: ENTITLEMENT,
    purchase_id: PURCHASE,
    user_id: USER,
    scan_id: SCAN,
    status: 'active',
    environment: 'test',
    expires_at: null
  };

  reset({
    access: undefined,
    purchases: [purchase],
    entitlements: [entitlement],
    scan: scanRow(),
    pages: pageRows(),
    findings: findingRows()
  });

  // While the purchase is paid and the entitlement active, the PDF is served.
  const before = await api.handler(pdfEvent());
  assert.equal(before.statusCode, 200);
  assert.equal(before.headers['Content-Type'], 'application/pdf');
  assert.equal(Buffer.from(before.body, 'base64').subarray(0, 8).toString('ascii'), '%PDF-1.4');

  // The refund runs through the real handler and the same statements as
  // content_decay_refund_purchase: purchase refunded, entitlement revoked.
  const refundCalls = [];
  const refundDatabase = async (path, options = {}) => {
    refundCalls.push({path, options});
    if (path.startsWith('content_decay_purchases?stripe_payment_intent=eq.')) return [purchase];
    if (path === 'rpc/content_decay_claim_webhook') return true;
    if (path === 'rpc/content_decay_refund_purchase') {
      purchase.status = 'refunded';
      entitlement.status = 'revoked';
      return PURCHASE;
    }
    throw new Error('Unexpected database path: ' + path);
  };

  const handled = await handleWebhook({
    id: 'evt_test_refund_pdf1',
    type: 'charge.refunded',
    livemode: false,
    data: {
      object: {
        id: 'ch_test_abc123',
        object: 'charge',
        livemode: false,
        amount_refunded: REPORT_AMOUNT,
        payment_intent: 'pi_test_abc123'
      }
    }
  }, {database: refundDatabase, environment: 'test'});

  assert.equal(handled, true);
  assert.equal(purchase.status, 'refunded');
  assert.equal(entitlement.status, 'revoked');
  assert.equal(refundCalls.some(call => call.path === 'rpc/content_decay_grant_entitlement'), false);

  // The same report is now closed, with no PDF and no paid rows read.
  state.calls = [];
  const after = await api.handler(pdfEvent());
  const body = payloadOf(after);

  assert.equal(after.statusCode, 402);
  assert.equal(body.code, 'CONTENT_DECAY_PAYMENT_REQUIRED');
  assert.equal(after.isBase64Encoded, undefined);
  assert.notEqual(after.headers['Content-Type'], 'application/pdf');
  assert.equal(after.body.includes('%PDF-'), false);
  assert.equal('findings' in body, false);
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].path, RPC);
});

test('action=report.pdf serves a 10-page-capped PDF only after a true access check', async () => {
  reset({access: true, scan: scanRow(), pages: pageRows(), findings: findingRows()});

  const response = await api.handler(pdfEvent());
  const bytes = Buffer.from(response.body, 'base64');
  const text = bytes.toString('ascii');
  const pageObjects = (text.match(/\/Type \/Page\b/g) || []).length;

  assert.equal(response.statusCode, 200);
  assert.equal(response.isBase64Encoded, true);
  assert.equal(response.headers['Content-Type'], 'application/pdf');
  assert.equal(response.headers['Cache-Control'], 'private, no-store');
  assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(response.headers['Content-Length'], String(bytes.length));
  assert.match(
    response.headers['Content-Disposition'],
    /^attachment; filename="content-decay-example\.com-\d{4}-\d{2}-\d{2}\.pdf"$/
  );

  assert.equal(bytes.subarray(0, 8).toString('ascii'), '%PDF-1.4');
  assert.ok(pageObjects <= 10, 'no more than 10 PDF pages');
  assert.match(text, /Content Decay Report: example\.com/);
  assert.match(text, /Cited statistic is years old/);
  assert.match(text, /example\.com\/stale/);
  assert.equal(text.includes('"findings"'), false);

  assert.equal(state.calls[0].path, RPC);
  assert.equal(state.calls.filter(call => call.path === RPC).length, 1);
});

test('action=report.pdf refuses a signed-out caller before the access check', async () => {
  reset({
    authError: Object.assign(new Error('Please sign in.'), {status: 401, code: 'sign_in_required'})
  });

  const response = await api.handler(pdfEvent());

  assert.equal(response.statusCode, 401);
  assert.equal(payloadOf(response).code, 'sign_in_required');
  assert.equal(response.isBase64Encoded, undefined);
  assert.equal(state.calls.length, 0);
});

test('a signed-out caller is refused before the access check', async () => {
  reset({
    authError: Object.assign(new Error('Please sign in.'), {status: 401, code: 'sign_in_required'})
  });

  const response = await api.handler(reportEvent());

  assert.equal(response.statusCode, 401);
  assert.equal(payloadOf(response).code, 'sign_in_required');
  assert.equal(state.calls.length, 0);
});
