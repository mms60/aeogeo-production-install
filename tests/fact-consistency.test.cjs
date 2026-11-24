'use strict';

// Deterministic, offline tests for the fact-consistency slice.
// No network, no model, no database: pages are plain text plus optional JSON-LD.

const test = require('node:test');
const assert = require('node:assert/strict');
const {extractClaims} = require('../netlify/functions/lib/fact-extract');
const {diffClaims, stalePage} = require('../netlify/functions/lib/fact-diff');

const TODAY = new Date('2026-11-20T00:00:00Z');
const CURRENT = '2026-10-01T00:00:00.000Z';

const page = (url, text, extra = {}) => ({url, text, declaredModifiedAt: CURRENT, ...extra});

const claimsFor = (pages) => extractClaims({pages, today: TODAY});

function diff(pages) {
  return diffClaims({claims: claimsFor(pages), pages, today: TODAY});
}

test('a starting price is canonicalised across phrasing', () => {
  const claims = claimsFor([
    page('https://example.com/pricing', 'Starter plans begin at $349/month.'),
    page('https://example.com/services', 'Plans start at $349 per month.')
  ]);
  const starting = claims.filter(claim => claim.attribute === 'starting_price:month');
  assert.equal(starting.length, 2);
  assert.equal(starting[0].valueKey, 'usd:34900:month');
  assert.equal(starting[1].valueKey, 'usd:34900:month');
  assert.equal(diff([
    page('https://example.com/pricing', 'Starter plans begin at $349/month.'),
    page('https://example.com/services', 'Plans start at $349 per month.')
  ]).conflicts.length, 0, 'agreeing pages must not conflict');
});

test('a price and a discount are never treated as the same fact', () => {
  const claims = claimsFor([page('https://example.com/', 'Save $1,000 off and get 20% off monthly billing.')]);
  assert.equal(claims.filter(claim => claim.category === 'pricing').length, 0);
});

test('a current page and a 2024 blog post disagreeing on the starter price is drift, not a hard contradiction', () => {
  const pages = [
    page('https://example.com/pricing', 'The starter plan is $349/month.'),
    page('https://example.com/blog/2024-plans', 'Our starter plan is $199/month.', {declaredModifiedAt: '2024-03-01T00:00:00.000Z'})
  ];
  const {conflicts, summary} = diff(pages);
  assert.equal(conflicts.length, 1, JSON.stringify(conflicts));
  const conflict = conflicts[0];
  assert.equal(conflict.kind, 'drift');
  assert.equal(conflict.category, 'pricing');
  assert.equal(conflict.severity, 'medium', 'drift downgrades a high category');
  assert.equal(conflict.pageAUrl, 'https://example.com/pricing', 'the current page is named first');
  assert.match(conflict.valueA, /349/);
  assert.match(conflict.valueB, /199/);
  assert.ok(conflict.quoteA.includes('349'));
  assert.ok(conflict.quoteB.includes('199'));
  assert.equal(summary.drift, 1);
});

test('one outdated page disagreeing with several current pages produces a single drift finding', () => {
  const pages = [
    page('https://example.com/pricing', 'Our plan starts at $349/month.'),
    page('https://example.com/services', 'Plans start at $349 per month.'),
    page('https://example.com/blog/2024-rates', 'Our plan starts at $199/month.', {declaredModifiedAt: '2024-03-01T00:00:00.000Z'})
  ];
  const {conflicts} = diff(pages);
  const drift = conflicts.filter(conflict => conflict.kind === 'drift');
  assert.equal(drift.length, 1, JSON.stringify(drift));
  assert.equal(drift[0].pageBUrl, 'https://example.com/blog/2024-rates');
});

test('a structured-data finding describes the two sources instead of repeating the URL', () => {
  const pages = [
    page('https://example.com/contact', 'Call (469) 905-2836 today.', {
      jsonLd: ['{"@type":"LocalBusiness","telephone":"+1 469 905 2837"}']
    })
  ];
  const {conflicts} = diff(pages);
  assert.equal(conflicts[0].detail, 'The visible copy on example.com/contact says "(469) 905-2836". Its structured data declares "(469) 905-2837".');
});

test('two current pages disagreeing on pricing is a high-severity contradiction', () => {
  const pages = [
    page('https://example.com/pricing', 'The starter plan is $349/month.'),
    page('https://example.com/services', 'The starter plan is $249/month.')
  ];
  const {conflicts} = diff(pages);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'contradiction');
  assert.equal(conflicts[0].severity, 'high');
});

test('a page with a superset of values is consistent, so a fax number does not raise a finding', () => {
  const pages = [
    page('https://example.com/contact', 'Call 469-905-2836 or fax 469-905-2837.'),
    page('https://example.com/about', 'Call us on (469) 905-2836.')
  ];
  assert.equal(diff(pages).conflicts.length, 0);
});

test('two disjoint phone numbers are a contradiction, and the canonical value is normalised', () => {
  const pages = [
    page('https://example.com/contact', 'Call 469-905-2836.'),
    page('https://example.com/about', 'Call +1 214 555 0110.')
  ];
  const claims = claimsFor(pages);
  const phones = claims.filter(claim => claim.category === 'phone').map(claim => claim.valueKey).sort();
  assert.deepEqual(phones, ['phone:2145550110', 'phone:4699052836']);

  const {conflicts} = diff(pages);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].category, 'phone');
  assert.equal(conflicts[0].severity, 'high');
});

