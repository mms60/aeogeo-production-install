-- Shared, durable rate limit for the public free entity audit.
-- netlify/functions/entity-audit.mjs calls consume_audit_rate_limit() through
-- the service-role client. The function resets each window atomically, so
-- concurrent Netlify instances share one counter per hashed client key.

create table if not exists public.audit_rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  hits integer not null default 0
);

alter table public.audit_rate_limits enable row level security;
revoke all on public.audit_rate_limits from anon, authenticated;
grant all on public.audit_rate_limits to service_role;

create or replace function public.consume_audit_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_hits integer;
begin
  if p_key is null or length(p_key) < 8 or p_limit < 1 or p_window_seconds < 1 then
    return false;
  end if;

  insert into public.audit_rate_limits as limits (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update
    set hits = case
        when limits.window_start <= now() - make_interval(secs => p_window_seconds) then 1
        else limits.hits + 1
      end,
      window_start = case
        when limits.window_start <= now() - make_interval(secs => p_window_seconds) then now()
        else limits.window_start
      end
  returning limits.hits into current_hits;

  -- Keep the table small without a scheduled job. A rare opportunistic sweep
  -- removes windows that are no longer relevant to any caller.
  if random() < 0.01 then
    delete from public.audit_rate_limits
    where window_start < now() - interval '1 hour';
  end if;

  return current_hits <= p_limit;
end;
$$;

revoke all on function public.consume_audit_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_audit_rate_limit(text, integer, integer) to service_role;
