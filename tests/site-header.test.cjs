'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{load}=require('cheerio');
const root=path.resolve(__dirname,'..'),read=n=>fs.readFileSync(path.join(root,n),'utf8'),template=read('templates/site-header.html');
const cleanPath=h=>(h||'').replace(/^https?:\/\/aeogeosearch\.com/,'');
function extractArray(s,marker){const start=s.indexOf(marker);if(start===-1)return null;const open=s.indexOf('[',start);let depth=0,inStr=false,esc=false;for(let i=open;i<s.length;i++){const c=s[i];if(inStr){if(esc){esc=false;continue;}if(c==='\\'){esc=true;continue;}if(c==='"')inStr=false;continue;}if(c==='"'){inStr=true;continue;}if(c==='['||c==='{')depth++;else if(c===']'||c==='}'){depth--;if(depth===0)return s.slice(open,i+1);}}return null;}
function siteNavigation(){const app=read('site/assets/app.js'),text=extractArray(app,'rh=');assert.ok(text,'Original website navigation found');const fix=items=>items.map(i=>{const o={label:i.label,path:cleanPath(i.path)};if(i.children)o.children=fix(i.children);return o;});return fix(JSON.parse(text.replace(/([\{,])(label|path|children):/g,'$1"$2":')));}
test('GEO header has the same labels, destinations and Free Audit Tools children as the actual website',()=>{const $=load(template),actual=[];$('.website-main-navigation').children().each((_,node)=>{const n=$(node);if(n.hasClass('website-mobile-consultation'))return;if(n.hasClass('website-resources'))actual.push({label:n.find('button').text().trim(),path:n.attr('data-navigation-path'),children:n.find('.website-resource-links a').map((_,a)=>({label:$(a).text(),path:cleanPath($(a).attr('href'))})).get()});else actual.push({label:n.text(),path:cleanPath(n.attr('href'))});});assert.deepEqual(actual,siteNavigation());assert.ok(!template.includes('Agency Pricing'));});
test('landing, account, login and callback share the corrected header without changing the standalone audit tool',()=>{const expected=load(template)('header').html(),headerCssHrefs=[];for(const n of ['site/geo-audit/index.html','site/account/index.html','site/login/index.html','site/auth/callback/index.html']){const $=load(read(n));assert.equal($('header[data-header-revision="site-header-v1"]').html(),expected,n);const headerCss=$('link[href^="/assets/site-header.css"]');assert.equal(headerCss.length,1,n);assert.match(headerCss.attr('href'),/^\/assets\/site-header\.css(?:\?v=[\w.-]+)?$/,n);headerCssHrefs.push(headerCss.attr('href'));assert.equal($('script[src="/assets/site-header.js"]').length,1);}assert.equal(new Set(headerCssHrefs).size,1,'shared header stylesheet version is consistent');const tool=read('site/geo-audit/run/index.html');assert.ok(tool.includes('data-header-revision="site-header-v1"'), 'audit tool ships the shared header');assert.ok(!tool.includes('scope-card-75'));assert.ok(read('scripts/build-pages.py').includes("NAV=(ROOT.parent/'templates/site-header.html').read_text()"));});
test('header preserves website branding, consultation/contact actions and accessible independent navigation',()=>{const $=load(template);assert.equal($('.website-brand-name').text(),'AEOGEO Search');assert.equal($('.website-contact-icon[href="tel:+14699052836"]').length,1);assert.equal($('.website-contact-icon[href="/contact"]').length,1);assert.equal($('.website-consultation').text(),'Request a Consultation');assert.equal($('#site-resources-toggle').attr('aria-controls'),'site-resources-links');assert.equal($('#site-navigation-toggle').attr('aria-controls'),'site-navigation');assert.ok($('#site-resources-links').attr('hidden')!==undefined);const js=read('site/assets/site-header.js');assert.ok(!js.includes('fetch('));assert.ok(!js.includes('supabase'));assert.ok(!template.includes('\u2014'));});
// ---- One text size across the navigation bar -------------------------------
// The bar used to mix a 16px wordmark with 13px links, 14px dropdown items and a
// 14px consultation button. One shared !important rule now sets every item in the
// bar, and that single rule is the whole contract: if it stops covering an item,
// or another rule starts competing with it, the bar can drift to mixed sizes
// again. So assert the contract directly instead of re-implementing the cascade.
//
// Rules nested in @media are skipped on purpose: a smaller size on a phone is a
// deliberate breakpoint, not drift, and reading it as a competing declaration is
// how a cascade simulation ends up failing on a correct stylesheet.
const NAV_STYLESHEETS = [
  'site/assets/site.css',
  'site/assets/site-header.css',
  'site/assets/site-header-unify.css',
  'site/assets/typography-consistency.css'
];
const NAV_ITEM_SELECTORS = [
  '.website-brand',
  '.website-brand-name',
  '.website-main-navigation>a',
  '.website-resources-toggle',
  '.website-resource-links a',
  '.website-consultation',
  '.website-mobile-consultation'
];

// Top-level rules only. An @media/@supports/@layer block is skipped whole, so
// none of its declarations can be mistaken for the base cascade.
function topLevelRules(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) break;
    const selector = css.slice(i, open).trim();
    let depth = 1;
    let end = open + 1;
    for (; end < css.length && depth; end++) {
      if (css[end] === '{') depth++;
      else if (css[end] === '}') depth--;
    }
    const body = css.slice(open + 1, end - 1);
    if (!selector.startsWith('@')) rules.push({selector, body});
    i = end;
  }
  return rules;
}

function navFontRules() {
  const rules = [];
  for (const file of NAV_STYLESHEETS) {
    for (const rule of topLevelRules(read(file))) {
      if (!NAV_ITEM_SELECTORS.some(item => coversItem(rule.selector, item))) continue;
      const declared = [...rule.body.matchAll(/font-size\s*:\s*([^;}]+)/g)].map(match => match[1].trim());
      if (declared.length) rules.push({file, selector: rule.selector, value: declared.at(-1)});
    }
  }
  return rules;
}

// A rule covers an item when one of its selectors ends with that item's own
// selector, so covering a container is not the same as covering its links.
const squash = selector => selector.replace(/\s+/g, '');
const coversItem = (selectorList, item) =>
  selectorList.split(',').some(part => squash(part).endsWith(squash(item)));

test('every text item in the navigation bar resolves to the same font size', () => {
  const rules = navFontRules();
  const shared = rules.filter(rule => /!important/.test(rule.value));

  assert.equal(shared.length, 1,
    'exactly one shared !important rule must set the navigation size, or the bar can drift again; found '
    + shared.length + (shared.length ? ': ' + shared.map(rule => rule.file + ' ' + rule.value).join(', ') : ''));

  const [rule] = shared;
  const size = rule.value.replace(/!important/, '').trim();
  assert.match(size, /^\d+(?:\.\d+)?(?:px|rem|em)$/,
    'the shared navigation size must be one fixed value, found: ' + rule.value);

  const missing = NAV_ITEM_SELECTORS.filter(item => !coversItem(rule.selector, item));
  assert.deepEqual(missing, [],
    'the shared rule must cover every navigation item, or the uncovered item falls back to its own size; missing: '
    + missing.join(', '));
});
