'use strict';
// One-time AI Entity & Citation Authority Setup purchases.
// Stripe Checkout is still created by entity-authority-checkout.js. This module
// records the verified session, links it to a signed-in account, and answers
// entitlement questions. It never exposes the graph compiler to the browser.
const { stripe } = require('./stripe');
const { db } = require('./db');

const PRODUCT = 'entity-authority';
const OFFERS = Object.freeze({
  single: Object.freeze({
    plan: 'single',
    label: 'Single-Hub Brand',
    priceId: 'price_1Uc6kWBIJX5f6WmhvQeqzs7o',
    amount: 79900
  }),
  multi: Object.freeze({
    plan: 'multi',
    label: 'Multi-Location Brand',
    priceId: 'price_1Uc6ksBIJX5f6WmhHI94dIms',
    amount: 119900
  })
});
const LIMITS = Object.freeze({
  single: Object.freeze({ locations: 3, people: 2, services: 10 }),
  multi: Object.freeze({ locations: 10, people: 6, services: 10 })
});
const UPGRADE = Object.freeze({
  from: 'single',
  to: 'multi',
  amount: 40000,
  credit: 79900
});
const SESSION_ID = /^cs_(?:test|live)_[A-Za-z0-9_-]{8,}$/;
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_INPUT_BYTES = 200000;

function statusError(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

function offerForPlan(plan) {
  return typeof plan === 'string' && Object.prototype.hasOwnProperty.call(OFFERS, plan) ? OFFERS[plan] : null;
}

function limitsForPlan(plan) {
  return LIMITS[plan] || null;
}

function idOf(value) {
  if (typeof value === 'string') return value;
  return value && typeof value === 'object' && typeof value.id === 'string' ? value.id : '';
}

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

// A checkout can be paid and recorded in Stripe while a webhook is delayed, or
// an older purchase can be stored without a user_id. Once the buyer signs in,
// match only unclaimed live purchases by the email they have confirmed on their
// account. This is the durable fallback to the checkout's metadata user_id.
async function claimUnclaimedByEmail(user) {
  if (!user || !USER_ID.test(String(user.id || '')) || !user.email_confirmed_at) return 0;
  const email = normalizedEmail(user.email);
  if (!validEmail(email)) return 0;
  const rows = await db(
    'entity_purchases?email=eq.' + encodeURIComponent(email) +
    '&status=eq.paid&livemode=eq.true&user_id=is.null&select=id',
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: { user_id: user.id, updated_at: new Date().toISOString() }
    }
  );
  return Array.isArray(rows) ? rows.length : 0;
}

function sessionEmail(session) {
  return normalizedEmail(session?.customer_details?.email || session?.customer_email || '');
}

function sessionIsUpgrade(session, offer) {
  if (!session || typeof session !== 'object' || !offer) return false;
  const metadata = session.metadata || {};
  return (
    offer.plan === UPGRADE.to &&
    metadata.product === PRODUCT &&
    metadata.plan === UPGRADE.to &&
    metadata.upgrade === '1' &&
    metadata.previous_plan === UPGRADE.from
  );
}

function sessionIsPaid(session, offer) {
  if (!session || typeof session !== 'object' || !offer) return false;
  if (session.object !== 'checkout.session' || session.mode !== 'payment') return false;
  if (session.status !== 'complete' || session.payment_status !== 'paid') return false;
  if (session.livemode !== true) return false;
  if (String(session.currency || '').toLowerCase() !== 'usd') return false;
  const expectedAmount = sessionIsUpgrade(session, offer) ? UPGRADE.amount : offer.amount;
  if (Number(session.amount_total) !== expectedAmount) return false;
  const metadata = session.metadata || {};
  return metadata.product === PRODUCT && metadata.plan === offer.plan;
}

async function recordSession(session, extra = {}) {
  const offer = offerForPlan(session?.metadata?.plan);
  if (!offer || !sessionIsPaid(session, offer)) return false;
  const row = {
    email: sessionEmail(session) || null,
    plan: offer.plan,
    status: 'paid',
    stripe_session_id: session.id,
    stripe_payment_intent: idOf(session.payment_intent) || null,
    amount_total: Number(session.amount_total) || null,
    currency: 'usd',
    livemode: true,
    updated_at: new Date().toISOString()
  };
  // Never send user_id: null from the webhook. PostgREST merge-duplicates
  // updates only supplied columns, so omitting it preserves a claimed purchase.
  const metadataUserId = session?.metadata?.user_id;
  const userId = extra.user_id || (USER_ID.test(String(metadataUserId || '')) ? metadataUserId : null);
  if (userId) row.user_id = userId;
  await db('entity_purchases?on_conflict=stripe_session_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: [row]
  });
  return true;
}

