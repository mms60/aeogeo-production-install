-- ============================================================================
-- Content Decay Predictor - Fact consistency (draft migration 13)
-- ============================================================================
--
-- STATUS: applied to production (project ftwohoenimegsmtliqgz) on 2026-11-24.
-- Both tables exist with RLS enabled, no policies, browse roles revoked and
-- service_role granted. Nothing in the application requires them to exist: the
-- scan worker and the paid report both fall back to "no fact data" when these
-- tables are absent, so the code is safe either side of this migration.
--
-- WHAT IT ADDS
--   Two tables, both owned through content_decay_scans:
--     content_decay_fact_claims     one row per atomic claim found on a page
--     content_decay_fact_conflicts  one row per detected disagreement
--
-- WHY NO PAGE TEXT COLUMN
--   The worker extracts claims while the page text is still in memory and
--   stores only the claim, its canonical value and a verbatim quote. Full page
--   copy is never written here, so this migration adds no new copy retention.
--
-- SECURITY MODEL (same as 12-content-decay.sql)
--   RLS is enabled on both tables, browser roles are revoked, and no policies
--   are created. Only the service role reads or writes them, from the Netlify
--   functions. Findings are paid content: the free scan API never selects
--   either table.
--
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Atomic claims
-- ---------------------------------------------------------------------------
-- source_kind separates what a page says in visible copy from what it declares
-- in JSON-LD. Keeping them in one table is what makes the same-page
-- structured-data-vs-copy comparison possible without a second schema.
create table if not exists public.content_decay_fact_claims (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.content_decay_scans(id) on delete cascade,
  page_id uuid references public.content_decay_scan_pages(id) on delete cascade,
  -- Deliberately closed. A category added here must first have a deterministic
  -- extractor and canonicaliser in netlify/functions/lib/fact-extract.js.
  category text not null check (category in (
    'pricing', 'phone', 'address', 'hours', 'founded', 'headcount'
  )),
  -- Comparison bucket, e.g. 'starting_price:month' or 'plan_price:starter:month'.
  -- Two claims can only contradict each other inside the same attribute.
  attribute text not null,
  -- Canonical form used for equality: 'usd:34900:month', 'phone:4699052836',
  -- 'hours:mon-fri:0900-1700', 'year:2014', 'size:12', 'addr:...'.
  value_key text not null,
  -- The human-readable form shown in the report.
  value_display text not null,
  -- Verbatim evidence. For visible claims this is a substring of the page text
  -- the crawler fetched; for JSON-LD claims it is the declared property.
  quote text,
  source_url text not null,
  source_kind text not null check (source_kind in ('visible', 'jsonld')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Detected disagreements
-- ---------------------------------------------------------------------------
-- Three kinds, kept separate because their false-positive profiles differ:
--   contradiction       two current pages state different values
--   drift               a possibly outdated page disagrees with a current one
--   jsonld_vs_visible   one page's structured data contradicts its own copy
create table if not exists public.content_decay_fact_conflicts (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.content_decay_scans(id) on delete cascade,
  kind text not null check (kind in ('contradiction', 'drift', 'jsonld_vs_visible')),
  category text not null,
  attribute text not null,
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  title text not null,
  detail text,
  value_a text,
  value_b text,
  page_a_url text not null,
  page_b_url text not null,
  quote_a text,
  quote_b text,
  recommendation text,
  -- Reserved for the dismissal learning loop. Nothing writes true yet: the loop
  -- needs real dismissals before an embedding of the finding is worth storing.
  dismissed boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------------
create index if not exists content_decay_fact_claims_scan_idx
  on public.content_decay_fact_claims(scan_id, category, attribute);

create index if not exists content_decay_fact_claims_page_idx
  on public.content_decay_fact_claims(page_id) where page_id is not null;

create index if not exists content_decay_fact_conflicts_scan_idx
  on public.content_decay_fact_conflicts(scan_id, severity, kind);

-- Every conflict is between two pages. This is what the report and the future
-- dismissal loop look at first.
create index if not exists content_decay_fact_conflicts_open_idx
  on public.content_decay_fact_conflicts(scan_id)
  where dismissed = false;

-- ---------------------------------------------------------------------------
-- 4. Row level security: enabled, denied to browser roles, service role only
-- ---------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array[
    'content_decay_fact_claims',
    'content_decay_fact_conflicts'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- No policies are created on purpose. See the security model note at the top.
