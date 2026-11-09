(() => {
  'use strict';

  const API = '/.netlify/functions/competitor-intelligence';
  const SUPABASE_URL = 'https://ftwohoenimegsmtliqgz.supabase.co';
  const SUPABASE_PUBLIC_KEY = 'sb_publishable_0T08Pe4A0ZvoHD5CXrd1iA_BvUyVxAO';

  const PLANS = {
    monthly: {
      key: 'monthly',
      name: 'Competitive Monitor Monthly',
      price: '$46/month',
      summary: '3 full report runs/month · up to 8 competitors per report · saved comparisons · PDF download (up to 25 pages)'
    },
    single: {
      key: 'single',
      name: 'Single Competitor Report',
      price: '$26 one time',
      summary: '1 full report for 1 website URL · up to 5 competitors · PDF download (up to 25 pages) · no subscription'
    }
  };

  let sbClient = null;
  let sessionToken = null;
  let currentUser = null;
  let workspace = null;
  let selectedPlan = null;
  let authMode = 'signup';
  let pendingUrl = '';
  let checkoutAttemptId = newUuid();
  let pollTimer = null;
  let activeReport = null;

  function newUuid() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function $(id) {
    return document.getElementById(id);
  }

  function showToast(text) {
    const el = $('toast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function getSupabase() {
    if (sbClient) return sbClient;
    if (!window.supabase?.createClient) return null;
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
      auth: { flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true }
    });
    return sbClient;
  }

  async function refreshSession() {
    const sb = getSupabase();
    if (!sb) return null;
    try {
      const { data } = await sb.auth.getSession();
      sessionToken = data?.session?.access_token || null;
      currentUser = data?.session?.user || null;
      return data?.session || null;
    } catch {
      sessionToken = null;
      currentUser = null;
      return null;
    }
  }

  async function apiRequest(action, { method = 'GET', body, params = {} } = {}) {
    await refreshSession();
    const qs = new URLSearchParams({ action, ...params });
    const headers = {};
    if (sessionToken) headers.Authorization = 'Bearer ' + sessionToken;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${API}?${qs.toString()}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || data.message || 'Request could not be completed.');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function syncTopbarAuth() {
    const host = $('ciAuthControls');
    if (!host) return;
    if (currentUser) {
      const runs = workspace?.summary?.remainingRuns ?? 0;
      host.innerHTML =
        `<button class="textbtn" type="button" id="ciJumpWorkspaceBtn">My Workspace (${runs} run${runs === 1 ? '' : 's'})</button>` +
        `<button class="outlinebtn" type="button" id="ciSignOutBtn">Sign out</button>`;
      $('ciJumpWorkspaceBtn')?.addEventListener('click', () => {
        const w = $('liveWorkspace');
        if (w) {
          w.hidden = false;
          w.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
      $('ciSignOutBtn')?.addEventListener('click', handleSignOut);
    } else {
      host.innerHTML =
        `<button class="textbtn" type="button" id="ciLoginBtn">Log in</button>` +
        `<button class="solidbtn" type="button" id="ciSignupBtn">Get started</button>`;
      $('ciLoginBtn')?.addEventListener('click', () => openAuth('login'));
      $('ciSignupBtn')?.addEventListener('click', () => openAuth('signup'));
    }
  }

  async function handleSignOut() {
    const sb = getSupabase();
    try {
      await sb?.auth.signOut({ scope: 'local' });
    } catch {}
    sessionToken = null;
    currentUser = null;
    workspace = null;
    activeReport = null;
    clearTimeout(pollTimer);
    syncTopbarAuth();
    renderLiveWorkspace();
    showToast('Signed out.');
  }

  function openModal() {
    const b = $('modalBackdrop');
    if (b) b.classList.add('open');
  }

  function closeModal() {
    const b = $('modalBackdrop');
    if (b) b.classList.remove('open');
  }

  function openAuth(mode = 'signup') {
    authMode = mode;
    if (currentUser) {
      if (selectedPlan) {
        renderCheckoutConfirm();
        openModal();
        return;
      }
      const w = $('liveWorkspace');
      if (w) {
        w.hidden = false;
        w.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    renderAuthModal();
    openModal();
  }

  function choosePlan(planKeyOrName) {
    const key = String(planKeyOrName || '').toLowerCase().includes('month') ? 'monthly' : 'single';
    selectedPlan = PLANS[key];
    checkoutAttemptId = newUuid();
    if (currentUser) {
      renderCheckoutConfirm();
      openModal();
    } else {
      authMode = 'signup';
      renderAuthModal();
      openModal();
    }
  }

  function startAnalysis() {
    const input = $('siteUrl');
    const raw = (input?.value || '').trim();
    if (!raw) {
      showToast('Enter your website URL to continue');
      input?.focus();
      return;
    }
    let u;
    try {
      u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
    } catch {
      showToast('Enter a valid public website address');
      return;
    }
    if (!u.hostname.includes('.')) {
      showToast('Enter a valid public website address');
      return;
    }
    pendingUrl = u.origin;

    if (currentUser && (workspace?.summary?.remainingRuns || 0) > 0) {
      const targetInput = $('wsTargetUrl');
      if (targetInput && !targetInput.value) targetInput.value = pendingUrl;
      const w = $('liveWorkspace');
      if (w) {
        w.hidden = false;
        w.scrollIntoView({ behavior: 'smooth', block: 'start' });
        $('wsCompetitorUrls')?.focus();
      }
      return;
    }
    renderPlansModal();
    openModal();
  }

  function renderPlansModal() {
    const m = $('modalContent');
    if (!m) return;
    m.className = 'modal wide';
    m.innerHTML =
      `<button class="close" type="button" aria-label="Close" id="modalCloseBtn">×</button>` +
      `<div class="eyebrow" style="color:#6ea8ff">Your report starts here</div>` +
      `<h2>Choose a package</h2>` +
      `<p>Website to analyze: <b style="color:#dce6f7">${esc(pendingUrl || 'your website')}</b>. Preview is free; a package unlocks a full report (up to 25 pages).</p>` +
      `<div class="package-choice" role="button" tabindex="0" data-plan="monthly">` +
        `<div><b>Competitive Monitor · Monthly</b><small>3 report runs/month · up to 8 competitors in each · saved comparisons</small></div>` +
        `<strong>$46<small>/mo</small></strong>` +
      `</div>` +
      `<div class="package-choice" role="button" tabindex="0" data-plan="single">` +
        `<div><b>Single report · one-time payment</b><small>One full report · up to 5 competitors · no renewal or leftover credits</small></div>` +
        `<strong>$26<small> once</small></strong>` +
      `</div>` +
      `<p class="auth-note">${currentUser ? 'Signed in as ' + esc(currentUser.email) + '. Select a package to continue to secure Stripe checkout.' : 'After you choose, sign in or create an account to continue to secure Stripe checkout.'}</p>`;

    $('modalCloseBtn')?.addEventListener('click', closeModal);
    m.querySelectorAll('.package-choice').forEach(el => {
      const pick = () => choosePlan(el.getAttribute('data-plan'));
      el.addEventListener('click', pick);
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pick();
        }
      });
    });
  }

  function renderAuthModal() {
    const m = $('modalContent');
    if (!m) return;
    m.className = 'modal';
    m.innerHTML =
      `<button class="close" type="button" aria-label="Close" id="modalCloseBtn">×</button>` +
      `<div class="eyebrow" style="color:#6ea8ff">${authMode === 'login' ? 'Welcome back' : 'Get started'}</div>` +
      `<h2>${authMode === 'login' ? 'Log in to your workspace' : 'Create your account'}</h2>` +
      `<p>${selectedPlan ? `Selected: <b>${esc(selectedPlan.name)} · ${esc(selectedPlan.price)}</b>. Sign in or create an account to continue.` : 'Sign in to access saved competitor reports or start a new package.'}` +
      `${pendingUrl ? `<br><b style="color:#dce6f7">Website: ${esc(pendingUrl)}</b>` : ''}</p>` +
      `<form id="ciAuthForm" novalidate>` +
        `<label class="label" for="ciEmail">Email address</label>` +
        `<input id="ciEmail" type="email" placeholder="you@company.com" autocomplete="email" required>` +
        `<label class="label" for="ciPassword">Password</label>` +
        `<div class="pw-wrap">` +
          `<input id="ciPassword" type="password" placeholder="${authMode === 'login' ? 'Your password' : 'At least 8 characters'}" autocomplete="${authMode === 'login' ? 'current-password' : 'new-password'}" required>` +
          `<button type="button" class="pw-eye" id="ciPwToggle" aria-label="Show password">Show</button>` +
        `</div>` +
        `<button class="solidbtn" type="submit" id="ciAuthSubmitBtn">${authMode === 'login' ? 'Log in' : 'Create account'} <span>→</span></button>` +
      `</form>` +
      `<p class="auth-note">${authMode === 'signup' ? 'New accounts receive a confirmation email. Check both your inbox and spam folder to confirm your email before checkout.' : 'Use your existing AEOGEO Search email and password.'}</p>` +
      `<p class="modal-foot">` +
        `${authMode === 'login' ? `New here? <a id="ciSwitchAuthMode">Create an account</a> · <a href="/login/?mode=reset&next=%2Fcompetitor-intelligence%2F%23workspace">Forgot password?</a>` : `Already have an account? <a id="ciSwitchAuthMode">Log in</a>`}` +
      `</p>` +
      `<div class="notice" id="authNotice" role="status" aria-live="polite"></div>`;

    $('modalCloseBtn')?.addEventListener('click', closeModal);
    $('ciSwitchAuthMode')?.addEventListener('click', () => openAuth(authMode === 'login' ? 'signup' : 'login'));
    $('ciPwToggle')?.addEventListener('click', () => {
      const pw = $('ciPassword');
      const btn = $('ciPwToggle');
      if (!pw || !btn) return;
      const show = pw.type === 'password';
      pw.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
    $('ciAuthForm')?.addEventListener('submit', e => {
      e.preventDefault();
      submitAuth();
    });
  }

  async function submitAuth() {
    const email = ($('ciEmail')?.value || '').trim();
    const password = $('ciPassword')?.value || '';
    const notice = $('authNotice');
    const btn = $('ciAuthSubmitBtn');
    const showMsg = msg => {
      if (!notice) return;
      notice.textContent = msg;
      notice.classList.add('show');
    };
    if (!email || !password) {
      showMsg('Enter both your email address and password to continue.');
      return;
    }
    if (authMode === 'signup' && password.length < 8) {
      showMsg('Use a password of at least 8 characters.');
      return;
    }
    const sb = getSupabase();
    if (!sb) {
      showMsg('Account sign-in script is still loading. Wait a moment and try again.');
      return;
    }
    if (btn) btn.disabled = true;
    try {
      if (authMode === 'login') {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        sessionToken = data?.session?.access_token || null;
        currentUser = data?.session?.user || null;
        await loadWorkspace();
        syncTopbarAuth();
        if (selectedPlan && (workspace?.summary?.remainingRuns || 0) === 0) {
          renderCheckoutConfirm();
        } else {
          closeModal();
          const w = $('liveWorkspace');
          if (w) {
            w.hidden = false;
            w.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      } else {
        const redirectTo = `${location.origin}/auth/callback/?next=${encodeURIComponent('/competitor-intelligence/#workspace')}`;
        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirectTo }
        });
        if (error) throw error;
        if (data?.session?.access_token && data?.user?.email_confirmed_at) {
          sessionToken = data.session.access_token;
          currentUser = data.user;
          await loadWorkspace();
          syncTopbarAuth();
          if (selectedPlan) renderCheckoutConfirm();
          else closeModal();
        } else {
          showMsg('Check your email inbox and spam folder for the confirmation link, then click Log in here to continue.');
        }
      }
    } catch (err) {
      showMsg(err.message || 'Sign-in could not be completed. Check your email and password.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function renderCheckoutConfirm() {
    const m = $('modalContent');
    if (!m || !selectedPlan) return;
    m.className = 'modal';
    m.innerHTML =
      `<button class="close" type="button" aria-label="Close" id="modalCloseBtn">×</button>` +
      `<div class="eyebrow" style="color:#6ea8ff">Secure Stripe Checkout</div>` +
      `<h2>${esc(selectedPlan.name)}</h2>` +
      `<p><strong style="color:#fff;font-size:18px">${esc(selectedPlan.price)}</strong><br>${esc(selectedPlan.summary)}</p>` +
      `<label class="label" for="ciCheckoutUrl">Your website URL (optional now, required when running report)</label>` +
      `<input id="ciCheckoutUrl" type="url" placeholder="https://yourwebsite.com" value="${esc(pendingUrl)}">` +
      `<label class="ci-check"><input type="checkbox" id="ciTermsCheck"> <span>I agree to the AEOGEO Search <a href="/terms-of-service" target="_blank" rel="noopener">Terms &amp; Conditions</a> and <a href="/privacy-policy" target="_blank" rel="noopener">Privacy Policy</a>.</span></label>` +
      `<button class="solidbtn" type="button" id="ciStartStripeBtn">Continue to Secure Checkout <span>→</span></button>` +
      `<p class="auth-note">Signed in as <b>${esc(currentUser?.email || '')}</b>. ${selectedPlan.key === 'monthly' ? 'Subscriptions renew monthly and can be canceled any time at period end from your workspace.' : 'One-time payment for 1 full report (capped at 25 pages).'}</p>` +
      `<div class="notice" id="checkoutNotice" role="status" aria-live="polite"></div>`;

    $('modalCloseBtn')?.addEventListener('click', closeModal);
    $('ciStartStripeBtn')?.addEventListener('click', async () => {
      const notice = $('checkoutNotice');
      const showMsg = msg => {
        if (!notice) return;
        notice.textContent = msg;
        notice.classList.add('show');
      };
      if (!$('ciTermsCheck')?.checked) {
        showMsg('Accept the Terms & Conditions and Privacy Policy before continuing to checkout.');
        return;
      }
      const rawUrl = ($('ciCheckoutUrl')?.value || '').trim();
      const btn = $('ciStartStripeBtn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Opening Stripe Checkout...';
      }
      try {
        const res = await apiRequest('checkout', {
          method: 'POST',
          body: {
            plan: selectedPlan.key,
            attemptId: checkoutAttemptId,
            targetUrl: rawUrl || undefined
          }
        });
        if (res.alreadyPaid) {
          await loadWorkspace();
          closeModal();
          showToast('Payment verified. Your report allowance is ready.');
          return;
        }
        if (res.url) {
          location.assign(res.url);
          return;
        }
        throw new Error('Checkout redirect URL was not returned.');
      } catch (err) {
        showMsg(err.message || 'Could not start Stripe Checkout.');
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = 'Continue to Secure Checkout <span>→</span>';
        }
      }
    });
  }

  async function loadWorkspace() {
    if (!currentUser) {
      workspace = null;
      renderLiveWorkspace();
      return;
    }
    try {
      workspace = await apiRequest('workspace');
    } catch (err) {
      workspace = { summary: { remainingRuns: 0, maxCompetitors: 5 }, reports: [], loadError: err.message };
    }
    syncTopbarAuth();
    renderLiveWorkspace();

    const running = (workspace?.reports || []).find(r => r.status === 'queued' || r.status === 'running');
    if (running) {
      schedulePoll(running.id);
    } else if (!activeReport && workspace?.reports?.some(r => r.status === 'completed')) {
      const latestCompleted = workspace.reports.find(r => r.status === 'completed');
      if (latestCompleted) loadSingleReport(latestCompleted.id);
    }
  }

  function schedulePoll(reportId) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      try {
        const row = await apiRequest('report', { params: { id: reportId } });
        if (row.status === 'completed') {
          activeReport = row;
          await loadWorkspace();
          renderActiveReport();
          showToast('Your Competitor Intelligence report is ready!');
          return;
        }
        if (row.status === 'failed') {
          await loadWorkspace();
          showToast(row.error_message || 'Report could not complete; your run was restored.');
          return;
        }
        const progEl = $('wsRunningStatus');
        if (progEl && row.progress) {
          progEl.textContent = `Analyzing public websites (${row.progress.completedSites || 0} of ${row.progress.totalSites || '?'} sites checked)...`;
        }
        schedulePoll(reportId);
      } catch {
        schedulePoll(reportId);
      }
    }, 3200);
  }

  async function loadSingleReport(reportId) {
    try {
      activeReport = await apiRequest('report', { params: { id: reportId } });
      renderActiveReport();
    } catch (err) {
      showToast(err.message || 'Could not load report details.');
    }
  }

  async function downloadPdf(reportId) {
    try {
      const res = await apiRequest('pdf-ticket', { method: 'POST', body: { id: reportId } });
      if (res.url) {
        const a = document.createElement('a');
        a.href = res.url;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (err) {
      showToast(err.message || 'PDF download could not be started.');
    }
  }

  function renderLiveWorkspace() {
    const host = $('liveWorkspace');
    if (!host) return;
    if (!currentUser) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }
    host.hidden = false;
    const sum = workspace?.summary || { remainingRuns: 0, maxCompetitors: 5 };
    const reports = workspace?.reports || [];
    const running = reports.find(r => r.status === 'queued' || r.status === 'running');

    const statusBadge = sum.hasHold
      ? `<span class="sample-pill" style="background:#421c29;color:#ffb4c4">Billing hold</span>`
      : sum.remainingRuns > 0
        ? `<span class="sample-pill">${sum.remainingRuns} report run${sum.remainingRuns === 1 ? '' : 's'} available · up to ${sum.maxCompetitors} competitors</span>`
        : `<span class="sample-pill">0 runs remaining · select a package to run a new report</span>`;

    host.innerHTML =
      `<div class="ws-card">` +
        `<div class="ws-head">` +
          `<div>` +
            `<div class="kicker" style="font-size:10px;text-transform:uppercase;letter-spacing:.15em;color:#6ea8ff;font-weight:800">Your Competitive Intelligence Workspace</div>` +
            `<h3>Signed in as ${esc(currentUser.email)}</h3>` +
          `</div>` +
          `<div class="ws-head-actions">` +
            statusBadge +
            (sum.hasMonthlyPortal ? `<button type="button" class="outlinebtn" id="wsPortalBtn">Manage billing</button>` : '') +
            `<button type="button" class="outlinebtn" id="wsBuyPkgBtn">${sum.remainingRuns > 0 ? 'Add package' : 'Choose package'}</button>` +
          `</div>` +
        `</div>` +
        (sum.remainingRuns > 0 && !running
          ? `<form class="ws-form" id="wsRunForm">` +
              `<div class="ws-form-grid">` +
                `<div>` +
                  `<label class="label" for="wsTargetUrl">Your website URL</label>` +
                  `<input id="wsTargetUrl" type="url" placeholder="https://yourwebsite.com" value="${esc(pendingUrl)}" required>` +
                `</div>` +
                `<div>` +
                  `<label class="label" for="wsCompetitorUrls">Competitor URLs (1 to ${sum.maxCompetitors}, one per line or comma-separated)</label>` +
                  `<textarea id="wsCompetitorUrls" rows="3" placeholder="https://competitor-one.com&#10;https://competitor-two.com" required></textarea>` +
                `</div>` +
              `</div>` +
              `<div class="ws-run-row">` +
                `<span class="ws-hint">Analyzes public HTTPS pages, robots.txt, sitemaps, 4 Ps, topic gaps, and SWOT (capped at 25 PDF pages).</span>` +
                `<button type="submit" class="solidbtn" id="wsSubmitRunBtn">Run full report →</button>` +
              `</div>` +
              `<div class="notice" id="wsFormNotice" role="status" aria-live="polite"></div>` +
            `</form>`
          : running
            ? `<div class="ws-running"><strong id="wsRunningStatus">Analyzing public websites (${running.progress?.completedSites || 0} of ${running.progress?.totalSites || '?'} sites checked)...</strong><p>Target: ${esc(running.target_url)}. Results will appear automatically in under a minute.</p></div>`
            : `<div class="ws-empty-runs"><p>${sum.hasHold ? 'New report runs are paused while a payment hold or dispute is under review. Your completed reports below remain available to view and download.' : 'Choose Single Report ($26 one time) or Competitive Monitor ($46/month for 3 runs/month) to run a live competitor report for your URL.'}</p><div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="solidbtn" data-buy="monthly">Choose $46/month (3 runs/mo)</button><button type="button" class="outlinebtn" data-buy="single">Buy $26 single report</button></div></div>`
        ) +
        (reports.length
          ? `<div class="ws-saved">` +
              `<div class="box-title">Saved reports (${reports.length}) <small>Completed reports stay available in your workspace</small></div>` +
              `<div class="ws-report-list">` +
                reports.map(r => (
                  `<div class="ws-report-item">` +
                    `<div><strong>${esc(r.target_domain)}</strong> <small>· ${esc((r.created_at || '').slice(0, 10))} · ${esc(r.status)}${r.page_count ? ` · ${r.page_count} pp` : ''}</small>` +
                    `${r.error_message ? `<div style="color:#ffb4c4;font-size:11px;margin-top:3px">${esc(r.error_message)}</div>` : ''}</div>` +
                    `<div style="display:flex;gap:8px">` +
                      (r.status === 'completed'
                        ? `<button type="button" class="outlinebtn ws-view-btn" data-id="${esc(r.id)}">View</button>` +
                          `<button type="button" class="solidbtn ws-pdf-btn" data-id="${esc(r.id)}">Download PDF</button>`
                        : '') +
                    `</div>` +
                  `</div>`
                )).join('') +
              `</div>` +
            `</div>`
          : '') +
        `<div id="liveReportViewer"></div>` +
      `</div>`;

    $('wsBuyPkgBtn')?.addEventListener('click', () => {
      renderPlansModal();
      openModal();
    });
    host.querySelectorAll('[data-buy]').forEach(b => {
      b.addEventListener('click', () => choosePlan(b.getAttribute('data-buy')));
    });
    $('wsPortalBtn')?.addEventListener('click', async () => {
      try {
        const res = await apiRequest('portal', { method: 'POST', body: {} });
        if (res.url) location.assign(res.url);
      } catch (err) {
        showToast(err.message || 'Could not open Billing Portal.');
      }
    });
    $('wsRunForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const notice = $('wsFormNotice');
      const btn = $('wsSubmitRunBtn');
      const targetUrl = ($('wsTargetUrl')?.value || '').trim();
      const rawComp = ($('wsCompetitorUrls')?.value || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
      if (!targetUrl || !rawComp.length) {
        if (notice) {
          notice.textContent = 'Enter your website URL and at least 1 competitor URL.';
          notice.classList.add('show');
        }
        return;
      }
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Starting analysis...';
      }
      try {
        const res = await apiRequest('start-report', {
          method: 'POST',
          body: { requestId: newUuid(), targetUrl, competitorUrls: rawComp }
        });
        await loadWorkspace();
        if (res.id) schedulePoll(res.id);
      } catch (err) {
        if (notice) {
          notice.textContent = err.message || 'Could not start report.';
          notice.classList.add('show');
        }
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Run full report →';
        }
      }
    });
    host.querySelectorAll('.ws-view-btn').forEach(b => {
      b.addEventListener('click', () => loadSingleReport(b.getAttribute('data-id')));
    });
    host.querySelectorAll('.ws-pdf-btn').forEach(b => {
      b.addEventListener('click', () => downloadPdf(b.getAttribute('data-id')));
    });

    if (activeReport) renderActiveReport();
  }

  function renderActiveReport() {
    const container = $('liveReportViewer');
    if (!container || !activeReport?.report) return;
    const rep = activeReport.report;
    const snap = rep.executiveSnapshot || {};
    const allSites = [rep.target, ...(rep.competitors || [])].filter(Boolean);

    container.innerHTML =
      `<div class="reportpanel" style="margin-top:18px">` +
        `<div class="reporthead">` +
          `<div>` +
            `<h3>${esc(rep.target?.domain || activeReport.target_domain)} · Live competitive analysis</h3>` +
            `<p>Generated ${esc((rep.generatedAt || '').slice(0, 10))} · Up to 25-page PDF ready</p>` +
          `</div>` +
          `<button type="button" class="solidbtn" id="activePdfBtn">↓ Download PDF (${activeReport.page_count || 1} pp)</button>` +
        `</div>` +
        `<div class="reportbody">` +
          `<div class="metric-grid">` +
            `<div class="metric"><span>Your readiness index</span><strong>${esc(snap.yourScore)}/100</strong><small>Rival avg: ${esc(snap.competitorAverageScore)}/100</small></div>` +
            `<div class="metric"><span>Competitors mapped</span><strong>${esc(snap.competitorsMapped)}</strong><small>${esc(snap.directCount)} direct · ${esc(snap.adjacentCount)} adjacent</small></div>` +
            `<div class="metric"><span>Search topic gaps</span><strong>${esc(snap.topicGapCount)}</strong><small>Uncovered topic clusters</small></div>` +
            `<div class="metric"><span>Positioning overlap</span><strong>${esc(snap.positioningOverlap)}%</strong><small>${esc(snap.quickWinCount)} prioritized actions</small></div>` +
          `</div>` +
          (rep.comparisonDelta
            ? `<div class="box" style="margin-top:12px"><strong>Month-to-month comparison (vs. ${esc((rep.comparisonDelta.previousDate || '').slice(0, 10))}):</strong> Score ${rep.comparisonDelta.scoreDelta >= 0 ? '+' : ''}${rep.comparisonDelta.scoreDelta} pts (${rep.comparisonDelta.previousScore} -> ${rep.comparisonDelta.currentScore}/100) · Topic gaps ${rep.comparisonDelta.previousTopicGaps} -> ${rep.comparisonDelta.currentTopicGaps}</div>`
            : '') +
          `<div class="box table-box">` +
            `<div class="box-title">Competitive positioning matrix <small>Live public-HTML directional signals</small></div>` +
            `<div class="table-wrap"><table class="compare"><thead><tr><th>Brand</th><th>Index</th><th>Audience signal</th><th>Offer / topics</th><th>Price visibility</th><th>Search readiness</th><th>Content angle</th></tr></thead><tbody>` +
              allSites.map(s => (
                `<tr><td>${esc(s.domain)}${s.isTarget ? ' (You)' : ''}</td><td><b>${esc(s.score)}/100</b></td><td>${esc(s.audienceSignal)}</td><td>${esc(s.offerSummary)}</td><td class="good">${esc(s.priceVisibility)}</td><td>${esc(s.searchStrength)}</td><td>${esc(s.contentAngle)}</td></tr>`
              )).join('') +
            `</tbody></table></div>` +
          `</div>` +
          `<div class="report-grid">` +
            `<div class="box"><div class="box-title">SWOT highlights</div>` +
              `<p style="font-size:12px;margin:0 0 8px"><b style="color:#fff">Strengths:</b> ${esc((rep.swot?.strengths || []).join(' '))}</p>` +
              `<p style="font-size:12px;margin:0 0 8px"><b style="color:#fff">Weaknesses:</b> ${esc((rep.swot?.weaknesses || []).join(' '))}</p>` +
              `<p style="font-size:12px;margin:0 0 8px"><b style="color:#fff">Opportunities:</b> ${esc((rep.swot?.opportunities || []).slice(0, 2).join(' '))}</p>` +
              `<p style="font-size:12px;margin:0"><b style="color:#fff">Threats:</b> ${esc((rep.swot?.threats || []).join(' '))}</p>` +
            `</div>` +
            `<div class="box"><div class="box-title">Prioritized next steps</div>` +
              `<ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.6;color:#c2d3ec">` +
                (rep.recommendations || []).slice(0, 5).map(r => `<li><b style="color:#fff">${esc(r.title)}:</b> ${esc(r.detail)}</li>`).join('') +
              `</ul>` +
            `</div>` +
          `</div>` +
        `</div>` +
      `</div>`;

    $('activePdfBtn')?.addEventListener('click', () => downloadPdf(activeReport.id));
  }

  function wireSampleSidebar() {
    const links = document.querySelectorAll('.workspace .sidepanel .side-link');
    const targets = ['#sampleMetrics', '#sampleVisibility', '#sampleMatrix', '#sampleMatrix', '#sampleChart', '#sampleMatrix', '#how'];
    links.forEach((link, idx) => {
      link.setAttribute('role', 'button');
      link.setAttribute('tabindex', '0');
      const activate = () => {
        links.forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        const sel = targets[idx] || '#report';
        const el = document.querySelector(sel);
        el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      };
      link.addEventListener('click', activate);
      link.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      });
    });
  }

  async function handleCheckoutReturn() {
    const params = new URLSearchParams(location.search);
    const checkoutState = params.get('checkout');
    const sessionId = params.get('session_id');
    if (checkoutState === 'cancelled') {
      history.replaceState({}, '', location.pathname + location.hash);
      showToast('Checkout canceled. No charge was made.');
      return;
    }
    if (checkoutState === 'success' && sessionId) {
      history.replaceState({}, '', location.pathname + '#workspace');
      if (!currentUser) {
        openAuth('login');
        showToast('Sign in to finish verifying your checkout.');
        return;
      }
      try {
        const res = await apiRequest('verify-checkout', { method: 'POST', body: { sessionId } });
        await loadWorkspace();
        if (res.paid) {
          showToast('Payment confirmed! Enter your URL and competitors below to run your report.');
          $('liveWorkspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          showToast('Payment is still processing. Refresh in a moment.');
        }
      } catch (err) {
        showToast(err.message || 'Could not verify checkout yet.');
      }
    }
  }

  // Expose globals referenced by inline handlers preserved from uploaded design
  window.openAuth = openAuth;
  window.startAnalysis = startAnalysis;
  window.choosePlan = choosePlan;
  window.closeModal = closeModal;

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('modalBackdrop')?.classList.contains('open')) {
      closeModal();
    }
  });

  (async () => {
    wireSampleSidebar();
    await refreshSession();
    syncTopbarAuth();
    if (currentUser) await loadWorkspace();
    await handleCheckoutReturn();
  })();
})();
