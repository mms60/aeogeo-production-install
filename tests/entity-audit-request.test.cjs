'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const handlerPath = path.join(__dirname, '..', 'netlify', 'functions', 'entity-audit.mjs');

test('entity-audit accepts a Netlify Web Request and returns parsed JSON-LD', async t => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.URL;
  const previousKgKey = process.env.GOOGLE_KG_API_KEY;
  const previousSupabaseUrl = process.env.SUPABASE_URL;
  const previousServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  process.env.URL = 'https://aeogeosearch.com';
  process.env.SUPABASE_URL = 'https://fixture.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_fixture_only';
  delete process.env.GOOGLE_KG_API_KEY;

  const html = `<!doctype html><html><head>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          "@id": "https://example.com/#organization",
          "name": "Example",
          "sameAs": ["https://www.linkedin.com/company/example"]
        }
      ]
    }
    </script>
  </head><body></body></html>`;

  globalThis.fetch = async (url) => {
    if (String(url).startsWith('https://fixture.supabase.co/rest/v1/rpc/consume_audit_rate_limit')) {
      return Response.json(true);
    }
    assert.equal(String(url), 'https://93.184.216.34/');
    return new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  };

  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.URL;
    else process.env.URL = previousUrl;
    if (previousKgKey === undefined) delete process.env.GOOGLE_KG_API_KEY;
    else process.env.GOOGLE_KG_API_KEY = previousKgKey;
    if (previousSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousSupabaseUrl;
    if (previousServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceKey;
  });

  const { default: handler } = await import(pathToFileURL(handlerPath).href);
  const request = new Request('https://aeogeosearch.com/.netlify/functions/entity-audit', {
    method: 'POST',
    headers: {
      origin: 'https://aeogeosearch.com',
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.10'
    },
    body: JSON.stringify({
      url: 'https://93.184.216.34/',
      brandName: 'Example'
    })
  });

  const response = await handler(request);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /application\/json/);

  const body = await response.json();
  assert.equal(body.httpStatus, 200);
  assert.equal(body.brandName, 'Example');
  assert.equal(body.jsonLdBlocksFound, 1);
  assert.equal(body.malformedJsonLdBlocks, 0);
  assert.equal(body.hasUnifiedGraph, true);
  assert.equal(body.hasPersistentIds, true);
  assert.equal(body.hasSameAsAnchors, true);
});
