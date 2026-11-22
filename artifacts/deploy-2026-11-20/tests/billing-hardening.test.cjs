'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {stripeID, invoiceSubscription, paidInvoiceThrough} = require('../netlify/functions/lib/billing-objects');
const {checkoutHandler} = require('../netlify/functions/lib/checkout');
const {PLANS} = require('../netlify/functions/lib/plans');
const {UUID, reply} = require('../netlify/functions/lib/db');
const map = id => id === 'price_month' ? {plan: 'starter'} : null;

test('invoice subscription IDs support strings, expansions and the newer parent shape', () => {
 assert.equal(stripeID({id: 'cus_1'}), 'cus_1');
 assert.equal(invoiceSubscription({subscription: 'sub_1'}), 'sub_1');
 assert.equal(invoiceSubscription({subscription: {id: 'sub_2'}}), 'sub_2');
 assert.equal(invoiceSubscription({parent: {subscription_details: {subscription: 'sub_3'}}}), 'sub_3');
 assert.equal(invoiceSubscription({}), null);
});
test('paid invoice period handles old and new price shapes but never unrelated lines', () => {
 const end = 1900000000;
 const old = {status: 'paid', paid: true, lines: {data: [{type: 'subscription', price: {id: 'price_month'}, period: {end}}, {type: 'invoiceitem', price: {id: 'price_month'}, period: {end: end + 1000}}]}};
 assert.equal(paidInvoiceThrough(old, 'starter', map), new Date(end * 1000).toISOString());
 const modern = {status: 'paid', amount_remaining: 0, lines: {data: [{parent: {type: 'subscription_item_details'}, pricing: {price_details: {price: 'price_month'}}, period: {end}}]}};
 assert.equal(paidInvoiceThrough(modern, 'starter', map), new Date(end * 1000).toISOString());
 assert.equal(paidInvoiceThrough({...old, paid: false}, 'starter', map), null);
 assert.equal(paidInvoiceThrough({...old, status: 'open'}, 'starter', map), null);
 assert.equal(paidInvoiceThrough(old, 'agency', map), null);
 assert.throws(() => paidInvoiceThrough({...old, lines: {...old.lines, has_more: true}}, 'starter', map), /complete reconciliation/);
});

