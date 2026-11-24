'use strict';

// Old tools addresses must land on /free-tools/, never on the 404 catch-all and
// never on the homepage. Netlify matches _redirects top to bottom, so both the
// target and the fact that nothing shadows these rules matter.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'site', '_redirects'), 'utf8');

const rules = source
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'))
  .map(line => {
    const [from, to, status] = line.split(/\s+/);
    return {from, to, status, line};
  });

const ALIASES = [
  '/free-tools.html',
  '/free-tools/index.html',
  '/freetools',
  '/freetools/',
  '/free_tools',
  '/free_tools/',
  '/diy-tools',
  '/diy-tools/',
  '/tools/free',
  '/tools/free/',
  '/tools/free-tools',
  '/tools/free-tools/'
];

test('every old tools address is forced to /free-tools/', () => {
  for (const alias of ALIASES) {
    const matches = rules.filter(rule => rule.from === alias);
    assert.equal(matches.length, 1, alias + ' needs exactly one redirect rule');
    assert.equal(matches[0].to, '/free-tools/', alias + ' must land on /free-tools/');
    assert.equal(matches[0].status, '301!', alias + ' must be a forced 301');
  }
});

test('the old tools aliases come before the catch-all so none is shadowed', () => {
  const catchAll = rules.findIndex(rule => rule.from === '/*');
  assert.ok(catchAll > 0, 'expected the 404 catch-all rule');
  for (const alias of ALIASES) {
    const index = rules.findIndex(rule => rule.from === alias);
    assert.ok(index < catchAll, alias + ' is after the catch-all and would never run');
  }
});

test('no tools address is answered with the homepage', () => {
  for (const rule of rules) {
    if (!/tools/i.test(rule.from)) continue;
    assert.notEqual(rule.to, '/', rule.from + ' must not point at the homepage');
    assert.notEqual(rule.to, '/index.html', rule.from + ' must not point at the homepage');
  }
});

test('the site keeps its real 404 catch-all and no homepage catch-all', () => {
  const last = rules.at(-1);
  assert.equal(last.from, '/*', 'the last rule must be the catch-all');
  assert.equal(last.to, '/404.html', 'the catch-all must serve the 404 page');
  assert.equal(last.status, '404');
  assert.ok(
    !rules.some(rule => rule.from === '/*' && /^\/index\.html$/.test(rule.to)),
    'a homepage catch-all would answer every wrong URL with the homepage'
  );
});
