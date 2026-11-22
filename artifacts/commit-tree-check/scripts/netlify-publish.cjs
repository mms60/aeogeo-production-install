'use strict';

// Publish a ready production deploy while the Netlify deploy lock stays on.
// The lock is Netlify's "stop auto publishing" gate. This script never changes
// it: it refuses to publish when the lock is off and verifies it afterwards.
//
// Usage:
//   NETLIFY_AUTH_TOKEN=... node scripts/netlify-publish.cjs
//   NETLIFY_AUTH_TOKEN=... node scripts/netlify-publish.cjs --deploy 1
//   NETLIFY_AUTH_TOKEN=... node scripts/netlify-publish.cjs --deploy <deploy-id> --dry-run

const readline = require('node:readline/promises');

const API = 'https://api.netlify.com/api/v1';
const SITE_ID = process.env.NETLIFY_SITE_ID || '5e907ce6-0971-4862-9d52-651026e37c00';
const LIST_LIMIT = 10;
const token = process.env.NETLIFY_AUTH_TOKEN;

function usage() {
  console.error('Usage: NETLIFY_AUTH_TOKEN=... node scripts/netlify-publish.cjs [--deploy <number|deploy-id>] [--dry-run]');
  console.error('Without --deploy, the newest ready production deploys are listed and one is chosen interactively.');
}

function short(value, length = 12) {
  return String(value || '').slice(0, length);
}

function when(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'unknown time' : date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function sameCommit(a, b) {
  const left = String(a || '').toLowerCase();
  const right = String(b || '').toLowerCase();
  return left.length >= 7 && right.length >= 7 && (left.startsWith(right) || right.startsWith(left));
}

async function api(path, options = {}) {
  const response = await fetch(API + path, {
    ...options,
    headers: { Authorization: 'Bearer ' + token, ...(options.headers || {}) },
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const detail = body && typeof body === 'object' && body.message ? ': ' + body.message : '';
    throw new Error(`Netlify API ${options.method || 'GET'} ${path} failed (${response.status})${detail}`);
  }
  return body;
}

function readyProductionDeploys(deploys) {
  return (Array.isArray(deploys) ? deploys : [])
    .filter(deploy => deploy.context === 'production' && deploy.state === 'ready')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, LIST_LIMIT);
}

function resolveChoice(value, deploys) {
  const text = String(value || '').trim();
  if (/^\d+$/.test(text)) {
    const index = Number(text);
    return index >= 1 && index <= deploys.length ? deploys[index - 1] : null;
  }
  const exact = deploys.find(deploy => deploy.id === text);
  if (exact) return exact;
  if (!/^[a-f0-9]{6,}$/i.test(text)) return null;
  const matches = deploys.filter(deploy => deploy.id.toLowerCase().startsWith(text.toLowerCase()));
  return matches.length === 1 ? matches[0] : null;
}

function describe(deploy, publishedId) {
  const title = String(deploy.title || deploy.commit_message || '').replace(/\s+/g, ' ').trim();
  const live = deploy.id === publishedId ? '  (live)' : '';
  return `${short(deploy.id)}  ${short(deploy.commit_ref) || 'no-commit'}  ${when(deploy.created_at)}${live}` +
    (title ? '\n     ' + title.slice(0, 90) : '');
}

async function choose(deploys) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`Choose a deploy by number or ID (1-${deploys.length}): `);
    const selected = resolveChoice(answer, deploys);
    if (!selected) throw new Error('That choice does not match one of the listed deploys.');
    const confirmation = (await rl.question(`Publish deploy ${selected.id} (commit ${short(selected.commit_ref)})? [y/N]: `))
      .trim()
      .toLowerCase();
    return { selected, confirmed: confirmation === 'y' || confirmation === 'yes' };
  } finally {
    rl.close();
  }
}

