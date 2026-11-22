'use strict';
const {resolveExpectedPrice} = require('./price-resolution');
// The Studio subscription price is identified by a lookup key so a stale
// environment variable cannot point checkout at an archived product.
const STUDIO_LOOKUP_KEY = 'aeogeo-studio-month';
const STUDIO_AMOUNT = 4900;
const STUDIO_INTERVAL = 'month';
const DEFAULT_STUDIO_PRICE = 'price_1Uah2rBIJX5f6WmhZs6Uq5iG';

function configuredStudioPrice(env = process.env) {
 return String(env.STRIPE_STUDIO_MONTHLY_PRICE_ID || DEFAULT_STUDIO_PRICE).trim();
}

// Returns a reason the price cannot be sold, or null when it can.
function studioPriceProblem(price, {live} = {}) {
 if (!price) return 'the price could not be found';
 if (price.active !== true) return 'the price is not active';
 if (price.currency !== 'usd') return 'the price is not in US dollars';
 if (price.unit_amount !== STUDIO_AMOUNT) return 'the price amount does not match the approved amount';
 if (price.recurring?.interval !== STUDIO_INTERVAL || price.recurring?.interval_count !== 1) return 'the price billing interval does not match';
 if (typeof live === 'boolean' && price.livemode !== live) return 'the price is not in the expected payment mode';
 return null;
}

// A subscription belongs to the Studio when it uses the configured price or a
// price carrying the Studio lookup key, which is what resolution falls back to.
function studioPriceMatches(price, env = process.env) {
 if (!price) return false;
 if (typeof price === 'string') return price === configuredStudioPrice(env);
 if (price.id && price.id === configuredStudioPrice(env)) return true;
 return price.lookup_key === STUDIO_LOOKUP_KEY && studioPriceProblem(price) === null;
}

// Resolves the Studio price the same way the GEO plans resolve theirs: the
// configured price if it is sellable, then the Studio lookup key, then a 503.
async function resolveStudioPriceId({stripe, live, configured = configuredStudioPrice()}) {
 return resolveExpectedPrice({
  stripe,
  configured,
  lookupKey: STUDIO_LOOKUP_KEY,
  amount: STUDIO_AMOUNT,
  interval: STUDIO_INTERVAL,
  live,
  description: 'AI Visibility Schema Studio monthly subscription price'
 });
}

module.exports = {
 STUDIO_LOOKUP_KEY,
 STUDIO_AMOUNT,
 STUDIO_INTERVAL,
 DEFAULT_STUDIO_PRICE,
 configuredStudioPrice,
 studioPriceProblem,
 studioPriceMatches,
 resolveStudioPriceId
};
