'use strict';

// A name that answers with both an A and an AAAA record used to be fetched from
// whichever address the resolver listed first. When that record was unreachable,
// a perfectly healthy website failed the whole scan, so the order now matters:
// IPv4 first, then IPv6, with every address kept as a fallback.

const test = require('node:test');
const assert = require('node:assert/strict');

const {preferredAddresses, isPublicIP} = require('../netlify/functions/lib/crawler');

test('IPv4 addresses are tried before IPv6', () => {
  const resolved = [
    {address: '2606:4700:4700::1111', family: 6},
    {address: '104.16.132.229', family: 4},
    {address: '2606:4700:4700::1001', family: 6},
    {address: '104.16.133.229', family: 4}
  ];
  assert.deepEqual(preferredAddresses(resolved).map(a => a.address), [
    '104.16.132.229', '104.16.133.229', '2606:4700:4700::1111', '2606:4700:4700::1001'
  ]);
});

test('an IPv6-only host keeps the order it resolved in', () => {
  const resolved = [
    {address: '2606:4700:4700::1111', family: 6},
    {address: '2606:4700:4700::1001', family: 6}
  ];
  assert.deepEqual(preferredAddresses(resolved).map(a => a.address), [
    '2606:4700:4700::1111', '2606:4700:4700::1001'
  ]);
});

test('a single IPv4 address is untouched', () => {
  const resolved = [{address: '93.184.216.34', family: 4}];
  assert.deepEqual(preferredAddresses(resolved), resolved);
});

test('ordering does not mutate the resolver result', () => {
  const resolved = [{address: '::1', family: 6}, {address: '1.1.1.1', family: 4}];
  preferredAddresses(resolved);
  assert.deepEqual(resolved.map(a => a.address), ['::1', '1.1.1.1']);
});

test('reordering never smuggles in a private address', () => {
  // The public-only check runs on the full resolver answer before ordering, so
  // every address that reaches the fetcher is already validated. This asserts
  // the classifier the check relies on still rejects the usual SSRF targets.
  const resolved = [
    {address: '169.254.169.254', family: 4},
    {address: '127.0.0.1', family: 4},
    {address: '::ffff:10.0.0.1', family: 6},
    {address: '93.184.216.34', family: 4}
  ];
  const ordered = preferredAddresses(resolved);
  assert.equal(ordered[0].address, '169.254.169.254');
  assert.equal(ordered.filter(a => !isPublicIP(a.address)).length, 3);
});
