'use strict';

// PostgreSQL-level test for the Content Decay refund path. It runs the real
// database/12-content-decay.sql in an in-process PGlite instance, so npm test
// proves the refund RPC itself marks the purchase refunded and revokes the
// entitlement that opens the paid report.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

let PGlite;
try {
  ({PGlite} = require('@electric-sql/pglite'));
} catch {}

const MIGRATION = fs.readFileSync(
  path.join(__dirname, '../database/12-content-decay.sql'), 'utf8');

// PGlite ships no pgcrypto bundle. Only the scan token default needs it, so this
// provides an equivalent random-bytes function instead of that one extension.
// Every statement the refund RPC depends on runs exactly as written.
const SETUP = `
  create role anon;
  create role authenticated;
  create role service_role;
  create schema auth;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
  create function public.gen_random_bytes(n integer) returns bytea
    language sql as $$
      select substring(sha256(convert_to(random()::text || clock_timestamp()::text, 'UTF8')) from 1 for n)
    $$;
`;

const migrationSql = () => MIGRATION.replace('create extension if not exists pgcrypto;', '');

test('content_decay_refund_purchase refunds the purchase and revokes its entitlement',
  {skip: !PGlite && 'Install dev dependencies for the PostgreSQL integration test.'},
  async () => {
    const db = new PGlite();
    try {
      await db.exec(SETUP);
      await db.exec(migrationSql());

      const user = crypto.randomUUID();
      const run = crypto.randomUUID();
      const scan = crypto.randomUUID();
      const purchaseId = crypto.randomUUID();
      const paymentIntent = 'pi_test_refund_1';

      await db.query('insert into auth.users(id) values($1)', [user]);
      await db.query(
        "insert into public.content_decay_test_runs(id,label) values($1,'refund test')", [run]);
      await db.query(
        "insert into public.content_decay_scans(id,user_id,environment,test_run_id,target_url,hostname,status) values($1,$2,'test',$3,'https://example.com/','example.com','completed')",
        [scan, user, run]);
      await db.query(
        "insert into public.content_decay_purchases(id,user_id,scan_id,status,stripe_session_id,stripe_payment_intent,stripe_price_id,amount_total,currency,livemode,environment,test_run_id) values($1,$2,$3,'paid',$4,$5,'price_test_1',1999,'usd',false,'test',$6)",
        [purchaseId, user, scan, 'cs_test_refund_1', paymentIntent, run]);

      const status = async table => (await db.query(
        'select status from public.' + table + ' where '
          + (table === 'content_decay_entitlements' ? 'purchase_id' : 'id') + '=$1',
        [purchaseId])).rows[0]?.status;
      const access = async () => (await db.query(
        'select public.content_decay_access($1,$2,$3) as ok',
        [user, scan, 'test'])).rows[0].ok;
      const refund = async live => (await db.query(
        'select public.content_decay_refund_purchase($1,$2) as id',
        [paymentIntent, live])).rows[0].id;

      // A paid purchase with an active entitlement opens the paid report.
      const granted = (await db.query(
        'select public.content_decay_grant_entitlement($1) as id',
        [purchaseId])).rows[0].id;
      assert.ok(granted, 'the entitlement is granted');
      assert.equal(await status('content_decay_purchases'), 'paid');
      assert.equal(await status('content_decay_entitlements'), 'active');
      assert.equal(await access(), true);

      // The refund ends both rows and closes the access check.
      assert.equal(await refund(false), purchaseId);
      assert.equal(await status('content_decay_purchases'), 'refunded');
      assert.equal(await status('content_decay_entitlements'), 'revoked');
      assert.equal(await access(), false);

      // Stripe retries are safe: a replayed refund changes nothing further.
      assert.equal(await refund(false), purchaseId);
      assert.equal(await status('content_decay_purchases'), 'refunded');
      assert.equal(await status('content_decay_entitlements'), 'revoked');
      assert.equal(await access(), false);

      // A live refund can never touch a test purchase.
      assert.equal(await refund(true), null);
      assert.equal(await status('content_decay_purchases'), 'refunded');
      assert.equal(await status('content_decay_entitlements'), 'revoked');
      assert.equal(await access(), false);

      // The refund RPC stays unreachable from browser roles.
      for (const role of ['anon', 'authenticated']) {
        const row = (await db.query(
          "select has_function_privilege($1,'public.content_decay_refund_purchase(text,boolean)','EXECUTE') as allowed",
          [role])).rows[0];
        assert.equal(row.allowed, false, role + ' must not execute the refund RPC');
      }
    } finally {
      await db.close();
    }
  });