test('opening hours in different formats compare on their canonical value', () => {
  const same = diff([
    page('https://example.com/contact', 'Mon-Fri 9-5.'),
    page('https://example.com/locations', 'Monday to Friday, 9:00am-5:00pm.')
  ]);
  assert.equal(same.conflicts.length, 0, JSON.stringify(same.conflicts));

  const different = diff([
    page('https://example.com/contact', 'Mon-Fri 9-5.'),
    page('https://example.com/locations', 'Monday to Friday, 8:00am-6:00pm.')
  ]);
  assert.equal(different.conflicts.length, 1);
  assert.equal(different.conflicts[0].category, 'hours');
});

test('24/7 and weekday hours disagree', () => {
  const {conflicts} = diff([
    page('https://example.com/contact', 'Open 24/7.'),
    page('https://example.com/faq', 'We are open Mon-Fri 9-5.')
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].category, 'hours');
});

test('a founding year disagreement is medium severity', () => {
  const {conflicts} = diff([
    page('https://example.com/about', 'Founded in 2014 in McKinney.'),
    page('https://example.com/team', 'Established 2019.')
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].category, 'founded');
  assert.equal(conflicts[0].severity, 'medium');
  assert.match(conflicts[0].title, /founding year/);
});

test('a team-size disagreement is low severity and never outranks a price conflict', () => {
  const pages = [
    page('https://example.com/about', 'A team of 12 people. The starter plan is $349/month.'),
    page('https://example.com/team', '18 employees. The starter plan is $249/month.')
  ];
  const {conflicts} = diff(pages);
  const pricing = conflicts.filter(conflict => conflict.category === 'pricing');
  const headcount = conflicts.filter(conflict => conflict.category === 'headcount');
  assert.equal(pricing.length, 1);
  assert.equal(headcount.length, 1);
  assert.equal(headcount[0].severity, 'low');
  assert.equal(conflicts[0].category, 'pricing', 'high severity sorts first');
});

test('a full US address is normalised and compared', () => {
  const same = diff([
    page('https://example.com/contact', 'Visit 123 Main St, McKinney, TX 75072.'),
    page('https://example.com/locations', 'Our office: 123 Main Street, McKinney, TX 75072.')
  ]);
  assert.equal(same.conflicts.length, 0, JSON.stringify(same.conflicts));

  const different = diff([
    page('https://example.com/contact', 'Visit 123 Main St, McKinney, TX 75072.'),
    page('https://example.com/locations', 'Visit 456 Oak Ave, Plano, TX 75024.')
  ]);
  assert.equal(different.conflicts.length, 1);
  assert.equal(different.conflicts[0].category, 'address');
  assert.equal(different.conflicts[0].severity, 'high');
});

test('structured data that contradicts the page copy is reported on that page alone', () => {
  const pages = [
    page('https://example.com/contact', 'Call (469) 905-2836 today.', {
      jsonLd: ['{"@type":"LocalBusiness","telephone":"+1 469 905 2837"}']
    })
  ];
  const {conflicts} = diff(pages);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'jsonld_vs_visible');
  assert.equal(conflicts[0].severity, 'high');
  assert.equal(conflicts[0].pageAUrl, conflicts[0].pageBUrl);
  assert.match(conflicts[0].title, /Structured data/);
});

test('structured data that agrees with the page copy is not a finding', () => {
  const pages = [
    page('https://example.com/contact', 'Call (469) 905-2836 today.', {
      jsonLd: ['{"@type":"LocalBusiness","telephone":"469.905.2836"}']
    })
  ];
  assert.equal(diff(pages).conflicts.length, 0);
});

test('every visible claim quote is a verbatim substring of the page it came from', () => {
  const text = 'Starter plans begin at $349/month. Call 469-905-2836. Visit 123 Main St, McKinney, TX 75072. Mon-Fri 9-5. Founded in 2014. A team of 12 people.';
  const claims = claimsFor([page('https://example.com/', text)]);
  assert.ok(claims.length >= 6);
  for (const claim of claims.filter(item => item.sourceKind === 'visible')) {
    assert.ok(text.includes(claim.quote), 'quote not found in source: ' + claim.quote);
  }
});

test('pages without readable text produce no claims and no findings', () => {
  const pages = [{url: 'https://example.com/', text: '', jsonLd: []}];
  assert.deepEqual(claimsFor(pages), []);
  assert.deepEqual(diff(pages).conflicts, []);
});

test('stale detection uses the page URL and its declared date only', () => {
  assert.equal(stalePage({url: 'https://example.com/blog/x'}, TODAY), true);
  assert.equal(stalePage({url: 'https://example.com/2024/pricing'}, TODAY), true);
  assert.equal(stalePage({url: 'https://example.com/pricing', declaredModifiedAt: '2023-01-01T00:00:00Z'}, TODAY), true);
  assert.equal(stalePage({url: 'https://example.com/pricing', declaredModifiedAt: CURRENT}, TODAY), false);
  assert.equal(stalePage({url: 'https://example.com/pricing'}, TODAY), false);
});

test('the same input always produces the same findings', () => {
  const build = () => [
    page('https://example.com/pricing', 'The starter plan is $349/month. Call 469-905-2836.'),
    page('https://example.com/blog/2024', 'The starter plan is $199/month. Call 214-555-0110.')
  ];
  assert.deepEqual(diff(build()), diff(build()));
});

test('conflicts are capped so a pathological page cannot flood the report', () => {
  const pages = [];
  for (let i = 0; i < 60; i += 1) {
    pages.push(page('https://example.com/page-' + i, 'Call 469-905-' + String(1000 + i) + '.'));
  }
  const {conflicts, summary} = diff(pages);
  assert.ok(conflicts.length <= 30, 'conflicts: ' + conflicts.length);
  assert.equal(summary.truncated, true);
});
