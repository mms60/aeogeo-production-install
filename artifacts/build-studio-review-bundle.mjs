/*
 * Builds a review bundle containing byte-identical copies of the Studio client
 * file, the server-side graph generation, entitlement, checkout, webhook and
 * database code, plus a concatenated ALL-CODE.md for reading in one place.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const out = path.join(root, "artifacts/studio-paid-review");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const files = [
  {
    source: "site/assets/entity-authority-tool.js",
    name: "entity-authority-tool.js",
    area: "1. Browser client",
    purpose: "Free audit UI, free structure preview, entitlement/plan-lock UI, paid JSON-LD render, copy/download controls, checkout and claim handoff."
  },
  {
    source: "netlify/functions/lib/entity-graph-builder.js",
    name: "entity-graph-builder.js",
    area: "2. Server graph compiler",
    purpose: "Deterministic Schema.org @graph compiler. Imported only by the paid implementation endpoint and Node tests; never published to site/."
  },
  {
    source: "netlify/functions/entity-implementation.mjs",
    name: "entity-implementation.mjs",
    area: "2. Server graph compiler",
    purpose: "Paid endpoint. Order is auth -> entitlement -> body -> plan limits -> compile -> validate."
  },
  {
    source: "netlify/functions/avss-shared.mjs",
    name: "avss-shared.mjs",
    area: "2. Server graph compiler",
    purpose: "Shared Response helpers and userFromEvent, which verifies the Supabase bearer token before any paid work."
  },
  {
    source: "netlify/functions/entity-entitlement.mjs",
    name: "entity-entitlement.mjs",
    area: "3. Entitlement",
    purpose: "Returns active/plan/limits for the signed-in account. Never returns a graph."
  },
  {
    source: "netlify/functions/lib/entity-purchases.js",
    name: "entity-purchases.js",
    area: "3. Entitlement",
    purpose: "Stripe session validation, purchase recording, email claim fallback, entitlement lookup, plan-limit validation, graph validation, refund/dispute handling."
  },
  {
    source: "netlify/functions/entity-purchase-claim.mjs",
    name: "entity-purchase-claim.mjs",
    area: "3. Entitlement",
    purpose: "Links a verified Stripe session to the signed-in account after checking session status, amount, item and email."
  },
  {
    source: "netlify/functions/lib/db.js",
    name: "db.js",
    area: "3. Entitlement",
    purpose: "Service-role PostgREST access plus the account lookup used by checkout and claims."
  },
  {
    source: "netlify/functions/entity-authority-checkout.js",
    name: "entity-authority-checkout.js",
    area: "4. Stripe",
    purpose: "Creates account-bound Checkout sessions, verifies the live price and amount server-side, handles the $400 single-to-multi upgrade."
  },
  {
    source: "netlify/functions/lib/stripe.js",
    name: "stripe.js",
    area: "4. Stripe",
    purpose: "Stripe REST wrapper and webhook HMAC verification with a five-minute timestamp tolerance."
  },
  {
    source: "netlify/functions/lib/stripe-credential.js",
    name: "stripe-credential.js",
    area: "4. Stripe",
    purpose: "Validates the server key format and mode. Never logs or serializes the key."
  },
  {
    source: "netlify/functions/stripe-webhook.js",
    name: "stripe-webhook.js",
    area: "4. Stripe",
    purpose: "Signature verification, event allow-list, routing to the entity purchase handler before the other product handlers."
  },
  {
    source: "database/10-entity-purchases.sql",
    name: "10-entity-purchases.sql",
    area: "5. Database",
    purpose: "Table definition, indexes, RLS enablement and the single self-read policy. No write policies by design."
  },
  {
    source: "artifacts/verify-entity-gate.mjs",
    name: "verify-entity-gate.mjs",
    area: "6. Verification",
    purpose: "Ad-hoc harness that ran 32 checks against the real handlers with fake Supabase/Stripe transports."
  }
];

const rows = [];
for (const file of files) {
  const sourcePath = path.join(root, file.source);
  if (!fs.existsSync(sourcePath)) throw new Error("Missing " + file.source);
  const buffer = fs.readFileSync(sourcePath);
  const text = buffer.toString("utf8");
  const target = path.join(out, file.name);
  fs.writeFileSync(target, buffer);
  const same = execFileSync("cmp", ["-s", sourcePath, target], { stdio: "pipe" });
  const sha = crypto.createHash("sha256").update(buffer).digest("hex");
  rows.push({
    ...file,
    sha256: sha,
    bytes: buffer.length,
    lines: text.split("\n").length - (text.endsWith("\n") ? 1 : 0)
  });
}

const manifest = [
  "# Studio paid-path source bundle",
  "",
  "Every file below is a byte-identical copy of the repository file at the path shown.",
  "Hashes are SHA-256 of the exact bytes in this folder.",
  "",
  "| Area | File | Repo path | Lines | Bytes | SHA-256 |",
  "| --- | --- | --- | ---: | ---: | --- |",
  ...rows.map(row => `| ${row.area} | [${row.name}](./${row.name}) | \`${row.source}\` | ${row.lines} | ${row.bytes} | \`${row.sha256}\` |`),
  "",
  "## Reading order for the protection question",
  "",
  "1. `entity-implementation.mjs` — the only path that returns complete JSON-LD. Auth and entitlement happen before the body is read or the compiler is called.",
  "2. `entity-purchases.js` — `sessionIsPaid` (payment truth), `entitlementForUser` (who is paid), `validateImplementationInput` (plan limits), `validateGraph` (output integrity), `handleWebhook` (recording/revocation).",
  "3. `entity-authority-tool.js` — confirm the browser only renders a paid graph after a 200 response containing `jsonLd`, and that the free preview and demo have no such data.",
  "4. `entity-authority-checkout.js` and `stripe.js`/`stripe-webhook.js` — server-owned pricing, account binding, signature verification, per-event revalidation.",
  "5. `10-entity-purchases.sql` — RLS is enabled; the only policy is SELECT for the owning user; there are no INSERT/UPDATE/DELETE policies.",
  "",
  "`ALL-CODE.md` in this folder contains every file concatenated with a header.",
  ""
].join("\n");
fs.writeFileSync(path.join(out, "MANIFEST.md"), manifest);

const all = [
  "# Studio paid-path code",
  "",
  "Generated from the working tree. Each section is the complete file, unmodified.",
  "See MANIFEST.md for hashes.",
  ""
];
for (const row of rows) {
  const content = fs.readFileSync(path.join(root, row.source), "utf8").replace(/\s+$/, "");
  all.push(
    "---",
    "",
    `## ${row.name}`,
    "",
    `Repo path: \`${row.source}\`  `,
    `Lines: ${row.lines}  `,
    `SHA-256: \`${row.sha256}\``,
    "",
    row.purpose,
    "",
    "````js",
    content,
    "````",
    ""
  );
}
fs.writeFileSync(path.join(out, "ALL-CODE.md"), all.join("\n"));

const zipPath = path.join(root, "artifacts/studio-paid-review.zip");
fs.rmSync(zipPath, { force: true });
try {
  execFileSync("zip", ["-qr", zipPath, "studio-paid-review"], { cwd: path.join(root, "artifacts") });
} catch {
  execFileSync("python3", ["-m", "zipfile", "-c", zipPath, ...rows.map(row => "studio-paid-review/" + row.name), "studio-paid-review/MANIFEST.md", "studio-paid-review/ALL-CODE.md"], { cwd: path.join(root, "artifacts") });
}

console.log("BUNDLE " + out);
console.log("ZIP    " + zipPath + " (" + fs.statSync(zipPath).size + " bytes)");
for (const row of rows) {
  console.log(`${row.lines.toString().padStart(5)} lines  ${row.name}  ${row.sha256}`);
}
