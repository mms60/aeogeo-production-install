'use strict';
// Content Decay Predictor - crawl layer (Phase 3).
//
// Reuses the SSRF-safe primitives in ./crawler (normalURL, getPage,
// robotsAllowed) rather than adding a second HTTP client, so DNS pinning,
// public-IP-only resolution, the 1.8 MB body cap and the five-redirect limit
// stay identical to the existing audit crawler.
//
// Only public HTTPS pages on the submitted hostname are fetched. robots.txt is
// honoured for every URL, including redirect destinations. No database, Stripe
// or report access happens in this module.
//
// Freshness comes from signals the page itself declares (JSON-LD dateModified /
// datePublished, article metadata, <time datetime>, a visible "last updated"
// label). Response headers are deliberately ignored: a Last-Modified header
// reflects server configuration, not whether the content is current.

const crypto = require('node:crypto');
const cheerio = require('cheerio');
const {normalURL, getPage, robotsAllowed} = require('./crawler');

const MAX_PAGES = 10;
const CRAWL_DEADLINE_MS = 100000;
const ROBOTS_AGENT = 'aeogeoauditbot';
const SKIP_EXTENSIONS = /\.(?:pdf|zip|rar|7z|png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|mp4|m4v|mov|webm|avi|mp3|wav|ogg|css|js|mjs|map|json|xml|txt|csv|woff2?|ttf|otf|eot|docx?|xlsx?|pptx?)$/i;

function crawlError(message, code) {
  return Object.assign(new Error(message), {status: 422, code: code || 'CONTENT_DECAY_CRAWL_FAILED'});
}

async function loadRobots(origin) {
  try {
    const response = await getPage(origin + '/robots.txt');
    if (response.status === 200) return {text: response.text, status: 'Fetched'};
    if (response.status === 404) return {text: '', status: 'Not found (404)'};
    return {text: '', status: 'Unavailable (HTTP ' + response.status + ')'};
  } catch {
    return {text: '', status: 'Unavailable'};
  }
}

function allowed(robots, value) {
  try {
    const url = new URL(value);
    return robotsAllowed(robots.text, url.pathname + url.search, ROBOTS_AGENT);
  } catch {
    return false;
  }
}

function sitemapEntries(xml) {
  const $ = cheerio.load(xml, {xmlMode: true});
  const urls = [];
  const children = [];
  $('url > loc').each((_, element) => {
    const value = $(element).text().trim();
    if (value) urls.push(value);
  });
  $('sitemap > loc').each((_, element) => {
    const value = $(element).text().trim();
    if (value) children.push(value);
  });
  return {urls, children};
}

const MONTH_INDEX = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

// A date without a time is a calendar date, not local midnight. Parsing it in
// the server's timezone would move it to the previous or next UTC day, so the
// components are read explicitly and built in UTC.
function utcDateOnly(text) {
  const build = (year, month, day) => {
    if (month === undefined || day < 1 || day > 31) return null;
    const date = new Date(Date.UTC(Number(year), month, day));
    return date.getUTCMonth() === month && date.getUTCDate() === day ? date : null;
  };
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) return build(match[1], Number(match[2]) - 1, Number(match[3]));
  match = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  if (match) return build(match[3], MONTH_INDEX[match[1].slice(0, 3).toLowerCase()], Number(match[2]));
  match = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(text);
  if (match) return build(match[3], MONTH_INDEX[match[2].slice(0, 3).toLowerCase()], Number(match[1]));
  return null;
}

function isoDate(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const parsed = utcDateOnly(text) || new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getUTCFullYear();
  const current = new Date().getUTCFullYear();
  if (year < 1990 || year > current + 1) return null;
  return parsed.toISOString();
}

function jsonLdDates(blocks) {
  const found = {modified: [], published: [], types: []};
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node['@type'] === 'string') found.types.push(node['@type']);
    else if (Array.isArray(node['@type'])) {
      found.types.push(...node['@type'].filter(type => typeof type === 'string'));
    }
    const modified = isoDate(node.dateModified);
    if (modified) found.modified.push(modified);
    const published = isoDate(node.datePublished);
    if (published) found.published.push(published);
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') visit(value);
    }
  };
  for (const block of blocks) {
    try { visit(JSON.parse(block)); } catch { /* a malformed block is not a finding */ }
  }
  return found;
}

