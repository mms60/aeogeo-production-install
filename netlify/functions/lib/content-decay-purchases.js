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
    createCheckoutSession: data => request('checkout/sessions', {method: 'POST', data})
  };
}

async function pricePreflight({priceId, mode = config.environment(), client = stripeClient()} = {}) {
  if (!PRICE.test(String(priceId || ''))) {
    throw fail(503, 'CONTENT_DECAY_PRICE_MISSING',
      'The Content Decay Stripe price is not configured for this environment.');
  }
  const price = await client.retrievePrice(priceId);
  const valid = price
    && price.id === priceId
    && price.active === true
    && price.type === 'one_time'
    && price.currency === REPORT_CURRENCY
    && price.unit_amount === REPORT_AMOUNT
    && price.livemode === (mode === 'live');
  if (!valid) {
    throw fail(503, 'CONTENT_DECAY_PRICE_MISMATCH',
      'The configured report price is not an active one-time USD 49 price in this environment.');
  }
  return {
    id: price.id,
    amount: price.unit_amount,
    currency: price.currency,
    livemode: price.livemode
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

  await pricePreflight({priceId, mode, client});

  const params = {
    mode: 'payment',
    success_url: origin + '/content-decay/?purchased=1&scan=' + encodeURIComponent(scanId)
      + '&session_id={CHECKOUT_SESSION_ID}',
    cancel_url: origin + '/content-decay/?checkout=cancelled',
    client_reference_id: user.id,
    'line_items[0][price]': priceId,
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

  const session = await client.createCheckoutSession(params);
  if (!session || !CHECKOUT_SESSION.test(String(session.id || '')) || !session.url) {
    throw fail(503, 'CONTENT_DECAY_STRIPE_RESPONSE', 'Stripe did not return a usable checkout session.');
  }
  return {sessionId: session.id, url: session.url, scanId};
}

function sessionProblems(session, {priceId, expectedUserId}) {
  const problems = [];
  const metadata = session?.metadata || {};
  if (metadata.product !== PRODUCT) problems.push('product');
  if (!UUID.test(String(metadata.user_id || ''))) problems.push('user');
  if (expectedUserId && metadata.user_id !== expectedUserId) problems.push('user-mismatch');
  if (!UUID.test(String(metadata.scan_id || ''))) problems.push('scan');
  if (session?.mode !== 'payment') problems.push('mode');
  if (session?.status !== 'complete') problems.push('status');
  if (session?.payment_status !== 'paid') problems.push('payment_status');
  if (session?.amount_total !== REPORT_AMOUNT) problems.push('amount');
  if (session?.currency !== REPORT_CURRENCY) problems.push('currency');
  if (typeof session?.livemode !== 'boolean') problems.push('livemode');
  const item = session?.line_items?.data?.[0];
  if (!item || item.quantity !== 1) problems.push('quantity');
  if (!item || item.price?.id !== priceId) problems.push('price');
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

// charge.refunded for a Content Decay charge. The charge's payment intent is
// the durable link to the purchase; frontend state is never involved.
async function refundPurchase(event, {database = db, environment = config.environment()} = {}) {
  const charge = event?.data?.object;
  const paymentIntent = stripeId(charge?.payment_intent);
  const refundedAmount = Number(charge?.amount_refunded);

  // Not a successful refund of this product (or a zero-amount refund marker).
  if (!CHARGE.test(String(charge?.id || ''))
      || !PAYMENT_INTENT.test(paymentIntent)
      || !Number.isSafeInteger(refundedAmount)
      || refundedAmount <= 0) {
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
  if (typeof charge.livemode === 'boolean' && charge.livemode !== (eventMode === 'live')) {
    throw fail(400, 'CONTENT_DECAY_MODE_MISMATCH',
      'The charge and the webhook event disagree about livemode.');
  }

  const purchase = await loadPurchaseByIntent(database, paymentIntent, eventMode === 'live');
  if (!purchase) return false; // another product's charge
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
  if (!purchase) return false; // another product's dispute
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

  const scan = await loadScan(database, session.metadata?.scan_id);
  if (!scan) {
    throw fail(404, 'CONTENT_DECAY_SCAN_NOT_FOUND', 'That scan was not found.');
  }

  const claimed = await database('rpc/content_decay_claim_webhook', {
    method: 'POST',
    body: {
      p_event_id: event.id,
      p_type: type,
      p_livemode: eventMode === 'live',
      p_test_run: eventMode === 'test' ? scan.test_run_id : null
    }
  });
  if (claimed !== true) return true; // already processed by another delivery

  try {
    await confirmSession({sessionId: session.id, client, database, priceId});
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
  pricePreflight,
  createCheckout,
  confirmSession,
  entitlementFor,
  handleWebhook,
  stripeClient
};
