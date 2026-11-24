'use strict';
// Content Decay Predictor - HTTP API (Phase 3-6).
//
// Routes, all served by this one function:
//   POST  action=scan      anonymous free scan, up to 10 pages
//   GET   action=status    progress by unguessable public token
//   POST  action=checkout  signed-in checkout for a completed, owned scan
//   POST  action=confirm   re-check a returned checkout session server-side
//   GET   action=report    paid findings, entitlement-checked per signed-in user
//   GET   action=report.pdf  the same paid report as a PDF (10 pages max)
//
// The free surface returns the aggregate summary whitelist only. Findings,
// recommendations, suggested replacement copy and the report are never present
// in a free response, whatever the caller asks for.

const crypto = require('node:crypto');
const {db, user, reply, UUID} = require('./lib/db');
const {normalURL} = require('./lib/content-decay-crawler');
const config = require('./lib/content-decay-config');
const purchases = require('./lib/content-decay-purchases');
const {buildReport} = require('./lib/content-decay-pdf');

const TOKEN = /^[0-9a-f]{32,64}$/;
const MAX_BODY_BYTES = 8192;
const RATE_LIMIT = 5;
const RATE_WINDOW_SECONDS = 600;

function siteOrigin() {
  const value = process.env.PUBLIC_SITE_URL || process.env.URL || '';
  try { return new URL(value).origin; } catch { return ''; }
}

function permittedOrigin(event) {
  const origin = event.headers?.origin || event.headers?.Origin;
  if (!origin) return true;
  const expected = siteOrigin();
  return Boolean(expected) && origin === expected;
}

function clientKey(event, secret) {
  const ip = event.headers?.['x-nf-client-connection-ip']
    || event.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
    || '';
  if (!ip) return '';
  return crypto.createHmac('sha256', secret).update(ip).digest('hex');
}

async function startTestRun(environment) {
  if (environment !== 'test') return null;
  const id = crypto.randomUUID();
  await db('content_decay_test_runs', {
    method: 'POST',
    body: {id, label: 'content-decay test scan ' + new Date().toISOString()}
  });
  return id;
}

async function scan(event, body) {
  let target;
  try {
    target = normalURL(body.url);
  } catch (error) {
    return reply(400, {error: error.message, code: 'CONTENT_DECAY_INVALID_URL'});
  }

  let signing;
  try {
    signing = config.signingSecret();
  } catch (error) {
    return reply(503, {error: error.message, code: error.code});
  }

  const key = clientKey(event, signing);
  if (key) {
    const allowed = await db('rpc/consume_content_decay_rate_limit', {
      method: 'POST',
      body: {p_key: key, p_limit: RATE_LIMIT, p_window_seconds: RATE_WINDOW_SECONDS}
    });
    if (allowed !== true) {
      return reply(429, {
        error: 'Too many scans from this connection. Please try again in a few minutes.',
        code: 'CONTENT_DECAY_RATE_LIMITED'
      });
    }
  }

  // Signing in is optional for the free scan; it only links the scan to an account.
  let account = null;
  try { account = await user(event); } catch { account = null; }

  let environment;
  let pageLimit;
  try {
    environment = config.environment();
    pageLimit = config.freePageLimit();
  } catch (error) {
    return reply(503, {error: error.message, code: error.code});
  }

  const scanId = crypto.randomUUID();
  const token = crypto.randomBytes(24).toString('hex');

  let testRunId;
  try {
    testRunId = await startTestRun(environment);
  } catch {
    return reply(503, {
      error: 'The scan service could not start a test run. Please retry.',
      code: 'CONTENT_DECAY_TEST_RUN_FAILED'
    });
  }

  try {
    await db('content_decay_scans', {
      method: 'POST',
      body: {
        id: scanId,
        public_token: token,
        user_id: account?.id || null,
        environment,
        test_run_id: testRunId,
        target_url: target.href,
        hostname: target.hostname.toLowerCase(),
        page_limit: pageLimit,
        status: 'queued',
        client_key: key || null
      }
    });
  } catch {
    return reply(503, {
      error: 'The scan could not be recorded. Please retry.',
      code: 'CONTENT_DECAY_STORAGE_FAILED'
    });
  }

  const base = process.env.URL || siteOrigin();
  const time = String(Date.now());
  const signature = crypto.createHmac('sha256', signing).update(scanId + ':' + time).digest('hex');
  let queued = false;
  try {
    const response = await fetch(base + '/.netlify/functions/content-decay-scan-background', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({scanId, time, signature}),
      signal: AbortSignal.timeout(10000)
    });
    queued = response.ok;
  } catch { queued = false; }

  if (!queued) {
    await db('content_decay_scans?id=eq.' + scanId, {
      method: 'PATCH',
      body: {
        status: 'failed',
        error_code: 'CONTENT_DECAY_DISPATCH_FAILED',
        completed_at: new Date().toISOString()
      }
    }).catch(() => {});
    return reply(503, {
      error: 'The scan could not be started. Please retry.',
      code: 'CONTENT_DECAY_DISPATCH_FAILED'
    });
  }

  return reply(202, {token, status: 'queued', pageLimit});
}

