'use strict';

// Regression test for the free scan route. The API used to import normalURL
// from the Content Decay crawler, which did not re-export it, so every real
// scan failed with "normalURL is not a function". This runs the route with the
// database and background dispatch stubbed and a valid URL.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.PUBLIC_SITE_URL = 'https://aeogeosearch.com';

const state = {rows: [], dispatch: null};

function stub(request, exports) {
  const path = require.resolve(request);
  require.cache[path] = {id: path, filename: path, loaded: true, exports};
}

stub('../netlify/functions/lib/db', {
  db: async (path, options = {}) => {
    if (path === 'content_decay_scans' && options.method === 'POST') {
      state.rows.push(options.body);
      return [options.body];
    }
    throw new Error('Unexpected database call: ' + path);
  },
  user: async () => null,
  reply: (statusCode, body) => ({
    statusCode,
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  }),
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
});

stub('../netlify/functions/lib/content-decay-config', {
  environment: () => 'live',
  credential: () => ({key: 'sk_live_fake', mode: 'live'}),
  priceId: () => 'price_live_123',
  webhookSecret: () => 'whsec_fake',
  signingSecret: () => 's'.repeat(32),
  freePageLimit: () => 10,
  aiEnabled: () => false,
  describe: () => ({})
});

const originalFetch = global.fetch;
global.fetch = async (url, options) => {
  state.dispatch = {url: String(url), body: JSON.parse(options.body)};
  return {ok: true, status: 202};
};

const {handler} = require('../netlify/functions/content-decay-api');

test('a valid free scan is recorded and dispatched to the worker', async () => {
  state.rows = [];
  state.dispatch = null;
  const response = await handler({
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify({url: 'https://example.com'})
  });

  assert.equal(response.statusCode, 202, response.body);
  const body = JSON.parse(response.body);
  assert.match(body.token, /^[0-9a-f]{48}$/);
  assert.equal(body.status, 'queued');
  assert.equal(body.pageLimit, 10);

  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].hostname, 'example.com');
  assert.equal(state.rows[0].environment, 'live');
  assert.equal(state.rows[0].status, 'queued');
  assert.equal(state.rows[0].test_run_id, null);

  assert.ok(state.dispatch, 'the background worker was not dispatched');
  assert.match(state.dispatch.url, /\/\.netlify\/functions\/content-decay-scan-background$/);
  assert.equal(state.dispatch.body.scanId, state.rows[0].id);
  assert.match(state.dispatch.body.signature, /^[0-9a-f]{64}$/);
});

test.after(() => {
  global.fetch = originalFetch;
});
