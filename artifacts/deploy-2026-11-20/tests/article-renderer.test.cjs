'use strict';

/**
 * Guards the hand-maintained article layer of site/assets/app.js.
 *
 * 1. Executes the real aeogeoStandaloneArticle renderer against fixtures, so a
 *    patch that breaks rendering, the quick-answer fallback, tables, takeaways
 *    or sources fails here instead of only in the browser.
 * 2. Mirrors the bundle article data against every prerendered
 *    site/resources/<anchor>/index.html page, so bundle-only edits cannot
 *    silently leave the crawlable copy stale.
 *
 * Run with: npm test (node --test tests/*.test.cjs)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const APP = fs.readFileSync(path.join(SITE, 'assets', 'app.js'), 'utf8');
const LEARN = fs.readFileSync(path.join(SITE, 'learn.html'), 'utf8');

function extractArray(source, marker) {
  const at = source.indexOf(marker);
  assert.notEqual(at, -1, `${marker} not found in app.js`);
  const start = source.indexOf('[', at);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const c = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '[') depth += 1;
    else if (c === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced array after ${marker}`);
}

function extractFunction(source, name) {
  const at = source.indexOf(`function ${name}`);
  assert.notEqual(at, -1, `${name} not found in app.js`);
  const header = source.slice(at).match(/^function\s+[\w$]+\s*\([^)]*\)\s*\{/);
  assert.ok(header, `${name} has no function body`);
  const start = at + header[0].length - 1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const c = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(at, i + 1);
    }
  }
  throw new Error(`unbalanced function ${name}`);
}

function bundleArticles() {
  return new Function(`return ${extractArray(APP, 'Co=[')}`)();
}

const ARTICLES = bundleArticles();

const DEFAULT_SOURCES_INTRO =
  'Every statistic on this page is drawn from the following publicly available research. Figures are cited with their publication dates because AI search trends move fast - verify before quoting in your own materials.';

const decode = value =>
  String(value)
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const text = value =>
  decode(String(value).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

const escaped = value => JSON.stringify(value).slice(1, -1);
const contains = (haystack, value) => haystack.includes(escaped(value));
const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function render(article, { inBundle = true } = {}) {
  const fixture = JSON.stringify(article);
  const source = `
    const r = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    const Co = ${inBundle ? `[${fixture}]` : '[]'};
    const K = 'K';
    const Xt = 'Xt';
    const ET = 'ET';
    const ST = ['Source one', 'Source two'];
    const aeogeoArticleBottomCTA = 'CTA';
    ${extractFunction(APP, 'aeogeoStandaloneArticle')}
    return aeogeoStandaloneArticle({ anchor: ${JSON.stringify(article.anchor)} });
  `;
  return new Function(source)();
}

const count = (haystack, needle) => haystack.split(needle).length - 1;

test('renderer renders a complete article, including answer, table, takeaways and sources', () => {
  const article = {
    anchor: 'renderer-full',
    article: 'Article 99',
    tags: ['Technical', '9 min read'],
    title: 'Renderer fixture',
    metaDescription: 'Fixture meta description',
    answer: 'Fixture quick answer',
    paras: ['<p>First paragraph.</p>', '<h2>Heading</h2>', '<p>Second paragraph.</p>'],
    table: { caption: 'Table', headers: ['A'], rows: [['B']] },
    takeaways: ['Takeaway one'],
    srcNote: 'Source note',
    sourcesIntro: 'Custom sources intro for this article',
  };

  const tree = render(article);
  assert.ok(tree, 'renderer returned nothing for a complete article');
  const flat = JSON.stringify(tree);

  assert.match(flat, /"description":"Fixture meta description"/, 'SEO description must use metaDescription');
  assert.equal(count(flat, 'Quick answer'), 1, 'quick answer block must render exactly once');
  assert.equal(count(flat, 'Key takeaways'), 1, 'takeaways block must render exactly once');
  assert.equal(count(flat, '"type":"ET"'), 1, 'table must render exactly once');
  assert.equal(count(flat, 'Sources & further reading'), 1, 'sources block must render for a sourced article');
  assert.ok(contains(flat, 'Custom sources intro for this article'), 'sourcesIntro must replace the shared intro');
  for (const para of article.paras) {
    assert.ok(contains(flat, para), `paragraph missing from render: ${para}`);
  }
  assert.ok(contains(flat, 'Takeaway one'), 'takeaway text missing from render');
  assert.ok(contains(flat, 'Source note'), 'source note missing from render');
});

test('renderer falls back to the answer for descriptions and honors hideSources', () => {
  const article = {
    anchor: 'renderer-minimal',
    article: 'Article 98',
    tags: ['AEO', '3 min read'],
    title: 'Minimal fixture',
    answer: 'Only an answer is available',
    paras: ['<p>Body copy.</p>'],
    hideSources: true,
  };

  const flat = JSON.stringify(render(article));
  assert.match(
    flat,
    /"description":"Only an answer is available"/,
    'description must fall back to answer when metaDescription is absent'
  );
  assert.equal(count(flat, 'Quick answer'), 1);
  assert.equal(count(flat, 'Key takeaways'), 0, 'no takeaways should render without data');
  assert.equal(count(flat, '"type":"ET"'), 0, 'no table should render without data');
  assert.equal(count(flat, 'Sources & further reading'), 0, 'hideSources must suppress the sources block');
});

test('renderer returns nothing for an anchor that is not in the bundle', () => {
  assert.equal(render({ anchor: 'not-a-real-article' }, { inBundle: false }), null);
});

test('every bundle article renders its own title, answer, paragraphs and takeaways', () => {
  assert.ok(ARTICLES.length >= 16, `expected the full article library, found ${ARTICLES.length}`);

  for (const article of ARTICLES) {
    const tree = render(article);
    assert.ok(tree, `${article.anchor}: renderer returned nothing`);
    const flat = JSON.stringify(tree);

    assert.ok(contains(flat, article.title), `${article.anchor}: title missing from render`);
    if (article.answer) assert.ok(contains(flat, article.answer), `${article.anchor}: answer missing from render`);
    for (const para of article.paras || []) {
      assert.ok(contains(flat, para), `${article.anchor}: paragraph missing from render`);
    }
    for (const takeaway of article.takeaways || []) {
      assert.ok(contains(flat, takeaway), `${article.anchor}: takeaway missing from render`);
    }
    assert.equal(
      count(flat, 'Sources & further reading'),
      article.hideSources ? 0 : 1,
      `${article.anchor}: sources block does not match hideSources`
    );
    assert.equal(
      count(flat, '"type":"ET"'),
      article.table ? 1 : 0,
      `${article.anchor}: table does not match bundle data`
    );
  }
});

test('each prerendered article page mirrors the bundle article', () => {
  const problems = [];

  for (const article of ARTICLES) {
    const label = article.anchor;
    const file = path.join(SITE, 'resources', article.anchor, 'index.html');
    if (!fs.existsSync(file)) {
      problems.push(`${label}: missing site/resources/${label}/index.html`);
      continue;
    }

    const html = fs.readFileSync(file, 'utf8');
    const url = `https://aeogeosearch.com/resources/${article.anchor}/`;
    const description = article.metaDescription || article.answer;
    const expectedTitle = `${article.title} | AEOGEO Search`;
    const articleMatch = html.match(/<article\b[\s\S]*?<\/article>/);
    if (!articleMatch) {
      problems.push(`${label}: no <article> block`);
      continue;
    }
    const articleHtml = articleMatch[0];
    const bodyText = text(articleHtml);
    const pageText = text(html);

    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/);
    if (!titleMatch || text(titleMatch[1]) !== text(expectedTitle)) {
      problems.push(`${label}: <title> is "${text(titleMatch?.[1] || '')}", expected "${expectedTitle}"`);
    }

    const h1Match = articleHtml.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/);
    if (!h1Match || text(h1Match[1]) !== text(article.title)) {
      problems.push(`${label}: h1 is "${text(h1Match?.[1] || '')}", expected "${article.title}"`);
    }

    const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
    const metaContents = (attr, value) =>
      metaTags
        .filter(tag => new RegExp(`\\b${attr}=["']?${escapeRegExp(value)}["']?(?=[\\s>])`).test(tag))
        .map(tag => tag.match(/\bcontent=(?:"([^"]*)"|([^\s>]+))/))
        .filter(Boolean)
        .map(match => decode(match[1] ?? match[2]));

    const descriptions = metaContents('name', 'description');
    if (descriptions.length !== 1) {
      problems.push(`${label}: expected exactly one meta description, found ${descriptions.length}`);
    } else if (text(descriptions[0]) !== text(description)) {
      problems.push(`${label}: meta description is "${descriptions[0]}", expected "${description}"`);
    }

    for (const [attr, name] of [
      ['property', 'og:description'],
      ['name', 'twitter:description'],
    ]) {
      const values = metaContents(attr, name);
      if (values.length !== 1) {
        problems.push(`${label}: expected exactly one ${name}, found ${values.length}`);
      } else if (text(values[0]) !== text(description)) {
        problems.push(`${label}: ${name} is "${values[0]}", expected "${description}"`);
      }
    }

    const canonicalTag = html.match(/<link\b[^>]*rel=canonical[^>]*>/);
    const canonical = canonicalTag?.[0].match(/\bhref=(?:"([^"]*)"|([^\s>]+))/);
    const canonicalUrl = canonical ? decode(canonical[1] ?? canonical[2]) : '';
    if (canonicalUrl !== url) {
      problems.push(`${label}: canonical is "${canonicalUrl}", expected "${url}"`);
    }

    const quick = articleHtml.match(/Quick answer<\/h2>\s*<p[^>]*>([\s\S]*?)<\/div>/);
    if (article.answer) {
      if (!quick) {
        problems.push(`${label}: quick answer block is missing`);
      } else if (text(quick[1]) !== text(article.answer)) {
        problems.push(`${label}: quick answer is "${text(quick[1])}", expected "${article.answer}"`);
      }
    } else if (quick) {
      problems.push(`${label}: page has a quick answer but the bundle article has none`);
    }

    if (article.hideSources) {
      if (pageText.includes('Sources & further reading')) {
        problems.push(`${label}: page shows a sources section but the bundle article hides sources`);
      }
    } else {
      if (!pageText.includes('Sources & further reading')) {
        problems.push(`${label}: sources section is missing`);
      }
      const sourcesIntro = article.sourcesIntro || DEFAULT_SOURCES_INTRO;
      if (!pageText.includes(text(sourcesIntro))) {
        problems.push(`${label}: sources intro drift, expected "${sourcesIntro}"`);
      }
    }

    const paragraphs = (article.paras || []).map(text).filter(value => value.length > 40);
    for (const paragraph of paragraphs) {
      if (!bodyText.includes(paragraph)) {
        problems.push(`${label}: body copy drift, missing "${paragraph.slice(0, 80)}..."`);
        break;
      }
    }

    const headings = [...(article.paras || []).join(' ').matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)]
      .map(match => text(match[1]))
      .filter(Boolean);
    for (const heading of headings) {
      if (!bodyText.includes(heading)) {
        problems.push(`${label}: heading drift, missing "${heading}"`);
        break;
      }
    }

    for (const takeaway of article.takeaways || []) {
      if (!bodyText.includes(text(takeaway))) {
        problems.push(`${label}: takeaway missing from page: "${text(takeaway).slice(0, 60)}"`);
        break;
      }
    }

    const ldBlocks = [...html.matchAll(/<script type=application\/ld\+json>([\s\S]*?)<\/script>/g)]
      .map(match => {
        try {
          return JSON.parse(match[1]);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const articleLd = ldBlocks.find(data => data['@type'] === 'Article');
    if (!articleLd) {
      problems.push(`${label}: Article JSON-LD is missing`);
    } else {
      if (text(articleLd.headline) !== text(article.title)) {
        problems.push(`${label}: JSON-LD headline is "${articleLd.headline}", expected "${article.title}"`);
      }
      if (text(articleLd.description) !== text(description)) {
        problems.push(`${label}: JSON-LD description is "${articleLd.description}", expected "${description}"`);
      }
      if (articleLd.url !== url) {
        problems.push(`${label}: JSON-LD url is "${articleLd.url}", expected "${url}"`);
      }
      if (articleLd.mainEntityOfPage !== url) {
        problems.push(`${label}: JSON-LD mainEntityOfPage is "${articleLd.mainEntityOfPage}", expected "${url}"`);
      }
    }
  }

  assert.deepEqual(problems, [], `Prerendered article drift:\n${problems.join('\n')}`);
});

test('the Learn page links every bundle article and no removed ones', () => {
  const linked = new Set(
    [...LEARN.matchAll(/href=\/resources\/([a-z0-9-]+)\//g)].map(match => match[1])
  );
  const problems = [];

  for (const article of ARTICLES) {
    if (!linked.has(article.anchor)) problems.push(`${article.anchor}: no Learn card link`);
  }
  for (const anchor of linked) {
    if (!ARTICLES.some(article => article.anchor === anchor)) {
      problems.push(`${anchor}: Learn card points at an article that is no longer in the bundle`);
    }
  }

  assert.deepEqual(problems, [], `Learn page drift:\n${problems.join('\n')}`);
});
