# Cloudflare migration

Status: **static preview prepared; contact forms wired to Formspree; production remains on Netlify.**

This branch does not change DNS, Netlify, Stripe, or Supabase. The only working
artifact so far is a local Cloudflare Workers static-assets preview. The API and
form layers are not migrated yet.

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

Still excluded until their platform dependencies are replaced:

1. `kit-download` uses `node:fs`; move the generated kit into R2 or a static
   asset.
2. `indexnow-submit` uses Netlify Blobs; replace with KV/R2 or a static ledger.
3. Background dispatch/Queues must replace Netlify background-function calls.
   `start-audit` currently dispatches to `run-audit-background` over HTTP; test
   that this stays within Workers subrequest and CPU limits before cutover.
4. Verify the Formspree forms on the Cloudflare preview.
5. IndexNow deploy trigger.

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

### 6. Cutover

1. Lower DNS TTL at least 24 hours before cutover.
2. Deploy the tested Worker to a preview URL.
3. Keep the Stripe webhook URL as
   `https://aeogeosearch.com/.netlify/functions/stripe-webhook`. The same path
   exists on Cloudflare, so after cutover Stripe can keep the endpoint and the
   same `STRIPE_WEBHOOK_SECRET`; do not create a new endpoint unless the path
   changes. Keep the Netlify endpoint until the new one is confirmed.
4. Add the Cloudflare callback URLs to Supabase; keep the Netlify URLs until
   cutover is complete.
5. Switch nameservers only after all checks pass.
6. Keep Netlify deployed and do not delete its environment variables or forms
   until the rollback window closes.

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
