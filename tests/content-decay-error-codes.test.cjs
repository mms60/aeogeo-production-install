'use strict';

// Regression tests for scan-failure reporting.
//
// The free scan used to answer every pre-page failure with the same
// CONTENT_DECAY_CRAWL_FAILED, and the worker logged only that code, so a DNS
// typo, a broken certificate and a refused connection were indistinguishable
// from the browser and from the Netlify logs.

const test = require('node:test');
const assert = require('node:assert/strict');

const state = {scan: null};

function stub(request, exports) {
  const path = require.resolve(request);
  require.cache[path] = {id: path, filename: path, loaded: true, exports};
}

// The status route reads the scan row through this module and nothing else.
stub('../netlify/functions/lib/db', {
  db: async () => (state.scan ? [state.scan] : []),
  user: async () => null,
  reply: (statusCode, body) => ({statusCode, body: JSON.stringify(body)}),
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
});

const {errorCode} = require('../netlify/functions/content-decay-scan-background');
const {handler} = require('../netlify/functions/content-decay-api');

function failure(code, message) {
  const error = new Error(message);
  if (code) error.code = code;
  return error;
}

function token() {
  return 'a'.repeat(48);
}

async function statusFor(errorCodeValue) {
  state.scan = {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'failed',
    hostname: 'example.com',
    page_limit: 10,
    pages_scanned: 0,
    overall_score: null,
    summary: null,
    error_code: errorCodeValue,
    created_at: '2026-11-20T00:00:00.000Z',
    started_at: '2026-11-20T00:00:01.000Z',
    completed_at: '2026-11-20T00:00:02.000Z'
  };
  const response = await handler({
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: {token: 'a'.repeat(48)}
  });
  assert.equal(response.statusCode, 200, response.body);
  return JSON.parse(response.body);
}

test('a name that does not resolve gets its own code', () => {
  assert.equal(
    errorCode(failure('ENOTFOUND', 'getaddrinfo ENOTFOUND aeogeosarch.com')),
    'CONTENT_DECAY_DNS_FAILED');
  assert.equal(
    errorCode(failure('EAI_AGAIN', 'getaddrinfo EAI_AGAIN example.com')),
    'CONTENT_DECAY_DNS_FAILED');
  assert.equal(errorCode(failure(null, 'Website DNS timed out.')), 'CONTENT_DECAY_DNS_FAILED');
});

test('a broken certificate gets its own code, not a timeout', () => {
  assert.equal(errorCode(failure('EPROTO', 'write EPROTO 1234:error:0A000152')), 'CONTENT_DECAY_TLS_FAILED');
  assert.equal(errorCode(failure('CERT_HAS_EXPIRED', 'certificate has expired')), 'CONTENT_DECAY_TLS_FAILED');
  assert.equal(
    errorCode(failure(null, 'unable to verify the first certificate')),
    'CONTENT_DECAY_TLS_FAILED');
});

test('a refused or dropped connection gets its own code', () => {
  assert.equal(
    errorCode(failure('ECONNREFUSED', 'connect ECONNREFUSED 1.2.3.4:443')),
    'CONTENT_DECAY_CONNECTION_FAILED');
  assert.equal(errorCode(failure('ECONNRESET', 'socket hang up')), 'CONTENT_DECAY_CONNECTION_FAILED');
  assert.equal(errorCode(failure('EHOSTUNREACH', 'connect EHOSTUNREACH')), 'CONTENT_DECAY_CONNECTION_FAILED');
});

test('the existing codes keep their own cases', () => {
  assert.equal(
    errorCode(failure(null, 'This site robots.txt does not permit our crawler at that address.')),
    'CONTENT_DECAY_ROBOTS_DISALLOWED');
  assert.equal(
    errorCode(failure(null, 'Page exceeds the 1.8 MB audit download limit.')),
    'CONTENT_DECAY_PAGE_TOO_LARGE');
  assert.equal(errorCode(failure(null, 'Website response timed out.')), 'CONTENT_DECAY_TIMEOUT');
  assert.equal(errorCode(failure(null, 'Too many website redirects.')), 'CONTENT_DECAY_REDIRECT_LIMIT');
  assert.equal(errorCode(failure(null, 'Enter a valid public website address.')), 'CONTENT_DECAY_INVALID_URL');
});

test('an error that already carries a content decay code is passed through', () => {
  assert.equal(
    errorCode(failure('CONTENT_DECAY_ROBOTS_DISALLOWED', 'ignored')),
    'CONTENT_DECAY_ROBOTS_DISALLOWED');
});

test('an unrecognised failure still falls back to the generic code', () => {
  assert.equal(errorCode(failure(null, 'Something else entirely.')), 'CONTENT_DECAY_CRAWL_FAILED');
  assert.equal(errorCode(undefined), 'CONTENT_DECAY_CRAWL_FAILED');
});

test('the status response explains a DNS failure in plain language', async () => {
  const body = await statusFor('CONTENT_DECAY_DNS_FAILED');
  assert.match(body.error, /^That website address did not resolve\./);
  assert.match(body.error, /Check the spelling of the address and try again\./);
  assert.match(body.error, /Reference: CONTENT_DECAY_DNS_FAILED\.$/);
});

test('the status response explains a TLS failure in plain language', async () => {
  const body = await statusFor('CONTENT_DECAY_TLS_FAILED');
  assert.match(body.error, /secure certificate could not be verified/);
  assert.match(body.error, /Reference: CONTENT_DECAY_TLS_FAILED\.$/);
});

test('the status response explains a connection failure in plain language', async () => {
  const body = await statusFor('CONTENT_DECAY_CONNECTION_FAILED');
  assert.match(body.error, /refused or dropped the connection/);
  assert.match(body.error, /Reference: CONTENT_DECAY_CONNECTION_FAILED\.$/);
});

test('other failure codes keep the original generic wording', async () => {
  const body = await statusFor('CONTENT_DECAY_ROBOTS_DISALLOWED');
  assert.match(body.error, /^The scan could not finish\./);
  assert.match(body.error, /Reference: CONTENT_DECAY_ROBOTS_DISALLOWED\.$/);
});

test('the scan response keeps exactly the same fields', async () => {
  const body = await statusFor('CONTENT_DECAY_DNS_FAILED');
  assert.deepEqual(Object.keys(body).sort(), [
    'completedAt', 'createdAt', 'error', 'hostname', 'id', 'overallScore', 'pageLimit',
    'pagesScanned', 'startedAt', 'status', 'summary', 'token'
  ].sort());
  assert.equal(body.status, 'failed');
  assert.equal(body.token, token());
});

test('a completed scan has no error text', async () => {
  state.scan = {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'completed',
    hostname: 'example.com',
    page_limit: 10,
    pages_scanned: 6,
    overall_score: 71,
    summary: {},
    error_code: null,
    created_at: '2026-11-20T00:00:00.000Z',
    started_at: '2026-11-20T00:00:01.000Z',
    completed_at: '2026-11-20T00:00:02.000Z'
  };
  const response = await handler({
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: {token: token()}
  });
  const body = JSON.parse(response.body);
  assert.equal(body.error, null);
});
