'use strict';
const {db: defaultDb, reply, verifySignature: defaultVerifySignature, UUID} = require('./lib/db');
const {crawlSite: defaultCrawlSite} = require('./lib/audit-engine');

const OWNER_EMAIL = 'michellesilerschmidt@gmail.com';
const SITE_FORM_URL = 'https://aeogeosearch.com/';

const cleanLine = v => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();

async function lookupCustomerEmail(userId, env, fetchImpl) {
  try {
    const url = (env.SUPABASE_URL || '').trim().replace(/\/$/, '');
    const key = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!url || !key || !UUID.test(userId || '')) return 'Unavailable (User ID: ' + cleanLine(userId || 'unknown') + ')';
    const headers = {
      apikey: key,
      ...(key.startsWith('sb_secret_') ? {} : {Authorization: 'Bearer ' + key})
    };
    const r = await fetchImpl(url + '/auth/v1/admin/users/' + encodeURIComponent(userId), {
      method: 'GET',
      redirect: 'error',
      headers,
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) return 'Unavailable (User ID: ' + cleanLine(userId) + ')';
    const data = await r.json();
    const email = cleanLine(data?.email || data?.user?.email || '');
    return email || ('Unavailable (User ID: ' + cleanLine(userId) + ')');
  } catch {
    return 'Unavailable (User ID: ' + cleanLine(userId || 'unknown') + ')';
  }
}

async function describePlan(job, db) {
  if (job.credit_source !== 'subscription') return 'Free Audit';
  try {
    const subs = await db('geo_subscriptions?user_id=eq.' + job.user_id + '&select=plan&limit=1');
    const tier = cleanLine(subs?.[0]?.plan || '');
    return tier ? 'Paid Subscription (' + tier + ')' : 'Paid Subscription';
  } catch {
    return 'Paid Subscription';
  }
}

async function sendOwnerNotice({job, report, errorMessage, db, env, fetchImpl}) {
  const [customerEmail, planLabel] = await Promise.all([
    lookupCustomerEmail(job.user_id, env, fetchImpl),
    describePlan(job, db)
  ]);
  const finishedIso = new Date().toISOString();
  let lines;
  if (report) {
    const pillars = Array.isArray(report.pillars)
      ? report.pillars.map(p => cleanLine(p.name) + ' ' + p.score).join(' | ')
      : '';
    const skippedCount = Array.isArray(report.skipped) ? report.skipped.length : 0;
    lines = [
      'GEO Website Audit Alert (Completed)',
      '',
      'Customer account email: ' + customerEmail,
      'Website scanned: ' + cleanLine(job.target_url),
      'Domain: ' + cleanLine(job.hostname),
      'Plan type: ' + planLabel,
      'Pages analyzed: ' + Number(report.pageCount ?? report.pages?.length ?? 0) + ' (limit ' + Number(report.pageLimit ?? job.reserved_pages ?? 25) + ')',
      'Overall GEO score: ' + Number(report.score ?? 0) + ' / 100',
      ...(pillars ? ['Pillar scores: ' + pillars] : []),
      ...(skippedCount > 0 ? ['Skipped oversized pages: ' + skippedCount] : []),
      'Completed at (UTC): ' + finishedIso,
      'Job ID: ' + cleanLine(job.id)
    ];
  } else {
    lines = [
      'GEO Website Audit Alert (Failed)',
      '',
      'Customer account email: ' + customerEmail,
      'Website requested: ' + cleanLine(job.target_url),
      'Domain: ' + cleanLine(job.hostname),
      'Plan type: ' + planLabel + ' (reservation automatically restored)',
      'Error reason: ' + cleanLine(errorMessage || 'Unknown error'),
      'Finished at (UTC): ' + finishedIso,
      'Job ID: ' + cleanLine(job.id)
    ];
  }

  const fields = {
    'form-name': 'contact',
    firstName: 'AEOGEOSearch',
    lastName: report ? 'GEO Audit Completed' : 'GEO Audit Failed',
    email: OWNER_EMAIL,
    phone: '',
    'bot-field': '',
    message: lines.join('\n')
  };
  const response = await fetchImpl(SITE_FORM_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams(fields).toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(10000)
  });
  if (![200, 201, 202, 302, 303].includes(response.status)) {
    throw new Error('Owner notice HTTP ' + response.status);
  }
  if ([302, 303].includes(response.status)) {
    const dest = new URL(response.headers.get('location') || '', SITE_FORM_URL);
    if (dest.origin !== 'https://aeogeosearch.com') {
      throw new Error('Unexpected owner notice redirect');
    }
  }
}

function createAuditBackgroundHandler({
  db = defaultDb,
  verifySignature = defaultVerifySignature,
  crawlSite = defaultCrawlSite,
  fetchImpl = fetch,
  env = process.env
} = {}) {
  return async event => {
    let id;
    try {
      id = JSON.parse(event.body || '{}').id;
    } catch {
      return reply(400, {error: 'Invalid job'});
    }
    if (!verifySignature(id, event.headers?.['x-audit-time'] || event.headers?.['X-Audit-Time'], event.headers?.['x-audit-signature'] || event.headers?.['X-Audit-Signature'])) {
      return reply(401, {error: 'Invalid signature'});
    }
    let job = null;
    try {
      const rows = await db('geo_jobs?id=eq.' + id + '&status=eq.queued', {
        method: 'PATCH',
        headers: {Prefer: 'return=representation'},
        body: {status: 'running', started_at: new Date().toISOString()}
      });
      if (!rows?.length) return reply(200, {ok: true});
      job = rows[0];
      const report = await crawlSite(job.target_url, {
        pageLimit: job.reserved_pages,
        onProgress: progress => db('geo_jobs?id=eq.' + id + '&status=eq.running', {method: 'PATCH', body: {progress}})
      });
      await db('rpc/geo_finish_job', {method: 'POST', body: {p_job: id, p_report: report, p_error: null}});
      console.log('GEO audit completed', JSON.stringify({id, domain: job.hostname, credit: job.credit_source, pages: report.pageCount, score: report.score}));
      try {
        await sendOwnerNotice({job, report, errorMessage: null, db, env, fetchImpl});
      } catch (noticeErr) {
        console.warn('Audit owner notice not confirmed', id, noticeErr.message);
      }
    } catch (e) {
      console.error('Audit failed', id, e.message);
      if (job) {
        await db('rpc/geo_finish_job', {
          method: 'POST',
          body: {p_job: id, p_report: null, p_error: 'No report produced: ' + e.message + ' Your reservation was restored.'}
        });
        try {
          await sendOwnerNotice({job, report: null, errorMessage: e.message, db, env, fetchImpl});
        } catch (noticeErr) {
          console.warn('Audit owner failure notice not confirmed', id, noticeErr.message);
        }
      }
    }
    return reply(200, {ok: true});
  };
}

exports.handler = createAuditBackgroundHandler();
exports.createAuditBackgroundHandler = createAuditBackgroundHandler;
