# AEOGEO product  -  private local review build

**Status: reviewable prototype, not a finished paid service.**

Built on 28 October 2026. Nothing in this package has been deployed. No payment service has been activated. The existing production website and working phase-2 test site have not been altered. No migration was executed against the customer’s Supabase database.

## Reviewable now

- Existing agency-site copy retained, with a top-level **GEO Audit** main-navigation link in the local compiled bundle. A small navigation bridge loads the new standalone product route rather than falling into the existing React app’s unknown-route handling.
- `/geo-audit/`: benefits, four-pillar methodology, pricing, annual toggle, free-to-paid explanation, FAQ and clear scope/feature-readiness disclosures.
- `/geo-audit/run/`: navy/blue complete-audit dashboard, four weighted pillars, 22-metric framework, per-page searchable table and drawer, prioritized fixes, editable implementation templates, simulator, saved-report website comparison, print/PDF, CSV and Markdown briefs.
- `/login/`, `/auth/callback/`, `/account/`: verified-email account flow, password recovery, saved/legacy report access, usage display, upgrade prompt, plan selection and billing-portal entry point.
- Explicitly labeled sample reports use fictional HTML fixtures processed by the actual analyzer. They do not consume an audit or purport to measure a real competitor.
- `aeogeo-product-review.html` is a standalone offline review. It embeds styling, scripts and sample data. Real authentication/crawling/billing do not run in that file.

## Backend code built; connected staging validation still required

- Pinned-public-IP HTTPS fetching, private-address restrictions, redirect validation, byte/time caps and robots rules inherited from the working earlier crawler.
- New sitemap/internal-link discovery, bounded queue, three concurrent fetches, background progress and page-allowance enforcement.
- Owner-authenticated account/report endpoints. Browser requests never receive the service-role key.
- Draft migration `03-product-and-billing.sql`: private product tables, atomic credit reservation/finalization, free-audit preservation, domain/page quotas, monthly credit windows (including annual subscriptions), interrupted-reservation recovery and idempotent subscription-event recording.
- Stripe Checkout, customer portal, raw-body signature verification, configured-price allowlist, recurring-price validation, server-side user metadata and payment-confirmed entitlement scaffolding. A successful browser return does **not** grant paid access.

**Important:** `01-accounts.sql` and `02-audit-limit.sql` are included as historical/reference migrations and for fresh isolated tests. They have already been applied to the user’s existing test setup; this build is not a request to run them again. Migration 03 remains an offline draft.

## Exact approved pricing

| Plan | Monthly | Annual, paid once/year | Monthly equivalent | Domains |
|---|---:|---:|---:|---:|
| Starter | $49 | $470.40 | $39.20 | 1 |
| Professional | $149 | $1,430.40 | $119.20 | 3 |
| Agency | $499 | $4,790.40 | $399.20 | 10 |

USD. Annual savings are 20%. Starter includes 300 page-analyses/month and a scan cap of 300. The free audit is one per verified account, up to 25 pages. Scans count actual successfully analyzed pages; opening an existing report is free.

Professional/Agency included page budgets are **not approved**. Internal draft SQL values of 4,500/15,000 are placeholders, not commercial commitments. Those values are not advertised on the product page or returned as approved limits by the public configuration endpoint. All product catalog rows are initially `approved=false`.

Requested $25/1,000-page overage pricing is disclosed as proposed, not enabled. Consent, top-up versus automatic metering, expiry, usage notifications and refund treatment require approval. No automatic overage billing exists. Single domains over 5,000 pages need custom scoping; the present dashboard does not support a 5,000-page scan.

## Still unfinished / paid-launch blockers

