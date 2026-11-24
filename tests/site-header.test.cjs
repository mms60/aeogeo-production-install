'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{load}=require('cheerio'),{JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..'),read=n=>fs.readFileSync(path.join(root,n),'utf8'),template=read('templates/site-header.html');
const cleanPath=h=>(h||'').replace(/^https?:\/\/aeogeosearch\.com/,'');
function extractArray(s,marker){const start=s.indexOf(marker);if(start===-1)return null;const open=s.indexOf('[',start);let depth=0,inStr=false,esc=false;for(let i=open;i<s.length;i++){const c=s[i];if(inStr){if(esc){esc=false;continue;}if(c==='\\'){esc=true;continue;}if(c==='"')inStr=false;continue;}if(c==='"'){inStr=true;continue;}if(c==='['||c==='{')depth++;else if(c===']'||c==='}'){depth--;if(depth===0)return s.slice(open,i+1);}}return null;}
function siteNavigation(){const app=read('site/assets/app.js'),text=extractArray(app,'rh=');assert.ok(text,'Original website navigation found');const fix=items=>items.map(i=>{const o={label:i.label,path:cleanPath(i.path)};if(i.children)o.children=fix(i.children);return o;});return fix(JSON.parse(text.replace(/([\{,])(label|path|children):/g,'$1"$2":')));}
test('GEO header has the same labels, destinations and Free Audit Tools children as the actual website',()=>{const $=load(template),actual=[];$('.website-main-navigation').children().each((_,node)=>{const n=$(node);if(n.hasClass('website-mobile-consultation'))return;if(n.hasClass('website-resources'))actual.push({label:n.find('button').text().trim(),path:n.attr('data-navigation-path'),children:n.find('.website-resource-links a').map((_,a)=>({label:$(a).text(),path:cleanPath($(a).attr('href'))})).get()});else actual.push({label:n.text(),path:cleanPath(n.attr('href'))});});assert.deepEqual(actual,siteNavigation());assert.ok(!template.includes('Agency Pricing'));});
test('landing, account, login and callback share the corrected header without changing the standalone audit tool',()=>{const expected=load(template)('header').html(),headerCssHrefs=[];for(const n of ['site/geo-audit/index.html','site/account/index.html','site/login/index.html','site/auth/callback/index.html']){const $=load(read(n));assert.equal($('header[data-header-revision="site-header-v1"]').html(),expected,n);const headerCss=$('link[href^="/assets/site-header.css"]');assert.equal(headerCss.length,1,n);assert.match(headerCss.attr('href'),/^\/assets\/site-header\.css(?:\?v=[\w.-]+)?$/,n);headerCssHrefs.push(headerCss.attr('href'));assert.equal($('script[src="/assets/site-header.js"]').length,1);}assert.equal(new Set(headerCssHrefs).size,1,'shared header stylesheet version is consistent');const tool=read('site/geo-audit/run/index.html');assert.ok(tool.includes('data-header-revision="site-header-v1"'), 'audit tool ships the shared header');assert.ok(!tool.includes('scope-card-75'));assert.ok(read('scripts/build-pages.py').includes("NAV=(ROOT.parent/'templates/site-header.html').read_text()"));});
test('header preserves website branding, consultation/contact actions and accessible independent navigation',()=>{const $=load(template);assert.equal($('.website-brand-name').text(),'AEOGEO Search');assert.equal($('.website-contact-icon[href="tel:+14699052836"]').length,1);assert.equal($('.website-contact-icon[href="/contact"]').length,1);assert.equal($('.website-consultation').text(),'Request a Consultation');assert.equal($('#site-resources-toggle').attr('aria-controls'),'site-resources-links');assert.equal($('#site-navigation-toggle').attr('aria-controls'),'site-navigation');assert.ok($('#site-resources-links').attr('hidden')!==undefined);const js=read('site/assets/site-header.js');assert.ok(!js.includes('fetch('));assert.ok(!js.includes('supabase'));assert.ok(!template.includes('\u2014'));});
// ---- One text size across the navigation bar -------------------------------
// The bar used to mix 13px and 13.5px links with a 16-18px wordmark before a
// single shared rule pulled every item onto one size. A CSS declaration is only
// as good as the cascade that keeps it, so these helpers resolve the winning
// font-size for each item the way a browser would: !important first, then
// specificity, then source order, across the stylesheets a page actually loads.
const NAV_ITEM_SELECTORS = [
  '.website-brand',
  '.website-brand-name',
  '.website-main-navigation > a',
  '.website-resources-toggle',
  '.website-resource-links a',
  '.website-consultation',
  '.website-mobile-consultation'
];
const NAV_STYLESHEETS = [
  'site/assets/site.css',
  'site/assets/site-header.css',
  'site/assets/site-header-unify.css',
  'site/assets/typography-consistency.css'
];

function flattenCss(source) {
  const rules = [];
  const stack = [];
  let buffer = '';
  for (let i = 0; i < source.length; i++) {
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 1;
      continue;
    }
    const char = source[i];
    if (char === '{') {
      stack.push(buffer.trim());
      buffer = '';
    } else if (char === '}') {
      const head = stack.pop();
      if (head && !head.startsWith('@')) rules.push({selector: head, body: buffer});
      buffer = '';
    } else {
      buffer += char;
    }
  }
  return rules;
}

