'use strict';
// Content Decay Predictor - purchases and entitlements (Phase 5).
//
// Rules this module enforces:
//   - Create checkout only from a signed-in, confirmed account, for a completed
//     scan that belongs to that account. A scan started anonymously is claimed
//     by the buyer at checkout, so the free scan never has to be re-run.
//   - Never trust a return URL or a frontend "success" flag. Access is granted
//     only after the session is re-retrieved from Stripe server-side.
//   - Re-check livemode, mode, status, payment_status, amount_total, currency,
//     price id, quantity and metadata before recording a purchase.
//   - Claim the webhook event through content_decay_claim_webhook() before
//     granting, so duplicate deliveries and concurrent instances cannot grant
//     twice. If confirmation fails, the claim is released so Stripe's retry can
//     process the same event again.
//   - Grant through content_decay_grant_entitlement(), which is idempotent.
//   - A refund or an opened dispute ends the purchase and its entitlement, so
//     neither can leave the paid report open.
//   - Read paid content only through content_decay_access(), scoped to the
//     authenticated user's own id. Never a client-supplied user id.
//
// Every function accepts injected `client` and `database` dependencies, so the
// whole flow is testable without live Stripe credentials or a live database.

const config = require('./content-decay-config');
const {db, UUID} = require('./db');

const PRODUCT = 'content_decay';
const REPORT_AMOUNT = 4999; // $49.00 in cents
const REPORT_CURRENCY = 'usd';
const CHECKOUT_SESSION = /^cs_[A-Za-z0-9_]+$/;
const PRICE = /^price_[A-Za-z0-9_]+$/;
const EVENT = /^evt_[A-Za-z0-9_]{8,}$/;
const CHARGE = /^ch_[A-Za-z0-9_]+$/;
const DISPUTE = /^dp_[A-Za-z0-9_]+$/;
const PAYMENT_INTENT = /^pi_[A-Za-z0-9_]+$/;
// A credit is the $49 report bought before any scan exists. Stripe metadata
// carries this kind instead of a scan id; the credit is spent later, on the
// first site the buyer scans.
const CREDIT_KIND = 'credit';

function fail(status, code, message) {
  return Object.assign(new Error(message + ' Reference: ' + code + '.'), {status, code});
}

function requireId(value, name) {
  if (!UUID.test(String(value || ''))) {
    throw fail(400, 'CONTENT_DECAY_INVALID_REQUEST', 'A valid ' + name + ' is required.');
  }
  return String(value);
}

function siteOrigin() {
  const raw = process.env.PUBLIC_SITE_URL || process.env.URL || '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    return url.origin;
  } catch {
    throw fail(503, 'CONTENT_DECAY_SITE_URL', 'The public site URL is not configured.');
  }
}

// Default Stripe transport. Uses the product's own mode-aware credential, not
// the shared STRIPE_SECRET_KEY used by other products.
async function stripeRequest(path, {method = 'GET', data, idempotency} = {}) {
  const {key} = config.credential();
  const form = new URLSearchParams();
  for (const [name, value] of Object.entries(data || {})) {
    if (value !== undefined && value !== null) form.set(name, String(value));
  }
  let response;
  try {
    response = await fetch('https://api.stripe.com/v1/' + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + key,
        'Stripe-Version': '2025-02-24.acacia',
        ...(method === 'POST' ? {'Content-Type': 'application/x-www-form-urlencoded'} : {}),
        ...(idempotency ? {'Idempotency-Key': idempotency} : {})
      },
      body: method === 'POST' ? form.toString() : undefined,
      signal: AbortSignal.timeout(20000)
    });
  } catch {
    throw fail(503, 'CONTENT_DECAY_STRIPE_NETWORK', 'Stripe could not be reached.');
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw fail(503, 'CONTENT_DECAY_STRIPE_RESPONSE', 'Stripe returned an unreadable response.');
  }
  if (!response.ok) {
    console.error('Content decay Stripe request failed', response.status, path.split('?')[0]);
    throw fail(503, 'CONTENT_DECAY_STRIPE_REQUEST', 'Stripe could not complete this operation.');
  }
  return body;
}

function stripeClient({request = stripeRequest} = {}) {
  return {
    retrievePrice: priceId => request('prices/' + encodeURIComponent(priceId)),
    retrieveSession: sessionId => request(
      'checkout/sessions/' + encodeURIComponent(sessionId) + '?expand[]=line_items'
    ),
    // `idempotency` collapses a retried call onto the session Stripe already
    // created, so a retry can never produce a second payable link.
    createCheckoutSession: (data, {idempotency} = {}) => request(
      'checkout/sessions', {method: 'POST', data, idempotency}
    ),
    // Ends a checkout that was never paid, so its link can no longer charge.
    expireSession: sessionId => request(
      'checkout/sessions/' + encodeURIComponent(sessionId) + '/expire', {method: 'POST'}
    )
  };
}

async function pricePreflight({priceId, mode = config.environment(), client = stripeClient()} = {}) {
  if (!PRICE.test(String(priceId || ''))) {
    throw fail(503, 'CONTENT_DECAY_PRICE_MISSING',
      'The Content Decay Stripe price is not configured for this environment.');
  }
  // Reading the price is the one Stripe call the other products avoid by
  // hardcoding their ids, so a key without price read access fails here and
  // nowhere else. That is worth naming instead of reporting a generic failure.
  let price;
  try {
    price = await client.retrievePrice(priceId);
  } catch (error) {
    // A missing or wrong-shaped key keeps its own message; anything else is a
    // Stripe permission or transport failure on this read.
    if (/KEY/.test(String(error?.code || ''))) throw error;
    throw fail(503, 'CONTENT_DECAY_PRICE_UNAVAILABLE',
      'The report price (' + priceId
      + ') could not be read from Stripe. Check that the Stripe server key may read prices.');
  }
  const valid = price
    && price.id === priceId
    && price.active === true
    && price.type === 'one_time'
    && price.currency === REPORT_CURRENCY
    && price.unit_amount === REPORT_AMOUNT
    && price.livemode === (mode === 'live');
  if (!valid) {
    // The price id is named so a wrong STRIPE_CONTENT_DECAY_PRICE_ID value is
    // identifiable from the message instead of only from Stripe's dashboard.
    throw fail(503, 'CONTENT_DECAY_PRICE_MISMATCH',
      'The configured report price (' + priceId
      + ') is not an active one-time USD 49 price in this environment.');
  }
  return {
    id: price.id,
    amount: price.unit_amount,
    currency: price.currency,
    livemode: price.livemode
  };
}

// The price this deployment must sell. A configured price that is inert —
// archived, or an older object such as the $19.99 one left in Netlify — would
// otherwise refuse every purchase, so the approved $49 price is used and the
// response says so. In test mode the approved live price cannot pass the
// preflight, so a stale test price still fails loudly instead of charging live.
const APPROVED_PRICE = config.LIVE_PRICE_FALLBACK;

async function resolveReportPrice({priceId, mode, client}) {
  try {
    await pricePreflight({priceId, mode, client});
    return {priceId, fallback: false};
  } catch (error) {
    // A price that is archived cannot be read back either (Stripe answers 404),
    // so both the mismatch and the unreadable cases are recoverable. If the key
    // itself is at fault the retry below fails the same way and nothing is sold.
    const recoverable = error?.code === 'CONTENT_DECAY_PRICE_MISMATCH'
      || error?.code === 'CONTENT_DECAY_PRICE_UNAVAILABLE';
    if (!recoverable || priceId === APPROVED_PRICE) throw error;
    await pricePreflight({priceId: APPROVED_PRICE, mode, client});
    console.warn('Content decay used the approved price instead of the configured', priceId);
    return {priceId: APPROVED_PRICE, fallback: true, configuredPriceId: priceId};
  }
}

