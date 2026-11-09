from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
# Preserve the user's original four tiles and drawer layout. Only observations/copy are corrected.
pillars=[('cq','Content Quality',35,'Readability, content depth, numeric detail and standalone answer passages. Editorial checks are labeled as heuristics.'),('ai','AI Readiness',30,'Heading hierarchy, Q&A signals, image alt attributes and semantic clarity. Live platform extraction is not measured.'),('tech','Technical Basis',15,'Search-bot robots permissions, parseable JSON-LD, sitemap membership, initial HTML and declared update dates. Not a speed test.'),('auth','Authority & Trust',20,'External source links, author declarations, sameAs references and internal linking. Authority and credentials are not independently verified.')]
tiles=[];drawer=[]
for n,(id,name,weight,description) in enumerate(pillars,1):
 tiles.append(f'''<div class="glass-card" style="border-radius:1rem;padding:1.35rem;"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:.65rem;gap:.5rem;"><div><span style="font-size:.7rem;font-weight:700;text-transform:uppercase;color:var(--color-royal-400);letter-spacing:.06em;">PILLAR {n} · {weight}% WEIGHT</span><h4 class="font-display" style="font-size:1.1rem;font-weight:700;color:#fff;">{name}</h4></div><span class="score-badge score-unavailable" id="pillar-score-{id}">N/A</span></div><p style="font-size:.78rem;color:var(--color-ice-300);margin-bottom:.85rem;">{description}</p><div class="progress-bar-track"><div id="pillar-bar-{id}" class="progress-bar-fill" style="width:0%;"></div></div></div>''')
 drawer.append(f'''<div class="glass" style="border-radius:.65rem;padding:.75rem .5rem;"><div style="font-size:.65rem;color:var(--color-ice-300);">{id.upper()} ({weight}%)</div><div class="font-display" id="drawer-{id}" style="font-size:1.1rem;font-weight:700;color:#fff;">N/A</div></div>''')
s=(root/'templates/audit-tool.html').read_text().replace('{{PILLARS}}','\n'.join(tiles)).replace('{{DRAWER_PILLARS}}','\n'.join(drawer))
assert '\u2014' not in s and '&mdash;' not in s
out=root/'site/geo-audit/run/index.html';out.parent.mkdir(parents=True,exist_ok=True);out.write_text(s)
# Share existing audited helpers, not the substitute dashboard rendering or synthetic engine.
shared=(root/'site/assets/geo.js').read_text().split('function renderReport(')[0]
assert shared.startswith('/* AEOGEO') and 'function aggregate(' in shared
js=shared+(root/'scripts/audit-adapter.jsfrag').read_text()
(root/'site/assets/audit-tool.js').write_text(js)
fontcss='\n'.join(re.findall(r'@font-face\{[^}]+\}',(root/'site/assets/geo.css').read_text()))
assert fontcss.count('@font-face')==9
(root/'site/assets/audit-fonts.css').write_text('/* Original website Sora/Inter fonts. OFL licenses in assets/fonts. */\n'+fontcss+'\n')
print('Built the user-supplied audit layout with real-report, progress, account and export adapters.')
