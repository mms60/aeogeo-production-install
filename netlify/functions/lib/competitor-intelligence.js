'use strict';

const crypto = require('node:crypto');
const { buildCompetitorPdf } = require('./competitor-pdf');

const KIND = 'aeogeo_competitor_v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PRICE_IDS = Object.freeze({
  single: 'price_1UYUxlBIJX5f6Wmhyv5X7Sh2',
  monthly: 'price_1UYUwuBIJX5f6WmhgfvaYeW1'
});

const CATALOG = Object.freeze({
  currency: 'usd',
  maxPagesPerReport: 25,
  single: Object.freeze({
    plan: 'single',
    label: 'Single Competitor Report',
    priceId: PRICE_IDS.single,
    unitAmount: 2600,
    runs: 1,
    maxCompetitors: 5,
    mode: 'payment'
  }),
  monthly: Object.freeze({
    plan: 'monthly',
    label: 'Competitive Monitor Monthly',
    priceId: PRICE_IDS.monthly,
    unitAmount: 4600,
    runs: 3,
    maxCompetitors: 8,
    interval: 'month',
    mode: 'subscription'
  })
});

function validCatalogPrice(p, plan, isLive, requireActive = true) {
  const monthly = plan === 'monthly';
  const expectedAmount = monthly ? 4600 : 2600;
  return !!(
    p &&
    p.id === PRICE_IDS[plan] &&
    (!requireActive || p.active === true) &&
    p.livemode === isLive &&
    p.currency === 'usd' &&
    p.unit_amount === expectedAmount &&
    p.billing_scheme === 'per_unit' &&
    !p.transform_quantity &&
    !p.custom_unit_amount &&
    p.type === (monthly ? 'recurring' : 'one_time') &&
    (!monthly || (
      p.recurring?.interval === 'month' &&
      p.recurring?.interval_count === 1 &&
      p.recurring?.usage_type === 'licensed'
    ))
  );
}

const fail = (status, message, code = null) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const idOf = x => (typeof x === 'string' ? x : x?.id || null);
const safeId = (x, prefix) => typeof x === 'string' && x.startsWith(prefix) && /^[A-Za-z0-9_]+$/.test(x);
const enc = encodeURIComponent;