async function liveDeployAfter(deployId, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let site = null;
  while (Date.now() < deadline) {
    site = await api('/sites/' + encodeURIComponent(SITE_ID));
    if (site?.published_deploy?.id === deployId) return site;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return site;
}

async function main() {
  const args = process.argv.slice(2);
  let requested = null;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--deploy') {
      requested = args[++i];
      if (!requested || requested.startsWith('--')) {
        usage();
        process.exitCode = 1;
        return;
      }
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      usage();
      return;
    } else {
      usage();
      process.exitCode = 1;
      return;
    }
  }
  if (!token) {
    throw new Error('NETLIFY_AUTH_TOKEN is not set. Export a Netlify personal access token before running this script.');
  }

  const [site, deploys] = await Promise.all([
    api('/sites/' + encodeURIComponent(SITE_ID)),
    api('/sites/' + encodeURIComponent(SITE_ID) + '/deploys?per_page=100')
  ]);
  const published = site?.published_deploy || null;
  const ready = readyProductionDeploys(deploys);

  console.log('Site: ' + (site?.name || SITE_ID));
  console.log('Live: ' + (published
    ? `${short(published.id)}  ${short(published.commit_ref)}  ${when(published.created_at)}`
    : 'nothing published yet'));
  console.log('Production deploy lock: ' + (published?.locked === true ? 'ON' : 'OFF'));
  console.log('');
  console.log('Newest ready production deploys:');
  if (!ready.length) throw new Error('No ready production deploys were found.');
  ready.forEach((deploy, index) => console.log(`  ${index + 1}) ${describe(deploy, published?.id)}`));
  console.log('');

  if (published?.locked !== true) {
    throw new Error('Refusing to publish because the production deploy lock is off. Turn the lock on in Netlify first; this script never changes the lock setting.');
  }

  let selected;
  if (requested !== null) {
    selected = resolveChoice(requested, ready);
    if (!selected) throw new Error(`"${requested}" does not match one of the listed deploys.`);
  } else {
    if (!process.stdin.isTTY) {
      throw new Error('No interactive terminal. Choose non-interactively with --deploy <number|deploy-id>.');
    }
    const choice = await choose(ready);
    if (!choice.confirmed) {
      console.log('Nothing changed.');
      return;
    }
    selected = choice.selected;
  }

  if (!selected.commit_ref) {
    throw new Error('That deploy has no recorded commit, so the live commit cannot be verified. Choose a deploy built from a commit.');
  }

  if (selected.id === published?.id && sameCommit(selected.commit_ref, published?.commit_ref)) {
    console.log('That deploy is already live. Nothing changed.');
    return;
  }

  if (dryRun) {
    console.log(`Dry run: would publish ${selected.id} (commit ${short(selected.commit_ref)}) with POST /sites/${SITE_ID}/deploys/${selected.id}/restore.`);
    console.log('No changes were made.');
    return;
  }

  const latest = await api('/sites/' + encodeURIComponent(SITE_ID));
  if (latest?.published_deploy?.locked !== true) {
    throw new Error('Refusing to publish because the production deploy lock was turned off. This script never changes the lock setting.');
  }

  console.log(`Publishing ${selected.id} (commit ${short(selected.commit_ref)}) ...`);
  await api(`/sites/${encodeURIComponent(SITE_ID)}/deploys/${encodeURIComponent(selected.id)}/restore`, { method: 'POST' });

  const liveSite = await liveDeployAfter(selected.id);
  const live = liveSite?.published_deploy || null;
  const failures = [];
  if (!live || live.id !== selected.id) {
    failures.push(`the published deploy is ${live ? live.id : 'missing'}, not ${selected.id}`);
  }
  if (!live || !sameCommit(live.commit_ref, selected.commit_ref)) {
    failures.push(`the live commit is ${live?.commit_ref || 'missing'}, not ${selected.commit_ref}`);
  }
  if (live?.locked !== true) failures.push('the production deploy lock is now OFF');

  if (failures.length) {
    console.error('');
    console.error('Publish verification failed:');
    for (const failure of failures) console.error('- ' + failure);
    if (live?.locked !== true) {
      console.error('This script did not change the lock. Check the Netlify deploy settings before relying on the lock.');
    }
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log(`Live: ${short(live.id)}  commit ${short(live.commit_ref)}  ${when(live.created_at)}`);
  console.log('Verified: the chosen commit is live and the production deploy lock is still ON.');
}

main().catch(error => {
  console.error('Deploy publish failed: ' + error.message);
  process.exitCode = 1;
});
