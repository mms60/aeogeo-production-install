-- Define the recovery RPC that product-api and start-audit already call.
-- product-api calls it before showing account eligibility or polling a report, with p_user only.
-- start-audit calls it after a failed background dispatch with p_undispatched, then reads job_status.
-- Requires migration 16 for the scan counters.
begin;

create or replace function public.geo_recover_audit_jobs(p_user uuid,p_undispatched uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.geo_jobs%rowtype;result text;
begin
 perform 1 from public.aeogeo_audit_accounts where user_id=p_user for update;
 if not found then raise exception 'Account missing';end if;
 -- Interrupted jobs past the background ceiling: fail them and restore their reservations.
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
 -- Same recovery for the earlier standalone tool's jobs, without restoring a completed free audit.
 update public.aeogeo_audit_accounts set free_audit_consumed_at=null where user_id=p_user and free_audit_consumed_at in (select reserved_at from public.aeogeo_audit_jobs where user_id=p_user and status in ('queued','running') and reserved_at<now()-interval '20 minutes');
 update public.aeogeo_audit_jobs set status='failed',finished_at=now(),error_message='Job interrupted; reservation recovered by product audit.' where user_id=p_user and status in ('queued','running') and reserved_at<now()-interval '20 minutes';
 -- A failed dispatch may only cancel a job no worker has claimed yet.
 if p_undispatched is not null then
  select * into j from public.geo_jobs where id=p_undispatched and user_id=p_user for update;
  if found then
   if j.status='queued' then
    update public.geo_jobs set status='failed',finished_at=now(),error_message='The audit could not be dispatched. Its unused reservation was restored.' where id=j.id;
    if j.credit_source='free' then
     update public.aeogeo_audit_accounts set free_audit_consumed_at=null where user_id=p_user and free_audit_consumed_at=j.created_at;
    else
     update public.geo_usage_periods set reserved_pages=greatest(0,reserved_pages-j.reserved_pages),
      scans_reserved=greatest(0,scans_reserved-case when j.scan_reserved then 1 else 0 end)
      where user_id=p_user and period_start=j.period_start;
    end if;
    result:='failed';
   else
    result:=j.status;
   end if;
  end if;
 end if;
 return jsonb_build_object('job_status',result);
end; $$;

revoke all on function public.geo_recover_audit_jobs(uuid,uuid) from public,anon,authenticated;
grant execute on function public.geo_recover_audit_jobs(uuid,uuid) to service_role;
commit;