function fixture(options = {}) {
 const uid = crypto.randomUUID();
 let state = null;
 const sessions = new Map(), byKey = new Map();
 let created = 0, active = false, canceled = false, timeout = !!options.timeout, refuseBind = !!options.refuseBind;
 const stripeCalls = [];
 const db = async (url, args) => {
  if (!url.startsWith('rpc/')) return url.startsWith('geo_subscriptions') ? [{subscription_id: options.cachedPaid ? 'sub_cached' : null, paid_through: new Date(Date.now() + 86400000).toISOString()}] : [{approved: !options.catalogFalse}];
  const b = args.body, name = url.replace('rpc/geo_checkout_', '');
  if (name === 'claim') {
   if (state?.lock) return {allowed: false, reason: 'busy'};
   if (!state || state.state === 'idle') state = {...state, allowed: true, state: 'creating', plan: b.p_plan, interval: b.p_interval, attempt_id: crypto.randomUUID(), stripe_id: null};
   state.lock = b.p_lock;
   return {...state};
  }
  if (state.lock !== b.p_lock) return false;
  if (name === 'customer') {state.customer_id = b.p_customer; return true;}
  if (name === 'bind') {
   if (refuseBind) {refuseBind = false; return false;}
   Object.assign(state, {state: 'open', stripe_id: b.p_session, checkout_url: b.p_url});return true;
  }
  if (name === 'reset') {state = {state: 'idle', customer_id: state.customer_id};return true;}
  if (name === 'release') {state.lock = null;return true;}
  throw Error('Unexpected RPC ' + name);
 };
 const stripe = async (url, args = {}) => {
  stripeCalls.push({url, args});
  if (url.startsWith('prices/')) return {id: url.slice('prices/'.length), product: 'prod_current', active: true, currency: 'usd', unit_amount: options.badPrice ? 1 : url.endsWith('year') ? 47040 : 4900, recurring: {interval: url.endsWith('year') ? 'year' : 'month', interval_count: 1}, livemode: false};
  if (url.startsWith('products/')) return {id: url.slice('products/'.length), active: true};
  if (url.startsWith('prices?lookup_keys[]=')) return {data: []};
  if (url === 'customers') return {id: 'cus_test_owned'};
  if (url.startsWith('subscriptions?')) return {data: active ? [{id: 'sub_active', status: 'active'}] : canceled ? [{id: 'sub_old', status: 'canceled'}] : [], has_more: false};
  if (url === 'checkout/sessions') {
   let s = byKey.get(args.idempotency);
   if (!s) {
    created++;
    s = {id: 'cs_test_' + created, status: 'open', client_reference_id: uid, customer: args.data.customer, livemode: false, expires_at: Math.floor(Date.now() / 1000) + 3600, url: options.badURL ? 'https://evil.example/pay' : 'https://checkout.stripe.com/c/pay/cs_test_' + created};
    sessions.set(s.id, s);byKey.set(args.idempotency, s);
   }
   if (timeout) {timeout = false;throw Error('Simulated response timeout after Stripe created the session.');}
   return {...s};
  }
  const id = url.split('/')[2], s = sessions.get(id);
  if (url.endsWith('/expire')) {s.status = 'expired';return {...s};}
  if (s) return {...s};
  throw Error('Unexpected Stripe request ' + url);
 };
 const handler = checkoutHandler({db, user: async () => ({id: uid, email: 'test-owner@example.com'}), reply, UUID, PLANS,
  priceID: (_, interval) => 'price_' + interval, billingReady: () => options.blocked || null, stripe, origin: () => 'https://aeogeosearch.com'});
 const request = (interval = 'month') => handler({httpMethod: 'POST', body: JSON.stringify({plan: 'starter', interval, requestId: crypto.randomUUID()})});
 return {request, sessions, stripeCalls, created: () => created, setActive: () => {active = true;}, setCanceled: () => {canceled = true;}};
}

test('checkout lease rejects overlapping requests and reuses the existing payable URL', async () => {
 process.env.STRIPE_SECRET_KEY = 'sk_test_unit_only_not_a_real_key';
 const f = fixture(), answers = await Promise.all([f.request(), f.request()]);
 assert.deepEqual(answers.map(a => a.statusCode).sort(), [200, 409]);
 assert.equal(f.created(), 1);
 const again = await f.request();assert.equal(again.statusCode, 200);assert.equal(f.created(), 1);
 assert.equal(JSON.parse(again.body).url, JSON.parse(answers.find(a => a.statusCode === 200).body).url);
});
test('checkout recovers an uncertain Stripe response using the same persisted attempt', async () => {
 const f = fixture({timeout: true});assert.equal((await f.request()).statusCode, 500);
 assert.equal((await f.request()).statusCode, 200);assert.equal(f.created(), 1);
 const keys = f.stripeCalls.filter(c => c.url === 'checkout/sessions').map(c => c.args.idempotency);
 assert.equal(keys[0], keys[1]);
});
test('changing billing interval closes the old session before returning the new URL', async () => {
 const f = fixture();assert.equal((await f.request()).statusCode, 200);
 assert.equal((await f.request('year')).statusCode, 200);assert.equal(f.created(), 2);
 assert.equal(f.sessions.get('cs_test_1').status, 'expired');assert.equal(f.sessions.get('cs_test_2').status, 'open');
});
test('active and completed subscriptions cannot create another checkout', async () => {
 const f = fixture();await f.request();f.setActive();assert.equal((await f.request()).statusCode, 409);assert.equal(f.created(), 1);
 const g = fixture();await g.request();g.sessions.get('cs_test_1').status = 'complete';assert.equal((await g.request()).statusCode, 409);assert.equal(g.created(), 1);
});
test('expired checkout is replaced while failed fencing and spoofed URLs disclose no URL', async () => {
 const f = fixture();await f.request();f.sessions.get('cs_test_1').status = 'expired';assert.equal((await f.request()).statusCode, 200);assert.equal(f.created(), 2);
 const g = fixture({refuseBind: true});const rejected = await g.request();assert.equal(rejected.statusCode, 409);assert.equal(JSON.parse(rejected.body).url, undefined);assert.equal((await g.request()).statusCode, 200);assert.equal(g.created(), 1);
 const h = fixture({badURL: true});assert.equal((await h.request()).statusCode, 503);
});
test('unapproved billing and incorrect price amounts cannot create Stripe customers or sessions', async () => {
 for (const options of [{blocked: 'Billing remains locked.'}, {badPrice: true}]) {
  const f = fixture(options);assert.equal((await f.request()).statusCode, 503);assert.equal(f.created(), 0);
  assert.equal(f.stripeCalls.some(c => c.url === 'customers'), false);
 }
});

