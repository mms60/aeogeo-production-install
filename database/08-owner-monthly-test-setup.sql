-- Private configuration for automated owner-only Stripe TEST setup.
-- Additive only. Does not alter live billing, reports, prices, credentials or payment flags.
begin;
create table if not exists public.geo_owner_monthly_test_configuration (
 id smallint primary key default 1 check (id=1),
 user_id uuid not null references auth.users(id),
 billing_mode text not null default 'test' check (billing_mode='test'),
 generation uuid not null default gen_random_uuid(),
 enabled boolean not null default false,
 configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration)='object'),
 lock_id uuid,
 lock_until timestamptz,
 updated_at timestamptz not null default now(),
 check (configuration::text !~ '(sk_(live|test)_|whsec_)'),
 check (not enabled or (
  configuration ? 'account_id' and configuration ? 'prices' and
  configuration ? 'portal_id' and configuration ? 'webhook_id' and
  jsonb_typeof(configuration->'encrypted_secret')='object'
 ))
);
alter table public.geo_owner_monthly_test_configuration enable row level security;
revoke all on public.geo_owner_monthly_test_configuration from public,anon,authenticated;
grant all on public.geo_owner_monthly_test_configuration to service_role;
create or replace function public.geo_owner_monthly_test_setup(
 p_action text,p_user uuid,p_lock uuid,p_config jsonb default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.geo_owner_monthly_test_configuration%rowtype;
begin
 if p_user is null or p_lock is null then raise exception 'Invalid TEST setup request';end if;
 if p_action='claim' then
  insert into public.geo_owner_monthly_test_configuration(id,user_id) values(1,p_user) on conflict do nothing;
 end if;
 select * into r from public.geo_owner_monthly_test_configuration where id=1 for update;
 if not found or r.user_id<>p_user then raise exception 'TEST setup ownership mismatch';end if;
 if p_action='claim' then
  if r.lock_until>now() then return jsonb_build_object('allowed',false);end if;
  update public.geo_owner_monthly_test_configuration set lock_id=p_lock,lock_until=now()+interval '3 minutes',updated_at=now() where id=1 returning * into r;
  return to_jsonb(r)||jsonb_build_object('allowed',true);
 end if;
 if r.lock_id is distinct from p_lock or r.lock_until is null or r.lock_until<=now() then return jsonb_build_object('allowed',false);end if;
 if p_action in ('save','complete') then
  if p_config is null or jsonb_typeof(p_config)<>'object' then raise exception 'Invalid TEST setup state';end if;
  update public.geo_owner_monthly_test_configuration set
   configuration=p_config,
   enabled=case when p_action='complete' then true else enabled end,
   lock_id=case when p_action='complete' then null else p_lock end,
   lock_until=case when p_action='complete' then null else now()+interval '3 minutes' end,
   updated_at=now()
   where id=1 returning * into r;
  return to_jsonb(r)||jsonb_build_object('allowed',true);
 elsif p_action='release' then
  update public.geo_owner_monthly_test_configuration set lock_id=null,lock_until=null,updated_at=now() where id=1;
  return jsonb_build_object('allowed',true);
 else raise exception 'Invalid TEST setup action';end if;
end;$$;
revoke all on function public.geo_owner_monthly_test_setup(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.geo_owner_monthly_test_setup(text,uuid,uuid,jsonb) to service_role;
commit;