function analysePage(html, url) {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim();
  const h1Count = $('h1').length;
  const headingLevels = $('h1,h2,h3,h4,h5,h6').toArray()
    .map(element => Number(element.tagName.slice(1)));

  const jsonLdBlocks = $('script[type="application/ld+json"]').toArray()
    .map(element => $(element).text());
  const dates = jsonLdDates(jsonLdBlocks);

  const meta = name => $(`meta[property="${name}"], meta[name="${name}"]`).attr('content') || '';

  const timeTags = [];
  $('time[datetime]').each((_, element) => {
    const value = isoDate($(element).attr('datetime'));
    if (value) timeTags.push(value);
  });

  const visibleText = $('body').text().replace(/\s+/g, ' ').trim();
  const labelMatch = /(?:last\s+(?:updated|reviewed|modified)|updated|reviewed)\s*[:\-–—]?\s*(?:on\s+)?([A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Z][a-z]{2,8}\.?\s+\d{4}|\d{4}-\d{2}-\d{2})/i.exec(visibleText);
  const labelDate = labelMatch ? isoDate(labelMatch[1]) : null;

  const modifiedCandidates = [
    ...dates.modified,
    isoDate(meta('article:modified_time')),
    isoDate(meta('og:updated_time')),
    isoDate(meta('dateModified')),
    ...timeTags,
    labelDate
  ].filter(Boolean).sort();

  const publishedCandidates = [
    ...dates.published,
    isoDate(meta('article:published_time')),
    isoDate(meta('datePublished'))
  ].filter(Boolean).sort();

  const internalLinks = [];
  let externalLinks = 0;
  let origin = url;
  try { origin = new URL(url).origin; } catch { /* keep the raw value */ }
  $('a[href]').each((_, element) => {
    try {
      const next = new URL($(element).attr('href'), url);
      next.hash = '';
      if (next.protocol !== 'https:') return;
      if (next.origin === origin) {
        if (!next.search) internalLinks.push(next.href);
      } else {
        externalLinks += 1;
      }
    } catch { /* ignore unparseable links */ }
  });

  const $text = cheerio.load(html);
  $text('script,style,noscript,nav,footer,header,svg').remove();
  const mainText = $text('body').text().replace(/\s+/g, ' ').trim();
  const wordCount = mainText ? mainText.split(/\s+/).length : 0;

  const hasAuthor = $('[rel="author"], [itemprop="author"], .author, .byline').length > 0
    || dates.types.some(type => /^(Person|Organization)$/i.test(type));
  const hasFaq = /(?:frequently asked questions|\bfaq\b)/i.test(visibleText)
    || dates.types.some(type => /FAQPage/i.test(type));
  // Percentages and multipliers only. Word counts, prices, discounts and quoted
  // marketing phrases are not statistical claims.
  const STATISTIC = String.raw`\d+(?:\.\d+)?\s?%|\b\d+(?:\.\d+)?\s?(?:x|times)\b`;
  const statisticsPattern = new RegExp('(?:' + STATISTIC + ')');
  const reportableStatistic = prose => {
    for (const match of prose.matchAll(new RegExp('(?:' + STATISTIC + ')', 'g'))) {
      const index = Number(match.index) || 0;
      const before = prose.slice(0, index);
      if (((before.match(/["“”]/g) || []).length % 2) === 1) continue; // inside a quote
      if (/\$\s?$/.test(before)) continue; // a price, not a measurement
      const after = prose.slice(index + match[0].length);
      if (/^\s*(?:discount|off\b|savings)/i.test(after)) continue;
      return true;
    }
    return false;
  };
  const hasStatistics = statisticsPattern.test(visibleText);
  const noindex = /noindex/i.test(String(meta('robots') || ''));

  // Text signals used by the decay rules. They are collected here, while the
  // page text is in hand, and stored as compact evidence: no page copy is kept.
  const currentYear = new Date().getUTCFullYear();
  const copyrightYears = [...mainText.matchAll(/©\s*((?:19|20)\d{2})/g)]
    .map(match => Number(match[1]))
    .filter(year => year >= 1990 && year <= currentYear + 1);
  const copyrightYear = copyrightYears.length ? Math.max(...copyrightYears) : null;

  const outdatedYearMentions = [];
  const seenYears = new Set();
  const collectYear = match => {
    const year = Number(match[1]);
    if (!Number.isInteger(year) || year < 2015 || year > currentYear - 2) return;
    if (seenYears.has(year)) return;
    seenYears.add(year);
    const start = Math.max(0, match.index - 40);
    const end = Math.min(mainText.length, match.index + match[0].length + 40);
    outdatedYearMentions.push({year, context: mainText.slice(start, end).trim()});
  };
  // Only patterns that claim currency. A bare "in 2019" or "for 2024" is often a
  // legitimate citation of past research, so it is not treated as decay.
  for (const match of mainText.matchAll(/(?:as of|updated(?:\s+in)?|last updated|effective|valid through|current as of)\s+((?:19|20)\d{2})\b/gi)) collectYear(match);
  for (const match of mainText.matchAll(/\b((?:19|20)\d{2})\s+(?:pricing|prices|price list|rates|fees|fee schedule|plans?)\b/gi)) collectYear(match);
  for (const match of mainText.matchAll(/\b(?:our|this)\s+((?:19|20)\d{2})\s+(?:guide|report|study|roundup|survey|benchmark|update|edition)\b/gi)) collectYear(match);
  outdatedYearMentions.splice(3);

  const unsourcedStatisticSamples = [];
  let unsourcedStatistics = 0;
  $text('p, li').each((_, element) => {
    const node = $text(element);
    const prose = node.text().replace(/\s+/g, ' ').trim();
    if (prose.length < 40 || !reportableStatistic(prose)) return;
    if (node.find('a[href]').length || node.closest('a[href]').length) return;
    if (/\bsources?\s*:/i.test(prose)) return;
    unsourcedStatistics += 1;
    if (unsourcedStatisticSamples.length < 2) {
      // Quote the sentence that carries the figure, not the block opening.
      const sentences = prose.match(/[^.!?]+[.!?]*/g) || [prose];
      const sentence = sentences.find(part => reportableStatistic(part)) || prose;
      unsourcedStatisticSamples.push(sentence.trim().slice(0, 180));
    }
  });

  return {
    url,
    httpStatus: 200,
    title: title || url,
    wordCount,
    contentHash: crypto.createHash('sha256').update(mainText).digest('hex'),
    declaredModifiedAt: modifiedCandidates.length ? modifiedCandidates[modifiedCandidates.length - 1] : null,
    declaredPublishedAt: publishedCandidates.length ? publishedCandidates[0] : null,
    dateSource: dates.modified.length ? 'json-ld'
      : (isoDate(meta('article:modified_time')) || isoDate(meta('og:updated_time'))) ? 'meta'
        : timeTags.length ? 'time'
          : labelDate ? 'visible-label' : null,
    signals: {
      jsonLdTypes: [...new Set(dates.types)].slice(0, 20),
      h1Count,
      headingLevels: headingLevels.slice(0, 120),
      hasAuthor,
      hasFaq,
      hasStatistics,
      hasUpdatedLabel: Boolean(labelDate),
      noindex,
      copyrightYear,
      outdatedYearMentions,
      unsourcedStatistics,
      unsourcedStatisticSamples,
      internalLinks: [...new Set(internalLinks)].slice(0, 100),
      externalLinks
    }
  };
}

// Candidate accounting for one crawl. Every eligible same-origin URL the site
// publishes or links to is counted in `discovered`; the fetch queue is capped
// separately so a large site is still reported as large when only a few pages
// fit in the scan. Counting happens before the cap for exactly that reason.
function candidateQueue(origin, limit) {
  const discovered = new Set();
  const queue = [];
  const maxQueued = Math.max(1, Number(limit) || MAX_PAGES) * 8;
  return {
    queue,
    add(value) {
      let url;
      try { url = normalURL(value); } catch { return; }
      if (url.origin !== origin) return;
      if (url.search) return;
      if (SKIP_EXTENSIONS.test(url.pathname)) return;
      if (discovered.has(url.href)) return;
      discovered.add(url.href);
      if (queue.length > maxQueued) return; // counted, just not fetched
      queue.push(url.href);
    },
    track(value) { discovered.add(value); },
    count() { return discovered.size; }
  };
}

async function crawlSite({targetUrl, pageLimit = MAX_PAGES, deadlineMs = CRAWL_DEADLINE_MS} = {}) {
  let start;
  try {
    start = normalURL(targetUrl);
  } catch (error) {
    throw crawlError(error.message, 'CONTENT_DECAY_INVALID_URL');
  }

  const home = await getPage(start.href);
  if (home.status !== 200 || !/text\/html|application\/xhtml\+xml/i.test(home.type || '')) {
    throw crawlError('The site did not return a readable HTML page (HTTP ' + home.status + ').');
  }
  const origin = new URL(home.url).origin;
  const robots = await loadRobots(origin);
  if (!allowed(robots, home.url)) {
    throw crawlError('This site robots.txt does not permit our crawler at that address.', 'CONTENT_DECAY_ROBOTS_DISALLOWED');
  }

  const limit = Math.min(Math.max(Number(pageLimit) || MAX_PAGES, 1), MAX_PAGES);
  const pages = [];
  const skipped = [];
  const visited = new Set();
  const candidates = candidateQueue(origin, limit);
  const queue = candidates.queue;
  const addUrl = candidates.add;

  const homePage = analysePage(home.text, home.url);
  pages.push(homePage);
  candidates.track(home.url);
  visited.add(home.url);
  homePage.signals.internalLinks.forEach(addUrl);

  let sitemapStatus = 'Not found or unavailable';
  let sitemapComplete = false;
  try {
    const index = await getPage(origin + '/sitemap.xml');
    if (index.status === 200) {
      const parsed = sitemapEntries(index.text);
      if (parsed.children.length) {
        let total = 0;
        let childrenUnread = Math.max(0, parsed.children.length - 3);
        for (const child of parsed.children.slice(0, 3)) {
          let childUrl;
          try { childUrl = new URL(child); } catch { childrenUnread += 1; continue; }
          if (childUrl.origin !== origin) { childrenUnread += 1; continue; }
          try {
            const response = await getPage(childUrl.href);
            if (response.status !== 200) { childrenUnread += 1; continue; }
            const entries = sitemapEntries(response.text).urls;
            entries.forEach(entry => { addUrl(entry); total += 1; });
          } catch { childrenUnread += 1; /* one unreadable child sitemap does not stop the scan */ }
        }
        sitemapComplete = childrenUnread === 0;
        sitemapStatus = total
          ? total + ' URL(s) read from a sitemap index'
            + (childrenUnread ? ' (' + childrenUnread + ' child sitemap(s) not read)' : '')
          : 'Sitemap index found; no readable child sitemaps';
      } else if (parsed.urls.length) {
        parsed.urls.forEach(entry => addUrl(entry));
        sitemapComplete = true;
        sitemapStatus = parsed.urls.length + ' URL(s) read from /sitemap.xml';
      } else {
        sitemapStatus = 'Sitemap file found but no URLs were readable';
      }
    }
  } catch { /* keep the default status */ }

  const deadline = Date.now() + deadlineMs;
  while (queue.length && pages.length < limit && Date.now() < deadline) {
    const batch = [];
    while (queue.length && batch.length < 2 && pages.length + batch.length < limit) {
      const next = queue.shift();
      if (!next || visited.has(next)) continue;
      visited.add(next);
      if (!allowed(robots, next)) {
        skipped.push({url: next, reason: 'Disallowed by robots.txt'});
        continue;
      }
      batch.push(next);
    }
    if (!batch.length) continue;

    const results = await Promise.all(batch.map(async value => {
      try {
        const response = await getPage(value);
        if (new URL(response.url).origin !== origin) {
          return {skip: {url: value, reason: 'Redirected outside the submitted site'}};
        }
        if (!allowed(robots, response.url)) {
          return {skip: {url: value, reason: 'Redirect destination disallowed by robots.txt'}};
        }
        if (response.status !== 200 || !/text\/html|application\/xhtml\+xml/i.test(response.type || '')) {
          return {skip: {url: value, reason: 'Not readable HTML (HTTP ' + response.status + ')'}};
        }
        const page = analysePage(response.text, response.url);
        if (pages.some(existing => existing.url === page.url)) {
          return {skip: {url: value, reason: 'Duplicate URL after redirect'}};
        }
        return {page};
      } catch (error) {
        return {skip: {url: value, reason: error.message}};
      }
    }));

    for (const result of results) {
      if (result.page) {
        pages.push(result.page);
        result.page.signals.internalLinks.forEach(addUrl);
      } else if (result.skip) {
        skipped.push(result.skip);
      }
    }
    if (queue.length && pages.length < limit) {
      await new Promise(resolve => setTimeout(resolve, 400));
    }
  }

  // Coverage accounting. candidates.count() is every same-origin URL the site
  // published or linked to, counted before the fetch queue was capped;
  // visited.size is what was actually attempted.
  const discovered = candidates.count();
  const unvisited = Math.max(0, discovered - visited.size);
  const skippedCount = skipped.length;
  const deadlineHit = Date.now() >= deadline;
  // Unread pages can link to URLs we never saw, and an unread sitemap (missing,
  // capped at three children, or partly unreadable) can list more still. In
  // either case the count is a floor, not the site's total.
  const discoveredIsLowerBound = !sitemapComplete || unvisited > 0;
  const stopReason = unvisited === 0
    ? 'exhausted'
    : deadlineHit
      ? 'deadline'
      : pages.length >= limit
        ? 'page_limit'
        : 'queue_guard';

  return {
    hostname: start.hostname.toLowerCase(),
    origin,
    pages,
    skipped: skipped.slice(0, 25),
    discovered,
    skippedCount,
    unvisited,
    discoveredIsLowerBound,
    sitemapComplete,
    truncated: unvisited > 0 || skippedCount > 0,
    stopReason,
    deadlineHit,
    robotsStatus: robots.status,
    sitemapStatus,
    pageLimit: limit
  };
}

// Aggregate facts only. The free surface shows this; per-page detail and the
// findings themselves stay server-side until a paid entitlement exists.
function summarise(pages, today = new Date(), meta = {}) {
  const list = Array.isArray(pages) ? pages : [];
  const cutoff = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000);
  const dated = list.filter(page => page.declaredModifiedAt);
  const dates = dated.map(page => page.declaredModifiedAt).sort();
  const totalWords = list.reduce((sum, page) => sum + (page.wordCount || 0), 0);
  return {
    pagesScanned: list.length,
    averageWords: list.length ? Math.round(totalWords / list.length) : 0,
    thinPages: list.filter(page => (page.wordCount || 0) < 300).length,
    pagesWithoutSingleH1: list.filter(page => page.signals.h1Count !== 1).length,
    pagesWithDeclaredDate: dated.length,
    undatedPages: list.length - dated.length,
    staleOver12Months: dated.filter(page => new Date(page.declaredModifiedAt) < cutoff).length,
    oldestContentDate: dates[0] || null,
    newestContentDate: dates[dates.length - 1] || null,
    pagesWithJsonLd: list.filter(page => page.signals.jsonLdTypes.length > 0).length,
    pagesWithAuthor: list.filter(page => page.signals.hasAuthor).length,
    pagesWithFaq: list.filter(page => page.signals.hasFaq).length,
    internalLinksFound: list.reduce((sum, page) => sum + page.signals.internalLinks.length, 0),
    // Coverage: how much of the discovered site this summary actually describes.
    pagesDiscovered: Number.isInteger(meta.discovered) ? meta.discovered : list.length,
    // A discovered count is a floor whenever discovery stopped early; callers
    // must not present it as the site's exact size. Older callers that do not
    // send discoveredIsLowerBound are inferred from the unread count.
    pagesDiscoveredLowerBound: Number.isInteger(meta.discovered)
      ? meta.discoveredIsLowerBound === true
        || (Number.isInteger(meta.unvisited) && meta.unvisited > 0)
      : true,
    pagesSkipped: Number.isInteger(meta.skippedCount) ? meta.skippedCount : 0,
    pagesUnread: Number.isInteger(meta.unvisited) ? meta.unvisited : 0,
    coverageComplete: (Number.isInteger(meta.skippedCount) ? meta.skippedCount : 0) === 0
      && (Number.isInteger(meta.unvisited) ? meta.unvisited : 0) === 0,
    stopReason: typeof meta.stopReason === 'string' ? meta.stopReason : 'exhausted'
  };
}

module.exports = {crawlSite, analysePage, summarise, candidateQueue, normalURL, MAX_PAGES};
