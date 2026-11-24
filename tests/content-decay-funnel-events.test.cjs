'use strict';

// Funnel events for the content decay page.
//
// The $49 report has had scans but no purchases, so the free scan page records
// the steps a visitor takes in Google Analytics: the scan finishing, the
// fact-check link being seen and clicked, the $49 offer being clicked, Stripe
// checkout opening, and the sign-in gate (where a signed-out visitor never
// reaches checkout at all). The offer and checkout steps carry the fact counts
// they followed, so clicks can be compared with and without the fact block.
//
// These tests pin the behaviour: the events fire once, at the right moment,
// carry counts only, and stay silent when the visitor has not allowed
// analytics.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM, VirtualConsole} = require('jsdom');

const CODE = fs.readFileSync(path.join(__dirname, '..', 'site', 'assets', 'content-decay.js'), 'utf8');
const TOKEN = 'c'.repeat(48);

const SCAN = {
  token: TOKEN,
  id: '33333333-3333-4333-8333-333333333333',
  status: 'completed',
  hostname: 'example.com',
  pageLimit: 10,
  pagesScanned: 10,
  overallScore: 61,
  summary: {pagesDiscovered: 10, averageWords: 640, coverageComplete: true},
  factCheck: {factsCompared: 32, disagreements: 3},
  createdAt: '2026-11-24T10:00:00.000Z',
  completedAt: '2026-11-24T10:01:00.000Z',
  error: null
};

const HTML = `<!doctype html><html><body>
<form id="cd-form"><input id="cd-url"><button id="cd-submit" type="submit">Scan</button></form>
<p id="cd-status"></p>
<section id="cd-results" hidden>
  <p id="cd-scope"></p><dl id="cd-metrics"></dl><p id="cd-note"></p>
  <div id="cd-facts" hidden>
    <h3 class="cd-facts-title">Fact check across your pages</h3>
    <p id="cd-facts-line"></p>
    <a id="cd-facts-link" href="#cd-offer" hidden>See each contradiction in the report</a>
  </div>
</section>
<section id="cd-offer" hidden>
  <span id="cd-offer-host"></span>
  <button id="cd-buy" type="button">Buy the report</button>
  <p id="cd-buy-status"></p>
</section>
</body></html>`;

function mount({consent = true, session = null, scan = SCAN} = {}) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', () => {});
  const dom = new JSDOM(HTML, {
    url: 'https://aeogeosearch.com/content-decay/',
    runScripts: 'outside-only',
    virtualConsole
  });
  const w = dom.window;
  const events = [];
  w.gtag = (...args) => events.push(args);
  w.AEOGEOCookieConsent = {allowsAnalytics: () => consent};
  // Polling normally waits two seconds between checks; the page logic does not
  // change if that resolves sooner, so the tests keep it instant.
  w.setTimeout = fn => {
    queueMicrotask(fn);
    return 1;
  };
  const observers = [];
  w.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe(element) {
      this.element = element;
    }
    disconnect() {
      this.disconnected = true;
    }
  };
  w.fetch = async (url, options) => {
    const queued = Boolean(options && options.method === 'POST');
    return {
      ok: true,
      status: queued ? 202 : 200,
      json: async () => (queued ? {token: TOKEN, status: 'queued', pageLimit: 10} : scan)
    };
  };
  if (session) w.ContentDecaySession = session;
  w.eval(CODE);
  return {dom, w, events, observers};
}

// The page runs inside the jsdom realm, so its parameter objects do not share
// this file's Object prototype. Round-trip them through JSON to compare values.
function named(events, name) {
  return events
    .filter(entry => entry[0] === 'event' && entry[1] === name)
    .map(entry => JSON.parse(JSON.stringify(entry[2] ?? null)));
}

