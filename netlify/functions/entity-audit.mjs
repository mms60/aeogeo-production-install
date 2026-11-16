import crypto from "node:crypto";
import { json, readBody, assertPublicHttpUrl, safeFetch } from "./avss-shared.mjs";
import entityAudit from "./lib/entity-audit.js";

const { inspectEntityHtml } = entityAudit;

// Best-effort per-instance throttle. Netlify may run several instances, so this
// reduces casual abuse but is not a substitute for a WAF or a durable limiter.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;
const hits = new Map();

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

function isThrottled(headers) {
  const key = throttleKey(headers);
  const now = Date.now();
  const recent = (hits.get(key) || []).filter(time => now - time < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 2000) {
    for (const [entry, times] of hits) {
      if (!times.some(time => now - time < WINDOW_MS)) hits.delete(entry);
    }
  }
  return false;
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

async function readLimitedText(response, limit) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared && declared > limit) throw Object.assign(new Error("The page is too large to audit."), { status: 413 });
  if (!response.body) return (await response.text()).slice(0, limit);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      try { await reader.cancel(); } catch {}
      throw Object.assign(new Error("The page is too large to audit."), { status: 413 });
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
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
    const data = await response.json();
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
  if (isThrottled(headers)) {
    return json(429, { error: "Too many checks from this connection. Wait a minute and try again." });
  }

  try {
    const body = webRequest ? await request.json() : readBody(request);
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
