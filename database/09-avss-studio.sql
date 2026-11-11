-- AI Visibility & Schema Studio (paid workspace) migration.
-- Source: mms60/AI-Visibility-Schema-Studio 001_paid_ai_tools.sql
-- Applied to the existing aeogeosearch Supabase project. Additive only: creates new
-- tables prefixed nothing (profiles/subscriptions) that do not exist there yet; the
-- existing GEO audit product uses its own geo_* tables and is untouched.
-- RLS is enabled with select-own policies only; all writes go through service-role functions.
-- Apply in Supabase SQL Editor. Existing free robots.txt functionality is not modified.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text unique not null,
  status text not null,
  price_id text,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_user_status_idx on public.subscriptions(user_id,status);

create table if not exists public.crawler_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_type text not null default 'crawler',
  target_url text not null,
  status text not null default 'queued',
  max_pages integer not null default 10,
  pages_tested integer not null default 0,
  score integer,
  summary text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create index if not exists crawler_scans_user_created_idx on public.crawler_scans(user_id,created_at desc);

create table if not exists public.crawler_scan_pages (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.crawler_scans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  http_status integer,
  title text,
  html_text_length integer,
  robots_meta text,
  canonical text,
  jsonld_count integer default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.crawler_findings (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.crawler_scans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_type text not null default 'crawler',
  severity text not null,
  title text not null,
  url text,
  evidence text,
  recommendation text,
  created_at timestamptz not null default now()
);

create table if not exists public.schema_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  page_url text not null,
  schema_type text not null,
  generated_jsonld jsonb not null,
  existing_audit jsonb,
  validation_issues jsonb,
  created_at timestamptz not null default now()
);
create index if not exists schema_generations_user_created_idx on public.schema_generations(user_id,created_at desc);

alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.crawler_scans enable row level security;
alter table public.crawler_scan_pages enable row level security;
alter table public.crawler_findings enable row level security;
alter table public.schema_generations enable row level security;

-- Users can read their own account data. Writes are performed by trusted server functions.
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select using (auth.uid()=id);
drop policy if exists "read own subscriptions" on public.subscriptions;
create policy "read own subscriptions" on public.subscriptions for select using (auth.uid()=user_id);
drop policy if exists "read own crawler scans" on public.crawler_scans;
create policy "read own crawler scans" on public.crawler_scans for select using (auth.uid()=user_id);
drop policy if exists "read own crawler pages" on public.crawler_scan_pages;
create policy "read own crawler pages" on public.crawler_scan_pages for select using (auth.uid()=user_id);
drop policy if exists "read own crawler findings" on public.crawler_findings;
create policy "read own crawler findings" on public.crawler_findings for select using (auth.uid()=user_id);
drop policy if exists "read own schema generations" on public.schema_generations;
create policy "read own schema generations" on public.schema_generations for select using (auth.uid()=user_id);

-- No anon/authenticated write policies are intentional: service-role functions own writes.
