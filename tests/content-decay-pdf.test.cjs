'use strict';

// The report PDF is generated on demand from the same purchased report data.
// These tests cover the document itself: valid PDF output, the 10-page cap, and
// safe text handling.

const test = require('node:test');
const assert = require('node:assert/strict');
const {buildReport, MAX_PAGES} = require('../netlify/functions/lib/content-decay-pdf');

const scan = overrides => ({
  id: '22222222-2222-4222-8222-222222222222',
  hostname: 'example.com',
  targetUrl: 'https://example.com/',
  status: 'completed',
  pagesScanned: 2,
  overallScore: 61,
  completedAt: '2026-11-19T12:00:00.000Z',
  summary: {
    pagesDiscovered: 5,
    pagesDiscoveredLowerBound: true,
    coverageComplete: false,
    pagesSkipped: 1,
    pagesUnread: 2,
    undatedPages: 1,
    staleOver12Months: 1,
    thinPages: 1,
    pagesWithoutSingleH1: 1
  },
  ...overrides
});

const pages = () => [
  {
    id: 'pppppppp-1111-4111-8111-111111111111',
    url: 'https://example.com/stale-page',
    title: 'Stale page',
    wordCount: 210,
    declaredModifiedAt: '2023-04-02T00:00:00.000Z',
    pageScore: 48,
    severity: 'critical'
  },
  {
    id: 'pppppppp-2222-4222-8222-222222222222',
    url: 'https://example.com/fresh-page',
    title: 'Fresh page',
    wordCount: 1200,
    declaredModifiedAt: null,
    pageScore: 95,
    severity: null
  }
];

const findings = () => [
  {
    pageId: 'pppppppp-1111-4111-8111-111111111111',
    category: 'outdated_data',
    code: 'stale_statistic',
    severity: 'critical',
    priority: 5,
    title: 'Cited statistic is years old',
    detail: 'A 2022 figure is still presented as current.',
    evidence: '63% of marketers say AI search changed their strategy.',
    recommendation: 'Replace the figure with a current, linked source.',
    suggestedReplacement: 'In 2026, 71% of marketers reported that AI search changed their strategy.'
  },
  {
    pageId: 'pppppppp-2222-4222-8222-222222222222',
    category: 'freshness',
    code: 'no_declared_date',
    severity: 'medium',
    priority: 20,
    title: 'No declared update date',
    detail: 'The page declares no date.',
    evidence: null,
    recommendation: 'Add a visible last-updated date.',
    suggestedReplacement: null
  }
];

const build = (overrides = {}) => buildReport({
  scan: scan(),
  pages: pages(),
  findings: findings(),
  generatedAt: '2026-11-20T09:00:00.000Z',
  ...overrides
});

test('builds a valid PDF containing the report content', () => {
  const {bytes, pageCount, capped} = build();
  const text = bytes.toString('ascii');

  assert.ok(pageCount > 0 && pageCount <= MAX_PAGES, 'page count within the cap');
  assert.equal(capped, false);
  assert.equal(bytes.subarray(0, 8).toString('ascii'), '%PDF-1.4');
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.match(text, /Content Decay Report: example\.com/);
  assert.match(text, /Content Health/);
  assert.match(text, /Cited statistic is years old/);
  assert.match(text, /Fix: Replace the figure with a current, linked source\./);
  assert.match(text, /Suggested replacement: In 2026, 71% of marketers/);
  assert.match(text, /stale-page/);
  assert.match(text, /Page 1 of/);
  assert.match(text, /Rule-based readiness review/);
});

test('never produces more than 10 pages, even with many findings', () => {
  const many = Array.from({length: 80}, (_, index) => ({
    pageId: 'pppppppp-1111-4111-8111-111111111111',
    category: 'outdated_data',
    code: 'stale_statistic',
    severity: index % 2 ? 'high' : 'critical',
    priority: index,
    title: 'Finding number ' + index,
    detail: 'A long detail paragraph. '.repeat(12),
    evidence: 'Quoted evidence from the page. '.repeat(8),
    recommendation: 'Replace this with a current source. '.repeat(8),
    suggestedReplacement: 'Replacement wording for the page. '.repeat(8)
  }));

  const {bytes, pageCount, capped} = build({
    scan: scan({pagesScanned: 10}),
    findings: many
  });
  const text = bytes.toString('ascii');
  const pageObjects = (text.match(/\/Type \/Page\b/g) || []).length;

  assert.equal(MAX_PAGES, 10);
  assert.equal(pageCount, 10);
  assert.equal(pageObjects, 10);
  assert.equal(capped, true);
  assert.match(text, /Capped at 10 pages/);
});

test('an empty report still produces a readable PDF', () => {
  const {bytes, pageCount} = build({pages: [], findings: [], scan: scan({pagesScanned: 0})});
  const text = bytes.toString('ascii');

  assert.equal(pageCount, 1);
  assert.match(text, /No rule-based findings were recorded/);
  assert.match(text, /No page rows were recorded/);
  assert.equal(text.includes('undefined'), false);
  assert.equal(text.includes('NaN'), false);
});

test('non-ASCII report text is sanitized instead of breaking the PDF', () => {
  const {bytes, pageCount} = build({
    findings: [{
      pageId: 'pppppppp-1111-4111-8111-111111111111',
      category: 'structure',
      code: 'weak_heading',
      severity: 'low',
      priority: 1,
      title: '\u201cQuoted\u201d heading \u2014 with an em dash',
      detail: 'Text with \u201csmart quotes\u201d and \u2192 an arrow.',
      evidence: 'A parenthesized (quote) and a backslash \\ here.',
      recommendation: 'Normalize \u2019 punctuation.',
      suggestedReplacement: 'Use plain ASCII \u2014 or close to it.'
    }]
  });
  const text = bytes.toString('ascii');

  assert.ok(pageCount >= 1 && pageCount <= MAX_PAGES);
  assert.equal(text.includes('\u201c'), false);
  assert.equal(text.includes('\u2014'), false);
  assert.match(text, /"Quoted" heading - with an em dash/);
  assert.equal(text.includes('A parenthesized'), true);
  assert.equal(text.includes('\\(quote\\)'), true);
  assert.equal(text.includes('backslash'), true);
});

test('refuses to build without a scan', () => {
  assert.throws(
    () => buildReport({scan: null, pages: [], findings: []}),
    error => error.status === 400 && error.code === 'CONTENT_DECAY_INVALID_REQUEST'
  );
});
