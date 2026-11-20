'use strict';
// Content Decay Predictor - analysis layer (Phase 4).
//
// Deliberately rule-based. Every finding comes from an explicit, deterministic
// check, so the same page always produces the same result and nothing is
// invented. The AI enrichment layer is optional, disabled by default and only
// ever rewrites prose around findings this module already established.
//
// Frozen rule requirements the implementation honours:
//   - Never lower a page score for age alone. An old page with current facts is
//     not decayed. `freshness_declared_stale` records an old declared date as a
//     review note with zero score weight; decay needs a positive signal such as
//     an outdated year reference, an outdated copyright line, missing current
//     information or an uncited statistic.
//   - Never state a factual claim as verified. An uncited figure is reported as
//     unsupported, not as false, and the evidence quotes what the page says.
//
// Contract:
//   analyseScan({pages, today}) -> {
//     overallScore, summary,
//     pages: [{url, pageScore, severity, findingCount}],
//     findings: [{pageUrl, category, code, severity, priority, title,
//                 detail, evidence, recommendation, suggestedReplacement}]
//   }
//
// Pages that declare `noindex` are excluded: they are not meant to rank or be
// cited, so scoring them would invent decay that does not matter.

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_MS = 365 * DAY_MS;
const RULES_VERSION = 1;

// Score cost per finding. A zero weight is used only by the age note, so age
// can never lower a score by itself.
const WEIGHT = Object.freeze({critical: 18, high: 12, medium: 7, low: 3});
const RANK = Object.freeze({low: 1, medium: 2, high: 3, critical: 4});

const clampScore = value => Math.max(0, Math.min(100, Math.round(value)));
const list = value => (Array.isArray(value) ? value : []);
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

const RULES = Object.freeze([
  {
    code: 'structure_missing_h1',
    category: 'structure',
    severity: 'high',
    priority: 80,
    test(page) {
      const signals = page.signals || {};
      if (signals.h1Count !== 0) return null;
      const title = clean(page.title);
      return {
        title: 'Page has no H1 heading',
        detail: 'The page has no level-one heading, so neither a reader nor a search system gets one clear statement of what the page is about.',
        evidence: 'h1 count: 0',
        recommendation: 'Add one H1 that states the page topic. One heading, not a logo or slogan.',
        suggestedReplacement: title && title !== page.url ? title : null
      };
    }
  },
  {
    code: 'structure_multiple_h1',
    category: 'structure',
    severity: 'low',
    priority: 20,
    test(page) {
      const count = Number(page.signals?.h1Count);
      if (!Number.isInteger(count) || count < 2) return null;
      return {
        title: 'Page uses more than one H1',
        detail: 'Several level-one headings compete for the same role, which blurs the page\'s main topic.',
        evidence: 'h1 count: ' + count,
        recommendation: 'Keep one H1 for the page topic and demote the others to H2 or lower.',
        suggestedReplacement: null
      };
    }
  },
  {
    code: 'structure_thin_content',
    category: 'structure',
    severity: 'medium',
    priority: 50,
    test(page) {
      const words = Number(page.wordCount);
      if (!Number.isFinite(words) || words >= 300) return null;
      return {
        title: 'Page has less than 300 words of body copy',
        detail: 'There is little text for a reader or an AI answer to work with, so the page is unlikely to answer a real question on its own.',
        evidence: 'word count: ' + words,
        recommendation: 'Add the missing detail a customer would need: what the service is, who it is for, what it costs and what happens next.',
        suggestedReplacement: null
      };
    }
  },
  {
    code: 'ai_readiness_no_structured_data',
    category: 'ai_readiness',
    severity: 'medium',
    priority: 45,
    test(page) {
      if (list(page.signals?.jsonLdTypes).length) return null;
      return {
        title: 'Page has no structured data',
        detail: 'No JSON-LD block was found, so the page relies on prose alone for machines to understand its topic, author and dates.',
        evidence: 'JSON-LD types: none',
        recommendation: 'Add one JSON-LD block that describes what the page is (for example Article, Service or FAQPage), matching the visible content.',
        suggestedReplacement: null
      };
    }
  },
  {
    code: 'ai_readiness_no_author_signal',
    category: 'ai_readiness',
    severity: 'low',
    priority: 25,
    test(page) {
      const signals = page.signals || {};
      if (Number(page.wordCount) < 600 || signals.hasAuthor) return null;
      return {
        title: 'Long page has no author or byline signal',
        detail: 'A substantial page with no author, byline or Person/Organization structured data gives readers and AI systems less evidence of who stands behind it.',
        evidence: 'word count: ' + Number(page.wordCount) + ', author signal: none',
        recommendation: 'Add a named author or the publishing organization, in the visible page and in structured data.',
        suggestedReplacement: null
      };
    }
  },
  {
    code: 'freshness_no_declared_date',
    category: 'freshness',
    severity: 'low',
    priority: 30,
    test(page) {
      if (page.declaredModifiedAt || page.declaredPublishedAt) return null;
      return {
        title: 'Page declares no update or publication date',
        detail: 'No date was declared in JSON-LD, article metadata, a time element or a visible updated label. This page is reported as undated, not as stale.',
        evidence: 'declared date: none',
        recommendation: 'Declare a real modification date where the page states it, so the page can be judged on evidence rather than guesswork.',
        suggestedReplacement: null
      };
    }
  },
  {
    // Age note only. Weight 0: an old declared date never lowers a score alone.
    code: 'freshness_declared_stale',
    category: 'freshness',
    severity: 'low',
    priority: 15,
    weight: 0,
    test(page, context) {
      if (!page.declaredModifiedAt) return null;
      const when = new Date(page.declaredModifiedAt);
      if (Number.isNaN(when.getTime()) || when >= context.cutoff) return null;
      return {
        title: 'Declared update is more than 12 months old',
        detail: 'The page says it was last updated on ' + when.toISOString().slice(0, 10) + '. Age alone is not decay: this is a review note, and it does not lower the score.',
        evidence: 'declaredModifiedAt: ' + page.declaredModifiedAt,
        recommendation: 'Confirm the prices, dates, links and facts are still current. Update the declared date only after a real review.',
        suggestedReplacement: null
      };
    }
  },
  {
    code: 'outdated_data_copyright_year',
    category: 'outdated_data',
    severity: 'medium',
    priority: 55,
    test(page, context) {
      const raw = page.signals?.copyrightYear;
      const year = Number.isInteger(raw) ? raw : null;
      const currentYear = context.today.getUTCFullYear();
      if (year === null || year <= 0 || year >= currentYear) return null;
      return {
        title: 'Copyright line names an earlier year',
        detail: 'The page shows a copyright year of ' + year + ' while the current year is ' + currentYear + '. That is a visible sign the page has not been reviewed.',
        evidence: '© ' + year,
        recommendation: 'Update the copyright line if the site is actively maintained, or remove the year from the line.',
        suggestedReplacement: null
      };
    }
  },
  {
    code: 'outdated_data_year_reference',
    category: 'outdated_data',
    severity: 'medium',
    priority: 60,
    test(page) {
      const mentions = list(page.signals?.outdatedYearMentions);
      if (!mentions.length) return null;
      const years = mentions.map(item => Number(item.year)).filter(Number.isInteger);
      if (!years.length) return null;
      return {
        title: 'Page refers to ' + years.join(', ') + ', which may be out of date',
        detail: 'A time-sensitive statement names ' + years.join(', ') + '. Confirm it still applies before treating the page as current.',
        evidence: mentions
          .map(item => Number(item.year) + ': "' + clean(item.context).slice(0, 120) + '"')
          .join(' | ')
          .slice(0, 400),
        recommendation: 'Recheck each dated statement. Replace the year only after the underlying fact has been verified, or remove the dated claim.',
        suggestedReplacement: null
      };
    }
  },
  {
    code: 'factual_support_uncited_statistic',
    category: 'factual_support',
    severity: 'low',
    priority: 35,
    test(page) {
      const count = Number(page.signals?.unsourcedStatistics);
      if (!Number.isInteger(count) || count < 1) return null;
      const samples = list(page.signals?.unsourcedStatisticSamples);
      return {
        title: count === 1 ? 'Figure appears without a source' : 'Figures appear without a source',
        detail: count + (count === 1 ? ' block contains' : ' blocks contain') + ' a statistic with no citation in the same block. These figures are reported as unsupported, not as false.',
        evidence: samples.map(sample => '"' + clean(sample).slice(0, 160) + '"').join(' | ').slice(0, 400) || null,
        recommendation: 'Name the source and its date next to the figure, or remove the figure.',
        suggestedReplacement: null
      };
    }
  }
]);

