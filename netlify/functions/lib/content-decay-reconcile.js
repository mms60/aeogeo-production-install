'use strict';
// Content Decay credits - reconciliation between Stripe and the credit table.
//
// Two situations mean a buyer may have paid $49 and still have no report:
//
//   1. A paid credit checkout whose credit row is missing or is not in a live
//      state ('open' or 'claimed'). The payment exists; the entitlement does
//      not. A missing, pending or expired row is critical because the money is
//      still with us. A refunded or revoked row is reported for review: those
//      follow a refund or a dispute, so they are expected, but the charge
//      should still be looked at.
//
//   2. A reservation still 'pending' whose Stripe session already completed.
//      Stripe took the money while the row still looks like a checkout being
//      prepared, so the buyer's slot is held by an unopened purchase.
//
// This module is pure: it takes already-fetched Stripe sessions and credit
// rows and returns findings. It never writes, and it never includes an email
// address, checkout URL or secret in its output.

const PRODUCT = 'content_decay';
const CREDIT_KIND = 'credit';
const LIVE_STATUSES = new Set(['open', 'claimed']);
const REVIEW_STATUSES = new Set(['refunded', 'revoked']);

function paid(session) {
  return session?.payment_status === 'paid' || session?.status === 'complete';
}

function creditKind(session) {
  return session?.metadata?.product === PRODUCT && session?.metadata?.kind === CREDIT_KIND;
}

function inMode(session, environment) {
  if (typeof session?.livemode !== 'boolean') return true;
  return session.livemode === (environment === 'live');
}

function isoDate(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}

function finding(kind, severity, details) {
  return {
    kind,
    severity,
    environment: details.environment,
    creditId: details.creditId || null,
    sessionId: details.sessionId || null,
    status: details.status || null,
    userId: details.userId || null,
    amountTotal: Number.isSafeInteger(details.amountTotal) ? details.amountTotal : null,
    currency: details.currency || null,
    createdAt: details.createdAt || null
  };
}

function reconcileCredits({sessions = [], credits = [], environment = 'live'} = {}) {
  const findings = [];
  const reportedCredits = new Set();
  const reportedSessions = new Set();

  const rows = credits.filter(row => row && (!row.environment || row.environment === environment));
  const bySession = new Map();
  const byId = new Map();
  for (const row of rows) {
    if (row.stripe_session_id) bySession.set(String(row.stripe_session_id), row);
    if (row.id) byId.set(String(row.id), row);
  }

  const sessionById = new Map();
  const paidCreditSessions = [];
  for (const session of sessions) {
    if (!session || !session.id) continue;
    sessionById.set(String(session.id), session);
    if (!creditKind(session) || !inMode(session, environment) || !paid(session)) continue;
    paidCreditSessions.push(session);

    const reservedId = String(session.metadata?.credit_id || '');
    const row = bySession.get(String(session.id)) || (reservedId ? byId.get(reservedId) : null) || null;

    if (!row) {
      reportedSessions.add(String(session.id));
      findings.push(finding('paid_without_credit', 'critical', {
        environment,
        sessionId: session.id,
        creditId: reservedId || null,
        status: 'missing',
        userId: session.metadata?.user_id || null,
        amountTotal: session.amount_total,
        currency: session.currency,
        createdAt: isoDate(session.created)
      }));
      continue;
    }
    if (LIVE_STATUSES.has(row.status)) continue;

    reportedSessions.add(String(session.id));
    reportedCredits.add(row.id);
    // A reservation Stripe already completed is the "paid but still pending"
    // case, named separately so it is clear the row is the thing left behind.
    const kind = row.status === 'pending' ? 'pending_after_payment' : 'paid_credit_not_open';
    findings.push(finding(kind, REVIEW_STATUSES.has(row.status) ? 'review' : 'critical', {
      environment,
      sessionId: session.id,
      creditId: row.id,
      status: row.status,
      userId: row.user_id || session.metadata?.user_id || null,
      amountTotal: Number.isSafeInteger(session.amount_total) ? session.amount_total : row.amount_total,
      currency: session.currency || row.currency,
      createdAt: isoDate(session.created) || isoDate(row.created_at)
    }));
  }

  // The other direction: a reservation that Stripe has already completed. The
  // session is matched by the id stored on the row, so this also catches a row
  // whose webhook and page confirm both never opened it.
  for (const row of rows) {
    if (row.status !== 'pending' || reportedCredits.has(row.id)) continue;
    const session = row.stripe_session_id ? sessionById.get(String(row.stripe_session_id)) : null;
    if (!session || !paid(session)) continue;
    if (reportedSessions.has(String(session.id))) continue;
    reportedCredits.add(row.id);
    findings.push(finding('pending_after_payment', 'critical', {
      environment,
      sessionId: session.id,
      creditId: row.id,
      status: 'pending',
      userId: row.user_id || session.metadata?.user_id || null,
      amountTotal: Number.isSafeInteger(session.amount_total) ? session.amount_total : row.amount_total,
      currency: session.currency || row.currency,
      createdAt: isoDate(session.created) || isoDate(row.created_at)
    }));
  }

  findings.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  return {
    environment,
    findings,
    counts: {
      sessions: sessions.length,
      paidCreditSessions: paidCreditSessions.length,
      credits: rows.length,
      pending: rows.filter(row => row.status === 'pending').length,
      critical: findings.filter(item => item.severity === 'critical').length,
      review: findings.filter(item => item.severity === 'review').length
    }
  };
}

module.exports = {
  PRODUCT,
  CREDIT_KIND,
  LIVE_STATUSES,
  reconcileCredits
};
