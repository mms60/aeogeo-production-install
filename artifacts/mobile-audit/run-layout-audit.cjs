const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.map': 'application/json'
};

function localFile(pathname) {
  let p = decodeURIComponent(pathname);
  if (p.endsWith('/')) p += 'index.html';
  for (const candidate of [p, p + '.html', p + '/index.html']) {
    const abs = path.join(root, 'site', candidate);
    try {
      if (fs.statSync(abs).isFile()) return abs;
    } catch {}
  }
  return null;
}

function auditExpression() {
  const vw = document.documentElement.clientWidth;
  const visible = (el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 1 && r.height > 1;
  };
  const desc = (el) =>
    (el.id ? '#' + el.id : '') +
    el.tagName.toLowerCase() +
    [...el.classList].slice(0, 3).map((c) => '.' + c).join('');
  const text = (el) => (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 90);
  const clipAncestor = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') return 'scroll';
      if (ox === 'hidden' || ox === 'clip') return 'hidden';
    }
    return null;
  };
  const pos = (el) => getComputedStyle(el).position;
  const docOverflow = Math.max(0, document.documentElement.scrollWidth - vw);

  const rawOffenders = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!visible(el) || el.closest('[aria-hidden="true"],script,style,noscript')) continue;
    if (['fixed', 'sticky'].includes(pos(el))) continue;
    const r = el.getBoundingClientRect();
    if (r.right <= vw + 1 && r.left >= -1) continue;
    const t = text(el);
    if (!t && !el.matches('a,button,input,select,textarea,img,table')) continue;
    rawOffenders.push({
      el: desc(el),
      text: t.slice(0, 60),
      left: Math.round(r.left),
      right: Math.round(r.right),
      width: Math.round(r.width),
      clip: clipAncestor(el)
    });
  }
  const seen = new Set();
  const offenders = rawOffenders
    .filter((o) => {
      const key = o.el + '|' + o.left + '|' + o.right;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Math.max(b.right - vw, -b.left) - Math.max(a.right - vw, -a.left))
    .slice(0, 6);

  const narrowHeadings = [];
  for (const el of document.querySelectorAll('main h1,main h2,main h3,main h4')) {
    if (!visible(el)) continue;
    const t = text(el);
    if (t.length < 8) continue;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const lh = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2 || 20;
    const lines = Math.max(1, Math.round(r.height / lh));
    if ((r.width < 110 && t.length >= 8) || (r.width < 160 && lines >= 4)) {
      narrowHeadings.push({ el: desc(el), text: t, width: Math.round(r.width), height: Math.round(r.height), lines });
    }
  }

  const narrowParagraphs = [];
  for (const el of document.querySelectorAll('main p')) {
    if (!visible(el)) continue;
    const t = text(el);
    if (t.length < 70) continue;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const lh = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2 || 20;
    if (r.width < 125 && r.height / lh >= 4) {
      narrowParagraphs.push({ el: desc(el), text: t, width: Math.round(r.width), lines: Math.round(r.height / lh) });
    }
  }

  const clipped = [];
  for (const el of document.querySelectorAll('main *')) {
    if (!visible(el) || el.closest('[aria-hidden="true"]')) continue;
    const t = text(el);
    if (!t) continue;
    const s = getComputedStyle(el);
    if (!['hidden', 'clip'].includes(s.overflowX)) continue;
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      clipped.push({ el: desc(el), text: t.slice(0, 70), clientWidth: el.clientWidth, scrollWidth: el.scrollWidth });
    }
  }

  const textSel = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,button,a,label,td,th';
  const nodes = [...document.querySelectorAll('main ' + textSel)]
    .filter((el) => {
      if (!visible(el)) return false;
      if (['absolute', 'fixed', 'sticky'].includes(pos(el))) return false;
      if (getComputedStyle(el).pointerEvents === 'none' || el.closest('[aria-hidden="true"]')) return false;
      if (el.parentElement && el.parentElement.closest(textSel)) return false;
      return text(el).length >= 4;
    })
    .slice(0, 350);

  const overlaps = [];
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    const ra = a.getBoundingClientRect();
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      const rb = b.getBoundingClientRect();
      if (a.contains(b) || b.contains(a)) continue;
      const iw = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const ih = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (iw <= 8 || ih <= 6) continue;
      const inter = iw * ih;
      const minArea = Math.min(ra.width * ra.height, rb.width * rb.height);
      if (minArea > 0 && inter / minArea > 0.3) {
        overlaps.push({
          a: desc(a),
          aText: text(a).slice(0, 50),
          b: desc(b),
          bText: text(b).slice(0, 50),
          ratio: Math.round((inter / minArea) * 100)
        });
        if (overlaps.length >= 6) break;
      }
    }
    if (overlaps.length >= 6) break;
  }

  return { docOverflow, offenders, narrowHeadings, narrowParagraphs, clipped: clipped.slice(0, 6), overlaps };
}

