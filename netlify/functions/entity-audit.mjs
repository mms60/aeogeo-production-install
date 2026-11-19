import crypto from "node:crypto";
import { adminClient, json, readBody, assertPublicHttpUrl, readLimitedText, safeFetch } from "./avss-shared.mjs";
import entityAudit from "./lib/entity-audit.js";

const { inspectEntityHtml } = entityAudit;

// Shared limiter backed by the audit_rate_limits table and the
// consume_audit_rate_limit() Postgres function. It fails closed: if the shared
// store is unavailable the endpoint returns 503 instead of allowing uncounted
// requests.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || "";
}

function throttleKey(headers) {
  const raw = headerValue(headers, "x-nf-client-connection-ip")
    || headerValue(headers, "client-ip")
    || (headerValue(headers, "x-forwarded-for") || "").split(",")[0].trim()
    || "unknown";
  return crypto.createHash("sha256").update(String(raw)).digest("hex").slice(0, 16);
}

async function consumeSharedLimit(headers) {
  const key = throttleKey(headers);
  try {
    const { data, error } = await adminClient().rpc("consume_audit_rate_limit", {
      p_key: key,
      p_limit: MAX_PER_WINDOW,
      p_window_seconds: Math.ceil(WINDOW_MS / 1000)
    });
    if (error) throw error;
    if (typeof data !== "boolean") throw new Error("Unexpected rate limiter response.");
    return data;
  } catch (error) {
    console.error("entity-audit rate limiter unavailable", error?.code || "unknown");
    return null;
  }
}

function sameOrigin(headers) {
  const origin = headerValue(headers, "origin");
  if (!origin) return true;
  let supplied;
  try { supplied = new URL(origin).origin; } catch { return false; }
  const expected = process.env.URL || process.env.SITE_URL;
  if (!expected) return true;
  try { return supplied === new URL(expected).origin; } catch { return false; }
}

async function googleKnowledgeGraph(query, apiKey) {
  const endpoint = new URL("https://kgsearch.googleapis.com/v1/entities:search");
  endpoint.searchParams.set("query", query);
  endpoint.searchParams.set("key", apiKey);
  endpoint.searchParams.set("limit", "5");
  endpoint.searchParams.set("indent", "false");
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return [];
    const data = JSON.parse(await readLimitedText(response, 256_000));
    return (data.itemListElement || []).slice(0, 5).map(item => {
      const result = item.result || {};
      const detailUrl = result.detailedDescription?.url;
      return {
        kgId: typeof result["@id"] === "string" ? result["@id"] : "",
        name: typeof result.name === "string" ? result.name : "",
        types: (Array.isArray(result["@type"]) ? result["@type"] : []).filter(type => typeof type === "string").slice(0, 8),
        description: typeof result.description === "string" ? result.description : undefined,
        detailedDescriptionUrl: /^https?:\/\//i.test(detailUrl || "") ? detailUrl : undefined,
        resultScore: Number(item.resultScore) || 0
      };
    }).filter(candidate => candidate.name);
  } catch {
    return [];
  }
}

export default async request => {
  const webRequest = typeof request?.headers?.get === "function";
  const method = webRequest ? request.method : request?.httpMethod;
  const headers = request?.headers || {};
  if (method !== "POST") {
    return json(405, { error: "Use POST to run an entity check." });
  }
  if (!sameOrigin(headers)) {
    return json(403, { error: "This endpoint only accepts requests from the AEOGEO Search site." });
  }
  const limit = await consumeSharedLimit(headers);
  if (limit === false) {
    return json(429, { error: "Too many checks from this connection. Wait a minute and try again." });
  }
  if (limit === null) {
    return json(503, { error: "The free entity check is temporarily unavailable. Please retry in a minute.", code: "RATE_LIMIT_UNAVAILABLE" });
  }

  try {
    const body = webRequest ? await request.json() : await readBody(request);
    const rawUrl = String(body?.url || "").trim().slice(0, 2048);
    const brandName = String(body?.brandName || "").trim().slice(0, 120);
    if (!brandName) return json(400, { error: "Enter the brand name you want AI engines to resolve." });

    const target = await assertPublicHttpUrl(rawUrl);
    const response = await safeFetch(target.href, {
      timeout: 12000,
      userAgent: "AEOGEO-Entity-Audit/1.0 (+https://aeogeosearch.com)"
    });

    const contentType = response.headers.get("content-type") || "";
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return json(422, { error: `That URL returned ${contentType}, not an HTML page.` });
    }
    if (!response.ok && response.status >= 400) {
      // A 403/404 page can still contain an error template, but it is not the
      // brand page the visitor asked us to inspect. Report the status plainly.
      return json(200, {
        url: target.href,
        finalUrl: response.url || target.href,
        httpStatus: response.status,
        fetchedAt: new Date().toISOString(),
        brandName,
        knowledgeGraphEnabled: false,
        knowledgeGraphMatches: [],
        jsonLdBlocksFound: 0,
        malformedJsonLdBlocks: 0,
        hasUnifiedGraph: false,
        hasPersistentIds: false,
        hasSameAsAnchors: false,
        sameAsCount: 0,
        sameAsHosts: [],
        detectedTypes: [],
        coreEntityTypes: [],
        fragmentationIssues: [`The page returned HTTP ${response.status}, so there was no usable brand page to inspect.`]
      });
    }

    const html = await readLimitedText(response, 2_000_000);
    const audit = inspectEntityHtml(html);
    const knowledgeGraphEnabled = Boolean(process.env.GOOGLE_KG_API_KEY);
    const knowledgeGraphMatches = knowledgeGraphEnabled
      ? await googleKnowledgeGraph(brandName, process.env.GOOGLE_KG_API_KEY)
      : [];

    if (knowledgeGraphMatches.length > 1) {
      audit.fragmentationIssues.push(
        `Potential entity collision: ${knowledgeGraphMatches.length} matching entities were found in Google's Knowledge Graph for "${brandName}".`
      );
    }

    return json(200, {
      url: target.href,
      finalUrl: response.url || target.href,
      httpStatus: response.status,
      fetchedAt: new Date().toISOString(),
      brandName,
      knowledgeGraphEnabled,
      knowledgeGraphMatches,
      ...audit
    });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 400;
    return json(status, { error: error?.message || "The entity check could not be completed." });
  }
};
