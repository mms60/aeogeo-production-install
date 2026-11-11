'use strict';

// Offline regression tests for the complete audit report. They use only the
// checked-in fictional sample and never call an account, crawl or billing API.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const site = path.join(root, 'site');
const guides = require('../site/assets/implementation-guides.js');

function fictionalReport() {
  const sample = JSON.parse(fs.readFileSync(path.join(site, 'assets/sample-report.json'), 'utf8'));
  const originals = sample.pages;
  sample.target = 'https://fixture.invalid/';
  sample.pages = Array.from({ length: 25 }, (_, i) => {
    const page = structuredClone(originals[i % originals.length]);
    page.title = `Fictional audit page ${String(i + 1).padStart(2, '0')}`;
    page.path = `/page-${i + 1}/`;
    page.url = `https://fixture.invalid/page-${i + 1}/`;
    page.metrics.forEach((metric, j) => {
      metric.evidence = `EVIDENCE_${i + 1}_${j + 1} ${metric.evidence}`;
      metric.fix = `FIX_${i + 1}_${j + 1} ${metric.fix}`;
    });
    return page;
  });
  sample.pages[0].metrics[0].evidence += ' <img src=x onerror=alert(1)> SENTINEL';
  sample.pageCount = sample.pageLimit = 25;
  return sample;
}

function normalize(value) { return String(value).replace(/\s+/g, ' ').trim(); }

test('generated PDF module is reproducible and covers all 22 checks', () => {
  assert.match(execFileSync('python3', ['scripts/complete-pdf/build_guides.py', '--check'], { cwd: root, encoding: 'utf8' }), /current/);
  assert.equal(Object.keys(guides.guides).length, 22);
  assert.deepEqual(guides.playbook.map(item => item.id), ['schema', 'technical', 'content', 'gaps']);
  for (const [id, guide] of Object.entries(guides.guides)) {
    assert.ok(guide.owner && guide.where && guide.when && guide.verify, id);
    assert.ok(guide.steps.length >= 3, id);
  }
});

test('unavailable, not applicable, passed and unknown checks are not invented as failures', () => {
  assert.match(guides.renderGuide({ id: 'readability', score: null, status: 'fail' }), /Not evaluated/);
  assert.match(guides.renderGuide({ id: 'readability', score: 'not-a-number', status: 'pass' }), /Not evaluated/);
  assert.match(guides.renderGuide({ id: 'readability', score: null, status: 'not_applicable' }), /Not applicable/);
  assert.match(guides.renderGuide({ id: 'readability', score: 100, status: 'pass' }), /No change indicated/);
  assert.match(guides.renderGuide({ id: '__proto__', score: 20, status: 'fail' }), /Manual review needed/);
  assert.match(guides.renderGuide({ id: 'a-finding-id', rule_id: 'readability', score: 40, status: 'review' }), /Read the paragraphs aloud/);
});

test('appendix retains 25 fictional pages and 550 escaped observations with navigation', () => {
  const sample = fictionalReport();
  const html = guides.renderAppendix(sample, () => '<script>example()</script>');
  assert.equal((html.match(/class="pdf-metric"/g) || []).length, 550);
  for (let i = 1; i <= 25; i++) {
    assert.ok(html.includes(`Website page ${i} of 25`));
    assert.ok(html.includes(`href="#pdf-site-page-${i}"`));
    for (let j = 1; j <= 22; j++) {
      assert.ok(html.includes(`EVIDENCE_${i}_${j}`));
      assert.ok(html.includes(`FIX_${i}_${j}`));
    }
  }
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<script>example()</script>'));
  assert.ok(html.includes('&lt;script&gt;example()&lt;/script&gt;'));
  assert.match(html, /Create, install, and test structured data safely/);
  assert.match(html, /Find real keyword and competitor gaps/);
});

test('different customers and report sizes use their own findings, not a fixed report', () => {
  for (const [customer, count] of [['alpha', 1], ['bravo', 3], ['charlie', 12], ['delta', 25]]) {
    const report = fictionalReport();
    report.target = `https://${customer}.example/`;
    report.pages = report.pages.slice(0, count).map((page, index) => ({
      ...page,
      title: `${customer} site page ${index + 1}`,
      url: `https://${customer}.example/page-${index + 1}/`
    }));
    const html = guides.renderAppendix(report);
    assert.equal((html.match(/class="pdf-site-page"/g) || []).length, count, customer);
    assert.equal((html.match(/class="pdf-metric"/g) || []).length, count * 22, customer);
    assert.ok(html.includes(`Website page ${count} of ${count}: ${customer} site page ${count}`));
    assert.ok(html.includes(`https://${customer}.example/page-${count}/`));
    assert.ok(!html.includes('fixture.invalid/page-'));
    assert.ok(!html.includes('Website page 25 of 25') || count === 25);
  }
});

