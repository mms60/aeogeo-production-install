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
    productId: 'prod_VdNVizBmTfDoqH',
    amount: 79900
  }),
  multi: Object.freeze({
    plan: 'multi',
    label: 'Multi-Location Brand',
    priceId: 'price_1Uc6ksBIJX5f6WmhHI94dIms',
    productId: 'prod_VdNVrX9bS9IVPF',
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
// A Content Decay report bought within 30 days is credited in full against
// either setup offer. The checkout applies it as a one-off coupon and records
// the amount in the session metadata, so verification can expect the reduced
// total instead of rejecting a legitimately discounted purchase.
const REPORT_CREDIT = 4900;
const SESSION_ID = /^cs_(?:test|live)_[A-Za-z0-9_-]{8,}$/;
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_INPUT_BYTES = 200000;
const INPUT_CAPS = Object.freeze({
  sameAsUrls: 25,
  personSameAsUrls: 10,
  knowsAbout: 20,
  areaServedCities: 25
});

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

// Only the exact credit this checkout issues is accepted: the metadata value
// must be the fixed amount, so a forged or edited session cannot claim a larger
// discount than the one coupon Stripe actually applied.
function sessionReportCredit(session, offer) {
  if (!session || typeof session !== 'object' || !offer) return 0;
  if (sessionIsUpgrade(session, offer)) return 0;
  const declared = Number(session.metadata && session.metadata.report_credit);
  return declared === REPORT_CREDIT ? REPORT_CREDIT : 0;
}

function sessionIsPaid(session, offer) {
  if (!session || typeof session !== 'object' || !offer) return false;
  if (session.object !== 'checkout.session' || session.mode !== 'payment') return false;
  if (session.status !== 'complete' || session.payment_status !== 'paid') return false;
  if (session.livemode !== true) return false;
  if (String(session.currency || '').toLowerCase() !== 'usd') return false;
  const expectedAmount = sessionIsUpgrade(session, offer)
    ? UPGRADE.amount
    : offer.amount - sessionReportCredit(session, offer);
  if (Number(session.amount_total) !== expectedAmount) return false;
  const metadata = session.metadata || {};
  return metadata.product === PRODUCT && metadata.plan === offer.plan && metadata.price === offer.priceId;
}

async function recordSession(session, extra = {}) {
  const offer = offerForPlan(session?.metadata?.plan);
  if (!offer || !sessionIsPaid(session, offer)) return false;
  const row = {
    email: sessionEmail(session) || null,
    plan: offer.plan,
    stripe_session_id: session.id,
    stripe_payment_intent: idOf(session.payment_intent) || null,
    amount_total: Number(session.amount_total) || null,
    currency: 'usd',
    livemode: true,
    updated_at: new Date().toISOString()
  };
  // Never send user_id: null from the webhook. PostgREST merge-duplicates
  // updates only supplied columns, so omitting it preserves a claimed purchase.
  // status is omitted for the same reason: a replayed or out-of-order
  // checkout.session.completed must not resurrect a refunded/revoked row. New
  // rows get the table default ('paid'); only dispute.won explicitly restores it.
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
    '&status=eq.paid&livemode=eq.true&select=plan,created_at&order=created_at.desc'
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

  const boundUserId = String(session?.client_reference_id || session?.metadata?.user_id || '');
  if (boundUserId && boundUserId !== user.id) {
    throw statusError(403, 'This checkout belongs to a different account.', 'ACCOUNT_MISMATCH');
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
    items[0]?.price?.id !== offer.priceId ||
    idOf(items[0]?.price?.product) !== offer.productId ||
    items[0]?.price?.unit_amount !== offer.amount
  ) {
    throw statusError(409, 'The checkout items could not be verified.', 'CHECKOUT_ITEMS_MISMATCH');
  }

  await recordSession(session, { user_id: user.id });
  return { plan: offer.plan, limits: LIMITS[offer.plan] };
}

function invalidInput(message) {
  return statusError(400, message, 'INVALID_INPUT');
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function inputString(value, path, max, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw invalidInput(path + ' must be text.');
  const text = value.trim();
  if (required && !text) throw invalidInput(path + ' is required.');
  if (text.length > max) throw invalidInput(path + ' must be ' + max + ' characters or fewer.');
  return text;
}

function inputArray(value, path, max) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalidInput(path + ' must be a list.');
  if (value.length > max) throw invalidInput(path + ' can contain at most ' + max + ' items.');
  return value;
}

function inputUrl(value, path, required = false) {
  const raw = inputString(value, path, 2048, required);
  if (!raw) return '';
  let url;
  try { url = new URL(raw); } catch { throw invalidInput(path + ' must be a full URL starting with http:// or https://.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw invalidInput(path + ' must be a plain http:// or https:// URL without credentials.');
  }
  return url.href;
}

function inputUrls(value, path, max) {
  return inputArray(value, path, max)
    .map((item, index) => item === undefined || item === null || item === '' ? '' : inputUrl(item, path + '[' + index + ']'))
    .filter(Boolean);
}

function inputStringList(value, path, maxItems, maxLength) {
  return inputArray(value, path, maxItems)
    .map((item, index) => inputString(item, path + '[' + index + ']', maxLength))
    .filter(Boolean);
}

function inputCoordinate(value, path, min, max) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' && typeof value !== 'string') throw invalidInput(path + ' must be a number.');
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isFinite(number) || number < min || number > max) {
    throw invalidInput(path + ' must be a number between ' + min + ' and ' + max + '.');
  }
  return number;
}

function validateLocation(location, index) {
  const path = 'locations[' + index + ']';
  if (!plainObject(location)) throw invalidInput(path + ' must be an object.');
  inputString(location.name, path + '.name', 200, true);
  inputString(location.slug, path + '.slug', 120);
  inputString(location.businessType, path + '.businessType', 80);
  inputUrl(location.locationPageUrl, path + '.locationPageUrl');
  inputString(location.telephone, path + '.telephone', 80);
  inputString(location.streetAddress, path + '.streetAddress', 240);
  inputString(location.city, path + '.city', 120);
  inputString(location.state, path + '.state', 120);
  inputString(location.postalCode, path + '.postalCode', 40);
  inputString(location.country, path + '.country', 80);
  const latitude = inputCoordinate(location.latitude, path + '.latitude', -90, 90);
  const longitude = inputCoordinate(location.longitude, path + '.longitude', -180, 180);
  if ((latitude === null) !== (longitude === null)) {
    throw invalidInput(path + ' must include both latitude and longitude, or neither.');
  }
  inputUrl(location.googleMapsUrl, path + '.googleMapsUrl');
  inputUrl(location.gbpShareUrl, path + '.gbpShareUrl');
}

function validatePerson(person, index) {
  const path = 'people[' + index + ']';
  if (!plainObject(person)) throw invalidInput(path + ' must be an object.');
  inputString(person.name, path + '.name', 200, true);
  inputString(person.slug, path + '.slug', 120);
  inputString(person.jobTitle, path + '.jobTitle', 160);
  inputUrl(person.profilePageUrl, path + '.profilePageUrl');
  inputStringList(person.knowsAbout, path + '.knowsAbout', INPUT_CAPS.knowsAbout, 120);
  inputUrls(person.sameAsUrls, path + '.sameAsUrls', INPUT_CAPS.personSameAsUrls);
}

function validateService(service, index) {
  const path = 'services[' + index + ']';
  if (!plainObject(service)) throw invalidInput(path + ' must be an object.');
  inputString(service.name, path + '.name', 200, true);
  inputString(service.slug, path + '.slug', 120);
  inputUrl(service.serviceUrl, path + '.serviceUrl');
  inputString(service.description, path + '.description', 1200);
  const cities = inputArray(service.areaServedCities, path + '.areaServedCities', INPUT_CAPS.areaServedCities);
  cities.forEach((city, cityIndex) => {
    const cityPath = path + '.areaServedCities[' + cityIndex + ']';
    if (typeof city === 'string') {
      inputString(city, cityPath, 120, true);
      return;
    }
    if (!plainObject(city)) throw invalidInput(cityPath + ' must be a city name or an object.');
    inputString(city.name, cityPath + '.name', 120, true);
    inputUrl(city.wikidataUrl, cityPath + '.wikidataUrl');
  });
}

function validateInputFields(input) {
  inputUrl(input.domain, 'domain', true);
  inputString(input.brandName, 'brandName', 200, true);
  inputString(input.description, 'description', 2000, true);
  inputString(input.legalName, 'legalName', 200);
  inputString(input.disambiguatingDescription, 'disambiguatingDescription', 600);
  inputString(input.telephone, 'telephone', 80);
  inputUrl(input.logoUrl, 'logoUrl');
  const foundingYear = inputString(input.foundingYear, 'foundingYear', 20);
  if (foundingYear && !/^\d{4}(?:-\d{2}-\d{2})?$/.test(foundingYear)) {
    throw invalidInput('foundingYear must be a four-digit year such as 2014, or a date such as 2014-05-01.');
  }
  inputUrls(input.sameAsUrls, 'sameAsUrls', INPUT_CAPS.sameAsUrls);
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
  let locations, people, services;
  try {
    locations = inputArray(input.locations, 'locations', Number.MAX_SAFE_INTEGER);
    people = inputArray(input.people, 'people', Number.MAX_SAFE_INTEGER);
    services = inputArray(input.services, 'services', Number.MAX_SAFE_INTEGER);
  } catch (error) {
    return { ok: false, status: 400, error: error.message, code: 'INVALID_INPUT' };
  }
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
  try {
    validateInputFields(input);
    locations.forEach(validateLocation);
    people.forEach(validatePerson);
    services.forEach(validateService);
  } catch (error) {
    if (error.code === 'INVALID_INPUT') {
      return { ok: false, status: 400, error: error.message, code: 'INVALID_INPUT' };
    }
    throw error;
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
  REPORT_CREDIT,
  sessionIsUpgrade,
  sessionReportCredit,
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
