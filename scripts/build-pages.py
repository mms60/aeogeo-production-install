"""Verify the cross-file integrations behind the static pages.

Page HTML under site/ is maintained directly. It carries SEO schema, cookie
consent, the unified header and page copy that the original inline templates
never reproduced, so this step deliberately writes no page HTML or shared
assets: regenerating them would replace live pages with older layouts.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'site'

app = (SITE / 'assets/app.js').read_text()
if '{label:"GEO Audit",path:"/geo-audit/"}' not in app:
    raise SystemExit('Navigation marker missing from assets/app.js: restore the GEO Audit entry before building.')

sitemap = (SITE / 'sitemap.xml').read_text()
if '<loc>https://aeogeosearch.com/geo-audit/</loc>' not in sitemap:
    raise SystemExit('GEO Audit URL missing from sitemap.xml: restore it before building.')

print('Page HTML is maintained directly in site/; integration markers verified.')
