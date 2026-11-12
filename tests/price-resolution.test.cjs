'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {resolveSellablePrice} = require('../netlify/functions/lib/price-resolution');
const plans = require('../netlify/functions/lib/plans');
const {PLANS} = plans;

const CURRENT_MONTH = 'price_current_month';
const CURRENT_YEAR = 'price_current_year';
const RETIRED_YEAR = 'price_retired_year';     // inactive price on an archived product
const ARCHIVED_YEAR = 'price_archived_year';   // active price on an archived product

function catalog() {
 return {
  ['prices/' + CURRENT_MONTH]: {id: CURRENT_MONTH, product: 'prod_current', active: true, currency: 'usd', unit_amount: 4900, livemode: true, recurring: {interval: 'month', interval_count: 1}},
  ['prices/' + CURRENT_YEAR]: {id: CURRENT_YEAR, product: 'prod_current', active: true, currency: 'usd', unit_amount: 47040, livemode: true, recurring: {interval: 'year', interval_count: 1}},
  ['prices/' + RETIRED_YEAR]: {id: RETIRED_YEAR, product: 'prod_archived', active: false, currency: 'usd', unit_amount: 47040, livemode: true, recurring: {interval: 'year', interval_count: 1}},
  ['prices/' + ARCHIVED_YEAR]: {id: ARCHIVED_YEAR, product: 'prod_archived', active: true, currency: 'usd', unit_amount: 47040, livemode: true, recurring: {interval: 'year', interval_count: 1}},
  ['prices?lookup_keys[]=aeogeo-starter-month&active=true&limit=10']: {data: [{id: CURRENT_MONTH}]},
  ['prices?lookup_keys[]=aeogeo-starter-year&active=true&limit=10']: {data: [{id: CURRENT_YEAR}]},
  'products/prod_current': {id: 'prod_current', active: true},
  'products/prod_archived': {id: 'prod_archived', active: false},
 };
}

function resolve(overrides = {}) {
 const prices = catalog();
 const stripe = async path => {
  if (!(path in prices)) throw Error('Unexpected Stripe request ' + path);
  return prices[path];
 };
 return resolveSellablePrice({stripe, plan: 'starter', interval: 'year', PLANS, priceID: () => RETIRED_YEAR, priceLookupKey: plans.priceLookupKey, live: () => true, ...overrides});
}

test('a configured price on the current product is sold as configured', async () => {
 const id = await resolve({interval: 'month', priceID: () => CURRENT_MONTH});
 assert.equal(id, CURRENT_MONTH);
});

test('an inactive configured annual price resolves to the current product price', async () => {
 assert.equal(await resolve(), CURRENT_YEAR);
});

test('a configured price on an archived product resolves to the current product price', async () => {
 assert.equal(await resolve({priceID: () => ARCHIVED_YEAR}), CURRENT_YEAR);
});

test('a price that does not match the approved amount is never sold', async () => {
 const prices = catalog();
 prices['prices/' + CURRENT_MONTH] = {...prices['prices/' + CURRENT_MONTH], unit_amount: 47040};
 const stripe = async path => prices[path];
 await assert.rejects(
  () => resolveSellablePrice({stripe, plan: 'starter', interval: 'month', PLANS, priceID: () => CURRENT_MONTH, priceLookupKey: plans.priceLookupKey, live: () => true}),
  error => error.status === 503
 );
});

test('an archived product with no current price fails clearly instead of selling', async () => {
 const prices = catalog();
 prices['prices?lookup_keys[]=aeogeo-starter-year&active=true&limit=10'] = {data: []};
 const stripe = async path => prices[path];
 await assert.rejects(
  () => resolveSellablePrice({stripe, plan: 'starter', interval: 'year', PLANS, priceID: () => ARCHIVED_YEAR, priceLookupKey: plans.priceLookupKey, live: () => true}),
  error => error.status === 503 && /annual price for the Starter plan cannot be sold because it belongs to an archived product/.test(error.message)
 );
});

test('lookup keys map a resolved price back to its plan for billing sync', () => {
 assert.deepEqual(plans.fromLookupKey('aeogeo-agency-year'), {plan: 'agency', interval: 'year'});
 assert.deepEqual(plans.fromLookupKey('aeogeo-professional-month'), {plan: 'professional', interval: 'month'});
 assert.equal(plans.fromLookupKey('unknown-key'), null);
 assert.equal(plans.fromLookupKey(undefined), null);
 assert.equal(plans.priceLookupKey('agency', 'year'), 'aeogeo-agency-year');
});
