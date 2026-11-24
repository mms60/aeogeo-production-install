'use strict';
// Creates Stripe Checkout sessions for the two one-time AI Entity & Citation
// Authority Setup offers. Checkout is account-bound: the client must send the
// Supabase access token, and the verified account email/user ID are attached to
// the Stripe session. A Single-Hub owner can buy the Multi-Location upgrade for
// the $400 difference instead of paying the full Multi-Location price again.
const { stripe, origin } = require('./lib/stripe');
const { user: authUser, db } = require('./lib/db');
const purchases = require('./lib/entity-purchases');

const PRODUCT = 'entity-authority';
const UPGRADE = Object.freeze({
  from: 'single',
  to: 'multi',
  amount: 40000,
  credit: 79900
});
// A Content Decay report bought in the last 30 days is credited in full against
// either setup offer. It is never stacked on the Single-Hub upgrade credit,
// which already accounts for the earlier purchase.
const REPORT_CREDIT = Object.freeze({
  amount: 4900,
  days: 30,
  name: 'Content Decay report credit'
});
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

function reply(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    },
    body: JSON.stringify(body)
  };
}

function statusError(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

function requestPayload(event) {
  const query = event && event.queryStringParameters ? event.queryStringParameters : {};
  let plan = String(query.plan || '').trim().toLowerCase();
  let upgrade = String(query.upgrade || '') === '1';

  if (!plan && event && event.httpMethod === 'POST' && event.body) {
    const raw = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8').toString('utf8');
    const headers = event.headers || {};
    const contentType = String(headers['content-type'] || headers['Content-Type'] || '');
    if (contentType.includes('application/json')) {
      try {
        const parsed = JSON.parse(raw);
        plan = String(parsed && parsed.plan || '').trim().toLowerCase();
        upgrade = Boolean(parsed && parsed.upgrade) || upgrade;
      } catch {
        plan = '';
      }
    } else {
      plan = String(new URLSearchParams(raw).get('plan') || '').trim().toLowerCase();
      upgrade = String(new URLSearchParams(raw).get('upgrade') || '') === '1' || upgrade;
    }
  }

  return { plan, upgrade };
}

function authorization(event) {
  const headers = event && event.headers ? event.headers : {};
  return String(headers.authorization || headers.Authorization || '');
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

// Full credit for a report bought within the last 30 days. A lookup failure must
// not stop a paying customer, so it degrades to no credit and says so in the log.
async function reportCreditFor(userId) {
  const since = new Date(Date.now() - REPORT_CREDIT.days * 24 * 60 * 60 * 1000).toISOString();
  try {
    const rows = await db(
      'content_decay_purchases?user_id=eq.' + encodeURIComponent(userId)
      + '&status=eq.paid&livemode=eq.true&environment=eq.live'
      + '&created_at=gte.' + encodeURIComponent(since)
      + '&select=id&limit=1'
    );
    return Array.isArray(rows) && rows.length ? REPORT_CREDIT.amount : 0;
  } catch (error) {
    console.error('entity-authority-checkout report credit lookup failed', error && error.message);
    return 0;
  }
}

async function requireUser(event) {
  if (!authorization(event)) {
    throw statusError(401, 'Sign in before starting checkout so the purchase is linked to your account.', 'SIGN_IN_REQUIRED');
  }
  return authUser(event);
}

exports.handler = async event => {
  const method = String(event && event.httpMethod || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    const response = reply(405, { error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
    response.headers.Allow = 'GET, POST';
    return response;
  }

  const request = requestPayload(event);
  const offer = Object.prototype.hasOwnProperty.call(OFFERS, request.plan) ? OFFERS[request.plan] : null;
  if (!offer) {
    return reply(400, { error: 'Choose the Single-Hub ($799) or Multi-Location ($1,199) plan.', code: 'PLAN_REQUIRED' });
  }
  if (request.upgrade && request.plan !== UPGRADE.to) {
    return reply(400, { error: 'The upgrade option is only available for the Multi-Location plan.', code: 'UPGRADE_PLAN_INVALID' });
  }

  let checkoutUser;
  try {
    checkoutUser = await requireUser(event);
  } catch (error) {
    return reply(error.status || 401, {
      error: error.message || 'Sign in before starting checkout.',
      code: error.code || 'SIGN_IN_REQUIRED'
    });
  }

  try {
    const entitlement = await purchases.entitlementForUser(checkoutUser.id, checkoutUser);

    if (request.upgrade) {
      if (!entitlement || entitlement.plan !== UPGRADE.from) {
        return reply(403, {
          error: 'The $400 upgrade is only available to an account with an active Single-Hub purchase.',
          code: 'UPGRADE_REQUIRES_SINGLE'
        });
      }
    } else if (entitlement) {
      if (entitlement.plan === 'multi' || entitlement.plan === request.plan) {
        return reply(409, {
          error: 'This account already has that DIY builder plan. Open the builder instead of paying again.',
          code: 'ALREADY_PURCHASED'
        });
      }
      if (entitlement.plan === 'single' && request.plan === 'multi') {
        return reply(409, {
          error: 'This account has Single-Hub. Use the $400 upgrade option instead of buying Multi-Location again.',
          code: 'UPGRADE_REQUIRED'
        });
      }
    }

    const price = await stripe(`prices/${encodeURIComponent(offer.priceId)}`);
    if (!validLivePrice(price, offer)) {
      console.error('entity-authority-checkout price verification failed', request.plan);
      return reply(503, {
        error: 'Secure checkout is unavailable because the live price could not be verified.',
        code: 'PRICE_VERIFICATION_FAILED'
      });
    }

    let couponId = null;
    if (request.upgrade) {
      const coupon = await stripe('coupons', {
        method: 'POST',
        idempotency: `ea-upgrade-${checkoutUser.id}`,
        data: {
          amount_off: String(UPGRADE.credit),
          currency: 'usd',
          duration: 'once',
          name: 'Single-Hub to Multi-Location upgrade',
          'metadata[product]': PRODUCT,
          'metadata[user_id]': checkoutUser.id
        }
      });
      if (!coupon || !coupon.id) {
        throw statusError(503, 'The upgrade discount could not be created.', 'UPGRADE_COUPON_MISSING');
      }
      couponId = coupon.id;
    }

    // The report credit is applied after the upgrade check so the two credits
    // can never be stacked on one purchase.
    let reportCredit = 0;
    if (!request.upgrade) {
      reportCredit = await reportCreditFor(checkoutUser.id);
      if (reportCredit > 0) {
        const coupon = await stripe('coupons', {
          method: 'POST',
          idempotency: `ea-report-credit-${checkoutUser.id}`,
          data: {
            amount_off: String(reportCredit),
            currency: 'usd',
            duration: 'once',
            name: REPORT_CREDIT.name,
            'metadata[product]': PRODUCT,
            'metadata[source]': 'content_decay',
            'metadata[user_id]': checkoutUser.id
          }
        });
        if (!coupon || !coupon.id) {
          throw statusError(503, 'The Content Decay report credit could not be created.', 'REPORT_CREDIT_COUPON_MISSING');
        }
        couponId = coupon.id;
      }
    }

    const expectedAmount = request.upgrade ? UPGRADE.amount : offer.amount - reportCredit;
    const base = origin();
    const sessionData = {
      mode: 'payment',
      'line_items[0][price]': offer.priceId,
      'line_items[0][quantity]': '1',
      success_url: `${base}/ai-visibility-schema-studio?checkout=success&session_id={CHECKOUT_SESSION_ID}${request.upgrade ? '&upgrade=1' : ''}#get-started`,
      cancel_url: `${base}/ai-visibility-schema-studio?checkout=cancelled#pricing`,
      customer_email: checkoutUser.email,
      client_reference_id: checkoutUser.id,
      'metadata[plan]': request.plan,
      'metadata[product]': PRODUCT,
      'metadata[price]': offer.priceId,
      'metadata[amount]': String(expectedAmount),
      'metadata[user_id]': checkoutUser.id,
      'payment_intent_data[metadata][plan]': request.plan,
      'payment_intent_data[metadata][product]': PRODUCT,
      'payment_intent_data[metadata][price]': offer.priceId,
      'payment_intent_data[metadata][amount]': String(expectedAmount),
      'payment_intent_data[metadata][user_id]': checkoutUser.id,
      allow_promotion_codes: false
    };

    if (request.upgrade) {
      sessionData['metadata[upgrade]'] = '1';
      sessionData['metadata[previous_plan]'] = UPGRADE.from;
    }
    if (reportCredit > 0) {
      // Verification reads this back, so the reduced total is expected rather
      // than treated as a mismatch.
      sessionData['metadata[report_credit]'] = String(reportCredit);
      sessionData['payment_intent_data[metadata][report_credit]'] = String(reportCredit);
    }
    if (couponId) sessionData['discounts[0][coupon]'] = couponId;

    const session = await stripe('checkout/sessions', {
      method: 'POST',
      data: sessionData
    });

    if (!session || !session.url) {
      throw statusError(503, 'Checkout could not be created.', 'CHECKOUT_SESSION_MISSING');
    }
    if (
      session.mode !== 'payment' ||
      session.livemode !== true ||
      session.currency !== 'usd' ||
      session.amount_total !== expectedAmount
    ) {
      throw statusError(503, 'Checkout response did not match the verified offer.', 'CHECKOUT_SESSION_MISMATCH');
    }

    let target;
    try {
      target = new URL(session.url);
      if (target.protocol !== 'https:' || target.hostname !== 'checkout.stripe.com' || target.port) {
        throw new Error('Invalid checkout host.');
      }
    } catch {
      throw statusError(503, 'Checkout address could not be verified.', 'CHECKOUT_URL_INVALID');
    }

    return reply(200, {
      url: target.href,
      plan: request.plan,
      upgrade: Boolean(request.upgrade)
    });
  } catch (error) {
    const allowed = [400, 401, 403, 409, 503];
    const status = allowed.includes(error && error.status) ? error.status : 503;
    const code = error && error.code ? String(error.code).slice(0, 80) : 'CHECKOUT_UNAVAILABLE';
    console.error('entity-authority-checkout failed', status, code);
    return reply(status, {
      error: status === 503
        ? 'Secure checkout is unavailable right now. Please retry in a moment.'
        : (error.message || 'Checkout could not be started.'),
      code
    });
  }
};

exports.OFFERS = OFFERS;
exports.UPGRADE = UPGRADE;
exports.REPORT_CREDIT = REPORT_CREDIT;
exports.validLivePrice = validLivePrice;
exports.reportCreditFor = reportCreditFor;
