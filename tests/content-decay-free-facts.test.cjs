'use strict';

// The free scan summary now shows one facts number: how many claims were
// compared and how many disagreements were found between pages. It must never
// carry the conflicts themselves, because those are the paid report.
//
// These tests pin three things: the counts reach the browser, no conflict
// detail does, and an unfinished or facts-less scan shows nothing at all.

const test = require('node:test');
const assert = require('node:assert/strict');

const state = {scan: null, facts: 0, conflicts: 0, tablesMissing: false, queried: []};

function stub(request, exports) {
  const path = require.resolve(request);
  require.cache[path] = {id: path, filename: path, loaded: true, exports};
}

stub('../netlify/functions/lib/db', {
  db: async query => {
    state.queried.push(query);
    if (query.startsWith('content_decay_scans')) return state.scan ? [state.scan] : [];
    if (query.startsWith('content_decay_fact_claims')) {
      if (state.tablesMissing) throw new Error('relation does not exist');
      return Array.from({length: state.facts}, () => ({category: 'pricing'}));
    }
    if (query.startsWith('content_decay_fact_conflicts')) {
      if (state.tablesMissing) throw new Error('relation does not exist');
      return Array.from({length: state.conflicts}, () => ({severity: 'medium'}));
    }
    throw new Error('unexpected query: ' + query);
  },
  user: async () => null,
  reply: (statusCode, body) => ({statusCode, body: JSON.stringify(body)}),
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
});

const {handler} = require('../netlify/functions/content-decay-api');

const TOKEN = 'b'.repeat(48);

function completedScan() {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    status: 'completed',
    hostname: 'example.com',
    page_limit: 10,
    pages_scanned: 10,
    overall_score: 61,
    summary: {averageWords: 640},
    error_code: null,
    created_at: '2026-11-24T10:00:00.000Z',
    started_at: '2026-11-24T10:00:01.000Z',
    completed_at: '2026-11-24T10:01:00.000Z'
  };
}

async function statusOf() {
  const response = await handler({
    httpMethod: 'GET',
    queryStringParameters: {token: TOKEN},
    headers: {}
  });
  return {status: response.statusCode, body: JSON.parse(response.body)};
}

test('a completed scan reports how many facts were compared and how many disagreed', async () => {
  state.scan = completedScan();
  state.facts = 32;
  state.conflicts = 3;
  state.tablesMissing = false;
  state.queried = [];

  const {status, body} = await statusOf();
  assert.equal(status, 200);
  assert.deepEqual(body.factCheck, {factsCompared: 32, disagreements: 3});
});

test('the free response carries counts only, never a conflict value, quote or page', async () => {
  state.scan = completedScan();
  state.facts = 32;
  state.conflicts = 3;
  state.tablesMissing = false;

  const {body} = await statusOf();
  const json = JSON.stringify(body);
  for (const field of ['valueA', 'valueB', 'quoteA', 'quoteB', 'pageAUrl', 'pageBUrl', 'recommendation', 'attribute']) {
    assert.equal(json.includes(field), false, 'free response must not include ' + field);
  }
});

test('an unfinished scan is never charged for the fact counts', async () => {
  state.scan = {...completedScan(), status: 'running'};
  state.facts = 0;
  state.conflicts = 0;
  state.queried = [];

  const {body} = await statusOf();
  assert.equal(body.factCheck, null);
  assert.deepEqual(
    state.queried.filter(query => query.includes('content_decay_fact_')),
    [],
    'polls before completion must not query the fact tables'
  );
});

test('a database without the fact tables hides the block instead of failing the scan', async () => {
  state.scan = completedScan();
  state.tablesMissing = true;

  const {status, body} = await statusOf();
  assert.equal(status, 200);
  assert.equal(body.factCheck, null);
  assert.equal(body.status, 'completed');
});
