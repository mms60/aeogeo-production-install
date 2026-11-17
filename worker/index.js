import * as auditCheckoutReadiness from "../netlify/functions/audit-checkout-readiness.js";
import * as billingPortal from "../netlify/functions/billing-portal.js";
import * as billingReview from "../netlify/functions/billing-review.js";
import * as competitorIntelligence from "../netlify/functions/competitor-intelligence.js";
import * as contentNotifications from "../netlify/functions/content-notifications.js";
import * as contentService from "../netlify/functions/content-service.js";
import * as contentServiceStatus from "../netlify/functions/content-service-status.js";
import * as createCheckout from "../netlify/functions/create-checkout.js";
import * as createKitCheckout from "../netlify/functions/create-kit-checkout.js";
import * as entityAuthorityCheckout from "../netlify/functions/entity-authority-checkout.js";
import * as guestServiceCheckout from "../netlify/functions/guest-service-checkout.js";
import * as ownerBillingCheck from "../netlify/functions/owner-billing-check.js";
import * as ownerMonthlyTest from "../netlify/functions/owner-monthly-test.js";
import * as ownerMonthlyTestSetup from "../netlify/functions/owner-monthly-test-setup.js";
import * as ownerMonthlyTestWebhook from "../netlify/functions/owner-monthly-test-webhook.js";
import * as productApi from "../netlify/functions/product-api.js";
import * as runCompetitorReportBackground from "../netlify/functions/run-competitor-report-background.js";
import * as serviceCheckout from "../netlify/functions/service-checkout.js";
import * as stripeWebhook from "../netlify/functions/stripe-webhook.js";
import * as studioCheckout from "../netlify/functions/studio-checkout.js";

const FUNCTIONS = {
  "audit-checkout-readiness": auditCheckoutReadiness,
  "billing-portal": billingPortal,
  "billing-review": billingReview,
  "competitor-intelligence": competitorIntelligence,
  "content-notifications": contentNotifications,
  "content-service": contentService,
  "content-service-status": contentServiceStatus,
  "create-checkout": createCheckout,
  "create-kit-checkout": createKitCheckout,
  "entity-authority-checkout": entityAuthorityCheckout,
  "guest-service-checkout": guestServiceCheckout,
  "owner-billing-check": ownerBillingCheck,
  "owner-monthly-test": ownerMonthlyTest,
  "owner-monthly-test-setup": ownerMonthlyTestSetup,
  "owner-monthly-test-webhook": ownerMonthlyTestWebhook,
  "product-api": productApi,
  "run-competitor-report-background": runCompetitorReportBackground,
  "service-checkout": serviceCheckout,
  "stripe-webhook": stripeWebhook,
  "studio-checkout": studioCheckout,
};

function resolveHandler(module) {
  const candidate = module?.handler ?? module?.default?.handler ?? module?.default;
  return typeof candidate === "function" ? candidate : null;
}

function copyEnvironment(env, origin) {
  if (typeof process === "undefined" || !process.env) return;
  for (const [key, value] of Object.entries(env || {})) {
    if (typeof value === "string") process.env[key] = value;
  }
  // A request origin is only a preview/development fallback. Production
  // settings must still come from Cloudflare secrets.
  if (!process.env.URL) process.env.URL = origin;
  if (!process.env.PUBLIC_SITE_URL) process.env.PUBLIC_SITE_URL = origin;
  if (!process.env.CONTEXT) process.env.CONTEXT = "production";
}

function toNetlifyEvent(request, url, body, env) {
  const headers = Object.fromEntries(request.headers.entries());
  headers["x-nf-client-connection-ip"] =
    request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const queryStringParameters = {};
  for (const [key, value] of url.searchParams) queryStringParameters[key] = value;
  return {
    httpMethod: request.method,
    headers,
    body,
    isBase64Encoded: false,
    queryStringParameters,
    path: url.pathname,
    rawUrl: url.href,
    rawQuery: url.search.slice(1),
  };
}

async function toResponse(result) {
  if (result instanceof Response) return result;
  const status = Number(result?.statusCode) || 200;
  const headers = new Headers();
  for (const [name, value] of Object.entries(result?.headers || {})) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, String(item));
    else if (value !== undefined && value !== null) headers.set(name, String(value));
  }
  let body = result?.body ?? "";
  if (result?.isBase64Encoded) body = Buffer.from(String(body), "base64");
  return new Response(body, { status, headers });
}

async function invoke(name, request, env) {
  const handler = resolveHandler(FUNCTIONS[name]);
  if (!handler) {
    return Response.json({ error: "Function is not available in the Cloudflare migration yet." }, { status: 503 });
  }
  const url = new URL(request.url);
  copyEnvironment(env, url.origin);
  const body = ["GET", "HEAD"].includes(request.method) ? null : await request.text();
  const result = await handler(toNetlifyEvent(request, url, body, env), {});
  return toResponse(result);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const prefix = "/.netlify/functions/";
    if (url.pathname.startsWith(prefix)) {
      const name = url.pathname.slice(prefix.length).split("/")[0];
      return invoke(name, request, env);
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(_event, env, _ctx) {
    copyEnvironment(env, "https://aegeosearch.com");
    const handler = resolveHandler(FUNCTIONS["content-notifications"]);
    if (!handler) return;
    await handler({ httpMethod: "POST", headers: {}, body: "", queryStringParameters: {} }, {});
  },
};
