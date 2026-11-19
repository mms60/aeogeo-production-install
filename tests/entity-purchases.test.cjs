'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const purchases = require('../netlify/functions/lib/entity-purchases');
const graph = require('../netlify/functions/lib/entity-graph-builder');

const paidSession = {
  object: 'checkout.session',
  id: 'cs_live_abcdefgh',
  mode: 'payment',
  status: 'complete',
  payment_status: 'paid',
  livemode: true,
  currency: 'usd',
  amount_total: 79900,
  metadata: { product: 'entity-authority', plan: 'single' },
  customer_details: { email: 'buyer@example.com' },
  payment_intent: 'pi_live_123'
};

const input = {
  domain: 'https://examplebrand.com',
  brandName: 'Example Brand',
  description: 'A verified example brand for the entity implementation test.',
  locations: [{ name: 'Dallas Office', slug: 'dallas' }],
  people: [{ name: 'Jordan Vance', slug: 'jordan-vance' }],
  services: [{ name: 'Entity Strategy', slug: 'entity-strategy' }]
};

test('accepts only a paid live session for the offered plan and amount', () => {
  assert.equal(purchases.sessionIsPaid(paidSession, purchases.OFFERS.single), true);
  assert.equal(purchases.sessionIsPaid({ ...paidSession, amount_total: 119900 }, purchases.OFFERS.single), false);
  assert.equal(purchases.sessionIsPaid({ ...paidSession, livemode: false }, purchases.OFFERS.single), false);
  assert.equal(purchases.sessionIsPaid({ ...paidSession, payment_status: 'unpaid' }, purchases.OFFERS.single), false);
  assert.equal(purchases.sessionIsPaid({ ...paidSession, status: 'open' }, purchases.OFFERS.single), false);
  assert.equal(purchases.sessionIsPaid({ ...paidSession, metadata: { product: 'other', plan: 'single' } }, purchases.OFFERS.single), false);
  assert.equal(purchases.sessionIsPaid({ ...paidSession, metadata: { product: 'entity-authority', plan: 'multi' } }, purchases.OFFERS.single), false);
});

test('accepts the $400 Single-Hub to Multi-Location upgrade session', () => {
  const upgradeSession = {
    ...paidSession,
    id: 'cs_live_upgrade1234',
    amount_total: 40000,
    metadata: {
      product: 'entity-authority',
      plan: 'multi',
      upgrade: '1',
      previous_plan: 'single'
    }
  };
  assert.equal(purchases.sessionIsPaid(upgradeSession, purchases.OFFERS.multi), true);
  assert.equal(purchases.sessionIsUpgrade(upgradeSession, purchases.OFFERS.multi), true);
  assert.equal(purchases.sessionIsPaid({ ...upgradeSession, amount_total: 119900 }, purchases.OFFERS.multi), false);
  assert.equal(purchases.sessionIsPaid({ ...upgradeSession, metadata: { ...upgradeSession.metadata, previous_plan: 'multi' } }, purchases.OFFERS.multi), false);
});

test('keeps the plan limits aligned with the public packages', () => {
  assert.deepEqual(purchases.limitsForPlan('single'), { locations: 3, people: 2, services: 10 });
  assert.deepEqual(purchases.limitsForPlan('multi'), { locations: 10, people: 6, services: 10 });
  assert.equal(purchases.limitsForPlan('unknown'), null);
});

test('refuses input beyond the purchased plan before generation', () => {
  const tooMany = {
    ...input,
    locations: [
      { name: 'One' }, { name: 'Two' }, { name: 'Three' }, { name: 'Four' }
    ]
  };
  const single = purchases.validateImplementationInput(tooMany, 'single');
  assert.equal(single.ok, false);
  assert.equal(single.status, 403);
  assert.match(single.error, /up to 3 locations/);

  const multi = purchases.validateImplementationInput(tooMany, 'multi');
  assert.equal(multi.ok, true);

  const noPlan = purchases.validateImplementationInput(input, 'unknown');
  assert.equal(noPlan.ok, false);
  assert.equal(noPlan.code, 'PURCHASE_REQUIRED');
});

test('requires a confirmed account before contacting Stripe for a claim', async () => {
  await assert.rejects(
    purchases.claimPurchase({ id: '11111111-1111-4111-8111-111111111111', email: 'buyer@example.com' }, 'cs_live_abcdefgh'),
    /Confirm your email/
  );
});

test('validates the generated graph and catches missing identifiers and references', () => {
  const payload = graph.buildMasterKnowledgeGraphObject(input);
  assert.deepEqual(purchases.validateGraph(payload), []);

  const missingId = JSON.parse(JSON.stringify(payload));
  missingId['@graph'].push({ '@type': 'Person', name: 'No identifier' });
  assert.ok(purchases.validateGraph(missingId).some(issue => issue.includes('missing its @id')));

  const brokenReference = JSON.parse(JSON.stringify(payload));
  brokenReference['@graph'][1].employee = [{ '@id': 'https://examplebrand.com/#person-missing' }];
  assert.ok(purchases.validateGraph(brokenReference).some(issue => issue.includes('missing entity')));
});

test('rejects duplicate entity IDs instead of returning a passing graph', () => {
  const duplicate = {
    ...input,
    locations: [
      { name: 'Dallas Office', slug: 'dallas' },
      { name: 'Dallas Second Office', slug: 'dallas' }
    ]
  };
  assert.throws(() => graph.buildMasterKnowledgeGraphObject(duplicate), /Duplicate entity ID/);

  const payload = graph.buildMasterKnowledgeGraphObject(input);
  const duplicateId = JSON.parse(JSON.stringify(payload));
  duplicateId['@graph'].push({ ...duplicateId['@graph'][2] });
  assert.ok(purchases.validateGraph(duplicateId).some(issue => issue.startsWith('Duplicate @id:')));
});

test('paid instructions cover implementation and validation without guarantees', () => {
  const instructions = purchases.implementationInstructions('single');
  assert.ok(instructions.length >= 5);
  assert.ok(instructions.some(line => /validator/i.test(line)));
  assert.ok(instructions.some(line => /same @id values/i.test(line)));
  assert.ok(instructions.every(line => !/guarantee|ranking|citation/i.test(line)));
});