let PGlite;try {({PGlite} = require('@electric-sql/pglite'));} catch {}
test('migration 04 checkout leases execute in isolated PostgreSQL and enforce fencing and access controls', {skip: !PGlite && 'Install test dependencies.'}, async () => {
 const db = new PGlite();
 try {
  await db.exec('create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$ select null::uuid $$;');
  for (const name of ['01-accounts.sql', '02-audit-limit.sql', '03-product-and-billing.sql', '04-checkout-locks.sql']) await db.exec(fs.readFileSync(path.join(__dirname, '../database', name), 'utf8'));
  const uid = crypto.randomUUID(), lock = crypto.randomUUID(), nextLock = crypto.randomUUID();
  await db.query('insert into auth.users(id) values($1)', [uid]);
  const claim = async (token, live = false) => (await db.query("select public.geo_checkout_claim($1,$2,'starter','month',$3) as r", [uid, token, live])).rows[0].r;
  const first = await claim(lock);assert.equal(first.allowed, true);assert.equal((await claim(nextLock)).reason, 'busy');
  assert.equal((await db.query("select public.geo_checkout_customer($1,$2,'cus_fixture') as r", [uid, lock])).rows[0].r, true);
  await db.query("update public.geo_checkout_sessions set lock_until=now()-interval '1 second' where user_id=$1", [uid]);
  const next = await claim(nextLock);assert.equal(next.allowed, true);assert.equal(next.attempt_id, first.attempt_id);assert.equal(next.customer_id, 'cus_fixture');
  assert.equal((await db.query("select public.geo_checkout_bind($1,$2,'cs_test_x','https://checkout.stripe.com/c/pay/x',now()+interval '1 hour') as r", [uid, lock])).rows[0].r, false);
  assert.equal((await db.query("select public.geo_checkout_bind($1,$2,'cs_test_x','https://checkout.stripe.com/c/pay/x',now()+interval '1 hour') as r", [uid, nextLock])).rows[0].r, true);
  await db.query('select public.geo_checkout_release($1,$2)', [uid, nextLock]);
  assert.equal((await claim(crypto.randomUUID(), true)).reason, 'mode_changed');
  for (const role of ['anon', 'authenticated']) {
   const access = (await db.query("select has_table_privilege($1,'public.geo_checkout_sessions','SELECT') as read,has_table_privilege($1,'public.geo_checkout_sessions','UPDATE') as write,has_function_privilege($1,'public.geo_checkout_claim(uuid,uuid,text,text,boolean)','EXECUTE') as execute", [role])).rows[0];
   assert.deepEqual(access, {read: false, write: false, execute: false});
  }
  const released = await claim(lock);assert.equal(released.stripe_id, 'cs_test_x');
  await db.query('select public.geo_checkout_reset($1,$2)', [uid, lock]);
  const fresh = await claim(nextLock);assert.notEqual(fresh.attempt_id, first.attempt_id);assert.equal(fresh.customer_id, 'cus_fixture');
  const approvals = (await db.query('select approved from public.geo_plan_catalog')).rows;assert.ok(approvals.every(a => a.approved === false));
 } finally {await db.close();}
});

