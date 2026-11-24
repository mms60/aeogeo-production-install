'use strict';
// Content Decay Predictor - deterministic contradiction engine.
//
// Input is the claim list from ./fact-extract. Output is the set of
// disagreements a report can defend, with both pages and both quotes.
//
// The central rule, and the reason this does not drown in noise:
//
//   Two pages disagree only when their canonical value sets are DISJOINT.
//
// A page that lists both a main number and a fax number has {A, B}; a page that
// lists only {A} is consistent with it, because A is shared. The classic failure
// case still fires: /pricing says {349} and a 2024 blog post says {199} are
// disjoint, so that pair is reported.
//
// Three kinds are kept separate because they mean different things:
//   contradiction       two current pages state different values
//   drift               a possibly outdated page disagrees with a current one
//   jsonld_vs_visible   one page's structured data contradicts its own copy
//
// Contract:
//   diffClaims({claims, pages, today}) -> {conflicts, summary}

const MAX_CONFLICTS = 30;
const STALE_MS = 365 * 24 * 60 * 60 * 1000;
const RANK = Object.freeze({low: 1, medium: 2, high: 3, critical: 4});
const KIND_ORDER = {contradiction: 0, drift: 1, jsonld_vs_visible: 2};

// How much a disagreement of each category matters. Pricing, contact details and
// hours are what an answer engine retrieves verbatim; a team headcount is not.
const CATEGORY_SEVERITY = Object.freeze({
  pricing: 'high',
  phone: 'high',
  address: 'high',
  hours: 'high',
  founded: 'medium',
  headcount: 'low'
});

const CATEGORY_LABEL = Object.freeze({
  pricing: 'the starting price',
  phone: 'the phone number',
  address: 'the business address',
  hours: 'the opening hours',
  founded: 'the founding year',
  headcount: 'the team size'
});

const FINDING_TITLE = Object.freeze({
  contradiction: 'Two pages state different values for',
  drift: 'A possibly outdated page states a different value for',
  jsonld_vs_visible: 'Structured data disagrees with the visible copy on'
});

