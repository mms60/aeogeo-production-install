// IndexNow submission for the Cloudflare Worker.
//
// Netlify ran this from its deploySucceeded event and stored the submission
// ledger in Netlify Blobs. Cloudflare has no equivalent deploy event, so the
// hourly Cron Trigger runs it instead and the ledger lives in the
// INDEXNOW_LEDGER KV namespace. The selection rules are shared with the Netlify
// function, so behaviour does not drift between the two platforms.

import {
  mergeSubmitted,
  normalizeLastmod,
  selectChangedEntries,
} from "../netlify/functions/lib/indexnow-selection.mjs";

const DEFAULT_KEY = "8e63d09f86525125461b411e6f7e1dec";
const DEFAULT_SITE_URL = "https://aegeosearch.com";
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const MAX_URLS = 10000;
const TIMEOUT_MS = 15000;
const LEDGER_KEY = "submitted-urls.json";

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function sitemapEntries(xml) {
  const entries = [];
  for (const [, block] of xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)) {
    const loc = block.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i);
    if (!loc) continue;
    const lastmod = block.match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i);
    entries.push({
      loc: decodeEntities(loc[1].trim()),
      lastmod: lastmod ? lastmod[1].trim() : "",
    });
  }
  return entries;
}

function absoluteHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function uniqueUrls(values) {
  const seen = new Set();
  const urls = [];
  for (const value of values) {
    const url = absoluteHttpUrl(String(value).trim());
    if (!url || seen.has(url.href)) continue;
    seen.add(url.href);
    urls.push(url);
  }
  return urls;
}

async function readLedger(store) {
  const raw = await store.get(LEDGER_KEY);
  if (!raw) return { submitted: {}, seeded: false };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { submitted: {}, seeded: false };
  }
  if (!parsed || typeof parsed !== "object" || !parsed.submitted || typeof parsed.submitted !== "object" || Array.isArray(parsed.submitted)) {
    return { submitted: {}, seeded: false };
  }
  const submitted = {};
  for (const [url, lastmod] of Object.entries(parsed.submitted)) {
    if (typeof lastmod === "string") submitted[url] = normalizeLastmod(lastmod);
  }
  return { submitted, seeded: true };
}

export async function submitIndexNow(env) {
  const ledgerStore = env?.INDEXNOW_LEDGER;
  if (!ledgerStore) {
    console.log("[indexnow] Skipped: INDEXNOW_LEDGER binding is missing.");
    return;
  }

  const key = String(env.INDEXNOW_KEY || DEFAULT_KEY).trim();
  const siteUrl = String(env.INDEXNOW_SITE_URL || env.PUBLIC_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");
  const forced = String(env.INDEXNOW_URLS || "")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  let candidates;
  let entries = [];
  let ledger = null;

  if (forced.length) {
    candidates = uniqueUrls(forced);
    console.log(`[indexnow] Using INDEXNOW_URLS override (${candidates.length} URL(s)).`);
  } else {
    const sitemapUrl = `${siteUrl}/sitemap.xml`;
    let xml;
    try {
      const response = await fetch(sitemapUrl, {
        headers: { "cache-control": "no-cache" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      xml = await response.text();
    } catch (error) {
      console.log(`[indexnow] Skipped: could not read ${sitemapUrl} (${error.message}).`);
      return;
    }

    entries = sitemapEntries(xml);
    try {
      ledger = await readLedger(ledgerStore);
    } catch (error) {
      console.log(`[indexnow] Submission ledger unavailable (${error.message}); skipping this run.`);
      return;
    }

    const selected = selectChangedEntries(entries, ledger.submitted);
    candidates = uniqueUrls(selected.map((entry) => entry.loc));
    if (!ledger.seeded) {
      console.log(`[indexnow] No prior submission ledger; seeding all ${candidates.length} sitemap URL(s).`);
    }
    console.log(`[indexnow] ${candidates.length} of ${entries.length} sitemap URL(s) are new or changed since their last submission.`);
  }

  if (!candidates.length) {
    console.log("[indexnow] Nothing to submit.");
    return;
  }

  const origin = candidates[0].origin;
  const sameOrigin = candidates.filter((url) => url.origin === origin);
  if (sameOrigin.length < candidates.length) {
    console.log(`[indexnow] Ignored ${candidates.length - sameOrigin.length} URL(s) outside ${origin}.`);
  }
  const urlList = sameOrigin.slice(0, MAX_URLS).map((url) => url.href);

  const payload = {
    host: new URL(origin).hostname,
    key,
    keyLocation: `${origin}/${key}.txt`,
    urlList,
  };

  const response = await fetch(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  console.log(`[indexnow] Submitted ${urlList.length} URL(s) for ${payload.host}: HTTP ${response.status}.`);
  if (!response.ok) return;

  if (ledger) {
    try {
      const submitted = mergeSubmitted(entries, ledger.submitted, new Set(urlList));
      await ledgerStore.put(
        LEDGER_KEY,
        JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), submitted }),
      );
      console.log(`[indexnow] Recorded ${urlList.length} submitted URL(s) in the submission ledger.`);
    } catch (error) {
      console.log(`[indexnow] Submitted URLs but could not update the submission ledger: ${error.message}`);
    }
  }
}
