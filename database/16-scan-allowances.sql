-- Additive scan allowances and reservation counters.
-- Extends the existing page reservation in geo_reserve_job; page behaviour is unchanged.
-- Rollback: restore the previous geo_reserve_job/geo_finish_job definitions. The added
-- columns are inert when no scan is requested (p_scan defaults to false).
begin;

-- Preflight. Production may be missing migration 05, and PL/pgSQL bodies are stored as
-- text, so a missing column or table would otherwise fail only on the first reservation.
do $$ begin
 if not exists (
  select 1 from information_schema.columns
  where table_schema='public' and table_name='geo_subscriptions' and column_name='billing_mode'
 ) then
  raise exception 'Migration 16 requires public.geo_subscriptions.billing_mode from migration 05-billing-review-and-holds.sql. Apply migration 05 first.';
 end if;
 if to_regclass('public.geo_billing_holds') is null then
  raise exception 'Migration 16 requires table public.geo_billing_holds from migration 05-billing-review-and-holds.sql. Apply migration 05 first.';
 end if;
end $$;

alter table public.geo_plan_catalog add column if not exists scans_per_month integer not null default 0;
alter table public.geo_usage_periods
 add column if not exists scans_used integer not null default 0,
 add column if not exists scans_reserved integer not null default 0;
alter table public.geo_jobs add column if not exists scan_reserved boolean not null default false;

-- Approved monitoring scans per paid period. Rows that already carry a value are left alone,
-- so reapplying the migration never overwrites a deliberate change.
update public.geo_plan_catalog
 set scans_per_month = case id when 'starter' then 2 when 'professional' then 6 when 'agency' then 20 end
 where id in ('starter','professional','agency') and scans_per_month = 0;

do $$ begin
 if not exists (select 1 from pg_constraint where conname='geo_usage_periods_scans_nonnegative' and conrelid='public.geo_usage_periods'::regclass) then
  alter table public.geo_usage_periods add constraint geo_usage_periods_scans_nonnegative check (scans_used >= 0 and scans_reserved >= 0);
 end if;
end $$;

-- Replace both historical signatures so five-argument callers keep working through defaults
-- and every caller lands on the scan-aware definition.
drop function if exists public.geo_reserve_job(uuid,uuid,text,text,integer);
drop function if exists public.geo_reserve_job(uuid,uuid,text,text,integer,text);

