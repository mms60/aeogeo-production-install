'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectEntityHtml } = require('../netlify/functions/lib/entity-audit');
const graph = require('../site/assets/entity-graph-builder');

const unifiedHtml = `<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {"@type": "Organization", "@id": "https://example.com/#organization", "name": "Example", "sameAs": "https://www.linkedin.com/company/example"},
    {"@type": "LocalBusiness", "@id": "https://example.com/locations/dallas/#localbusiness", "name": "Example Dallas", "parentOrganization": {"@id": "https://example.com/#organization"}}
  ]
}
</script>
</head><body></body></html>`;

const input = {
  domain: 'https://examplebrand.com/about',
  brandName: 'Example Client Brand',
  legalName: 'Example Client Brand LLC',
  description: 'A verified example brand used to test the entity graph compiler.',
  disambiguatingDescription: 'Not the similarly named company in another state.',
  logoUrl: 'https://examplebrand.com/logo.png',
  telephone: '+1-214-555-0199',
  foundingYear: '2014',
  sameAsUrls: [
    'https://www.linkedin.com/company/example-brand',
    'https://www.wikidata.org/wiki/Q123456789',
    'not-a-url'
  ],
  locations: [
    {
      slug: 'dallas',
      name: 'Dallas Flagship',
      locationPageUrl: 'https://examplebrand.com/locations/dallas/',
      businessType: 'ProfessionalService',
      telephone: '+1-214-555-0199',
      streetAddress: '2100 Ross Ave',
      city: 'Dallas',
      state: 'TX',
      postalCode: '75201',
      country: 'US',
      latitude: 32.787,
      longitude: -96.795,
      googleMapsUrl: 'https://maps.google.com/?cid=123',
      gbpShareUrl: 'https://g.page/r/example-brand-dallas'
    },
    {
      slug: 'plano',
      name: 'Plano Office',
      locationPageUrl: '',
      telephone: '',
      streetAddress: '',
      city: '',
      state: '',
      postalCode: '',
      country: ''
    }
  ],
  people: [
    {
      slug: 'jordan-vance',
      name: 'Jordan Vance',
      jobTitle: 'Founder',
      profilePageUrl: 'https://examplebrand.com/team/jordan-vance',
      knowsAbout: ['AI search', 'entity strategy'],
      sameAsUrls: ['https://www.linkedin.com/in/jordan-vance']
    }
  ],
  services: [
    {
      slug: 'entity-booster',
      name: 'AI Search & Entity Optimization',
      serviceUrl: 'https://examplebrand.com/services/entity-booster/',
      description: 'Connects the brand to its locations, people, and verified profiles.',
      areaServedCities: [
        { name: 'Dallas', wikidataUrl: 'https://www.wikidata.org/wiki/Q16557' },
        { name: 'Plano' }
      ]
    }
  ]
};

test('builds one connected @graph with canonical IDs and cross-references', () => {
  const payload = graph.buildMasterKnowledgeGraphObject(input);
  assert.equal(payload['@context'], 'https://schema.org');
  assert.equal(payload['@graph'].length, 6);

  const organization = payload['@graph'].find(node => node['@type'] === 'Organization');
  assert.equal(organization['@id'], 'https://examplebrand.com/#organization');
  assert.equal(organization.url, 'https://examplebrand.com/');
  assert.deepEqual(organization.sameAs, [
    'https://www.linkedin.com/company/example-brand',
    'https://www.wikidata.org/wiki/Q123456789'
  ]);
  assert.deepEqual(organization.employee, [{ '@id': 'https://examplebrand.com/#person-jordan-vance' }]);
  assert.deepEqual(organization.subOrganization, [
    { '@id': 'https://examplebrand.com/locations/dallas/#localbusiness' },
    { '@id': 'https://examplebrand.com/locations/plano/#localbusiness' }
  ]);

  const dallas = payload['@graph'].find(node => node['@id'] === 'https://examplebrand.com/locations/dallas/#localbusiness');
  assert.equal(dallas['@type'], 'ProfessionalService');
  assert.deepEqual(dallas.parentOrganization, { '@id': 'https://examplebrand.com/#organization' });
  assert.equal(dallas.address.addressLocality, 'Dallas');
  assert.equal(dallas.geo.latitude, 32.787);
  assert.deepEqual(dallas.sameAs, ['https://g.page/r/example-brand-dallas']);

  const plano = payload['@graph'].find(node => node['@id'] === 'https://examplebrand.com/locations/plano/#localbusiness');
  assert.equal(plano.url, 'https://examplebrand.com/locations/plano/');
  assert.equal(plano.address, undefined);
  assert.equal(plano.telephone, undefined);

  const person = payload['@graph'].find(node => node['@type'] === 'Person');
  assert.deepEqual(person.worksFor, { '@id': 'https://examplebrand.com/#organization' });
  assert.deepEqual(person.sameAs, ['https://www.linkedin.com/in/jordan-vance']);

  const service = payload['@graph'].find(node => node['@type'] === 'Service');
  assert.deepEqual(service.provider, { '@id': 'https://examplebrand.com/#organization' });
  assert.equal(service.availableAtOrFrom.length, 2);
  assert.deepEqual(service.areaServed[0].sameAs, 'https://www.wikidata.org/wiki/Q16557');
});

