// IndexNow: submit changed URLs to Bing (and the other IndexNow engines) after
// a successful production deploy.
//
// This is a Netlify platform-event function. Netlify invokes it once the deploy
// is live, so the key file under site/ is already being served when it runs.
//
// Activation:
//   1. Commit this file and site/8e63d09f86525125461b411e6f7e1dec.txt.
//   2. Deploy to production. Nothing else is required.
//
// The key is public by design. IndexNow verifies domain ownership by fetching
// https://<host>/<key>.txt and comparing it with the key in the payload, so it
// is safe to keep here. To rotate it, replace both the site/<key>.txt file and
// DEFAULT_KEY below, or set INDEXNOW_KEY to override the constant.
//
// Optional environment variables (Netlify site configuration):
//   INDEXNOW_KEY            Override the committed public key.
//   INDEXNOW_URLS           Comma/whitespace-separated URLs to submit instead of
//                           selecting from the sitemap (for a one-off push).
//   INDEXNOW_SUBMIT_ALL     "true" submits every sitemap URL (first-time seeding).
//   INDEXNOW_LOOKBACK_DAYS  How many days of <lastmod> dates to submit.
//                           Defaults to 7; 0 submits only today's changes.

const DEFAULT_KEY = "8e63d09f86525125461b411e6f7e1dec";
const DEFAULT_SITE_URL = "https://aeogeosearch.com";
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const MAX_URLS = 10000;
const TIMEOUT_MS = 15000;
const DEFAULT_LOOKBACK_DAYS = 7;

function lookbackDays() {
  const value = Number.parseInt(process.env.INDEXNOW_LOOKBACK_DAYS || "", 10);
  return Number.isFinite(value) && value >= 0 && value <= 3650 ? value : DEFAULT_LOOKBACK_DAYS;
}

// Returns every <url> entry in a sitemap, including entries without <lastmod>.
export function sitemapEntries(xml) {
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

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
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

export default {
  async deploySucceeded(event) {
    try {
      const context = event?.deploy?.context || process.env.CONTEXT || "";
      if (context !== "production") {
        console.log(`[indexnow] Skipped: deploy context is "${context || "unknown"}", not production.`);
        return;
      }

      const key = (process.env.INDEXNOW_KEY || DEFAULT_KEY).trim();
      const siteUrl = (process.env.URL || event?.site?.url || DEFAULT_SITE_URL).replace(/\/+$/, "");
      const today = new Date().toISOString().slice(0, 10);
      const lookback = lookbackDays();
      const cutoff = new Date(Date.now() - lookback * 86400000).toISOString().slice(0, 10);
      const forced = (process.env.INDEXNOW_URLS || "")
        .split(/[\s,]+/)
        .map((value) => value.trim())
        .filter(Boolean);
      const submitAll = (process.env.INDEXNOW_SUBMIT_ALL || "").trim().toLowerCase() === "true";

      let candidates;
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

        const entries = sitemapEntries(xml);
        const selected = submitAll
          ? entries
          : entries.filter((entry) => entry.lastmod.slice(0, 10) >= cutoff);
        candidates = uniqueUrls(selected.map((entry) => entry.loc));
        console.log(
          submitAll
            ? `[indexnow] INDEXNOW_SUBMIT_ALL=true: ${candidates.length} sitemap URL(s) selected.`
            : `[indexnow] ${candidates.length} sitemap URL(s) changed since ${cutoff} (${lookback}-day window).`,
        );
      }

      if (!candidates.length) {
        console.log("[indexnow] Nothing to submit.");
        return;
      }

      // IndexNow expects one host per request, so stay on the origin of the
      // first URL (for a sitemap that is the canonical production origin).
      const origin = candidates[0].origin;
      const sameOrigin = candidates.filter((url) => url.origin === origin);
      if (sameOrigin.length < candidates.length) {
        console.log(`[indexnow] Ignored ${candidates.length - sameOrigin.length} URL(s) outside ${origin}.`);
      }
      if (sameOrigin.length > MAX_URLS) {
        console.log(`[indexnow] Capped at ${MAX_URLS} of ${sameOrigin.length} URL(s).`);
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
      if (!response.ok) {
        console.log(`[indexnow] Response: ${(await response.text()).slice(0, 500)}`);
      }
    } catch (error) {
      // Event handlers run in the background; log instead of throwing.
      console.log(`[indexnow] Submission failed: ${error.message}`);
    }
  },
};