// Plain-language explanations for scan failures. A visitor cannot act on a code,
// and the generic wording is kept for any code without an entry here.
const FAILURE_MESSAGES = {
  CONTENT_DECAY_DNS_FAILED: 'That website address did not resolve. Check the spelling of the address and try again.',
  CONTENT_DECAY_TLS_FAILED: 'The website\u2019s secure certificate could not be verified. Its HTTPS setup may be broken or out of date.',
  CONTENT_DECAY_CONNECTION_FAILED: 'The website refused or dropped the connection. It may be down, or blocking automated requests.'
};

function failureMessage(code) {
  return FAILURE_MESSAGES[code] || 'The scan could not finish.';
}

async function status(event) {
  const token = String(event.queryStringParameters?.token || '').trim().toLowerCase();
  if (!TOKEN.test(token)) {
    return reply(400, {error: 'Invalid scan reference.', code: 'CONTENT_DECAY_INVALID_TOKEN'});
  }
  const rows = await db(
    'content_decay_scans?public_token=eq.' + encodeURIComponent(token)
    + '&select=id,status,hostname,page_limit,pages_scanned,overall_score,summary,error_code,created_at,started_at,completed_at'
  );
  const scan = Array.isArray(rows) ? rows[0] : null;
  if (!scan) return reply(404, {error: 'Scan not found.', code: 'CONTENT_DECAY_SCAN_NOT_FOUND'});

  return reply(200, {
    token,
    id: scan.id,
    status: scan.status,
    hostname: scan.hostname,
    pageLimit: scan.page_limit,
    pagesScanned: scan.pages_scanned,
    overallScore: scan.overall_score,
    summary: scan.summary,
    createdAt: scan.created_at,
    startedAt: scan.started_at,
    completedAt: scan.completed_at,
    error: scan.status === 'failed'
      ? failureMessage(scan.error_code) + ' Reference: ' + (scan.error_code || 'CONTENT_DECAY_CRAWL_FAILED') + '.'
      : null
  });
}

function parseBody(event) {
  if ((event.body || '').length > MAX_BODY_BYTES) {
    return {error: reply(413, {error: 'That request is too large.', code: 'CONTENT_DECAY_REQUEST_TOO_LARGE'})};
  }
  try {
    return {body: JSON.parse(event.body || '{}')};
  } catch {
    return {error: reply(400, {error: 'The request body must be valid JSON.', code: 'CONTENT_DECAY_INVALID_REQUEST'})};
  }
}

