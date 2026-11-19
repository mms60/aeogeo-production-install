'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const TYPOGRAPHY_CSS = path.join(SITE, 'assets', 'typography-consistency.css');

function walk(directory, predicate) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath, predicate));
    else if (predicate(fullPath)) files.push(fullPath);
  }
  return files;
}

function addClasses(value, classes) {
  for (const token of value.split(/\s+/)) {
    if (/eyebrow/i.test(token)) classes.add(token);
  }
}

function addCssClasses(source, classes) {
  for (const match of source.matchAll(/\.([A-Za-z0-9_-]*eyebrow[A-Za-z0-9_-]*)/gi)) {
    classes.add(match[1]);
  }
}

const htmlPages = walk(SITE, file => file.endsWith('.html'));
const jsFiles = walk(SITE, file => file.endsWith('.js'));
const cssFiles = walk(SITE, file => file.endsWith('.css'));
const typographyCss = fs.readFileSync(TYPOGRAPHY_CSS, 'utf8');

function attributeValue(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? (match[1] ?? match[2] ?? match[3]) : '';
}

test('every HTML page loads the shared typography stylesheet', () => {
  assert.ok(htmlPages.length > 0, 'expected at least one HTML page');

  for (const page of htmlPages) {
    const relative = path.relative(ROOT, page);
    const html = fs.readFileSync(page, 'utf8');
    const links = html.match(/<link\b[^>]*>/gi) || [];
    const loadsTypography = links.some(link => {
      const rel = attributeValue(link, 'rel').trim().toLowerCase().split(/\s+/);
      const href = attributeValue(link, 'href').trim();
      return rel.includes('stylesheet') && /(?:^|\/)typography-consistency\.css(?:\?[^#]*)?$/.test(href);
    });

    assert.ok(loadsTypography, `${relative} must load /assets/typography-consistency.css`);
  }
});

test('the shared eyebrow rule covers every eyebrow class at the standard color and size', () => {
  const rule = typographyCss.match(/html\s+body\s+:is\(([\s\S]*?)\)\s*\{([^}]*)\}/i);
  assert.ok(rule, 'expected the shared eyebrow rule in typography-consistency.css');

  const coveredClasses = new Set(
    [...rule[1].matchAll(/\.([A-Za-z0-9_-]+)/g)].map(match => match[1])
  );
  const declarations = rule[2].replace(/\s+/g, '').toLowerCase();

  assert.match(declarations, /color:#50c878!important/);
  assert.match(declarations, /-webkit-text-fill-color:#50c878!important/);
  assert.match(declarations, /font-size:12px!important/);
  assert.match(declarations, /line-height:16px!important/);

  const eyebrowClasses = new Set();
  for (const page of htmlPages) {
    const html = fs.readFileSync(page, 'utf8');
    for (const match of html.matchAll(/\bclass=["']([^"']*)["']/gi)) {
      addClasses(match[1], eyebrowClasses);
    }
    for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
      addCssClasses(match[1], eyebrowClasses);
    }
  }
  for (const file of jsFiles) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bclassName\s*:\s*["']([^"']*)["']/gi)) {
      addClasses(match[1], eyebrowClasses);
    }
  }
  for (const file of cssFiles) {
    addCssClasses(fs.readFileSync(file, 'utf8'), eyebrowClasses);
  }

  assert.ok(eyebrowClasses.size > 0, 'expected at least one eyebrow class');
  assert.ok(
    eyebrowClasses.has('route-eyebrow'),
    'expected route-eyebrow to be discovered from page markup, inline styles, external CSS, or JavaScript'
  );
  for (const className of eyebrowClasses) {
    assert.ok(
      coveredClasses.has(className),
      `.${className} is not covered by the shared eyebrow rule`
    );
  }
});
