#!/usr/bin/env node
'use strict';
/**
 * Aligns each prerendered article page's metadata with the bundle's article data.
 * Body copy, tables and sources are left untouched.
 *
 *   node artifacts/sync-article-pages.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const APP = fs.readFileSync(path.join(SITE, 'assets', 'app.js'), 'utf8');

function articleData() {
  const start = APP.indexOf('Co=[') + 3;
  if (start < 3) throw new Error('article array not found');
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < APP.length; i += 1) {
    const c = APP[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[') depth += 1;
    else if (c === ']') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error('unbalanced article array');
  return new Function(`return ${APP.slice(start, end + 1)}`)();
}

const escText = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => escText(s).replace(/"/g, '&quot;');

function setMeta(html, attr, value) {
  const re = new RegExp(`<meta\\b[^>]*\\b${attr}\\b[^>]*>`, 'gi');
  let count = 0;
  const out = html.replace(re, tag => {
    count += 1;
    if (/\bcontent="[^"]*"/.test(tag)) return tag.replace(/\bcontent="[^"]*"/, `content="${escAttr(value)}"`);
    if (/\bcontent=[^\s>]+/.test(tag)) return tag.replace(/\bcontent=[^\s>]+/, `content="${escAttr(value)}"`);
    return tag;
  });
  return { html: out, count };
}

function articleJsonLd(html) {
  const re = /<script type=application\/ld\+json>([\s\S]*?)<\/script>/g;
  let match;
  while ((match = re.exec(html))) {
    let data;
    try {
      data = JSON.parse(match[1]);
    } catch {
      continue;
    }
    if (data['@type'] === 'Article') return { data, raw: match[1], start: match.index, end: re.lastIndex };
  }
  return null;
}

function syncArticle(article) {
  const file = path.join(SITE, 'resources', article.anchor, 'index.html');
  if (!fs.existsSync(file)) return { anchor: article.anchor, skipped: 'missing page' };
  let html = fs.readFileSync(file, 'utf8');
  const url = `https://aeogeosearch.com/resources/${article.anchor}/`;
  const description = article.metaDescription || article.answer;
  const fullTitle = `${article.title} | AEOGEO Search`;
  const changes = [];

  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/);
  if (titleMatch && titleMatch[1] !== fullTitle) {
    html = html.replace(titleMatch[0], `<title>${escText(fullTitle)}</title>`);
    changes.push('title');
  }

  const artMatch = html.match(/<article\b[\s\S]*?<\/article>/);
  if (!artMatch) return { anchor: article.anchor, skipped: 'no article block' };
  let art = artMatch[0];

  const h1 = art.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/);
  const h1Expected = `<h1 class="font-display text-2xl font-extrabold leading-tight tracking-tight text-white sm:text-3xl">${escText(article.title)}</h1>`;
  if (h1 && h1[0] !== h1Expected) {
    art = art.replace(h1[0], h1Expected);
    changes.push('h1');
  }

  const closedQuick =
    article.answer && art.match(/(<h2[^>]*>Quick answer<\/h2>\s*<p[^>]*>)([\s\S]*?)(<\/p>\s*<\/div>)/);
  const openQuick =
    article.answer && art.match(/(<h2[^>]*>Quick answer<\/h2>\s*<p[^>]*>)([\s\S]*?)(<\/div>)/);
  const quick = closedQuick || openQuick;
  if (quick) {
    if (quick[2] !== escText(article.answer)) {
      art = art.replace(quick[0], `${quick[1]}${escText(article.answer)}${quick[3]}`);
      changes.push('quick answer');
    }
  } else if (article.answer) {
    const author = art.match(/<p\b[^>]*data-aeogeo-article-author[^>]*>[\s\S]*?<\/p>/);
    const block = `<div class="my-5 rounded-r-2xl border-l-[3px] border-royal-500 bg-royal-500/[0.09] px-5 py-4"><h2 class="mb-1.5 block font-display text-[0.68rem] font-bold uppercase tracking-[0.14em] text-royal-400">Quick answer</h2><p class="m-0 font-medium text-ice-100">${escText(article.answer)}</p></div>`;
    if (author) {
      art = art.replace(author[0], author[0] + block);
      changes.push('quick answer added');
    }
  }

  if (art !== artMatch[0]) html = html.replace(artMatch[0], art);

  for (const [attr, value] of [
    ['name=description', description],
    ['property=og:description', description],
    ['name=twitter:description', description],
    ['property=og:title', fullTitle],
    ['name=twitter:title', fullTitle],
    ['property=og:url', url],
  ]) {
    const result = setMeta(html, attr, value);
    html = result.html;
    if (result.count) changes.push(`${attr} x${result.count}`);
  }

  const canonical = html.match(/<link\b[^>]*rel=canonical[^>]*>/);
  if (canonical && !canonical[0].includes(url)) {
    html = html.replace(canonical[0], `<link href=${url} rel=canonical>`);
    changes.push('canonical');
  }

  const ld = articleJsonLd(html);
  if (ld) {
    const before = JSON.stringify(ld.data);
    ld.data.headline = article.title;
    ld.data.description = description;
    ld.data.url = url;
    ld.data.mainEntityOfPage = url;
    if (JSON.stringify(ld.data) !== before) {
      html =
        html.slice(0, ld.start) +
        `<script type=application/ld+json>${JSON.stringify(ld.data)}</script>` +
        html.slice(ld.end);
      changes.push('Article JSON-LD');
    }
  }

  fs.writeFileSync(file, html);
  return { anchor: article.anchor, changes };
}

const results = articleData().map(syncArticle);
for (const result of results) {
  console.log(
    `${result.anchor.padEnd(30)} ${result.skipped || (result.changes.length ? result.changes.join(', ') : 'already in sync')}`
  );
}