test('offline browser integrates filters, Inspect, complete print and missing-script fallback', { timeout: 120000 }, async t => {
  // npm test remains usable without an installed browser. Install one with
  // `npx playwright install chromium --only-shell` to enable this integration
  // test, or supply AEOGEO_CHROMIUM_EXECUTABLE for an existing Chromium.
  let browser;
  const executablePath = process.env.AEOGEO_CHROMIUM_EXECUTABLE;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(executablePath ? { executablePath } : {}) });
  } catch (error) {
    if (!executablePath && /Executable doesn't exist|browserType\.launch:.*ENOENT/s.test(error.message)) {
      t.skip('Playwright Chromium not installed; run npx playwright install chromium --only-shell');
      return;
    }
    throw error;
  }
  const sample = fictionalReport();
  const blocked = [], pageErrors = [];
  async function openPage(options = {}, broken = false, reportData = sample) {
    const page = await browser.newPage(options);
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.addInitScript(() => { window.AEOGEO_OFFLINE_REVIEW = true; });
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.hostname !== 'fixture.invalid' || request.method() !== 'GET') {
        blocked.push(`${request.method()} ${url.origin}${url.pathname}`);
        return route.abort();
      }
      if (url.pathname === '/assets/implementation-guides.js' && broken) return route.abort();
      if (url.pathname === '/assets/sample-report.json') return route.fulfill({ json: reportData });
      if (url.pathname === '/assets/supabase.js') return route.fulfill({
        contentType: 'application/javascript',
        body: "window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}})}})};"
      });
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') + (url.pathname.endsWith('/') ? 'index.html' : '');
      const asset = path.resolve(site, relative);
      if (asset.startsWith(site + path.sep) && fs.existsSync(asset) && fs.statSync(asset).isFile()) return route.fulfill({ path: asset });
      blocked.push(`${request.method()} ${url.origin}${url.pathname}`);
      return route.abort();
    });
    await page.goto('https://fixture.invalid/geo-audit/run/?sample=1', { waitUntil: 'networkidle' });
    const banner = page.locator('#aeogeo-cookie-banner');
    if (await banner.isVisible()) await page.locator('#aeogeo-cookie-banner [data-cookie-action="reject"]').click();
    assert.equal(await page.locator('#results-panel').isVisible(), true);
    return page;
  }
  try {
    const page = await openPage({ viewport: { width: 1440, height: 900 } });
    assert.equal(await page.locator('#pages-table-body tr').count(), 25);
    await page.locator('[data-tab="pages"]').first().click();
    await page.locator('#page-search-input').fill(sample.pages[0].title);
    assert.equal(await page.locator('#pages-table-body tr:visible').count(), 1);
    await page.locator('[data-inspect="0"]').click();
    assert.equal(await page.locator('#drawer-findings-list article').count(), 22);
    assert.equal(await page.locator('#drawer-findings-list .plain-guide').count(), 22);
    await page.locator('#drawer-close').click();

    await page.emulateMedia({ media: 'print' });
    const printColors = await page.evaluate(() => ({
      scorecard: getComputedStyle(document.querySelector('#metric-grid-container .metric-card>div:last-child')).backgroundColor,
      roadmapLink: getComputedStyle(document.querySelector('#roadmap-list .affected-links a')).color
    }));
    assert.equal(printColors.scorecard, 'rgb(243, 246, 252)');
    assert.equal(printColors.roadmapLink, 'rgb(29, 78, 216)');
    await page.emulateMedia({ media: 'screen' });

    await page.evaluate(() => { window.__printCount = 0; window.print = () => { window.__printCount++; }; });
    await page.locator('#export-pdf').click();
    assert.equal(await page.evaluate(() => window.__printCount), 1);
    assert.equal(await page.locator('#aeogeo-page-appendix .pdf-metric').count(), 550);
    assert.equal(await page.locator('#aeogeo-page-appendix img').count(), 0);
    const sections = await page.locator('#aeogeo-page-appendix .pdf-site-page').evaluateAll(nodes => nodes.map(section => ({
      header: section.querySelector('header').textContent,
      cards: [...section.querySelectorAll('.pdf-metric')].map(card => card.textContent)
    })));
    assert.equal(sections.length, 25);
    for (let i = 0; i < 25; i++) {
      assert.ok(sections[i].header.includes(sample.pages[i].url));
      assert.equal(sections[i].cards.length, 22);
      for (let j = 0; j < 22; j++) {
        const card = normalize(sections[i].cards[j]), metric = sample.pages[i].metrics[j];
        for (const key of ['name', 'evidence', 'fix', 'method', 'status']) assert.ok(card.includes(normalize(metric[key])), `page ${i + 1}, check ${j + 1}, ${key}`);
        assert.ok(card.includes(metric.score == null ? 'Not scored' : `${metric.score}/100`));
      }
    }
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    assert.equal(await page.locator('#pages-table-body tr:visible').count(), 25);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    assert.equal(await page.locator('#pages-table-body tr:visible').count(), 1);
    assert.equal(await page.locator('#aeogeo-page-appendix').count(), 0);
    await page.evaluate(() => {
      window.__pdfCardCount = 0;
      window.addEventListener('beforeprint', () => {
        window.__pdfCardCount = document.querySelectorAll('#aeogeo-page-appendix .pdf-metric').length;
      });
    });
    // Explicitly choose print media for compatibility with different Chromium
    // and Playwright releases, then return to normal screen media afterward.
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ format: 'Letter', printBackground: true });
    await page.emulateMedia({ media: null });
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.equal(await page.evaluate(() => window.__pdfCardCount), 550);
    // Chromium writes one plain /Type /Page dictionary per printed sheet.
    // The 25 website sections each start on a new sheet, so fewer than 25
    // means the print-only appendix was not rendered.
    const sheetCount = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
    assert.ok(sheetCount >= 25, `Only ${sheetCount} PDF page dictionaries in ${pdf.length} bytes`);
    assert.equal(await page.locator('#pages-table-body tr:visible').count(), 1);
    assert.equal(await page.locator('#aeogeo-page-appendix').count(), 0);
    await page.close();

    const fallback = await openPage({}, true), dialogs = [];
    fallback.on('dialog', dialog => { dialogs.push(dialog.message()); return dialog.dismiss(); });
    await fallback.evaluate(() => { window.__printed = false; window.print = () => { window.__printed = true; }; });
    await fallback.locator('#export-pdf').click();
    assert.match(dialogs[0], /did not load/);
    assert.equal(await fallback.evaluate(() => window.__printed), false);
    await fallback.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    assert.match(await fallback.locator('#aeogeo-print-warning').textContent(), /INCOMPLETE REPORT/);
    await fallback.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await fallback.close();

    // A different fictional customer with fewer analyzed pages gets its own
    // report, not a hard-coded copy of the 25-page fixture above.
    const other = structuredClone(sample);
    other.target = 'https://other-customer.example/';
    other.pages = other.pages.slice(0, 3).map((item, i) => ({
      ...item, title: `Other customer page ${i + 1}`, url: `https://other-customer.example/page-${i + 1}/`
    }));
    other.pageCount = other.pages.length;
    const short = await openPage({ viewport: { width: 1440, height: 900 } }, false, other);
    await short.evaluate(() => { window.print = () => {}; });
    await short.locator('#export-pdf').click();
    assert.equal(await short.locator('#aeogeo-page-appendix .pdf-site-page').count(), 3);
    assert.equal(await short.locator('#aeogeo-page-appendix .pdf-metric').count(), 66);
    const otherText = await short.locator('#aeogeo-page-appendix').textContent();
    assert.ok(otherText.includes('Website page 3 of 3: Other customer page 3'));
    assert.ok(otherText.includes('https://other-customer.example/page-3/'));
    assert.ok(!otherText.includes('https://fixture.invalid/page-25/'));
    await short.close();

    const mobile = await openPage({ viewport: { width: 390, height: 844 } });
    await mobile.locator('[data-tab="pages"]').first().click();
    await mobile.locator('[data-inspect="0"]').click();
    assert.equal(await mobile.locator('#drawer-findings-list article').count(), 22);
    assert.equal(await mobile.locator('#drawer-findings-list .plain-guide').count(), 22);
    await mobile.close();
    assert.deepEqual(blocked, []);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
  }
});
