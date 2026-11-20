'use strict';

// DOM-level test for the paid Content Decay report renderer. The real page and
// the real site/assets/content-decay-report.js run in jsdom, with the session
// helper and API response supplied as fixtures, so the rendered findings,
// severity order, evidence and pages table are covered without a server.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');

const SITE = path.resolve(__dirname, '../site');
const SCAN = '22222222-2222-4222-8222-222222222222';
const STALE = 'pppppppp-1111-4111-8111-111111111111';
const UNDATED = 'pppppppp-2222-4222-8222-222222222222';
const FRESH = 'pppppppp-3333-4333-8333-333333333333';

const REPORT_HTML = fs.readFileSync(
  path.join(SITE, 'content-decay/report/index.html'), 'utf8');
const REPORT_JS = fs.readFileSync(
  path.join(SITE, 'assets/content-decay-report.js'), 'utf8');

// Mirrors GET action=report: findings already ordered by severity then
// priority, pages carrying their own page scores.
function fixture() {
  return {
    scan: {
      id: SCAN,
      hostname: 'example.com',
      targetUrl: 'https://example.com',
      status: 'completed',
      pagesScanned: 3,
      overallScore: 58,
      summary: {
        pagesDiscovered: 7,
        pagesDiscoveredLowerBound: true,
        coverageComplete: false,
        undatedPages: 1,
        staleOver12Months: 1,
        thinPages: 2,
        pagesWithoutSingleH1: 1
      },
      completedAt: '2026-11-19T12:00:00.000Z'
    },
    pages: [
      {
        id: FRESH,
        url: 'https://example.com/fresh',
        title: 'Fresh page',
        wordCount: 820,
        declaredModifiedAt: '2026-10-02T00:00:00.000Z',
        pageScore: 92,
        severity: 'low'
      },
      {
        id: STALE,
        url: 'https://example.com/stale',
        title: 'Stale page',
        wordCount: 210,
        declaredModifiedAt: '2023-04-02T00:00:00.000Z',
        pageScore: 41,
        severity: 'critical'
      },
      {
        id: UNDATED,
        url: 'https://example.com/undated',
        title: 'Undated page',
        wordCount: 260,
        declaredModifiedAt: null,
        pageScore: 73,
        severity: 'medium'
      }
    ],
    findings: [
      {
        pageId: STALE,
        category: 'outdated_data',
        code: 'stale_statistic',
        severity: 'critical',
        priority: 5,
        title: 'Cited statistic is years old',
        detail: 'A 2022 figure is presented as current.',
        evidence: '“63% of marketers…”',
        recommendation: 'Replace the figure with a current, linked source.',
        suggestedReplacement: 'In 2026, 71% of marketers reported…'
      },
      {
        pageId: STALE,
        category: 'freshness',
        code: 'no_declared_date',
        severity: 'high',
        priority: 10,
        title: 'No declared update date',
        detail: 'The page declares no date.',
        evidence: '“Updated recently”',
        recommendation: 'Add a visible date.',
        suggestedReplacement: null
      },
      {
        pageId: UNDATED,
        category: 'structure',
        code: 'weak_heading',
        severity: 'medium',
        priority: 20,
        title: 'Question heading has no direct answer',
        detail: 'The section opens with background.',
        evidence: '“What does this do?”',
        recommendation: 'Open with a one-sentence answer.',
        suggestedReplacement: null
      },
      {
        pageId: null,
        category: 'ai_readiness',
        code: 'no_summary',
        severity: 'low',
        priority: 30,
        title: 'No concise summary near the top',
        detail: 'The page starts with background.',
        evidence: null,
        recommendation: 'Add a one-sentence answer near the top.',
        suggestedReplacement: null
      }
    ],
    generatedAt: '2026-11-20T00:00:00.000Z'
  };
}

function render(data = fixture()) {
  const dom = new JSDOM(REPORT_HTML, {
    url: 'https://aeogeosearch.com/content-decay/report/?scan=' + SCAN,
    runScripts: 'outside-only'
  });
  const {window} = dom;
  const calls = [];

  window.ContentDecaySession = {
    session: async () => ({
      access_token: 'session-token',
      user: {email: 'buyer@example.com'}
    }),
    api: async (action, options) => {
      calls.push({action, options});
      return data;
    },
    signInUrl: next => '/login/?next=' + encodeURIComponent(next),
    download: async () => {
      throw new Error('download is not part of this fixture');
    }
  };
  window.eval(REPORT_JS);
  return {dom, window, calls};
}

async function waitFor(predicate, label, timeoutMs = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Timed out waiting for ' + label);
}

