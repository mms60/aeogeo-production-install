# GEOAEO Search — Business Information & Claims Auditor

A starter SaaS application using Next.js, Netlify, Supabase, Stripe Checkout, and the OpenAI API.

## What this starter does
- Email magic-link sign-in through Supabase Auth.
- Crawls up to six accessible public HTML pages on the submitted hostname.
- Compares information across those pages and flags possible factual conflicts.
- Flags factual/comparative/credential claims without identifiable support in the supplied pages.
- Stores reports in Supabase and displays scan history.
- Supports one-time scan credits and monthly subscription allowances through Stripe webhooks.

## Important limitations
This is a website-only first release. It does not yet check Google Business Profile, Yelp, social profiles, government registries, review sites, or other external directories. Add those integrations before marketing the product as cross-web verification. A missing citation is not proof a claim is false. The score is a heuristic summary, not a certification or legal determination. The crawler skips inaccessible pages and obeys normal website access limitations; it does not bypass logins, CAPTCHAs, robots controls, or paywalls.

## Requirements
- Node.js 20+
- Supabase project
- Stripe account
- OpenAI API key
- Netlify account
- A Git repository connected to Netlify (or a code publishing platform that syncs to a Git repository)

## Local setup
1. Copy `.env.example` to `.env.local` and fill in all values.
2. In Supabase, open SQL Editor and run `supabase-schema.sql`.
3. In Supabase Authentication > URL Configuration, set the Site URL to your deployed site and add `http://localhost:3000/dashboard` plus your production `/dashboard` URL to Redirect URLs.
4. In Supabase Authentication > Providers, enable Email and configure magic links.
5. Create Stripe Products and recurring/one-time Prices matching your chosen plan amounts. Put each Price ID in the matching environment variable. The app expects: `STRIPE_PRICE_SINGLE_SCAN`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_AGENCY`, optional `STRIPE_PRICE_MONITOR`, optional `STRIPE_PRICE_SCAN_PACK`.
6. In Stripe Developers > Webhooks, create an endpoint at `https://YOUR_DOMAIN/api/webhook`. Subscribe to `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`. Copy its signing secret to `STRIPE_WEBHOOK_SECRET`.
7. Install and run:
   ```bash
   npm install
   npm run dev
   ```
8. Visit `http://localhost:3000`.

## Deploy to Netlify
1. Push this project to the Git repository used by your code-publishing platform.
2. In Netlify, choose Add new site > Import an existing project and connect that repository.
3. Build command: `npm run build`. Netlify's Next.js plugin is configured in `netlify.toml`.
4. Add every variable from `.env.example` under Site configuration > Environment variables. Set `NEXT_PUBLIC_SITE_URL` to the production HTTPS URL.
5. Deploy, then update Supabase redirect URLs and Stripe webhook URL to the production domain.
6. Test a successful checkout, a failed/cancelled checkout, subscription cancellation, and a scan with/without credits before accepting customers.

## Security and launch checklist
- Never put `SUPABASE_SERVICE_ROLE_KEY`, Stripe secret, webhook secret, or OpenAI key in a `NEXT_PUBLIC_` variable.
- Enable Stripe webhook signature verification (already implemented).
- Configure Stripe tax, refund, cancellation, and customer portal policies as appropriate.
- Add rate limiting/bot protection to auth and scan endpoints before public launch.
- Add SSRF protections and a dedicated crawl queue before scaling. This starter validates hostname scope after redirects but is not a hardened public crawler.
- Add usage period tracking tied to Stripe subscription billing periods; the starter uses calendar-month scan counts as a simple MVP allowance.
- Add PDF/CSV export, email delivery, source integrations, admin tools, and retention/deletion controls before a production launch.
