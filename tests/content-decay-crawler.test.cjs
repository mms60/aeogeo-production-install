'use strict';

// No network access: these tests exercise the pure HTML parsers and the
// aggregate summary only. Crawling itself is covered by manual staging runs.

const test = require('node:test');
const assert = require('node:assert/strict');
const { analysePage, summarise, candidateQueue } = require('../netlify/functions/lib/content-decay-crawler');

const page = (body, head = '') =>
  `<!doctype html><html><head><title>Example page</title>${head}</head><body>${body}</body></html>`;

test('JSON-LD dateModified is used and reported as the source', () => {
  const html = page(
    '<h1>Service</h1><p>Some words here.</p>',
    '<script type="application/ld+json">{"@type":"Article","dateModified":"2025-03-04T10:00:00Z","datePublished":"2022-01-02"}</script>'
  );
  const result = analysePage(html, 'https://example.com/service');
  assert.equal(result.declaredModifiedAt, '2025-03-04T10:00:00.000Z');
  assert.equal(result.declaredPublishedAt, '2022-01-02T00:00:00.000Z');
  assert.equal(result.dateSource, 'json-ld');
  assert.ok(result.signals.jsonLdTypes.includes('Article'));
});

test('article:modified_time metadata is used when there is no JSON-LD date', () => {
  const html = page(
    '<h1>Service</h1>',
    '<meta property="article:modified_time" content="2024-11-20T08:00:00Z">'
  );
  const result = analysePage(html, 'https://example.com/service');
  assert.equal(result.declaredModifiedAt, '2024-11-20T08:00:00.000Z');
  assert.equal(result.dateSource, 'meta');
});

test('a time element is used when no metadata exists', () => {
  const html = page('<h1>Service</h1><time datetime="2023-06-01">June 2023</time>');
  const result = analysePage(html, 'https://example.com/service');
  assert.equal(result.declaredModifiedAt, '2023-06-01T00:00:00.000Z');
  assert.equal(result.dateSource, 'time');
});

test('a visible last-updated label is used as the final fallback', () => {
  const html = page('<h1>Service</h1><p>Last updated: March 4, 2021</p>');
  const result = analysePage(html, 'https://example.com/service');
  assert.equal(result.declaredModifiedAt, '2021-03-04T00:00:00.000Z');
  assert.equal(result.dateSource, 'visible-label');
  assert.equal(result.signals.hasUpdatedLabel, true);
});

test('a page with no freshness signal reports null rather than guessing', () => {
  const result = analysePage(page('<h1>Service</h1><p>Evergreen copy.</p>'), 'https://example.com/');
  assert.equal(result.declaredModifiedAt, null);
  assert.equal(result.dateSource, null);
});

test('implausible years are rejected instead of trusted', () => {
  const ancient = analysePage(page('<h1>A</h1>', '<meta property="article:modified_time" content="1880-01-01">'), 'https://example.com/');
  const future = analysePage(page('<h1>A</h1>', '<meta property="article:modified_time" content="2099-01-01">'), 'https://example.com/');
  assert.equal(ancient.declaredModifiedAt, null);
  assert.equal(future.declaredModifiedAt, null);
});

test('links are split into internal and external, and query URLs are excluded', () => {
  const html = page(
    '<h1>A</h1><a href="/one">1</a><a href="/two?x=1">2</a><a href="https://other.example/x">3</a>'
  );
  const result = analysePage(html, 'https://example.com/');
  assert.deepEqual(result.signals.internalLinks, ['https://example.com/one']);
  assert.equal(result.signals.externalLinks, 1);
});

test('content hashes are stable for identical text and differ for different text', () => {
  const a = analysePage(page('<h1>A</h1><p>Same words.</p>'), 'https://example.com/');
  const b = analysePage(page('<h1>A</h1><p>Same words.</p>'), 'https://example.com/other');
  const c = analysePage(page('<h1>A</h1><p>Different words.</p>'), 'https://example.com/');
  assert.equal(a.contentHash, b.contentHash);
  assert.notEqual(a.contentHash, c.contentHash);
  assert.match(a.contentHash, /^[0-9a-f]{64}$/);
});

