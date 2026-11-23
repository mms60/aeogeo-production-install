#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const API = 'https://api.netlify.com/api/v1';
const ROOT = path.join(__dirname, '..');
const SITE_ID = process.env.NETLIFY_SITE_ID || readStateSiteId() || '5e907ce6-0971-4862-9d52-651026e37c00';

function readStateSiteId() {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(ROOT, '.netlify/state.json'), 'utf8'));
    return state.siteId || null;
  } catch {
    return null;
  }
}

function localCliToken() {
  const candidates = [
    process.env.NETLIFY_CONFIG_PATH,
    process.env.APPDATA && path.join(process.env.APPDATA, 'netlify', 'Config', 'config.json'),
    path.join(os.homedir(), '.config', 'netlify', 'config.json')
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const config = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      const current = config.users?.[config.userId];
      const token = current?.auth?.token || Object.values(config.users || {}).map(user => user?.auth?.token).find(Boolean);
      if (token) return token;
    } catch {
      // Try the next known CLI config location.
    }
  }
  return null;
}

const token = process.env.NETLIFY_AUTH_TOKEN || (process.env.CI ? null : localCliToken());

function usage() {
  console.error('Usage: node scripts/check-published-deploy.cjs [--expected <commit>]');
  console.error('Expected defaults to origin/main. Requires NETLIFY_AUTH_TOKEN in CI; locally falls back to the Netlify CLI login.');
}

function readOption(name) {
  const args = process.argv.slice(2);
  const withEquals = args.find(arg => arg.startsWith(name + '='));
  if (withEquals) return withEquals.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function short(value) {
  return String(value || '').slice(0, 12);
}

function sameCommit(left, right) {
  const a = String(left || '').toLowerCase();
  const b = String(right || '').toLowerCase();
  return a.length >= 7 && b.length >= 7 && (a.startsWith(b) || b.startsWith(a));
}

async function getSite() {
  if (!token) {
    throw new Error('NETLIFY_AUTH_TOKEN is required in CI. Add it as a repository secret, or sign in with the Netlify CLI locally.');
  }

  const response = await fetch(`${API}/sites/${encodeURIComponent(SITE_ID)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Netlify site lookup failed: HTTP ${response.status}${text ? ` ${text.slice(0, 200)}` : ''}`);
  }
  return JSON.parse(text);
}

(async () => {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  const expected = readOption('--expected') || git('rev-parse', 'origin/main');
  if (!/^[0-9a-f]{7,40}$/i.test(expected)) {
    throw new Error(`Expected commit is not a Git SHA: ${expected}`);
  }

  const site = await getSite();
  const live = site.published_deploy;
  if (!live) throw new Error('Netlify has no published deploy for this site.');
  if (live.state !== 'ready' || !live.published_at) {
    throw new Error(`Published deploy ${live.id || '(unknown)'} is not ready/published.`);
  }
  if (live.locked !== false) {
    throw new Error(`Auto publishing is not confirmed enabled: published deploy locked=${String(live.locked)}.`);
  }
  if (!live.commit_ref) {
    throw new Error('Published deploy has no commit_ref; cannot verify Git provenance.');
  }
  if (!sameCommit(live.commit_ref, expected)) {
    throw new Error(`Production is stale: published commit ${live.commit_ref} does not match expected ${expected}.`);
  }

  console.log(`Published deploy OK: ${site.name || SITE_ID} ${short(live.id)}`);
  console.log(`Commit: ${short(live.commit_ref)} (expected ${short(expected)})`);
  console.log('Auto publishing: ON');
})().catch(error => {
  console.error(`Published deploy check failed: ${error.message}`);
  process.exitCode = 1;
});
