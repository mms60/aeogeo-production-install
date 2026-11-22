'use strict';
const {stripeID} = require('./billing-objects');
const http = (status, message) => Object.assign(new Error(message), {status});

// The rules a price has to satisfy to be sold, for any product.
function expectedPriceProblem(price, {amount, interval, live}) {
 if (!price) return 'the price could not be found';
 if (!price.active) return 'the price is not active';
 if (price.currency !== 'usd') return 'the price is not in US dollars';
 if (price.unit_amount !== amount) return 'the price amount does not match the approved amount';
 if (price.recurring?.interval !== interval || price.recurring?.interval_count !== 1) return 'the price billing interval does not match';
 if (price.livemode !== live()) return 'the price is not in the expected payment mode';
 return null;
}

function priceProblem(price, {plan, interval, PLANS, live}) {
 const amount = interval === 'year' ? PLANS[plan].annual : PLANS[plan].monthly;
 return expectedPriceProblem(price, {amount, interval, live});
}

// A price is only sellable when the price itself matches what was approved and
// the product behind it is still available. Archived products keep their
// prices, so the product has to be checked separately.
async function checkExpectedPrice({stripe, id, amount, interval, live}) {
 const price = await stripe('prices/' + encodeURIComponent(id));
 const problem = expectedPriceProblem(price, {amount, interval, live});
 if (problem) return {id: null, problem};
 const productID = stripeID(price.product);
 if (!productID) return {id: null, problem: 'the price has no product'};
 const product = await stripe('products/' + encodeURIComponent(productID));
 if (!product?.active) return {id: null, problem: 'it belongs to an archived product'};
 return {id, problem: null};
}

async function checkPrice({stripe, id, plan, interval, PLANS, live}) {
 const amount = interval === 'year' ? PLANS[plan].annual : PLANS[plan].monthly;
 return checkExpectedPrice({stripe, id, amount, interval, live});
}

// Configured price first, then the lookup key on an active product, then a
// clear refusal so checkout never charges an archived price.
async function resolveExpectedPrice({stripe, configured, lookupKey, amount, interval, live, description}) {
 let problem = 'no price is configured';
 if (configured) {
  const checked = await checkExpectedPrice({stripe, id: configured, amount, interval, live});
  if (checked.id) return checked.id;
  problem = checked.problem;
 }
 if (lookupKey) {
  const list = await stripe('prices?lookup_keys[]=' + encodeURIComponent(lookupKey) + '&active=true&limit=10');
  for (const candidate of (list?.data || [])) {
   const id = stripeID(candidate);
   if (!id) continue;
   const checked = await checkExpectedPrice({stripe, id, amount, interval, live});
   if (checked.id) return checked.id;
  }
  if (problem === 'no price is configured') problem = 'the current price could not be found';
 }
 throw http(503, `The ${description} cannot be sold because ${problem}. No payment was taken.`);
}

async function resolveSellablePrice({stripe, plan, interval, PLANS, priceID, priceLookupKey, live}) {
 const label = interval === 'year' ? 'annual' : 'monthly';
 return resolveExpectedPrice({
  stripe,
  configured: priceID(plan, interval),
  lookupKey: priceLookupKey(plan, interval),
  amount: interval === 'year' ? PLANS[plan].annual : PLANS[plan].monthly,
  interval,
  live,
  description: `${label} price for the ${PLANS[plan].name} plan`
 });
}

module.exports = {resolveSellablePrice, priceProblem, checkPrice, expectedPriceProblem, checkExpectedPrice, resolveExpectedPrice};
