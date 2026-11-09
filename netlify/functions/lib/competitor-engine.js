'use strict';

function decodeEntities(str) {
  return String(str || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n) || 32))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16) || 32));
}

function stripTags(html) {
  return decodeEntities(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function getAttr(tagOpen, attrName) {
  const re = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = String(tagOpen || '').match(re);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '').trim() : '';
}

function parseHtmlDoc(rawHtml) {
  const src = String(rawHtml || '').replace(/<!--[\s\S]*?-->/g, ' ');
  const jsonLdBlocks = [];
  for (const m of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/application\/ld\+json/i.test(getAttr(m[1], 'type'))) {
      jsonLdBlocks.push(m[2]);
    }
  }
  const clean = src.replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ');
  const titleMatch = clean.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTags(titleMatch[1]) : '';

  let description = '';
  for (const m of clean.matchAll(/<meta\b[^>]*>/gi)) {
    if (getAttr(m[0], 'name').toLowerCase() === 'description') {
      description = getAttr(m[0], 'content');
      if (description) break;
    }
  }

  let canonical = '';
  for (const m of clean.matchAll(/<link\b[^>]*>/gi)) {
    if (/\bcanonical\b/i.test(getAttr(m[0], 'rel'))) {
      canonical = getAttr(m[0], 'href');
      if (canonical) break;
    }
  }

  const h1s = [];
  const headings = [];
  for (const m of clean.matchAll(/<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const t = stripTags(m[2]);
    if (t) {
      headings.push(t);
      if (m[1].toLowerCase() === 'h1') h1s.push(t);
    }
  }

  const links = [];
  const actions = [];
  for (const m of clean.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = getAttr(m[1], 'href');
    const text = stripTags(m[2]);
    if (href) links.push({ href, text });
    if (text) actions.push(text);
  }
  for (const m of clean.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)) {
    const text = stripTags(m[1]);
    if (text) actions.push(text);
  }

  const bodyMatch = clean.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const bodyText = stripTags(bodyMatch ? bodyMatch[1] : clean);

  return { jsonLdBlocks, title, description, canonical, h1s, headings, links, actions, bodyText };
}

const STOP_WORDS = new Set([
  'the','and','for','with','that','this','from','your','you','our','are','was','were','have','has','had',
  'will','can','not','all','more','about','into','what','when','where','which','who','how','why','their',
  'they','them','there','been','being','also','than','then','just','only','over','under','such','some',
  'other','home','page','site','website','click','here','read','learn','view','get','new','use','using',
  'privacy','policy','terms','conditions','service','services','contact','copyright','reserved','rights',
  'menu','skip','navigation','main','footer','header','login','sign','account','cookie','cookies'
]);

const AUDIENCE_PATTERNS = [
  ['Small businesses & founders', /\b(small business|small-business|smb|local business|entrepreneurs?|founders?|startups?)\b/i],
  ['Homeowners & residential', /\b(homeowners?|residential|households?|families|home services?)\b/i],
  ['Enterprise & mid-market teams', /\b(enterprise|mid-market|fortune 500|corporate|global teams|organizations)\b/i],
  ['Agencies & marketing teams', /\b(agencies|agency|marketers|marketing teams?|growth teams?|seo teams?)\b/i],
  ['E-commerce & retail brands', /\b(ecommerce|e-commerce|online stores?|shopify|merchants|retailers)\b/i],
  ['Healthcare & professional practices', /\b(patients?|clinics?|medical|dental|healthcare|attorneys?|law firms?|practices?)\b/i],
  ['Developers & technical teams', /\b(developers?|engineers?|devops|api|sdk|technical teams?)\b/i]
];