1. Professional/Agency final page budgets and Agency crawl cadence.
2. Automatic monthly/weekly recrawl scheduling, customer schedule controls and reliable scheduler dispatch.
3. Agency secure client sub-accounts, team invitations/roles, unlimited-seat implementation, white-label output, public API/key lifecycle and bulk multi-client exports. Single-report CSV/Markdown/print exports are implemented; bulk agency exports are not.
4. Actual assistant-answer/citation monitoring. The implemented comparison is a same-framework website-checklist comparison, not ranking or citation tracking.
5. A semantic/topic evaluator and repeatable cross-platform extraction tests. These two framework dimensions remain unavailable rather than receiving fabricated scores.
6. Persistent cross-request Checkout-session locking/reuse to prevent duplicate subscriptions from concurrent sessions; subscription-switch/replacement races need multi-session staging tests.
7. Refund/dispute revocation/holds and reconciliation, payment-failure/grace policy, invoice pagination/proration/downgrade scenarios, portal configuration and customer-support/refund procedure.
8. End-to-end verification with real **test-mode** Stripe prices/webhooks and a connected staging Supabase project, including malicious cross-account requests, migration upgrade rehearsal and real independent concurrent transactions.
9. Large-scan resource/time validation at the actual paid allowance. Only a three-page live smoke crawl was run in this build; do not infer production capacity from that test.
10. Final subscription/cancellation/refund terms, privacy review, accessibility review and customer-approved launch copy. Existing agency-site terms are not assumed to cover a new SaaS subscription.
11. Tier-specific feature gating needs a final product decision: the review currently exposes simulator/templates/saved-report comparison with the report; do not market their exclusivity as enforced paid-tier access yet.
12. New product pages are intentionally `noindex` in this private build. Search/canonical/robots publication review is required at launch. Existing original pages are retained and not re-audited for all claims or external assets.

Checkout is protected by independent environment gates: `BILLING_ENABLED`, `BILLING_REVIEW_COMPLETE`, `PLAN_LIMITS_APPROVED`, per-plan catalog approval, `ADVANCED_PLANS_READY` and the additional `LIVE_PAYMENTS_ENABLED` gate for live secret keys. **Do not toggle these to bypass unfinished work.** They default to false; there are no private keys in this package. The local static preview never executes private backend functions.

## What the score actually means

This is AEOGEO’s internal checklist, not a university-certified GEO standard, an actual AI ranking, or a validated predictor of citation lift. The 35/30/15/20 pillar weights total 100. Within-pillar weights are normalized; unavailable checks are excluded. Page pillar scores are averaged and then combined using the fixed pillar weights.

Content/tone/readability/topic-linking checks include English-language editorial proxies. Structured-data checks verify parsing/declarations, not semantic validity or truth. External links are counted, not independently vetted. Robots permission is not proof of indexing or inclusion. Initial-HTML text availability is not page speed or Core Web Vitals. No JavaScript rendering is performed. No actual assistant citations are collected.

The simulator assumes selected available checks reach 100; it does not predict revenue, traffic, citations or rankings. Templates contain explicit placeholders and require factual and technical review. No fictional customer endorsements are used.

## Validation performed in this workspace

- **21 passing automated tests**, including real execution of the migrations in isolated PGlite/PostgreSQL. Coverage includes free-credit idempotency/restoration, paid quota reservation, actual-page charging, domain limit, expired subscriptions, event idempotency, stale-job recovery, browser-role restrictions, and original-anchor month-end/leap-year credit windows.
- **13 passing browser review checks**: annual amounts, 22 cards/four pillars, page drawer/search, simulator/reset, CSV/Markdown downloads, side-by-side fixture comparison, print visibility, original React navigation bridge, 390px mobile/no horizontal overflow, and no JavaScript exceptions.
- Standalone offline review tested with external HTTPS requests blocked; product/dashboard/status views and sample comparison work without external requests.
- Real three-page HTTPS crawl of aeogeosearch.com saved under `tests/live-crawl-result.json`. Much of that site is a JavaScript shell; the analyzer correctly leaves content checks unavailable. This is an initial-HTML smoke test, not a rendered-site quality certification.
- Runtime-only npm audit: **zero reported vulnerabilities** at test time; full development-tool audit is separate.
- JavaScript syntax checks performed. Netlify deployment, full Netlify build, authenticated cloud end-to-end tests and Stripe payments were **not** performed.

