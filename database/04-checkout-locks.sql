-- NEW migration 04, checkout locking only. Not yet applied to production.
-- Preserves all users, existing free audits, reports, subscriptions and usage.
-- Does NOT approve plans, enable billing, or change live-payment gates.
begin;
create table if not exists public.geo_checkout_sessions (
 user_id uuid primary key references auth.users(id) on delete cascade,
 customer_id text unique,
 livemode boolean not null,
 state text not null default 'idle' check(state in ('idle','creating','open')),
 attempt_id uuid,
 plan text check(plan in ('starter','professional','agency')),
 interval text check(interval in ('month','year')),
 stripe_id text,
 checkout_url text,
 expires_at timestamptz,
 lock_id uuid,
 lock_until timestamptz,
 updated_at timestamptz not null default now()
);
alter table public.geo_checkout_sessions enable row level security;
revoke all on public.geo_checkout_sessions from public,anon,authenticated;
grant all on public.geo_checkout_sessions to service_role;

create or replace function public.geo_checkout_claim(p_user uuid,p_lock uuid,p_plan text,p_interval text,p_live boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.geo_checkout_sessions%rowtype;
begin
 perform 1 from public.aeogeo_audit_accounts where user_id=p_user for update;
 if not found then raise exception 'Unknown account';end if;
 if p_plan not in ('starter','professional','agency') or p_interval not in ('month','year') then raise exception 'Invalid checkout selection';end if;
 insert into public.geo_checkout_sessions(user_id,customer_id,livemode)
 select p_user,(select customer_id from public.geo_subscriptions where user_id=p_user),p_live
 on conflict(user_id) do nothing;
 select * into c from public.geo_checkout_sessions where user_id=p_user for update;
 if c.livemode is distinct from p_live then return jsonb_build_object('allowed',false,'reason','mode_changed');end if;
 if c.lock_until>now() then return jsonb_build_object('allowed',false,'reason','busy');end if;
 update public.geo_checkout_sessions set
  lock_id=p_lock,lock_until=now()+interval '3 minutes',updated_at=now(),
  attempt_id=case when state='idle' then gen_random_uuid() else attempt_id end,
  plan=case when state='idle' then p_plan else plan end,
  interval=case when state='idle' then p_interval else interval end,
  state=case when state='idle' then 'creating' else state end
 where user_id=p_user returning * into c;
 return to_jsonb(c)||jsonb_build_object('allowed',true);
end; $$;

create or replace function public.geo_checkout_customer(p_user uuid,p_lock uuid,p_customer text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_customer not like 'cus_%' then raise exception 'Invalid billing customer';end if;
 update public.geo_checkout_sessions set customer_id=p_customer,updated_at=now()
 where user_id=p_user and lock_id=p_lock and lock_until>now()
 and (customer_id is null or customer_id=p_customer);
 return found;
end; $$;

create or replace function public.geo_checkout_bind(p_user uuid,p_lock uuid,p_session text,p_url text,p_expires timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_session not like 'cs_%' or p_url not like 'https://checkout.stripe.com/%' then raise exception 'Invalid checkout session';end if;
 update public.geo_checkout_sessions set state='open',stripe_id=p_session,checkout_url=p_url,expires_at=p_expires,updated_at=now()
 where user_id=p_user and lock_id=p_lock and lock_until>now() and customer_id is not null;
 return found;
end; $$;

create or replace function public.geo_checkout_reset(p_user uuid,p_lock uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.geo_checkout_sessions set state='idle',attempt_id=null,plan=null,interval=null,
 stripe_id=null,checkout_url=null,expires_at=null,lock_id=null,lock_until=null,updated_at=now()
 where user_id=p_user and lock_id=p_lock and lock_until>now();
 return found;
end; $$;

create or replace function public.geo_checkout_release(p_user uuid,p_lock uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.geo_checkout_sessions set lock_id=null,lock_until=null,updated_at=now()
 where user_id=p_user and lock_id=p_lock;
 return found;
end; $$;

revoke all on function public.geo_checkout_claim(uuid,uuid,text,text,boolean) from public,anon,authenticated;
revoke all on function public.geo_checkout_customer(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.geo_checkout_bind(uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.geo_checkout_reset(uuid,uuid) from public,anon,authenticated;
revoke all on function public.geo_checkout_release(uuid,uuid) from public,anon,authenticated;
grant execute on function public.geo_checkout_claim(uuid,uuid,text,text,boolean) to service_role;
grant execute on function public.geo_checkout_customer(uuid,uuid,text) to service_role;
grant execute on function public.geo_checkout_bind(uuid,uuid,text,text,timestamptz) to service_role;
grant execute on function public.geo_checkout_reset(uuid,uuid) to service_role;
grant execute on function public.geo_checkout_release(uuid,uuid) to service_role;
commit;