function specificity(selector) {
  const ids = (selector.match(/#[\w-]+/g) || []).length;
  const attributes = (selector.match(/\[[^\]]*\]/g) || []).length;
  const pseudoClasses = (selector.match(/::?[a-z-]+(\([^)]*\))?/gi) || []).filter(p => !p.startsWith('::')).length;
  const classes = (selector.match(/\.[\w-]+/g) || []).length + attributes + pseudoClasses;
  const types = (selector
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/(::?[a-z-]+(\([^)]*\))?|\.[\w-]+|#[\w-]+)/gi, ' ')
    .match(/\b[a-z][\w-]*\b/gi) || []).length;
  return [ids, classes, types];
}

function fontSizeRules() {
  const rules = [];
  let order = 0;
  let group = 0;
  for (const file of NAV_STYLESHEETS) {
    for (const rule of flattenCss(read(file))) {
      const declared = [...rule.body.matchAll(/font-size\s*:\s*([^;}]+)/g)].map(m => m[1].trim());
      if (!declared.length) continue;
      const value = declared.at(-1);
      const declaration = group++;
      for (const selector of rule.selector.split(',')) {
        const trimmed = selector.trim();
        if (!trimmed) continue;
        rules.push({
          selector: trimmed,
          value,
          important: /!important/.test(value),
          specificity: specificity(trimmed),
          order: order++,
          group: declaration
        });
      }
    }
  }
  return rules;
}

// Higher return value means the first rule wins in the browser's cascade.
function compareRules(a, b) {
  if (a.important !== b.important) return a.important ? 1 : -1;
  for (let i = 0; i < 3; i++) {
    if (a.specificity[i] !== b.specificity[i]) return a.specificity[i] - b.specificity[i];
  }
  return a.order - b.order;
}

function beatingRule(element, rules) {
  let winner = null;
  for (const rule of rules) {
    let matches = false;
    try {
      matches = element.matches(rule.selector);
    } catch {
      matches = false;
    }
    if (!matches) continue;
    if (!winner || compareRules(rule, winner) >= 0) winner = rule;
  }
  return winner;
}

test('every text item in the navigation bar resolves to the same font size', () => {
  const dom = new JSDOM('<!doctype html><html><body>' + template + '</body></html>');
  const doc = dom.window.document;
  const rules = fontSizeRules();
  const resolved = [];
  for (const selector of NAV_ITEM_SELECTORS) {
    for (const element of doc.querySelectorAll(selector)) {
      const winner = beatingRule(element, rules);
      assert.ok(winner, selector + ' has no font-size rule of its own, so it would inherit and drift');
      resolved.push({selector, text: element.textContent.trim().slice(0, 24), winner});
    }
  }
  assert.ok(resolved.length >= 6, 'the navigation bar items are found: ' + resolved.length);
  const size = value => value.replace(/\s*!important/g, '').trim();
  const sizes = [...new Set(resolved.map(item => size(item.winner.value)))];
  assert.deepEqual(sizes, [sizes[0]],
    'the navigation bar must read at one size, found: '
    + resolved.map(item => item.selector + ' ' + size(item.winner.value)).join(', '));
  const owners = new Set(resolved.map(item => item.winner.group));
  assert.equal(owners.size, 1,
    'one shared rule must set the navigation size, but it comes from '
    + owners.size + ' different declarations');
  assert.equal(resolved[0].winner.important, true,
    'the shared navigation size must be !important so the site-wide button rule cannot re-inflate the dropdown buttons');
});