const RECOMMENDATION = Object.freeze({
  contradiction: 'Decide which value is current, then correct the page that disagrees. An AI retrieval pipeline can pull either page, so the brand ends up hedged or dropped.',
  drift: 'Confirm whether the older page is still accurate. Update the value there or remove the outdated statement.',
  jsonld_vs_visible: 'Make the structured data match the visible copy. A declared value that disagrees with the page undermines both.'
});

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function shortUrl(value) {
  return clean(value).replace(/^https?:\/\//i, '');
}

function downgrade(severity) {
  if (severity === 'critical') return 'high';
  if (severity === 'high') return 'medium';
  if (severity === 'medium') return 'low';
  return 'low';
}

function labelFor(category, attribute) {
  if (category === 'pricing') {
    const plan = /^plan_price:([a-z]+):/.exec(String(attribute || ''));
    if (plan) return 'the ' + plan[1] + ' plan price';
    return 'the starting price';
  }
  return CATEGORY_LABEL[category] || String(category || 'value');
}

// A page is treated as possibly outdated when its own address or its own
// declared date says so. Nothing is inferred from response headers.
function stalePage(page, today) {
  if (!page) return false;
  const url = String(page.url || '');
  if (/\/(?:blog|news|insights?|articles?|posts?)\//i.test(url)) return true;
  if (/\/20\d{2}\//.test(url)) return true;
  if (!page.declaredModifiedAt) return false;
  const when = new Date(page.declaredModifiedAt);
  if (Number.isNaN(when.getTime())) return false;
  return today.getTime() - when.getTime() > STALE_MS;
}

function valuesOf(claims) {
  return [...new Set(claims.map(claim => claim.valueKey))].sort();
}

function representative(claims) {
  return [...claims].sort((a, b) => a.valueKey.localeCompare(b.valueKey))[0];
}

function disjoint(left, right) {
  const a = new Set(left);
  return right.every(value => !a.has(value));
}

function buildConflict({kind, category, attribute, severity, valueA, valueB, pageA, pageB, quoteA, quoteB}) {
  const label = labelFor(category, attribute);
  return {
    kind,
    category,
    attribute,
    severity,
    title: FINDING_TITLE[kind] + ' ' + label,
    detail: kind === 'jsonld_vs_visible'
      ? `The visible copy on ${shortUrl(pageA)} says "${valueA}". Its structured data declares "${valueB}".`
      : `${shortUrl(pageA)} says "${valueA}". ${shortUrl(pageB)} says "${valueB}".`,
    valueA,
    valueB,
    pageAUrl: pageA,
    pageBUrl: pageB,
    quoteA: quoteA || null,
    quoteB: quoteB || null,
    recommendation: RECOMMENDATION[kind]
  };
}

function diffClaims({claims, pages = [], today = new Date()} = {}) {
  const list = Array.isArray(claims) ? claims : [];
  const now = today instanceof Date && !Number.isNaN(today.getTime()) ? today : new Date();
  const pageByUrl = new Map();
  for (const page of Array.isArray(pages) ? pages : []) {
    if (page && typeof page.url === 'string') pageByUrl.set(page.url, page);
  }

  // Group by comparison bucket. Object keys are visited in a fixed sorted
  // order so the same scan always produces the same report.
  const groups = new Map();
  for (const claim of list) {
    if (!claim || !claim.sourceUrl || !claim.valueKey) continue;
    const key = claim.category + '|' + claim.attribute;
    if (!groups.has(key)) {
      groups.set(key, {category: claim.category, attribute: claim.attribute, visible: new Map(), jsonld: new Map()});
    }
    const group = groups.get(key);
    const bucket = claim.sourceKind === 'jsonld' ? group.jsonld : group.visible;
    if (!bucket.has(claim.sourceUrl)) bucket.set(claim.sourceUrl, []);
    bucket.get(claim.sourceUrl).push(claim);
  }

  const conflicts = [];
  const seen = new Set();
  const add = conflict => {
    const values = [clean(conflict.valueA), clean(conflict.valueB)].sort().join('|');
    // The same disagreement can surface under two attributes (a "starting at"
    // price and a plan price on the same pages). One card is enough.
    //
    // Drift is keyed on the stale page and the two values only. When one old
    // page disagrees with several current pages that agree with each other,
    // there is one thing to fix, not one per current page.
    const key = conflict.kind === 'drift'
      ? [conflict.category, values, conflict.pageBUrl].join('::')
      : [conflict.category, values, [conflict.pageAUrl, conflict.pageBUrl].sort().join('|')].join('::');
    if (seen.has(key)) return;
    seen.add(key);
    conflicts.push(conflict);
  };

  for (const group of [...groups.values()].sort((a, b) =>
    (a.category + '|' + a.attribute).localeCompare(b.category + '|' + b.attribute))) {
    const urls = [...group.visible.keys()].sort();

    for (let i = 0; i < urls.length; i += 1) {
      for (let j = i + 1; j < urls.length; j += 1) {
        const leftClaims = group.visible.get(urls[i]);
        const rightClaims = group.visible.get(urls[j]);
        const leftValues = valuesOf(leftClaims);
        const rightValues = valuesOf(rightClaims);
        if (!leftValues.length || !rightValues.length) continue;
        if (!disjoint(leftValues, rightValues)) continue;

        const left = representative(leftClaims);
        const right = representative(rightClaims);
        const leftStale = stalePage(pageByUrl.get(urls[i]), now);
        const rightStale = stalePage(pageByUrl.get(urls[j]), now);
        const stale = leftStale !== rightStale;
        const kind = stale ? 'drift' : 'contradiction';
        const base = CATEGORY_SEVERITY[group.category] || 'medium';

        // Put the current page first: the reader's attention belongs on the
        // page they can still fix, with the stale one named second.
        const ordered = stale && leftStale
          ? {a: right, b: left, aUrl: urls[j], bUrl: urls[i]}
          : {a: left, b: right, aUrl: urls[i], bUrl: urls[j]};

        add(buildConflict({
          kind,
          category: group.category,
          attribute: group.attribute,
          severity: stale ? downgrade(base) : base,
          valueA: ordered.a.valueDisplay,
          valueB: ordered.b.valueDisplay,
          pageA: ordered.aUrl,
          pageB: ordered.bUrl,
          quoteA: ordered.a.quote,
          quoteB: ordered.b.quote
        }));
      }
    }

    // Same page: declared structured data against its own visible copy. This
    // is the schema-stuffing case, so it stays high severity regardless of the
    // category's usual weight.
    for (const url of [...group.jsonld.keys()].sort()) {
      const declared = group.jsonld.get(url);
      const visible = group.visible.get(url);
      if (!visible || !visible.length) continue;
      const declaredValues = valuesOf(declared);
      const visibleValues = valuesOf(visible);
      if (!declaredValues.length || !visibleValues.length) continue;
      if (!disjoint(declaredValues, visibleValues)) continue;

      const a = representative(visible);
      const b = representative(declared);
      add(buildConflict({
        kind: 'jsonld_vs_visible',
        category: group.category,
        attribute: group.attribute,
        severity: 'high',
        valueA: a.valueDisplay,
        valueB: b.valueDisplay,
        pageA: url,
        pageB: url,
        quoteA: a.quote,
        quoteB: b.quote
      }));
    }
  }

  conflicts.sort((a, b) =>
    (RANK[b.severity] || 0) - (RANK[a.severity] || 0)
    || (KIND_ORDER[a.kind] || 0) - (KIND_ORDER[b.kind] || 0)
    || a.category.localeCompare(b.category)
    || a.pageAUrl.localeCompare(b.pageAUrl)
    || a.pageBUrl.localeCompare(b.pageBUrl));

  const capped = conflicts.slice(0, MAX_CONFLICTS);
  const count = kind => capped.filter(conflict => conflict.kind === kind).length;

  return {
    conflicts: capped,
    summary: {
      claims: list.length,
      pagesWithFacts: new Set(list.map(claim => claim.sourceUrl)).size,
      conflicts: capped.length,
      truncated: conflicts.length > capped.length,
      contradiction: count('contradiction'),
      drift: count('drift'),
      jsonldVsVisible: count('jsonld_vs_visible')
    }
  };
}

module.exports = {diffClaims, stalePage, MAX_CONFLICTS};
