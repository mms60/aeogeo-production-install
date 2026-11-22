// Pure selection helpers for the IndexNow deploy function.
//
// The ledger maps a normalized URL to the sitemap <lastmod> value that was
// successfully submitted for it. Comparing those values makes the decision
// independent of when the deploy runs, which matters because lastmod reflects
// when the copy was edited, not when the site was deployed.

function entryKey(entry) {
  const loc = entry && typeof entry.loc === "string" ? entry.loc : "";
  try {
    return new URL(loc).href;
  } catch {
    return loc;
  }
}

export function normalizeLastmod(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Returns entries that have never been submitted or whose lastmod has changed.
export function selectChangedEntries(entries, submitted = {}) {
  if (!Array.isArray(entries)) return [];
  const previous = submitted && typeof submitted === "object" && !Array.isArray(submitted) ? submitted : {};

  return entries.filter((entry) => {
    const key = entryKey(entry);
    return !Object.hasOwn(previous, key) || previous[key] !== normalizeLastmod(entry?.lastmod);
  });
}

// Adds only the URLs that were actually submitted to the existing ledger.
export function mergeSubmitted(entries, submitted = {}, submittedUrls) {
  if (!Array.isArray(entries)) return {};
  const next = submitted && typeof submitted === "object" && !Array.isArray(submitted) ? { ...submitted } : {};
  if (!(submittedUrls instanceof Set)) return next;

  for (const entry of entries) {
    const key = entryKey(entry);
    if (submittedUrls.has(key)) {
      next[key] = normalizeLastmod(entry?.lastmod);
    }
  }

  return next;
}
