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

  process.env.URL = 'https://aeogeosearch.com';
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

  // The public-address check resolves hosts through DNS-over-HTTPS, so the stub
  // answers the resolver and the page fetch separately.
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.startsWith('https://cloudflare-dns.com/dns-query')) {
      const query = new URL(href);
      assert.equal(query.searchParams.get('name'), 'example.com');
      const type = query.searchParams.get('type');
      return Response.json({
        Status: 0,
        Answer: type === 'A' ? [{ type: 1, data: '93.184.216.34' }] : []
      });
    }
    assert.equal(href, 'https://example.com/');
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
      url: 'https://example.com/',
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
