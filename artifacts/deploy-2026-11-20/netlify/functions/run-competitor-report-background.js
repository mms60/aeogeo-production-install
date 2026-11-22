'use strict';

const { db, reply, verifySignature } = require('./lib/db');
const { createCompetitorEngine } = require('./lib/competitor-engine');
const { buildCompetitorPdf } = require('./lib/competitor-pdf');

exports.handler = async event => {
  let id;
  try {
    id = JSON.parse(event.body || '{}').id;
  } catch {
    return reply(400, { error: 'Invalid job payload' });
  }
  const timeHeader = event.headers?.['x-audit-time'] || event.headers?.['X-Audit-Time'];
  const sigHeader = event.headers?.['x-audit-signature'] || event.headers?.['X-Audit-Signature'];
  if (!verifySignature(id, timeHeader, sigHeader)) {
    return reply(401, { error: 'Invalid dispatch signature' });
  }

  try {
    const claimed = await db(`geo_competitor_reports?id=eq.${id}&status=eq.queued`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: { status: 'running', started_at: new Date().toISOString() }
    });
    if (!claimed?.length) return reply(200, { ok: true });

    const job = claimed[0];
    let previousReport = null;
    if (job.plan === 'monthly') {
      const priorRows = await db(
        `geo_competitor_reports?user_id=eq.${job.user_id}&target_domain=eq.${encodeURIComponent(job.target_domain)}&status=eq.completed&id=neq.${job.id}&select=report&order=completed_at.desc&limit=1`
      );
      if (priorRows?.[0]?.report) previousReport = priorRows[0].report;
    }

    const engine = createCompetitorEngine();
    const report = await engine.runCompetitorAnalysis({
      targetUrl: job.target_url,
      competitorUrls: Array.isArray(job.competitor_urls) ? job.competitor_urls : [],
      plan: job.plan,
      previousReport,
      onProgress: progress =>
        db(`geo_competitor_reports?id=eq.${id}&status=eq.running`, {
          method: 'PATCH',
          body: { progress }
        }).catch(() => {})
    });

    const { pageCount } = buildCompetitorPdf(report, { domain: job.target_domain, createdAt: report.generatedAt });
    await db('rpc/geo_competitor_finish_report', {
      method: 'POST',
      body: { p_report: id, p_data: report, p_pages: pageCount, p_error: null }
    });
  } catch (err) {
    console.error('Competitor report failed', id, err.message);
    await db('rpc/geo_competitor_finish_report', {
      method: 'POST',
      body: {
        p_report: id,
        p_data: null,
        p_pages: null,
        p_error: `Report could not be completed: ${err.message} Your report run allowance was restored.`
      }
    }).catch(() => {});
  }

  return reply(200, { ok: true });
};
