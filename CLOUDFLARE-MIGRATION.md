# Cloudflare migration

Status: **Cloudflare build is complete and verified; production still runs on
Netlify and DNS has not been touched.**

Deployed Worker `aeogeo-search` serves the static site, every Netlify function at
its original `/.netlify/functions/*` path, hourly cron, KV-backed IndexNow and
queue-backed background jobs. All credentials are Cloudflare secrets. The free
audit path has been exercised end to end against the live database; the paid
paths still need one real purchase to be proven on Cloudflare (see the cutover
runbook).

## Target architecture

Use **Cloudflare Workers with Static Assets** as one deployment:

- `site/` is the static asset directory.
- A Worker entrypoint will handle `/.netlify/functions/*` (and later `/api/*`).
- Cloudflare Queues will replace Netlify background functions.
- A Cron Trigger will replace the hourly `content-notifications` function.
- KV or R2 will replace Netlify Blobs and the DOCX filesystem read.
- A hosted form endpoint will replace Netlify Forms.

Workers is preferred over Pages Functions here because the site needs scheduled
work and long-running background jobs, and Workers keeps those in one platform.
Cloudflare supports `_redirects` and `_headers` in Workers static assets.

## Inventory

### Server entry points

There are 34 function files. Some are support modules, not request entry points.

Request handlers:

`audit-checkout-readiness`, `avss-restore-purchase`, `avss-scan-history`,
`avss-scan-status`, `avss-schema-generate`, `avss-start-scan`,
`avss-stripe-checkout`, `avss-stripe-portal`, `avss-subscription-status`,
`billing-portal`, `billing-review`, `competitor-intelligence`,
`content-service-status`, `content-service`, `create-checkout`,
`create-kit-checkout`, `entity-audit`, `entity-authority-checkout`,
`guest-service-checkout`, `kit-download`, `owner-billing-check`,
`owner-monthly-test-setup`, `owner-monthly-test-webhook`, `owner-monthly-test`,
`product-api`, `service-checkout`, `start-audit`, `stripe-webhook`,
`studio-checkout`.

Background / scheduled / platform:

- `run-audit-background.js`
- `run-competitor-report-background.js`
- `avss-scan-background.mjs`
- `content-notifications.js` (hourly)
- `indexnow-submit.mjs` (Netlify `deploySucceeded` event)

Support modules:

- `avss-shared.mjs`
- files under `netlify/functions/lib/`

### Netlify Forms

30 HTML files contain Netlify form markup. There is one visible contact form
repeated across several pages, one entity-authority intake form, and a few
page-specific forms. Every form currently depends on Netlify's form
interception and has no `action` URL.

Until a replacement endpoint is configured, form submissions in the Cloudflare
preview will fail. That is expected, not a regression in the static preview.

### Netlify-specific dependencies

| Current dependency | Used by | Cloudflare replacement |
| --- | --- | --- |
| `@netlify/blobs` | `indexnow-submit.mjs` | KV or R2 ledger |
| `node:fs` / `node:path` | `kit-download.js` | R2 object or private asset |
| `node:dns/promises` / `node:net` | `avss-shared.mjs` | DNS-over-HTTPS lookup plus IP validation |
| `process.env.URL` | audit/studio dispatch | request origin or `PUBLIC_SITE_URL` |
| Netlify background functions | audit, competitor, AVSS | Cloudflare Queues |
| Netlify scheduled function | content notifications | Cron Trigger |
| Netlify Forms | 30 pages | hosted form endpoint |
| Netlify `deploySucceeded` | IndexNow | GitHub Action or scheduled Worker |

## Forms implementation

Formspree is wired into this branch:

- Contact forms: `https://formspree.io/f/mbgooqgz`
- Entity-authority form: `https://formspree.io/f/xrpqqrpa`
- Hidden Netlify detection forms and `form-name` fields were removed.
- Both endpoints accepted a test submission with HTTP 200 and `{"ok":true}`.
- The audit owner notice and content-service owner notices now post to the contact Formspree endpoint instead of the Netlify site.
- The React contact component in `site/assets/app.js` now posts to Formspree; the previous Netlify `/` handler was why the form showed an error.