// Checkout is created only for the signed-in account that owns a completed
// scan. The browser never supplies a price, an amount or a user id.
async function checkout(event, body) {
  const scanId = String(body.scan || body.scanId || '').trim();
  if (!UUID.test(scanId)) {
    return reply(400, {error: 'A valid scan is required.', code: 'CONTENT_DECAY_INVALID_REQUEST'});
  }
  const account = await user(event);
  const result = await purchases.createCheckout({scanId, user: account});
  return reply(200, result);
}

// The success page calls this so a delayed webhook does not leave a paying
// customer locked out. Identity still comes from the signed-in session and the
// session's own metadata, never from the request body.
async function confirm(event, body) {
  const sessionId = String(body.sessionId || body.session_id || '').trim();
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    return reply(400, {error: 'A valid checkout session is required.', code: 'CONTENT_DECAY_INVALID_REQUEST'});
  }
  const account = await user(event);
  const result = await purchases.confirmSession({sessionId, expectedUserId: account.id});
  return reply(200, result);
}

const SEVERITY_RANK = {low: 1, medium: 2, high: 3, critical: 4};

// Paid content. The database function is the single access check: an active
// entitlement, a paid purchase, matching environments and this user's own id.
// Both the JSON report and the PDF are built from this one result.
async function paidReport(event) {
  const account = await user(event);
  const scanId = String(event.queryStringParameters?.scan || '').trim();
  if (!UUID.test(scanId)) {
    return {response: reply(400, {error: 'A valid scan is required.', code: 'CONTENT_DECAY_INVALID_REQUEST'})};
  }
  const environment = config.environment();
  const allowed = await db('rpc/content_decay_access', {
    method: 'POST',
    body: {p_user: account.id, p_scan: scanId, p_environment: environment}
  });
  if (allowed !== true) {
    return {response: reply(402, {
      error: 'This report has not been purchased.',
      code: 'CONTENT_DECAY_PAYMENT_REQUIRED'
    })};
  }

  const scans = await db(
    'content_decay_scans?id=eq.' + encodeURIComponent(scanId)
    + '&user_id=eq.' + encodeURIComponent(account.id)
    + '&select=id,hostname,target_url,status,pages_scanned,overall_score,summary,completed_at'
  );
  const scan = Array.isArray(scans) ? scans[0] : null;
  if (!scan) return {response: reply(404, {error: 'Scan not found.', code: 'CONTENT_DECAY_SCAN_NOT_FOUND'})};

  const pages = await db(
    'content_decay_scan_pages?scan_id=eq.' + encodeURIComponent(scanId)
    + '&select=id,url,title,word_count,declared_modified_at,page_score,severity'
  );
  const findings = await db(
    'content_decay_findings?scan_id=eq.' + encodeURIComponent(scanId)
    + '&select=page_id,category,code,severity,priority,title,detail,evidence,recommendation,suggested_replacement'
  );
  const ordered = (Array.isArray(findings) ? findings : []).sort((a, b) =>
    (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0)
    || (b.priority || 0) - (a.priority || 0)
  );

  // The fact tables arrive with database/13-fact-consistency.sql. Until that
  // migration is applied, a paid report must still render, so these reads fall
  // back to empty instead of failing the report.
  const facts = await db(
    'content_decay_fact_claims?scan_id=eq.' + encodeURIComponent(scanId)
    + '&select=page_id,category,attribute,value_key,value_display,quote,source_url,source_kind'
  ).catch(() => []);
  const factConflicts = await db(
    'content_decay_fact_conflicts?scan_id=eq.' + encodeURIComponent(scanId)
    + '&select=kind,category,attribute,severity,title,detail,value_a,value_b,page_a_url,page_b_url,quote_a,quote_b,recommendation'
  ).catch(() => []);
  const orderedConflicts = (Array.isArray(factConflicts) ? factConflicts : []).sort((a, b) =>
    (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0)
  );

  return {
    scan: {
      id: scan.id,
      hostname: scan.hostname,
      targetUrl: scan.target_url,
      status: scan.status,
      pagesScanned: scan.pages_scanned,
      overallScore: scan.overall_score,
      summary: scan.summary,
      completedAt: scan.completed_at
    },
    pages: (Array.isArray(pages) ? pages : []).map(page => ({
      id: page.id,
      url: page.url,
      title: page.title,
      wordCount: page.word_count,
      declaredModifiedAt: page.declared_modified_at,
      pageScore: page.page_score,
      severity: page.severity
    })),
    findings: ordered.map(finding => ({
      pageId: finding.page_id,
      category: finding.category,
      code: finding.code,
      severity: finding.severity,
      priority: finding.priority,
      title: finding.title,
      detail: finding.detail,
      evidence: finding.evidence,
      recommendation: finding.recommendation,
      suggestedReplacement: finding.suggested_replacement
    })),
    facts: (Array.isArray(facts) ? facts : []).map(fact => ({
      pageId: fact.page_id,
      category: fact.category,
      attribute: fact.attribute,
      valueKey: fact.value_key,
      valueDisplay: fact.value_display,
      quote: fact.quote,
      sourceUrl: fact.source_url,
      sourceKind: fact.source_kind
    })),
    factConflicts: orderedConflicts.map(conflict => ({
      kind: conflict.kind,
      category: conflict.category,
      attribute: conflict.attribute,
      severity: conflict.severity,
      title: conflict.title,
      detail: conflict.detail,
      valueA: conflict.value_a,
      valueB: conflict.value_b,
      pageAUrl: conflict.page_a_url,
      pageBUrl: conflict.page_b_url,
      quoteA: conflict.quote_a,
      quoteB: conflict.quote_b,
      recommendation: conflict.recommendation
    }))
  };
}