create or replace function public.geo_reserve_job(p_user uuid,p_request uuid,p_url text,p_host text,p_pages integer,p_billing_mode text default 'live',p_scan boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.aeogeo_audit_accounts%rowtype;s public.geo_subscriptions%rowtype;c public.geo_plan_catalog%rowtype;
 j public.geo_jobs%rowtype;u public.geo_usage_periods%rowtype;ps timestamptz;pe timestamptz;n integer;months integer;is_paid boolean:=false;take integer;
begin
 select * into a from public.aeogeo_audit_accounts where user_id=p_user for update;
 if not found then raise exception 'Account missing';end if;
 -- Recover interrupted reservations; 20 min exceeds the background execution ceiling.
 for j in select * from public.geo_jobs where user_id=p_user and status in ('queued','running') and created_at<now()-interval '20 minutes' loop
  update public.geo_jobs set status='failed',finished_at=now(),error_message='Job interrupted; unused reservation restored.' where id=j.id and status in ('queued','running');
  -- A worker that finished or claimed the job after this loop's snapshot owns the outcome; only release when this update won.
  if not found then continue;end if;
  if j.credit_source='free' then
   update public.aeogeo_audit_accounts set free_audit_consumed_at=null where user_id=p_user and free_audit_consumed_at=j.created_at;
  else
   update public.geo_usage_periods set reserved_pages=greatest(0,reserved_pages-j.reserved_pages),
    scans_reserved=greatest(0,scans_reserved-case when j.scan_reserved then 1 else 0 end)
    where user_id=p_user and period_start=j.period_start;
  end if;
 end loop;
 -- Recover stale earlier-tool jobs too, without restoring any completed free audit.
 update public.aeogeo_audit_accounts set free_audit_consumed_at=null where user_id=p_user and free_audit_consumed_at in (select reserved_at from public.aeogeo_audit_jobs where user_id=p_user and status in ('queued','running') and reserved_at<now()-interval '20 minutes');
 update public.aeogeo_audit_jobs set status='failed',finished_at=now(),error_message='Job interrupted; reservation recovered by product audit.' where user_id=p_user and status in ('queued','running') and reserved_at<now()-interval '20 minutes';
 select * into a from public.aeogeo_audit_accounts where user_id=p_user;
 select * into j from public.geo_jobs where user_id=p_user and request_id=p_request;
 if found then return jsonb_build_object('allowed',true,'id',j.id,'status',j.status,'page_limit',j.reserved_pages,'scan_reserved',j.scan_reserved);end if;
 select * into s from public.geo_subscriptions where user_id=p_user;
 is_paid:=found and s.billing_mode=p_billing_mode and s.status in ('active','past_due','canceled') and s.paid_through>now();
 -- A canceled-at-period-end subscription may retain status active; paid-through is always required.
 if is_paid and exists(select 1 from public.geo_billing_holds h where h.user_id=p_user and h.billing_mode=p_billing_mode and h.active and (h.expires_at is null or h.expires_at>now()) and (h.kind='dispute' or h.subscription_id=s.subscription_id)) then return jsonb_build_object('allowed',false,'reason','billing_hold');end if;
 if is_paid then
  select * into c from public.geo_plan_catalog where id=s.plan;
  if not found or (not c.approved and not(p_billing_mode='test' and s.plan='starter')) then return jsonb_build_object('allowed',false,'reason','plan_not_ready');end if;
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
  -- Page allowance is checked first so a scan can never consume the last page reservation and fail afterwards.
  if p_scan then
   if c.scans_per_month<=0 then return jsonb_build_object('allowed',false,'reason','scan_not_in_plan');end if;
   if c.scans_per_month-u.scans_used-u.scans_reserved<=0 then return jsonb_build_object('allowed',false,'reason','scan_limit_reached');end if;
  end if;
  if not exists(select 1 from public.geo_domains where user_id=p_user and hostname=p_host) then
   select count(*) into n from public.geo_domains where user_id=p_user;
   if n>=c.domains then return jsonb_build_object('allowed',false,'reason','domain_limit_reached');end if;
   insert into public.geo_domains(user_id,hostname) values(p_user,p_host);
  end if;
  take:=least(greatest(1,p_pages),c.per_audit,c.monthly_pages-u.used_pages-u.reserved_pages);
 else
  if p_scan then return jsonb_build_object('allowed',false,'reason','scan_not_in_plan');end if;
  if a.free_audit_consumed_at is not null then return jsonb_build_object('allowed',false,'reason','subscription_required');end if;
  -- Do not run a new free job beside an older still-active phase-2 job.
  if exists(select 1 from public.aeogeo_audit_jobs where user_id=p_user and status in ('queued','running')) then return jsonb_build_object('allowed',false,'reason','audit_running');end if;
  take:=least(greatest(1,p_pages),25);
 end if;
 insert into public.geo_jobs(user_id,request_id,target_url,hostname,reserved_pages,credit_source,period_start,scan_reserved)
 values(p_user,p_request,p_url,p_host,take,case when is_paid then 'subscription' else 'free' end,ps,p_scan) returning * into j;
 if is_paid then update public.geo_usage_periods set reserved_pages=reserved_pages+take,scans_reserved=scans_reserved+case when p_scan then 1 else 0 end where user_id=p_user and period_start=ps;
 else update public.aeogeo_audit_accounts set free_audit_consumed_at=j.created_at where user_id=p_user;end if;
 return jsonb_build_object('allowed',true,'id',j.id,'status',j.status,'page_limit',take,'scan_reserved',p_scan);
end; $$;

-- Charge a completed scan, refund a failed one, and release the reservation in both cases.
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
  update public.geo_usage_periods set reserved_pages=greatest(0,reserved_pages-j.reserved_pages),used_pages=used_pages+actual,
   scans_reserved=greatest(0,scans_reserved-case when j.scan_reserved then 1 else 0 end),
   scans_used=scans_used+case when j.scan_reserved and p_error is null then 1 else 0 end
   where user_id=owner and period_start=j.period_start;
 elsif p_error is not null then
  update public.aeogeo_audit_accounts set free_audit_consumed_at=null where user_id=owner and free_audit_consumed_at=j.created_at;
 end if;
end; $$;

revoke all on function public.geo_reserve_job(uuid,uuid,text,text,integer,text,boolean) from public,anon,authenticated;
grant execute on function public.geo_reserve_job(uuid,uuid,text,text,integer,text,boolean) to service_role;
-- geo_finish_job is replaced in place, so its existing grants are preserved.
commit;
