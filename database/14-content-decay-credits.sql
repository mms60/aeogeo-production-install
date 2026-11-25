-- ---------------------------------------------------------------------------
-- Content Decay Predictor - report credits (bought before a scan exists)
-- ---------------------------------------------------------------------------
--
-- A buyer can now pay for the $49 report before running the free scan. The
-- payment is recorded here as an open credit, and the credit turns into a
-- normal purchase + entitlement for the first site that buyer scans.
--
-- Why a separate table: content_decay_purchases.scan_id is NOT NULL and is
-- covered by the content_decay_purchases_scan_owner foreign key, because a
-- purchase is by definition the report for one scan. A credit is the opposite:
-- it exists precisely while there is no scan. Keeping it separate means no
-- existing row, constraint, entitlement or report query changes shape.
--
-- Lifecycle: open -> claimed (purchase and entitlement created) or
-- open -> refunded / revoked. Only 'open' credits can be claimed, so a refund
-- before the first scan simply removes the credit instead of leaving money
-- owed against a report that was never built.
-- ---------------------------------------------------------------------------

create table if not exists public.content_decay_report_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  status text not null default 'open'
    check (status in ('open', 'claimed', 'refunded', 'revoked')),
  stripe_session_id text not null unique,
  stripe_payment_intent text,
  stripe_price_id text,
  amount_total integer check (amount_total >= 0),
  currency text not null default 'usd',
  livemode boolean not null default false,
  environment text not null default 'live'
    check (environment in ('live', 'test')),
  test_run_id uuid references public.content_decay_test_runs(id) on delete set null,
  -- Set once, when the credit is spent on a scan.
  claimed_scan_id uuid,
  purchase_id uuid references public.content_decay_purchases(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A test credit must be a non-livemode Stripe object, and a live credit must
  -- be a livemode one. Neither can be recorded under the other mode.
  constraint content_decay_report_credits_livemode check (
    (environment = 'live' and livemode = true) or
    (environment = 'test' and livemode = false)
  ),
  constraint content_decay_report_credits_claim check (
    (status = 'claimed') = (claimed_scan_id is not null and purchase_id is not null)
  )
);

-- Claiming looks up the buyer's oldest open credit in one environment.
create index if not exists content_decay_report_credits_open_idx
  on public.content_decay_report_credits (user_id, environment, created_at)
  where status = 'open';

-- Refunds and disputes arrive with the payment intent, before any purchase
-- exists, so the credit has to be findable that way too.
create index if not exists content_decay_report_credits_intent_idx
  on public.content_decay_report_credits (stripe_payment_intent, livemode)
  where stripe_payment_intent is not null;

-- Same posture as every other Content Decay table: enabled, denied to the
-- browser roles, service role only, and no policies (see database/12).
alter table public.content_decay_report_credits enable row level security;
revoke all on public.content_decay_report_credits from anon, authenticated;
grant all on public.content_decay_report_credits to service_role;
