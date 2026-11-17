import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CONTACT_ENDPOINT = "https://formspree.io/f/mbgooqgz";
const ENTITY_ENDPOINT = "https://formspree.io/f/xrpqqrpa";

const files = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (path.endsWith(".html")) files.push(path);
  }
}
walk("site");

let changed = 0;
let hiddenRemoved = 0;
let visibleUpdated = 0;

for (const path of files) {
  const original = readFileSync(path, "utf8");
  let html = original;

  // These hidden forms exist only so Netlify can discover the form schema.
  // Formspree does not need them, and leaving them would create dead forms.
  html = html.replace(/<form\b[^>]*\bhidden\b[^>]*>[\s\S]*?<\/form>/gi, (form) => {
    if (!/\bname=(?:"?form-name"?)/i.test(form)) return form;
    hiddenRemoved += 1;
    return "";
  });

  // Netlify's hidden schema marker is not a field Formspree needs.
  html = html.replace(/<input\b[^>]*\bname=(?:"form-name"|form-name)[^>]*>/gi, "");

  // Only the real, visible forms get an action. Do not touch login, audit,
  // quiz, or tool forms that are handled by application JavaScript.
  html = html.replace(/<form\b[^>]*>/gi, (tag) => {
    if (/\bhidden\b/i.test(tag)) return tag;

    const isContact = /\bname=(?:"contact"|contact)(?=[\s>])/i.test(tag);
    const isEntity = /\bname=(?:"entity-authority"|entity-authority)(?=[\s>])/i.test(tag);
    if (!isContact && !isEntity) return tag;

    let next = tag.replace(/\s+data-netlify(?:-honeypot)?=(?:"[^"]*"|[^\s>]+)/gi, "");
    if (!/\baction=/i.test(next)) {
      next = next.replace(/>$/, ` action="${isEntity ? ENTITY_ENDPOINT : CONTACT_ENDPOINT}">`);
    }
    visibleUpdated += 1;
    return next;
  });

  // Formspree's honeypot field is `_gotcha`.
  html = html.replace(/\bname=(?:"bot-field"|bot-field)\b/gi, 'name="_gotcha"');

  if (html !== original) {
    writeFileSync(path, html);
    changed += 1;
  }
}

console.log({ changed, hiddenRemoved, visibleUpdated });
