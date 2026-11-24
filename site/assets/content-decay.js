'use strict';
// Content Decay Predictor - free scan page and buyer entry point.
//
// Talks only to content-decay-api. The API returns an unguessable public token
// for the scan; per-page detail and findings are never present in these
// responses, so this page cannot display them even if it asked.
//
// The paid report is never rendered here. Checkout redirects to Stripe, the
// return URL asks the server to confirm the session, and the findings live on
// the separate report page behind the server's entitlement check.

(() => {
  const ENDPOINT = '/.netlify/functions/content-decay-api';
  const POLL_MS = 2000;
  const MAX_WAIT_MS = 120000;

  const form = document.getElementById('cd-form');
  const input = document.getElementById('cd-url');
  const submit = document.getElementById('cd-submit');
  const status = document.getElementById('cd-status');
  const results = document.getElementById('cd-results');
  const scope = document.getElementById('cd-scope');
  const metrics = document.getElementById('cd-metrics');
  const note = document.getElementById('cd-note');
  if (!form || !input || !submit || !status || !results) return;

  // ---- Paid report -------------------------------------------------------
  const offer = document.getElementById('cd-offer');
  const buy = document.getElementById('cd-buy');
  const buyStatus = document.getElementById('cd-buy-status');
  const offerHost = document.getElementById('cd-offer-host');
  let currentScanId = null;
  let pendingConfirm = null;
  let checkoutBusy = false;
  let lastDisagreements = 0;
  let factLinkSeen = false;
  let factLinkObserver = null;
  // What the free summary was showing when the visitor last looked at it, so a
  // click on the $49 offer can be read next to the fact count it followed.
  let lastFact = null;

  const setBuyStatus = (message, kind) => {
    if (!buyStatus) return;
    buyStatus.textContent = message || '';
    buyStatus.className = 'cd-status' + (kind ? ' is-' + kind : '');
  };

  const setBuyButton = (text, {href = '', disabled = false} = {}) => {
    if (!buy) return;
    buy.hidden = false;
    buy.disabled = disabled;
    buy.textContent = text;
    if (href) buy.dataset.href = href;
    else delete buy.dataset.href;
  };

  function showOffer(scan) {
    if (!offer || !scan || !scan.id) return;
    currentScanId = scan.id;
    pendingConfirm = null;
    offer.hidden = false;
    if (offerHost) offerHost.textContent = scan.hostname || 'this site';
    setBuyButton('Buy the report — $49');
    setBuyStatus('');
  }

  function purchaseUrl(scanId) {
    return '/content-decay/?purchased=1&scan=' + encodeURIComponent(scanId);
  }

  async function beginCheckout(scanId) {
    if (!buy || checkoutBusy) return;
    if (!window.ContentDecaySession) {
      setBuyStatus('Sign-in could not load. Refresh the page and try again.', 'error');
      return;
    }
    checkoutBusy = true;
    pendingConfirm = null;
    setBuyButton('Preparing checkout…', {disabled: true});
    setBuyStatus('');
    try {
      const active = await ContentDecaySession.session();
      if (!active) {
        checkoutBusy = false;
        track('content_decay_checkout_signin', factParams());
        setBuyButton('Sign in to buy — $49', {
          href: ContentDecaySession.signInUrl('/content-decay/?scan=' + encodeURIComponent(scanId) + '&buy=1')
        });
        setBuyStatus('The report is tied to your account. Sign in and you will come straight back to this scan.', 'error');
        return;
      }
      const result = await ContentDecaySession.api('checkout', {
        method: 'POST',
        token: active.access_token,
        body: {scan: scanId}
      });
      if (result.alreadyPurchased) {
        location.assign('/content-decay/report/?scan=' + encodeURIComponent(result.scanId || scanId));
        return;
      }
      if (!result.url) throw new Error('Checkout did not return a payment link. No payment was taken.');
      track('content_decay_checkout_open', factParams());
      location.assign(result.url);
    } catch (error) {
      checkoutBusy = false;
      if (error.status === 401) {
        setBuyButton('Sign in to buy — $49', {
          href: ContentDecaySession.signInUrl('/content-decay/?scan=' + encodeURIComponent(scanId) + '&buy=1')
        });
        setBuyStatus('Your session has ended. Sign in again to continue.', 'error');
        return;
      }
      setBuyButton('Try checkout again — $49');
      setBuyStatus(error.message || 'Checkout could not open. No payment was taken.', 'error');
    }
  }

  async function finishPurchase(scanId, sessionId) {
    if (!offer) return;
    if (!window.ContentDecaySession) {
      setBuyStatus('Sign-in could not load. Refresh the page and try again.', 'error');
      return;
    }
    offer.hidden = false;
    pendingConfirm = {scanId, sessionId};
    const signInHref = ContentDecaySession.signInUrl(
      purchaseUrl(scanId) + '&session_id=' + encodeURIComponent(sessionId)
    );
    setBuyButton('Confirming…', {disabled: true});
    setBuyStatus('Confirming your payment with Stripe…', 'busy');
    try {
      const active = await ContentDecaySession.session();
      if (!active) {
        setBuyButton('Sign in to finish', {href: signInHref});
        setBuyStatus('Payment received. Sign in to confirm it and open your report.', 'error');
        return;
      }
      const result = await ContentDecaySession.api('confirm', {
        method: 'POST',
        token: active.access_token,
        body: {sessionId}
      });
      if (result.paid === false) {
        pendingConfirm = null;
        setBuyButton('Buy the report — $49');
        setBuyStatus(result.refunded
          ? 'This purchase was refunded, so the report is no longer available. You can buy it again if you want access.'
          : 'This purchase is no longer active, so the report is not available.', 'error');
        return;
      }
      setBuyStatus('Payment confirmed. Opening your report…');
      location.replace('/content-decay/report/?scan=' + encodeURIComponent(scanId));
    } catch (error) {
      if (error.status === 401) {
        setBuyButton('Sign in to finish', {href: signInHref});
        setBuyStatus('Your session has ended. Sign in again to confirm the payment.', 'error');
        return;
      }
      setBuyButton('Try confirmation again');
      setBuyStatus((error.message || 'The payment could not be confirmed yet.')
        + ' If you were charged, reload this page in a moment: Stripe may still be sending us the payment.', 'error');
    }
  }

  const factsLink = document.getElementById('cd-facts-link');
  if (factsLink) {
    factsLink.addEventListener('click', () => {
      track('content_decay_fact_link_click', {disagreements: lastDisagreements});
    });
  }

  if (buy) {
    buy.addEventListener('click', () => {
      if (!window.ContentDecaySession) {
        setBuyStatus('Sign-in could not load. Refresh the page and try again.', 'error');
        return;
      }
      if (buy.dataset.href) {
        location.assign(buy.dataset.href);
        return;
      }
      if (pendingConfirm) {
        finishPurchase(pendingConfirm.scanId, pendingConfirm.sessionId);
        return;
      }
      if (currentScanId) {
        track('content_decay_offer_click', factParams());
        beginCheckout(currentScanId);
      }
    });
  }

  const setStatus = (message, kind) => {
    status.textContent = message || '';
    status.className = 'cd-status' + (kind ? ' is-' + kind : '');
  };

  const label = (value) => String(value ?? 0);

  // ---- Funnel analytics ---------------------------------------------------
  // Counts only, and only when the visitor allowed analytics and the Google tag
  // is present. No scan id, hostname, page URL or email is ever sent, so these
  // events can sit in the public property without exposing anyone's site.
  // The free summary state an offer click came from. Counts only: no scan id,
  // hostname or page URL, and nothing is added to the free API response.
  function factParams() {
    return {
      fact_check: lastFact ? 1 : 0,
      facts_compared: lastFact ? lastFact.facts : 0,
      disagreements: lastFact ? lastFact.disagreements : 0
    };
  }

  function track(name, params) {
    try {
      if (!window.AEOGEOCookieConsent?.allowsAnalytics?.()) return;
      if (typeof window.gtag !== 'function') return;
      window.gtag('event', name, params || {});
    } catch { /* analytics must never break the page */ }
  }

  // "Reached the fact-check link" means the link itself scrolled into view, not
  // that the page loaded. Fires once per scan so a visitor who scrolls up and
  // down does not inflate the number.
  //
  // Only one observer may ever watch the link. A second scan on the same visit
  // would otherwise leave the first scan's observer attached, and both could
  // report the same view.
  function stopFactLinkWatch() {
    if (!factLinkObserver) return;
    try {
      factLinkObserver.disconnect();
    } catch { /* an already-finished observer is fine */ }
    factLinkObserver = null;
  }

  function watchFactLink(link, disagreements) {
    stopFactLinkWatch();
    factLinkSeen = false;
    if (typeof window.IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting || factLinkSeen) continue;
        factLinkSeen = true;
        track('content_decay_fact_link_view', {disagreements});
        observer.disconnect();
        factLinkObserver = null;
      }
    }, {threshold: 0.5});
    factLinkObserver = observer;
    observer.observe(link);
  }

  // The free summary gets the count of facts compared and disagreements found,
  // so a visitor can see there is something specific to unlock. The conflicts
  // themselves are only in the paid report; the API never sends them here.
  function renderFacts(scan) {
    const block = document.getElementById('cd-facts');
    const line = document.getElementById('cd-facts-line');
    const link = document.getElementById('cd-facts-link');
    if (!block || !line || !link) return;
    const check = scan.factCheck || null;
    const facts = Number(check?.factsCompared);
    const disagreements = Number(check?.disagreements) || 0;
    if (!check || !Number.isFinite(facts) || facts <= 0) {
      stopFactLinkWatch();
      lastFact = null;
      block.hidden = true;
      return;
    }
    const pages = Number(scan.pagesScanned) || 0;
    const pageLabel = pages
      ? ' across the ' + pages + ' page' + (pages === 1 ? '' : 's') + ' we read'
      : '';
    line.textContent = disagreements > 0
      ? 'We compared ' + facts + ' facts about your business' + pageLabel + ' and found '
        + disagreements + ' place' + (disagreements === 1 ? '' : 's')
        + ' where your own pages disagree with each other.'
      : 'We compared ' + facts + ' facts about your business' + pageLabel
        + ' and found no contradictions between pages.';
    link.hidden = disagreements <= 0;
    block.hidden = false;
    lastDisagreements = disagreements;
    lastFact = {facts, disagreements, pages};
    if (disagreements > 0) watchFactLink(link, disagreements);
    else stopFactLinkWatch();
  }

  function render(scan) {
    const summary = scan.summary || {};
    results.hidden = false;

    const discovered = Number(summary.pagesDiscovered);
    const skipped = Number(summary.pagesSkipped) || 0;
    const unread = Number(summary.pagesUnread) || 0;
    const partial = summary.coverageComplete === false;
    const knownCoverage = Number.isFinite(discovered);
    const lowerBound = summary.pagesDiscoveredLowerBound === true;
    const discoveredLabel = (lowerBound ? 'at least ' : '') + label(discovered);

    scope.textContent = knownCoverage && discovered > scan.pagesScanned
      ? 'Read ' + label(scan.pagesScanned) + ' of ' + discoveredLabel + ' discovered pages on ' + scan.hostname + '.'
      : 'Scanned ' + label(scan.pagesScanned) + ' page'
        + (scan.pagesScanned === 1 ? '' : 's') + ' on ' + scan.hostname + '.';
    scope.className = 'cd-scope' + (partial ? ' is-partial' : '');

    const rows = knownCoverage ? [
      ['Pages discovered', discoveredLabel, ''],
      ['Pages read', label(scan.pagesScanned), ''],
      ['Pages skipped', label(skipped), skipped ? 'cd-warn' : 'cd-good'],
      ['Pages not reached', label(unread), unread ? 'cd-warn' : 'cd-good'],
      ['Average words per page', label(summary.averageWords), '']
    ] : [
      ['Pages read', label(scan.pagesScanned), ''],
      ['Average words per page', label(summary.averageWords), '']
    ];

    rows.push(
      ['Pages under 300 words', label(summary.thinPages), summary.thinPages ? 'cd-warn' : 'cd-good'],
      ['Pages without one clear H1', label(summary.pagesWithoutSingleH1), summary.pagesWithoutSingleH1 ? 'cd-warn' : 'cd-good'],
      ['Pages declaring an update date', label(summary.pagesWithDeclaredDate), ''],
      ['Pages declaring no date', label(summary.undatedPages), summary.undatedPages ? 'cd-warn' : 'cd-good'],
      ['Declared stale over 12 months', label(summary.staleOver12Months), summary.staleOver12Months ? 'cd-warn' : 'cd-good'],
      ['Pages with structured data', label(summary.pagesWithJsonLd), ''],
      ['Pages with a named author', label(summary.pagesWithAuthor), ''],
      ['Pages with an FAQ section', label(summary.pagesWithFaq), '']
    );

    metrics.textContent = '';
    for (const [term, value, tone] of rows) {
      const wrapper = document.createElement('div');
      wrapper.className = 'cd-metric';
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = value;
      if (tone) dd.className = tone;
      wrapper.append(dt, dd);
      metrics.append(wrapper);
    }

    const parts = [];
    if (partial) {
      const reasons = [];
      if (skipped) reasons.push(skipped + ' skipped');
      if (unread) reasons.push(unread + ' not reached');
      parts.push('Partial scan' + (reasons.length ? ' (' + reasons.join(', ') + ')' : '')
        + ': this summary describes only the pages that were read.');
    }
    if (summary.oldestContentDate) {
      parts.push('Oldest declared update: ' + new Date(summary.oldestContentDate).toLocaleDateString() + '.');
    }
    if (summary.newestContentDate) {
      parts.push('Newest declared update: ' + new Date(summary.newestContentDate).toLocaleDateString() + '.');
    }
    parts.push('An undated page is not automatically stale, and an old page with current information is not decayed. These are crawl facts, not a verdict.');
    note.textContent = parts.join(' ');

    renderFacts(scan);

    track('content_decay_scan_complete', {
      pages_scanned: Number(scan.pagesScanned) || 0,
      fact_check: scan.factCheck ? 1 : 0,
      disagreements: Number(scan.factCheck?.disagreements) || 0
    });
  }

  async function poll(token) {
    const started = Date.now();
    while (Date.now() - started < MAX_WAIT_MS) {
      await new Promise(resolve => setTimeout(resolve, POLL_MS));
      let response;
      try {
        response = await fetch(ENDPOINT + '?token=' + encodeURIComponent(token), {
          headers: {Accept: 'application/json'}
        });
      } catch {
        continue;
      }
      if (!response.ok) {
        if (response.status === 404) throw new Error('That scan reference no longer exists.');
        continue;
      }
      const scan = await response.json();
      if (scan.status === 'completed') return scan;
      if (scan.status === 'failed') throw new Error(scan.error || 'The scan could not finish.');
      setStatus('Reading pages… ' + (scan.pagesScanned ? scan.pagesScanned + ' read so far.' : 'starting.'), 'busy');
    }
    throw new Error('The scan is taking longer than expected. Try again with a smaller site.');
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const url = input.value.trim();
    if (!url) {
      setStatus('Enter a website address first.', 'error');
      input.focus();
      return;
    }

    submit.disabled = true;
    results.hidden = true;
    setStatus('Starting the scan…', 'busy');

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({url})
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'The scan could not start.');
      }
      if (!payload.token) throw new Error('The scan started without a reference.');
      setStatus('Scanning up to ' + (payload.pageLimit || 10) + ' pages…', 'busy');
      const scan = await poll(payload.token);
      render(scan);
      showOffer(scan);
      setStatus('Scan complete.');
    } catch (error) {
      setStatus(error.message || 'The scan could not finish.', 'error');
    } finally {
      submit.disabled = false;
    }
  });

  // Returning from Stripe or from sign-in. The scan id is the only state the
  // return URL carries; identity and entitlement are checked by the server.
  const params = new URLSearchParams(location.search);
  const linkedScan = params.get('scan');
  if (params.get('checkout') === 'cancelled') {
    setStatus('Checkout was cancelled. No payment was taken.', 'error');
  }
  if (params.get('purchased') === '1' && linkedScan && params.get('session_id')) {
    currentScanId = linkedScan;
    finishPurchase(linkedScan, params.get('session_id'));
  } else if (params.get('buy') === '1' && linkedScan) {
    currentScanId = linkedScan;
    if (offer) offer.hidden = false;
    beginCheckout(linkedScan);
  }
})();