function severityOf(findings) {
  return findings.reduce(
    (worst, finding) => (RANK[finding.severity] > RANK[worst] ? finding.severity : worst),
    'low'
  );
}

function analyseScan({pages = [], today = new Date()} = {}) {
  const list_ = list(pages);
  const now = today instanceof Date && !Number.isNaN(today.getTime()) ? today : new Date();
  const cutoff = new Date(now.getTime() - STALE_MS);
  const context = {today: now, cutoff};

  const findings = [];
  const scored = [];
  let skippedNoindex = 0;

  list_.forEach((page, index) => {
    const signals = page && page.signals ? page.signals : {};
    if (signals.noindex === true) {
      skippedNoindex += 1;
      return;
    }

    const pageFindings = [];
    let penalty = 0;
    for (const rule of RULES) {
      let result = null;
      try {
        result = rule.test(page, context);
      } catch {
        result = null;
      }
      if (!result) continue;
      penalty += Number.isFinite(rule.weight) ? rule.weight : WEIGHT[rule.severity];
      pageFindings.push({
        pageUrl: page.url,
        category: rule.category,
        code: rule.code,
        severity: rule.severity,
        priority: rule.priority,
        title: result.title,
        detail: result.detail || null,
        evidence: result.evidence === undefined ? null : result.evidence,
        recommendation: result.recommendation || null,
        suggestedReplacement: result.suggestedReplacement || null,
        _index: index
      });
    }

    findings.push(...pageFindings);
    scored.push({
      url: page.url,
      pageScore: clampScore(100 - penalty),
      severity: pageFindings.length ? severityOf(pageFindings) : null,
      findingCount: pageFindings.length
    });
  });

  findings.sort((a, b) => RANK[b.severity] - RANK[a.severity]
    || b.priority - a.priority
    || a._index - b._index);

  const clean_ = findings.map(({_index, ...finding}) => finding);
  const overallScore = scored.length
    ? clampScore(scored.reduce((sum, page) => sum + page.pageScore, 0) / scored.length)
    : 0;

  const summary = {
    rulesVersion: RULES_VERSION,
    pagesAnalysed: scored.length,
    pagesSkippedNoindex: skippedNoindex,
    findings: clean_.length,
    critical: clean_.filter(finding => finding.severity === 'critical').length,
    high: clean_.filter(finding => finding.severity === 'high').length,
    medium: clean_.filter(finding => finding.severity === 'medium').length,
    low: clean_.filter(finding => finding.severity === 'low').length,
    pagesWithFindings: scored.filter(page => page.findingCount > 0).length
  };

  return {overallScore, summary, pages: scored, findings: clean_};
}

module.exports = {analyseScan, RULES, RULES_VERSION};
