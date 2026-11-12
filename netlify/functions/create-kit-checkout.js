'use strict';
// Creates a Stripe Checkout session for the Directory Listing Kit ($47 one-time).
// Stripe credentials come from your existing netlify/functions/lib/stripe helper.
const { stripe, origin } = require('./lib/stripe');

const PRICE_ID = 'price_1UayqxBIJX5f6WmhOyuMvPCR';
const PRODUCT = 'directory-listing-kit';

exports.handler = async event => {
  const method = (event.httpMethod || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    return { statusCode: 405, headers: { Allow: 'GET, POST' }, body: 'Method not allowed.' };
  }
  try {
    const base = origin(); // PUBLIC_SITE_URL or URL, already validated https by your helper
    const successUrl = `${base}/directory-listing-kit/thanks/?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${base}/directory-listing-kit/`;
    const session = await stripe('checkout/sessions', {
      method: 'POST',
      data: {
        mode: 'payment',
        'line_items[0][price]': PRICE_ID,
        'line_items[0][quantity]': '1',
        success_url: successUrl,
        cancel_url: cancelUrl,
        'metadata[product]': PRODUCT,
        'metadata[price]': PRICE_ID
      }
    });
    if (!session || !session.url) {
      throw Object.assign(new Error('Checkout could not be created. Reference: CHECKOUT_SESSION_MISSING.'), { status: 503, code: 'CHECKOUT_SESSION_MISSING' });
    }
    return { statusCode: 303, headers: { Location: session.url, 'Cache-Control': 'no-store' }, body: '' };
  } catch (error) {
    const status = error && error.status === 503 ? 503 : 500;
    const message = (error && error.message) ? String(error.message).slice(0, 300) : 'Payment is unavailable right now. Please try again. Reference: CHECKOUT_UNAVAILABLE.';
    console.error('create-kit-checkout failed', status, error && error.code ? error.code : 'unknown');
    return { statusCode: status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, body: message };
  }
};