async function waitFor(check, label, timeout = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (check()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('timed out waiting for ' + label);
}

async function runScan(env) {
  const form = env.w.document.getElementById('cd-form');
  env.w.document.getElementById('cd-url').value = 'https://example.com';
  form.dispatchEvent(new env.w.Event('submit', {cancelable: true, bubbles: true}));
  await waitFor(() => !env.w.document.getElementById('cd-results').hidden, 'scan to finish');
}

test('a finished scan reports what the scan found, as counts', async () => {
  const env = mount();
  await runScan(env);
  const [complete, ...rest] = named(env.events, 'content_decay_scan_complete');
  assert.deepEqual(complete, {pages_scanned: 10, fact_check: 1, disagreements: 3});
  assert.equal(rest.length, 0, 'the scan event fires once per scan');
});

test('no analytics consent means no event at all', async () => {
  const env = mount({consent: false});
  await runScan(env);
  env.observers.forEach(observer => observer.callback([{isIntersecting: true}]));
  assert.deepEqual(env.events, []);
});

test('seeing the fact-check link is recorded once, when it scrolls into view', async () => {
  const env = mount();
  await runScan(env);
  assert.deepEqual(named(env.events, 'content_decay_fact_link_view'), [], 'not before it is visible');

  const observer = env.observers.at(-1);
  assert.ok(observer, 'the link is observed while the block is on screen');
  observer.callback([{isIntersecting: false}]);
  assert.deepEqual(named(env.events, 'content_decay_fact_link_view'), [], 'a hidden link is not a view');

  observer.callback([{isIntersecting: true}]);
  observer.callback([{isIntersecting: true}]);
  assert.deepEqual(named(env.events, 'content_decay_fact_link_view'), [{disagreements: 3}]);
});

test('clicking the fact-check link is recorded with the disagreement count', async () => {
  const env = mount();
  await runScan(env);
  const link = env.w.document.getElementById('cd-facts-link');
  link.dispatchEvent(new env.w.MouseEvent('click', {bubbles: true, cancelable: true}));
  assert.deepEqual(named(env.events, 'content_decay_fact_link_click'), [{disagreements: 3}]);
});

test('a signed-out buyer is recorded at the sign-in gate, not at checkout', async () => {
  const env = mount({session: {session: async () => null, api: async () => ({}), signInUrl: () => '/login'}});
  await runScan(env);
  env.w.document.getElementById('cd-buy').dispatchEvent(new env.w.MouseEvent('click', {bubbles: true}));
  await waitFor(() => named(env.events, 'content_decay_checkout_signin').length === 1, 'the sign-in gate');
  assert.deepEqual(named(env.events, 'content_decay_checkout_open'), []);
});

test('clicking the $49 offer is recorded next to the fact count it followed', async () => {
  const env = mount({session: {session: async () => null, api: async () => ({}), signInUrl: () => '/login'}});
  await runScan(env);
  env.w.document.getElementById('cd-buy').dispatchEvent(new env.w.MouseEvent('click', {bubbles: true}));
  await waitFor(() => named(env.events, 'content_decay_offer_click').length === 1, 'the offer click');
  assert.deepEqual(named(env.events, 'content_decay_offer_click'), [
    {fact_check: 1, facts_compared: 32, disagreements: 3}
  ]);
  await waitFor(() => named(env.events, 'content_decay_checkout_signin').length === 1, 'the sign-in gate');
  assert.deepEqual(named(env.events, 'content_decay_checkout_signin'), [
    {fact_check: 1, facts_compared: 32, disagreements: 3}
  ]);
});

test('a scan with no fact count reports zero, so the offer funnel can be split', async () => {
  const env = mount({
    scan: {...SCAN, factCheck: null},
    session: {session: async () => null, api: async () => ({}), signInUrl: () => '/login'}
  });
  await runScan(env);
  assert.equal(env.w.document.getElementById('cd-facts').hidden, true, 'the block stays hidden');
  env.w.document.getElementById('cd-buy').dispatchEvent(new env.w.MouseEvent('click', {bubbles: true}));
  await waitFor(() => named(env.events, 'content_decay_offer_click').length === 1, 'the offer click');
  assert.deepEqual(named(env.events, 'content_decay_offer_click'), [
    {fact_check: 0, facts_compared: 0, disagreements: 0}
  ]);
});

test('checkout opening is recorded when the payment link is returned', async () => {
  const env = mount({
    session: {
      session: async () => ({access_token: 'token'}),
      api: async () => ({url: 'https://checkout.stripe.com/c/pay/cs_test'}),
      signInUrl: () => '/login'
    }
  });
  await runScan(env);
  env.w.document.getElementById('cd-buy').dispatchEvent(new env.w.MouseEvent('click', {bubbles: true}));
  await waitFor(() => named(env.events, 'content_decay_checkout_open').length === 1, 'checkout to open');
  assert.deepEqual(named(env.events, 'content_decay_checkout_open'), [
    {fact_check: 1, facts_compared: 32, disagreements: 3}
  ]);
  assert.deepEqual(named(env.events, 'content_decay_checkout_signin'), []);
});

test('the events never carry a scan id, hostname or url', async () => {
  const env = mount();
  await runScan(env);
  env.w.document.getElementById('cd-facts-link')
    .dispatchEvent(new env.w.MouseEvent('click', {bubbles: true, cancelable: true}));
  const payload = JSON.stringify(env.events);
  for (const secret of [SCAN.id, TOKEN, 'example.com', 'https://']) {
    assert.equal(payload.includes(secret), false, 'event payload must not include ' + secret);
  }
});
