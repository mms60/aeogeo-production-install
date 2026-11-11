from pathlib import Path
import json, re

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'site'
SHELL = SITE / 'tools/geo-content-checker/index.html'

shell = SHELL.read_text(encoding='utf-8')
css = (ROOT / 'templates/studio-page.css').read_text(encoding='utf-8')
body = (ROOT / 'templates/studio-page-body.html').read_text(encoding='utf-8')

root_at = shell.index('<div id="root">')
main_at = shell.index('<main', root_at)
main_end = shell.index('</main>', main_at)
body_prefix = shell[root_at:main_at]
main_tag = shell[main_at:shell.index('>', main_at) + 1]
tail = shell[main_end:]

scripts = '\n'.join(m.group(0) for m in re.finditer(
    r'<script[^>]*src="/assets/[^"]+"[^>]*>\s*</script>', shell, re.S))
assert scripts.count('<script') >= 4, f'site shell scripts not found (got {scripts.count("<script")})'

URL = 'https://aegeosearch.com/ai-visibility-schema-studio'
TITLE = 'AI Visibility & Schema Studio | AEOGEO Search'
DESC = ('Find out why AI search engines cannot read your site, fix the gaps, and generate schema '
        'that explains your business. $49 per month, per website.')

app_schema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "AI Visibility & Schema Studio",
    "applicationCategory": "BusinessApplication",
    "operatingSystem": "Web",
    "url": URL,
    "description": ("A paid workspace that tests AI crawler accessibility, audits existing JSON-LD "
                    "structured data, and generates customized JSON-LD drafts for review."),
    "provider": {"@type": "Organization", "name": "AEOGEO Search", "url": "https://aegeosearch.com/"},
    "offers": {
        "@type": "Offer",
        "price": "49",
        "priceCurrency": "USD",
        "priceSpecification": {
            "@type": "UnitPriceSpecification",
            "price": "49",
            "priceCurrency": "USD",
            "unitText": "month",
            "referenceQuantity": {"@type": "QuantitativeValue", "value": 1, "unitText": "website"},
        },
    },
}
crumb_schema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://aegeosearch.com/"},
        {"@type": "ListItem", "position": 2, "name": "AI Visibility & Schema Studio", "item": URL},
    ],
}

head = f'''<!DOCTYPE html>
<html lang="en-US"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta name="theme-color" content="#050b1f"/>
<meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1"/>
<title>{TITLE}</title>
<meta name="description" content="{DESC}"/>
<link rel="canonical" href="{URL}"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="AEOGEO Search"/>
<meta property="og:locale" content="en_US"/>
<meta property="og:title" content="{TITLE}"/>
<meta property="og:description" content="{DESC}"/>
<meta property="og:url" content="{URL}"/>
<meta property="og:image" content="https://aegeosearch.com/images/bg-ai-circles.jpg"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="{TITLE}"/>
<meta name="twitter:description" content="{DESC}"/>
<meta name="twitter:image" content="https://aegeosearch.com/images/bg-ai-circles.jpg"/>
<script type="application/ld+json">{json.dumps(app_schema)}</script>
<script type="application/ld+json">{json.dumps(crumb_schema)}</script>
<link rel="stylesheet" href="/assets/site.css"/>
<link rel="stylesheet" href="/assets/site-header.css"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin=""/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sora:wght@400;500;600;700;800&display=swap" media="all" onload="this.media='all'"/>
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sora:wght@400;500;600;700;800&display=swap"/></noscript>
<style>{css}</style>
{scripts}
</head>
<body class="bg-navy-950 font-body">
'''

out = head + body_prefix + main_tag + body + tail
target = SITE / 'ai-visibility-schema-studio.html'
target.write_text(out, encoding='utf-8')
print('wrote', target.relative_to(ROOT), len(out), 'bytes')
