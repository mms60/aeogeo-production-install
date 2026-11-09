-- Separate, additive service-order storage. Does not change audit accounts, subscriptions,
-- free-use history, reports, billing flags, or Stripe configuration. Review before applying.
begin;
create table if not exists public.geo_service_checkouts (
 user_id uuid not null references auth.users(id),
 service text not null check(service='knowledge-base'),
 billing_mode text not null check(billing_mode in ('test','live')),
 attempt_id uuid not null default gen_random_uuid(),
 session_id text unique,
 customer_id text,
 lock_id uuid,
 lock_until timestamptz,
 updated_at timestamptz not null default now(),
 primary key(user_id,service,billing_mode)
);
create table if not exists public.geo_service_orders (
 session_id text primary key,
 user_id uuid not null references auth.users(id),
 service text not null check(service='knowledge-base'),
 billing_mode text not null check(billing_mode in ('test','live')),
 payment_intent_id text not null unique,
 amount_cents integer not null check(amount_cents=150000),
 currency text not null check(currency='usd'),
 payment_status text not null check(payment_status in ('paid','refunded','disputed')),
 fulfillment_status text not null default 'awaiting_project_details',
 confirmed_at timestamptz not null default now()
);
alter table public.geo_service_checkouts enable row level security;
alter table public.geo_service_orders enable row level security;
revoke all on public.geo_service_checkouts,public.geo_service_orders from public,anon,authenticated;
grant all on public.geo_service_checkouts,public.geo_service_orders to service_role;
create or replace function public.geo_service_checkout(p_action text,p_user uuid,p_service text,p_mode text,p_lock uuid,p_session text default null,p_customer text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.geo_service_checkouts%rowtype;
begin
 if p_service<>'knowledge-base' or p_mode not in ('test','live') then raise exception 'Invalid service selection';end if;
 if p_action='claim' then
  insert into public.geo_service_checkouts(user_id,service,billing_mode) values(p_user,p_service,p_mode) on conflict do nothing;
 end if;
 select * into c from public.geo_service_checkouts where user_id=p_user and service=p_service and billing_mode=p_mode for update;
 if not found then return jsonb_build_object('allowed',false);end if;
 if p_action='claim' then
  if c.lock_until>now() then return jsonb_build_object('allowed',false);end if;
  update public.geo_service_checkouts set lock_id=p_lock,lock_until=now()+interval '3 minutes',updated_at=now()
   where user_id=p_user and service=p_service and billing_mode=p_mode returning * into c;
  return to_jsonb(c)||jsonb_build_object('allowed',true);
 end if;
 if c.lock_id is distinct from p_lock or c.lock_until is null or c.lock_until<=now() then return jsonb_build_object('allowed',false);end if;
 if p_action='bind' then
  if p_session not like 'cs_%' or p_customer not like 'cus_%' then raise exception 'Invalid checkout binding';end if;
  if c.session_id is not null and c.session_id<>p_session then raise exception 'Checkout ownership changed';end if;
  update public.geo_service_checkouts set session_id=p_session,customer_id=p_customer,updated_at=now()
   where user_id=p_user and service=p_service and billing_mode=p_mode;
 elsif p_action='reset' then
  if exists(select 1 from public.geo_service_orders where session_id=c.session_id) then raise exception 'Paid order cannot be reset';end if;
  update public.geo_service_checkouts set session_id=null,attempt_id=gen_random_uuid(),updated_at=now()
   where user_id=p_user and service=p_service and billing_mode=p_mode;
 elsif p_action='release' then
  update public.geo_service_checkouts set lock_id=null,lock_until=null where user_id=p_user and service=p_service and billing_mode=p_mode;
 else raise exception 'Unknown action';end if;
 return jsonb_build_object('allowed',true);
end; $$;
revoke all on function public.geo_service_checkout(text,uuid,text,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.geo_service_checkout(text,uuid,text,text,uuid,text,text) to service_role;
create or replace function public.geo_service_record_order(p_session text,p_user uuid,p_mode text,p_intent text,p_status text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_mode not in ('test','live') or p_status not in ('paid','refunded','disputed') or p_intent not like 'pi_%' then raise exception 'Invalid service order';end if;
 if not exists(select 1 from public.geo_service_checkouts where user_id=p_user and service='knowledge-base' and billing_mode=p_mode and session_id=p_session) then raise exception 'Unknown service checkout';end if;
 insert into public.geo_service_orders(session_id,user_id,service,billing_mode,payment_intent_id,amount_cents,currency,payment_status)
 values(p_session,p_user,'knowledge-base',p_mode,p_intent,150000,'usd',p_status)
 on conflict(session_id) do update set payment_status=excluded.payment_status
 where public.geo_service_orders.user_id=p_user and public.geo_service_orders.billing_mode=p_mode and public.geo_service_orders.payment_intent_id=p_intent;
 return found;
end; $$;
revoke all on function public.geo_service_record_order(text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.geo_service_record_order(text,uuid,text,text,text) to service_role;
commit;
