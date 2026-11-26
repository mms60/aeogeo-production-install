'use strict';

// Reconciliation between Stripe credit payments and credit rows.
//
// These tests pin the two failures the check exists to catch: a paid credit
// checkout with no live credit row, and a reservation that is still pending
// after Stripe completed its session. They also pin what must NOT be flagged
// (an unused or claimed credit, a refunded credit, an unpaid checkout, another
// product or the other Stripe mode) and that findings stay free of buyer data
// such as the email address or checkout URL.

const test = require('node:test');
const assert = require('node:assert/strict');

const {reconcileCredits} = require('../netlify/functions/lib/content-decay-reconcile');

const CREDIT_ID = 'df77106b-c5c9-4b69-b1bb-11e8f7075ccd';
const SESSION_ID = 'cs_live_agUgsmiIMcCHkxhQ8F5nTGwPfqTmaluNuJoSJwccc0l40H5ANNwZNG5CbJ';

function session(over = {}) {
  return {
    id: SESSION_ID,
    status: 'complete',
    payment_status: 'paid',
    livemode: true,
    created: 1764107400,
    amount_total: 4999,
    currency: 'usd',
    customer_details: {email: 'buyer@example.com'},
    url: 'https://checkout.stripe.com/c/pay/cs_live_secret_link',
    metadata: {
      product: 'content_decay',
      kind: 'credit',
      credit_id: CREDIT_ID,
      user_id: '9db3f346-8fd2-4b6b-9750-1713dcde92b0',
      environment: 'live'
    },
    ...over
  };
}

function row(over = {}) {
  return {
    id: CREDIT_ID,
    status: 'open',
    environment: 'live',
    user_id: '9db3f346-8fd2-4b6b-9750-1713dcde92b0',
    stripe_session_id: SESSION_ID,
    amount_total: 4999,
    currency: 'usd',
    created_at: '2026-11-25T21:50:17.944Z',
    ...over
  };
}

function run({sessions = [session()], credits = [row()], environment = 'live'} = {}) {
  return reconcileCredits({sessions, credits, environment});
}

test('a paid credit with an open credit row is clean', () => {
  const result = run();
  assert.deepEqual(result.findings, []);
  assert.equal(result.counts.paidCreditSessions, 1);
});

test('a claimed credit is finished, not missing', () => {
  const result = run({credits: [row({status: 'claimed'})]});
  assert.deepEqual(result.findings, []);
});

test('a paid credit payment with no credit row is critical', () => {
  const result = run({credits: []});
  assert.equal(result.findings.length, 1);
  const [finding] = result.findings;
  assert.equal(finding.kind, 'paid_without_credit');
  assert.equal(finding.severity, 'critical');
  assert.equal(finding.sessionId, SESSION_ID);
  assert.equal(finding.creditId, CREDIT_ID);
  assert.equal(finding.status, 'missing');
  assert.equal(finding.amountTotal, 4999);
  assert.equal(finding.createdAt, new Date(1764107400 * 1000).toISOString());
});

test('a paid credit whose reservation is still pending is critical', () => {
  const pending = run({credits: [row({status: 'pending'})]});
  assert.equal(pending.findings.length, 1, 'the paid row is flagged once, in one direction');
  assert.equal(pending.findings[0].kind, 'pending_after_payment');
  assert.equal(pending.findings[0].severity, 'critical');
  assert.equal(pending.findings[0].status, 'pending');
});

test('a paid credit that expired is critical', () => {
  const result = run({credits: [row({status: 'expired'})]});
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].kind, 'paid_credit_not_open');
  assert.equal(result.findings[0].severity, 'critical');
  assert.equal(result.findings[0].status, 'expired');
});

test('a refunded or revoked credit is reported for review, not as critical', () => {
  for (const status of ['refunded', 'revoked']) {
    const result = run({credits: [row({status})]});
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].kind, 'paid_credit_not_open');
    assert.equal(result.findings[0].severity, 'review');
    assert.equal(result.findings[0].status, status);
  }
  assert.equal(run({credits: [row({status: 'refunded'})]}).counts.critical, 0);
});

test('an unpaid or expired checkout is not a payment', () => {
  const unpaid = run({sessions: [session({status: 'open', payment_status: 'unpaid'})], credits: []});
  const expired = run({sessions: [session({status: 'expired', payment_status: 'unpaid'})], credits: []});
  assert.deepEqual(unpaid.findings, []);
  assert.deepEqual(expired.findings, []);
});

test('checkouts for other products, other kinds or the other Stripe mode are ignored', () => {
  assert.deepEqual(run({
    sessions: [session({metadata: {product: 'geo_audit', kind: 'credit', credit_id: CREDIT_ID}})],
    credits: []
  }).findings, []);
  assert.deepEqual(run({
    sessions: [session({metadata: {product: 'content_decay', kind: 'report', credit_id: CREDIT_ID}})],
    credits: []
  }).findings, []);
  assert.deepEqual(run({sessions: [session({livemode: false})], credits: []}).findings, []);
  assert.deepEqual(run({sessions: [session()], credits: [], environment: 'test'}).findings, []);
});

test('a pending reservation whose session is unpaid or expired is not flagged', () => {
  const pending = row({status: 'pending'});
  assert.deepEqual(run({sessions: [session({status: 'open', payment_status: 'unpaid'})], credits: [pending]}).findings, []);
  assert.deepEqual(run({sessions: [session({status: 'expired', payment_status: 'unpaid'})], credits: [pending]}).findings, []);
  assert.deepEqual(run({sessions: [], credits: [pending]}).findings, []);
});

test('a pending reservation without a session id cannot be checked and is not guessed', () => {
  const result = run({sessions: [], credits: [row({status: 'pending', stripe_session_id: null})]});
  assert.deepEqual(result.findings, []);
});

test('a pending reservation is caught from the row even when the session carries no credit metadata', () => {
  const legacy = session({metadata: {product: 'content_decay'}});
  const result = run({sessions: [legacy], credits: [row({status: 'pending'})]});
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].kind, 'pending_after_payment');
  assert.equal(result.findings[0].creditId, CREDIT_ID);
});

test('the row total is used when Stripe omits the session amount', () => {
  const result = run({sessions: [session({amount_total: undefined})], credits: [row({status: 'expired'})]});
  assert.equal(result.findings[0].amountTotal, 4999);
});

test('findings never carry the buyer email, checkout URL or card data', () => {
  const result = run({credits: []});
  const payload = JSON.stringify(result.findings);
  for (const secret of ['buyer@example.com', 'checkout.stripe.com', 'customer_details', 'url']) {
    assert.equal(payload.includes(secret), false, 'finding payload must not include ' + secret);
  }
});

test('counts describe what was examined, including pending rows', () => {
  const result = run({
    sessions: [session(), session({id: 'cs_live_second', metadata: {product: 'content_decay'}})],
    credits: [row({status: 'pending'}), row({id: 'other', stripe_session_id: 'cs_live_none'})]
  });
  assert.equal(result.counts.sessions, 2);
  assert.equal(result.counts.paidCreditSessions, 1);
  assert.equal(result.counts.credits, 2);
  assert.equal(result.counts.pending, 1);
});
