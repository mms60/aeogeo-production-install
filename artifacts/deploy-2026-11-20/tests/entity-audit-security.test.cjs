'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

async function shared() {
  return import('../netlify/functions/avss-shared.mjs');
}

test('rejects private, local, reserved, and credential-bearing targets', async () => {
  const { assertPublicHttpUrl } = await shared();
  for (const url of [
    'http://127.0.0.1/',
    'http://127.1/',
    'http://0.0.0.0/',
    'http://10.0.0.1/',
    'http://172.16.0.1/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data',
    'http://100.64.0.1/',
    'http://192.0.0.1/',
    'http://192.0.2.1/',
    'http://198.18.0.1/',
    'http://198.51.100.1/',
    'http://203.0.113.1/',
    'http://192.88.99.1/',
    'http://localhost./',
    'http://metadata.google.internal./',
    'http://service.internal/',
    'http://user:pass@example.com/',
    'ftp://example.com/'
  ]) {
    await assert.rejects(() => assertPublicHttpUrl(url));
  }

  assert.equal((await assertPublicHttpUrl('https://1.1.1.1/')).hostname, '1.1.1.1');
});

test('stops reading a response above the configured limit', async () => {
  const { readLimitedText } = await shared();
  await assert.rejects(
    () => readLimitedText(new Response('x'.repeat(1024)), 100),
    /too large/
  );
  assert.equal(await readLimitedText(new Response('within-limit'), 100), 'within-limit');
});

test('revalidates redirects and refuses a redirect to a private address', async () => {
  const { safeFetch } = await shared();
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return new Response(null, {
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data' }
    });
  };
  try {
    await assert.rejects(() => safeFetch('https://1.1.1.1/'));
    assert.equal(calls, 1, 'the private redirect target must be rejected before it is fetched');
  } finally {
    global.fetch = originalFetch;
  }
});

test('the audit endpoint uses the shared limiter and fails closed', async () => {
  const endpoint = (await import('../netlify/functions/entity-audit.mjs')).default;
  const keys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = global.fetch;
  let limiterStatus = 200;
  try {
    Object.assign(process.env, {
      SUPABASE_URL: 'https://fixture.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_fixture_only'
    });
    global.fetch = async input => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.pathname === '/rest/v1/rpc/consume_audit_rate_limit') {
        if (limiterStatus === 200) return Response.json(false);
        return Response.json({ message: 'limiter down' }, { status: limiterStatus });
      }
      throw new Error('Unexpected request: ' + url.href);
    };

    const request = () => new Request('https://aeogeosearch.com/.netlify/functions/entity-audit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-nf-client-connection-ip': '203.0.113.9'
      },
      body: JSON.stringify({ url: 'https://1.1.1.1/', brandName: 'Example' })
    });

    const limited = await endpoint(request());
    assert.equal(limited.status, 429);

    limiterStatus = 503;
    const unavailable = await endpoint(request());
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).code, 'RATE_LIMIT_UNAVAILABLE');
  } finally {
    global.fetch = originalFetch;
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});
