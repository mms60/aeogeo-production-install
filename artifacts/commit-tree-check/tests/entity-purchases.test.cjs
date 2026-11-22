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
  metadata: { product: 'entity-authority', plan: 'single', price: purchases.OFFERS.single.priceId },
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
  assert.equal(purchases.sessionIsPaid({ ...paidSession, metadata: { ...paidSession.metadata, price: purchases.OFFERS.multi.priceId } }, purchases.OFFERS.single), false);
});

test('accepts the $400 Single-Hub to Multi-Location upgrade session', () => {
  const upgradeSession = {
    ...paidSession,
    id: 'cs_live_upgrade1234',
    amount_total: 40000,
    metadata: {
      product: 'entity-authority',
      plan: 'multi',
      price: purchases.OFFERS.multi.priceId,
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

test('validates required fields, field types, URLs, and coordinate ranges before generation', () => {
  const valid = purchases.validateImplementationInput(input, 'single');
  assert.equal(valid.ok, true, valid.error);

  const reject = (patch, pattern) => {
    const result = purchases.validateImplementationInput({ ...input, ...patch }, 'single');
    assert.equal(result.ok, false, JSON.stringify(patch));
    assert.equal(result.status, 400);
    assert.equal(result.code, 'INVALID_INPUT');
    assert.match(result.error, pattern);
  };

  reject({ domain: 'not-a-url' }, /domain/);
  reject({ brandName: '   ' }, /brandName/);
  reject({ description: '' }, /description/);
  reject({ logoUrl: 'javascript:alert(1)' }, /logoUrl/);
  reject({ foundingYear: 'not-a-year' }, /foundingYear/);
  reject({ locations: 'Dallas' }, /locations must be a list/);
  reject({ locations: [{ name: '', slug: 'empty' }] }, /locations\[0\]\.name/);
  reject({ locations: [{ name: 'Dallas', slug: 'dallas', latitude: 32.7 }] }, /both latitude and longitude/);
  reject({ locations: [{ name: 'Dallas', slug: 'dallas', latitude: '   ', longitude: 0 }] }, /both latitude and longitude/);
  reject({ locations: [{ name: 'Dallas', slug: 'dallas', latitude: 91, longitude: 0 }] }, /latitude/);
  reject({ sameAsUrls: ['not-a-url'] }, /sameAsUrls\[0\]/);
  reject({ sameAsUrls: Array.from({ length: 26 }, (_, index) => 'https://example.com/' + index) }, /at most 25/);
  reject({ people: [{ name: 'A', slug: 'a', knowsAbout: Array.from({ length: 21 }, (_, index) => 'Topic ' + index) }] }, /at most 20/);
  reject({ people: [{ name: 'A', slug: 'a', sameAsUrls: ['ftp://example.com/profile'] }] }, /sameAsUrls\[0\]/);
  reject({ services: [{ name: 'S', slug: 's', areaServedCities: Array.from({ length: 26 }, (_, index) => 'City ' + index) }] }, /at most 25/);

  const full = purchases.validateImplementationInput({
    ...input,
    sameAsUrls: ['https://www.linkedin.com/company/example'],
    locations: [{
      ...input.locations[0],
      country: 'US',
      latitude: 0,
      longitude: 0,
      locationPageUrl: 'https://examplebrand.com/locations/dallas/'
    }],
    people: [{
      ...input.people[0],
      knowsAbout: ['AI search'],
      sameAsUrls: ['https://www.linkedin.com/in/example']
    }],
    services: [{
      ...input.services[0],
      areaServedCities: [
        { name: 'Dallas', wikidataUrl: 'https://www.wikidata.org/wiki/Q16557' },
        'Plano'
      ]
    }]
  }, 'single');
  assert.equal(full.ok, true, full.error);

  const emptyGeo = purchases.validateImplementationInput({
    ...input,
    locations: [{ name: 'No Geo', slug: 'no-geo', latitude: null, longitude: null }]
  }, 'single');
  assert.equal(emptyGeo.ok, true, emptyGeo.error);
});

test('the compiler omits empty geo coordinates and rejects out-of-range values', () => {
  const nodeFor = (slug, payload) => payload['@graph'].find(node => String(node['@id']).includes('/locations/' + slug + '/'));

  const noGeo = graph.buildMasterKnowledgeGraphObject({
    ...input,
    locations: [{ name: 'No Geo', slug: 'no-geo', latitude: null, longitude: null }]
  });
  assert.equal(nodeFor('no-geo', noGeo).geo, undefined, 'null coordinates must not become 0,0');

  const zero = graph.buildMasterKnowledgeGraphObject({
    ...input,
    locations: [{ name: 'Zero', slug: 'zero', latitude: 0, longitude: 0 }]
  });
  assert.deepEqual(nodeFor('zero', zero).geo, { '@type': 'GeoCoordinates', latitude: 0, longitude: 0 });

  const outOfRange = graph.buildMasterKnowledgeGraphObject({
    ...input,
    locations: [{ name: 'Out', slug: 'out', latitude: 999, longitude: 0 }]
  });
  assert.equal(nodeFor('out', outOfRange).geo, undefined, 'out-of-range coordinates must not be emitted');
});

test('enforces locations, people, and services inside validateImplementationInput', () => {
  const rows = (count, prefix) => Array.from({ length: count }, (_, index) => ({ name: prefix + ' ' + index, slug: prefix + '-' + index }));
  const at = (plan, counts) => purchases.validateImplementationInput({
    ...input,
    locations: rows(counts.locations, 'location'),
    people: rows(counts.people, 'person'),
    services: rows(counts.services, 'service')
  }, plan);

  assert.equal(at('single', { locations: 3, people: 2, services: 10 }).ok, true);
  assert.equal(at('single', { locations: 4, people: 2, services: 10 }).ok, false);
  assert.equal(at('single', { locations: 3, people: 3, services: 10 }).ok, false);
  assert.equal(at('single', { locations: 3, people: 2, services: 11 }).ok, false);

  assert.equal(at('multi', { locations: 10, people: 6, services: 10 }).ok, true);
  assert.equal(at('multi', { locations: 11, people: 6, services: 10 }).ok, false);
  assert.equal(at('multi', { locations: 10, people: 7, services: 10 }).ok, false);
  assert.equal(at('multi', { locations: 10, people: 6, services: 11 }).ok, false);
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