async function entitlementForUser(userId, user) {
  if (typeof userId !== 'string' || !userId) return null;
  const read = () => db(
    'entity_purchases?user_id=eq.' + encodeURIComponent(userId) +
    '&status=eq.paid&select=plan,created_at&order=created_at.desc'
  );
  let rows = await read();
  if ((!Array.isArray(rows) || !rows.length) && user) {
    try {
      await claimUnclaimedByEmail(user);
      rows = await read();
    } catch {
      // An account with an existing linked purchase must not be locked out by a
      // failure in the optional email fallback.
    }
  }
  if (!Array.isArray(rows) || !rows.length) return null;
  const plans = new Set(rows.map(row => row.plan));
  const plan = plans.has('multi') ? 'multi' : 'single';
  return { plan, limits: LIMITS[plan], purchases: rows.length };
}

async function claimPurchase(user, sessionId) {
  if (!user || typeof user.id !== 'string' || !user.id) {
    throw statusError(401, 'Sign in to claim this purchase.', 'SIGN_IN_REQUIRED');
  }
  if (!user.email_confirmed_at) {
    throw statusError(403, 'Confirm your email address before claiming a purchase.', 'EMAIL_CONFIRMATION_REQUIRED');
  }
  if (!SESSION_ID.test(String(sessionId || ''))) {
    throw statusError(400, 'A valid Stripe checkout session is required.', 'CHECKOUT_SESSION_INVALID');
  }

  const session = await stripe('checkout/sessions/' + encodeURIComponent(sessionId));
  const offer = offerForPlan(session?.metadata?.plan);
  if (!offer || !sessionIsPaid(session, offer)) {
    throw statusError(403, 'That checkout could not be verified for this implementation.', 'CHECKOUT_NOT_VERIFIED');
  }

  const email = sessionEmail(session);
  const userEmail = normalizedEmail(user.email);
  if (!validEmail(email) || !userEmail || email !== userEmail) {
    throw statusError(403, 'Sign in with the email address used at Stripe to claim this purchase.', 'EMAIL_MISMATCH');
  }

  const existing = await db(
    'entity_purchases?stripe_session_id=eq.' + encodeURIComponent(sessionId) +
    '&select=user_id,status'
  );
  const row = Array.isArray(existing) ? existing[0] : null;
  if (row?.user_id && row.user_id !== user.id) {
    throw statusError(409, 'This purchase is already linked to another account. Contact us if that is not right.', 'PURCHASE_TAKEN');
  }
  if (row?.status === 'revoked') {
    throw statusError(403, 'This purchase is no longer active.', 'PURCHASE_REVOKED');
  }

  const lineItems = await stripe(
    'checkout/sessions/' + encodeURIComponent(sessionId) + '/line_items?limit=2'
  );
  const items = Array.isArray(lineItems?.data) ? lineItems.data : [];
  if (
    lineItems?.has_more ||
    items.length !== 1 ||
    items[0]?.quantity !== 1 ||
    items[0]?.price?.id !== offer.priceId
  ) {
    throw statusError(409, 'The checkout items could not be verified.', 'CHECKOUT_ITEMS_MISMATCH');
  }

  await recordSession(session, { user_id: user.id });
  return { plan: offer.plan, limits: LIMITS[offer.plan] };
}

function validateImplementationInput(input, plan) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, status: 400, error: 'Enter the brand details before generating the implementation.' };
  }
  const limits = LIMITS[plan];
  if (!limits) {
    return { ok: false, status: 403, error: 'No active paid implementation was found for this account.', code: 'PURCHASE_REQUIRED' };
  }
  let size = 0;
  try { size = Buffer.byteLength(JSON.stringify(input), 'utf8'); } catch { size = MAX_INPUT_BYTES + 1; }
  if (size > MAX_INPUT_BYTES) {
    return { ok: false, status: 413, error: 'The submitted details are too large. Shorten the descriptions and try again.' };
  }
  const locations = Array.isArray(input.locations) ? input.locations : [];
  const people = Array.isArray(input.people) ? input.people : [];
  const services = Array.isArray(input.services) ? input.services : [];
  if (locations.length > limits.locations) {
    return {
      ok: false,
      status: 403,
      error: `The ${OFFERS[plan].label} plan covers up to ${limits.locations} locations. Remove the extra locations or contact us to upgrade.`,
      code: 'PLAN_LOCATION_LIMIT'
    };
  }
  if (people.length > limits.people) {
    return {
      ok: false,
      status: 403,
      error: `The ${OFFERS[plan].label} plan covers up to ${limits.people} people. Remove the extra people or contact us to upgrade.`,
      code: 'PLAN_PEOPLE_LIMIT'
    };
  }
  if (services.length > limits.services) {
    return {
      ok: false,
      status: 403,
      error: `The ${OFFERS[plan].label} plan covers up to ${limits.services} services. Remove the extra services or contact us.`,
      code: 'PLAN_SERVICE_LIMIT'
    };
  }
  return { ok: true };
}

