const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = 'C:\\Users\\micsi\\Downloads\\aeogeo-production-install\\';
const read = p => fs.readFileSync(ROOT + p, 'utf8');
const pricing = read('site/pricing.html');
const fStart = pricing.indexOf('<footer');
const fEnd = pricing.indexOf('</footer>', fStart);
console.log('footer at', fStart);
const FOOTER = pricing.slice(fStart, fEnd + '</footer>'.length);
console.log('footer chars', FOOTER.length);
const bak = path.join(os.tmpdir(), 'aeogeo-footer-backups');
fs.mkdirSync(bak, { recursive: true });
const SITE_CSS = '<link rel="stylesheet" href="/assets/site.css">';
const targets = ['site/geo-audit/index.html','site/ai-content-humanizer.html','site/visibility-tool.html','site/competitor-intelligence/index.html'];
for (const t of targets) {
  let s = read(t);
  fs.writeFileSync(path.join(bak, t.replace(/[\\/]/g, '_') + '.bak'), s);
  if (!s.includes('href="/assets/site.css"')) s = s.replace('</head>', SITE_CSS + '</head>');
  if (/<footer[\s\S]*?<\/footer>/.test(s)) s = s.replace(/<footer[\s\S]*?<\/footer>/, FOOTER);
  else if (s.includes('</body>')) s = s.replace('</body>', FOOTER + '\n</body>');
  else if (s.includes('</html>')) s = s.replace('</html>', FOOTER + '\n</html>');
  else { console.error('SKIPPED', t); continue; }
  fs.writeFileSync(ROOT + t, s);
  console.log('OK', t);
}
let b = read('scripts/build-pages.py');
if (/FOOT='''[\s\S]*?'''/.test(b)) {
  fs.writeFileSync(path.join(bak, 'build-pages.py.bak'), b);
  b = b.replace(/FOOT='''[\s\S]*?'''/, "FOOT='''" + FOOTER + "'''");
  const tpl = '<link rel="stylesheet" href="/assets/site-header.css">';
  if (!b.includes('href="/assets/site.css"') && b.includes(tpl)) b = b.replace(tpl, tpl + SITE_CSS);
  fs.writeFileSync(ROOT + 'scripts/build-pages.py', b);
  console.log('OK scripts/build-pages.py');
}
console.log('Done. Backups in ' + bak);
