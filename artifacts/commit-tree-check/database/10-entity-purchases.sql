-- AI Entity & Citation Authority Setup purchase entitlements.
-- Additive only. Existing subscriptions, GEO audit tables, and Stripe records are untouched.
-- RLS allows a signed-in customer to read their own purchases; all writes go through
-- service-role Netlify functions and the Stripe webhook.
create extension if not exists pgcrypto;

create table if not exists public.entity_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text,
  plan text not null check (plan in ('single', 'multi')),
  status text not null default 'paid' check (status in ('paid', 'revoked')),
  stripe_session_id text unique not null,
  stripe_payment_intent text,
  amount_total integer,
  currency text not null default 'usd',
  livemode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists entity_purchases_user_status_idx
  on public.entity_purchases(user_id, status);
create index if not exists entity_purchases_email_idx
  on public.entity_purchases(lower(email), status);
create index if not exists entity_purchases_payment_intent_idx
  on public.entity_purchases(stripe_payment_intent);

alter table public.entity_purchases enable row level security;

drop policy if exists "read own entity purchases" on public.entity_purchases;
create policy "read own entity purchases"
  on public.entity_purchases for select
  using (auth.uid() = user_id);

-- No insert, update, or delete policies are intentional. Only service-role
-- functions and the verified Stripe webhook may write purchase records.
