'use strict';

// Regression guard for the duplicate scroll-to-top control.
//
// The shared script in site/assets/audit-scroll-top.js injects the working
// scroll-to-top button on every page. The resource and knowledge-library pages
// also ship a pre-rendered copy, frozen at opacity:0 by an old scroll-reveal
// state. That copy is never shown, but unless it is marked aria-hidden and
// removed from the tab order, keyboard users tab to nothing and screen readers
// announce two "Scroll back to top" buttons.
//
// Every static page is scanned, so a page that starts shipping the button
// again cannot quietly reintroduce the exposed duplicate.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {load} = require('cheerio');

const SITE = path.join(__dirname, '..', 'site');

// A pre-rendered scroll-to-top control, whichever of its two accessible names
// the page uses. The injected, working button is not part of the static HTML.
const SELECTOR = 'button[aria-label="Scroll back to top"], button[title="Back to top"]';

function htmlFiles(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(full);
    return entry.name.endsWith('.html') ? [full] : [];
  });
}

function exposed($) {
  return $(SELECTOR).toArray().filter(element => {
    const ariaHidden = $(element).attr('aria-hidden');
    const tabindex = $(element).attr('tabindex');
    return ariaHidden !== 'true' || tabindex !== '-1';
  }).map(element => ({
    ariaHidden: $(element).attr('aria-hidden') ?? null,
    tabindex: $(element).attr('tabindex') ?? null
  }));
}

test('the check rejects a scroll-to-top button that is still exposed', () => {
  const missingBoth = load('<button aria-label="Scroll back to top"></button>');
  const exposedTab = load('<button aria-label="Scroll back to top" aria-hidden="true" tabindex="0"></button>');
  const exposedAria = load('<button aria-label="Scroll back to top" tabindex="-1"></button>');
  const hiddenWrongly = load('<button aria-label="Scroll back to top" aria-hidden="false" tabindex="-1"></button>');
  const good = load('<button aria-label="Scroll back to top" aria-hidden="true" tabindex="-1"></button>');
  const goodByTitle = load('<button title="Back to top" aria-hidden="true" tabindex="-1"></button>');

  assert.equal(exposed(missingBoth).length, 1);
  assert.equal(exposed(exposedTab).length, 1);
  assert.equal(exposed(exposedAria).length, 1);
  assert.equal(exposed(hiddenWrongly).length, 1);
  assert.equal(exposed(good).length, 0);
  assert.equal(exposed(goodByTitle).length, 0);
});

test('every static scroll-to-top button is aria-hidden and out of the tab order', () => {
  const files = htmlFiles(SITE);
  assert.ok(files.length > 20, 'the scan found the site pages');

  const failures = [];
  let withButton = 0;
  for (const file of files) {
    const $ = load(fs.readFileSync(file, 'utf8'));
    const problems = exposed($);
    if ($(SELECTOR).length > 0) withButton += 1;
    for (const problem of problems) {
      failures.push(path.relative(SITE, file)
        + ': scroll-to-top button has aria-hidden=' + problem.ariaHidden
        + ' and tabindex=' + problem.tabindex);
    }
  }

  assert.deepEqual(failures, [],
    'a pre-rendered scroll-to-top button must be aria-hidden="true" and tabindex="-1";'
    + ' the shared script supplies the working control. Scanned ' + files.length + ' pages, '
    + withButton + ' with a static button.');
});
