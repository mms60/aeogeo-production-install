/*
 * Backend verification harness for the AI Visibility & Schema Studio paid path.
 * Runs the real Netlify handlers with fake Supabase/Stripe transports so each
 * authorization, entitlement and plan-limit branch can be exercised without a
 * live charge. No production credentials are used.
 */
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const SUPA = "https://fixture.supabase.co";
process.env.SUPABASE_URL = SUPA;
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_fixture_only";
process.env.SUPABASE_ANON_KEY = "sb_publishable_fixture_only";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture_only";
process.env.STRIPE_SECRET_KEY = "sk_live_fixture_only";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_fixture_only";
process.env.PUBLIC_SITE_URL = "https://aeogeosearch.com";

const U = {
  unpaid: { id: "11111111-1111-4111-8111-111111111111", email: "unpaid@example.com" },
  single: { id: "22222222-2222-4222-8222-222222222222", email: "single@example.com" },
  multi: { id: "33333333-3333-4333-8333-333333333333", email: "multi@example.com" },
  other: { id: "44444444-4444-4444-8444-444444444444", email: "other@example.com" }
};
for (const user of Object.values(U)) user.email_confirmed_at = "2026-01-01T00:00:00.000Z";

const TOKENS = {
  "token-unpaid": U.unpaid,
  "token-single": U.single,
  "token-multi": U.multi,
  "token-other": U.other
};

const PRICES = {
  price_1Uc6kWBIJX5f6WmhvQeqzs7o: { product: "prod_VdNVizBmTfDoqH", amount: 79900, plan: "single" },
  price_1Uc6ksBIJX5f6WmhHI94dIms: { product: "prod_VdNVrX9bS9IVPF", amount: 119900, plan: "multi" }
};

const state = {
  purchases: [],
  requests: [],
  session: null,
  sessionLookup: null
};

function headerOf(init, name) {
  const headers = init.headers || {};
  if (typeof headers.get === "function") return headers.get(name) || "";
  const key = Object.keys(headers).find(item => item.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key]) : "";
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function filterRows(url) {
  let rows = state.purchases.slice();
  for (const [key, value] of url.searchParams) {
    if (key === "select" || key === "order" || key === "on_conflict") continue;
    if (value.startsWith("eq.")) {
      const expected = value.slice(3);
      rows = rows.filter(row => String(row[key]) === expected);
    } else if (value === "is.null") {
      rows = rows.filter(row => row[key] === null || row[key] === undefined);
    }
  }
  return rows;
}

async function supabaseRoute(url, method, init) {
  if (url.pathname === "/auth/v1/user") {
    const token = headerOf(init, "authorization").replace(/^Bearer\s+/i, "");
    const user = TOKENS[token];
    return user ? jsonResponse(user) : jsonResponse({ message: "invalid JWT" }, 401);
  }

  if (url.pathname === "/rest/v1/entity_purchases") {
    if (method === "GET") return jsonResponse(filterRows(url));
    if (method === "POST") {
      const rows = JSON.parse(init.body || "[]");
      for (const row of rows) {
        const existing = state.purchases.find(item => item.stripe_session_id === row.stripe_session_id);
        if (existing) Object.assign(existing, row);
        else state.purchases.push({ created_at: new Date().toISOString(), ...row });
      }
      return new Response("", { status: 201 });
    }
    if (method === "PATCH") {
      const rows = filterRows(url);
      const patch = JSON.parse(init.body || "{}");
      for (const row of rows) Object.assign(row, patch);
      return jsonResponse(rows);
    }
  }

  throw new Error("Unexpected Supabase request: " + method + " " + url.pathname + url.search);
}