async function report(event) {
  const data = await paidReport(event);
  if (data.response) return data.response;
  return reply(200, {...data, generatedAt: new Date().toISOString()});
}

function pdfFileName(hostname) {
  const safe = String(hostname || 'site')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'site';
  return 'content-decay-' + safe + '-' + new Date().toISOString().slice(0, 10) + '.pdf';
}

// Same access check as the JSON report. The PDF is generated in memory for this
// one authenticated request; it is never stored or given a public URL.
async function reportPdf(event) {
  const data = await paidReport(event);
  if (data.response) return data.response;

  const {bytes} = buildReport({...data, generatedAt: new Date().toISOString()});
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${pdfFileName(data.scan.hostname)}"`,
      'Cache-Control': 'private, no-store',
      'Content-Length': String(bytes.length),
      'X-Content-Type-Options': 'nosniff'
    },
    body: bytes.toString('base64'),
    isBase64Encoded: true
  };
}

exports.handler = async event => {
  const method = String(event.httpMethod || 'GET').toUpperCase();
  try {
    if (method === 'POST') {
      if (!permittedOrigin(event)) {
        return reply(403, {error: 'This request did not come from the site.', code: 'CONTENT_DECAY_ORIGIN'});
      }
      const parsed = parseBody(event);
      if (parsed.error) return parsed.error;
      const action = String(parsed.body.action || '').toLowerCase();
      if (action === 'checkout') return await checkout(event, parsed.body);
      if (action === 'confirm') return await confirm(event, parsed.body);
      return await scan(event, parsed.body);
    }
    if (method === 'GET') {
      const action = String(event.queryStringParameters?.action || '').toLowerCase();
      if (action === 'report') return await report(event);
      if (action === 'report.pdf') return await reportPdf(event);
      return await status(event);
    }
    return reply(405, {error: 'Use GET or POST.'});
  } catch (error) {
    const status = Number(error?.status);
    if (Number.isInteger(status) && status >= 400 && status < 500) {
      return reply(status, {error: error.message, code: error.code || 'CONTENT_DECAY_REQUEST'});
    }
    console.error('Content decay API failed', status || 500, error.code || 'internal');
    return reply(503, {
      error: 'The Content Decay service is temporarily unavailable. Please retry.',
      code: 'CONTENT_DECAY_UNAVAILABLE'
    });
  }
};