module.exports = async function runLayoutAudit(browser, routes, outFile) {
  const auditContext = await browser.newContext({ viewport: { width: 320, height: 900 }, deviceScaleFactor: 1 });
  const page = await auditContext.newPage();

  await page.route('**/*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.hostname === 'site.local') {
      const file = localFile(u.pathname);
      if (!file) return route.fulfill({ status: 404, contentType: 'text/html', body: '<h1>Not found</h1>' });
      return route.fulfill({
        status: 200,
        contentType: types[path.extname(file).toLowerCase()] || 'application/octet-stream',
        body: fs.readFileSync(file)
      });
    }
    if (!/(^|\.)fonts\.googleapis\.com$|(^|\.)fonts\.gstatic\.com$/i.test(u.hostname)) return route.abort();
    try {
      const res = await fetch(req.url(), {
        headers: { 'user-agent': req.headers()['user-agent'] || 'Mozilla/5.0' }
      });
      const headers = Object.fromEntries(res.headers);
      for (const h of [
        'content-encoding',
        'content-length',
        'transfer-encoding',
        'connection',
        'content-security-policy',
        'content-security-policy-report-only'
      ]) {
        delete headers[h];
      }
      return route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) });
    } catch {
      return route.abort();
    }
  });

  const results = [];
  for (const route of routes) {
    const record = { route };
    try {
      await page.setViewportSize({ width: 320, height: 900 });
      const response = await page.goto('http://site.local' + route, { waitUntil: 'domcontentloaded', timeout: 15000 });
      record.status = response?.status();
      await page.waitForTimeout(300);
      await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 800))]));
      await page.addStyleTag({
        content:
          '[class*="cookie"],[id*="cookie"]{display:none!important}*,*::before,*::after{animation:none!important;transition:none!important}'
      });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(100);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(80);
      record.at320 = await page.evaluate(auditExpression);
      record.at320.title = await page.title();
      record.at320.fontOk = await page.evaluate(() => document.fonts.check('16px Sora'));
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(180);
      record.at390 = await page.evaluate(auditExpression);
    } catch (e) {
      record.error = String(e).split('\n')[0].slice(0, 240);
    }
    results.push(record);
    if (outFile) {
      const outputPath = path.isAbsolute(outFile) ? outFile : path.join(root, outFile);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    }
  }

  await auditContext.close();

  const summarize = (r) => ({
    route: r.route,
    status: r.status,
    error: r.error,
    at320: r.at320 && {
      title: r.at320.title,
      fontOk: r.at320.fontOk,
      overflow: r.at320.docOverflow,
      offenders: r.at320.offenders,
      narrowHeadings: r.at320.narrowHeadings,
      narrowParagraphs: r.at320.narrowParagraphs,
      clipped: r.at320.clipped,
      overlaps: r.at320.overlaps
    },
    at390: r.at390 && {
      overflow: r.at390.docOverflow,
      offenders: r.at390.offenders,
      narrowHeadings: r.at390.narrowHeadings,
      narrowParagraphs: r.at390.narrowParagraphs,
      clipped: r.at390.clipped,
      overlaps: r.at390.overlaps
    }
  });

  return {
    summary: results
      .map(summarize)
      .filter(
        (r) =>
          r.error ||
          r.at320.overflow ||
          r.at320.offenders.length ||
          r.at320.narrowHeadings.length ||
          r.at320.narrowParagraphs.length ||
          r.at320.clipped.length ||
          r.at320.overlaps.length ||
          r.at390.overflow ||
          r.at390.offenders.length ||
          r.at390.narrowHeadings.length ||
          r.at390.narrowParagraphs.length ||
          r.at390.clipped.length ||
          r.at390.overlaps.length
      ),
    total: results.length
  };
};