async function stripeRoute(url, method, init) {
  const form = init.body ? new URLSearchParams(String(init.body)) : new URLSearchParams();

  if (method === "GET" && url.pathname.startsWith("/v1/prices/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const price = PRICES[id];
    if (!price) return jsonResponse({ error: { message: "No such price" } }, 404);
    return jsonResponse({
      id,
      product: price.product,
      active: true,
      livemode: true,
      type: "one_time",
      currency: "usd",
      unit_amount: price.amount,
      billing_scheme: "per_unit",
      recurring: null,
      custom_unit_amount: null,
      transform_quantity: null
    });
  }

  if (method === "POST" && url.pathname === "/v1/coupons") {
    return jsonResponse({ id: "coupon_fixture" });
  }

  if (method === "POST" && url.pathname === "/v1/checkout/sessions") {
    const priceId = form.get("line_items[0][price]");
    const price = PRICES[priceId];
    const coupon = form.get("discounts[0][coupon]");
    const amount = coupon ? price.amount - 79900 : price.amount;
    return jsonResponse({
      id: "cs_live_fixture_session",
      url: "https://checkout.stripe.com/c/pay/cs_live_fixture_session",
      mode: "payment",
      livemode: true,
      currency: "usd",
      amount_total: amount
    });
  }

  if (method === "GET" && /^\/v1\/checkout\/sessions\/[^/]+$/.test(url.pathname)) {
    return jsonResponse(state.sessionLookup);
  }

  if (method === "GET" && url.pathname.endsWith("/line_items")) {
    const plan = state.sessionLookup?.metadata?.plan;
    const priceId = plan === "multi" ? "price_1Uc6ksBIJX5f6WmhHI94dIms" : "price_1Uc6kWBIJX5f6WmhvQeqzs7o";
    return jsonResponse({ has_more: false, data: [{ quantity: 1, price: { id: priceId } }] });
  }

  throw new Error("Unexpected Stripe request: " + method + " " + url.pathname);
}

const realFetch = global.fetch;
global.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const method = String(init.method || "GET").toUpperCase();
  state.requests.push({ href: url.href, method, pathname: url.pathname });
  if (url.origin === SUPA) return supabaseRoute(url, method, init);
  if (url.origin === "https://api.stripe.com") return stripeRoute(url, method, init);
  throw new Error("Unexpected external request: " + method + " " + url.href);
};

const impl = (await import("../netlify/functions/entity-implementation.mjs")).default;
const entitlement = (await import("../netlify/functions/entity-entitlement.mjs")).default;
const claim = (await import("../netlify/functions/entity-purchase-claim.mjs")).default;
const checkout = require("../netlify/functions/entity-authority-checkout.js");
const purchases = require("../netlify/functions/lib/entity-purchases.js");
const { verifyWebhook } = require("../netlify/functions/lib/stripe.js");

async function invoke(handler, event) {
  const response = await handler(event);
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
}

function eventFor(token, body, method = "POST") {
  const raw = JSON.stringify(body ?? {});
  return {
    method,
    headers: token ? { authorization: "Bearer " + token } : {},
    body: raw,
    text: async () => raw
  };
}

function checkoutEvent(token, body) {
  return {
    httpMethod: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: JSON.stringify(body || {})
  };
}

function inputFor(locations, people = 1, services = 1) {
  return {
    domain: "https://examplebrand.com",
    brandName: "Example Brand",
    description: "A verified example brand used for gate verification.",
    locations: Array.from({ length: locations }, (_, i) => ({ name: "Office " + (i + 1), slug: "office-" + (i + 1) })),
    people: Array.from({ length: people }, (_, i) => ({ name: "Person " + (i + 1), slug: "person-" + (i + 1) })),
    services: Array.from({ length: services }, (_, i) => ({ name: "Service " + (i + 1), slug: "service-" + (i + 1) }))
  };
}

