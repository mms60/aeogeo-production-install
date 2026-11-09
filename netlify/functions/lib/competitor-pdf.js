'use strict';

const MAX_PAGES = 25;
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 48;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

function cleanText(value) {
  return String(value ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2022|\u00b7/g, '-')
    .replace(/\u2192/g, '->')
    .replace(/[^\x20-\x7e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pdfEscape(str) {
  return cleanText(str)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapText(text, maxChars) {
  const cleaned = cleanText(text);
  if (!cleaned) return [''];
  const words = cleaned.split(' ');
  const lines = [];
  let current = '';
  for (const w of words) {
    const word = w.length > maxChars ? w.slice(0, maxChars - 3) + '...' : w;
    if (!current) current = word;
    else if (current.length + 1 + word.length <= maxChars) current += ' ' + word;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function buildCompetitorPdf(report, meta = {}) {
  const pages = [];
  let ops = [];
  let y = 0;
  let capped = false;

  const domain = cleanText(report?.target?.domain || meta.domain || 'website');
  const created = cleanText((report?.generatedAt || meta.createdAt || new Date().toISOString()).slice(0, 10));
  const planLabel = report?.plan === 'monthly' ? 'Competitive Monitor (Monthly)' : 'Single Competitor Report';

  function startPage() {
    if (pages.length >= MAX_PAGES) {
      capped = true;
      return false;
    }
    ops = [];
    // Top navy banner
    ops.push('0.03 0.06 0.16 rg');
    ops.push(`0 ${PAGE_H - 44} ${PAGE_W} 44 re f`);
    ops.push('1 1 1 rg');
    ops.push(`BT /F2 10 Tf ${MARGIN_X} ${PAGE_H - 27} Td (AEOGEO Search | Competitive Intelligence Report) Tj ET`);
    ops.push('0.68 0.78 1 rg');
    ops.push(`BT /F1 9 Tf ${PAGE_W - MARGIN_X - 155} ${PAGE_H - 27} Td (${pdfEscape(domain)} | ${pdfEscape(created)}) Tj ET`);
    y = PAGE_H - 68;
    pages.push(ops);
    return true;
  }

  function ensureSpace(height) {
    if (capped) return false;
    if (!pages.length || y - height < 54) {
      return startPage();
    }
    return true;
  }

  function drawTitleBlock(kicker, title, subtitle) {
    if (!ensureSpace(78)) return;
    ops.push('0.17 0.31 0.75 rg');
    ops.push(`BT /F2 9 Tf ${MARGIN_X} ${y} Td (${pdfEscape(kicker.toUpperCase())}) Tj ET`);
    y -= 20;
    ops.push('0.06 0.11 0.22 rg');
    for (const line of wrapText(title, 62)) {
      if (!ensureSpace(22)) return;
      ops.push(`BT /F2 17 Tf ${MARGIN_X} ${y} Td (${pdfEscape(line)}) Tj ET`);
      y -= 21;
    }
    if (subtitle) {
      ops.push('0.32 0.39 0.48 rg');
      for (const line of wrapText(subtitle, 88)) {
        if (!ensureSpace(14)) return;
        ops.push(`BT /F1 10 Tf ${MARGIN_X} ${y} Td (${pdfEscape(line)}) Tj ET`);
        y -= 14;
      }
    }
    y -= 8;
  }

  function drawSectionHeading(title) {
    if (!ensureSpace(34)) return;
    y -= 6;
    ops.push('0.93 0.95 0.99 rg');
    ops.push(`${MARGIN_X} ${y - 6} ${CONTENT_W} 22 re f`);
    ops.push('0.17 0.31 0.75 rg');
    ops.push(`${MARGIN_X} ${y - 6} 4 22 re f`);
    ops.push('0.06 0.11 0.22 rg');
    ops.push(`BT /F2 11 Tf ${MARGIN_X + 12} ${y + 1} Td (${pdfEscape(title)}) Tj ET`);
    y -= 20;
  }

  function drawSubheading(title) {
    if (!ensureSpace(22)) return;
    y -= 3;
    ops.push('0.10 0.18 0.35 rg');
    ops.push(`BT /F2 10.5 Tf ${MARGIN_X} ${y} Td (${pdfEscape(title)}) Tj ET`);
    y -= 15;
  }

  function drawParagraph(text, { size = 9.5, indent = 0, color = '0.20 0.26 0.34', font = '/F1' } = {}) {
    const maxChars = Math.max(40, Math.floor((CONTENT_W - indent) / (size * 0.52)));
    for (const line of wrapText(text, maxChars)) {
      if (!ensureSpace(size + 5)) return;
      ops.push(`${color} rg`);
      ops.push(`BT ${font} ${size} Tf ${MARGIN_X + indent} ${y} Td (${pdfEscape(line)}) Tj ET`);
      y -= size + 4;
    }
    y -= 3;
  }

  function drawBullet(text) {
    const lines = wrapText(text, 84);
    lines.forEach((line, idx) => {
      if (!ensureSpace(14)) return;
      ops.push('0.17 0.31 0.75 rg');
      if (idx === 0) ops.push(`BT /F2 9.5 Tf ${MARGIN_X + 4} ${y} Td (-) Tj ET`);
      ops.push('0.18 0.24 0.32 rg');
      ops.push(`BT /F1 9.5 Tf ${MARGIN_X + 16} ${y} Td (${pdfEscape(line)}) Tj ET`);
      y -= 13;
    });
  }

  function drawMetricsRow(items) {
    if (!ensureSpace(58)) return;
    const gap = 10;
    const boxW = (CONTENT_W - gap * (items.length - 1)) / items.length;
    items.forEach((m, idx) => {
      const x = MARGIN_X + idx * (boxW + gap);
      ops.push('0.96 0.97 1 rg');
      ops.push(`${x.toFixed(1)} ${y - 44} ${boxW.toFixed(1)} 48 re f`);
      ops.push('0.82 0.87 0.96 RG 0.7 w');
      ops.push(`${x.toFixed(1)} ${y - 44} ${boxW.toFixed(1)} 48 re S`);
      ops.push('0.36 0.43 0.54 rg');
      ops.push(`BT /F1 8 Tf ${(x + 8).toFixed(1)} ${y - 10} Td (${pdfEscape(m.label)}) Tj ET`);
      ops.push('0.06 0.11 0.22 rg');
      ops.push(`BT /F2 15 Tf ${(x + 8).toFixed(1)} ${y - 27} Td (${pdfEscape(m.value)}) Tj ET`);
      ops.push('0.17 0.31 0.75 rg');
      ops.push(`BT /F1 7.5 Tf ${(x + 8).toFixed(1)} ${y - 39} Td (${pdfEscape(m.note)}) Tj ET`);
    });
    y -= 56;
  }

  startPage();
  drawTitleBlock(
    planLabel,
    `Competitive Intelligence Report: ${domain}`,
    `Prepared for ${report?.target?.url || domain} on ${created}. Directional public-web comparative analysis capped at 25 pages.`
  );

  const snap = report?.executiveSnapshot || {};
  drawMetricsRow([
    { label: 'Your Readiness Index', value: `${snap.yourScore ?? 0}/100`, note: 'Public HTML & AI signals' },
    { label: 'Competitors Mapped', value: String(snap.competitorsMapped ?? 0), note: `${snap.directCount ?? 0} direct, ${snap.adjacentCount ?? 0} adjacent` },
    { label: 'Search Topic Gaps', value: String(snap.topicGapCount ?? 0), note: 'Uncovered topic clusters' },
    { label: 'Positioning Overlap', value: `${snap.positioningOverlap ?? 0}%`, note: `${snap.quickWinCount ?? 0} prioritized quick wins` }
  ]);

  drawSectionHeading('1. Executive Snapshot');
  drawParagraph(snap.summary || 'Comparative analysis of your public website and selected competitors across positioning, audience signals, the 4 Ps, search/AI readiness, and content coverage.');

  if (report?.comparisonDelta) {
    const d = report.comparisonDelta;
    drawSubheading(`Month-to-Month Comparison (vs. ${cleanText((d.previousDate || '').slice(0, 10))})`);
    drawBullet(`Readiness index change: ${d.scoreDelta >= 0 ? '+' : ''}${d.scoreDelta} points (previous: ${d.previousScore}/100, current: ${d.currentScore}/100).`);
    drawBullet(`Structured data pages delta: ${d.schemaPagesDelta >= 0 ? '+' : ''}${d.schemaPagesDelta}; uncovered competitor topic gaps: ${d.previousTopicGaps} -> ${d.currentTopicGaps}.`);
  }

  drawSectionHeading('2. Competitive Positioning Matrix');
  const allSites = [report?.target, ...(report?.competitors || [])].filter(Boolean);
  for (const site of allSites) {
    const tag = site.isTarget ? '[YOUR SITE]' : `[${(site.relationship || 'Competitor').toUpperCase()}]`;
    drawSubheading(`${tag} ${site.domain} - Readiness Index: ${site.score}/100`);
    drawBullet(`Audience signal: ${site.audienceSignal || 'General market'} | Offer: ${site.offerSummary || 'Website services'}`);
    drawBullet(`Price visibility: ${site.priceVisibility || 'Quote-led'} | Search readiness: ${site.searchStrength || 'Moderate'} | Content angle: ${site.contentAngle || 'Informational'}`);
  }

  drawSectionHeading('3. Competitor-by-Competitor Insights (Audience & 4 Ps)');
  for (const comp of report?.competitors || []) {
    drawSubheading(`${comp.domain} (${comp.relationship || 'Direct rival'} - Index ${comp.score}/100)`);
    drawBullet(`Headline positioning: ${comp.headline || comp.title || comp.domain}`);
    drawBullet(`Product / Offer: ${comp.fourPs?.product || comp.offerSummary}`);
    drawBullet(`Price transparency: ${comp.fourPs?.price || comp.priceVisibility}`);
    drawBullet(`Place / Channels: ${comp.fourPs?.place || 'Online website presence'}`);
    drawBullet(`Promotion & CTAs: ${comp.fourPs?.promotion || 'Standard contact pathways'}`);
    drawBullet(`Top observed topics: ${(comp.topTopics || []).slice(0, 6).join(', ') || 'General brand terms'}`);
  }

  drawSectionHeading('4. Your 4 Ps vs. Market Landscape');
  const own4p = report?.target?.fourPs || {};
  drawBullet(`Your Product / Offer signals: ${own4p.product || report?.target?.offerSummary || 'Core website pages analyzed'}`);
  drawBullet(`Your Price visibility: ${own4p.price || report?.target?.priceVisibility || 'Not prominently published on crawled pages'}`);
  drawBullet(`Your Place / Distribution signals: ${own4p.place || 'Website conversion flow'}`);
  drawBullet(`Your Promotion / CTA signals: ${own4p.promotion || 'Primary navigation CTAs'}`);

  drawSectionHeading('5. Search Visibility & Content Topic Gaps');
  drawParagraph('Directional readiness reflects public HTML structure, robots.txt AI crawler permissions, sitemap discovery, JSON-LD schema, headings, and answer-ready FAQ/list formatting. It is not measured market share or third-party traffic.');
  const gaps = report?.topicGaps || [];
  if (gaps.length) {
    drawSubheading('Uncovered Competitor Topic Clusters to Evaluate');
    for (const g of gaps.slice(0, 18)) {
      drawBullet(`${g.topic} (covered by ${(g.competitors || []).join(', ')})`);
    }
  } else {
    drawBullet('Your crawled pages already cover the primary multi-competitor topic clusters detected in this run.');
  }

  drawSectionHeading('6. SWOT Analysis');
  const swot = report?.swot || {};
  for (const [label, list] of [
    ['Strengths', swot.strengths],
    ['Weaknesses', swot.weaknesses],
    ['Opportunities', swot.opportunities],
    ['Threats', swot.threats]
  ]) {
    drawSubheading(label);
    for (const item of (list || []).slice(0, 5)) drawBullet(item);
  }

  drawSectionHeading('7. Prioritized Action Plan');
  (report?.recommendations || []).slice(0, 8).forEach((rec, i) => {
    drawSubheading(`Step ${i + 1}: ${rec.title || 'Priority action'}`);
    drawBullet(rec.detail || '');
  });

  drawSectionHeading('8. Source Notes & Data Caveats');
  drawParagraph(report?.caveats || 'All findings come from live HTTPS fetches of publicly accessible HTML pages, robots.txt, and sitemaps at report runtime. Scores represent technical and content readiness signals, not proprietary traffic, revenue, or live AI-answer share.');
  for (const src of (report?.sources || []).slice(0, 24)) {
    drawBullet(`${src.domain}: ${src.pagesAnalyzed} public page(s) analyzed (${(src.urls || []).slice(0, 3).join(', ')})`);
  }

  const totalPages = pages.length;
  pages.forEach((pOps, idx) => {
    pOps.push('0.82 0.87 0.94 RG 0.5 w');
    pOps.push(`${MARGIN_X} 42 ${PAGE_W - MARGIN_X} 42 m S`);
    pOps.push('0.38 0.45 0.55 rg');
    const capNote = capped && idx === totalPages - 1 ? ' (Capped at 25 pages per package specification)' : '';
    pOps.push(`BT /F3 8 Tf ${MARGIN_X} 28 Td (AEOGEO Search Competitive Intelligence - Directional public-web signals${pdfEscape(capNote)}) Tj ET`);
    pOps.push(`BT /F1 8 Tf ${PAGE_W - MARGIN_X - 62} 28 Td (Page ${idx + 1} of ${totalPages}) Tj ET`);
  });

  // Assemble PDF 1.4 object table
  const objects = [];
  const addObj = body => {
    objects.push(body);
    return objects.length;
  };

  const fontRegular = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontBold = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const fontItalic = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>');
  const pagesObjNum = addObj(''); // placeholder

  const pageNums = pages.map(pOps => {
    const stream = pOps.join('\n');
    const contentNum = addObj(`<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`);
    return addObj(
      `<< /Type /Page /Parent ${pagesObjNum} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R /F3 ${fontItalic} 0 R >> >> ` +
      `/Contents ${contentNum} 0 R >>`
    );
  });

  objects[pagesObjNum - 1] = `<< /Type /Pages /Count ${pageNums.length} /Kids [${pageNums.map(n => `${n} 0 R`).join(' ')}] >>`;
  const catalogNum = addObj(`<< /Type /Catalog /Pages ${pagesObjNum} 0 R >>`);
  const infoNum = addObj(`<< /Title (${pdfEscape('Competitive Intelligence Report - ' + domain)}) /Creator (AEOGEO Search) >>`);

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, idx) => {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${idx + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNum} 0 R /Info ${infoNum} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return { bytes: Buffer.from(pdf, 'ascii'), pageCount: pageNums.length };
}

module.exports = { buildCompetitorPdf, MAX_PAGES };
