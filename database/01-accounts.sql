-- Phase 1: account records only. No payment entitlement or audit reservation yet.
-- Run in YOUR Supabase project's SQL Editor. No secret key is required here.
begin;
create table if not exists public.aeogeo_audit_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  free_audit_consumed_at timestamptz
);
alter table public.aeogeo_audit_accounts enable row level security;
revoke all on public.aeogeo_audit_accounts from anon, authenticated;
grant select on public.aeogeo_audit_accounts to authenticated;
drop policy if exists "aeogeo_read_own_account" on public.aeogeo_audit_accounts;
create policy "aeogeo_read_own_account"
  on public.aeogeo_audit_accounts for select to authenticated
  using ((select auth.uid()) = user_id);
-- There are deliberately no customer insert/update/delete policies.
create or replace function public.aeogeo_create_audit_account()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.aeogeo_audit_accounts (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.aeogeo_create_audit_account() from public, anon, authenticated;
drop trigger if exists aeogeo_audit_account_on_signup on auth.users;
create trigger aeogeo_audit_account_on_signup after insert on auth.users
for each row execute function public.aeogeo_create_audit_account();
-- Also create rows for users who signed up before this script was run.
insert into public.aeogeo_audit_accounts (user_id)
select id from auth.users on conflict (user_id) do nothing;
commit;