function createCompetitorIntelligence({
  env = process.env,
  stripe,
  db,
  authUser,
  credential,
  portalConfiguration,
  normalURL,
  dispatchBackground,
  now = () => Date.now(),
  uuid = () => crypto.randomUUID()
} = {}) {
  if (!stripe || !db || !authUser || !credential || !portalConfiguration || !normalURL) {
    throw new Error('Missing competitor-intelligence dependencies');
  }

  const live = () => credential().mode === 'live';
  const sandbox = () => env.CONTEXT !== 'production' && env.COMPETITOR_ALLOW_TEST_IN_SANDBOX === 'true';

  function siteOrigin() {
    const u = new URL(env.PUBLIC_SITE_URL || env.URL || 'https://aeogeosearch.com');
    if (u.protocol !== 'https:' || u.username || u.password) {
      throw fail(503, 'Canonical HTTPS site URL is misconfigured.');
    }
    return u.origin;
  }

  function ensurePaymentsEnabled() {
    if (env.COMPETITOR_INTELLIGENCE_DISABLED === 'true') {
      throw fail(503, 'Competitor Intelligence checkout is temporarily paused.');
    }
    if (!live() && !sandbox()) {
      throw fail(503, 'Test payments are disabled on the live website.');
    }
    if (!env.STRIPE_WEBHOOK_SECRET) {
      throw fail(503, 'Stripe webhook verification secret is required before checkout.');
    }
    if (live() && env.LIVE_PAYMENTS_ENABLED !== 'true') {
      throw fail(503, 'Live payments are currently disabled in server settings.');
    }
  }

  function signTicket(reportId, userId, expSec) {
    const key = crypto.createHmac('sha256', credential().key).update('AEOGEO competitor pdf ticket v1').digest();
    const payload = `${reportId}.${userId}.${expSec}`;
    const mac = crypto.createHmac('sha256', key).update(payload).digest('base64url');
    return `${expSec}.${mac}`;
  }

  function verifyTicket(reportId, userId, token) {
    if (typeof token !== 'string' || !UUID.test(reportId || '') || !UUID.test(userId || '')) return false;
    const [expStr, mac, extra] = token.split('.');
    if (extra || !/^\d+$/.test(expStr || '') || !mac) return false;
    const exp = Number(expStr);
    if (exp <= Math.floor(now() / 1000)) return false;
    const expected = signTicket(reportId, userId, exp).split('.')[1];
    try {
      const a = Buffer.from(mac, 'base64url');
      const b = Buffer.from(expected, 'base64url');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  const one = async path => {
    const rows = await db(path);
    return rows?.[0] || null;
  };

  const rpc = async (name, body) => {
    const res = await db('rpc/' + name, { method: 'POST', body });
    return Array.isArray(res) ? res[0] ?? null : res;
  };

  function jsonReply(statusCode, body) {
    return {
      statusCode,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, private',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer'
      },
      body: JSON.stringify(body)
    };
  }

  async function statusCheck() {
    try {
      ensurePaymentsEnabled();
      await db('geo_competitor_entitlements?select=id&limit=1');
      const [singlePrice, monthlyPrice] = await Promise.all([
        stripe('prices/' + enc(PRICE_IDS.single)),
        stripe('prices/' + enc(PRICE_IDS.monthly))
      ]);
      const singleValid = validCatalogPrice(singlePrice, 'single', live());
      const monthlyValid = validCatalogPrice(monthlyPrice, 'monthly', live());
      if (!singleValid || !monthlyValid) {
        return {
          checkoutReady: false,
          code: 'PRICE_VALIDATION_FAILED',
          singleValid,
          monthlyValid,
          catalog: CATALOG
        };
      }
      await portalConfiguration();
      return {
        checkoutReady: true,
        code: 'COMPETITOR_INTELLIGENCE_READY',
        priceIds: PRICE_IDS,
        catalog: CATALOG
      };
    } catch (err) {
      return {
        checkoutReady: false,
        code: err.code || 'CONFIGURATION_CHECK_FAILED',
        message: err.message || 'Competitor Intelligence configuration requires review.',
        catalog: CATALOG
      };
    }
  }

  async function chargeProof(expectedCustomer, intentId, amount) {
    if (!safeId(intentId, 'pi_')) throw fail(409, 'Full payment has not been verified yet.');
    const pi = await stripe('payment_intents/' + enc(intentId) + '?expand%5B%5D=latest_charge');
    if (
      pi.id !== intentId ||
      pi.livemode !== live() ||
      pi.status !== 'succeeded' ||
      pi.currency !== 'usd' ||
      pi.amount !== amount ||
      pi.amount_received !== amount ||
      (expectedCustomer && idOf(pi.customer) !== expectedCustomer)
    ) {
      throw fail(409, 'Full payment could not be verified.');
    }
    const charge = typeof pi.latest_charge === 'object' && pi.latest_charge
      ? pi.latest_charge
      : await stripe('charges/' + enc(idOf(pi.latest_charge) || ''));
    if (
      !safeId(charge?.id, 'ch_') ||
      charge.livemode !== live() ||
      charge.paid !== true ||
      charge.status !== 'succeeded' ||
      charge.currency !== 'usd' ||
      charge.amount !== amount ||
      idOf(charge.payment_intent) !== intentId
    ) {
      throw fail(409, 'Payment charge record requires review.');
    }
    if (charge.refunded || charge.amount_refunded > 0 || charge.disputed || charge.dispute) {
      await rpc('geo_competitor_set_hold', { p_charge: charge.id, p_subscription: null, p_hold: true });
      throw fail(409, 'This payment is on hold due to a refund or dispute. Existing saved reports remain available.');
    }
    return charge;
  }

  async function invoiceProof(expectedCustomer, subscriptionId, invoiceId) {
    if (!safeId(invoiceId, 'in_')) throw fail(409, 'A paid monthly invoice is required.');
    const inv = await stripe('invoices/' + enc(invoiceId));
    if (
      inv.livemode !== live() ||
      inv.status !== 'paid' ||
      inv.paid !== true ||
      inv.paid_out_of_band === true ||
      inv.currency !== 'usd' ||
      inv.amount_paid !== 4600 ||
      inv.amount_due !== 4600 ||
      (expectedCustomer && idOf(inv.customer) !== expectedCustomer) ||
      (subscriptionId && idOf(inv.subscription) !== subscriptionId) ||
      !['subscription_create', 'subscription_cycle'].includes(inv.billing_reason)
    ) {
      throw fail(409, 'Monthly subscription invoice could not be verified.');
    }
    const lines = await stripe('invoices/' + enc(invoiceId) + '/lines?limit=2');
    const line = lines.data?.[0];
    if (
      lines.has_more ||
      lines.data?.length !== 1 ||
      line.quantity !== 1 ||
      idOf(line.price) !== PRICE_IDS.monthly ||
      line.proration === true ||
      line.amount !== 4600 ||
      !Number.isFinite(line.period?.start) ||
      !Number.isFinite(line.period?.end) ||
      line.period.end <= line.period.start
    ) {
      throw fail(409, 'Monthly subscription line item requires review.');
    }
    const charge = await chargeProof(idOf(inv.customer), idOf(inv.payment_intent), 4600);
    return {
      reference: inv.id,
      intent: idOf(inv.payment_intent),
      charge: charge.id,
      customer: idOf(inv.customer),
      start: new Date(line.period.start * 1000).toISOString(),
      end: new Date(line.period.end * 1000).toISOString()
    };
  }

  async function verifyCheckoutSession(sessionId, expectedUserId = null) {
    if (!safeId(sessionId, 'cs_')) throw fail(400, 'Invalid checkout session identifier.');
    const session = await stripe('checkout/sessions/' + enc(sessionId));
    if (session.id !== sessionId || session.livemode !== live() || session.metadata?.purchase_kind !== KIND) {
      throw fail(403, 'This checkout session does not belong to Competitor Intelligence.');
    }
    const userId = session.metadata?.competitor_user_id;
    const plan = session.metadata?.competitor_plan;
    if (!UUID.test(userId || '') || !['single', 'monthly'].includes(plan)) {
      throw fail(403, 'Checkout metadata is incomplete.');
    }
    if (expectedUserId && userId !== expectedUserId) {
      throw fail(403, 'This checkout belongs to a different account.');
    }
    const expectedAmount = CATALOG[plan].unitAmount;
    if (
      session.mode !== CATALOG[plan].mode ||
      session.currency !== 'usd' ||
      session.amount_total !== expectedAmount
    ) {
      throw fail(409, 'Checkout amount or mode did not match the selected package.');
    }
    if (session.status !== 'complete' || session.payment_status !== 'paid') {
      return { paid: false, status: session.status || 'open' };
    }

    const lines = await stripe('checkout/sessions/' + enc(sessionId) + '/line_items?limit=2');
    const line = lines.data?.[0];
    const price = line?.price;
    if (
      lines.has_more ||
      lines.data?.length !== 1 ||
      line.quantity !== 1 ||
      !validCatalogPrice(price, plan, live(), false)
    ) {
      throw fail(409, 'Purchased line item requires review.');
    }

    const customerId = idOf(session.customer);
    if (!safeId(customerId, 'cus_')) throw fail(409, 'Stripe customer record is missing.');

    if (plan === 'monthly') {
      const subId = idOf(session.subscription);
      const sub = await stripe('subscriptions/' + enc(subId || ''));
      if (
        !safeId(sub?.id, 'sub_') ||
        sub.livemode !== live() ||
        sub.metadata?.purchase_kind !== KIND ||
        sub.metadata?.competitor_user_id !== userId ||
        idOf(sub.customer) !== customerId ||
        sub.status === 'trialing'
      ) {
        throw fail(409, 'Monthly subscription record requires review.');
      }
      const proof = await invoiceProof(customerId, sub.id, idOf(session.invoice));
      const ent = await rpc('geo_competitor_record_entitlement', {
        p_user: userId,
        p_plan: 'monthly',
        p_price_id: PRICE_IDS.monthly,
        p_livemode: live(),
        p_amount: 4600,
        p_session_id: session.id,
        p_customer_id: customerId,
        p_subscription_id: sub.id,
        p_reference: proof.reference,
        p_intent: proof.intent,
        p_charge: proof.charge,
        p_cancel_end: !!sub.cancel_at_period_end,
        p_start: proof.start,
        p_end: proof.end
      });
      return { paid: true, plan: 'monthly', entitlementId: ent?.id };
    }

    const intentId = idOf(session.payment_intent);
    const ch = await chargeProof(customerId, intentId, 2600);
    const ent = await rpc('geo_competitor_record_entitlement', {
      p_user: userId,
      p_plan: 'single',
      p_price_id: PRICE_IDS.single,
      p_livemode: live(),
      p_amount: 2600,
      p_session_id: session.id,
      p_customer_id: customerId,
      p_subscription_id: null,
      p_reference: session.id,
      p_intent: intentId,
      p_charge: ch.id,
      p_cancel_end: false,
      p_start: null,
      p_end: null
    });
    return { paid: true, plan: 'single', entitlementId: ent?.id };
  }

  async function createCheckout(u, body) {
    ensurePaymentsEnabled();
    const plan = body.plan;
    if (!['single', 'monthly'].includes(plan)) {
      throw fail(400, 'Choose Competitive Monitor Monthly ($46/month) or Single Report ($26 one time).');
    }
    const attemptId = String(body.attemptId || '').trim();
    if (!UUID.test(attemptId)) throw fail(400, 'Refresh the page and try again.');

    let cleanTarget = null;
    if (body.targetUrl && String(body.targetUrl).trim()) {
      cleanTarget = normalURL(body.targetUrl).origin;
    }

    const price = await stripe('prices/' + enc(PRICE_IDS[plan]));
    if (!validCatalogPrice(price, plan, live())) {
      throw fail(503, 'The configured Stripe price did not pass verification. No charge was created.');
    }
    if (plan === 'monthly') await portalConfiguration();

    const existingAttempt = await one(`geo_competitor_checkouts?user_id=eq.${u.id}&attempt_id=eq.${attemptId}&limit=1`);
    if (existingAttempt?.session_id) {
      const s = await stripe('checkout/sessions/' + enc(existingAttempt.session_id));
      if (s.status === 'open' && typeof s.url === 'string') {
        return { url: s.url, checkoutId: existingAttempt.id };
      }
      if (s.status === 'complete') {
        await verifyCheckoutSession(existingAttempt.session_id, u.id);
        return { alreadyPaid: true, checkoutId: existingAttempt.id };
      }
    }

    const priorEnt = await one(`geo_competitor_entitlements?user_id=eq.${u.id}&livemode=eq.${live()}&order=created_at.desc&limit=1`);
    const existingCustomer = safeId(priorEnt?.customer_id, 'cus_') ? priorEnt.customer_id : null;

    let rec = existingAttempt;
    if (!rec) {
      const inserted = await db('geo_competitor_checkouts', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: {
          user_id: u.id,
          attempt_id: attemptId,
          plan,
          price_id: PRICE_IDS[plan],
          amount: CATALOG[plan].unitAmount,
          target_url: cleanTarget,
          livemode: live(),
          state: 'open'
        }
      });
      rec = inserted[0];
    }

    const site = siteOrigin();
    const meta = {
      purchase_kind: KIND,
      competitor_checkout_id: rec.id,
      competitor_user_id: u.id,
      competitor_plan: plan
    };
    const data = {
      mode: CATALOG[plan].mode,
      client_reference_id: rec.id,
      'payment_method_types[0]': 'card',
      'line_items[0][price]': PRICE_IDS[plan],
      'line_items[0][quantity]': 1,
      allow_promotion_codes: false,
      success_url: `${site}/competitor-intelligence/?checkout=success&checkout_id=${rec.id}&session_id={CHECKOUT_SESSION_ID}#workspace`,
      cancel_url: `${site}/competitor-intelligence/?checkout=cancelled#pricing`,
      'custom_text[submit][message]': plan === 'monthly'
        ? 'Includes 3 competitor intelligence reports per paid month (up to 8 competitors and 25 pages each). Cancel any time at period end.'
        : 'Includes 1 competitor intelligence report (up to 5 competitors, capped at 25 pages). One-time charge only.'
    };
    if (existingCustomer) {
      data.customer = existingCustomer;
    } else {
      data.customer_email = u.email;
      if (plan === 'single') data.customer_creation = 'always';
    }
    const subKey = plan === 'monthly' ? 'subscription_data' : 'payment_intent_data';
    for (const [k, v] of Object.entries(meta)) {
      data[`metadata[${k}]`] = v;
      data[`${subKey}[metadata][${k}]`] = v;
    }

    const session = await stripe('checkout/sessions', {
      method: 'POST',
      data,
      idempotency: `competitor-checkout-v1:${rec.id}`
    });
    if (!safeId(session?.id, 'cs_') || session.livemode !== live()) {
      throw fail(503, 'Stripe checkout session could not be verified.');
    }
    let targetHref;
    try {
      const parsed = new URL(session.url);
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'checkout.stripe.com' || parsed.port) throw new Error();
      targetHref = parsed.href;
    } catch {
      throw fail(503, 'Stripe checkout redirect URL could not be verified.');
    }

    await db(`geo_competitor_checkouts?id=eq.${rec.id}`, {
      method: 'PATCH',
      body: { session_id: session.id, checkout_url: targetHref, updated_at: new Date(now()).toISOString() }
    });
    return { url: targetHref, checkoutId: rec.id };
  }

  async function workspaceState(u) {
    const isLive = live();
    const entitlements = (await db(
      `geo_competitor_entitlements?user_id=eq.${u.id}&livemode=eq.${isLive}&order=created_at.desc&limit=20`
    )) || [];
    const reports = (await db(
      `geo_competitor_reports?user_id=eq.${u.id}&select=id,plan,target_url,target_domain,competitor_urls,status,progress,error_message,page_count,created_at,completed_at&order=created_at.desc&limit=25`
    )) || [];

    const nowMs = now();
    let remainingRuns = 0;
    let maxCompetitors = 0;
    let hasMonthlyPortal = false;
    let activePlan = null;
    let hasHold = false;
    let periodEnd = null;
    let cancelAtPeriodEnd = false;

    for (const e of entitlements) {
      if (e.plan === 'monthly' && safeId(e.customer_id, 'cus_')) hasMonthlyPortal = true;
      if (e.state === 'hold' && e.used_runs < e.allowance_runs) hasHold = true;
      const validPeriod = e.plan === 'single' || !e.period_end || Date.parse(e.period_end) > nowMs;
      if (e.state === 'active' && validPeriod && e.used_runs < e.allowance_runs) {
        remainingRuns += (e.allowance_runs - e.used_runs);
        maxCompetitors = Math.max(maxCompetitors, e.max_competitors);
        if (!activePlan || e.plan === 'monthly') {
          activePlan = e.plan;
          if (e.plan === 'monthly') {
            periodEnd = e.period_end;
            cancelAtPeriodEnd = !!e.cancel_at_period_end;
          }
        }
      }
    }

    return {
      user: { id: u.id, email: u.email },
      summary: {
        remainingRuns,
        maxCompetitors: maxCompetitors || 5,
        activePlan,
        hasMonthlyPortal,
        hasHold,
        periodEnd,
        cancelAtPeriodEnd
      },
      catalog: CATALOG,
      reports
    };
  }

  async function startReport(u, body) {
    const requestId = String(body.requestId || '').trim();
    if (!UUID.test(requestId)) throw fail(400, 'Invalid report request identifier.');

    let target;
    try {
      target = normalURL(body.targetUrl);
    } catch (err) {
      throw fail(400, err.message || 'Enter a valid public HTTPS website URL.');
    }
    const targetDomain = target.hostname.replace(/^www\./i, '').toLowerCase();

    const rawCompetitors = Array.isArray(body.competitorUrls) ? body.competitorUrls : [];
    const seenDomains = new Set([targetDomain]);
    const cleanCompetitors = [];
    for (const item of rawCompetitors) {
      const s = String(item || '').trim();
      if (!s) continue;
      let cu;
      try {
        cu = normalURL(s);
      } catch (err) {
        throw fail(400, `Competitor URL "${s.slice(0, 60)}": ${err.message}`);
      }
      const cDom = cu.hostname.replace(/^www\./i, '').toLowerCase();
      if (cDom === targetDomain) {
        throw fail(400, 'Competitor URLs must be different domains from your own website.');
      }
      if (!seenDomains.has(cDom)) {
        seenDomains.add(cDom);
        cleanCompetitors.push(cu.origin);
      }
    }

    if (!cleanCompetitors.length) {
      throw fail(400, 'Enter at least 1 competitor website URL to compare against your site.');
    }
    if (cleanCompetitors.length > 8) {
      throw fail(400, 'A maximum of 8 competitors can be included in a single report.');
    }

    const reservation = await rpc('geo_competitor_reserve_report', {
      p_user: u.id,
      p_request: requestId,
      p_url: target.origin,
      p_domain: targetDomain,
      p_competitors: cleanCompetitors,
      p_livemode: live()
    });

    if (!reservation?.allowed) {
      const reason = reservation?.reason;
      if (reason === 'report_running') {
        throw fail(409, 'A competitor report is already running for your account. Wait for it to finish below.');
      }
      if (reason === 'billing_hold') {
        throw fail(402, 'New report runs are paused due to a payment review or hold. Your saved reports remain available.');
      }
      if (reason === 'competitor_limit_exceeded') {
        throw fail(400, `Your active package includes up to ${reservation.maxCompetitors} competitors per report.`);
      }
      throw fail(402, 'Select a Competitor Intelligence package ($26 single report or $46/month) to run a full report.');
    }

    if (reservation.status === 'queued' && dispatchBackground) {
      await dispatchBackground(reservation.id);
    }

    return reservation;
  }

  async function openBillingPortal(u) {
    const ent = await one(
      `geo_competitor_entitlements?user_id=eq.${u.id}&livemode=eq.${live()}&plan=eq.monthly&order=created_at.desc&limit=1`
    );
    if (!safeId(ent?.customer_id, 'cus_')) {
      throw fail(400, 'No monthly Competitive Monitor billing record was found on this account.');
    }
    const configuration = await portalConfiguration();
    const portal = await stripe('billing_portal/sessions', {
      method: 'POST',
      data: {
        customer: ent.customer_id,
        configuration,
        return_url: `${siteOrigin()}/competitor-intelligence/#workspace`
      }
    });
    const parsed = new URL(portal.url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'billing.stripe.com') {
      throw fail(503, 'Stripe Billing Portal URL could not be verified.');
    }
    return { url: parsed.href };
  }

  async function webhook(event) {
    const obj = event.data?.object || {};
    let matched = obj.metadata?.purchase_kind === KIND || obj.subscription_details?.metadata?.purchase_kind === KIND;
    let sub = null;
    let relatedEnt = null;

    if (!matched && safeId(idOf(obj.subscription), 'sub_')) {
      relatedEnt = await one(`geo_competitor_entitlements?subscription_id=eq.${enc(idOf(obj.subscription))}&limit=1`);
      if (relatedEnt) matched = true;
      else {
        try {
          sub = await stripe('subscriptions/' + enc(idOf(obj.subscription)));
          if (sub?.metadata?.purchase_kind === KIND) matched = true;
        } catch {}
      }
    }

    if (!matched && obj.object === 'subscription' && safeId(obj.id, 'sub_')) {
      relatedEnt = await one(`geo_competitor_entitlements?subscription_id=eq.${enc(obj.id)}&limit=1`);
      if (relatedEnt) matched = true;
    }

    const chargeId = obj.object === 'charge' ? obj.id : idOf(obj.charge);
    if (!matched && safeId(chargeId, 'ch_')) {
      relatedEnt = await one(`geo_competitor_entitlements?charge_id=eq.${enc(chargeId)}&limit=1`);
      if (relatedEnt) matched = true;
    }

    if (!matched && obj.object === 'checkout.session' && safeId(obj.id, 'cs_')) {
      const chk = await one(`geo_competitor_checkouts?session_id=eq.${enc(obj.id)}&limit=1`);
      if (chk) matched = true;
    }

    if (!matched) return false;
    if (event.livemode !== live()) throw fail(409, 'Stripe webhook livemode mismatch.');
    if (await one(`geo_competitor_webhook_events?id=eq.${enc(event.id)}&limit=1`)) return true;

    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      await verifyCheckoutSession(obj.id);
    } else if (event.type === 'checkout.session.expired') {
      await db(`geo_competitor_checkouts?session_id=eq.${enc(obj.id)}&state=eq.open`, {
        method: 'PATCH',
        body: { state: 'expired', updated_at: new Date(now()).toISOString() }
      });
    } else if (event.type === 'invoice.paid') {
      const subId = idOf(obj.subscription);
      if (!sub && safeId(subId, 'sub_')) sub = await stripe('subscriptions/' + enc(subId));
      const userId = sub?.metadata?.competitor_user_id || relatedEnt?.user_id;
      const customerId = idOf(obj.customer) || relatedEnt?.customer_id;
      if (UUID.test(userId || '') && safeId(customerId, 'cus_') && safeId(subId, 'sub_')) {
        const proof = await invoiceProof(customerId, subId, obj.id);
        await rpc('geo_competitor_record_entitlement', {
          p_user: userId,
          p_plan: 'monthly',
          p_price_id: PRICE_IDS.monthly,
          p_livemode: live(),
          p_amount: 4600,
          p_session_id: null,
          p_customer_id: customerId,
          p_subscription_id: subId,
          p_reference: proof.reference,
          p_intent: proof.intent,
          p_charge: proof.charge,
          p_cancel_end: !!sub?.cancel_at_period_end,
          p_start: proof.start,
          p_end: proof.end
        });
      }
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const cancelEnd = event.type === 'customer.subscription.deleted' ? true : !!obj.cancel_at_period_end;
      await db(`geo_competitor_entitlements?subscription_id=eq.${enc(obj.id)}`, {
        method: 'PATCH',
        body: {
          cancel_at_period_end: cancelEnd,
          ...(event.type === 'customer.subscription.deleted' && obj.status === 'canceled' && obj.ended_at && obj.ended_at * 1000 <= now()
            ? { state: 'expired' }
            : {}),
          updated_at: new Date(now()).toISOString()
        }
      });
    } else if (['charge.refunded', 'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed'].includes(event.type)) {
      const ch = await stripe('charges/' + enc(chargeId));
      const ent = relatedEnt || (await one(`geo_competitor_entitlements?charge_id=eq.${enc(ch.id)}&limit=1`));
      if (event.type === 'charge.dispute.closed' && obj.status === 'won' && !ch.refunded && !(ch.amount_refunded > 0)) {
        await rpc('geo_competitor_set_hold', { p_charge: ch.id, p_subscription: null, p_hold: false });
      } else if (ch.refunded || ch.amount_refunded > 0 || ch.disputed || ch.dispute) {
        await rpc('geo_competitor_set_hold', { p_charge: ch.id, p_subscription: ent?.subscription_id || null, p_hold: true });
        if (safeId(ent?.subscription_id, 'sub_')) {
          await stripe('subscriptions/' + enc(ent.subscription_id), {
            method: 'POST',
            data: { cancel_at_period_end: true },
            idempotency: `competitor-hold:${event.id}`
          });
        }
      }
    }

    await db('geo_competitor_webhook_events?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: { id: event.id, event_type: event.type }
    });
    return true;
  }

  async function handler(event) {
    try {
      const query = event.queryStringParameters || {};
      const action = query.action || 'status';

      if (event.httpMethod === 'GET') {
        if (action === 'status') {
          return jsonReply(200, await statusCheck());
        }
        if (action === 'pdf') {
          const reportId = String(query.id || '').trim();
          if (!UUID.test(reportId)) throw fail(400, 'Invalid report identifier.');
          let userId = null;
          if (query.ticket && UUID.test(query.uid || '')) {
            if (!verifyTicket(reportId, query.uid, query.ticket)) {
              throw fail(403, 'This PDF download link has expired. Click Download PDF again.');
            }
            userId = query.uid;
          } else {
            const u = await authUser(event);
            userId = u.id;
          }
          const row = await one(`geo_competitor_reports?id=eq.${reportId}&user_id=eq.${userId}&limit=1`);
          if (!row || row.status !== 'completed' || !row.report) {
            throw fail(404, 'Completed report not found.');
          }
          const { bytes } = buildCompetitorPdf(row.report, { domain: row.target_domain, createdAt: row.completed_at || row.created_at });
          const safeDomain = String(row.target_domain || 'website').replace(/[^a-z0-9.-]+/gi, '-').slice(0, 60);
          return {
            statusCode: 200,
            isBase64Encoded: true,
            headers: {
              'Content-Type': 'application/pdf',
              'Content-Disposition': `attachment; filename="aeogeo-competitor-report-${safeDomain}.pdf"`,
              'Cache-Control': 'no-store, private',
              'X-Content-Type-Options': 'nosniff',
              'Referrer-Policy': 'no-referrer'
            },
            body: bytes.toString('base64')
          };
        }

        const u = await authUser(event);
        if (action === 'workspace') {
          return jsonReply(200, await workspaceState(u));
        }
        if (action === 'report') {
          const reportId = String(query.id || '').trim();
          if (!UUID.test(reportId)) throw fail(400, 'Invalid report identifier.');
          const row = await one(`geo_competitor_reports?id=eq.${reportId}&user_id=eq.${u.id}&limit=1`);
          if (!row) throw fail(404, 'Report not found.');
          return jsonReply(200, row);
        }
        throw fail(404, 'Unknown Competitor Intelligence action.');
      }

      if (event.httpMethod !== 'POST') {
        throw fail(405, 'Method not allowed.');
      }
      if ((event.body || '').length > 64000) {
        throw fail(413, 'Request payload is too large.');
      }
      let body;
      try {
        body = JSON.parse(event.body || '{}');
      } catch {
        throw fail(400, 'Invalid JSON request.');
      }

      const u = await authUser(event);
      if (action === 'checkout') {
        return jsonReply(200, await createCheckout(u, body));
      }
      if (action === 'verify-checkout') {
        const res = await verifyCheckoutSession(String(body.sessionId || '').trim(), u.id);
        return jsonReply(200, res);
      }
      if (action === 'portal') {
        return jsonReply(200, await openBillingPortal(u));
      }
      if (action === 'start-report') {
        return jsonReply(202, await startReport(u, body));
      }
      if (action === 'pdf-ticket') {
        const reportId = String(body.id || '').trim();
        if (!UUID.test(reportId)) throw fail(400, 'Invalid report identifier.');
        const row = await one(`geo_competitor_reports?id=eq.${reportId}&user_id=eq.${u.id}&select=id,status&limit=1`);
        if (!row || row.status !== 'completed') throw fail(404, 'Completed report not found.');
        const exp = Math.floor(now() / 1000) + 300;
        const ticket = signTicket(reportId, u.id, exp);
        return jsonReply(200, {
          url: `/.netlify/functions/competitor-intelligence?action=pdf&id=${enc(reportId)}&uid=${enc(u.id)}&ticket=${enc(ticket)}`
        });
      }

      throw fail(404, 'Unknown Competitor Intelligence action.');
    } catch (err) {
      return jsonReply(err.status || 503, {
        error: err.status ? err.message : 'Competitor Intelligence could not complete this request. Your saved reports remain intact.'
      });
    }
  }

  return { handler, webhook, statusCheck, verifyCheckoutSession, signTicket, verifyTicket };
}

