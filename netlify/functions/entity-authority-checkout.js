'use strict';
// Creates Stripe Checkout sessions for the two one-time AI Entity & Citation
// Authority Setup offers. The live prices in the connected Stripe account were
// verified on 2026-11-15:
//   Single-Hub Brand: $799, one-time, USD
//   Multi-Location Brand: $1,199, one-time, USD
// Each request re-reads the selected live price first. Checkout is refused if
// the product, amount, mode, currency, or billing type no longer matches, so a
// retired or replaced price cannot silently sell the wrong offer.
const { stripe, origin } = require('./lib/stripe');

const PRODUCT = 'entity-authority';
const OFFERS = Object.freeze({
  single: Object.freeze({
    label: 'Single-Hub Brand',
    priceId: 'price_1Uc6kWBIJX5f6WmhvQeqzs7o',
    productId: 'prod_VdNVizBmTfDoqH',
    amount: 79900
  }),
  multi: Object.freeze({
    label: 'Multi-Location Brand',
    priceId: 'price_1Uc6ksBIJX5f6WmhHI94dIms',
    productId: 'prod_VdNVrX9bS9IVPF',
    amount: 119900
  })
});

function text(status, message) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    body: message
  };
}

function requestedPlan(event) {
  const query = event && event.queryStringParameters ? event.queryStringParameters.plan : '';
  if (query) return String(query).trim().toLowerCase();
  if (!event || event.httpMethod !== 'POST' || !event.body) return '';

  const raw = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8').toString('utf8');
  const headers = event.headers || {};
  const contentType = String(headers['content-type'] || headers['Content-Type'] || '');
  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(raw);
      return String(parsed && parsed.plan || '').trim().toLowerCase();
    } catch {
      return '';
    }
  }
  return String(new URLSearchParams(raw).get('plan') || '').trim().toLowerCase();
}

function productId(price) {
  return typeof price.product === 'string' ? price.product : price.product && price.product.id;
}

function validLivePrice(price, offer) {
  return Boolean(
    price &&
    price.id === offer.priceId &&
    productId(price) === offer.productId &&
    price.active === true &&
    price.livemode === true &&
    price.type === 'one_time' &&
    price.currency === 'usd' &&
    price.unit_amount === offer.amount &&
    price.billing_scheme === 'per_unit' &&
    !price.recurring &&
    !price.custom_unit_amount &&
    !price.transform_quantity
  );
}

exports.handler = async event => {
  const method = String(event && event.httpMethod || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    return { statusCode: 405, headers: { Allow: 'GET, POST', 'Cache-Control': 'no-store' }, body: 'Method not allowed.' };
  }

  try {
    const plan = requestedPlan(event);
    const offer = Object.hasOwn(OFFERS, plan) ? OFFERS[plan] : null;
    if (!offer) return text(400, 'Choose the Single-Hub ($799) or Multi-Location ($1,199) plan.');

    const price = await stripe(`prices/${encodeURIComponent(offer.priceId)}`);
    if (!validLivePrice(price, offer)) {
      console.error('entity-authority-checkout price verification failed', plan);
      return text(503, 'Secure checkout is unavailable because the live price could not be verified. Use the intake form at https://aeogeosearch.com/ai-visibility-schema-studio#get-started or email aeogeosearch@atomicmail.io.');
    }

    const base = origin();
    const session = await stripe('checkout/sessions', {
      method: 'POST',
      data: {
        mode: 'payment',
        'line_items[0][price]': offer.priceId,
        'line_items[0][quantity]': '1',
        success_url: `${base}/ai-visibility-schema-studio?checkout=success&session_id={CHECKOUT_SESSION_ID}#get-started`,
        cancel_url: `${base}/ai-visibility-schema-studio?checkout=cancelled#get-started`,
        'metadata[plan]': plan,
        'metadata[product]': PRODUCT,
        'metadata[price]': offer.priceId,
        'metadata[amount]': String(offer.amount),
        'payment_intent_data[metadata][plan]': plan,
        'payment_intent_data[metadata][product]': PRODUCT,
        'payment_intent_data[metadata][price]': offer.priceId,
        'payment_intent_data[metadata][amount]': String(offer.amount),
        allow_promotion_codes: false
      }
    });

    if (!session || !session.url) {
      throw Object.assign(new Error('Checkout could not be created.'), { status: 503, code: 'CHECKOUT_SESSION_MISSING' });
    }
    if (session.mode !== 'payment' || session.livemode !== true || session.currency !== 'usd' || session.amount_total !== offer.amount) {
      throw Object.assign(new Error('Checkout response did not match the live offer.'), { status: 503, code: 'CHECKOUT_SESSION_MISMATCH' });
    }

    let target;
    try {
      target = new URL(session.url);
      if (target.protocol !== 'https:' || target.hostname !== 'checkout.stripe.com' || target.port) throw new Error('Invalid checkout host.');
    } catch {
      throw Object.assign(new Error('Checkout address could not be verified.'), { status: 503, code: 'CHECKOUT_URL_INVALID' });
    }

    return {
      statusCode: 303,
      headers: { Location: target.href, 'Cache-Control': 'no-store' },
      body: ''
    };
  } catch (error) {
    const status = error && error.status === 503 ? 503 : 500;
    const code = error && error.code ? String(error.code).slice(0, 80) : 'CHECKOUT_UNAVAILABLE';
    console.error('entity-authority-checkout failed', status, code);
    return text(status, `Secure checkout is unavailable right now. Use the intake form at https://aeogeosearch.com/ai-visibility-schema-studio#get-started or email aeogeosearch@atomicmail.io. Reference: ${code}.`);
  }
};

exports.OFFERS = OFFERS;
exports.validLivePrice = validLivePrice;
