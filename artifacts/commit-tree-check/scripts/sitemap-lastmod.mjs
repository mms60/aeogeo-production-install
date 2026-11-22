#!/usr/bin/env node
/**
 * Derive <lastmod> in site/sitemap.xml from real page changes.
 *
 * Each sitemap URL is fingerprinted from the contents of its <main> element,
 * with comments, scripts, styles and redundant whitespace removed. Shared
 * chrome (header, nav, footer, cache-busting query strings) lives outside
 * <main>, so a sitewide edit cannot bump every date.
 *
 *   npm run sitemap:dates      update site/sitemap.xml and the state file
 *   npm run sitemap:check      exit 1 if a page changed but its date did not
 *   node scripts/sitemap-lastmod.mjs --backfill
 *                              seed missing dates from git history
 *
 * Normal runs are git-free. `--backfill` is only needed when the state file is
 * missing (or a page was added by hand without recording a date); it finds the
 * newest commit that actually changed the page's <main> content.
 *
 * After editing page copy, run `npm run sitemap:dates` and commit both
 * site/sitemap.xml and scripts/sitemap-lastmod.json. CI runs
 * `npm run sitemap:check`, so a forgotten date fails the build instead of
 * silently going stale.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITEMAP = path.join(ROOT, "site", "sitemap.xml");
const STATE = path.join(ROOT, "scripts", "sitemap-lastmod.json");
const PAGE_DIR = path.join(ROOT, "site");
const TODAY = new Date().toISOString().slice(0, 10);

const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");
const backfill = args.has("--backfill");

function readSitemap() {
  const xml = fs.readFileSync(SITEMAP, "utf8");
  const entries = [];
  for (const [, block] of xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)) {
    const loc = block.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i)?.[1].trim();
    if (!loc) throw new Error("Sitemap entry without <loc>: " + block.slice(0, 80));
    if (entries.some((entry) => entry.loc === loc)) throw new Error("Duplicate sitemap URL: " + loc);
    const lastmod = block.match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i)?.[1];
    entries.push({ loc, lastmod: lastmod ? lastmod.trim() : null });
  }
  if (!entries.length) throw new Error("No <url> entries found in " + SITEMAP);
  return { xml, entries };
}

function pageFileFor(loc) {
  const pathname = decodeURIComponent(new URL(loc).pathname);
  const candidates = pathname.endsWith("/")
    ? [path.join(PAGE_DIR, pathname, "index.html")]
    : [path.join(PAGE_DIR, pathname + ".html"), path.join(PAGE_DIR, pathname, "index.html")];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) throw new Error("No HTML file found for " + loc);
  return file;
}

// Hash only the page-specific content. Returns "" for historical revisions
// that predate <main>, which correctly counts as a content change.
function fingerprint(html) {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (!main) return "";
  const content = main[1]
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(content).digest("hex");
}

function readFingerprint(file) {
  const hash = fingerprint(fs.readFileSync(file, "utf8"));
  if (!hash) throw new Error("Missing <main> element in " + path.relative(ROOT, file));
  return hash;
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE, "utf8"));
    if (!parsed?.pages || typeof parsed.pages !== "object") throw new Error("Invalid state file");
    return parsed.pages;
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
}

// Date of the newest commit whose <main> fingerprint differs from its parent.
function lastContentChange(file, workingHash) {
  const relative = path.relative(ROOT, file).split(path.sep).join("/");
  let headHash;
  try {
    headHash = fingerprint(git("show", "HEAD:" + relative));
  } catch {
    return TODAY; // not committed yet
  }
  if (headHash !== workingHash) return TODAY; // uncommitted content change

  const log = git("log", "--format=%H\t%as", "--", relative).trim();
  if (!log) return TODAY;

  let newer = null;
  for (const line of log.split("\n")) {
    const [sha, date] = line.split("\t");
    let hash;
    try {
      hash = fingerprint(git("show", sha + ":" + relative));
    } catch {
      hash = "";
    }
    if (newer && newer.hash !== hash) return newer.date;
    newer = { hash, date };
  }
  return newer ? newer.date : TODAY;
}

function writeSitemap(xml, dates) {
  return xml.replace(/(^[ \t]*)<url\b[^>]*>[\s\S]*?<\/url>/gim, (block, _indent) => {
    const loc = block.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i)?.[1].trim();
    const date = loc && dates.get(loc);
    if (!loc || !date) return block;
    return `  <url><loc>${loc}</loc><lastmod>${date}</lastmod></url>`;
  });
}

const { xml, entries } = readSitemap();
const urls = entries.map((entry) => entry.loc);
const state = loadState();
const hashes = new Map();
for (const loc of urls) hashes.set(loc, readFingerprint(pageFileFor(loc)));

if (checkOnly) {
  const problems = [];
  for (const { loc, lastmod } of entries) {
    const hash = hashes.get(loc);
    const previous = state[loc];
    if (!previous) {
      problems.push(`${loc}: no fingerprint recorded`);
    } else if (previous.hash !== hash) {
      problems.push(`${loc}: page content changed but lastmod is still ${previous.lastmod}`);
    }
    if (!lastmod) {
      problems.push(`${loc}: <lastmod> is missing`);
    } else if (previous && lastmod !== previous.lastmod) {
      problems.push(`${loc}: sitemap says ${lastmod}, recorded date is ${previous.lastmod}`);
    }
  }
  if (problems.length) {
    console.error("sitemap: dates are out of date\n  " + problems.join("\n  "));
    console.error("\nRun `npm run sitemap:dates` and commit site/sitemap.xml with scripts/sitemap-lastmod.json.");
    process.exit(1);
  }
  console.log(`sitemap: all ${urls.length} dates are current`);
  process.exit(0);
}

const dates = new Map();
const pages = {};
const updated = [];

for (const loc of urls) {
  const hash = hashes.get(loc);
  const previous = state[loc];
  let date;
  if (previous && previous.hash === hash) {
    date = previous.lastmod;
  } else if (previous) {
    date = previous.lastmod > TODAY ? previous.lastmod : TODAY;
    updated.push([loc, date]);
  } else if (backfill) {
    date = lastContentChange(pageFileFor(loc), hash);
    updated.push([loc, date]);
  } else {
    date = TODAY;
    updated.push([loc, date]);
  }
  dates.set(loc, date);
  pages[loc] = { hash, lastmod: date };
}

const nextXml = writeSitemap(xml, dates);
if (nextXml !== xml) fs.writeFileSync(SITEMAP, nextXml);
fs.writeFileSync(STATE, JSON.stringify({ version: 1, pages }, null, 2) + "\n");

if (updated.length) {
  console.log(`sitemap: ${updated.length} date(s) updated`);
  for (const [loc, date] of updated) console.log(`  ${loc} -> ${date}`);
} else {
  console.log(`sitemap: all ${urls.length} dates are current`);
}