let configuredInstance = null;
function configuredCompetitorIntelligence() {
  if (configuredInstance) return configuredInstance;
  const { stripe, origin } = require('./stripe');
  const { db, user, signature } = require('./db');
  const { requireStripeCredential } = require('./stripe-credential');
  const { validatePortalConfiguration } = require('./portal-policy');
  const { normalURL } = require('./crawler');

  configuredInstance = createCompetitorIntelligence({
    stripe,
    db,
    authUser: user,
    credential: requireStripeCredential,
    normalURL,
    portalConfiguration: async () => {
      let config;
      if (process.env.STRIPE_SERVICE_PORTAL_CONFIGURATION_ID) {
        config = await stripe('billing_portal/configurations/' + enc(process.env.STRIPE_SERVICE_PORTAL_CONFIGURATION_ID));
      } else {
        const list = await stripe('billing_portal/configurations?is_default=true&active=true&limit=10');
        config = list.data?.find(x => x.active && x.is_default);
      }
      const ret = config?.default_return_url || config?.business_profile?.default_return_url;
      if (ret && new URL(ret).origin !== 'https://aeogeosearch.com') {
        throw fail(503, 'Billing portal return URL belongs to a different domain.');
      }
      return validatePortalConfiguration(config, requireStripeCredential().mode === 'live');
    },
    dispatchBackground: async reportId => {
      const time = String(Date.now());
      const site = origin().replace(/\/$/, '');
      try {
        const r = await fetch(`${site}/.netlify/functions/run-competitor-report-background`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Audit-Time': time,
            'X-Audit-Signature': signature(reportId, time)
          },
          body: JSON.stringify({ id: reportId }),
          signal: AbortSignal.timeout(12000)
        });
        if (!r.ok) console.warn('Competitor background dispatch HTTP', r.status, reportId);
      } catch (e) {
        console.warn('Competitor background dispatch warning', reportId, e.message);
      }
    }
  });
  return configuredInstance;
}

module.exports = {
  createCompetitorIntelligence,
  configuredCompetitorIntelligence,
  KIND,
  PRICE_IDS,
  CATALOG,
  validCatalogPrice
};
