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

function clean(value) {
  return decode(value).replace(/\s+/g, ' ').trim();
}

function headOf(html) {
  return (html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i) || [])[1] || '';
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

function singleMeta(html, key) {
  const values = metaValues(html, key);
  assert.equal(values.length, 1, `expected one ${key} meta tag, found ${values.length}`);
  return values[0];
}

function pageTitle(html) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  assert.ok(match, 'homepage has no <title>');
  return clean(match[1]);
}

function jpegDimensions(buffer) {
  assert.ok(buffer.length >= 4, 'image is empty');
  assert.equal(buffer[0], 0xff, 'image is not a JPEG');
  assert.equal(buffer[1], 0xd8, 'image is not a JPEG');

  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }

    const length = buffer.readUInt16BE(offset + 2);
    assert.ok(length >= 2 && offset + 2 + length <= buffer.length, `invalid JPEG segment at byte ${offset}`);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return {
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5)
      };
    }
    offset += 2 + length;
  }

  throw new Error('JPEG dimensions not found');
}

function checkBing(html) {
  const head = headOf(html);
  const tags = [...head.matchAll(/<meta\b[^>]*\bname\s*=\s*["']?msvalidate\.01["']?[^>]*>/gi)].map(match => match[0]);
  assert.equal(tags.length, 1, `expected one msvalidate.01 tag in <head>, found ${tags.length}`);
  assert.match(tags[0], new RegExp(`\\bcontent\\s*=\\s*["']?${EXPECTED_BING}["']?`, 'i'));
  assert.equal((html.match(/msvalidate\.01/gi) || []).length, 1, 'expected exactly one msvalidate.01 occurrence');
  assert.equal((html.match(/<body\b/gi) || []).length, 1, 'expected exactly one <body> element');
  assert.equal((html.match(/<\/body\s*>/gi) || []).length, 1, 'expected exactly one closing </body> tag');
  assert.equal((html.match(/<\/html\s*>/gi) || []).length, 1, 'expected exactly one closing </html> tag');
}

async function checkSocialPreview(html) {
  const head = headOf(html);
  const title = pageTitle(html);
  const description = clean(singleMeta(head, 'description'));
  assert.ok(description, 'homepage meta description is missing');

  const ogTitle = clean(singleMeta(head, 'og:title'));
  const ogDescription = clean(singleMeta(head, 'og:description'));
  const ogUrl = singleMeta(head, 'og:url');
  const ogImage = singleMeta(head, 'og:image');
  const ogImageAlt = clean(singleMeta(head, 'og:image:alt'));
  const twitterCard = singleMeta(head, 'twitter:card');
  const twitterTitle = clean(singleMeta(head, 'twitter:title'));
  const twitterDescription = clean(singleMeta(head, 'twitter:description'));
  const twitterImage = singleMeta(head, 'twitter:image');
  const twitterImageAlt = clean(singleMeta(head, 'twitter:image:alt'));

  assert.equal(singleMeta(head, 'og:type'), 'website');
  assert.ok(clean(singleMeta(head, 'og:site_name')), 'og:site_name is missing');
  assert.ok(clean(singleMeta(head, 'og:locale')), 'og:locale is missing');
  assert.equal(ogTitle, title, 'og:title must match the homepage title');
  assert.equal(ogDescription, description, 'og:description must match the meta description');
  assert.equal(ogUrl, HOME, 'og:url must be the canonical homepage URL');
  assert.equal(twitterCard, 'summary_large_image');
  assert.equal(twitterTitle, title, 'twitter:title must match the homepage title');
  assert.equal(twitterDescription, description, 'twitter:description must match the meta description');
  assert.equal(twitterImage, ogImage, 'twitter:image must match og:image');
  assert.equal(twitterImageAlt, ogImageAlt, 'twitter:image:alt must match og:image:alt');
  assert.ok(ogImageAlt, 'og:image:alt is missing');
  assert.match(ogImage, /^https:\/\//, 'og:image must be an absolute HTTPS URL');
  assert.equal(singleMeta(head, 'og:image:type'), 'image/jpeg');
  assert.equal(singleMeta(head, 'og:image:width'), '1200');
  assert.equal(singleMeta(head, 'og:image:height'), '630');

  const imageUrl = new URL(ogImage);
  assert.equal(imageUrl.protocol, 'https:', 'og:image must use HTTPS');

  const imageResponse = await fetch(imageUrl, {
    method: 'GET',
    cache: 'no-store',
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
    headers: { 'user-agent': USER_AGENT, accept: 'image/jpeg' }
  });
  assert.equal(imageResponse.status, 200, `${imageUrl}: HTTP ${imageResponse.status}`);
  const contentType = imageResponse.headers.get('content-type') || '';
  assert.match(contentType, /^image\/jpeg\b/i);
  const imageBytes = Buffer.from(await imageResponse.arrayBuffer());
  assert.ok(imageBytes.length > 0, 'OG image response is empty');
  assert.deepEqual(jpegDimensions(imageBytes), { width: 1200, height: 630 });

  console.log(`Social metadata OK: ${title}`);
  console.log(`OG/Twitter image OK: ${imageUrl} (1200x630 ${contentType}, ${imageBytes.length} bytes)`);
  console.log(`OG/Twitter alt OK: ${ogImageAlt}`);
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

  await checkSocialPreview(home);

  const freeTools = await fetchText(FREE_TOOLS);
  const title = (freeTools.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  assert.ok(title, `${FREE_TOOLS}: no <title> found`);
  assert.equal(clean(title), EXPECTED_FREE_TOOLS_TITLE);
  console.log(`Free-tools title OK: ${EXPECTED_FREE_TOOLS_TITLE}`);
})().catch(error => {
  console.error(`Post-deploy smoke check failed: ${error.message}`);
  process.exitCode = 1;
});
