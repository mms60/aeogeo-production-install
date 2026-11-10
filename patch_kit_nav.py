import pathlib, sys

ROOT = pathlib.Path.cwd()
if not (ROOT / 'templates' / 'site-header.html').exists() or not (ROOT / 'site').is_dir():
    sys.exit('Run this from the repo root (the folder containing site\\ and templates\\).')

PATCH = '<a href="/directory-listing-kit/">Directory Listing Kit</a>'
OLD_NAV = '/assets/app.js?nav=full-diy-about-v1'
NEW_NAV = '/assets/app.js?nav=full-diy-about-v2'
STATIC_ANCHOR = '<a href="/competitor-intelligence">Competitor Intelligence</a>'
STATIC_NEW = STATIC_ANCHOR + PATCH

nav_files = nav_count = 0
static_files = static_inserts = 0
skipped = []

for f in sorted(ROOT.glob('site/**/*.html')):
    s = f.read_text(encoding='utf-8')
    orig = s
    n1 = s.count(OLD_NAV)
    if n1:
        nav_files += 1
        nav_count += n1
        s = s.replace(OLD_NAV, NEW_NAV)
    react_managed = '/assets/app.js' in s
    n2 = s.count(STATIC_ANCHOR)
    if n2:
        if react_managed:
            skipped.append((f, n2))
        else:
            static_files += 1
            static_inserts += n2
            s = s.replace(STATIC_ANCHOR, STATIC_NEW)
    if s != orig:
        f.write_text(s, encoding='utf-8')

TF = ROOT / 'templates' / 'site-header.html'
ts = TF.read_text(encoding='utf-8')
tcount = ts.count(STATIC_ANCHOR)
if tcount == 0:
    sys.exit('Abort: DIY Tools anchor not found in templates/site-header.html (nothing else written except nav-version bumps).')
TF.write_text(ts.replace(STATIC_ANCHOR, STATIC_NEW), encoding='utf-8')

print('nav cache-buster bump (v1 -> v2): %d file(s), %d tag(s)' % (nav_files, nav_count))
print('DIY Tools dropdown link inserted (static pages): %d file(s), %d insertion(s)' % (static_files, static_inserts))
print('templates/site-header.html: %d insertion(s)' % tcount)
if skipped:
    print('SKIPPED (React-managed pages, left to app.js do the work):')
    for f, n in skipped:
        print('   ', f.relative_to(ROOT), '(%d)' % n)
print()
print('Now review with: git diff --stat')
print('Then validate the bundle: node --check site\\assets\\app.js')
