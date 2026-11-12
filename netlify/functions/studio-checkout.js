'use strict';
// Public Studio subscribe link. The payment link it replaces pinned one price
// id, so a retired price or archived product broke the button; this resolves
// the sellable Studio price on every request instead.
const { stripe, origin } = require('./lib/stripe');
const { resolveStudioPriceId } = require('./lib/studio-price');

const live = () => String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live');

exports.handler = async event => {
  const method = (event.httpMethod || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    return { statusCode: 405, headers: { Allow: 'GET, POST' }, body: 'Method not allowed.' };
  }
  try {
    const base = origin();
    const price = await resolveStudioPriceId({ stripe, live });
    const session = await stripe('checkout/sessions', {
      method: 'POST',
      data: {
        mode: 'subscription',
        'line_items[0][price]': price,
        'line_items[0][quantity]': '1',
        success_url: `${base}/ai-visibility-schema-studio/app/?checkout=success`,
        cancel_url: `${base}/ai-visibility-schema-studio/app/?checkout=cancelled`,
        'metadata[plan]': 'studio_monthly',
        'metadata[product]': 'ai-visibility-schema-studio',
        'subscription_data[metadata][plan]': 'studio_monthly',
        'subscription_data[metadata][product]': 'ai-visibility-schema-studio'
      }
    });
    if (!session || !session.url) {
      throw Object.assign(new Error('Checkout could not be created. Reference: CHECKOUT_SESSION_MISSING.'), { status: 503, code: 'CHECKOUT_SESSION_MISSING' });
    }
    return { statusCode: 303, headers: { Location: session.url, 'Cache-Control': 'no-store' }, body: '' };
  } catch (error) {
    const status = error && error.status === 503 ? 503 : 500;
    const message = (error && error.message) ? String(error.message).slice(0, 300) : 'Payment is unavailable right now. Please try again. Reference: CHECKOUT_UNAVAILABLE.';
    console.error('studio-checkout failed', status, error && error.code ? error.code : 'unknown');
    return { statusCode: status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, body: message };
  }
};
