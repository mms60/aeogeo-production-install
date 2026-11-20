'use strict';
// Content Decay Predictor - background scan worker (Phase 3).
//
// Invoked only by content-decay-api.js with an HMAC-signed payload. A browser
// cannot start a crawl directly: the signature covers the scan id and a
// timestamp, and a stale or forged dispatch is rejected before any network
// access.
//
// The worker crawls up to the scan's page limit, persists per-page signals,
// runs the deterministic decay rules and stores the resulting findings and
// page scores. Findings stay unreadable until a verified purchase exists in
// Phase 5; the free API never selects those tables.

const crypto = require('node:crypto');
const {db, reply} = require('./lib/db');
const {crawlSite, summarise} = require('./lib/content-decay-crawler');
const {analyseScan} = require('./lib/content-decay-analysis');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function signingSecret() {
  const secret = process.env.CONTENT_DECAY_SIGNING_SECRET || '';
  return secret.length >= 32 ? secret : '';
}

function verifyDispatch(scanId, time, signature) {
  const secret = signingSecret();
  if (!secret) return false;
  if (!UUID.test(String(scanId || ''))) return false;
  if (!/^\d+$/.test(String(time || ''))) return false;
  if (Math.abs(Date.now() - Number(time)) > 300000) return false;
  if (!/^[0-9a-f]{64}$/i.test(String(signature || ''))) return false;
  const expected = crypto.createHmac('sha256', secret).update(scanId + ':' + time).digest();
  const supplied = Buffer.from(signature, 'hex');
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

function errorCode(error) {
  if (error?.code && /^CONTENT_DECAY_/.test(error.code)) return error.code;
  const message = String(error?.message || '');
  if (/robots\.txt/i.test(message)) return 'CONTENT_DECAY_ROBOTS_DISALLOWED';
  if (/1\.8 MB|too large/i.test(message)) return 'CONTENT_DECAY_PAGE_TOO_LARGE';
  if (/timed out|timeout/i.test(message)) return 'CONTENT_DECAY_TIMEOUT';
  if (/redirect/i.test(message)) return 'CONTENT_DECAY_REDIRECT_LIMIT';
  if (/valid public website|HTTPS|domain/i.test(message)) return 'CONTENT_DECAY_INVALID_URL';
  return 'CONTENT_DECAY_CRAWL_FAILED';
}

exports.handler = async event => {
  if (String(event.httpMethod || '').toUpperCase() !== 'POST') {
    return reply(405, {error: 'POST required'});
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return reply(400, {error: 'Invalid dispatch payload'});
  }
  if (!verifyDispatch(body.scanId, body.time, body.signature)) {
    return reply(401, {error: 'Invalid dispatch signature'});
  }

  const scanId = body.scanId;
  try {
    const rows = await db(
      'content_decay_scans?id=eq.' + scanId + '&select=id,target_url,page_limit'
    );
    const scan = Array.isArray(rows) ? rows[0] : null;
    if (!scan) return reply(404, {error: 'Unknown scan'});

    await db('content_decay_scans?id=eq.' + scanId, {
      method: 'PATCH',
      body: {status: 'running', started_at: new Date().toISOString(), error_code: null}
    });

    const crawl = await crawlSite({targetUrl: scan.target_url, pageLimit: scan.page_limit});
    const analysis = analyseScan({pages: crawl.pages, today: new Date()});

    // Idempotent: a retried dispatch replaces the previous page set. Findings
    // cascade from the deleted pages, so a retry cannot leave stale rows.
    await db('content_decay_scan_pages?scan_id=eq.' + scanId, {method: 'DELETE'});

    let pageIdByUrl = new Map();
    if (crawl.pages.length) {
      await db('content_decay_scan_pages', {
        method: 'POST',
        body: crawl.pages.map(page => ({
          scan_id: scanId,
          url: page.url,
          http_status: page.httpStatus,
          title: page.title,
          word_count: page.wordCount,
          content_hash: page.contentHash,
          declared_modified_at: page.declaredModifiedAt,
          signals: page.signals
        }))
      });
      const stored = await db('content_decay_scan_pages?scan_id=eq.' + scanId + '&select=id,url');
      pageIdByUrl = new Map((Array.isArray(stored) ? stored : []).map(row => [row.url, row.id]));
    }

    if (analysis.findings.length) {
      await db('content_decay_findings', {
        method: 'POST',
        body: analysis.findings.map(finding => ({
          scan_id: scanId,
          page_id: pageIdByUrl.get(finding.pageUrl) || null,
          category: finding.category,
          code: finding.code,
          severity: finding.severity,
          priority: finding.priority,
          title: finding.title,
          detail: finding.detail,
          evidence: finding.evidence,
          recommendation: finding.recommendation,
          suggested_replacement: finding.suggestedReplacement
        }))
      });
    }

    for (const page of analysis.pages) {
      const pageId = pageIdByUrl.get(page.url);
      if (!pageId) continue;
      await db('content_decay_scan_pages?id=eq.' + pageId, {
        method: 'PATCH',
        body: {page_score: page.pageScore, severity: page.severity}
      });
    }

    await db('content_decay_scans?id=eq.' + scanId, {
      method: 'PATCH',
      body: {
        status: 'completed',
        pages_scanned: crawl.pages.length,
        overall_score: analysis.overallScore,
        summary: summarise(crawl.pages, new Date(), {
          discovered: crawl.discovered,
          discoveredIsLowerBound: crawl.discoveredIsLowerBound,
          skippedCount: crawl.skippedCount,
          unvisited: crawl.unvisited,
          stopReason: crawl.stopReason
        }),
        completed_at: new Date().toISOString(),
        error_code: null
      }
    });

    return reply(200, {ok: true, pages: crawl.pages.length});
  } catch (error) {
    console.error('Content decay scan failed', scanId, errorCode(error));
    try {
      await db('content_decay_scans?id=eq.' + scanId, {
        method: 'PATCH',
        body: {
          status: 'failed',
          error_code: errorCode(error),
          completed_at: new Date().toISOString()
        }
      });
    } catch { /* the scan stays queued and is recoverable */ }
    return reply(200, {ok: false});
  }
};