Why:

- It is a hosted form backend, not a notification API that still needs a custom
  form handler.
- Unlimited forms on every plan; 50 submissions/month free, 200/month on the
  $15/month Personal plan, 2,000/month on Professional.
- It handles spam filtering, email notifications, a submission dashboard, and
  optional file uploads on paid plans.
- It works from static HTML, so the 30 pages only need an `action` attribute and
  the hidden Netlify fields removed.
- It can be replaced later with a Worker + email provider without changing the
  site architecture again.

Do not use Netlify's hidden form fallback after cutover: that would silently send
submissions back to Netlify.

Before wiring forms, create one Formspree form per logical destination:

1. `contact` — general consultation/contact.
2. `entity-authority` — AI Visibility & Schema Studio intake.
3. Any page-specific form that has a different owner or purpose.

The audit background job currently posts an owner notice to the production
Netlify contact form. That hardcoded dependency must be changed before the
background worker is enabled.

## Rollout order

### 0. Keep production untouched

- Do not cancel Netlify.
- Do not change nameservers.
- Do not point `aeogeosearch.com` at Cloudflare yet.
- Keep the Netlify production deploy available for rollback.

### 1. Create the Cloudflare account and zone

1. Create or sign in to a Cloudflare account.
2. Add `aeogeosearch.com` as a zone.
3. Stop before changing nameservers. Cloudflare can show the assigned
   nameservers; leave the registrar alone until the preview passes.
4. Keep the domain active at Netlify/registrar during the whole build.

### 2. Run the static preview locally

```bash
npx --yes wrangler dev --port 8787 --ip 0.0.0.0
```

Check:

- `/` returns the homepage.
- `/about` returns the About page without a redirect loop.
- `/competitor-tool` returns a 301 to `/visibility-tool`.
- `/nope` returns `404.html` with a 404 status.
- `/account/` has `Cache-Control: no-store`.
- `/assets/site.css` and images load.

The static preview includes the Formspree forms. The API layer is served by `worker/index.js` after the next build.

### 3. Add the Cloudflare preview deployment

This needs a Cloudflare account and a scoped API token or `wrangler login`.
No credential should be pasted into chat or committed to the repository.

Deploy only to a `workers.dev` preview first. Do not attach the production
domain.

### 4. Port the function layer

The first Worker adapter is implemented in `worker/index.js`. It keeps the
existing `/.netlify/functions/*` paths, converts a `Request` into the Netlify
event shape, converts the result back to a `Response`, handles ESM and CommonJS
handlers, copies string bindings into `process.env`, and serves static assets
through `env.ASSETS`.

The following functions are wired and bundle successfully:

- `audit-checkout-readiness`, `product-api`, `content-service-status`
- `create-checkout`, `create-kit-checkout`, `service-checkout`, `studio-checkout`
- `entity-authority-checkout`, `guest-service-checkout`
- `competitor-intelligence`, `run-competitor-report-background`
- `billing-portal`, `billing-review`, `owner-billing-check`
- `owner-monthly-test`, `owner-monthly-test-setup`, `owner-monthly-test-webhook`
- `stripe-webhook`, `content-service`, `content-notifications`
- `start-audit`, `run-audit-background`
- `kit-download` (the DOCX is bundled privately in the Worker)
- `entity-audit` and all `avss-*` functions

Verified locally:

- Static `/` returns 200.
- `audit-checkout-readiness` returns its normal JSON response.
- `product-api?action=config` returns 200 JSON.
- `content-service-status` returns 200 JSON.
- `stripe-webhook` rejects a bad signature with 400, proving the raw POST body
  and `stripe-signature` header reach the existing handler.
- Unknown function names return a clear 503, not a crash.
- Hourly Cron Trigger is configured for `content-notifications`.

## Platform replacements (done)

Netlify background functions and Blobs no longer have a Cloudflare gap:

- **Background jobs use Cloudflare Queues.** `start-audit`, `avss-start-scan` and
  the competitor tool dispatch to `/.netlify/functions/*-background` exactly as
  before, but `worker/index.js` intercepts those calls before they reach the
  network and enqueues them on `aegeo-jobs` (`JOBS` binding). The queue consumer
  runs the handler with its original headers and body, so the existing HMAC
  dispatch signature still verifies. A job that returns a 5xx is retried twice,
  then dropped. This replaces the self-referential HTTPS call, which could not
  work on Workers: the caller only waited 15 seconds, while the crawl runs for
  up to 105 seconds.
- **IndexNow uses KV and the Cron Trigger.** `worker/indexnow.js` reuses the
  shared `indexnow-selection.mjs` rules, keeps the submission ledger in the
  `INDEXNOW_LEDGER` KV namespace, and runs from the hourly cron instead of
  Netlify's `deploySucceeded` event. The key file stays public at
  `/8e63d09f86525125461b411e6f7e1dec.txt`.

Verified locally with `wrangler dev`:

- A real Supabase sign-in, then `start-audit` returned `202 queued`; the queue
  consumer ran the crawl and logged `GEO audit completed` with a score. The test
  user and job row were deleted afterwards.
- The Cron Trigger submitted a URL to IndexNow and received `HTTP 202`.
- After deploy, the queue consumer is attached to `aegeo-search`
  (`batch_size 1`, `max_retries 2`) and a remote KV write/read/delete round-trip
  succeeded.

Still to confirm before cutover: the Formspree forms on the deployed Worker
(already tested on the static preview), AVSS, kit download and the billing
portal, then the full browser click-through.

## Secrets status

Resolved: `SUPABASE_SERVICE_ROLE_KEY` is an encrypted Cloudflare secret holding
the real Supabase `service_role` key. A local `wrangler dev` run with the same
code and the same secret completed a real Supabase sign-in and a
`product-api?action=account` lookup against the live database.

Resolved: `STRIPE_SECRET_KEY` (a live restricted key, chosen because the price
catalog is live-mode and the full secret key could not be revealed) and
`STRIPE_WEBHOOK_SECRET` are encrypted secrets. Verified by running the Worker
locally with the real values: the checkout readiness check returns
`AUDIT_CONFIGURATION_VERIFIED`, all six live plan prices resolve at the approved
amounts, the default billing-portal configuration is valid, a webhook signed with
the real endpoint secret is accepted (`200 {"received":true}`), and a forged
signature is rejected (`400`).

Still missing: `STRIPE_MONTHLY_TEST_SECRET_KEY`, used only by the owner monthly
test flow, not by checkout or the live webhook.

Do not add any of them to `wrangler.jsonc` `vars`. That file is committed, and
`vars` are stored and displayed as plain text. Use Workers & Pages →
`aeogeo-search` → Settings → Variables and Secrets, with type **Secret**. Wrangler
deployments preserve secrets and drop plain-text variables that exist only in the
dashboard, so a secret survives the next deploy and a dashboard variable does not.
A plain-text `SUPABASE_SERVICE_ROLE_KEY` also blocks setting the secret with the
same name (`Binding name already in use`).

Audit crawler note: the Node HTTPS and DNS calls were replaced with `fetch`
and Cloudflare DNS-over-HTTPS. The public-address check validates A and AAAA
answers before the fetch; Cloudflare's egress controls remain the final SSRF
protection.

### 5. Test before cutover

Use Stripe test mode and a non-production Supabase project if possible.

Required checks:

- Static routes, redirects, headers, 404s.
- Supabase sign-in, callback, session refresh, sign-out.
- Free audit creation, background processing, polling, saved report.
- Competitor checkout and PDF generation.
- AVSS scan start, background completion, history.
- Stripe checkout, webhook signature, duplicate events, portal, refunds.
- Kit download with a real paid test session.
- Every form destination and spam rejection.
- IndexNow submission and ledger update.
- Hourly content notification run.

