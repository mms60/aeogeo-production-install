#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');

const HOME = 'https://aeogeosearch.com/';
const FREE_TOOLS = 'https://aeogeosearch.com/free-tools/';
const EXPECTED_BING = '2E167DAFE14DBC1C787CCF4F3D1D6ED9';
const EXPECTED_FREE_TOOLS_TITLE = 'Free SEO, AEO & GEO Tools for AI Search Optimization';
const USER_AGENT = 'AEOGEO post-deploy smoke check';

function decode(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function metaValues(html, key) {
  const values = [];
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = tag.match(/\b(?:property|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!name) continue;
    if ((name[1] || name[2] || name[3] || '').toLowerCase() !== key.toLowerCase()) continue;
    const content = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    values.push(decode(content ? (content[1] || content[2] || content[3]) : ''));
  }
  return values;
}

function checkBing(html) {
  const head = (html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i) || [])[1] || '';
  const tags = [...head.matchAll(/<meta\b[^>]*\bname\s*=\s*["']?msvalidate\.01["']?[^>]*>/gi)].map(match => match[0]);
  assert.equal(tags.length, 1, `expected one msvalidate.01 tag in <head>, found ${tags.length}`);
  assert.match(tags[0], new RegExp(`\\bcontent\\s*=\\s*["']?${EXPECTED_BING}["']?`, 'i'));
  assert.equal((html.match(/msvalidate\.01/gi) || []).length, 1, 'expected exactly one msvalidate.01 occurrence');
}

async function fetchText(url) {
  const response = await fetch(url, {
    cache: 'no-store',
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
    headers: { 'user-agent': USER_AGENT }
  });
  assert.equal(response.status, 200, `${url}: HTTP ${response.status}`);
  return response.text();
}

(async () => {
  const home = await fetchText(HOME);
  checkBing(home);
  console.log(`Bing tag OK: ${HOME}`);

  const freeTools = await fetchText(FREE_TOOLS);
  const title = (freeTools.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  assert.ok(title, `${FREE_TOOLS}: no <title> found`);
  assert.equal(decode(title).replace(/\s+/g, ' ').trim(), EXPECTED_FREE_TOOLS_TITLE);
  console.log(`Free-tools title OK: ${EXPECTED_FREE_TOOLS_TITLE}`);

  const imageUrls = metaValues(home, 'og:image');
  assert.equal(imageUrls.length, 1, `expected one og:image, found ${imageUrls.length}`);
  const imageUrl = new URL(imageUrls[0]);
  assert.equal(imageUrl.protocol, 'https:', 'og:image must be absolute HTTPS');

  const imageAlt = metaValues(home, 'og:image:alt')[0];
  assert.ok(imageAlt, 'og:image:alt is missing');
  assert.equal(metaValues(home, 'og:image:width')[0], '1200');
  assert.equal(metaValues(home, 'og:image:height')[0], '630');

  const imageResponse = await fetch(imageUrl, {
    method: 'HEAD',
    cache: 'no-store',
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
    headers: { 'user-agent': USER_AGENT }
  });
  assert.equal(imageResponse.status, 200, `${imageUrl}: HTTP ${imageResponse.status}`);
  assert.match(imageResponse.headers.get('content-type') || '', /^image\/jpeg\b/i);
  assert.ok(Number(imageResponse.headers.get('content-length') || 0) > 0, 'OG image has no content-length');
  console.log(`OG image OK: ${imageUrl} (${imageResponse.headers.get('content-type')}, ${imageResponse.headers.get('content-length')} bytes)`);
  console.log(`OG alt OK: ${imageAlt}`);
})().catch(error => {
  console.error(`Post-deploy smoke check failed: ${error.message}`);
  process.exitCode = 1;
});