test('the report page renders fixture findings, severity order, evidence and pages', async () => {
  const data = fixture();
  const {dom, window, calls} = render(data);
  const document = window.document;

  await waitFor(
    () => document.getElementById('cd-report-body').hidden === false,
    'the populated report body');

  // The page asked the API for this scan with the signed-in session.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'report');
  assert.equal(calls[0].options.scan, SCAN);
  assert.equal(calls[0].options.token, 'session-token');

  // Header, score and status.
  assert.equal(document.title, 'Content Decay report · example.com | AEOGEO Search');
  assert.equal(
    document.getElementById('cd-report-title').textContent,
    'Content Decay report: example.com');
  const meta = document.getElementById('cd-report-meta').textContent;
  assert.match(meta, /Scan of example\.com · 3 pages read · completed/);
  assert.ok(meta.includes('buyer@example.com'));
  assert.equal(document.getElementById('cd-report-status').textContent, '');
  assert.equal(document.getElementById('cd-pdf').hidden, false);
  assert.equal(document.getElementById('cd-overall').textContent, '58');

  // Severity totals.
  const severity = [...document.querySelectorAll('#cd-severity .cd-sev-count')].map(cell => ({
    key: cell.className.replace('cd-sev-count is-', ''),
    count: cell.querySelector('b').textContent,
    label: cell.querySelector('span').textContent
  }));
  assert.deepEqual(severity, [
    {key: 'critical', count: '1', label: 'Critical'},
    {key: 'high', count: '1', label: 'High'},
    {key: 'medium', count: '1', label: 'Medium'},
    {key: 'low', count: '1', label: 'Low'}
  ]);

  // Coverage metrics, including the lower-bound and partial-scan wording.
  const metrics = [...document.querySelectorAll('#cd-report-metrics .cd-metric')].map(cell => [
    cell.querySelector('dt').textContent,
    cell.querySelector('dd').textContent,
    cell.querySelector('dd').className
  ]);
  assert.deepEqual(metrics, [
    ['Pages read', '3', ''],
    ['Pages discovered', 'at least 7', ''],
    ['Pages declaring no date', '1', 'cd-warn'],
    ['Declared stale over 12 months', '1', 'cd-warn'],
    ['Pages under 300 words', '2', 'cd-warn'],
    ['Pages without one clear H1', '1', 'cd-warn'],
    ['Findings', '4', 'cd-warn']
  ]);
  const note = document.getElementById('cd-report-note').textContent;
  assert.ok(note.includes('This scan was partial'));
  assert.ok(note.includes('discovered count is a lower bound'));

  // Findings render in the API's severity order, each with its own badge.
  const cards = [...document.querySelectorAll('#cd-findings article.cd-finding')];
  assert.equal(cards.length, 4);
  assert.equal(document.getElementById('cd-no-findings').hidden, true);
  assert.deepEqual(cards.map(card => card.className), [
    'cd-finding is-critical',
    'cd-finding is-high',
    'cd-finding is-medium',
    'cd-finding is-low'
  ]);
  assert.deepEqual(cards.map(card => card.querySelector('.cd-badge').textContent), [
    'Critical', 'High', 'Medium', 'Low'
  ]);
  assert.deepEqual(cards.map(card => card.querySelector('.cd-finding-title').textContent), [
    'Cited statistic is years old',
    'No declared update date',
    'Question heading has no direct answer',
    'No concise summary near the top'
  ]);
  assert.deepEqual(cards.map(card => card.querySelector('.cd-finding-category').textContent), [
    'Outdated data', 'Freshness', 'Structure', 'AI readiness'
  ]);

  // Evidence, fix and suggested copy stay attached to the finding they belong to.
  const first = cards[0];
  assert.equal(first.querySelector('.cd-evidence').textContent, '“63% of marketers…”');
  assert.equal(
    first.querySelector('.cd-fix').textContent,
    'Fix: Replace the figure with a current, linked source.');
  assert.equal(
    first.querySelector('.cd-replacement').textContent,
    'In 2026, 71% of marketers reported…');
  const firstPageLink = first.querySelector('.cd-finding-page a');
  assert.equal(firstPageLink.textContent, 'https://example.com/stale');
  assert.equal(firstPageLink.getAttribute('href'), 'https://example.com/stale');
  assert.equal(firstPageLink.getAttribute('target'), '_blank');
  assert.equal(firstPageLink.getAttribute('rel'), 'noopener noreferrer');

  assert.equal(cards[1].querySelector('.cd-evidence').textContent, '“Updated recently”');
  assert.equal(cards[2].querySelector('.cd-evidence').textContent, '“What does this do?”');
  assert.equal(cards[3].querySelector('.cd-evidence'), null);
  assert.equal(cards[3].querySelector('.cd-finding-page'), null);
  assert.equal(cards[3].querySelector('.cd-replacement'), null);

  // Pages table is sorted by page score, lowest first.
  const rows = [...document.querySelectorAll('#cd-pages-body tr')].map(row => {
    const cells = [...row.children];
    return {
      url: cells[0].querySelector('a').textContent,
      href: cells[0].querySelector('a').getAttribute('href'),
      title: cells[0].querySelector('.cd-help')?.textContent || '',
      words: cells[1].textContent,
      declared: cells[2].textContent,
      score: cells[3].textContent,
      severity: cells[4].textContent,
      severityClass: cells[4].querySelector('.cd-badge').className
    };
  });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.url), [
    'https://example.com/stale',
    'https://example.com/undated',
    'https://example.com/fresh'
  ]);
  assert.deepEqual(rows.map(row => row.score), ['41', '73', '92']);
  assert.deepEqual(rows.map(row => row.words), ['210', '260', '820']);
  assert.ok(rows[0].declared.includes('2023'));
  assert.equal(rows[1].declared, 'None declared');
  assert.ok(rows[2].declared.includes('2026'));
  assert.deepEqual(rows.map(row => row.title), ['Stale page', 'Undated page', 'Fresh page']);
  assert.deepEqual(rows.map(row => row.severity), ['Critical', 'Medium', 'Low']);
  assert.deepEqual(rows.map(row => row.severityClass), [
    'cd-badge cd-badge-critical',
    'cd-badge cd-badge-medium',
    'cd-badge cd-badge-low'
  ]);
  assert.equal(rows[0].href, 'https://example.com/stale');

  dom.window.close();
});
