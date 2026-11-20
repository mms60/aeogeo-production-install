'use strict';
// Content Decay Predictor - environment and credential resolution.
//
// LIVE and TEST credentials come from separate variables and are never
// interchangeable. A live key in the test slot (or the reverse) is a hard
// failure: no checkout, scan or report is produced from a mismatched config.
//
// This module performs no I/O. It only reads process.env and validates shape.

const {requireStripeCredential} = require('./stripe-credential');

// The approved live one-time price for the Content Decay Report.
const LIVE_PRICE_FALLBACK = 'price_1UdvRBBIJX5f6Wmhm4uU56Zj';
const MAX_FREE_PAGES_CEILING = 10;

function fail(code, message) {
  return Object.assign(new Error(message + ' Reference: ' + code + '.'), {status: 503, code});
}
function text(env, name) {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : '';
}

// Test mode is opt-in per deployment and refuses to enable itself on the
// production site, even if the flag is set there by mistake.
function environment(env = process.env) {
  if (text(env, 'CONTENT_DECAY_TEST_MODE') !== 'true') return 'live';
  if (text(env, 'CONTEXT') === 'production') {
    throw fail('CONTENT_DECAY_TEST_IN_PRODUCTION',
      'Content Decay test mode is enabled on the production site.');
  }
  return 'test';
}

function credential(env = process.env) {
  const mode = environment(env);
  const name = mode === 'test' ? 'STRIPE_SECRET_KEY_TEST' : 'STRIPE_SECRET_KEY';
  const value = text(env, name);
  if (!value) {
    throw fail(
      mode === 'test' ? 'CONTENT_DECAY_TEST_KEY_MISSING' : 'CONTENT_DECAY_LIVE_KEY_MISSING',
      mode === 'test'
        ? 'Content Decay test mode is on but no Stripe test key is configured.'
        : 'Content Decay has no Stripe server key configured.'
    );
  }
  let info;
  try {
    info = requireStripeCredential({STRIPE_SECRET_KEY: value});
  } catch {
    throw fail('CONTENT_DECAY_KEY_FORMAT',
      'The Content Decay Stripe key has an unrecognized format.');
  }
  if (info.mode !== mode) {
    throw fail(
      mode === 'test' ? 'CONTENT_DECAY_KEY_WRONG_MODE' : 'CONTENT_DECAY_LIVE_KEY_IS_TEST',
      mode === 'test'
        ? 'The Content Decay test slot contains a live Stripe key.'
        : 'The Content Decay live slot contains a Stripe test key.'
    );
  }
  return {key: info.key, mode};
}

function priceId(env = process.env) {
  const mode = environment(env);
  const name = mode === 'test'
    ? 'STRIPE_CONTENT_DECAY_PRICE_ID_TEST'
    : 'STRIPE_CONTENT_DECAY_PRICE_ID';
  let value = text(env, name);
  if (!value && mode === 'live') value = LIVE_PRICE_FALLBACK;
  if (!/^price_[A-Za-z0-9_]+$/.test(value)) {
    throw fail('CONTENT_DECAY_PRICE_MISSING',
      'The Content Decay Stripe price is not configured for this environment.');
  }
  // A test checkout must never point at the live price object.
  if (mode === 'test' && value === LIVE_PRICE_FALLBACK) {
    throw fail('CONTENT_DECAY_TEST_PRICE_IS_LIVE',
      'The Content Decay test slot points at the live Stripe price.');
  }
  return value;
}

function webhookSecret(env = process.env) {
  const mode = environment(env);
  const name = mode === 'test' ? 'STRIPE_WEBHOOK_SECRET_TEST' : 'STRIPE_WEBHOOK_SECRET';
  const value = text(env, name);
  if (!/^whsec_[A-Za-z0-9_]+$/.test(value)) {
    throw fail('CONTENT_DECAY_WEBHOOK_SECRET_MISSING',
      'The Content Decay webhook signing secret is not configured for this environment.');
  }
  return value;
}

// Product cap is 10 pages. An operator can lower it, never raise it.
function freePageLimit(env = process.env) {
  const raw = text(env, 'CONTENT_DECAY_MAX_FREE_PAGES');
  if (!raw) return MAX_FREE_PAGES_CEILING;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return MAX_FREE_PAGES_CEILING;
  return Math.min(value, MAX_FREE_PAGES_CEILING);
}

// Dedicated HMAC secret for background dispatch. Never the service-role key.
function signingSecret(env = process.env) {
  const value = text(env, 'CONTENT_DECAY_SIGNING_SECRET');
  if (value.length < 32) {
    throw fail('CONTENT_DECAY_SIGNING_MISSING',
      'The Content Decay background signing secret is not configured.');
  }
  return value;
}

// AI enrichment is optional and off unless both the flag and a key exist.
function aiEnabled(env = process.env) {
  return text(env, 'CONTENT_DECAY_AI_ENABLED') === 'true'
    && !!text(env, 'GROQ_API_KEY');
}

// Safe diagnostics: modes and identifiers only, never a secret value.
function describe(env = process.env) {
  let mode = 'invalid';
  try { mode = environment(env); } catch { /* reported below */ }
  const describeCall = fn => {
    try { return fn(env); } catch (error) { return error.code || 'invalid'; }
  };
  return {
    mode,
    price: describeCall(priceId),
    credential: (() => {
      try { return credential(env).mode; } catch (error) { return error.code || 'invalid'; }
    })(),
    webhookConfigured: (() => {
      try { webhookSecret(env); return true; } catch { return false; }
    })(),
    freePageLimit: freePageLimit(env),
    aiEnabled: aiEnabled(env)
  };
}

module.exports = {
  environment,
  credential,
  priceId,
  webhookSecret,
  freePageLimit,
  signingSecret,
  aiEnabled,
  describe,
  LIVE_PRICE_FALLBACK
};
