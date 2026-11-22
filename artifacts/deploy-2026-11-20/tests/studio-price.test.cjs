'use strict';
const test = require('node:test');
const assert = require('node:assert');
const studio = require('../netlify/functions/lib/studio-price');

const STUDIO = {active: true, currency: 'usd', unit_amount: 4900, livemode: true, recurring: {interval: 'month', interval_count: 1}};

function catalog() {
 return {
  ['prices/' + studio.DEFAULT_STUDIO_PRICE]: {...STUDIO, id: studio.DEFAULT_STUDIO_PRICE, product: 'prod_archived'},
  'products/prod_archived': {id: 'prod_archived', active: false},
  ['prices?lookup_keys[]=' + studio.STUDIO_LOOKUP_KEY + '&active=true&limit=10']: {data: [{id: 'price_studio_live'}]},
  'prices/price_studio_live': {...STUDIO, id: 'price_studio_live', product: 'prod_current', lookup_key: studio.STUDIO_LOOKUP_KEY},
  'products/prod_current': {id: 'prod_current', active: true}
 };
}

const stripeFrom = prices => async path => {
 if (!(path in prices)) throw Error('Unexpected Stripe request ' + path);
 return prices[path];
};

test('the configured Studio price falls back to the lookup key when its product is archived', async () => {
 const id = await studio.resolveStudioPriceId({stripe: stripeFrom(catalog()), live: () => true});
 assert.equal(id, 'price_studio_live');
});

test('the configured Studio price is used when it is sellable', async () => {
 const prices = catalog();
 prices['products/prod_archived'] = {id: 'prod_archived', active: true};
 const id = await studio.resolveStudioPriceId({stripe: stripeFrom(prices), live: () => true});
 assert.equal(id, studio.DEFAULT_STUDIO_PRICE);
});

test('a Studio price that cannot be sold fails clearly instead of charging', async () => {
 const prices = catalog();
 prices['prices?lookup_keys[]=' + studio.STUDIO_LOOKUP_KEY + '&active=true&limit=10'] = {data: []};
 await assert.rejects(
  () => studio.resolveStudioPriceId({stripe: stripeFrom(prices), live: () => true}),
  error => error.status === 503 && /AI Visibility Schema Studio monthly subscription price cannot be sold because it belongs to an archived product\. No payment was taken\./.test(error.message)
 );
});

test('an environment override is used before the built in Studio price', () => {
 assert.equal(studio.configuredStudioPrice({STRIPE_STUDIO_MONTHLY_PRICE_ID: ' price_env '}), 'price_env');
 assert.equal(studio.configuredStudioPrice({}), studio.DEFAULT_STUDIO_PRICE);
});

test('subscriptions match on the configured id or the Studio lookup key', () => {
 assert.equal(studio.studioPriceMatches({...STUDIO, id: studio.DEFAULT_STUDIO_PRICE}, {}), true);
 assert.equal(studio.studioPriceMatches({...STUDIO, id: 'price_other', lookup_key: studio.STUDIO_LOOKUP_KEY}, {}), true);
 assert.equal(studio.studioPriceMatches({...STUDIO, id: 'price_other', lookup_key: studio.STUDIO_LOOKUP_KEY, unit_amount: 9900}, {}), false);
 assert.equal(studio.studioPriceMatches({...STUDIO, id: 'price_other'}, {}), false);
 assert.equal(studio.studioPriceMatches(null, {}), false);
});
