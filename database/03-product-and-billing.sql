-- Offline draft migration. Review and test on staging before any production deployment.
-- Run AFTER 01-accounts.sql and 02-audit-limit.sql. Existing free-credit state is preserved.
begin;
create table if not exists public.geo_subscriptions (
 user_id uuid primary key references auth.users(id) on delete cascade,
 customer_id text unique,
 subscription_id text unique,
 plan text check(plan in ('starter','professional','agency')),
 status text not null default 'incomplete',
 paid_through timestamptz,
 credit_anchor timestamptz,
 updated_at timestamptz not null default now()
);
create table if not exists public.geo_plan_catalog (
 id text primary key, domains integer not null, per_audit integer not null,
 monthly_pages integer not null, approved boolean not null default false
);
insert into public.geo_plan_catalog values
 ('starter',1,300,300,false),
 ('professional',3,300,4500,false),
 ('agency',10,300,15000,false)
on conflict(id) do nothing;
-- Professional and Agency limits above are PROVISIONAL. Approval does not happen automatically.
create table if not exists public.geo_usage_periods (
 user_id uuid not null references auth.users(id) on delete cascade,
 period_start timestamptz not null,period_end timestamptz not null,
 used_pages integer not null default 0 check(used_pages>=0),
 reserved_pages integer not null default 0 check(reserved_pages>=0),
 primary key(user_id,period_start)
);
create table if not exists public.geo_domains (
 user_id uuid not null references auth.users(id) on delete cascade,
 hostname text not null, created_at timestamptz not null default now(),
 primary key(user_id,hostname)
);
create table if not exists public.geo_jobs (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,target_url text not null,hostname text not null,
 status text not null default 'queued' check(status in ('queued','running','completed','failed')),
 credit_source text not null check(credit_source in ('free','subscription')),
 reserved_pages integer not null,page_count integer not null default 0,
 period_start timestamptz,created_at timestamptz not null default now(),
 started_at timestamptz,finished_at timestamptz,report jsonb,error_message text,
 progress jsonb not null default '{}'::jsonb,
 unique(user_id,request_id)
);
create index if not exists geo_jobs_owner_created on public.geo_jobs(user_id,created_at desc);
create table if not exists public.geo_stripe_events (
 id text primary key, processed_at timestamptz not null default now()
);
do $$ declare t text; begin
 foreach t in array array['geo_subscriptions','geo_plan_catalog','geo_usage_periods','geo_domains','geo_jobs','geo_stripe_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
-- No browser write policies. Authenticated endpoints always check record ownership.
create or replace function public.geo_reserve_job(p_user uuid,p_request uuid,p_url text,p_host text,p_pages integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.aeogeo_audit_accounts%rowtype;s public.geo_subscriptions%rowtype;c public.geo_plan_catalog%rowtype;
 j public.geo_jobs%rowtype;u public.geo_usage_periods%rowtype;ps timestamptz;pe timestamptz;n integer;months integer;is_paid boolean:=false;take integer;
begin
 select * into a from public.aeogeo_audit_accounts where user_id=p_user for update;
 if not found then raise exception 'Account missing';end if;
 -- Recover interrupted reservations; 20 min exceeds the background execution ceiling.
 for j in select * from public.geo_jobs where user_id=p_user and status in ('queued','running') and created_at<now()-interval '20 minutes' loop
  update public.geo_jobs set status='failed',finished_at=now(),error_message='Job interrupted; unused reservation restored.' where id=j.id;
  if j.credit_source='free' then
   update public.aeogeo_audit_accounts set free_audit_consumed_at=null where user_id=p_user and free_audit_consumed_at=j.created_at;
  else
   update public.geo_usage_periods set reserved_pages=greatest(0,reserved_pages-j.reserved_pages) where user_id=p_user and period_start=j.period_start;
  end if;
 end loop;
 -- Recover stale earlier-tool jobs too, without restoring any completed free audit.
 update public.aeogeo_audit_accounts set free_audit_consumed_at=null where user_id=p_user and free_audit_consumed_at in (select reserved_at from public.aeogeo_audit_jobs where user_id=p_user and status in ('queued','running') and reserved_at<now()-interval '20 minutes');
 update public.aeogeo_audit_jobs set status='failed',finished_at=now(),error_message='Job interrupted; reservation recovered by product audit.' where user_id=p_user and status in ('queued','running') and reserved_at<now()-interval '20 minutes';
 select * into a from public.aeogeo_audit_accounts where user_id=p_user;
 select * into j from public.geo_jobs where user_id=p_user and request_id=p_request;
 if found then return jsonb_build_object('allowed',true,'id',j.id,'status',j.status,'page_limit',j.reserved_pages);end if;
 select * into s from public.geo_subscriptions where user_id=p_user;
 is_paid:=found and s.status in ('active','past_due','canceled') and s.paid_through>now();
 -- A canceled-at-period-end subscription may retain status active; paid-through is always required.
 if is_paid then
  select * into c from public.geo_plan_catalog where id=s.plan;
  if not found or not c.approved then return jsonb_build_object('allowed',false,'reason','plan_not_ready');end if;
  months:=greatest(0,(extract(year from age(now(),s.credit_anchor))::integer*12)+extract(month from age(now(),s.credit_anchor))::integer);
  ps:=s.credit_anchor+make_interval(months=>months);
  if ps>now() then months:=greatest(0,months-1);ps:=s.credit_anchor+make_interval(months=>months);end if;
  -- Recheck against the original anchor (Jan 31 -> Feb 28 -> Mar 31), not chained intervals.
  while s.credit_anchor+make_interval(months=>months+1)<=now() loop months:=months+1;end loop;
  ps:=s.credit_anchor+make_interval(months=>months);
  pe:=least(s.credit_anchor+make_interval(months=>months+1),s.paid_through);
  insert into public.geo_usage_periods(user_id,period_start,period_end) values(p_user,ps,pe) on conflict(user_id,period_start) do update set period_end=greatest(public.geo_usage_periods.period_end,excluded.period_end);
  select * into u from public.geo_usage_periods where user_id=p_user and period_start=ps for update;
  if c.monthly_pages-u.used_pages-u.reserved_pages<=0 then return jsonb_build_object('allowed',false,'reason','page_limit_reached');end if;
  if not exists(select 1 from public.geo_domains where user_id=p_user and hostname=p_host) then
   select count(*) into n from public.geo_domains where user_id=p_user;
   if n>=c.domains then return jsonb_build_object('allowed',false,'reason','domain_limit_reached');end if;
   insert into public.geo_domains(user_id,hostname) values(p_user,p_host);
  end if;
  take:=least(greatest(1,p_pages),c.per_audit,c.monthly_pages-u.used_pages-u.reserved_pages);
 else
  if a.free_audit_consumed_at is not null then return jsonb_build_object('allowed',false,'reason','subscription_required');end if;
  -- Do not run a new free job beside an older still-active phase-2 job.
  if exists(select 1 from public.aeogeo_audit_jobs where user_id=p_user and status in ('queued','running')) then return jsonb_build_object('allowed',false,'reason','audit_running');end if;
  take:=least(greatest(1,p_pages),25);
 end if;
 insert into public.geo_jobs(user_id,request_id,target_url,hostname,reserved_pages,credit_source,period_start)
 values(p_user,p_request,p_url,p_host,take,case when is_paid then 'subscription' else 'free' end,ps) returning * into j;
 if is_paid then update public.geo_usage_periods set reserved_pages=reserved_pages+take where user_id=p_user and period_start=ps;
 else update public.aeogeo_audit_accounts set free_audit_consumed_at=j.created_at where user_id=p_user;end if;
 return jsonb_build_object('allowed',true,'id',j.id,'status',j.status,'page_limit',take);
end; $$;
create or replace function public.geo_finish_job(p_job uuid,p_report jsonb,p_error text default null)
returns void language plpgsql security definer set search_path='' as $$
declare j public.geo_jobs%rowtype;owner uuid;actual integer;
begin
 select user_id into owner from public.geo_jobs where id=p_job;if not found then return;end if;
 perform 1 from public.aeogeo_audit_accounts where user_id=owner for update;
 select * into j from public.geo_jobs where id=p_job for update;
 if j.status not in ('queued','running') then return;end if;
 actual:=case when p_error is null then least(j.reserved_pages,greatest(0,coalesce((p_report->>'pageCount')::integer,0))) else 0 end;
 if actual=0 and p_error is null then raise exception 'Cannot finish an empty successful audit';end if;
 update public.geo_jobs set status=case when p_error is null then 'completed' else 'failed' end,
 report=p_report,page_count=actual,finished_at=now(),error_message=left(p_error,500) where id=p_job;
 if j.credit_source='subscription' then
  update public.geo_usage_periods set reserved_pages=greatest(0,reserved_pages-j.reserved_pages),used_pages=used_pages+actual where user_id=owner and period_start=j.period_start;
 elsif p_error is not null then
  update public.aeogeo_audit_accounts set free_audit_consumed_at=null where user_id=owner and free_audit_consumed_at=j.created_at;
 end if;
end; $$;
-- Atomic idempotent Stripe state update. The server retrieves current subscription state,
-- verifies Stripe signatures and maps only configured price IDs before calling this function.
create or replace function public.geo_apply_stripe_event(p_event text,p_user uuid,p_customer text,p_subscription text,p_plan text,p_status text,p_anchor timestamptz,p_paid_through timestamptz,p_revoked boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare existing public.geo_subscriptions%rowtype;
begin
 perform 1 from public.aeogeo_audit_accounts where user_id=p_user for update;
 if not found then raise exception 'Unknown account';end if;
 insert into public.geo_stripe_events(id) values(p_event) on conflict do nothing;
 if not found then return;end if;
 select * into existing from public.geo_subscriptions where user_id=p_user;
 if found then
  if existing.customer_id is distinct from p_customer then raise exception 'Customer ownership mismatch';end if;
  if existing.subscription_id is distinct from p_subscription and (existing.paid_through>now() or existing.credit_anchor>=p_anchor) then return;end if;
 end if;
 insert into public.geo_subscriptions(user_id,customer_id,subscription_id,plan,status,credit_anchor,paid_through)
 values(p_user,p_customer,p_subscription,p_plan,p_status,p_anchor,p_paid_through)
 on conflict(user_id) do update set customer_id=excluded.customer_id,subscription_id=excluded.subscription_id,
 plan=excluded.plan,status=excluded.status,credit_anchor=case when public.geo_subscriptions.subscription_id is distinct from excluded.subscription_id then excluded.credit_anchor else coalesce(public.geo_subscriptions.credit_anchor,excluded.credit_anchor) end,
 paid_through=case when p_revoked then least(coalesce(public.geo_subscriptions.paid_through,now()),now())
 when public.geo_subscriptions.subscription_id is distinct from excluded.subscription_id then excluded.paid_through
 else greatest(public.geo_subscriptions.paid_through,excluded.paid_through) end,updated_at=now();
end; $$;
revoke all on function public.geo_reserve_job(uuid,uuid,text,text,integer) from public,anon,authenticated;
revoke all on function public.geo_finish_job(uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.geo_apply_stripe_event(text,uuid,text,text,text,text,timestamptz,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.geo_reserve_job(uuid,uuid,text,text,integer) to service_role;
grant execute on function public.geo_finish_job(uuid,jsonb,text) to service_role;
grant execute on function public.geo_apply_stripe_event(text,uuid,text,text,text,text,timestamptz,timestamptz,boolean) to service_role;
commit;
-- Do NOT set approved=true until the chosen limits and feature readiness are approved.