PGlite validates PostgreSQL SQL/function behavior but is not a substitute for independent multi-session Postgres locking tests or Supabase’s complete runtime. The sandbox ran Node 20.20.2 for these local tests; the target runtime and package requirement are Node >=22.13 (Netlify Node 22; user’s Windows Node 24 meets the requirement). The Netlify CLI was not used to deploy this package.

## Source organization

- `site/`: existing agency site plus new product/account/auth UI.
- `netlify/functions/`: customer endpoints, real analyzer/crawler and billing scaffolding.
- `database/`: reference 01/02 migrations and new draft 03.
- `scripts/`: local static review server, source page/sample generators and offline review builder.
- `tests/`: automated tests, browser tests/results, screenshots, live crawl and dependency-audit results.

This is a development handoff/status record, not instructions for the user to change hosting, rerun SQL or buy a plan. Any later rollout should proceed one confirmed step at a time in chat after the deployment pause and launch blockers are resolved.

## Branding update after review

The product and account/dashboard type now use the same Sora and Inter font families and weights as the original website. The original font files are embedded locally with OFL licenses so the offline viewer does not silently fall back to a system font. Website navy/royal/ice tokens are copied exactly. Hero sizing is 60px desktop / 36px mobile, section headings 36px / 30px, feature headings 18px, standard copy 16px, supporting copy 14px, and controls 14px. Local product/source text has been stripped of em dash characters and common entities.

**Original audit interface received and integrated:** the user supplied the complete HTML/CSS/JS. The previous reconstructed dashboard has been replaced by the supplied pure-tool layout in templates/audit-tool.html and assets/audit-tool.css. Its grid background, glows, scope cards, three stat tiles, progress checklist and terminal, circular gauge, four pillar tiles, four tabs, priority/section filters, visible implementation templates, simulator and drawer are preserved. Website font/size adjustments and removal of em dashes remain applied. Synthetic results and fabricated timed logs have been removed, unsupported visibility/lift/research claims corrected, and the interface wired to the existing real-report/job/account endpoints. The two unimplemented evaluators stay explicitly unavailable. The optional saved-report comparison is below, not an extra replacement tab.

## Production-site installation preparation

The owner supplied the actual published index.html, assets/app.js, assets/site.css, plus the production _redirects rules. Exact original uploaded files are retained under production-reference. Existing production uses explicit prerendered-page rewrites and a final real 404 rule. The earlier draft homepage catch-all has been removed from netlify.toml. New product routes are explicit and precede the 404 fallback.

A standalone Node installer, add-geo-audit-to-my-website.cjs, prepares a separate aeogeo-production-install folder from the owner’s extracted published backup. It validates the supplied production app.js hash, preserves original pages/images/assets, patches navigation, adds product/account/auth pages and server code, and leaves the original backup unchanged. It makes no network requests, installs no dependencies, changes no SQL or hosting settings, and performs no deployment. It refuses an existing output folder or an unexpected navigation/baseline. No Netlify project is auto-linked. Publishing is currently locked to the existing production deployment and should stay locked until checks are complete. Production variables, SQL 03, Supabase redirect allowlisting, connected authentication/audit checks and deployment-credit availability remain unconfirmed.

The exact-interface layout has passed the current local browser checks, including a stubbed server job/account flow; stubbed responses are only used in tests and never modify Supabase or Stripe. The standalone offline review uses labeled HTML fixtures. A full live-production audit through this new UI is not yet verified.

## Owner-confirmed installation update

The owner has now reported SUCCESS after applying migration 03 in the existing Supabase SQL Editor. They also confirmed saving the production SUPABASE_URL and secret SUPABASE_SERVICE_ROLE_KEY, and that the production confirmation callback URL was already allowlisted. These are owner confirmations, not independently verified cloud tests. No website files have been deployed. Do not repeat the earlier account/SMTP or 01/02 migrations.