function extractTopics(texts) {
  const counts = new Map();
  for (const raw of texts) {
    const words = String(raw || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && w.length <= 24 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
    for (let i = 0; i < words.length - 1; i++) {
      const phrase = `${words[i]} ${words[i + 1]}`;
      if (words[i] === words[i + 1]) continue;
      counts.set(phrase, (counts.get(phrase) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 24)
    .map(([phrase]) => phrase);
}

function parseSitePages(domain, origin, pages, meta) {
  const headings = [];
  const ctas = new Set();
  const schemaTypes = new Set();
  let publishedPrices = 0;
  let quoteSignals = 0;
  let faqSignals = 0;
  let totalWords = 0;
  let metaDescPages = 0;
  let canonicalPages = 0;
  let schemaPages = 0;
  let localSignals = 0;
  let blogResourcePages = 0;
  let pricingPageSeen = false;
  let allTextSample = '';

  let firstDoc = null;
  for (const p of pages) {
    const doc = parseHtmlDoc(p.html);
    if (!firstDoc) firstDoc = doc;
    for (const raw of doc.jsonLdBlocks) {
      if (raw.trim()) {
        schemaPages++;
        for (const m of raw.matchAll(/"@type"\s*:\s*"([A-Za-z0-9_]+)"/g)) schemaTypes.add(m[1]);
      }
    }

    const uPath = new URL(p.url).pathname.toLowerCase();
    if (/\/(pricing|plans|packages|rates)\b/.test(uPath)) pricingPageSeen = true;
    if (/\/(blog|resources|learn|guides|articles|insights|knowledge)\b/.test(uPath)) blogResourcePages++;

    if (doc.description.length >= 40) metaDescPages++;
    if (doc.canonical) canonicalPages++;
    if (doc.title) headings.push(doc.title);

    for (const t of doc.headings) {
      if (t && t.length >= 4 && t.length <= 140) {
        headings.push(t);
        if (/\?$/.test(t) || /^(what|how|why|when|who|which|can|does|is)\b/i.test(t)) faqSignals++;
      }
    }

    for (const t of doc.actions) {
      if (t.length >= 4 && t.length <= 36 && /\b(get started|book|schedule|request|contact|buy|start|try|pricing|demo|quote|consultation|audit|subscribe|download)\b/i.test(t)) {
        ctas.add(t);
      }
    }

    const bodyText = doc.bodyText;
    const words = bodyText ? bodyText.split(' ').length : 0;
    totalWords += words;
    allTextSample += ' ' + bodyText.slice(0, 6000);

    const priceMatches = bodyText.match(/\$\s?\d[\d,]*(?:\.\d{2})?(?:\s*\/\s*(?:mo|month|yr|year|page|report))?/gi) || [];
    publishedPrices += priceMatches.length;
    if (/\b(custom quote|request a quote|contact sales|custom pricing|book a call|request a consultation)\b/i.test(bodyText)) quoteSignals++;
    if (/\b(serving|located in|local|tx|ca|ny|fl|street|suite|\(\d{3}\)\s*\d{3}-\d{4})\b/i.test(bodyText) || schemaTypes.has('LocalBusiness')) localSignals++;
  }

  const homeTitle = firstDoc?.title || '';
  const homeH1 = firstDoc?.h1s?.[0] || '';

  let audienceSignal = 'General business & consumer visitors';
  for (const [label, regex] of AUDIENCE_PATTERNS) {
    if (regex.test(allTextSample)) {
      audienceSignal = label;
      break;
    }
  }

  const priceVisibility = (pricingPageSeen && publishedPrices >= 2) || publishedPrices >= 3
    ? 'Published'
    : publishedPrices >= 1
      ? 'Transparent'
      : quoteSignals >= 1
        ? 'Quote-led'
        : 'Unlisted';

  const topTopics = extractTopics(headings);
  const contentAngle = blogResourcePages > 0 || faqSignals >= 4
    ? 'Education & answer-led'
    : publishedPrices >= 2
      ? 'Offer & pricing-led'
      : quoteSignals >= 1
        ? 'Consultation-led'
        : 'Service overview';

  // Directional 0-100 readiness index from observable public signals
  const pageCount = pages.length;
  let score = 24;
  if (meta.aiBotsAllowed) score += 12;
  if (meta.hasSitemap) score += 10;
  score += Math.min(14, Math.round((metaDescPages / pageCount) * 14));
  score += Math.min(10, Math.round((canonicalPages / pageCount) * 10));
  score += Math.min(14, schemaPages > 0 ? 8 + Math.min(6, schemaTypes.size * 2) : 0);
  score += Math.min(10, faqSignals >= 5 ? 10 : faqSignals * 2);
  score += Math.min(6, totalWords >= 1200 ? 6 : Math.floor(totalWords / 250));
  score = Math.max(15, Math.min(96, score));

  const searchStrength = score >= 78 ? 'Strong' : score >= 58 ? 'Growing' : score >= 42 ? 'Moderate' : 'Emerging';
  const offerTopics = topTopics.slice(0, 3).join(', ') || 'Core services';
  const ctaList = [...ctas].slice(0, 4);

  return {
    domain,
    url: origin,
    title: homeTitle || domain,
    headline: homeH1 || homeTitle || domain,
    pagesAnalyzed: pageCount,
    urls: pages.map(p => p.url),
    score,
    searchStrength,
    audienceSignal,
    offerSummary: offerTopics,
    priceVisibility,
    contentAngle,
    aiBotsAllowed: meta.aiBotsAllowed,
    hasSitemap: meta.hasSitemap,
    schemaPages,
    schemaTypes: [...schemaTypes].slice(0, 8),
    faqSignals,
    blogResourcePages,
    topTopics,
    fourPs: {
      product: `${offerTopics} (${pageCount} key page${pageCount === 1 ? '' : 's'} reviewed; schema: ${[...schemaTypes].slice(0, 4).join(', ') || 'none detected'})`,
      price: priceVisibility === 'Published' || priceVisibility === 'Transparent'
        ? `${priceVisibility} pricing signals detected on public pages`
        : `${priceVisibility} model (visitors are guided to inquiry/quote before pricing)`,
      place: localSignals > 0
        ? 'Online web presence with regional/local service indicators'
        : 'Digital/nationwide web presence',
      promotion: ctaList.length
        ? `Primary CTAs: ${ctaList.join(' | ')}`
        : 'Standard website navigation links'
    }
  };
}

function createCompetitorEngine(deps = {}) {
  const crawler = deps.crawler || (deps.normalURL ? deps : require('./crawler'));
  const { normalURL, getPage, robotsAllowed } = crawler;

  async function crawlSingleDomain(rawUrl, { isTarget = false, maxPages = 5 } = {}) {
    const start = normalURL(rawUrl);
    let robots = '';
    try {
      const rr = await getPage(start.origin + '/robots.txt');
      if (rr.status === 200) robots = rr.text || '';
    } catch {}

    if (!robotsAllowed(robots, start.pathname + start.search, 'aeogeoauditbot')) {
      if (isTarget) throw new Error(`Your website (${start.hostname}) disallows audit crawlers in robots.txt.`);
      return { skipped: true, domain: start.hostname.replace(/^www\./i, ''), url: start.origin, reason: 'Disallowed by robots.txt' };
    }

    const first = await getPage(start.href);
    if (first.status !== 200 || !/text\/html|application\/xhtml\+xml/i.test(first.type)) {
      if (isTarget) throw new Error(`Your starting URL returned HTTP ${first.status} instead of readable HTML.`);
      return { skipped: true, domain: start.hostname.replace(/^www\./i, ''), url: start.origin, reason: `HTTP ${first.status}` };
    }

    const finalOrigin = new URL(first.url).origin;
    const domain = new URL(first.url).hostname.replace(/^www\./i, '').toLowerCase();
    if (finalOrigin !== start.origin) {
      try {
        const rr2 = await getPage(finalOrigin + '/robots.txt');
        if (rr2.status === 200) robots = rr2.text || '';
      } catch {}
    }

    let hasSitemap = /sitemap:/i.test(robots);
    if (!hasSitemap) {
      try {
        const sm = await getPage(finalOrigin + '/sitemap.xml');
        if (sm.status === 200 && /<urlset|<sitemapindex/i.test(sm.text || '')) hasSitemap = true;
      } catch {}
    }

    const aiBotsAllowed =
      robotsAllowed(robots, '/', 'oai-searchbot') &&
      robotsAllowed(robots, '/', 'perplexitybot') &&
      robotsAllowed(robots, '/', 'claudebot');

    // Discover priority internal links from homepage
    const homeDoc = parseHtmlDoc(first.text);
    const candidates = [];
    for (const link of homeDoc.links) {
      try {
        const u = new URL(link.href, first.url);
        if (u.origin !== finalOrigin || u.search) continue;
        u.hash = '';
        if (u.href === first.url) continue;
        if (/\.(pdf|zip|png|jpe?g|gif|webp|svg|mp4|css|js|xml|ico)$/i.test(u.pathname)) continue;
        if (!robotsAllowed(robots, u.pathname, 'aeogeoauditbot')) continue;
        const p = u.pathname.toLowerCase();
        const priority =
          /\/(pricing|plans|packages)\b/.test(p) ? 1 :
          /\/(services|products|solutions|features|platform)\b/.test(p) ? 2 :
          /\/(about|company|why-us)\b/.test(p) ? 3 :
          /\/(resources|blog|learn|guides|articles|faq)\b/.test(p) ? 4 : 5;
        candidates.push({ url: u.href, priority });
      } catch {}
    }

    const uniqueTargets = [];
    const seen = new Set([first.url]);
    candidates.sort((a, b) => a.priority - b.priority);
    for (const c of candidates) {
      if (seen.has(c.url)) continue;
      seen.add(c.url);
      uniqueTargets.push(c.url);
      if (uniqueTargets.length >= maxPages - 1) break;
    }

    const pages = [{ url: first.url, html: first.text }];
    const extras = await Promise.all(uniqueTargets.map(async u => {
      try {
        const res = await getPage(u);
        if (res.status === 200 && /text\/html|application\/xhtml\+xml/i.test(res.type) && new URL(res.url).origin === finalOrigin) {
          return { url: res.url, html: res.text };
        }
      } catch {}
      return null;
    }));
    for (const ex of extras) if (ex) pages.push(ex);

    const parsed = parseSitePages(domain, finalOrigin, pages, { aiBotsAllowed, hasSitemap });
    return { ...parsed, isTarget };
  }

  async function runCompetitorAnalysis({ targetUrl, competitorUrls, plan = 'single', previousReport = null, onProgress }) {
    const totalSites = 1 + competitorUrls.length;
    await onProgress?.({ phase: 'crawling_target', completedSites: 0, totalSites });

    const target = await crawlSingleDomain(targetUrl, { isTarget: true, maxPages: 5 });
    let done = 1;
    await onProgress?.({ phase: 'crawling_competitors', completedSites: done, totalSites });

    const competitors = [];
    const skippedCompetitors = [];
    // Process competitors in batches of 3 for speed + politeness
    for (let i = 0; i < competitorUrls.length; i += 3) {
      const slice = competitorUrls.slice(i, i + 3);
      const batchRes = await Promise.all(slice.map(async u => {
        try {
          return await crawlSingleDomain(u, { isTarget: false, maxPages: 4 });
        } catch (err) {
          let host = String(u);
          try { host = normalURL(u).hostname.replace(/^www\./i, ''); } catch {}
          return { skipped: true, domain: host, url: u, reason: err.message || 'Unreachable' };
        }
      }));
      for (const item of batchRes) {
        done++;
        if (item.skipped) skippedCompetitors.push(item);
        else if (item.domain !== target.domain && !competitors.some(c => c.domain === item.domain)) competitors.push(item);
      }
      await onProgress?.({ phase: 'crawling_competitors', completedSites: done, totalSites });
    }

    if (!competitors.length) {
      throw new Error('None of the entered competitor URLs returned publicly readable HTML pages. Check the competitor addresses and try again.');
    }

    const targetTopicSet = new Set(target.topTopics);
    const topicMap = new Map();
    let totalOverlapSum = 0;

    for (const comp of competitors) {
      const shared = comp.topTopics.filter(t => targetTopicSet.has(t));
      const unionSize = new Set([...target.topTopics, ...comp.topTopics]).size || 1;
      const similarity = Math.round((shared.length / unionSize) * 100);
      const sameAudience = comp.audienceSignal === target.audienceSignal;
      comp.overlapPercent = Math.min(95, similarity * 2 + (sameAudience ? 22 : 8));
      comp.relationship = comp.overlapPercent >= 32 || sameAudience ? 'Direct rival' : 'Adjacent / content rival';
      totalOverlapSum += comp.overlapPercent;

      for (const t of comp.topTopics) {
        if (!targetTopicSet.has(t)) {
          if (!topicMap.has(t)) topicMap.set(t, new Set());
          topicMap.get(t).add(comp.domain);
        }
      }
    }

    const topicGaps = [...topicMap.entries()]
      .map(([topic, set]) => ({ topic, competitors: [...set], count: set.size }))
      .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
      .slice(0, 18);

    const avgOverlap = Math.round(totalOverlapSum / competitors.length);
    const avgCompScore = Math.round(competitors.reduce((s, c) => s + c.score, 0) / competitors.length);
    const topRival = [...competitors].sort((a, b) => b.score - a.score)[0];
    const directCount = competitors.filter(c => c.relationship === 'Direct rival').length;
    const adjacentCount = competitors.length - directCount;

    // Build evidence-based SWOT
    const strengths = [];
    const weaknesses = [];
    const opportunities = [];
    const threats = [];

    if (target.score >= avgCompScore) strengths.push(`Your public search/AI readiness index (${target.score}/100) meets or leads the competitor average (${avgCompScore}/100).`);
    else weaknesses.push(`Your public search/AI readiness index (${target.score}/100) trails the analyzed competitor average (${avgCompScore}/100).`);

    if (target.aiBotsAllowed) strengths.push('Your robots.txt permits major AI answer crawlers (OAI-SearchBot, PerplexityBot, ClaudeBot).');
    else weaknesses.push('Your robots.txt restricts one or more AI search crawlers, reducing citation eligibility.');

    if (target.schemaPages > 0) strengths.push(`JSON-LD structured data detected on ${target.schemaPages} crawled page(s) (${target.schemaTypes.join(', ') || 'typed entities'}).`);
    else weaknesses.push('No JSON-LD structured data was detected on your crawled pages, while structured entities help AI engines disambiguate offers.');

    if (target.priceVisibility === 'Published' || target.priceVisibility === 'Transparent') {
      strengths.push(`${target.priceVisibility} pricing signals give buyers and AI assistants concrete package context.`);
    } else if (competitors.some(c => c.priceVisibility === 'Published' || c.priceVisibility === 'Transparent')) {
      weaknesses.push('Competitors publish transparent pricing signals while your crawled pages rely on unlisted or quote-only messaging.');
    }

    if (!strengths.length) strengths.push(`Clear primary positioning captured on ${target.domain} across ${target.pagesAnalyzed} public page(s).`);
    if (!weaknesses.length) weaknesses.push('Question-led FAQ headings and deeper comparison pages can be expanded further to defend high-intent queries.');

    if (topicGaps.length > 0) {
      opportunities.push(`Address ${topicGaps.length} uncovered competitor topic cluster(s), starting with "${topicGaps[0].topic}" and "${(topicGaps[1] || topicGaps[0]).topic}".`);
    }
    if (competitors.some(c => !c.aiBotsAllowed)) {
      opportunities.push('One or more rivals block AI search bots in robots.txt, creating an opening to win AI citations on shared buyer questions.');
    }
    if (competitors.some(c => c.schemaPages === 0)) {
      opportunities.push('Publish Service, FAQPage, and Organization schema on key commercial pages where rivals lack structured markup.');
    }
    opportunities.push('Create direct buyer-guide and comparison content clarifying how your offer, scope, and pricing compare.');

    threats.push(`Top-scoring rival ${topRival.domain} (${topRival.score}/100) shows ${topRival.searchStrength.toLowerCase()} readiness with a ${topRival.contentAngle.toLowerCase()} approach.`);
    if (avgOverlap >= 35) threats.push(`Estimated message overlap is ${avgOverlap}%, raising the risk of indistinct positioning unless differentiators are explicit.`);
    if (competitors.some(c => c.blogResourcePages > target.blogResourcePages)) {
      threats.push('Competitors with deeper educational/resource hubs may capture early-stage research and zero-click AI summaries.');
    }

    const recommendations = [];
    if (!target.aiBotsAllowed) {
      recommendations.push({ title: 'Open AI search crawler access in robots.txt', detail: 'Allow OAI-SearchBot, PerplexityBot, and ClaudeBot on public marketing pages so AI search engines can index and cite your site.' });
    }
    if (target.schemaPages === 0) {
      recommendations.push({ title: 'Add Organization, Service, and FAQPage JSON-LD', detail: `Implement accurate JSON-LD schema on ${target.domain} to match or surpass ${topRival.domain}'s entity signals.` });
    }
    if (topicGaps.length > 0) {
      recommendations.push({ title: 'Close high-priority competitor topic gaps', detail: `Publish dedicated, factual sections or articles covering: ${topicGaps.slice(0, 4).map(g => g.topic).join(', ')}.` });
    }
    if (target.priceVisibility !== 'Published' && competitors.some(c => c.priceVisibility === 'Published' || c.priceVisibility === 'Transparent')) {
      recommendations.push({ title: 'Clarify starting prices or package scope', detail: 'Where feasible, publish starting price ranges or clear scope tiers so prospects comparing transparent rivals stay engaged.' });
    }
    if (target.faqSignals < 4) {
      recommendations.push({ title: 'Add question-and-answer blocks on core service pages', detail: 'Structure common buyer questions as explicit H2/H3 questions with concise direct answers.' });
    }
    recommendations.push({ title: 'Sharpen homepage and hero differentiation', detail: `Contrast your specific audience focus (${target.audienceSignal}) and deliverables against ${topRival.domain}'s "${topRival.headline}" positioning.` });
    recommendations.push({ title: 'Strengthen conversion proof around primary CTAs', detail: 'Pair primary CTAs with clear deliverables, turnaround expectations, and verifiable credentials.' });

    let comparisonDelta = null;
    if (previousReport && previousReport.executiveSnapshot) {
      const prevScore = Number(previousReport.executiveSnapshot.yourScore) || target.score;
      const prevGaps = Number(previousReport.executiveSnapshot.topicGapCount) || 0;
      const prevSchema = Number(previousReport.target?.schemaPages) || 0;
      comparisonDelta = {
        previousDate: previousReport.generatedAt || null,
        previousScore: prevScore,
        currentScore: target.score,
        scoreDelta: target.score - prevScore,
        previousTopicGaps: prevGaps,
        currentTopicGaps: topicGaps.length,
        schemaPagesDelta: target.schemaPages - prevSchema
      };
    }

    return {
      generatedAt: new Date().toISOString(),
      plan,
      target,
      competitors,
      skippedCompetitors,
      executiveSnapshot: {
        yourScore: target.score,
        competitorAverageScore: avgCompScore,
        competitorsMapped: competitors.length,
        directCount,
        adjacentCount,
        topicGapCount: topicGaps.length,
        positioningOverlap: avgOverlap,
        quickWinCount: recommendations.length,
        summary: `${target.domain} achieved a directional readiness index of ${target.score}/100 across ${target.pagesAnalyzed} public page(s), compared with an average of ${avgCompScore}/100 across ${competitors.length} analyzed competitor(s) (${directCount} direct, ${adjacentCount} adjacent). We identified ${topicGaps.length} uncovered competitor topic cluster(s) and ${recommendations.length} prioritized next steps.`
      },
      topicGaps,
      swot: { strengths, weaknesses, opportunities, threats },
      recommendations,
      comparisonDelta,
      sources: [target, ...competitors].map(s => ({
        domain: s.domain,
        pagesAnalyzed: s.pagesAnalyzed,
        urls: s.urls
      })),
      caveats: 'All scores and comparisons are directional signals derived from live HTTPS fetches of publicly accessible HTML pages, robots.txt, and sitemaps at report runtime. They do not represent third-party traffic estimates, proprietary revenue, or live AI-platform market share.'
    };
  }

  return { runCompetitorAnalysis, crawlSingleDomain };
}

module.exports = { createCompetitorEngine };
