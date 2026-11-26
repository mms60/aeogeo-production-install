#!/usr/bin/env node
'use strict';
// Content Decay credits - read-only reconciliation against Stripe.
//
// Finds the two ways a buyer can be charged $49 and still have no report:
//   - a paid credit checkout with no open or claimed credit row, and
//   - a reservation still 'pending' whose Stripe session already completed.
//
// Nothing is written, retried or fixed here. It only reads Stripe and the
// credit table and prints what a human should look at.
//
// Run it locally with the production credentials in the environment:
//   node scripts/reconcile-content-decay-credits.cjs --days 30
//
// Required env vars: STRIPE_SECRET_KEY (or STRIPE_SECRET_KEY_TEST when
// CONTENT_DECAY_TEST_MODE=true), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Node's --env-file flag or --env-file <path> can supply them from a local file.

const config = require('../netlify/functions/lib/content-decay-config');
const {db} = require('../netlify/functions/lib/db');
const {reconcileCredits} = require('../netlify/functions/lib/content-decay-reconcile');

const STRIPE_VERSION = '2025-02-24.acacia';
const DAY_MS = 86400000;
const SESSION = /^cs_[A-Za-z0-9_]+$/;
const ROW_FIELDS = 'id,status,environment,user_id,stripe_session_id,amount_total,currency,created_at';
const LIST_PAGE_LIMIT = 100;
const LIST_PAGE_MAX = 50;
const PENDING_RETRIEVE_MAX = 100;

function usage() {
  console.log('Usage: node scripts/reconcile-content-decay-credits.cjs [--days N] [--json] [--env-file PATH]');
  console.log('');
  console.log('  --days N        Stripe checkout sessions to read, newest first (default 30, max 365)');
  console.log('  --json          Print the findings as JSON');
  console.log('  --env-file PATH Load STRIPE_SECRET_KEY, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from PATH');
  console.log('');
  console.log('Exit codes: 0 no critical findings, 1 critical findings, 2 the check could not run.');
  console.log('Reads only. Nothing is changed in Stripe or the database.');
}

function parseArgs(argv) {
  const args = {days: 30, json: false, envFile: null, help: false};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--days' || arg.startsWith('--days=')) {
      const value = arg.startsWith('--days=') ? arg.slice(7) : argv[++index];
      const days = Number(value);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        throw new Error('--days must be a whole number between 1 and 365.');
      }
      args.days = days;
    } else if (arg === '--env-file' || arg.startsWith('--env-file=')) {
      const value = arg.startsWith('--env-file=') ? arg.slice(11) : argv[++index];
      if (!value) throw new Error('--env-file needs a path.');
      args.envFile = value;
    } else {
      throw new Error('Unknown argument: ' + arg);
    }
  }
  return args;
}