function withPriceNotice(result, resolved) {
  if (!resolved.fallback) return result;
  return {
    ...result,
    priceNotice: 'The configured report price (' + resolved.configuredPriceId
      + ') is not the approved $49 live price, so ' + resolved.priceId + ' was used.',
    configuredPriceId: resolved.configuredPriceId
  };
}

async function loadScan(database, scanId) {
  const rows = await database(
    'content_decay_scans?id=eq.' + encodeURIComponent(scanId)
    + '&select=id,user_id,status,environment,test_run_id,hostname,target_url'
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function entitlementFor({userId, scanId, environment = config.environment(), database = db} = {}) {
  requireId(userId, 'account');
  requireId(scanId, 'scan');
  const rows = await database(
    'content_decay_entitlements?user_id=eq.' + encodeURIComponent(userId)
    + '&scan_id=eq.' + encodeURIComponent(scanId)
    + '&status=eq.active&environment=eq.' + encodeURIComponent(environment)
    + '&select=id,purchase_id,environment,expires_at'
  );
  const list = Array.isArray(rows) ? rows : [];
  return list.find(row => !row.expires_at || new Date(row.expires_at) > new Date()) || null;
}

async function createCheckout({
  scanId,
  user,
  client = stripeClient(),
  database = db,
  mode = config.environment(),
  priceId = config.priceId(),
  origin = siteOrigin()
} = {}) {
  if (!user || !user.id) {
    throw fail(401, 'CONTENT_DECAY_SIGN_IN_REQUIRED', 'Please sign in before buying the report.');
  }
  requireId(scanId, 'scan');
  requireId(user.id, 'account');

  const scan = await loadScan(database, scanId);
  if (!scan) {
    throw fail(404, 'CONTENT_DECAY_SCAN_NOT_FOUND', 'That scan was not found.');
  }
  if (scan.user_id && scan.user_id !== user.id) {
    throw fail(403, 'CONTENT_DECAY_SCAN_NOT_OWNED',
      'This scan is not linked to your account. Run a new scan while signed in.');
  }
  if (scan.status !== 'completed') {
    throw fail(409, 'CONTENT_DECAY_SCAN_NOT_READY', 'This scan has not finished yet.');
  }
  if (scan.environment !== mode) {
    throw fail(409, 'CONTENT_DECAY_MODE_MISMATCH', 'This scan belongs to a different payment environment.');
  }

  // An anonymous scan becomes this buyer's scan at checkout. The filtered PATCH
  // means two accounts racing for the same scan cannot both win; the loser is
  // refused before Stripe is ever called.
  if (!scan.user_id) {
    const claimed = await database(
      'content_decay_scans?id=eq.' + encodeURIComponent(scanId) + '&user_id=is.null',
      {method: 'PATCH', body: {user_id: user.id}, headers: {Prefer: 'return=representation'}}
    );
    const row = Array.isArray(claimed) ? claimed[0] : claimed;
    if (!row || row.user_id !== user.id) {
      const latest = await loadScan(database, scanId);
      if (!latest || latest.user_id !== user.id) {
        throw fail(403, 'CONTENT_DECAY_SCAN_NOT_OWNED',
          'This scan is already linked to another account. Run a new scan while signed in.');
      }
    }
  }

  const existing = await entitlementFor({userId: user.id, scanId, environment: mode, database});
  if (existing) {
    return {alreadyPurchased: true, entitlementId: existing.id, scanId};
  }

  // A buyer who paid before scanning already holds one $49 report credit.
  // Spending that credit is this checkout: creating a payment here would charge
  // twice for the same report, which is exactly what the credit exists to
  // prevent. An unpaid checkout is resumed for the same reason.
  const held = await liveCreditFor({user, database, mode});
  if (held && held.status === 'open') {
    const spent = await claimCredit({scanId, user, database, mode});
    if (!spent || !spent.claimed) {
      throw fail(409, 'CONTENT_DECAY_CREDIT_NOT_APPLIED',
        'Your $49 report credit could not be applied to this scan, so no new payment was started. Reload this page and try again.');
    }
    return {alreadyPurchased: true, claimed: true, scanId, entitlementId: spent.entitlementId};
  }
  if (held && held.status === 'pending') {
    if (held.checkout_url) {
      return {available: false, pending: true, creditId: held.id, checkoutUrl: held.checkout_url, scanId};
    }
    throw fail(409, 'CONTENT_DECAY_CREDIT_PENDING',
      'A payment for this report is already open on this account. Reload this page in a moment to continue it.');
  }

  const resolved = await resolveReportPrice({priceId, mode, client});

  const params = {
    mode: 'payment',
    success_url: origin + '/content-decay/?purchased=1&scan=' + encodeURIComponent(scanId)
      + '&session_id={CHECKOUT_SESSION_ID}',
    cancel_url: origin + '/content-decay/?checkout=cancelled',
    client_reference_id: user.id,
    'line_items[0][price]': resolved.priceId,
    'line_items[0][quantity]': 1,
    'metadata[product]': PRODUCT,
    'metadata[scan_id]': scanId,
    'metadata[user_id]': user.id,
    'metadata[environment]': mode,
    'payment_intent_data[metadata][product]': PRODUCT,
    'payment_intent_data[metadata][scan_id]': scanId,
    'payment_intent_data[metadata][user_id]': user.id
  };
  if (user.email) params.customer_email = user.email;

  // Two submits for the same scan within one minute are the same intent, so
  // they must resolve to one session. The key is bucketed by minute rather than
  // fixed to the scan: Stripe keeps a key's response for 24 hours, and a buyer
  // who abandoned one checkout must still be able to start a fresh one.
  const session = await client.createCheckoutSession(params, {
    idempotency: 'content-decay-report-' + scanId + '-' + Math.floor(Date.now() / 60000)
  });
  if (!session || !CHECKOUT_SESSION.test(String(session.id || '')) || !session.url) {
    throw fail(503, 'CONTENT_DECAY_STRIPE_RESPONSE', 'Stripe did not return a usable checkout session.');
  }
  return withPriceNotice({sessionId: session.id, url: session.url, scanId}, resolved);
}

// What the page needs to know before offering the report: the buyer's unspent
// credit, or a checkout they already started and did not finish. The database
// allows one of those at a time, and reporting both is what stops the page from
// inviting a second payment for the same report.
async function openCreditFor({user, database = db, mode = config.environment(), client = stripeClient()} = {}) {
  if (!user || !user.id) {
    throw fail(401, 'CONTENT_DECAY_SIGN_IN_REQUIRED', 'Please sign in to use your report credit.');
  }
  requireId(user.id, 'account');

  const rows = await database(
    'content_decay_report_credits?user_id=eq.' + encodeURIComponent(user.id)
    + '&environment=eq.' + encodeURIComponent(mode)
    + '&' + CREDIT_LIVE_STATES
    + '&select=id,status,amount_total,currency,created_at,checkout_url,stripe_session_id'
    + '&order=created_at.asc'
  );
  const found = Array.isArray(rows) ? rows : [];

  // A claim records the purchase and grants access first, then closes the
  // credit. If that close was lost, the purchase proves the credit is spent: it
  // must never be offered again, and it is closed here when the write succeeds.
  const credit = (await Promise.all(found
    .filter(row => row.status === 'open')
    .map(async row => ((await alreadySpentCredit({credit: row, database})) ? null : row))))
    .find(Boolean) || null;
  if (credit) {
    return {
      available: true,
      pending: false,
      creditId: credit.id,
      amountTotal: credit.amount_total,
      currency: credit.currency,
      createdAt: credit.created_at || null
    };
  }

  const pending = found.find(row => row.status === 'pending') || null;
  if (pending) {
    const state = checkoutState(pending);
    // A continue link is only offered while Stripe can still take the payment
    // through it. Once the session has lapsed the reservation is ended here, so
    // the page starts a fresh checkout instead of opening a dead page.
    if (state === 'dead') {
      try {
        await endAbandonedCredit({credit: pending, client, database});
      } catch { /* an unreleasable row still must not hand out a dead link */ }
    } else {
      return {
        available: false,
        pending: true,
        creditId: pending.id,
        // Null while the checkout is still being created: there is nothing to
        // continue yet, and the page must not invent a link.
        checkoutUrl: state === 'payable' ? pending.checkout_url : null,
        createdAt: pending.created_at || null,
        // How long the link stays usable, measured from now, so a tab left open
        // cannot offer a session that has since expired.
        checkoutExpiresInSeconds: Math.max(0, Math.ceil((checkoutDeadline(pending) - Date.now()) / 1000))
      };
    }
  }

  return {available: false, pending: false};
}

// The two states that own a buyer's one report: an unpaid reservation and a
// paid credit that has not been spent yet. The database allows one of them per
// buyer and environment, which is what makes the guarantee hold under a race.
const CREDIT_LIVE_STATES = 'status=in.(pending,open)';
// A credit checkout's Stripe session can take money for this long. The
// reservation row is written just before the session is created, so this window
// never ends later than Stripe's own expiry.
const CREDIT_SESSION_MINUTES = 60;
// A link is only offered while its session can still be paid. Ending the offer
// two minutes early keeps clock skew — and the row being written a moment before
// Stripe's session exists — from ever pointing a buyer at a lapsed session.
const CREDIT_RESUMABLE_MS = (CREDIT_SESSION_MINUTES - 2) * 60 * 1000;
// A reservation with no session id has no payable link, so it only blocks a new
// attempt while that checkout is genuinely being created.
const CREDIT_SESSIONLESS_GRACE_MS = 60 * 1000;

// When the checkout behind a reservation can no longer be paid. A row without a
// creation time cannot be proven payable, so it is treated as finished.
function checkoutDeadline(credit) {
  const created = Date.parse(credit && credit.created_at ? credit.created_at : 0);
  return Number.isFinite(created) ? created + CREDIT_RESUMABLE_MS : 0;
}

// 'payable'   the page may offer "continue this checkout".
// 'preparing' the session is still being written; there is nothing to offer yet.
// 'dead'      the session has lapsed or never existed; it must be replaced.
function checkoutState(credit, now = Date.now()) {
  if (!credit) return 'dead';
  if (credit.checkout_url) return checkoutDeadline(credit) > now ? 'payable' : 'dead';
  const created = Date.parse(credit.created_at || 0);
  if (!Number.isFinite(created)) return 'dead';
  if (credit.stripe_session_id || now - created < CREDIT_SESSIONLESS_GRACE_MS) return 'preparing';
  return 'dead';
}

// Closes the credit against the purchase that spent it. The filtered update is
// read back because a lost write would leave the credit open and keep telling
// the buyer a report is waiting. Retried once, then reported to the caller; a
// failure here can never sell the same payment twice, because the purchase
// already exists for that Stripe session.
async function closeCreditOnPurchase({credit, purchase, scanId, database}) {
  const body = {
    status: 'claimed',
    claimed_scan_id: scanId,
    purchase_id: purchase.id,
    claimed_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const updated = await database(
        'content_decay_report_credits?id=eq.' + encodeURIComponent(credit.id) + '&status=eq.open',
        {method: 'PATCH', headers: {Prefer: 'return=representation'}, body}
      );
      const row = Array.isArray(updated) ? updated[0] : updated;
      if (row && row.status === 'claimed') return true;
    } catch { /* retried once; the credit simply stays open for repair */ }
  }
  return false;
}

// True when a purchase already exists for the credit's session, which means the
// credit was spent even if closing it failed. A lookup failure counts as "not
// spent", so a read error can never hide a report the buyer paid for.
async function alreadySpentCredit({credit, database}) {
  if (!credit.stripe_session_id) return false;
  let purchase = null;
  try {
    const rows = await database(
      'content_decay_purchases?stripe_session_id=eq.'
      + encodeURIComponent(credit.stripe_session_id)
      + '&select=id,status,user_id,scan_id'
    );
    purchase = Array.isArray(rows) ? rows[0] || null : null;
  } catch {
    return false;
  }
  if (!purchase || purchase.status !== 'paid') return false;
  await closeCreditOnPurchase({credit, purchase, scanId: purchase.scan_id, database});
  return true;
}

async function liveCreditFor({user, database, mode}) {
  const rows = await database(
    'content_decay_report_credits?user_id=eq.' + encodeURIComponent(user.id)
    + '&environment=eq.' + encodeURIComponent(mode)
    + '&' + CREDIT_LIVE_STATES
    + '&select=id,status,amount_total,currency,created_at,checkout_url,stripe_session_id'
    + '&order=created_at.asc&limit=1'
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

// Answers with the credit this buyer already holds instead of opening a second
// payment. Returns null only when a stale reservation was just released, which
// lets the caller reserve again.
async function reuseCredit({credit, client, database}) {
  if (credit.status === 'open') {
    return {
      alreadyCredited: true,
      creditId: credit.id,
      amountTotal: credit.amount_total,
      currency: credit.currency,
      createdAt: credit.created_at || null
    };
  }

  const state = checkoutState(credit);
  if (state === 'payable') {
    // A stored link means a real payment is waiting to be finished: hand it back
    // only while Stripe can still take the money through it.
    return {
      alreadyCredited: true,
      pending: true,
      creditId: credit.id,
      checkoutUrl: credit.checkout_url
    };
  }
  if (state === 'preparing') {
    // No link yet. Its url is still being stored, or the attempt just failed;
    // only a short grace keeps it blocking, because nothing can be paid through
    // a reservation without a session.
    return {alreadyCredited: true, pending: true, creditId: credit.id, checkoutUrl: null};
  }

  // Abandoned or lapsed: end the session so its link can never charge, then let
  // the caller replace the reservation.
  await endAbandonedCredit({credit, client, database});
  return null;
}

// Ends a reservation whose checkout can no longer be paid, so the buyer's one
// report is free for a fresh attempt. A session that already completed belongs
// to the webhook, so that row is left alone and answered by a re-read.
async function endAbandonedCredit({credit, client, database}) {
  if (credit.stripe_session_id && typeof client.expireSession === 'function') {
    try {
      await client.expireSession(credit.stripe_session_id);
    } catch {
      // The session is already complete; the webhook owns this row now.
      return false;
    }
  }
  await database(
    'content_decay_report_credits?id=eq.' + encodeURIComponent(credit.id) + '&status=eq.pending',
    {method: 'PATCH', body: {status: 'expired', updated_at: new Date().toISOString()}}
  );
  return true;
}

// A reservation that never became a checkout must not hold the buyer's one
// report, or a Stripe hiccup would block them for an hour.
async function releaseReservation({credit, database}) {
  await database(
    'content_decay_report_credits?id=eq.' + encodeURIComponent(credit.id) + '&status=eq.pending',
    {method: 'PATCH', body: {status: 'expired', updated_at: new Date().toISOString()}}
  ).catch(() => {});
}

async function startCreditCheckout({credit, user, client, database, mode, priceId, origin}) {
  try {
    return await openCheckout({credit, user, client, database, mode, priceId, origin});
  } catch (error) {
    // Anything that stops the checkout — a misconfigured price, a Stripe outage,
    // a session that could not be stored — must give the reservation back, or
    // the buyer is locked out of their one report until it goes stale.
    await releaseReservation({credit, database});
    throw error;
  }
}

async function openCheckout({credit, user, client, database, mode, priceId, origin}) {
  const resolved = await resolveReportPrice({priceId, mode, client});

  const params = {
    mode: 'payment',
    expires_at: Math.floor(Date.now() / 1000) + CREDIT_SESSION_MINUTES * 60,
    success_url: origin + '/content-decay/?credit=1&session_id={CHECKOUT_SESSION_ID}',
    cancel_url: origin + '/content-decay/?checkout=cancelled',
    client_reference_id: user.id,
    'line_items[0][price]': resolved.priceId,
    'line_items[0][quantity]': 1,
    'metadata[product]': PRODUCT,
    'metadata[kind]': CREDIT_KIND,
    'metadata[credit_id]': credit.id,
    'metadata[user_id]': user.id,
    'metadata[environment]': mode,
    'payment_intent_data[metadata][product]': PRODUCT,
    'payment_intent_data[metadata][kind]': CREDIT_KIND,
    'payment_intent_data[metadata][user_id]': user.id
  };
  if (user.email) params.customer_email = user.email;

  // The reservation is the payment's natural idempotency key: one row can back
  // only one session, so a retried call returns the session Stripe already
  // created instead of opening a second payable link.
  const session = await client.createCheckoutSession(params, {
    idempotency: 'content-decay-credit-' + credit.id
  });
  if (!session || !CHECKOUT_SESSION.test(String(session.id || '')) || !session.url) {
    throw fail(503, 'CONTENT_DECAY_STRIPE_RESPONSE', 'Stripe did not return a usable checkout session.');
  }

  // The reservation is filtered on its status, so a row that a refund, an
  // expiry or another attempt changed in the meantime is left untouched. The
  // updated row is read back because a link is only safe to hand out if this
  // session really is the one stored against a still-pending credit.
  const updated = await database(
    'content_decay_report_credits?id=eq.' + encodeURIComponent(credit.id) + '&status=eq.pending',
    {
      method: 'PATCH',
      headers: {Prefer: 'return=representation'},
      body: {
        stripe_session_id: session.id,
        checkout_url: session.url,
        amount_total: Number.isSafeInteger(session.amount_total) ? session.amount_total : REPORT_AMOUNT,
        currency: typeof session.currency === 'string' ? session.currency : REPORT_CURRENCY,
        livemode: typeof session.livemode === 'boolean' ? session.livemode : mode === 'live',
        updated_at: new Date().toISOString()
      }
    }
  );
  const stored = Array.isArray(updated) ? updated[0] || null : updated || null;
  if (!stored || stored.id !== credit.id || stored.status !== 'pending'
      || stored.stripe_session_id !== session.id) {
    // This link would take money for a credit that no longer exists, so it is
    // ended here rather than being returned to the buyer.
    await expireCheckout({session, client});
    throw fail(409, 'CONTENT_DECAY_CREDIT_RESERVATION_LOST',
      'That checkout could not be tied to your report credit, so it was cancelled. No payment was taken.');
  }

  return withPriceNotice({sessionId: session.id, url: session.url, credit: true}, resolved);
}

// Ends a checkout that must never be paid. A failed expire is not retried here:
// the session was created with its own expiry, so it lapses on its own.
async function expireCheckout({session, client}) {
  if (!session || !session.id || typeof client.expireSession !== 'function') return false;
  try {
    await client.expireSession(session.id);
    return true;
  } catch {
    return false;
  }
}

// Creates the checkout for a $49 report credit, with no scan required. The
// session carries the buyer and the environment, never a scan id.
//
// The credit row is reserved before Stripe is called. Two tabs can both read
// "no credit" at the same moment, but only one can insert that reservation: the
// partial unique index refuses the other, which then answers with the winner's
// credit. A buyer therefore cannot reach Stripe twice for one report.
async function createCreditCheckout({
  user,
  client = stripeClient(),
  database = db,
  mode = config.environment(),
  priceId = config.priceId(),
  origin = siteOrigin()
} = {}) {
  if (!user || !user.id) {
    throw fail(401, 'CONTENT_DECAY_SIGN_IN_REQUIRED', 'Please sign in before buying the report.');
  }
  requireId(user.id, 'account');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const held = await liveCreditFor({user, database, mode});
    if (held) {
      const answer = await reuseCredit({credit: held, client, database});
      if (answer) return answer;
      continue;
    }

    let credit;
    try {
      const inserted = await database('content_decay_report_credits', {
        method: 'POST',
        headers: {Prefer: 'return=representation'},
        body: {
          user_id: user.id,
          email: user.email || null,
          status: 'pending',
          currency: REPORT_CURRENCY,
          livemode: mode === 'live',
          environment: mode,
          stripe_price_id: priceId,
          test_run_id: null
        }
      });
      credit = Array.isArray(inserted) ? inserted[0] : inserted;
    } catch (error) {
      // Lost the race to the unique index. Answer with the credit that won.
      const winner = await liveCreditFor({user, database, mode});
      if (!winner) throw error;
      const answer = await reuseCredit({credit: winner, client, database});
      if (answer) return answer;
      continue;
    }

    if (!credit || !credit.id) {
      throw fail(503, 'CONTENT_DECAY_CREDIT_RESERVE',
        'The report credit could not be reserved. No payment was taken.');
    }
    return await startCreditCheckout({credit, user, client, database, mode, priceId, origin});
  }

  throw fail(409, 'CONTENT_DECAY_CREDIT_PENDING',
    'A payment for this report is already open on this account. Reload this page in a moment to continue it.');
}

function sessionProblems(session, {priceId, expectedUserId, kind = 'report'}) {
  const problems = [];
  const metadata = session?.metadata || {};
  if (metadata.product !== PRODUCT) problems.push('product');
  if (!UUID.test(String(metadata.user_id || ''))) problems.push('user');
  if (expectedUserId && metadata.user_id !== expectedUserId) problems.push('user-mismatch');
  // A credit has no scan yet, so it must carry the credit kind instead of a
  // scan id. A report session must still carry a valid scan id.
  if (kind === CREDIT_KIND) {
    if (metadata.kind !== CREDIT_KIND) problems.push('kind');
  } else if (!UUID.test(String(metadata.scan_id || ''))) {
    problems.push('scan');
  }
  if (session?.mode !== 'payment') problems.push('mode');
  if (session?.status !== 'complete') problems.push('status');
  if (session?.payment_status !== 'paid') problems.push('payment_status');
  if (session?.amount_total !== REPORT_AMOUNT) problems.push('amount');
  if (session?.currency !== REPORT_CURRENCY) problems.push('currency');
  if (typeof session?.livemode !== 'boolean') problems.push('livemode');
  const item = session?.line_items?.data?.[0];
  if (!item || item.quantity !== 1) problems.push('quantity');
  // A checkout may have been created at the approved price because the
  // configured one was inert, so both are valid payments for this product.
  if (!item || (item.price?.id !== priceId && item.price?.id !== APPROVED_PRICE)) problems.push('price');
  return problems;
}

async function confirmSession({
  sessionId,
  expectedUserId,
  client = stripeClient(),
  database = db,
  priceId = config.priceId()
} = {}) {
  if (!CHECKOUT_SESSION.test(String(sessionId || ''))) {
    throw fail(400, 'CONTENT_DECAY_INVALID_REQUEST', 'A valid checkout session is required.');
  }

  const session = await client.retrieveSession(sessionId);
  const problems = sessionProblems(session, {priceId, expectedUserId});
  if (problems.length) {
    throw fail(409, 'CONTENT_DECAY_NOT_PAID',
      'That checkout is not a completed Content Decay report payment.');
  }

  const mode = session.livemode ? 'live' : 'test';
  const metadata = session.metadata;
  const scan = await loadScan(database, metadata.scan_id);
  if (!scan) {
    throw fail(404, 'CONTENT_DECAY_SCAN_NOT_FOUND', 'That scan was not found.');
  }
  if (scan.user_id !== metadata.user_id || scan.environment !== mode) {
    throw fail(403, 'CONTENT_DECAY_SCAN_NOT_OWNED',
      'That payment does not belong to this scan and account.');
  }

  const select = 'content_decay_purchases?stripe_session_id=eq.'
    + encodeURIComponent(sessionId) + '&select=id,status,user_id,scan_id';
  let purchase = null;
  const existing = await database(select);
  if (Array.isArray(existing) && existing[0]) {
    purchase = existing[0];
    if (purchase.user_id !== metadata.user_id || purchase.scan_id !== metadata.scan_id) {
      throw fail(409, 'CONTENT_DECAY_PURCHASE_MISMATCH',
        'That checkout was already recorded against another account.');
    }
    // A refund already ended this purchase. Never re-grant it, and do not fail
    // the webhook either: a late checkout event would otherwise retry forever.
    if (purchase.status !== 'paid') {
      return {
        paid: false,
        refunded: purchase.status === 'refunded',
        revoked: purchase.status === 'revoked',
        scanId: metadata.scan_id,
        purchaseId: purchase.id,
        environment: mode
      };
    }
  } else {
    const body = {
      user_id: metadata.user_id,
      scan_id: metadata.scan_id,
      email: session.customer_details?.email || session.customer_email || null,
      status: 'paid',
      stripe_session_id: sessionId,
      stripe_payment_intent: session.payment_intent || null,
      stripe_price_id: priceId,
      amount_total: session.amount_total,
      currency: session.currency,
      livemode: session.livemode,
      environment: mode,
      test_run_id: mode === 'test' ? scan.test_run_id : null
    };
    try {
      const inserted = await database('content_decay_purchases', {
        method: 'POST',
        body,
        headers: {Prefer: 'return=representation'}
      });
      purchase = Array.isArray(inserted) ? inserted[0] : inserted;
    } catch (error) {
      // A concurrent confirmation may have inserted the same session first.
      const retry = await database(select);
      purchase = Array.isArray(retry) ? retry[0] : null;
      if (!purchase) throw error;
    }
  }

  const entitlementId = await database('rpc/content_decay_grant_entitlement', {
    method: 'POST',
    body: {p_purchase: purchase.id}
  });
  if (!entitlementId) {
    throw fail(409, 'CONTENT_DECAY_ENTITLEMENT_FAILED',
      'The payment was recorded but the report access could not be granted.');
  }

  return {
    paid: true,
    scanId: metadata.scan_id,
    purchaseId: purchase.id,
    entitlementId,
    environment: mode
  };
}

// Records the payment for a report credit. No scan, no entitlement yet: the
// credit stays open until the buyer scans a site.
async function confirmCredit({
  sessionId,
  expectedUserId,
  client = stripeClient(),
  database = db,
  priceId = config.priceId()
} = {}) {
  if (!CHECKOUT_SESSION.test(String(sessionId || ''))) {
    throw fail(400, 'CONTENT_DECAY_INVALID_REQUEST', 'A valid checkout session is required.');
  }

  const session = await client.retrieveSession(sessionId);
  const problems = sessionProblems(session, {priceId, expectedUserId, kind: CREDIT_KIND});
  if (problems.length) {
    throw fail(409, 'CONTENT_DECAY_NOT_PAID',
      'That checkout is not a completed Content Decay report payment.');
  }

  const mode = session.livemode ? 'live' : 'test';
  const metadata = session.metadata;

  // The checkout reserved its credit before Stripe was called, so the row is
  // found by the id the session carries. Matching on the session id is the
  // fallback for a session created before reservations existed.
  let credit = null;
  const reservedId = String(metadata.credit_id || '');
  if (UUID.test(reservedId)) {
    const rows = await database(
      'content_decay_report_credits?id=eq.' + encodeURIComponent(reservedId)
      + '&select=id,status,user_id,environment,stripe_session_id'
    );
    credit = Array.isArray(rows) ? rows[0] || null : null;
    if (credit && credit.stripe_session_id && credit.stripe_session_id !== sessionId) {
      throw fail(409, 'CONTENT_DECAY_PURCHASE_MISMATCH',
        'That checkout does not match this report credit.');
    }
  }
  if (!credit) {
    const rows = await database(
      'content_decay_report_credits?stripe_session_id=eq.' + encodeURIComponent(sessionId)
      + '&select=id,status,user_id,environment,stripe_session_id'
    );
    credit = Array.isArray(rows) ? rows[0] || null : null;
  }

  if (credit) {
    if (credit.user_id !== metadata.user_id) {
      throw fail(409, 'CONTENT_DECAY_PURCHASE_MISMATCH',
        'That checkout was already recorded against another account.');
    }
    // A refund already voided this credit. Never reopen it.
    if (credit.status === 'refunded' || credit.status === 'revoked' || credit.status === 'expired') {
      return {
        paid: false,
        refunded: credit.status === 'refunded',
        revoked: credit.status === 'revoked',
        creditId: credit.id,
        environment: mode
      };
    }
    if (credit.status === 'pending') {
      await openReservedCredit({creditId: credit.id, sessionId, session, priceId, database});
    }
    return {paid: true, credit: true, creditId: credit.id, environment: mode};
  }

  // No reservation: a session created before this table tracked them. Record it
  // exactly as before, and adopt a pending row if the index is what blocked it.
  const body = {
    user_id: metadata.user_id,
    email: session.customer_details?.email || session.customer_email || null,
    status: 'open',
    stripe_session_id: sessionId,
    stripe_payment_intent: session.payment_intent || null,
    stripe_price_id: priceId,
    amount_total: session.amount_total,
    currency: session.currency,
    livemode: session.livemode,
    environment: mode,
    test_run_id: null
  };
  try {
    const inserted = await database('content_decay_report_credits', {
      method: 'POST',
      body,
      headers: {Prefer: 'return=representation'}
    });
    credit = Array.isArray(inserted) ? inserted[0] : inserted;
  } catch (error) {
    // A concurrent confirmation may have inserted the same session first.
    const retry = await database(
      'content_decay_report_credits?stripe_session_id=eq.' + encodeURIComponent(sessionId)
      + '&select=id,status,user_id,environment,stripe_session_id'
    );
    credit = Array.isArray(retry) ? retry[0] : null;
    if (!credit) {
      const pending = await database(
        'content_decay_report_credits?user_id=eq.' + encodeURIComponent(metadata.user_id)
        + '&environment=eq.' + encodeURIComponent(mode) + '&status=eq.pending&select=id&limit=1'
      );
      credit = Array.isArray(pending) ? pending[0] || null : null;
      if (!credit) throw error;
      await openReservedCredit({creditId: credit.id, sessionId, session, priceId, database});
    }
  }

  return {paid: true, credit: true, creditId: credit.id, environment: mode};
}

// Turns a reservation into the paid credit. The status filter means a refund
// that landed first can never be overwritten by a late confirmation.
async function openReservedCredit({creditId, sessionId, session, priceId, database}) {
  await database(
    'content_decay_report_credits?id=eq.' + encodeURIComponent(creditId) + '&status=eq.pending',
    {
      method: 'PATCH',
      body: {
        status: 'open',
        stripe_session_id: sessionId,
        stripe_payment_intent: session.payment_intent || null,
        stripe_price_id: priceId,
        amount_total: session.amount_total,
        currency: session.currency,
        livemode: session.livemode,
        email: session.customer_details?.email || session.customer_email || null,
        updated_at: new Date().toISOString()
      }
    }
  );
}

function stripeId(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.id === 'string') return value.id;
  return '';
}

async function loadPurchaseByIntent(database, paymentIntent, livemode) {
  const rows = await database(
    'content_decay_purchases?stripe_payment_intent=eq.' + encodeURIComponent(paymentIntent)
    + '&livemode=eq.' + (livemode ? 'true' : 'false')
    + '&select=id,status,user_id,scan_id,environment,test_run_id'
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function loadCreditByIntent(database, paymentIntent, livemode) {
  const rows = await database(
    'content_decay_report_credits?stripe_payment_intent=eq.' + encodeURIComponent(paymentIntent)
    + '&livemode=eq.' + (livemode ? 'true' : 'false')
    + '&select=id,status,user_id,environment'
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

// Spends the buyer's oldest open credit on one completed scan: records the
// purchase, grants access through the same atomic function a normal purchase
// uses, then closes the credit. Calling it again for a scan that already has
// an entitlement returns that entitlement instead of spending a second credit.
async function claimCredit({scanId, user, database = db, mode = config.environment()} = {}) {
  if (!user || !user.id) {
    throw fail(401, 'CONTENT_DECAY_SIGN_IN_REQUIRED', 'Please sign in to use your report credit.');
  }
  requireId(scanId, 'scan');
  requireId(user.id, 'account');

  const scan = await loadScan(database, scanId);
  if (!scan) {
    throw fail(404, 'CONTENT_DECAY_SCAN_NOT_FOUND', 'That scan was not found.');
  }
  if (scan.user_id && scan.user_id !== user.id) {
    throw fail(403, 'CONTENT_DECAY_SCAN_NOT_OWNED',
      'This scan is not linked to your account. Run a new scan while signed in.');
  }
  if (scan.status !== 'completed') {
    throw fail(409, 'CONTENT_DECAY_SCAN_NOT_READY', 'This scan has not finished yet.');
  }
  if (scan.environment !== mode) {
    throw fail(409, 'CONTENT_DECAY_MODE_MISMATCH', 'This scan belongs to a different payment environment.');
  }

  // An anonymous scan becomes this buyer's scan, exactly as it does at checkout.
  if (!scan.user_id) {
    const claimed = await database(
      'content_decay_scans?id=eq.' + encodeURIComponent(scanId) + '&user_id=is.null',
      {method: 'PATCH', body: {user_id: user.id}, headers: {Prefer: 'return=representation'}}
    );
    const row = Array.isArray(claimed) ? claimed[0] : claimed;
    if (!row || row.user_id !== user.id) {
      const latest = await loadScan(database, scanId);
      if (!latest || latest.user_id !== user.id) {
        throw fail(403, 'CONTENT_DECAY_SCAN_NOT_OWNED',
          'This scan is already linked to another account. Run a new scan while signed in.');
      }
    }
  }

  const existing = await entitlementFor({userId: user.id, scanId, environment: mode, database});
  if (existing) {
    return {available: true, claimed: true, alreadyPurchased: true, entitlementId: existing.id, scanId};
  }

  const rows = await database(
    'content_decay_report_credits?user_id=eq.' + encodeURIComponent(user.id)
    + '&status=eq.open&environment=eq.' + encodeURIComponent(mode)
    + '&select=id,stripe_session_id,stripe_payment_intent,stripe_price_id,amount_total,currency,livemode,email'
    + '&order=created_at.asc&limit=1'
  );
  const credit = Array.isArray(rows) ? rows[0] : null;
  if (!credit) return {available: false};

  const select = 'content_decay_purchases?stripe_session_id=eq.'
    + encodeURIComponent(credit.stripe_session_id) + '&select=id,status,user_id,scan_id';
  let purchase = null;
  const prior = await database(select);
  if (Array.isArray(prior) && prior[0]) {
    purchase = prior[0];
    if (purchase.user_id !== user.id || purchase.scan_id !== scanId) {
      throw fail(409, 'CONTENT_DECAY_PURCHASE_MISMATCH',
        'That payment was already recorded against another report.');
    }
  } else {
    const body = {
      user_id: user.id,
      scan_id: scanId,
      email: credit.email,
      status: 'paid',
      stripe_session_id: credit.stripe_session_id,
      stripe_payment_intent: credit.stripe_payment_intent,
      stripe_price_id: credit.stripe_price_id,
      amount_total: credit.amount_total,
      currency: credit.currency,
      livemode: credit.livemode,
      environment: mode,
      test_run_id: mode === 'test' ? scan.test_run_id : null
    };
    try {
      const inserted = await database('content_decay_purchases', {
        method: 'POST',
        body,
        headers: {Prefer: 'return=representation'}
      });
      purchase = Array.isArray(inserted) ? inserted[0] : inserted;
    } catch (error) {
      const retry = await database(select);
      purchase = Array.isArray(retry) ? retry[0] : null;
      if (!purchase) throw error;
    }
  }

  const entitlementId = await database('rpc/content_decay_grant_entitlement', {
    method: 'POST',
    body: {p_purchase: purchase.id}
  });
  if (!entitlementId) {
    throw fail(409, 'CONTENT_DECAY_ENTITLEMENT_FAILED',
      'The payment was recorded but the report access could not be granted.');
  }

  const creditClosed = await closeCreditOnPurchase({credit, purchase, scanId, database});

  return {
    available: true,
    claimed: true,
    paid: true,
    scanId,
    purchaseId: purchase.id,
    entitlementId,
    // The report is granted either way; a credit that could not be closed is
    // repaired on the next page load instead of being offered again.
    creditClosed,
    environment: mode
  };
}

// A refund or dispute that arrives before the credit was ever spent has no
// purchase row to find, so the open credit is voided instead. Without this a
// refunded buyer could still claim a report with the credit.
async function voidCredit(event, {database = db, paymentIntent, eventMode, status}) {
  const credit = await loadCreditByIntent(database, paymentIntent, eventMode === 'live');
  if (!credit) return false; // another product's charge
  if (credit.environment !== eventMode) {
    throw fail(400, 'CONTENT_DECAY_MODE_MISMATCH',
      'That credit belongs to a different payment environment.');
  }
  const claimed = await database('rpc/content_decay_claim_webhook', {
    method: 'POST',
    body: {
      p_event_id: event.id,
      p_type: event.type,
      p_livemode: eventMode === 'live',
      p_test_run: null
    }
  });
  if (claimed !== true) return true; // already processed by another delivery
  // A reservation that was paid but not yet confirmed is voided too, so a
  // refund can never leave a credit the buyer could still spend.
  await database(
    'content_decay_report_credits?id=eq.' + encodeURIComponent(credit.id) + '&status=in.(open,pending)',
    {method: 'PATCH', body: {status, updated_at: new Date().toISOString()}}
  );
  return true;
}

// charge.refunded for a Content Decay charge. The charge's payment intent is
// the durable link to the purchase; frontend state is never involved.
async function refundPurchase(event, {database = db, environment = config.environment()} = {}) {
  const charge = event?.data?.object;
  const paymentIntent = stripeId(charge?.payment_intent);
  const refundedAmount = Number(charge?.amount_refunded);
  const chargedAmount = Number(charge?.amount);

  // Not a successful refund of this product (or a zero-amount refund marker).
  if (!CHARGE.test(String(charge?.id || ''))
      || !PAYMENT_INTENT.test(paymentIntent)
      || !Number.isSafeInteger(refundedAmount)
      || !Number.isSafeInteger(chargedAmount)
      || refundedAmount <= 0
      || chargedAmount <= 0) {
    return false;
  }
  // Only a full refund ends the report. A partial refund is a deliberate
  // goodwill amount, so revoking the $49 report over a $5 refund would take
  // away more than was given back. An unreadable charge amount is never guessed
  // at: the event is left for a human rather than closing the report.
  if (refundedAmount < chargedAmount) return false;
  if (!EVENT.test(String(event.id || ''))) {
    throw fail(400, 'CONTENT_DECAY_INVALID_REQUEST', 'The webhook event is not a valid Stripe event.');
  }

  const eventMode = event.livemode === true ? 'live' : 'test';
  if (eventMode !== environment) {
    throw fail(400, 'CONTENT_DECAY_MODE_MISMATCH',
      'The webhook event belongs to a different payment environment.');
  }
  if (typeof charge.livemode === 'boolean' && charge.livemode !== (eventMode === 'live')) {
    throw fail(400, 'CONTENT_DECAY_MODE_MISMATCH',
      'The charge and the webhook event disagree about livemode.');
  }

  const purchase = await loadPurchaseByIntent(database, paymentIntent, eventMode === 'live');
  if (!purchase) {
    // A credit bought before any scan has no purchase row yet.
    return await voidCredit(event, {database, paymentIntent, eventMode, status: 'refunded'});
  }
  if (purchase.environment !== eventMode) {
    throw fail(400, 'CONTENT_DECAY_MODE_MISMATCH',
      'That purchase belongs to a different payment environment.');
  }

  const claimed = await database('rpc/content_decay_claim_webhook', {
    method: 'POST',
    body: {
      p_event_id: event.id,
      p_type: event.type,
      p_livemode: eventMode === 'live',
      p_test_run: eventMode === 'test' ? purchase.test_run_id : null
    }
  });
  if (claimed !== true) return true; // already processed by another delivery

  try {
    const purchaseId = await database('rpc/content_decay_refund_purchase', {
      method: 'POST',
      body: {p_payment_intent: paymentIntent, p_livemode: eventMode === 'live'}
    });
    if (!purchaseId) {
      // The purchase was deleted between lookup and update. Nothing to revoke.
      await database('content_decay_webhook_events?id=eq.' + encodeURIComponent(event.id), {
        method: 'DELETE'
      }).catch(() => {});
      return false;
    }
  } catch (error) {
    // Release the claim so Stripe's retry can process the same refund again.
    await database('content_decay_webhook_events?id=eq.' + encodeURIComponent(event.id), {
      method: 'DELETE'
    }).catch(() => {});
    throw error;
  }
  return true;
}

// charge.dispute.created for a Content Decay charge. A dispute withdraws the
// money the report was sold for, so access ends exactly as it does for a
// refund. The dispute's payment intent is the durable link to the purchase.
async function disputePurchase(event, {database = db, environment = config.environment()} = {}) {
  const dispute = event?.data?.object;
  const paymentIntent = stripeId(dispute?.payment_intent);

  // Not a dispute this product can attribute to a payment.
  if (!DISPUTE.test(String(dispute?.id || ''))
      || !PAYMENT_INTENT.test(paymentIntent)) {
    return false;
  }
  if (!EVENT.test(String(event.id || ''))) {
    throw fail(400, 'CONTENT_DECAY_INVALID_REQUEST', 'The webhook event is not a valid Stripe event.');
  }

  const eventMode = event.livemode === true ? 'live' : 'test';
  if (eventMode !== environment) {
    throw fail(400, 'CONTENT_DECAY_MODE_MISMATCH',
      'The webhook event belongs to a different payment environment.');
  }
  if (typeof dispute.livemode === 'boolean' && dispute.livemode !== (eventMode === 'live')) {
    throw fail(400, 'CONTENT_DECAY_MODE_MISMATCH',
      'The dispute and the webhook event disagree about livemode.');
  }

  const purchase = await loadPurchaseByIntent(database, paymentIntent, eventMode === 'live');
  if (!purchase) {
    // A credit bought before any scan has no purchase row yet.
    return await voidCredit(event, {database, paymentIntent, eventMode, status: 'revoked'});
  }
  if (purchase.environment !== eventMode) {
    throw fail(400, 'CONTENT_DECAY_MODE_MISMATCH',
      'That purchase belongs to a different payment environment.');
  }

  const claimed = await database('rpc/content_decay_claim_webhook', {
    method: 'POST',
    body: {
      p_event_id: event.id,
      p_type: event.type,
      p_livemode: eventMode === 'live',
      p_test_run: eventMode === 'test' ? purchase.test_run_id : null
    }
  });
  if (claimed !== true) return true; // already processed by another delivery

  try {
    const purchaseId = await database('rpc/content_decay_dispute_purchase', {
      method: 'POST',
      body: {p_payment_intent: paymentIntent, p_livemode: eventMode === 'live'}
    });
    if (!purchaseId) {
      // The purchase was deleted between lookup and update. Nothing to revoke.
      await database('content_decay_webhook_events?id=eq.' + encodeURIComponent(event.id), {
        method: 'DELETE'
      }).catch(() => {});
      return false;
    }
  } catch (error) {
    // Release the claim so Stripe's retry can process the same dispute again.
    await database('content_decay_webhook_events?id=eq.' + encodeURIComponent(event.id), {
      method: 'DELETE'
    }).catch(() => {});
    throw error;
  }
  return true;
}

// checkout.session.expired: an unpaid credit checkout lapsed. Marking the
// reservation expired frees the buyer's one-report slot at the moment Stripe
// says the session is dead, instead of at the next page load. The update is
// filtered on 'pending', so a completed payment or a refund is never touched.
async function expireCreditCheckout(event, {database = db, environment = config.environment()} = {}) {
  const session = event?.data?.object;
  if (!session || session.metadata?.product !== PRODUCT) return false;
  // Report checkouts hold no reservation; there is nothing to expire for them.
  if (session.metadata?.kind !== CREDIT_KIND) return false;
  if (!EVENT.test(String(event.id || ''))) {
    throw fail(400, 'CONTENT_DECAY_INVALID_REQUEST', 'The webhook event is not a valid Stripe event.');
  }

  const eventMode = event.livemode === true ? 'live' : 'test';
  if (eventMode !== environment) {
    throw fail(400, 'CONTENT_DECAY_MODE_MISMATCH',
      'The webhook event belongs to a different payment environment.');
  }
  if (!CHECKOUT_SESSION.test(String(session.id || ''))) {
    throw fail(400, 'CONTENT_DECAY_INVALID_REQUEST', 'The webhook event has no valid checkout session.');
  }

  const claimed = await database('rpc/content_decay_claim_webhook', {
    method: 'POST',
    body: {
      p_event_id: event.id,
      p_type: event.type,
      p_livemode: eventMode === 'live',
      p_test_run: null
    }
  });
  if (claimed !== true) return true; // already processed by another delivery

  await database(
    'content_decay_report_credits?stripe_session_id=eq.' + encodeURIComponent(session.id)
    + '&status=eq.pending',
    {method: 'PATCH', body: {status: 'expired', updated_at: new Date().toISOString()}}
  );
  return true;
}

// charge.dispute.closed with status "won": the money stands, so the report the
// dispute revoked is restored. The purchase filter is what keeps a refunded
// purchase closed, because that money really is gone even if a dispute is won.
async function restoreDisputedPurchase(event, {database = db, environment = config.environment()} = {}) {
  const dispute = event?.data?.object;
  const paymentIntent = stripeId(dispute?.payment_intent);

  if (!DISPUTE.test(String(dispute?.id || ''))
      || !PAYMENT_INTENT.test(paymentIntent)
      || String(dispute?.status || '').toLowerCase() !== 'won') {
    return false;
  }
  if (!EVENT.test(String(event.id || ''))) {
    throw fail(400, 'CONTENT_DECAY_INVALID_REQUEST', 'The webhook event is not a valid Stripe event.');
  }

  const eventMode = event.livemode === true ? 'live' : 'test';
  if (eventMode !== environment) {
    throw fail(400, 'CONTENT_DECAY_MODE_MISMATCH',
      'The webhook event belongs to a different payment environment.');
  }
  if (typeof dispute.livemode === 'boolean' && dispute.livemode !== (eventMode === 'live')) {
    throw fail(400, 'CONTENT_DECAY_MODE_MISMATCH',
      'The dispute and the webhook event disagree about livemode.');
  }

  const purchase = await loadPurchaseByIntent(database, paymentIntent, eventMode === 'live');
  const credit = purchase ? null : await loadCreditByIntent(database, paymentIntent, eventMode === 'live');
  if (!purchase && !credit) return false;

  const claimed = await database('rpc/content_decay_claim_webhook', {
    method: 'POST',
    body: {
      p_event_id: event.id,
      p_type: event.type,
      p_livemode: eventMode === 'live',
      p_test_run: eventMode === 'test' && purchase ? purchase.test_run_id : null
    }
  });
  if (claimed !== true) return true; // already processed by another delivery

  if (credit) {
    // A credit voided by the dispute becomes usable again, unless the buyer has
    // already bought another one, which the one-live-credit rule must keep.
    if (credit.status !== 'revoked' || credit.environment !== eventMode) return true;
    const live = await liveCreditFor({user: {id: credit.user_id}, database, mode: eventMode});
    if (live) return true;
    await database(
      'content_decay_report_credits?id=eq.' + encodeURIComponent(credit.id) + '&status=eq.revoked',
      {method: 'PATCH', body: {status: 'open', updated_at: new Date().toISOString()}}
    );
    return true;
  }

  const restored = await database(
    'content_decay_purchases?id=eq.' + encodeURIComponent(purchase.id) + '&status=eq.revoked',
    {
      method: 'PATCH',
      headers: {Prefer: 'return=representation'},
      body: {status: 'paid', updated_at: new Date().toISOString()}
    }
  );
  const row = Array.isArray(restored) ? restored[0] : restored;
  // A refunded purchase is not reopened here.
  if (!row || row.status !== 'paid') return true;
  // grant_entitlement reactivates the entitlement the dispute revoked.
  await database('rpc/content_decay_grant_entitlement', {
    method: 'POST',
    body: {p_purchase: purchase.id}
  });
  return true;
}

// Returns false only for events that are not this product's, so a shared
// dispatcher can continue to the next handler.
async function handleWebhook(event, {
  client = stripeClient(),
  database = db,
  priceId = config.priceId(),
  environment = config.environment()
} = {}) {
  const type = event?.type;
  if (type === 'charge.refunded') {
    return await refundPurchase(event, {database, environment});
  }
  if (type === 'charge.dispute.created') {
    return await disputePurchase(event, {database, environment});
  }
  if (type === 'charge.dispute.closed') {
    const status = String(event?.data?.object?.status || '').toLowerCase();
    // "won" returns the money to the seller, so access comes back. "lost" keeps
    // the revocation. An inquiry that closes without a chargeback is neither.
    if (status === 'won') return await restoreDisputedPurchase(event, {database, environment});
    if (status === 'lost') return await disputePurchase(event, {database, environment});
    return false;
  }
  if (type === 'checkout.session.expired') {
    return await expireCreditCheckout(event, {database, environment});
  }
  if (type !== 'checkout.session.completed' && type !== 'checkout.session.async_payment_succeeded') {
    return false;
  }
  const session = event?.data?.object;
  if (!session || session.metadata?.product !== PRODUCT) return false;
  if (!EVENT.test(String(event.id || ''))) {
    throw fail(400, 'CONTENT_DECAY_INVALID_REQUEST', 'The webhook event is not a valid Stripe event.');
  }

  const eventMode = event.livemode === true ? 'live' : 'test';
  if (eventMode !== environment) {
    throw fail(400, 'CONTENT_DECAY_MODE_MISMATCH',
      'The webhook event belongs to a different payment environment.');
  }
  if (!CHECKOUT_SESSION.test(String(session.id || ''))) {
    throw fail(400, 'CONTENT_DECAY_INVALID_REQUEST', 'The webhook event has no valid checkout session.');
  }

  // A credit session carries the credit kind and no scan id, because there is
  // no scan yet. Everything else is still verified server-side from Stripe.
  const creditSession = session.metadata?.kind === CREDIT_KIND;
  const scan = creditSession ? null : await loadScan(database, session.metadata?.scan_id);
  if (!creditSession && !scan) {
    throw fail(404, 'CONTENT_DECAY_SCAN_NOT_FOUND', 'That scan was not found.');
  }

  const claimed = await database('rpc/content_decay_claim_webhook', {
    method: 'POST',
    body: {
      p_event_id: event.id,
      p_type: type,
      p_livemode: eventMode === 'live',
      p_test_run: eventMode === 'test' && scan ? scan.test_run_id : null
    }
  });
  if (claimed !== true) return true; // already processed by another delivery

  try {
    if (creditSession) {
      await confirmCredit({sessionId: session.id, client, database, priceId});
    } else {
      await confirmSession({sessionId: session.id, client, database, priceId});
    }
  } catch (error) {
    // Release the claim so Stripe's retry can process this event. Successful
    // events stay claimed, which is what makes replays a no-op.
    await database('content_decay_webhook_events?id=eq.' + encodeURIComponent(event.id), {
      method: 'DELETE'
    }).catch(() => {});
    throw error;
  }
  return true;
}

module.exports = {
  PRODUCT,
  REPORT_AMOUNT,
  REPORT_CURRENCY,
  CREDIT_KIND,
  pricePreflight,
  createCheckout,
  createCreditCheckout,
  openCreditFor,
  confirmSession,
  confirmCredit,
  claimCredit,
  entitlementFor,
  handleWebhook,
  stripeClient
};
