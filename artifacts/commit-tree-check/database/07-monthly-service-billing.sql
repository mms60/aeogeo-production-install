-- Additive monthly done-for-you service billing. Separate from GEO Audit billing
-- and the one-time Knowledge Base Package. Does not enable charges or change reports.
begin;
create table if not exists public.geo_monthly_service_checkouts (
 user_id uuid not null references auth.users(id), billing_mode text not null check(billing_mode in ('test','live')),
 service text not null check(service in ('ai-visibility-starter','ai-search-growth','ai-search-authority')),
 attempt_id uuid not null default gen_random_uuid(), customer_id text, session_id text unique,
 lock_id uuid, lock_until timestamptz, updated_at timestamptz not null default now(),
 primary key(user_id,billing_mode)
);
create table if not exists public.geo_monthly_service_subscriptions (
 subscription_id text primary key, user_id uuid not null references auth.users(id),
 billing_mode text not null check(billing_mode in ('test','live')),
 service text not null check(service in ('ai-visibility-starter','ai-search-growth','ai-search-authority')),
 customer_id text not null, status text not null, cancel_at_period_end boolean not null default false,
 paid_through timestamptz, last_paid_invoice_id text,
 financial_review text, dispute_ids jsonb not null default '[]'::jsonb, updated_at timestamptz not null default now()
);
create table if not exists public.geo_monthly_service_invoices (
 invoice_id text primary key, subscription_id text not null, user_id uuid not null references auth.users(id),
 billing_mode text not null check(billing_mode in ('test','live')),
 service text not null check(service in ('ai-visibility-starter','ai-search-growth','ai-search-authority')),
 amount_cents integer not null, currency text not null check(currency='usd'), paid_through timestamptz not null,
 charge_id text not null, review_status text,
 confirmed_at timestamptz not null default now(),
 check((service='ai-visibility-starter' and amount_cents=34900) or (service='ai-search-growth' and amount_cents=64900) or (service='ai-search-authority' and amount_cents=99900))
);
create table if not exists public.geo_monthly_service_adjustments (
 source_id text primary key, user_id uuid not null references auth.users(id), billing_mode text not null check(billing_mode in ('test','live')),
 subscription_id text not null, invoice_id text not null, charge_id text not null,
 kind text not null check(kind in ('refund','dispute')), status text not null,
 amount_cents integer not null check(amount_cents>=0), currency text not null,
 updated_at timestamptz not null default now()
);
alter table public.geo_monthly_service_adjustments enable row level security;
alter table public.geo_monthly_service_checkouts enable row level security;
alter table public.geo_monthly_service_subscriptions enable row level security;
alter table public.geo_monthly_service_invoices enable row level security;
revoke all on public.geo_monthly_service_checkouts,public.geo_monthly_service_subscriptions,public.geo_monthly_service_invoices,public.geo_monthly_service_adjustments from public,anon,authenticated;
grant all on public.geo_monthly_service_checkouts,public.geo_monthly_service_subscriptions,public.geo_monthly_service_invoices,public.geo_monthly_service_adjustments to service_role;
create or replace function public.geo_monthly_service_checkout(p_action text,p_user uuid,p_mode text,p_service text,p_lock uuid,p_session text default null,p_customer text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.geo_monthly_service_checkouts%rowtype;
begin
 if p_mode not in ('test','live') or p_service not in ('ai-visibility-starter','ai-search-growth','ai-search-authority') then raise exception 'Invalid monthly service';end if;
 if p_action='claim' then
  insert into public.geo_monthly_service_checkouts(user_id,billing_mode,service) values(p_user,p_mode,p_service) on conflict do nothing;
 end if;
 select * into c from public.geo_monthly_service_checkouts where user_id=p_user and billing_mode=p_mode for update;
 if not found then return jsonb_build_object('allowed',false);end if;
 if p_action in ('claim','lock') then
  if c.lock_until>now() then return jsonb_build_object('allowed',false);end if;
  update public.geo_monthly_service_checkouts set lock_id=p_lock,lock_until=now()+interval '3 minutes',updated_at=now()
   where user_id=p_user and billing_mode=p_mode returning * into c;
  return to_jsonb(c)||jsonb_build_object('allowed',true);
 end if;
 if c.lock_id is distinct from p_lock or c.lock_until is null or c.lock_until<=now() then return jsonb_build_object('allowed',false);end if;
 if p_action='customer' then
  if p_customer not like 'cus_%' or (c.customer_id is not null and c.customer_id<>p_customer) then raise exception 'Invalid service customer';end if;
  update public.geo_monthly_service_checkouts set customer_id=p_customer where user_id=p_user and billing_mode=p_mode;
 elsif p_action='bind' then
  if p_session not like 'cs_%' or p_customer is distinct from c.customer_id or (c.session_id is not null and c.session_id<>p_session) then raise exception 'Invalid service session';end if;
  update public.geo_monthly_service_checkouts set session_id=p_session where user_id=p_user and billing_mode=p_mode;
 elsif p_action='reset' then
  if exists(select 1 from public.geo_monthly_service_subscriptions where user_id=p_user and billing_mode=p_mode and (status not in ('canceled','incomplete_expired') or paid_through>now())) then raise exception 'Existing subscription must be managed first';end if;
  update public.geo_monthly_service_checkouts set session_id=null,service=p_service,attempt_id=gen_random_uuid(),updated_at=now() where user_id=p_user and billing_mode=p_mode;
 elsif p_action='release' then
  update public.geo_monthly_service_checkouts set lock_id=null,lock_until=null where user_id=p_user and billing_mode=p_mode;
 else raise exception 'Unknown action';end if;
 return jsonb_build_object('allowed',true);
end; $$;
create or replace function public.geo_monthly_service_apply(p_user uuid,p_mode text,p_service text,p_lock uuid,p_subscription text,p_customer text,p_status text,p_cancel boolean,p_paid_through timestamptz,p_invoice text,p_charge text,p_amount integer,p_review text,p_disputes jsonb,p_adjustments jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare adjustment jsonb;
begin
 if not exists(select 1 from public.geo_monthly_service_checkouts where user_id=p_user and billing_mode=p_mode and customer_id=p_customer and lock_id=p_lock and lock_until>now()) then return false;end if;
 if p_subscription not like 'sub_%' then raise exception 'Invalid subscription';end if;
 insert into public.geo_monthly_service_subscriptions(subscription_id,user_id,billing_mode,service,customer_id,status,cancel_at_period_end,paid_through,last_paid_invoice_id,financial_review,dispute_ids)
 values(p_subscription,p_user,p_mode,p_service,p_customer,p_status,p_cancel,p_paid_through,p_invoice,p_review,p_disputes)
 on conflict(subscription_id) do update set status=excluded.status,cancel_at_period_end=excluded.cancel_at_period_end,paid_through=excluded.paid_through,last_paid_invoice_id=excluded.last_paid_invoice_id,financial_review=excluded.financial_review,dispute_ids=excluded.dispute_ids,updated_at=now()
 where public.geo_monthly_service_subscriptions.user_id=p_user and public.geo_monthly_service_subscriptions.billing_mode=p_mode and public.geo_monthly_service_subscriptions.service=p_service and public.geo_monthly_service_subscriptions.customer_id=p_customer;
 if not found then raise exception 'Subscription ownership mismatch';end if;
 if p_invoice is not null then
  if p_invoice not like 'in_%' or p_charge not like 'ch_%' or p_paid_through is null then raise exception 'Invalid paid service invoice';end if;
  insert into public.geo_monthly_service_invoices(invoice_id,subscription_id,user_id,billing_mode,service,amount_cents,currency,paid_through,charge_id,review_status)
  values(p_invoice,p_subscription,p_user,p_mode,p_service,p_amount,'usd',p_paid_through,p_charge,p_review)
  on conflict(invoice_id) do update set review_status=excluded.review_status
  where public.geo_monthly_service_invoices.user_id=p_user and public.geo_monthly_service_invoices.subscription_id=p_subscription and public.geo_monthly_service_invoices.billing_mode=p_mode;
  if not found then raise exception 'Invoice ownership mismatch';end if;
 end if;
 for adjustment in select value from jsonb_array_elements(coalesce(p_adjustments,'[]'::jsonb)) loop
  insert into public.geo_monthly_service_adjustments(source_id,user_id,billing_mode,subscription_id,invoice_id,charge_id,kind,status,amount_cents,currency)
  values(adjustment->>'id',p_user,p_mode,p_subscription,adjustment->>'invoice',adjustment->>'charge',adjustment->>'kind',adjustment->>'status',(adjustment->>'amount')::integer,adjustment->>'currency')
  on conflict(source_id) do update set status=excluded.status,amount_cents=excluded.amount_cents,updated_at=now()
  where public.geo_monthly_service_adjustments.user_id=p_user and public.geo_monthly_service_adjustments.billing_mode=p_mode and public.geo_monthly_service_adjustments.subscription_id=p_subscription;
  if not found then raise exception 'Service adjustment ownership mismatch';end if;
 end loop;
 return true;
end; $$;
revoke all on function public.geo_monthly_service_checkout(text,uuid,text,text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.geo_monthly_service_apply(uuid,text,text,uuid,text,text,text,boolean,timestamptz,text,text,integer,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.geo_monthly_service_checkout(text,uuid,text,text,uuid,text,text) to service_role;
grant execute on function public.geo_monthly_service_apply(uuid,text,text,uuid,text,text,text,boolean,timestamptz,text,text,integer,text,jsonb,jsonb) to service_role;
commit;