async function stripeGet(key, path) {
  const response = await fetch('https://api.stripe.com/v1/' + path, {
    headers: {Authorization: 'Bearer ' + key, 'Stripe-Version': STRIPE_VERSION},
    signal: AbortSignal.timeout(20000)
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const code = body?.error?.code ? ' (' + body.error.code + ')' : '';
    throw new Error('Stripe ' + path.split('?')[0] + ' failed: HTTP ' + response.status + code);
  }
  return body;
}

async function listSessions(key, sinceMs) {
  const sessions = [];
  let after = null;
  for (let page = 0; page < LIST_PAGE_MAX; page += 1) {
    const query = new URLSearchParams({
      limit: String(LIST_PAGE_LIMIT),
      'created[gte]': String(Math.floor(sinceMs / 1000))
    });
    if (after) query.set('starting_after', after);
    const body = await stripeGet(key, 'checkout/sessions?' + query.toString());
    const rows = Array.isArray(body?.data) ? body.data : [];
    sessions.push(...rows);
    if (!body?.has_more || rows.length === 0) return sessions;
    after = rows[rows.length - 1].id;
  }
  throw new Error('Stripe returned more than ' + (LIST_PAGE_LIMIT * LIST_PAGE_MAX)
    + ' sessions in this window; narrow it with --days.');
}

async function creditRows(environment, sinceIso) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 50000; offset += pageSize) {
    const page = await db(
      'content_decay_report_credits?environment=eq.' + encodeURIComponent(environment)
      + '&created_at=gte.' + encodeURIComponent(sinceIso)
      + '&select=' + ROW_FIELDS
      + '&order=created_at.desc&limit=' + pageSize + '&offset=' + offset
    );
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function pendingRows(environment) {
  const rows = await db(
    'content_decay_report_credits?environment=eq.' + encodeURIComponent(environment)
    + '&status=eq.pending&select=' + ROW_FIELDS + '&limit=1000'
  );
  return Array.isArray(rows) ? rows : [];
}

// A reservation older than the window still needs its session read, because a
// payment that was never opened stays pending for as long as nobody looks.
async function sessionsForPending(key, pending, known) {
  const sessions = [];
  const warnings = [];
  let retrieved = 0;
  for (const row of pending) {
    const sessionId = String(row.stripe_session_id || '');
    if (!SESSION.test(sessionId) || known.has(sessionId)) continue;
    if (retrieved >= PENDING_RETRIEVE_MAX) {
      warnings.push('Stopped after ' + PENDING_RETRIEVE_MAX + ' pending-session reads; run again with a narrower --days.');
      break;
    }
    retrieved += 1;
    try {
      sessions.push(await stripeGet(key, 'checkout/sessions/' + encodeURIComponent(sessionId)));
    } catch (error) {
      warnings.push('Could not read pending credit session ' + sessionId + ': ' + error.message);
    }
  }
  return {sessions, warnings};
}

function uniqueById(rows) {
  const byId = new Map();
  for (const row of rows) if (row?.id) byId.set(row.id, row);
  return [...byId.values()];
}

function money(finding) {
  if (!Number.isSafeInteger(finding.amountTotal)) return 'amount unknown';
  return (finding.amountTotal / 100).toFixed(2) + ' ' + String(finding.currency || '').toUpperCase();
}

function describe(finding) {
  return finding.kind.padEnd(22)
    + ' credit ' + (finding.creditId || '(none)')
    + '  session ' + (finding.sessionId || '(none)')
    + '  ' + money(finding)
    + '  status ' + (finding.status || 'unknown')
    + '  paid ' + (finding.createdAt || 'unknown');
}

function printReport(result, {days, sinceIso, warnings}) {
  const critical = result.findings.filter(item => item.severity === 'critical');
  const review = result.findings.filter(item => item.severity === 'review');
  console.log('Content Decay credit reconciliation - ' + result.environment);
  console.log('Window: last ' + days + ' day' + (days === 1 ? '' : 's') + ' (since ' + sinceIso + ')');
  console.log('Stripe sessions read: ' + result.counts.sessions
    + ' - paid credit payments: ' + result.counts.paidCreditSessions);
  console.log('Credit rows read: ' + result.counts.credits + ' - pending: ' + result.counts.pending);
  console.log('');

  if (result.findings.length === 0) {
    console.log('No missing or unopened credits found. Nothing to reconcile.');
  } else {
    console.log('Critical: ' + critical.length + (critical.length ? ' (money taken without a usable credit)' : ''));
    for (const finding of critical) console.log('- ' + describe(finding));
    if (review.length) {
      console.log('');
      console.log('Review: ' + review.length + ' (refunded or disputed, so expected; confirm the charge matches)');
      for (const finding of review) console.log('- ' + describe(finding));
    }
    console.log('');
    console.log('A critical finding means Stripe has the payment and the credit row is missing, pending or expired.');
    console.log('Re-run the buyer\'s confirm for that session, or open the credit row, before telling them it is lost.');
  }
  for (const warning of warnings) console.log('Warning: ' + warning);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return 0;
  }
  if (args.envFile) {
    if (typeof process.loadEnvFile !== 'function') {
      throw new Error('--env-file needs Node 20.12 or newer (this is ' + process.version + ').');
    }
    try {
      process.loadEnvFile(args.envFile);
    } catch {
      throw new Error('Could not read the env file: ' + args.envFile);
    }
  }

  const {key, mode} = config.credential();
  const sinceMs = Date.now() - args.days * DAY_MS;
  const sinceIso = new Date(sinceMs).toISOString();

  const [sessions, windowRows, pending] = await Promise.all([
    listSessions(key, sinceMs),
    // A reservation is written before its session, so read rows from slightly
    // before the window or a session at the boundary could look unmatched.
    creditRows(mode, new Date(sinceMs - 2 * DAY_MS).toISOString()),
    pendingRows(mode)
  ]);
  const credits = uniqueById([...(Array.isArray(windowRows) ? windowRows : []), ...pending]);
  const extra = await sessionsForPending(key, pending, new Set(sessions.map(session => session.id)));
  const result = reconcileCredits({
    sessions: [...sessions, ...extra.sessions],
    credits,
    environment: mode
  });

  if (args.json) {
    console.log(JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      days: args.days,
      since: sinceIso,
      ...result,
      warnings: extra.warnings
    }, null, 2));
  } else {
    printReport(result, {days: args.days, sinceIso, warnings: extra.warnings});
  }

  return result.counts.critical > 0 ? 1 : 0;
}

if (require.main === module) {
  main().then(code => {
    process.exitCode = code;
  }).catch(error => {
    console.error('Reconciliation could not run: ' + error.message);
    process.exitCode = 2;
  });
}

module.exports = {parseArgs, main, printReport, listSessions, creditRows, pendingRows};
