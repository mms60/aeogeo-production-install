'use strict';

// Deterministic, offline tests for the Content Decay rule engine.
// The crawler is not involved: every page here is a plain signals object.

const test = require('node:test');
const assert = require('node:assert/strict');
const {analyseScan, RULES_VERSION} = require('../netlify/functions/lib/content-decay-analysis');

const TODAY = new Date('2026-11-20T00:00:00Z');

const base = {
  url: 'https://example.com/service',
  title: 'Commercial cleaning in McKinney',
  wordCount: 900,
  declaredModifiedAt: '2026-10-01T00:00:00.000Z',
  declaredPublishedAt: '2024-01-01T00:00:00.000Z',
  signals: {
    jsonLdTypes: ['Article'],
    h1Count: 1,
    headingLevels: [1, 2, 3],
    hasAuthor: true,
    hasFaq: true,
    hasStatistics: false,
    hasUpdatedLabel: true,
    noindex: false,
    copyrightYear: 2026,
    outdatedYearMentions: [],
    unsourcedStatistics: 0,
    unsourcedStatisticSamples: [],
    internalLinks: [],
    externalLinks: 2
  }
};

function page(overrides = {}) {
  const {signals = {}, ...rest} = overrides;
  return {...base, ...rest, signals: {...base.signals, ...signals}};
}

const codes = result => result.findings.map(finding => finding.code);

test('a clean, current page scores 100 and produces no findings', () => {
  const result = analyseScan({pages: [page()], today: TODAY});
  assert.equal(result.findings.length, 0);
  assert.equal(result.overallScore, 100);
  assert.deepEqual(result.pages, [
    {url: base.url, pageScore: 100, severity: null, findingCount: 0}
  ]);
  assert.equal(result.summary.rulesVersion, RULES_VERSION);
  assert.equal(result.summary.findings, 0);
});

test('age alone never lowers a score and is only a review note', () => {
  const result = analyseScan({
    pages: [page({declaredModifiedAt: '2021-01-01T00:00:00.000Z'})],
    today: TODAY
  });
  assert.deepEqual(codes(result), ['freshness_declared_stale']);
  assert.equal(result.pages[0].pageScore, 100, 'old date must not cost points');
  assert.equal(result.overallScore, 100);
  assert.equal(result.findings[0].severity, 'low');
  assert.match(result.findings[0].detail, /Age alone is not decay/);
});

test('an undated page is reported as undated, never as stale', () => {
  const result = analyseScan({
    pages: [page({declaredModifiedAt: null, declaredPublishedAt: null})],
    today: TODAY
  });
  assert.deepEqual(codes(result), ['freshness_no_declared_date']);
  assert.match(result.findings[0].detail, /undated, not as stale/);
  assert.equal(result.pages[0].pageScore, 97);
});

test('a missing H1 is high severity, outranks low findings, and costs 12 points', () => {
  const result = analyseScan({pages: [page({signals: {h1Count: 0}})], today: TODAY});
  assert.deepEqual(codes(result), ['structure_missing_h1']);
  assert.equal(result.findings[0].severity, 'high');
  assert.equal(result.findings[0].suggestedReplacement, base.title);
  assert.equal(result.pages[0].pageScore, 88);
  assert.equal(result.pages[0].severity, 'high');
});

test('multiple H1s and thin copy are scored independently', () => {
  const result = analyseScan({
    pages: [page({wordCount: 120, signals: {h1Count: 3}})],
    today: TODAY
  });
  assert.deepEqual(codes(result).sort(), ['structure_multiple_h1', 'structure_thin_content']);
  assert.equal(result.pages[0].pageScore, 90);
  assert.equal(result.pages[0].severity, 'medium');
});

test('missing structured data and a missing author cost their weights', () => {
  const result = analyseScan({
    pages: [page({signals: {jsonLdTypes: [], hasAuthor: false}})],
    today: TODAY
  });
  assert.deepEqual(codes(result).sort(), ['ai_readiness_no_author_signal', 'ai_readiness_no_structured_data']);
  assert.equal(result.pages[0].pageScore, 90);
});

test('an outdated copyright year is a positive decay signal', () => {
  const result = analyseScan({pages: [page({signals: {copyrightYear: 2021}})], today: TODAY});
  assert.deepEqual(codes(result), ['outdated_data_copyright_year']);
  assert.equal(result.findings[0].category, 'outdated_data');
  assert.equal(result.findings[0].severity, 'medium');
  assert.equal(result.findings[0].evidence, '© 2021');
  assert.equal(result.pages[0].pageScore, 93);
});

test('a missing copyright year is not treated as a stale year', () => {
  const result = analyseScan({pages: [page({signals: {copyrightYear: null}})], today: TODAY});
  assert.equal(codes(result).includes('outdated_data_copyright_year'), false);
  assert.equal(result.findings.length, 0);
  assert.equal(result.pages[0].pageScore, 100);
});

test('outdated year references carry the surrounding text as evidence', () => {
  const result = analyseScan({
    pages: [page({signals: {outdatedYearMentions: [{year: 2019, context: 'our 2019 pricing guide still applies'}]}})],
    today: TODAY
  });
  assert.deepEqual(codes(result), ['outdated_data_year_reference']);
  assert.match(result.findings[0].title, /2019/);
  assert.match(result.findings[0].evidence, /pricing guide/);
});

test('an uncited figure is reported as unsupported, not as false', () => {
  const result = analyseScan({
    pages: [page({signals: {unsourcedStatistics: 1, unsourcedStatisticSamples: ['68% of searches end without a click.']}})],
    today: TODAY
  });
  assert.deepEqual(codes(result), ['factual_support_uncited_statistic']);
  assert.match(result.findings[0].detail, /unsupported, not as false/);
  assert.match(result.findings[0].evidence, /68%/);
  assert.equal(result.pages[0].pageScore, 97);
});

test('noindex pages are excluded from scoring and findings', () => {
  const result = analyseScan({
    pages: [page({signals: {noindex: true, h1Count: 0}}), page({url: 'https://example.com/b'})],
    today: TODAY
  });
  assert.equal(result.summary.pagesAnalysed, 1);
  assert.equal(result.summary.pagesSkippedNoindex, 1);
  assert.equal(result.overallScore, 100);
  assert.deepEqual(result.pages.map(item => item.url), ['https://example.com/b']);
});

test('findings are ordered by severity, then priority', () => {
  const result = analyseScan({
    pages: [page({signals: {h1Count: 0}, declaredModifiedAt: null, declaredPublishedAt: null})],
    today: TODAY
  });
  assert.deepEqual(codes(result), ['structure_missing_h1', 'freshness_no_declared_date']);
});

test('the same input always produces the same output', () => {
  const input = () => ({
    pages: [page({wordCount: 200, signals: {h1Count: 0, copyrightYear: 2020, outdatedYearMentions: [{year: 2019, context: 'in 2019 we reported'}]}})],
    today: TODAY
  });
  assert.deepEqual(analyseScan(input()), analyseScan(input()));
});