test('the JSON output is stable, parseable, and normalizes the domain to its origin', () => {
  const json = graph.buildMasterKnowledgeGraph(input);
  const parsed = JSON.parse(json);
  assert.equal(parsed['@graph'][1]['@id'], 'https://examplebrand.com/#organization');
  assert.match(json, /\n  "@context": "https:\/\/schema.org"/);
});

test('incomplete or invalid input fails with a useful message', () => {
  assert.throws(() => graph.buildMasterKnowledgeGraph({ ...input, domain: 'not a url' }), /full website address/i);
  assert.throws(() => graph.buildMasterKnowledgeGraph({ ...input, brandName: ' ' }), /brand name/i);
  assert.throws(() => graph.buildMasterKnowledgeGraph({ ...input, locations: [{ ...input.locations[0], name: '' }] }), /Location 1 needs a name/i);
  assert.throws(() => graph.buildMasterKnowledgeGraph({ ...input, people: [{ ...input.people[0], name: '' }] }), /Person 1 needs a name/i);
});

test('detects a unified graph, persistent IDs, and external anchors', () => {
  const result = inspectEntityHtml(unifiedHtml);
  assert.equal(result.jsonLdBlocksFound, 1);
  assert.equal(result.malformedJsonLdBlocks, 0);
  assert.equal(result.hasUnifiedGraph, true);
  assert.equal(result.hasPersistentIds, true);
  assert.equal(result.hasSameAsAnchors, true);
  assert.equal(result.sameAsCount, 1);
  assert.deepEqual(result.sameAsHosts, ['linkedin.com']);
  assert.deepEqual(result.detectedTypes, ['LocalBusiness', 'Organization']);
  assert.deepEqual(result.coreEntityTypes, ['LocalBusiness', 'Organization']);
  assert.deepEqual(result.fragmentationIssues, []);
});

test('flags multiple disconnected blocks, missing IDs, and missing anchors', () => {
  const html = `<script type="application/ld+json">{"@type":"Organization","name":"A"}</script>
    <script type="application/ld+json">{"@type":"LocalBusiness","name":"B"}</script>`;
  const result = inspectEntityHtml(html);
  assert.equal(result.hasUnifiedGraph, false);
  assert.equal(result.hasPersistentIds, false);
  assert.equal(result.hasSameAsAnchors, false);
  assert.equal(result.fragmentationIssues.length, 3);
  assert.ok(result.fragmentationIssues.some(issue => issue.includes('2 separate identity blocks')));
  assert.ok(result.fragmentationIssues.some(issue => issue.includes('persistent entity IDs')));
  assert.ok(result.fragmentationIssues.some(issue => issue.includes('external profiles')));
});

test('flags malformed JSON-LD without hiding the rest of the page', () => {
  const html = `<script type="application/ld+json">{bad json}</script>
    <script type="application/ld+json">{"@type":"Organization","@id":"https://example.com/#organization","name":"Example","sameAs":["https://www.linkedin.com/company/example"]}</script>`;
  const result = inspectEntityHtml(html);
  assert.equal(result.jsonLdBlocksFound, 1);
  assert.equal(result.malformedJsonLdBlocks, 1);
  assert.equal(result.hasPersistentIds, true);
  assert.ok(result.fragmentationIssues.some(issue => issue.includes('could not be read')));
});

test('does not count an empty or non-HTTP sameAs value as an anchor', () => {
  const html = `<script type="application/ld+json">{"@type":"Organization","@id":"https://example.com/#organization","sameAs":["mailto:test@example.com",""]}</script>`;
  const result = inspectEntityHtml(html);
  assert.equal(result.hasSameAsAnchors, false);
  assert.equal(result.sameAsCount, 0);
});

test('extracts JSON-LD from script tags with varied attribute syntax', () => {
  const html = `
    <script type="application/ld+json">{"@type":"Organization","name":"A"}</script>
    <script TYPE='application/ld+json'>{"@type":"WebSite","name":"B"}</script>
    <script data-test="x" type=application/ld+json>{"@type":"Person","name":"C"}</script>
    <script type="text/javascript">{"@type":"NotJsonLd"}</script>
  `;
  const result = inspectEntityHtml(html);
  assert.equal(result.jsonLdBlocksFound, 3);
  assert.equal(result.malformedJsonLdBlocks, 0);
  assert.deepEqual(result.detectedTypes, ['Organization', 'Person', 'WebSite']);
});
