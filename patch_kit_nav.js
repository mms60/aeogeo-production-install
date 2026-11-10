'use strict';
// Adds "Directory Listing Kit" to the DIY Tools dropdown.
// Safe to run from the repo root; harmless if run twice.
const fs = require('fs'), path = require('path');
const ROOT = process.cwd();
if (!fs.existsSync(path.join(ROOT, 'templates', 'site-header.html')) || !fs.statSync(path.join(ROOT, 'site')).isDirectory()) {
  console.error('Run this from the repo root (the folder containing site\\ and templates\\).'); process.exit(1);
}
const PATCH = '<a href="/directory-listing-kit/">Directory Listing Kit</a>';
const OLD_NAV = '/assets/app.js?nav=full-diy-about-v1';
const NEW_NAV = '/assets/app.js?nav=full-diy-about-v2';
const STATIC_ANCHOR = '<a href="/competitor-intelligence">Competitor Intelligence</a>';
const STATIC_NEW = STATIC_ANCHOR + PATCH;
function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.html')) yield p;
  }
}
let navFiles = 0, navCount = 0, staticFiles = 0, staticInserts = 0;
const skipped = [];
for (const f of walk(path.join(ROOT, 'site'))) {
  let s = fs.readFileSync(f, 'utf8'); const orig = s;
  const n1 = s.split(OLD_NAV).length - 1;
  if (n1) { navFiles++; navCount += n1; s = s.split(OLD_NAV).join(NEW_NAV); }
  const reactManaged = s.includes('/assets/app.js');
  const n2 = s.split(STATIC_ANCHOR).length - 1;
  if (n2 && !s.includes(PATCH)) {
    if (reactManaged) skipped.push([path.relative(ROOT, f), n2]);
    else { staticFiles++; staticInserts += n2; s = s.split(STATIC_ANCHOR).join(STATIC_NEW); }
  }
  if (s !== orig) fs.writeFileSync(f, s);
}
const TF = path.join(ROOT, 'templates', 'site-header.html');
const ts = fs.readFileSync(TF, 'utf8');
if (!ts.includes(PATCH)) {
  const tcount = ts.split(STATIC_ANCHOR).length - 1;
  if (tcount === 0) { console.error('Abort: DIY Tools anchor not found in templates/site-header.html.'); process.exit(1); }
  fs.writeFileSync(TF, ts.split(STATIC_ANCHOR).join(STATIC_NEW));
  console.log('templates/site-header.html: ' + tcount + ' insertion(s)');
} else {
  console.log('templates/site-header.html: already patched, skipped');
}
console.log('nav cache-buster bump (v1 -> v2): ' + navFiles + ' file(s), ' + navCount + ' tag(s)');
console.log('DIY Tools dropdown link inserted (static pages): ' + staticFiles + ' file(s), ' + staticInserts + ' insertion(s)');
if (skipped.length) {
  console.log('SKIPPED (React-managed pages, left to app.js do the work):');
  for (const [f, n] of skipped) console.log('    ' + f + ' (' + n + ')');
}
console.log();
console.log('Now review with: git diff --stat');
console.log('Then validate the bundle: node --check site\\assets\\app.js');
