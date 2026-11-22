from pathlib import Path
import base64,gzip,json
root=Path(__file__).resolve().parents[1]
files=[]
# Do not bundle a stale/incomplete copy of the existing website. The installer preserves
# every original page and image by copying the owner's actual extracted LIVE backup.
for folder in ['site/geo-audit','site/account','site/login','site/auth','site/assets/fonts','netlify','database','templates']:
 files.extend(p for p in (root/folder).rglob('*') if p.is_file())
for name in ['geo.css','geo.js','geo-nav.js','supabase.js','audit-tool.css','audit-tool.js','audit-fonts.css','sample-report.json','sample-comparison.json']:
 files.append(root/'site/assets'/name)
files.extend(root/p for p in ['package.json','package-lock.json','netlify.toml','.env.example','.gitignore','BUILD-STATUS.md'])
files.extend(p for p in (root/'scripts').iterdir() if p.is_file())
files.extend(p for p in (root/'tests').glob('*.test.cjs'))
payload={str(p.relative_to(root)).replace('\\','/'):base64.b64encode(p.read_bytes()).decode() for p in files}
data=base64.b64encode(gzip.compress(json.dumps(payload,separators=(',',':')).encode(),mtime=0)).decode()
script=(root/'scripts/installer-template.cjs').read_text().replace('__PAYLOAD__',data)
(root.parent/'add-geo-audit-to-my-website.cjs').write_text(script)
print('Built standalone local-only installer from original audit UI and verified website navigation patch.')
