'use strict';

// The service checkout page used to answer every non-JSON reply with one line:
// "The payment service returned an unreadable response." That is what a visitor
// saw when the platform, not the payment code, returned an error page. These
// tests pin the behaviour that replaced it: a transient platform failure on the
// read is retried once, the status is named, and a refusal from the server
// (expired browser session, closed checkout) is shown exactly as the server sent
// it and is never retried.
//
// The write is different. Opening checkout creates a Stripe session and the
// customer inside it, and the server's idempotency key for that call is derived
// from this browser's signed cookie. An automatic retry that arrived without the
// cookie would key a second session and a second customer, so a POST is never
// retried: the visitor is told to press the button again.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM, VirtualConsole} = require('jsdom');

const CODE = fs.readFileSync(path.join(__dirname, '..', 'site', 'assets', 'service-checkout.js'), 'utf8');

const HTML = `<!doctype html><html><head><meta name="description" content=""></head><body>
<p id="service-type"></p><h1 id="service-title"></h1><p id="service-price"></p>
<ul id="service-features"></ul><p id="service-notice"></p>
<p id="service-message">Preparing secure guest checkout...</p>
<div id="service-test-email-row" hidden><label for="service-test-email">Approved test email</label><input id="service-test-email" type="email"></div>
<button id="service-purchase" disabled></button>
<button id="service-manage" hidden></button>
<p id="service-subscription" hidden></p>
<a id="service-contact" hidden></a>
<p id="service-terms"></p>
</body></html>`;

function mount(responses) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', () => {});
  const dom = new JSDOM(HTML, {
    url: 'https://aegeosearch.com/service-checkout/?service=knowledge-base',
    runScripts: 'outside-only',
    virtualConsole
  });
  const w = dom.window;
  const calls = [];
  // The page waits before its single retry; the tests do not need to.
  w.setTimeout = fn => {
    queueMicrotask(fn);
    return 1;
  };
  w.fetch = async (url, init) => {
    calls.push({url: String(url), init});
    const next = responses.shift();
    if (!next) throw new Error('unexpected request: ' + url);
    return {
      status: next.status,
      ok: next.status >= 200 && next.status < 300,
      text: async () => next.body
    };
  };
  w.eval(CODE);
  return {w, calls, message: () => w.document.getElementById('service-message').textContent};
}

async function waitFor(check, label, timeout = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (check()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('timed out waiting for ' + label);
}

const PLATFORM_ERROR = {status: 502, body: '<html><body>Function invocation failed</body></html>'};
const READY = {
  status: 200,
  body: JSON.stringify({checkoutOpen: true, planSwitchSupported: true, mode: 'live', csrf: 'csrf-1', paid: false, status: 'ready'})
};

test('a platform error page is retried once and then named with its status', async () => {
  const env = mount([PLATFORM_ERROR, PLATFORM_ERROR]);
  await waitFor(() => /did not answer/.test(env.message()), 'the failure message');
  assert.equal(env.calls.length, 2, 'exactly one retry, no loop');
  assert.match(env.message(), /HTTP 502/);
  assert.match(env.message(), /Nothing was charged/);
});

test('a retry that succeeds shows the normal checkout, not an error', async () => {
  const env = mount([PLATFORM_ERROR, READY]);
  await waitFor(() => /No AEOGEO account needed/.test(env.message()), 'the ready message');
  assert.equal(env.calls.length, 2);
});

test('a refusal from the server is shown verbatim and never retried', async () => {
  const refusal = {status: 403, body: JSON.stringify({error: 'Refresh this checkout page before continuing.'})};
  const env = mount([refusal]);
  await waitFor(() => /Refresh this checkout page/.test(env.message()), 'the refusal');
  assert.equal(env.calls.length, 1, 'a 4xx is not transient');
  assert.equal(env.message(), 'Refresh this checkout page before continuing.');
});

test('a checkout request keeps its CSRF token and JSON content type', async () => {
  const env = mount([READY]);
  await waitFor(() => /No AEOGEO account needed/.test(env.message()), 'the ready message');
  const [call] = env.calls;
  assert.equal(call.init.method, 'GET');
  assert.equal(call.init.credentials, 'same-origin');
  assert.match(call.url, /\/\.netlify\/functions\/guest-service-checkout\?service=knowledge-base/);
});

test('a failed checkout POST is never retried, so it cannot open a second Stripe session', async () => {
  const env = mount([READY, PLATFORM_ERROR]);
  await waitFor(() => /No AEOGEO account needed/.test(env.message()), 'the ready state');

  env.w.document.getElementById('service-purchase').click();
  await waitFor(() => /did not answer/.test(env.message()), 'the failure message');

  assert.equal(env.calls.length, 2, 'one GET to load the page, one POST to buy, no retry');
  assert.equal(env.calls[1].init.method, 'POST', 'the write is the request that failed');
  assert.match(env.message(), /HTTP 502/);
  assert.match(env.message(), /Nothing was charged/);
  assert.match(env.message(), /press the button again/);
  assert.equal(env.w.document.getElementById('service-purchase').disabled, false,
    'the visitor can try again deliberately');
});

test('pressing the button again after a failed POST sends exactly one more write', async () => {
  const env = mount([READY, PLATFORM_ERROR, READY]);
  await waitFor(() => /No AEOGEO account needed/.test(env.message()), 'the ready state');
  const button = env.w.document.getElementById('service-purchase');

  button.click();
  await waitFor(() => /did not answer/.test(env.message()), 'the failure message');
  assert.equal(env.calls.length, 2);

  button.click();
  await waitFor(() => /No AEOGEO account needed/.test(env.message()), 'the second attempt');
  assert.equal(env.calls.length, 3, 'a deliberate second press sends one request, not a burst');
  assert.deepEqual(env.calls.map(call => call.init.method), ['GET', 'POST', 'POST']);
});

test('the checkout POST carries the service, action, CSRF token and JSON body', async () => {
  const env = mount([READY, PLATFORM_ERROR]);
  await waitFor(() => /No AEOGEO account needed/.test(env.message()), 'the ready state');
  env.w.document.getElementById('service-purchase').click();
  await waitFor(() => /did not answer/.test(env.message()), 'the failure message');

  const post = env.calls[1].init;
  assert.equal(post.method, 'POST');
  assert.equal(post.credentials, 'same-origin');
  assert.equal(post.headers['Content-Type'], 'application/json');
  const body = JSON.parse(post.body);
  assert.equal(body.service, 'knowledge-base');
  assert.equal(body.action, 'checkout');
  assert.equal(body.csrf, 'csrf-1');
  assert.match(env.calls[1].url, /guest-service-checkout$/);
});