test('resubscription is allowed only after an old completed checkout belongs to a terminal subscription without cached paid time', async () => {
 const f = fixture();await f.request();const old = f.sessions.get('cs_test_1');old.status = 'complete';old.subscription = 'sub_old';f.setCanceled();assert.equal((await f.request()).statusCode, 200);assert.equal(f.created(), 2);
 const g = fixture({cachedPaid: true});assert.equal((await g.request()).statusCode, 409);assert.equal(g.created(), 0);
});

test('test billing requires a verified email passed from the server and an explicit allowlist', () => {
 const {billingReady, testBillingAllowed} = require('../netlify/functions/lib/plans');
 const keys = ['BILLING_ENABLED','BILLING_REVIEW_COMPLETE','PLAN_LIMITS_APPROVED','STRIPE_SECRET_KEY','BILLING_TEST_EMAILS','LIVE_PAYMENTS_ENABLED'];
 const old = Object.fromEntries(keys.map(k => [k,process.env[k]]));
 try {
  Object.assign(process.env,{BILLING_ENABLED:'true',BILLING_REVIEW_COMPLETE:'true',PLAN_LIMITS_APPROVED:'true',STRIPE_SECRET_KEY:'sk_test_unit_only_not_a_real_key',BILLING_TEST_EMAILS:' owner@example.com ',LIVE_PAYMENTS_ENABLED:'false'});
  assert.equal(testBillingAllowed('OWNER@example.com'),true);
  assert.match(billingReady('starter','customer@example.com'),/restricted/);
  assert.match(billingReady('starter'),/restricted/);
  assert.equal(billingReady('starter','owner@example.com'),null);
  process.env.STRIPE_SECRET_KEY='sk_live_unit_only_not_a_real_key';
  assert.match(billingReady('starter','owner@example.com'),/Live payments are disabled/);
 } finally {for (const k of keys) {if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}}
});

test('portal policy enforces the owner-approved period-end cancellation policy and no unreviewed plan changes', () => {
 const {validatePortalConfiguration} = require('../netlify/functions/lib/portal-policy');
 const base = {id:'bpc_unit',active:true,livemode:false,features:{subscription_cancel:{enabled:true,mode:'at_period_end',proration_behavior:'none'},subscription_update:{enabled:false},invoice_history:{enabled:true},payment_method_update:{enabled:true}}};
 assert.equal(validatePortalConfiguration(base,false),'bpc_unit');
 for (const change of [c=>{c.active=false;},c=>{c.livemode=true;},c=>{c.features.subscription_cancel.enabled=false;},c=>{c.features.subscription_cancel.mode='immediately';},c=>{c.features.subscription_cancel.proration_behavior='create_prorations';},c=>{c.features.subscription_update.enabled=true;},c=>{c.features.payment_method_update.enabled=false;},c=>{c.features.invoice_history.enabled=false;}]) {
  const config = structuredClone(base);change(config);assert.throws(()=>validatePortalConfiguration(config,false));
 }
});


test('unapproved catalog is bypassed only for explicit owner-only Starter sandbox checkout',async()=>{
 const keys=['BILLING_TEST_ENABLED','STRIPE_SECRET_KEY','BILLING_TEST_EMAILS'];const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
  Object.assign(process.env,{BILLING_TEST_ENABLED:'true',STRIPE_SECRET_KEY:'sk_test_unit_not_real',BILLING_TEST_EMAILS:'test-owner@example.com'});
  const f=fixture({catalogFalse:true});assert.equal((await f.request()).statusCode,200);
  process.env.BILLING_TEST_EMAILS='another@example.com';const g=fixture({catalogFalse:true});assert.equal((await g.request()).statusCode,503);assert.equal(g.created(),0);
 }finally{for(const k of keys){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}}
});
