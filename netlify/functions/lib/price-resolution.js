'use strict';
const {stripeID} = require('./billing-objects');
const http = (status, message) => Object.assign(new Error(message), {status});

function priceProblem(price, {plan, interval, PLANS, live}) {
 if (!price) return 'the price could not be found';
 if (!price.active) return 'the price is not active';
 if (price.currency !== 'usd') return 'the price is not in US dollars';
 const amount = interval === 'year' ? PLANS[plan].annual : PLANS[plan].monthly;
 if (price.unit_amount !== amount) return 'the price amount does not match the approved amount';
 if (price.recurring?.interval !== interval || price.recurring?.interval_count !== 1) return 'the price billing interval does not match';
 if (price.livemode !== live()) return 'the price is not in the expected payment mode';
 return null;
}

// A price is only sellable when the price itself matches the plan and the
// product behind it is still available. Archived products keep their prices,
// so the product has to be checked separately.
async function checkPrice({stripe, id, plan, interval, PLANS, live}) {
 const price = await stripe('prices/' + encodeURIComponent(id));
 const problem = priceProblem(price, {plan, interval, PLANS, live});
 if (problem) return {id: null, problem};
 const productID = stripeID(price.product);
 if (!productID) return {id: null, problem: 'the price has no product'};
 const product = await stripe('products/' + encodeURIComponent(productID));
 if (!product?.active) return {id: null, problem: 'it belongs to an archived product'};
 return {id, problem: null};
}

async function resolveSellablePrice({stripe, plan, interval, PLANS, priceID, priceLookupKey, live}) {
 const options = {plan, interval, PLANS, live};
 const configured = priceID(plan, interval);
 let problem = 'no price is configured';
 if (configured) {
  const checked = await checkPrice({stripe, id: configured, ...options});
  if (checked.id) return checked.id;
  problem = checked.problem;
 }
 const key = priceLookupKey(plan, interval);
 if (key) {
  const list = await stripe('prices?lookup_keys[]=' + encodeURIComponent(key) + '&active=true&limit=10');
  for (const candidate of (list?.data || [])) {
   const id = stripeID(candidate);
   if (!id) continue;
   const checked = await checkPrice({stripe, id, ...options});
   if (checked.id) return checked.id;
  }
  problem = problem === 'no price is configured' ? 'the current price could not be found' : problem;
 }
 const label = interval === 'year' ? 'annual' : 'monthly';
 throw http(503, `The ${label} price for the ${PLANS[plan].name} plan cannot be sold because ${problem}. No payment was taken.`);
}

module.exports = {resolveSellablePrice, priceProblem, checkPrice};