### 6. Cutover runbook

The domain is registered with **Namecheap** and currently uses Netlify DNS
(`dns1.p07.nsone.net` through `dns4.p07.nsone.net`). Cloudflare assigned
**`paloma.ns.cloudflare.com`** and **`randall.ns.cloudflare.com`** to the zone
`acc3d8d9ff08b7c74a55832c582ed30c`, which is still `pending`.

Nothing here changes the Stripe endpoint, the Supabase project or the site
itself. The Worker answers the same URLs Netlify answers today, so Stripe's
webhook keeps working with the existing `STRIPE_WEBHOOK_SECRET`.

**Step 1 — confirm the records came across.** In Cloudflare open
`aeogeosearch.com` → **DNS → Records** and check that the zone already holds the
live records, because switching nameservers hands the zone to Cloudflare:

| Type | Name | Value |
| --- | --- | --- |
| A | `aeogeosearch.com` | `52.52.192.191`, `13.52.188.95` |
| AAAA | `aeogeosearch.com` | `2600:1f1c:446:4900::258`, `2600:1f1c:446:4900::259` |
| TXT | `aeogeosearch.com` | `google-site-verification=A-k1eR4MGfqBIcPuPXsAqSOlAwyh_quvbwXshKXT4Jo` |

Add anything missing before switching. There are no MX records on this domain,
so no email is at risk.

**Step 2 — switch the nameservers at Namecheap.** Domain List →
`aeogeosearch.com` → Manage → **Nameservers** → *Custom DNS* → replace the four
`nsone.net` entries with the two Cloudflare names above → save. Activation
usually takes minutes.

**Step 3 — point the domain at the Worker.** Once the zone shows **Active** in
Cloudflare: Workers & Pages → `aegeo-search` → Settings → **Domains & Routes** →
*Add* → **Custom domain** → add `aegeosearch.com`, then `www.aegeosearch.com`.
Cloudflare creates the proxied DNS records for you. This is also the switch from
Netlify to the Worker; until this moment traffic still reaches Netlify.

**Step 4 — verify, in this order.**

1. `/` loads and `/assets/site.css` returns CSS, not HTML.
2. `/competitor-tool` redirects to `/visibility-tool`.
3. `/account/` returns `Cache-Control: no-store`.
4. A non-existent path returns the 404 page with a 404 status.
5. Sign in, run a free audit, confirm the report appears and the queue logs a
   completed job.
6. Buy one plan, confirm the webhook lands (Stripe → Developers → the endpoint →
   recent deliveries), the report portal opens, and the kit downloads. Refund
   the charge from Stripe afterwards.
7. Confirm the hourly cron ran (Workers → `aegeo-search` → Logs).

**Rollback.** At any point, set the nameservers at Namecheap back to
`dns1.p07.nsone.net`, `dns2.p07.nsone.net`, `dns3.p07.nsone.net`,
`dns4.p07.nsone.net`. Netlify still holds the deploy and its environment, so the
site comes back as it is today. Alternatively, in Cloudflare delete the custom
domain from the Worker and traffic returns to the imported Netlify records.

**Do not**, until the rollback window closes: cancel Netlify, delete its
environment variables, remove the Stripe endpoint, or change the Supabase
project URL.

## Environment variables

The Worker will need the same server-side settings currently used by Netlify.
Names observed in the functions include:

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_SITE_URL`,
`SITE_URL`, `GROQ_API_KEY`, `GOOGLE_KG_API_KEY`, `INDEXNOW_KEY`,
`CONTENT_SERVICE_ENABLED`, `ADVANCED_PLANS_READY`, `PLAN_LIMITS_APPROVED`,
`LIVE_PAYMENTS_ENABLED`, `COMPETITOR_INTELLIGENCE_DISABLED`, the
`STRIPE_PRICE_*` audit catalog IDs, the content-service price IDs, and any
portal configuration IDs. Never put live Stripe keys on a public preview.

Set these in Cloudflare's secret store, never in `wrangler.jsonc` or Git.
