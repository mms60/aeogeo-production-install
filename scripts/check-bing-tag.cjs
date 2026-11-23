#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SITE_URL = 'https://aeogeosearch.com/';
const EXPECTED = '2E167DAFE14DBC1C787CCF4F3D1D6ED9';
const TAG = `<meta name="msvalidate.01" content="${EXPECTED}" />`;
const HOMEPAGE = path.join(__dirname, '..', 'site', 'index.html');

function inspect(html, label) {
  const headMatch = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  if (!headMatch) throw new Error(`${label}: no <head> element found`);

  const body = html.match(/<body\b[^>]*>/i);
  if (!body) throw new Error(`${label}: no <body> element found`);
  if ((html.match(/<body\b/gi) || []).length !== 1) throw new Error(`${label}: expected exactly 1 <body> element`);
  if ((html.match(/<\/body\s*>/gi) || []).length !== 1) throw new Error(`${label}: expected exactly 1 closing </body> tag`);
  if ((html.match(/<\/html\s*>/gi) || []).length !== 1) throw new Error(`${label}: expected exactly 1 closing </html> tag`);

  const head = headMatch[1];
  const tags = [...head.matchAll(/<meta\b[^>]*\bname\s*=\s*["']?msvalidate\.01["']?[^>]*>/gi)]
    .map(match => match[0]);

  if (tags.length !== 1) {
    throw new Error(`${label}: expected exactly 1 msvalidate.01 tag in <head>, found ${tags.length}`);
  }

  const contentPattern = new RegExp(`\\bcontent\\s*=\\s*["']?${EXPECTED}["']?`, 'i');
  if (!contentPattern.test(tags[0])) {
    throw new Error(`${label}: msvalidate.01 content does not match ${EXPECTED}`);
  }

  const total = (html.match(/msvalidate\.01/gi) || []).length;
  if (total !== 1) {
    throw new Error(`${label}: expected exactly 1 msvalidate.01 occurrence in the document, found ${total}`);
  }
  if (html.search(/msvalidate\.01/i) > body.index) {
    throw new Error(`${label}: msvalidate.01 must appear before the <body> tag`);
  }

  return tags[0];
}

function addTag(html) {
  if (/msvalidate\.01/i.test(html)) return html;

  const googleTag = /<meta\b[^>]*\bname\s*=\s*["']?google-site-verification["']?[^>]*>/i;
  const googleMatch = html.match(googleTag);
  if (googleMatch) {
    const at = googleMatch.index + googleMatch[0].length;
    return `${html.slice(0, at)}\n${TAG}${html.slice(at)}`;
  }

  const head = html.match(/<head\b[^>]*>/i);
  if (!head) throw new Error('no <head> element found');
  const at = head.index + head[0].length;
  return `${html.slice(0, at)}\n${TAG}${html.slice(at)}`;
}

async function inspectProduction() {
  const response = await fetch(SITE_URL, {
    cache: 'no-store',
    redirect: 'follow',
    headers: { 'user-agent': 'AEOGEO rollback verification check' }
  });
  if (!response.ok) throw new Error(`${SITE_URL}: HTTP ${response.status}`);

  const tag = inspect(await response.text(), SITE_URL);
  console.log(`Production OK: ${response.url} -> ${tag}`);
}

(async () => {
  const write = process.argv.includes('--write');
  let html = fs.readFileSync(HOMEPAGE, 'utf8');

  if (write) {
    const next = addTag(html);
    if (next !== html) {
      fs.writeFileSync(HOMEPAGE, next);
      html = next;
      console.log(`Inserted Bing verification tag into ${HOMEPAGE}`);
    }
  }

  const tag = inspect(html, HOMEPAGE);
  console.log(`Local OK: ${HOMEPAGE} -> ${tag}`);

  if (process.argv.includes('--production')) await inspectProduction();
})().catch(error => {
  console.error(`Bing verification check failed: ${error.message}`);
  process.exitCode = 1;
});