const results = [];
async function check(name, fn) {
  state.requests.length = 0;
  try {
    await fn();
    results.push({ name, ok: true });
    console.log("PASS  " + name);
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    console.log("FAIL  " + name + "\n      " + error.message);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function noJsonLd(body, label) {
  assert(!body || !("jsonLd" in body), label + " returned jsonLd");
  assert(!JSON.stringify(body || {}).includes("@graph"), label + " returned a graph");
}

// ---------------------------------------------------------------- no account
await check("implementation: no Authorization header is rejected before any database read", async () => {
  const response = await invoke(impl, eventFor(null, { input: inputFor(1) }));
  assert(response.status === 401, "expected 401, got " + response.status);
  assert(response.body.code === "SIGN_IN_REQUIRED", "expected SIGN_IN_REQUIRED");
  noJsonLd(response.body, "unauthenticated call");
  assert(!state.requests.some(r => r.pathname === "/rest/v1/entity_purchases"), "entitlement table was read without auth");
});

await check("implementation: forged bearer token is rejected", async () => {
  const response = await invoke(impl, eventFor("forged-token", { input: inputFor(1) }));
  assert(response.status === 401, "expected 401, got " + response.status);
  noJsonLd(response.body, "forged token");
});

await check("implementation: GET is refused", async () => {
  const response = await invoke(impl, eventFor("token-single", null, "GET"));
  assert(response.status === 405, "expected 405, got " + response.status);
});

await check("entitlement: signed-out request is refused", async () => {
  const response = await invoke(entitlement, eventFor(null, {}));
  assert(response.status === 401, "expected 401, got " + response.status);
});

await check("claim: signed-out request is refused", async () => {
  const response = await invoke(claim, eventFor(null, { sessionId: "cs_live_abcdefgh" }));
  assert(response.status === 401, "expected 401, got " + response.status);
});

// --------------------------------------------------------------- no purchase
state.purchases = [];
await check("implementation: valid unpaid account gets 403 and no graph", async () => {
  const response = await invoke(impl, eventFor("token-unpaid", { input: inputFor(1) }));
  assert(response.status === 403, "expected 403, got " + response.status);
  assert(response.body.code === "PURCHASE_REQUIRED", "expected PURCHASE_REQUIRED");
  noJsonLd(response.body, "unpaid account");
});

await check("entitlement: unpaid account reports inactive", async () => {
  const response = await invoke(entitlement, eventFor("token-unpaid", {}));
  assert(response.status === 200 && response.body.active === false, "expected inactive entitlement");
});

// ----------------------------------------------------------- single purchased
state.purchases = [{ id: "p1", user_id: U.single.id, plan: "single", status: "paid", livemode: true, created_at: "2026-01-02T00:00:00Z" }];
await check("implementation: Single-Hub account generates a complete graph within its limits", async () => {
  const response = await invoke(impl, eventFor("token-single", { input: inputFor(3, 2, 2) }));
  assert(response.status === 200, "expected 200, got " + response.status + " " + JSON.stringify(response.body));
  assert(response.body.plan === "single", "server returned plan " + response.body.plan);
  assert(Array.isArray(response.body.jsonLd?.["@graph"]), "no @graph returned");
  assert(response.body.jsonLd["@graph"].length === 9, "expected 9 nodes, got " + response.body.jsonLd["@graph"].length);
  assert(Array.isArray(response.body.instructions) && response.body.instructions.length >= 5, "missing instructions");
  assert(Array.isArray(response.body.validation) && response.body.validation.length === 0, "graph failed validation");
  const org = response.body.jsonLd["@graph"].find(node => node["@type"] === "Organization");
  assert(org.name === "Example Brand", "custom brand facts were not compiled");
});

await check("implementation: Single-Hub account cannot exceed 3 locations", async () => {
  const response = await invoke(impl, eventFor("token-single", { input: inputFor(4, 2, 1) }));
  assert(response.status === 403, "expected 403, got " + response.status);
  assert(response.body.code === "PLAN_LOCATION_LIMIT", "expected PLAN_LOCATION_LIMIT");
  noJsonLd(response.body, "over-limit single account");
});

await check("implementation: Single-Hub account cannot exceed 2 people", async () => {
  const response = await invoke(impl, eventFor("token-single", { input: inputFor(1, 3, 1) }));
  assert(response.status === 403, "expected 403, got " + response.status);
  assert(response.body.code === "PLAN_PEOPLE_LIMIT", "expected PLAN_PEOPLE_LIMIT");
});

await check("implementation: forging plan=multi in the body does not raise the paid limits", async () => {
  const input = { ...inputFor(4, 1, 1), plan: "multi", upgrade: true };
  const response = await invoke(impl, eventFor("token-single", { input, plan: "multi", upgrade: true }));
  assert(response.status === 403, "expected 403, got " + response.status);
  assert(response.body.code === "PLAN_LOCATION_LIMIT", "expected the single-plan limit to still apply");
  noJsonLd(response.body, "forged plan selector");
});

await check("implementation: forged plan on valid input still returns the purchased plan and limits", async () => {
  const response = await invoke(impl, eventFor("token-single", { input: inputFor(3, 1, 1), plan: "multi" }));
  assert(response.status === 200, "expected 200, got " + response.status);
  assert(response.body.plan === "single", "expected plan single, got " + response.body.plan);
  assert(response.body.limits.locations === 3, "expected single limits, got " + JSON.stringify(response.body.limits));
});

// ------------------------------------------------------------ multi purchased
state.purchases = [{ id: "p2", user_id: U.multi.id, plan: "multi", status: "paid", livemode: true, created_at: "2026-01-03T00:00:00Z" }];
await check("implementation: Multi-Location account generates a 10-location, 6-person graph", async () => {
  const response = await invoke(impl, eventFor("token-multi", { input: inputFor(10, 6, 2) }));
  assert(response.status === 200, "expected 200, got " + response.status);
  assert(response.body.plan === "multi", "expected plan multi");
  assert(response.body.jsonLd["@graph"].length === 20, "expected 20 nodes, got " + response.body.jsonLd["@graph"].length);
});

await check("implementation: Multi-Location account is still bounded at 10 locations", async () => {
  const response = await invoke(impl, eventFor("token-multi", { input: inputFor(11, 1, 1) }));
  assert(response.status === 403, "expected 403, got " + response.status);
  assert(response.body.code === "PLAN_LOCATION_LIMIT", "expected PLAN_LOCATION_LIMIT");
});

await check("entitlement: Multi-Location account reports active multi", async () => {
  const response = await invoke(entitlement, eventFor("token-multi", {}));
  assert(response.status === 200 && response.body.active === true, "expected active entitlement");
  assert(response.body.plan === "multi", "expected multi plan");
});

await check("implementation: one account cannot use another account's purchase", async () => {
  const response = await invoke(impl, eventFor("token-other", { input: inputFor(1) }));
  assert(response.status === 403, "expected 403, got " + response.status);
  assert(response.body.code === "PURCHASE_REQUIRED", "expected PURCHASE_REQUIRED");
});

await check("implementation: revoked purchase removes access", async () => {
  state.purchases = [{ id: "p3", user_id: U.single.id, plan: "single", status: "revoked", livemode: true, created_at: "2026-01-04T00:00:00Z" }];
  const response = await invoke(impl, eventFor("token-single", { input: inputFor(1) }));
  assert(response.status === 403, "expected 403, got " + response.status);
  assert(response.body.code === "PURCHASE_REQUIRED", "expected PURCHASE_REQUIRED");
});

// ----------------------------------------------------------------- checkout
state.purchases = [];
await check("checkout: signed-out plan request is refused", async () => {
  const response = await checkout.handler(checkoutEvent(null, { plan: "single" }));
  assert(response.statusCode === 401, "expected 401, got " + response.statusCode);
  assert(JSON.parse(response.body).code === "SIGN_IN_REQUIRED", "expected SIGN_IN_REQUIRED");
});

await check("checkout: invalid plan is rejected before Stripe is contacted", async () => {
  const response = await checkout.handler(checkoutEvent("token-unpaid", { plan: "__proto__" }));
  assert(response.statusCode === 400, "expected 400, got " + response.statusCode);
  assert(!state.requests.some(r => r.href.startsWith("https://api.stripe.com")), "Stripe was contacted for an invalid plan");
});

await check("checkout: Single-Hub session is $799 and bound to the signed-in account", async () => {
  const response = await checkout.handler(checkoutEvent("token-unpaid", { plan: "single" }));
  assert(response.statusCode === 200, "expected 200, got " + response.statusCode + " " + response.body);
  assert(JSON.parse(response.body).url.startsWith("https://checkout.stripe.com/"), "unexpected checkout URL");
  const sessionRequest = state.requests.find(r => r.pathname === "/v1/checkout/sessions");
  assert(sessionRequest, "no Stripe session request");
});

await check("checkout: Multi-Location session is $1,199", async () => {
  const response = await checkout.handler(checkoutEvent("token-unpaid", { plan: "multi" }));
  assert(response.statusCode === 200, "expected 200, got " + response.statusCode);
});

await check("checkout: existing Single-Hub purchase blocks a second Single-Hub charge", async () => {
  state.purchases = [{ id: "p4", user_id: U.single.id, plan: "single", status: "paid", livemode: true, created_at: "2026-01-05T00:00:00Z" }];
  const response = await checkout.handler(checkoutEvent("token-single", { plan: "single" }));
  assert(response.statusCode === 409, "expected 409, got " + response.statusCode);
  assert(JSON.parse(response.body).code === "ALREADY_PURCHASED", "expected ALREADY_PURCHASED");
});

await check("checkout: existing Single-Hub purchase requires the $400 upgrade, not a full Multi charge", async () => {
  const response = await checkout.handler(checkoutEvent("token-single", { plan: "multi" }));
  assert(response.statusCode === 409, "expected 409, got " + response.statusCode);
  assert(JSON.parse(response.body).code === "UPGRADE_REQUIRED", "expected UPGRADE_REQUIRED");
});

await check("checkout: $400 upgrade is allowed only for a Single-Hub account", async () => {
  const allowed = await checkout.handler(checkoutEvent("token-single", { plan: "multi", upgrade: true }));
  assert(allowed.statusCode === 200, "expected 200 for single owner, got " + allowed.statusCode);
  const denied = await checkout.handler(checkoutEvent("token-unpaid", { plan: "multi", upgrade: true }));
  assert(denied.statusCode === 403, "expected 403 without a Single-Hub purchase, got " + denied.statusCode);
  assert(JSON.parse(denied.body).code === "UPGRADE_REQUIRES_SINGLE", "expected UPGRADE_REQUIRES_SINGLE");
});

// --------------------------------------------------------------- purchase claim
state.purchases = [];
state.sessionLookup = {
  object: "checkout.session",
  id: "cs_live_claimsession",
  mode: "payment",
  status: "complete",
  payment_status: "paid",
  livemode: true,
  currency: "usd",
  amount_total: 79900,
  metadata: { product: "entity-authority", plan: "single" },
  customer_details: { email: U.single.email },
  payment_intent: "pi_live_claim"
};
await check("claim: a purchased session is linked to the matching signed-in account", async () => {
  const response = await invoke(claim, eventFor("token-single", { sessionId: "cs_live_claimsession" }));
  assert(response.status === 200 && response.body.active === true, "expected claim to succeed: " + JSON.stringify(response.body));
  assert(response.body.plan === "single", "expected single plan");
  const stored = state.purchases.find(row => row.stripe_session_id === "cs_live_claimsession");
  assert(stored && stored.user_id === U.single.id, "purchase was not attached to the account");
});

await check("claim: a session paid by another email cannot be claimed", async () => {
  state.purchases = [];
  const response = await invoke(claim, eventFor("token-other", { sessionId: "cs_live_claimsession" }));
  assert(response.status === 403, "expected 403, got " + response.status);
  assert(response.body.code === "EMAIL_MISMATCH", "expected EMAIL_MISMATCH");
  assert(state.purchases.length === 0, "a mismatched claim wrote a purchase row");
});

await check("claim: an unpaid Stripe session cannot be claimed", async () => {
  state.sessionLookup = { ...state.sessionLookup, payment_status: "unpaid" };
  const response = await invoke(claim, eventFor("token-single", { sessionId: "cs_live_claimsession" }));
  assert(response.status === 403, "expected 403, got " + response.status);
  assert(response.body.code === "CHECKOUT_NOT_VERIFIED", "expected CHECKOUT_NOT_VERIFIED");
});

// ------------------------------------------------------------------ webhook
await check("webhook: invalid signature is rejected before any parsing or write", async () => {
  state.purchases = [];
  const raw = Buffer.from(JSON.stringify({ id: "evt_1", type: "checkout.session.completed" }));
  const now = Math.floor(Date.now() / 1000);
  const good = crypto.createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET).update(now + ".").update(raw).digest("hex");
  assert(verifyWebhook(raw, "t=" + now + ",v1=" + good, process.env.STRIPE_WEBHOOK_SECRET) === true, "valid signature was rejected");
  assert(verifyWebhook(raw, "t=" + now + ",v1=" + "0".repeat(64), process.env.STRIPE_WEBHOOK_SECRET) === false, "forged signature was accepted");
  assert(verifyWebhook(raw, "t=" + now, process.env.STRIPE_WEBHOOK_SECRET) === false, "missing signature was accepted");
  assert(verifyWebhook(raw, "t=" + (now - 4000) + ",v1=" + good, process.env.STRIPE_WEBHOOK_SECRET) === false, "stale signature was accepted");
});

function paidSession(overrides = {}) {
  return {
    object: "checkout.session",
    id: "cs_live_webhook01",
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    livemode: true,
    currency: "usd",
    amount_total: 79900,
    metadata: { product: "entity-authority", plan: "single" },
    customer_details: { email: U.single.email },
    payment_intent: "pi_live_webhook",
    ...overrides
  };
}

await check("webhook: paid Single-Hub session records the purchase", async () => {
  state.purchases = [];
  const recorded = await purchases.handleWebhook({ type: "checkout.session.completed", data: { object: paidSession() } });
  assert(recorded === true, "handleWebhook did not record the paid session");
  const row = state.purchases.find(item => item.stripe_session_id === "cs_live_webhook01");
  assert(row && row.plan === "single" && row.amount_total === 79900 && row.livemode === true, "stored row is wrong");
});

await check("webhook: paid Multi-Location session records $1,199", async () => {
  state.purchases = [];
  const session = paidSession({ id: "cs_live_webhook02", amount_total: 119900, metadata: { product: "entity-authority", plan: "multi" } });
  await purchases.handleWebhook({ type: "checkout.session.completed", data: { object: session } });
  const row = state.purchases.find(item => item.stripe_session_id === "cs_live_webhook02");
  assert(row && row.plan === "multi" && row.amount_total === 119900, "multi purchase was not recorded correctly");
});

await check("webhook: test-mode, unpaid and wrong-amount sessions are never recorded", async () => {
  for (const variant of [
    paidSession({ id: "cs_test_mode", livemode: false }),
    paidSession({ id: "cs_unpaid", payment_status: "unpaid" }),
    paidSession({ id: "cs_wrong_amount", amount_total: 119900 }),
    paidSession({ id: "cs_other_product", metadata: { product: "something-else", plan: "single" } })
  ]) {
    state.purchases = [];
    const result = await purchases.handleWebhook({ type: "checkout.session.completed", data: { object: variant } });
    assert(result === false, variant.id + " was accepted");
    assert(state.purchases.length === 0, variant.id + " wrote a row");
  }
});

await check("webhook: refund and dispute revoke the entitlement, won dispute restores it", async () => {
  state.purchases = [{ id: "p5", user_id: U.single.id, plan: "single", status: "paid", stripe_payment_intent: "pi_live_webhook", livemode: true, created_at: "2026-01-06T00:00:00Z" }];
  await purchases.handleWebhook({ type: "charge.refunded", data: { object: { refunded: true, payment_intent: "pi_live_webhook" } } });
  assert(state.purchases[0].status === "revoked", "refund did not revoke the purchase");
  await purchases.handleWebhook({ type: "charge.dispute.closed", data: { object: { status: "won", payment_intent: "pi_live_webhook" } } });
  assert(state.purchases[0].status === "paid", "won dispute did not restore the purchase");
});

global.fetch = realFetch;

const failed = results.filter(item => !item.ok);
console.log("\nSUMMARY  " + (results.length - failed.length) + " passed, " + failed.length + " failed, " + results.length + " total");
if (failed.length) {
  console.log("FAILED: " + failed.map(item => item.name).join(" | "));
  process.exit(1);
}
