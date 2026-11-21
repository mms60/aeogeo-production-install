#!/usr/bin/env node
'use strict';
// Generates every copy of the website navigation from templates/site-header.html:
//   - the `rh` array used by the React header and footer in site/assets/app.js
//   - the <header> block embedded in every HTML page
// Run `node scripts/build-nav.mjs` after editing the template; `--check` verifies
// the generated files are current (used in CI).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { load } = require('cheerio');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE_PATH = path.join(ROOT, 'templates/site-header.html');
const APP_PATH = path.join(ROOT, 'site/assets/app.js');
const SITE = path.join(ROOT, 'site');
const START = '<!-- site-header:start -->';
const END = '<!-- site-header:end -->';
const NAV_START = 'rh=[';
const NAV_END = '],aeogeoFooterNav=rh';

const checkOnly = process.argv.includes('--check');
const cleanPath = (href) => String(href || '').replace(/^https?:\/\/aeogeosearch\.com/, '');

function navigationModel(template) {
  const $ = load(template);
  const nav = $('.website-main-navigation');
  if (nav.length !== 1) throw new Error('templates/site-header.html must contain exactly one .website-main-navigation');
  const items = [];
  nav.children().each((_, node) => {
    const n = $(node);
    if (n.hasClass('website-mobile-consultation')) return;
    if (n.hasClass('website-resources')) {
      const children = n.find('.website-resource-links a').map((__, a) => ({
        label: $(a).text().trim(),
        path: cleanPath($(a).attr('href')),
      })).get();
      items.push({ label: n.find('button').text().trim(), path: cleanPath(n.attr('data-navigation-path')), children });
      return;
    }
    const label = n.text().trim();
    const href = cleanPath(n.attr('href'));
    if (!label || !href) return;
    items.push({ label, path: href });
  });
  if (!items.length) throw new Error('No navigation items found in templates/site-header.html');
  return items;
}

// Matches the minified bundle's object style so the generated array stays a
// one-line literal and existing references to it keep working.
function jsNavigationLiteral(nav) {
  const quote = (value) => JSON.stringify(value);
  const item = (entry) =>
    `{label:${quote(entry.label)},path:${quote(entry.path)}` +
    (entry.children ? `,children:[${entry.children.map(item).join(',')}]` : '') +
    '}';
  return `[${nav.map(item).join(',')}]`;
}

function patchedAppJs(nav) {
  const source = fs.readFileSync(APP_PATH, 'utf8');
  const start = source.indexOf(NAV_START);
  if (start === -1) throw new Error(`Anchor "${NAV_START}" not found in site/assets/app.js`);
  if (source.indexOf(NAV_START, start + 1) !== -1) throw new Error(`Anchor "${NAV_START}" is not unique in site/assets/app.js`);
  const end = source.indexOf(NAV_END, start);
  if (end === -1) throw new Error(`Anchor "${NAV_END}" not found after the navigation array`);
  const literal = jsNavigationLiteral(nav);
  const next = source.slice(0, start + NAV_START.length - 1) + literal + source.slice(end + 1);
  const written = next.slice(start + NAV_START.length - 1);
  const parsed = JSON.parse(written.slice(0, written.indexOf(NAV_END) + 1).replace(/([{,])(label|path|children):/g, '$1"$2":'));
  if (JSON.stringify(parsed) !== JSON.stringify(nav)) throw new Error('Generated navigation array failed the round-trip check');
  return next;
}

function patchedPage(html, header) {
  if (html.includes(START) && html.includes(END)) {
    const start = html.indexOf(START);
    const end = html.indexOf(END, start);
    return html.slice(0, start) + START + header + END + html.slice(end + END.length);
  }
  const open = html.search(/<header\b[^>]*class="[^"]*\bwebsite-header\b/);
  if (open === -1) return null;
  const close = html.indexOf('</header>', open);
  if (close === -1) throw new Error('Unterminated <header> block');
  return html.slice(0, open) + START + header + END + html.slice(close + '</header>'.length);
}

function htmlFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(full));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

function main() {
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const header = template.trimEnd();
  const nav = navigationModel(template);
  const changes = [];

  const appNext = patchedAppJs(nav);
  if (appNext !== fs.readFileSync(APP_PATH, 'utf8')) changes.push({ file: APP_PATH, content: appNext });

  for (const file of htmlFiles(SITE)) {
    const html = fs.readFileSync(file, 'utf8');
    const next = patchedPage(html, header);
    if (next === null) continue;
    if (next !== html) changes.push({ file, content: next });
  }

  if (checkOnly) {
    if (changes.length) {
      console.error('nav: navigation is out of date in ' + changes.length + ' file(s):');
      for (const c of changes) console.error('  ' + path.relative(ROOT, c.file).replace(/\\/g, '/'));
      console.error('Run `npm run nav:build` and commit the result.');
      process.exit(1);
    }
    console.log('nav: header, page copies and app.js navigation are in sync (' + nav.length + ' top-level items).');
    return;
  }

  for (const c of changes) fs.writeFileSync(c.file, c.content);
  console.log('nav: updated ' + changes.length + ' file(s) from templates/site-header.html');
  for (const c of changes) console.log('  ' + path.relative(ROOT, c.file).replace(/\\/g, '/'));
}

main();
