'use strict';
// Content Decay Predictor - PDF report.
//
// Uses the shared page engine extracted from ./competitor-pdf, so both PDFs
// keep the same hand-written PDF 1.4 writer and no PDF dependency is added.
//
// Hard limits:
//   - 10 pages maximum. The writer stops at the cap and marks the last page.
//   - Generated on demand only for an authenticated owner with an active
//     entitlement. Never written to public storage and never given a public URL.
//
// Contract:
//   buildReport({scan, pages, findings, generatedAt}) -> {bytes, pageCount, capped}

const {createPdfWriter} = require('./competitor-pdf');

const MAX_PAGES = 10;
const SEVERITY_LABEL = {critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low'};

function severityLabel(value) {
  return SEVERITY_LABEL[value] || 'Note';
}

function dateOnly(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function shortUrl(url) {
  return String(url || '').replace(/^https?:\/\//i, '');
}

function buildReport({scan, pages = [], findings = [], facts = [], factConflicts = [], generatedAt} = {}) {
  if (!scan) {
    throw Object.assign(
      new Error('A completed scan is required to build the report. Reference: CONTENT_DECAY_INVALID_REQUEST.'),
      {status: 400, code: 'CONTENT_DECAY_INVALID_REQUEST'}
    );
  }

  const host = scan.hostname || 'the scanned site';
  const created = (dateOnly(generatedAt) || new Date().toISOString().slice(0, 10));
  const completed = dateOnly(scan.completedAt);
  const summary = scan.summary || {};
  const pagesRead = Number(scan.pagesScanned ?? pages.length) || 0;
  const score = Number(scan.overallScore);
  const counts = {critical: 0, high: 0, medium: 0, low: 0};
  for (const finding of findings) {
    if (counts[finding.severity] !== undefined) counts[finding.severity] += 1;
  }
  const discovered = Number(summary.pagesDiscovered);
  const lowerBound = summary.pagesDiscoveredLowerBound === true;

  const pdf = createPdfWriter({
    maxPages: MAX_PAGES,
    headerLeft: 'AEOGEO Search | Content Decay Report',
    headerRight: `${host} | ${created}`,
    footerLeft: 'AEOGEO Search Content Decay - Rule-based readiness review',
    capNote: ' (Capped at 10 pages)',
    documentTitle: 'Content Decay Report - ' + host
  });

  pdf.startPage();
  pdf.drawTitleBlock(
    'Content Decay Report',
    `Content Decay Report: ${host}`,
    `Scan of ${scan.targetUrl || host}${completed ? ', completed ' + completed : ''}. `
      + `${pagesRead} page${pagesRead === 1 ? '' : 's'} read. Rule-based review of public HTML, capped at 10 pages.`
  );

  pdf.drawMetricsRow([
    {
      label: 'Content Health',
      value: Number.isFinite(score) ? `${Math.round(score)}/100` : 'N/A',
      note: 'Higher is healthier'
    },
    {
      label: 'Findings',
      value: String(findings.length),
      note: `${counts.critical} critical, ${counts.high} high`
    },
    {
      label: 'Pages Read',
      value: String(pagesRead),
      note: `${summary.undatedPages ?? 0} with no declared date`
    },
    {
      label: 'Stale Over 12 Months',
      value: String(summary.staleOver12Months ?? 0),
      note: 'Based on declared dates'
    }
  ]);

  pdf.drawSectionHeading('1. Score and Coverage');
  pdf.drawParagraph(
    `The content health score is an average of ${pagesRead} page score${pagesRead === 1 ? '' : 's'} on a 0-100 scale. `
    + 'A score of 100 means none of the decay rules fired on the pages read; lower scores mean more or heavier findings. '
    + 'The score describes the HTML this scan could read. It is not a measure of traffic, rankings or AI citations.'
  );
  pdf.drawBullet(`Pages read: ${pagesRead}.`);
  if (Number.isFinite(discovered)) {
    pdf.drawBullet(`Pages discovered: ${lowerBound ? 'at least ' : ''}${discovered}.`);
  }
  if (summary.pagesSkipped !== undefined || summary.pagesUnread !== undefined) {
    pdf.drawBullet(`Pages skipped: ${summary.pagesSkipped ?? 0}. Pages not reached: ${summary.pagesUnread ?? 0}.`);
  }
  pdf.drawBullet(`Pages declaring no update date: ${summary.undatedPages ?? 0}.`);
  pdf.drawBullet(`Pages declaring an update over 12 months old: ${summary.staleOver12Months ?? 0}.`);
  pdf.drawBullet(`Pages under 300 words: ${summary.thinPages ?? 0}. Pages without one clear H1: ${summary.pagesWithoutSingleH1 ?? 0}.`);
  if (facts.length || factConflicts.length) {
    pdf.drawBullet(`Facts compared across pages: ${facts.length}. Disagreements found: ${factConflicts.length}.`);
  }
  if (summary.coverageComplete === false) {
    pdf.drawParagraph(
      'This was a partial scan. The findings describe only the pages that were read; pages that were blocked, '
      + 'broken, behind a login, or not linked from the site or sitemap are not included.'
    );
  }

  pdf.drawSectionHeading('2. Findings and Fixes');
  if (!findings.length) {
    pdf.drawParagraph('No rule-based findings were recorded for the pages this scan read.');
  } else {
    const pageById = new Map(pages.map(page => [page.id, page]));
    pdf.drawParagraph('Ordered by severity, then priority. Evidence is quoted from the page the scan fetched.');
    for (const finding of findings) {
      const page = finding.pageId ? pageById.get(finding.pageId) : null;
      pdf.drawSubheading(`${severityLabel(finding.severity)}: ${finding.title || 'Finding'}`);
      if (page?.url) pdf.drawParagraph(`Page: ${shortUrl(page.url)}`, {size: 8.5});
      if (finding.detail) pdf.drawParagraph(finding.detail);
      if (finding.evidence) pdf.drawParagraph(`Evidence: ${finding.evidence}`);
      if (finding.recommendation) pdf.drawParagraph(`Fix: ${finding.recommendation}`);
      if (finding.suggestedReplacement) {
        pdf.drawParagraph(`Suggested replacement: ${finding.suggestedReplacement}`);
      }
    }
  }

  pdf.drawSectionHeading('3. Facts That Disagree');
  if (!factConflicts.length) {
    pdf.drawParagraph(
      'No disagreeing facts were found on the pages this scan read. Only facts stated in visible copy or in the '
      + 'page JSON-LD are compared: prices, phone numbers, addresses, opening hours, founding year and team size.'
    );
  } else {
    pdf.drawParagraph(
      'Each finding names two pages that state different values for the same fact, or one page whose structured '
      + 'data contradicts its own copy. Two pages are only compared when their values do not overlap, so a page that '
      + 'lists more numbers than another is not treated as a contradiction.'
    );
    for (const conflict of factConflicts) {
      pdf.drawSubheading(`${severityLabel(conflict.severity)}: ${conflict.title || 'Fact conflict'}`);
      pdf.drawParagraph(`${shortUrl(conflict.pageAUrl)}: ${conflict.valueA || ''}`, {size: 8.5});
      if (conflict.quoteA) pdf.drawParagraph(`Evidence: "${conflict.quoteA}"`, {size: 8.5});
      if (conflict.pageBUrl && conflict.pageBUrl !== conflict.pageAUrl) {
        pdf.drawParagraph(`${shortUrl(conflict.pageBUrl)}: ${conflict.valueB || ''}`, {size: 8.5});
        if (conflict.quoteB) pdf.drawParagraph(`Evidence: "${conflict.quoteB}"`, {size: 8.5});
      } else {
        pdf.drawParagraph(`The page's structured data declares: ${conflict.valueB || ''}`, {size: 8.5});
        if (conflict.quoteB) pdf.drawParagraph(`Evidence: ${conflict.quoteB}`, {size: 8.5});
      }
      if (conflict.recommendation) pdf.drawParagraph(`Fix: ${conflict.recommendation}`);
    }
  }

  pdf.drawSectionHeading('4. Pages Read');
  if (!pages.length) {
    pdf.drawParagraph('No page rows were recorded for this scan.');
  } else {
    const sorted = [...pages].sort((a, b) => {
      const left = Number.isFinite(Number(a.pageScore)) ? Number(a.pageScore) : 101;
      const right = Number.isFinite(Number(b.pageScore)) ? Number(b.pageScore) : 101;
      return left - right;
    });
    pdf.drawParagraph('Sorted by page score, lowest first.');
    for (const page of sorted) {
      const words = Number.isFinite(Number(page.wordCount)) ? `${page.wordCount} words` : 'word count unavailable';
      const pageScore = Number.isFinite(Number(page.pageScore)) ? `${page.pageScore}/100` : 'no score';
      const declared = dateOnly(page.declaredModifiedAt) || 'no declared update date';
      pdf.drawBullet(`${shortUrl(page.url)} - score ${pageScore}, ${words}, ${declared}.`);
    }
  }

  pdf.drawSectionHeading('5. Method and Limits');
  pdf.drawParagraph(
    'This report reads the HTML a server returns. It does not run page JavaScript, and it cannot see pages that are '
    + 'blocked, broken, behind a login, or not linked from the site or its sitemap. Dates come only from what a page '
    + 'declares: structured data, article metadata, a time element, or a visible last-updated label.'
  );
  pdf.drawBullet('An undated page is reported as undated, not as stale. Age alone never lowers a score.');
  pdf.drawBullet('A page with an old date but current information is not automatically decayed.');
  pdf.drawBullet('Findings are rule-based editorial signals. They are not a guarantee of search or AI visibility, traffic or revenue.');
  pdf.drawBullet('The discovered page count is a lower bound whenever the sitemap or unread pages could contain URLs the scan did not see.');
  pdf.drawParagraph(
    'Prepared by AEOGEO Search. This copy is tied to the account and scan that purchased it and was generated on demand '
    + 'for that signed-in owner.'
  );

  return pdf.finish();
}

module.exports = {buildReport, MAX_PAGES};
