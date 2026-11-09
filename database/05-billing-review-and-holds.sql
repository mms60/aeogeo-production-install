-- NEW migration 05. Requires migration 04; never reruns migrations 01-03.
-- No plan approvals, real-payment activation, refund issuance or report deletion.
begin;
alter table public.geo_subscriptions add column if not exists billing_mode text not null default 'live' check(billing_mode in ('test','live'));
alter table public.geo_subscriptions add column if not exists last_paid_invoice_id text;
alter table public.geo_subscriptions add column if not exists cancel_at_period_end boolean not null default false;
create table if not exists public.geo_billing_locks (
 user_id uuid primary key references auth.users(id) on delete cascade,
 token uuid not null,expires_at timestamptz not null
);
create table if not exists public.geo_billing_holds (
 id text primary key,user_id uuid not null references auth.users(id) on delete cascade,
 subscription_id text,billing_mode text not null default 'live' check(billing_mode in ('test','live')),kind text not null check(kind in ('dispute','manual_refund')),
 source_id text not null,active boolean not null,expires_at timestamptz,reason text not null,
 updated_at timestamptz not null default now()
);
create index if not exists geo_billing_holds_user on public.geo_billing_holds(user_id);
create table if not exists public.geo_billing_reviews (
 id text primary key,user_id uuid not null references auth.users(id) on delete cascade,
 billing_mode text not null check(billing_mode in ('test','live')),
 customer_id text not null,subscription_id text not null,charge_id text not null,
 original_amount bigint not null,amount_refunded bigint not null,currency text not null,
 full_refund boolean not null,period_end timestamptz,
 state text not null default 'open' check(state in ('open','kept','revoked')),
 reviewed_by uuid references auth.users(id) on delete set null,
 reviewed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists geo_billing_reviews_mode on public.geo_billing_reviews(billing_mode,state,created_at);
do $$ declare t text;begin
 foreach t in array array['geo_billing_locks','geo_billing_holds','geo_billing_reviews'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
create or replace function public.geo_billing_lock(p_user uuid,p_token uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.aeogeo_audit_accounts where user_id=p_user for update;
 if not found then raise exception 'Unknown account';end if;
 insert into public.geo_billing_locks(user_id,token,expires_at) values(p_user,p_token,now()+interval '3 minutes')
 on conflict(user_id) do update set token=excluded.token,expires_at=excluded.expires_at
 where public.geo_billing_locks.expires_at<=now();
 return found;
end; $$;
create or replace function public.geo_billing_unlock(p_user uuid,p_token uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 delete from public.geo_billing_locks where user_id=p_user and token=p_token;
end; $$;
create or replace function public.geo_billing_apply(
 p_event text,p_user uuid,p_token uuid,p_customer text,p_subscription text,p_plan text,p_status text,
 p_anchor timestamptz,p_paid_through timestamptz,p_mode text,p_paid_invoice text,p_holds jsonb,p_reviews jsonb,p_cancel_at_period_end boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare x jsonb;begin
 perform 1 from public.aeogeo_audit_accounts where user_id=p_user for update;
 perform 1 from public.geo_billing_locks where user_id=p_user and token=p_token and expires_at>now() for update;
 if not found then raise exception 'Billing lease expired';end if;
 if exists(select 1 from public.geo_stripe_events where id=p_event) then return false;end if;
 perform public.geo_apply_stripe_event(p_event,p_user,p_customer,p_subscription,p_plan,p_status,p_anchor,p_paid_through,false);
 update public.geo_subscriptions set billing_mode=p_mode,last_paid_invoice_id=coalesce(p_paid_invoice,last_paid_invoice_id),cancel_at_period_end=p_cancel_at_period_end
 where user_id=p_user and subscription_id=p_subscription;
 for x in select value from jsonb_array_elements(coalesce(p_holds,'[]'::jsonb)) loop
  insert into public.geo_billing_holds(id,user_id,subscription_id,billing_mode,kind,source_id,active,expires_at,reason)
  values(x->>'id',p_user,x->>'subscription_id',p_mode,x->>'kind',x->>'source_id',(x->>'active')::boolean,(x->>'expires_at')::timestamptz,x->>'reason')
  on conflict(id) do update set active=excluded.active,expires_at=excluded.expires_at,reason=excluded.reason,updated_at=now()
  where public.geo_billing_holds.user_id=excluded.user_id;
 end loop;
 for x in select value from jsonb_array_elements(coalesce(p_reviews,'[]'::jsonb)) loop
  insert into public.geo_billing_reviews(id,user_id,billing_mode,customer_id,subscription_id,charge_id,original_amount,amount_refunded,currency,full_refund,period_end)
  values(x->>'id',p_user,p_mode,p_customer,x->>'subscription_id',x->>'charge_id',(x->>'original_amount')::bigint,(x->>'amount_refunded')::bigint,x->>'currency',(x->>'full_refund')::boolean,(x->>'period_end')::timestamptz)
  on conflict(id) do update set amount_refunded=excluded.amount_refunded,full_refund=excluded.full_refund,
  state=case when public.geo_billing_reviews.amount_refunded is distinct from excluded.amount_refunded then 'open' else public.geo_billing_reviews.state end,
  period_end=coalesce(excluded.period_end,public.geo_billing_reviews.period_end),updated_at=now()
  where public.geo_billing_reviews.user_id=excluded.user_id;
 end loop;
 return true;
end; $$;
create or replace function public.geo_refund_review_decide(p_id text,p_admin uuid,p_decision text,p_expected_amount bigint,p_token uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.geo_billing_reviews%rowtype;u uuid;begin
 select user_id into u from public.geo_billing_reviews where id=p_id;
 if not found then return false;end if;
 perform 1 from public.aeogeo_audit_accounts where user_id=u for update;
 perform 1 from public.geo_billing_locks where user_id=u and token=p_token and expires_at>now() for update;
 if not found then raise exception 'Billing review lease expired';end if;
 select * into r from public.geo_billing_reviews where id=p_id for update;
 if r.state<>'open' or r.amount_refunded<>p_expected_amount then return false;end if;
 if p_decision not in ('keep','revoke') then raise exception 'Invalid review decision';end if;
 if p_decision='revoke' then
  if not r.full_refund or r.period_end is null or r.period_end<=now() then raise exception 'Only a full refund for a current paid period can end that paid access';end if;
  insert into public.geo_billing_holds(id,user_id,subscription_id,billing_mode,kind,source_id,active,expires_at,reason)
  values('manual:'||r.charge_id,r.user_id,r.subscription_id,r.billing_mode,'manual_refund',r.charge_id,true,r.period_end,'The owner ended access for a manually reviewed refunded period.')
  on conflict(id) do update set active=true,expires_at=excluded.expires_at,updated_at=now();
 end if;
 update public.geo_billing_reviews set state=case when p_decision='keep' then 'kept' else 'revoked' end,reviewed_by=p_admin,reviewed_at=now(),updated_at=now() where id=p_id;
 return true;
end; $$;
drop function if exists public.geo_reserve_job(uuid,uuid,text,text,integer);
create or replace function public.geo_reserve_job(p_user uuid,p_request uuid,p_url text,p_host text,p_pages integer,p_billing_mode text default 'live')
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
revoke all on function public.geo_billing_lock(uuid,uuid) from public,anon,authenticated;
revoke all on function public.geo_billing_unlock(uuid,uuid) from public,anon,authenticated;
revoke all on function public.geo_billing_apply(text,uuid,uuid,text,text,text,text,timestamptz,timestamptz,text,text,jsonb,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.geo_refund_review_decide(text,uuid,text,bigint,uuid) from public,anon,authenticated;
grant execute on function public.geo_billing_lock(uuid,uuid) to service_role;
grant execute on function public.geo_billing_unlock(uuid,uuid) to service_role;
grant execute on function public.geo_billing_apply(text,uuid,uuid,text,text,text,text,timestamptz,timestamptz,text,text,jsonb,jsonb,boolean) to service_role;
grant execute on function public.geo_refund_review_decide(text,uuid,text,bigint,uuid) to service_role;
revoke all on function public.geo_reserve_job(uuid,uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.geo_reserve_job(uuid,uuid,text,text,integer,text) to service_role;
commit;