function validateGraph(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return ['The output is not a JSON object.'];
  }
  const issues = [];
  if (payload['@context'] !== 'https://schema.org') issues.push('The @context value is missing or incorrect.');
  const graph = Array.isArray(payload['@graph']) ? payload['@graph'] : [];
  if (!graph.length) issues.push('The graph does not contain any entities.');

  const ids = new Set();
  for (const node of graph) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      issues.push('Every graph entry must be an object.');
      continue;
    }
    if (!node['@type']) issues.push('An entity is missing its @type.');
    if (typeof node['@id'] !== 'string' || !node['@id']) {
      issues.push('An entity is missing its @id.');
    } else if (ids.has(node['@id'])) {
      issues.push('Duplicate @id: ' + node['@id']);
    } else {
      ids.add(node['@id']);
    }
  }
  if (!graph.some(node => node && node['@type'] === 'Organization')) {
    issues.push('The graph does not include an Organization entity.');
  }

  const refKeys = ['parentOrganization', 'worksFor', 'provider', 'publisher', 'employee', 'subOrganization', 'availableAtOrFrom'];
  const checkReference = value => {
    if (Array.isArray(value)) {
      value.forEach(checkReference);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (typeof value['@id'] === 'string' && Object.keys(value).length === 1 && !ids.has(value['@id'])) {
      issues.push('A relationship points to a missing entity: ' + value['@id']);
    }
  };
  for (const node of graph) {
    if (!node || typeof node !== 'object') continue;
    for (const key of refKeys) {
      if (node[key]) checkReference(node[key]);
    }
  }
  return [...new Set(issues)];
}

function implementationInstructions(plan) {
  const label = OFFERS[plan]?.label || 'paid';
  return [
    `Keep this JSON-LD with the ${label} implementation record so the identifiers stay consistent.`,
    'Add the graph to the head of the main brand page, or load it from the same document template on every page.',
    'Use the same @id values on location, service, and team pages. Do not publish a second Organization identifier.',
    'Publish the location, person, and service pages at the URLs used in the graph. Keep names, addresses, phone numbers, and profile links consistent with the visible page content.',
    'Validate the final markup with a Schema.org validator and confirm every fact matches the business.',
    'Record the pages changed and the validation result. Recheck the graph when the business changes a location, service, or leader.'
  ];
}

async function revokeByPaymentIntent(paymentIntent) {
  if (!paymentIntent) return false;
  const rows = await db(
    'entity_purchases?stripe_payment_intent=eq.' + encodeURIComponent(paymentIntent) +
    '&status=eq.paid&select=id',
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: { status: 'revoked', updated_at: new Date().toISOString() }
    }
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function restoreByPaymentIntent(paymentIntent) {
  if (!paymentIntent) return false;
  const rows = await db(
    'entity_purchases?stripe_payment_intent=eq.' + encodeURIComponent(paymentIntent) +
    '&status=eq.revoked&select=id',
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: { status: 'paid', updated_at: new Date().toISOString() }
    }
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function handleWebhook(event) {
  if (!event || typeof event.type !== 'string') return false;
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data?.object;
    if (session?.metadata?.product !== PRODUCT) return false;
    return recordSession(session);
  }
  if (event.type === 'charge.refunded') {
    const charge = event.data?.object || {};
    if (charge.refunded !== true) return false;
    return revokeByPaymentIntent(idOf(charge.payment_intent));
  }
  if (event.type === 'charge.dispute.created') {
    const dispute = event.data?.object || {};
    return revokeByPaymentIntent(idOf(dispute.payment_intent));
  }
  if (event.type === 'charge.dispute.closed') {
    const dispute = event.data?.object || {};
    if (dispute.status !== 'won') return false;
    return restoreByPaymentIntent(idOf(dispute.payment_intent));
  }
  return false;
}

module.exports = {
  PRODUCT,
  OFFERS,
  LIMITS,
  UPGRADE,
  sessionIsUpgrade,
  offerForPlan,
  limitsForPlan,
  sessionIsPaid,
  sessionEmail,
  validEmail,
  claimUnclaimedByEmail,
  claimPurchase,
  entitlementForUser,
  validateImplementationInput,
  validateGraph,
  implementationInstructions,
  handleWebhook,
  recordSession
};