test('the summary counts stale and undated pages without scoring them', () => {
  const today = new Date('2026-11-20T00:00:00Z');
  const pages = [
    {wordCount: 900, declaredModifiedAt: '2026-10-01T00:00:00Z', signals: {h1Count: 1, jsonLdTypes: ['Article'], hasAuthor: true, hasFaq: false, internalLinks: ['a']}},
    {wordCount: 120, declaredModifiedAt: '2024-01-01T00:00:00Z', signals: {h1Count: 2, jsonLdTypes: [], hasAuthor: false, hasFaq: true, internalLinks: ['b', 'c']}},
    {wordCount: 400, declaredModifiedAt: null, signals: {h1Count: 1, jsonLdTypes: [], hasAuthor: false, hasFaq: false, internalLinks: []}}
  ];
  const summary = summarise(pages, today);
  assert.equal(summary.pagesScanned, 3);
  assert.equal(summary.averageWords, 473);
  assert.equal(summary.thinPages, 1);
  assert.equal(summary.pagesWithoutSingleH1, 1);
  assert.equal(summary.pagesWithDeclaredDate, 2);
  assert.equal(summary.undatedPages, 1);
  assert.equal(summary.staleOver12Months, 1);
  assert.equal(summary.oldestContentDate, '2024-01-01T00:00:00Z');
  assert.equal(summary.newestContentDate, '2026-10-01T00:00:00Z');
  assert.equal(summary.pagesWithJsonLd, 1);
  assert.equal(summary.pagesWithAuthor, 1);
  assert.equal(summary.pagesWithFaq, 1);
  assert.equal(summary.internalLinksFound, 3);
});

test('coverage metadata is carried into the summary and flags a partial scan', () => {
  const today = new Date('2026-11-20T00:00:00Z');
  const pages = [{wordCount: 500, declaredModifiedAt: null, signals: {h1Count: 1, jsonLdTypes: [], hasAuthor: false, hasFaq: false, internalLinks: []}}];

  const full = summarise(pages, today, {discovered: 1, skippedCount: 0, unvisited: 0, stopReason: 'exhausted'});
  assert.equal(full.pagesDiscovered, 1);
  assert.equal(full.coverageComplete, true);
  assert.equal(full.stopReason, 'exhausted');

  const capped = summarise(pages, today, {discovered: 42, skippedCount: 3, unvisited: 38, stopReason: 'page_limit'});
  assert.equal(capped.pagesDiscoveredLowerBound, true);
  assert.equal(capped.pagesRead, undefined);
  assert.equal(capped.pagesDiscovered, 42);
  assert.equal(capped.pagesSkipped, 3);
  assert.equal(capped.pagesUnread, 38);
  assert.equal(capped.coverageComplete, false);
  assert.equal(capped.stopReason, 'page_limit');

  const deadline = summarise(pages, today, {discovered: 10, skippedCount: 0, unvisited: 9, stopReason: 'deadline'});
  assert.equal(deadline.coverageComplete, false);
  assert.equal(deadline.stopReason, 'deadline');
});

test('every eligible URL is counted before the fetch queue is capped', () => {
  const candidates = candidateQueue('https://example.com', 10);
  for (let i = 0; i < 500; i += 1) candidates.add('https://example.com/page-' + i);
  assert.equal(candidates.count(), 500);
  assert.ok(candidates.queue.length <= 81, 'queue length ' + candidates.queue.length);
  assert.ok(candidates.queue.length > 0);
});

