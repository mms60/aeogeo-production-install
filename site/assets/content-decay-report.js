'use strict';
// Content Decay Predictor - paid report view.
//
// Nothing here decides access. The page asks the API for the report with the
// signed-in session; the server checks the entitlement for this exact user and
// scan, and returns 402 when it is missing. The page only renders what the API
// returned, and never fetches findings from anywhere else.

(() => {
  const params = new URLSearchParams(location.search);
  const scanId = String(params.get('scan') || '').trim();
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const SEVERITY_LABEL = {critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low'};
  const CATEGORY_LABEL = {
    outdated_data: 'Outdated data',
    missing_information: 'Missing information',
    structure: 'Structure',
    ai_readiness: 'AI readiness',
    freshness: 'Freshness',
    factual_support: 'Factual support'
  };
  const FACT_KIND_LABEL = {
    contradiction: 'Two pages disagree',
    drift: 'Possibly outdated page',
    jsonld_vs_visible: 'Structured data vs copy'
  };
  const FACT_CATEGORY_LABEL = {
    pricing: 'Pricing',
    phone: 'Phone',
    address: 'Address',
    hours: 'Hours',
    founded: 'History',
    headcount: 'Team'
  };

  const title = document.getElementById('cd-report-title');
  const meta = document.getElementById('cd-report-meta');
  const status = document.getElementById('cd-report-status');
  const ctaWrap = document.getElementById('cd-report-cta-wrap');
  const cta = document.getElementById('cd-report-cta');
  const body = document.getElementById('cd-report-body');
  const overall = document.getElementById('cd-overall');
  const severityWrap = document.getElementById('cd-severity');
  const metrics = document.getElementById('cd-report-metrics');
  const note = document.getElementById('cd-report-note');
  const findingsWrap = document.getElementById('cd-findings');
  const noFindings = document.getElementById('cd-no-findings');
  const factsWrap = document.getElementById('cd-facts');
  const noFacts = document.getElementById('cd-no-facts');
  const pagesBody = document.getElementById('cd-pages-body');
  const pdfButton = document.getElementById('cd-pdf');
  const pdfStatus = document.getElementById('cd-pdf-status');
  if (!status || !body) return;

  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  };

  const setStatus = (message, kind) => {
    status.textContent = message || '';
    status.className = 'cd-status' + (kind ? ' is-' + kind : '');
  };

  const setCta = (label, href) => {
    if (!cta || !ctaWrap) return;
    ctaWrap.hidden = !label;
    if (label) {
      cta.textContent = label;
      cta.href = href;
    }
  };

  const safeHttp = value => {
    try {
      const url = new URL(String(value));
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch {
      return '';
    }
  };

  const dateText = value => {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? ''
      : date.toLocaleDateString(undefined, {year: 'numeric', month: 'short', day: 'numeric'});
  };

  const badge = severity => {
    const key = SEVERITY_LABEL[severity] ? severity : 'low';
    return node('span', 'cd-badge cd-badge-' + key, SEVERITY_LABEL[severity] || 'Note');
  };

  function pageLink(url) {
    const href = safeHttp(url);
    const element = node('a', 'cd-page-link', url);
    if (href) {
      element.href = href;
      element.rel = 'noopener noreferrer';
      element.target = '_blank';
    }
    return element;
  }

  function renderMetrics(scan, pages, findings, facts, conflicts) {
    const summary = scan.summary || {};
    const discovered = Number(summary.pagesDiscovered);
    const lowerBound = summary.pagesDiscoveredLowerBound === true;
    const rows = [
      ['Pages read', String(scan.pagesScanned ?? pages.length), ''],
      ...(Number.isFinite(discovered)
        ? [['Pages discovered', (lowerBound ? 'at least ' : '') + discovered, '']]
        : []),
      ['Pages declaring no date', String(summary.undatedPages ?? 0), summary.undatedPages ? 'cd-warn' : 'cd-good'],
      ['Declared stale over 12 months', String(summary.staleOver12Months ?? 0), summary.staleOver12Months ? 'cd-warn' : 'cd-good'],
      ['Pages under 300 words', String(summary.thinPages ?? 0), summary.thinPages ? 'cd-warn' : 'cd-good'],
      ['Pages without one clear H1', String(summary.pagesWithoutSingleH1 ?? 0), summary.pagesWithoutSingleH1 ? 'cd-warn' : 'cd-good'],
      ['Findings', String(findings.length), findings.length ? 'cd-warn' : 'cd-good'],
      ...(facts.length || conflicts.length
        ? [
          ['Facts compared', String(facts.length), ''],
          ['Facts that disagree', String(conflicts.length), conflicts.length ? 'cd-warn' : 'cd-good']
        ]
        : [])
    ];

    metrics.textContent = '';
    for (const [term, value, tone] of rows) {
      const cell = node('div', 'cd-metric');
      const dt = node('dt', null, term);
      const dd = node('dd', tone || null, value);
      cell.append(dt, dd);
      metrics.append(cell);
    }

    const parts = [
      'Pages that were blocked, broken, behind a login, or not linked from the site or sitemap are not in this report.'
    ];
    if (summary.coverageComplete === false) {
      parts.push('This scan was partial: findings describe only the pages that were read.');
    }
    if (Number.isFinite(discovered) && lowerBound) {
      parts.push('The discovered count is a lower bound; the sitemap or unread pages may contain more URLs.');
    }
    parts.push('An undated page is reported as undated, not as stale, and age alone never lowers a score.');
    note.textContent = parts.join(' ');
  }

  function renderSeverity(findings) {
    const counts = {critical: 0, high: 0, medium: 0, low: 0};
    for (const finding of findings) {
      if (counts[finding.severity] !== undefined) counts[finding.severity] += 1;
    }
    severityWrap.textContent = '';
    for (const key of ['critical', 'high', 'medium', 'low']) {
      const cell = node('div', 'cd-sev-count is-' + key);
      const value = node('b', null, counts[key]);
      const label = node('span', null, SEVERITY_LABEL[key]);
      cell.append(value, label);
      severityWrap.append(cell);
    }
  }

  function renderFindings(findings, pageById) {
    findingsWrap.textContent = '';
    noFindings.hidden = findings.length > 0;
    if (!findings.length) return;

    for (const finding of findings) {
      const card = node('article', 'cd-finding is-' + (SEVERITY_LABEL[finding.severity] ? finding.severity : 'low'));
      const head = node('div', 'cd-finding-head');
      head.append(badge(finding.severity));
      if (finding.category) {
        head.append(node('span', 'cd-finding-category', CATEGORY_LABEL[finding.category] || finding.category));
      }
      card.append(head);
      card.append(node('h3', 'cd-finding-title', finding.title || 'Finding'));

      const page = finding.pageId ? pageById.get(finding.pageId) : null;
      if (page && page.url) {
        const line = node('p', 'cd-finding-page');
        line.append(pageLink(page.url));
        card.append(line);
      }

      if (finding.detail) card.append(node('p', 'cd-finding-detail', finding.detail));

      if (finding.evidence) {
        const quote = node('blockquote', 'cd-evidence', finding.evidence);
        card.append(quote);
      }

      if (finding.recommendation) {
        const fix = node('p', 'cd-fix');
        fix.append(node('strong', null, 'Fix: '), document.createTextNode(finding.recommendation));
        card.append(fix);
      }

      if (finding.suggestedReplacement) {
        card.append(node('p', 'cd-suggestion-label', 'Suggested replacement'));
        card.append(node('pre', 'cd-replacement', finding.suggestedReplacement));
      }

      findingsWrap.append(card);
    }
  }

  function factSide(url, value, quote, label) {
    const side = node('div', 'cd-fact-side');
    side.append(node('span', 'cd-fact-side-label', label || 'Stated here'));
    if (url) side.append(pageLink(url));
    if (value) side.append(node('p', 'cd-fact-value', value));
    if (quote) side.append(node('blockquote', 'cd-evidence', quote));
    return side;
  }

  // Renders only what the API returned. Each conflict already carries both
  // pages and both quotes, so nothing is reconstructed in the browser.
  function renderFacts(conflicts, facts) {
    if (!factsWrap) return;
    factsWrap.textContent = '';
    if (noFacts) {
      noFacts.hidden = conflicts.length > 0;
      noFacts.textContent = facts.length
        ? 'No disagreeing facts were found on the pages this scan read.'
        : 'No comparable facts were found in the visible copy or JSON-LD of the pages this scan read.';
    }

    for (const conflict of conflicts) {
      const key = SEVERITY_LABEL[conflict.severity] ? conflict.severity : 'low';
      const card = node('article', 'cd-finding is-' + key);
      const head = node('div', 'cd-finding-head');
      head.append(badge(conflict.severity));
      head.append(node('span', 'cd-finding-category', FACT_KIND_LABEL[conflict.kind] || 'Fact'));
      if (conflict.category) {
        head.append(node('span', 'cd-finding-category', FACT_CATEGORY_LABEL[conflict.category] || conflict.category));
      }
      card.append(head);
      card.append(node('h3', 'cd-finding-title', conflict.title || 'Fact conflict'));
      if (conflict.detail) card.append(node('p', 'cd-finding-detail', conflict.detail));

      // A structured-data conflict is one page against itself, so the two
      // sides are labelled by source instead of both saying "stated here".
      const samePage = conflict.pageAUrl === conflict.pageBUrl;
      const sides = node('div', 'cd-fact-sides');
      sides.append(factSide(conflict.pageAUrl, conflict.valueA, conflict.quoteA,
        samePage ? 'Visible copy' : 'Stated here'));
      sides.append(factSide(conflict.pageBUrl, conflict.valueB, conflict.quoteB,
        samePage ? 'Structured data' : 'Stated here'));
      card.append(sides);

      if (conflict.recommendation) {
        const fix = node('p', 'cd-fix');
        fix.append(node('strong', null, 'Fix: '), document.createTextNode(conflict.recommendation));
        card.append(fix);
      }

      factsWrap.append(card);
    }
  }

  function renderPages(pages) {
    pagesBody.textContent = '';
    const sorted = [...pages].sort((a, b) => {
      const left = Number.isFinite(Number(a.pageScore)) ? Number(a.pageScore) : 101;
      const right = Number.isFinite(Number(b.pageScore)) ? Number(b.pageScore) : 101;
      return left - right;
    });

    for (const page of sorted) {
      const row = document.createElement('tr');
      const pageCell = document.createElement('td');
      pageCell.append(pageLink(page.url));
      if (page.title) pageCell.append(node('div', 'cd-help', page.title));

      const words = document.createElement('td');
      words.className = 'cd-num';
      words.textContent = Number.isFinite(Number(page.wordCount)) ? String(page.wordCount) : '—';

      const declared = document.createElement('td');
      declared.textContent = dateText(page.declaredModifiedAt) || 'None declared';

      const score = document.createElement('td');
      score.className = 'cd-num';
      score.textContent = Number.isFinite(Number(page.pageScore)) ? String(page.pageScore) : '—';

      const severity = document.createElement('td');
      severity.append(badge(page.severity));

      row.append(pageCell, words, declared, score, severity);
      pagesBody.append(row);
    }
  }

  async function downloadPdf() {
    if (!pdfButton || pdfButton.disabled) return;
    pdfButton.disabled = true;
    if (pdfStatus) {
      pdfStatus.textContent = 'Preparing your PDF…';
      pdfStatus.className = 'cd-status is-busy';
    }
    try {
      const active = await ContentDecaySession.session();
      if (!active) {
        if (pdfStatus) {
          pdfStatus.textContent = 'Sign in again to download the PDF.';
          pdfStatus.className = 'cd-status is-error';
        }
        return;
      }
      const {blob, filename} = await ContentDecaySession.download('report.pdf', {
        token: active.access_token,
        scan: scanId
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      if (pdfStatus) {
        pdfStatus.textContent = 'PDF downloaded.';
        pdfStatus.className = 'cd-status';
      }
    } catch (error) {
      if (pdfStatus) {
        pdfStatus.textContent = error.status === 401
          ? 'Your session has ended. Sign in again to download the PDF.'
          : (error.message || 'The PDF could not be downloaded.');
        pdfStatus.className = 'cd-status is-error';
      }
    } finally {
      pdfButton.disabled = false;
    }
  }

  if (pdfButton) pdfButton.addEventListener('click', downloadPdf);

  function render(data, email) {
    const scan = data.scan || {};
    const pages = Array.isArray(data.pages) ? data.pages : [];
    const findings = Array.isArray(data.findings) ? data.findings : [];
    const host = scan.hostname || 'the scanned site';

    document.title = 'Content Decay report · ' + host + ' | AEOGEO Search';
    title.textContent = 'Content Decay report: ' + host;

    const completed = dateText(scan.completedAt);
    meta.textContent = 'Scan of ' + host + ' · ' + (scan.pagesScanned ?? pages.length) + ' page'
      + ((scan.pagesScanned ?? pages.length) === 1 ? '' : 's') + ' read'
      + (completed ? ' · completed ' + completed : '')
      + (email ? ' · ' + email : '');

    const score = Number(scan.overallScore);
    overall.textContent = Number.isFinite(score) ? String(Math.round(score)) : '—';

    const facts = Array.isArray(data.facts) ? data.facts : [];
    const factConflicts = Array.isArray(data.factConflicts) ? data.factConflicts : [];

    renderSeverity(findings);
    renderMetrics(scan, pages, findings, facts, factConflicts);
    const pageById = new Map(pages.map(page => [page.id, page]));
    renderFindings(findings, pageById);
    renderFacts(factConflicts, facts);
    renderPages(pages);

    if (pdfButton) pdfButton.hidden = false;
    body.hidden = false;
  }

  async function load() {
    if (!UUID.test(scanId)) {
      title.textContent = 'This report link is incomplete';
      meta.textContent = 'The link did not include the scan the report belongs to.';
      setStatus('Open the report from the scan that was purchased, or run a new scan.', 'error');
      setCta('Go to the free scan', '/content-decay/');
      return;
    }

    if (!window.ContentDecaySession) {
      setStatus('Sign-in could not load. Refresh the page and try again.', 'error');
      return;
    }

    setStatus('Checking your purchase…', 'busy');
    const active = await ContentDecaySession.session();
    if (!active) {
      title.textContent = 'Sign in to open this report';
      meta.textContent = 'Reports are private to the account that bought them.';
      setStatus('You are not signed in.', 'error');
      setCta('Sign in to continue', ContentDecaySession.signInUrl(location.pathname + location.search));
      return;
    }

    try {
      const data = await ContentDecaySession.api('report', {
        token: active.access_token,
        scan: scanId
      });
      setStatus('');
      setCta('');
      render(data, active.user?.email || '');
    } catch (error) {
      if (error.status === 401) {
        setStatus('Your session has ended. Sign in again to open the report.', 'error');
        setCta('Sign in again', ContentDecaySession.signInUrl(location.pathname + location.search));
        return;
      }
      if (error.status === 402) {
        title.textContent = 'This report has not been purchased';
        meta.textContent = 'Signed in as ' + (active.user?.email || 'your account') + '.';
        setStatus('No completed $49 payment is linked to this scan and account.', 'error');
        setCta('Return to the free scan', '/content-decay/');
        return;
      }
      setStatus(error.message || 'The report could not be loaded.', 'error');
      setCta('Try again', location.pathname + location.search);
    }
  }

  load();
})();
