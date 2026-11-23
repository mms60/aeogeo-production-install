'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'site', 'ai-visibility-schema-studio.html'), 'utf8');
const tool = fs.readFileSync(path.join(root, 'site', 'assets', 'entity-authority-tool.js'), 'utf8');
const implementation = fs.readFileSync(path.join(root, 'netlify', 'functions', 'entity-implementation.mjs'), 'utf8');
const purchases = fs.readFileSync(path.join(root, 'netlify', 'functions', 'lib', 'entity-purchases.js'), 'utf8');
const claim = fs.readFileSync(path.join(root, 'netlify', 'functions', 'entity-purchase-claim.mjs'), 'utf8');
const webhook = fs.readFileSync(path.join(root, 'netlify', 'functions', 'stripe-webhook.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'database', '10-entity-purchases.sql'), 'utf8');

test('the public page keeps the hero and example graph intact', () => {
  assert.ok(page.includes('Help AI Search Understand Your Business'));
  assert.match(page, /id=entity-audit[^>]*aria-label="Interactive entity map example"/);
  assert.match(page, /Example Client Brand/);
});

test('the free page does not ship the JSON-LD compiler or a copy button', () => {
  assert.doesNotMatch(page, /entity-graph-builder/);
  assert.doesNotMatch(tool, /AEOEntityGraph|buildMasterKnowledgeGraph/);
  const preview = tool.slice(tool.indexOf('function renderPreview'), tool.indexOf('function renderPaidMap'));
  assert.ok(preview.length > 0);
  assert.doesNotMatch(preview, /Copy JSON-LD|Download \.json|ea-json|jsonLd|@context/);
  assert.match(preview, /Structure|structure/);

  const paid = tool.slice(tool.indexOf('function renderPaidMap'), tool.indexOf('function loadExample'));
  assert.ok(paid.length > 0);
  assert.match(paid, /Copy JSON-LD/);
  assert.match(paid, /Download \.json/);
  assert.match(paid, /Implementation instructions/);
});

test('the locked builder points to the DIY packages with accurate wording', () => {
  assert.match(tool, /Build Your Complete Brand Entity Architecture/);
  assert.match(tool, /Your business deserves more than disconnected schema markup\./);
  assert.match(tool, /Unlock the complete DIY builder with AEOGEO Search\./);
  assert.match(tool, /View DIY Builder Packages/);
  assert.match(tool, /Recommended next steps/);
  assert.match(page, /Build your business information map/);
  assert.match(page, /The free check identifies problems\. The paid plan gives you the builder that generates the complete customized JSON-LD, validates it, and tells you how to publish it\./);
  assert.match(page, /View DIY Builder Packages/);
  assert.doesNotMatch(page, /zero ambiguity/);
  assert.doesNotMatch(tool, /zero ambiguity/);
});

test('the paid copy describes self-serve access, not done-for-you work', () => {
  assert.match(page, /These plans are software access, not a done-for-you build\./);
  assert.match(page, /You supply the facts and do the publishing\./);
  assert.match(tool, /You review and publish the markup yourself; no done-for-you build or AI testing report is included\./);
  assert.doesNotMatch(page, /We develop your customized brand entity architecture/);
  assert.doesNotMatch(page, /What the paid implementation adds/);
  assert.doesNotMatch(tool, /Our complete implementation connects/);
  assert.doesNotMatch(page, /View Implementation Packages/);
  assert.doesNotMatch(tool, /View Implementation Packages/);
});

test('the DIY paid path is explained and checkout requires an account', () => {
  assert.match(page, /View DIY Builder Packages/);
  assert.match(page, /href=(?:"#pricing"|#pricing)>View DIY Builder Packages/);
  assert.match(page, /\$799 one-time/);
  assert.match(page, /\$1,199 one-time/);
  assert.match(page, /data-ea-checkout="single"/);
  assert.match(page, /data-ea-checkout="multi"/);
  assert.doesNotMatch(page, /entity-authority-checkout\?plan=/);
  assert.match(page, /does not guarantee rankings, citations, or recommendations/);
});

test('the builder locks a purchased plan and validates the free preview client-side', () => {
  assert.match(tool, /function validateBuilderInput/);
  assert.match(tool, /function applyPlanLock/);
  assert.match(tool, /select\.disabled = true/);
  assert.match(tool, /function updateSubmitLabel/);
  assert.match(tool, /Duplicate entity ID/);
});

test('the implementation endpoint checks entitlement before compiling', () => {
  assert.match(implementation, /userFromEvent/);
  assert.match(implementation, /entitlementForUser/);
  assert.match(implementation, /PURCHASE_REQUIRED/);
  assert.ok(implementation.indexOf('entitlementForUser') < implementation.indexOf('validateImplementationInput'));
  assert.ok(implementation.indexOf('validateImplementationInput') < implementation.indexOf('buildMasterKnowledgeGraphObject'));
  assert.ok(implementation.indexOf('buildMasterKnowledgeGraphObject') < implementation.indexOf('validateGraph'));
  assert.match(implementation, /validateImplementationInput\(input,\s*entitlement\.plan\)/);
  assert.match(implementation, /validateGraph/);
});

test('purchase claims are authenticated and the webhook records paid sessions', () => {
  assert.match(claim, /userFromEvent/);
  assert.match(claim, /claimPurchase/);
  assert.match(webhook, /entity-purchases/);
  assert.match(webhook, /handleWebhook/);
  assert.match(webhook, /entityPurchase/);
  assert.match(migration, /create table if not exists public\.entity_purchases/);
  assert.match(migration, /stripe_session_id text unique not null/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /auth\.uid\(\) = user_id/);
});

test('a claim must match the Stripe email and only paid sessions are recorded', () => {
  assert.match(purchases, /EMAIL_MISMATCH/);
  assert.match(purchases, /email !== userEmail/);
  assert.match(purchases, /async_payment_succeeded/);
  assert.match(purchases, /livemode !== true/);
  assert.match(purchases, /payment_status !== 'paid'/);
});

test('the shared function layer reads modern Netlify Request objects', async () => {
  const { headerValue, requestMethod, readBody } = await import('../netlify/functions/avss-shared.mjs');
  const request = new Request('https://aeogeosearch.com/.netlify/functions/entity-entitlement', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ hello: 'world' })
  });

  assert.equal(requestMethod(request), 'POST');
  assert.equal(headerValue(request.headers, 'authorization'), 'Bearer test-token');
  assert.deepEqual(await readBody(request), { hello: 'world' });
  assert.deepEqual(await readBody({ body: '{"legacy":true}' }), { legacy: true });
});

test('the studio content uses no hashtags, decorative symbols, or em dashes', () => {
  const main = page.slice(page.indexOf('<main'), page.indexOf('</main>'));
  assert.ok(main.length > 0);
  assert.doesNotMatch(main, /[•→—–]/);
});