test('duplicate, cross-origin, query and asset URLs are not counted', () => {
  const candidates = candidateQueue('https://example.com', 10);
  candidates.add('https://example.com/a');
  candidates.add('https://example.com/a');
  candidates.add('https://other.example/a');
  candidates.add('https://example.com/a?utm=x');
  candidates.add('https://example.com/guide.pdf');
  assert.equal(candidates.count(), 1);
});

test('the home page is counted once and stays out of the fetch queue', () => {
  const candidates = candidateQueue('https://example.com', 10);
  candidates.track('https://example.com/');
  candidates.add('https://example.com/');
  assert.equal(candidates.count(), 1);
  assert.deepEqual(candidates.queue, []);
});

test('a discovered count is reported as a lower bound when discovery is incomplete', () => {
  const pages = [{wordCount: 500, declaredModifiedAt: null, signals: {h1Count: 1, jsonLdTypes: [], hasAuthor: false, hasFaq: false, internalLinks: []}}];
  const unknown = summarise(pages, new Date('2026-11-20T00:00:00Z'));
  assert.equal(unknown.pagesDiscoveredLowerBound, true, 'fallback to pages read is a floor');

  const floored = summarise(pages, new Date('2026-11-20T00:00:00Z'), {discovered: 500, unvisited: 497, stopReason: 'page_limit', discoveredIsLowerBound: true});
  assert.equal(floored.pagesDiscovered, 500);
  assert.equal(floored.pagesDiscoveredLowerBound, true);

  const exact = summarise(pages, new Date('2026-11-20T00:00:00Z'), {discovered: 1, unvisited: 0, stopReason: 'exhausted', discoveredIsLowerBound: false});
  assert.equal(exact.pagesDiscoveredLowerBound, false);
});

test('noindex, copyright year and outdated year references are captured as signals', () => {
  const html = page(
    '<h1>A</h1><p>Our 2019 pricing guide was written in 2019.</p><p>&copy; 2021 Example Co.</p>',
    '<meta name="robots" content="noindex,follow">'
  );
  const result = analysePage(html, 'https://example.com/');
  assert.equal(result.signals.noindex, true);
  assert.equal(result.signals.copyrightYear, 2021);
  const years = result.signals.outdatedYearMentions.map(item => item.year);
  assert.ok(years.includes(2019), JSON.stringify(years));
  assert.ok(!years.includes(new Date().getUTCFullYear()), 'current year is not outdated');
  assert.ok(result.signals.outdatedYearMentions[0].context.includes('pricing guide'));
});

test('a citation of past research is not treated as an outdated claim', () => {
  const html = page('<h1>A</h1><p>A 2024 study found growth; the authors reported it for 2024.</p>');
  const result = analysePage(html, 'https://example.com/');
  assert.deepEqual(result.signals.outdatedYearMentions, []);
});

test('a figure without a citation in the same block is counted, a cited one is not', () => {
  const html = page(
    '<h1>A</h1>'
    + '<p>68% of searches ended without a click according to the study.</p>'
    + '<p>57% of visits clicked a result, per <a href="https://example.org/source">the source</a>.</p>'
    + '<p>42% of pages were thin. Sources: internal audit, 2025.</p>'
    + '<p>Any service promising "100% undetectable" output is selling certainty nobody can deliver.</p>'
    + '<p>Annual prices include a 20% discount compared with monthly billing.</p>'
  );
  const result = analysePage(html, 'https://example.com/');
  assert.equal(result.signals.unsourcedStatistics, 1);
  assert.equal(result.signals.unsourcedStatisticSamples.length, 1);
  assert.match(result.signals.unsourcedStatisticSamples[0], /68%/);
});

test('the summary of an empty crawl is all zeroes, not an error', () => {
  const summary = summarise([], new Date('2026-11-20T00:00:00Z'));
  assert.equal(summary.pagesScanned, 0);
  assert.equal(summary.averageWords, 0);
  assert.equal(summary.oldestContentDate, null);
  assert.equal(summary.newestContentDate, null);
});
