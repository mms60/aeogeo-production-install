-- Run AFTER 01-accounts.sql. Phase 2 reserves one lifetime free audit.
-- Only the trusted backend can write audit jobs or call these functions.
begin;
create table if not exists public.aeogeo_audit_jobs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.aeogeo_audit_accounts(user_id) on delete cascade,
 request_id uuid not null,
 target_url text not null,
 status text not null default 'queued' check (status in ('queued','running','completed','failed')),
 reserved_at timestamptz not null default now(),
 started_at timestamptz,
 finished_at timestamptz,
 report jsonb,
 error_message text,
 unique(user_id, request_id)
);
alter table public.aeogeo_audit_jobs enable row level security;
revoke all on public.aeogeo_audit_jobs from anon,authenticated;
grant all on public.aeogeo_audit_jobs to service_role;
grant select,update on public.aeogeo_audit_accounts to service_role;
-- Report access is through an authenticated backend endpoint, not direct browser writes.
create or replace function public.aeogeo_reserve_free_audit(p_user_id uuid,p_request_id uuid,p_target_url text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.aeogeo_audit_accounts%rowtype; j public.aeogeo_audit_jobs%rowtype;
begin
 select * into a from public.aeogeo_audit_accounts where user_id=p_user_id for update;
 if not found then raise exception 'Account missing'; end if;
 -- Recover jobs interrupted by infrastructure. Background runs should finish well before 20 minutes.
 for j in select * from public.aeogeo_audit_jobs where user_id=p_user_id and status in ('queued','running') and reserved_at < now()-interval '20 minutes' loop
   update public.aeogeo_audit_jobs set status='failed',error_message='The audit timed out. Your credit was restored.',finished_at=now() where id=j.id;
   if a.free_audit_consumed_at=j.reserved_at then
    update public.aeogeo_audit_accounts set free_audit_consumed_at=null where user_id=p_user_id;
    a.free_audit_consumed_at:=null;
   end if;
 end loop;
 select * into j from public.aeogeo_audit_jobs where user_id=p_user_id and request_id=p_request_id;
 if found then return jsonb_build_object('allowed',true,'id',j.id,'status',j.status); end if;
 if a.free_audit_consumed_at is not null then return jsonb_build_object('allowed',false,'reason','subscription_required'); end if;
 insert into public.aeogeo_audit_jobs(user_id,request_id,target_url) values(p_user_id,p_request_id,p_target_url) returning * into j;
 update public.aeogeo_audit_accounts set free_audit_consumed_at=j.reserved_at where user_id=p_user_id;
 return jsonb_build_object('allowed',true,'id',j.id,'status',j.status);
end; $$;
create or replace function public.aeogeo_fail_audit(p_job_id uuid,p_error text)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid; j public.aeogeo_audit_jobs%rowtype;
begin
 select user_id into u from public.aeogeo_audit_jobs where id=p_job_id;
 if not found then return; end if;
 -- Same account-first lock order as the reservation function.
 perform 1 from public.aeogeo_audit_accounts where user_id=u for update;
 select * into j from public.aeogeo_audit_jobs where id=p_job_id for update;
 if j.status not in ('queued','running') then return; end if;
 update public.aeogeo_audit_jobs set status='failed',error_message=left(p_error,400),finished_at=now() where id=p_job_id;
 update public.aeogeo_audit_accounts set free_audit_consumed_at=null where user_id=u and free_audit_consumed_at=j.reserved_at;
end; $$;
revoke all on function public.aeogeo_reserve_free_audit(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.aeogeo_fail_audit(uuid,text) from public,anon,authenticated;
grant execute on function public.aeogeo_reserve_free_audit(uuid,uuid,text) to service_role;
grant execute on function public.aeogeo_fail_audit(uuid,text) to service_role;
commit;
