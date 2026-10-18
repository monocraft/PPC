-- Optional ASCM work cue. No mail, product identities, names or error history.
-- Both this private policy and the Edge status environment flag default off.
begin;

create table if not exists ppc_private.ascm_supervisor_status_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false
);
insert into ppc_private.ascm_supervisor_status_config(singleton) values (true)
  on conflict (singleton) do nothing;
create table if not exists ppc_private.ascm_supervisor_runs (
  lease_id uuid primary key,
  started_at timestamptz not null,
  expires_at timestamptz not null,
  product_count integer check (product_count between 0 and 500),
  check (expires_at > started_at and expires_at <= started_at + interval '120 seconds')
);
alter table ppc_private.ascm_supervisor_status_config enable row level security;
alter table ppc_private.ascm_supervisor_runs enable row level security;
revoke all on ppc_private.ascm_supervisor_status_config, ppc_private.ascm_supervisor_runs
  from public, anon, authenticated, service_role, supabase_auth_admin;

create or replace function public.ppc_master_ascm_status(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '1s' as $$
declare
  phase text := payload->>'phase';
  lease uuid;
  now_at timestamptz;
  changed integer;
  next_count integer;
begin
  if jsonb_typeof(payload) is distinct from 'object'
    or jsonb_typeof(payload->'phase') is distinct from 'string'
    or phase not in ('begin','plan','end')
    or jsonb_typeof(payload->'leaseId') is distinct from 'string'
    or coalesce(payload->>'leaseId','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    or exists(select 1 from jsonb_object_keys(payload) as entry(key) where key not in ('phase','leaseId','productCount'))
    or (phase <> 'plan' and payload ? 'productCount') then
    raise exception 'Invalid ASCM status';
  end if;
  if phase='plan' then
    if jsonb_typeof(payload->'productCount') is distinct from 'number'
      or coalesce(payload->>'productCount','') !~ '^[0-9]{1,3}$'
      or (payload->>'productCount')::integer > 500 then
      raise exception 'Invalid ASCM status';
    end if;
    next_count := (payload->>'productCount')::integer;
  end if;
  lease := (payload->>'leaseId')::uuid;
  perform pg_advisory_xact_lock(78307414);
  now_at := clock_timestamp();
  -- End only this attempt even if the owner disabled new status in the interim.
  if phase='end' then
    delete from ppc_private.ascm_supervisor_runs where lease_id=lease;
    return jsonb_build_object('status','ended');
  end if;
  if not coalesce((select enabled from ppc_private.ascm_supervisor_status_config where singleton),false) then
    return jsonb_build_object('status','disabled');
  end if;
  if phase='begin' then
    delete from ppc_private.ascm_supervisor_runs where expires_at <= now_at;
    if exists(select 1 from ppc_private.ascm_supervisor_runs where lease_id=lease) then
      return jsonb_build_object('status','exists');
    end if;
    if (select count(*) from ppc_private.ascm_supervisor_runs) >= 64 then
      return jsonb_build_object('status','full');
    end if;
    insert into ppc_private.ascm_supervisor_runs(lease_id,started_at,expires_at,product_count)
      values(lease,now_at,now_at+interval '120 seconds',null);
    return jsonb_build_object('status','started');
  end if;
  update ppc_private.ascm_supervisor_runs set product_count=next_count
    where lease_id=lease and expires_at > now_at;
  get diagnostics changed = row_count;
  return jsonb_build_object('status',case when changed=1 then 'updated' else 'expired' end);
end;
$$;
revoke all on function public.ppc_master_ascm_status(jsonb) from public, anon, authenticated, supabase_auth_admin;
grant execute on function public.ppc_master_ascm_status(jsonb) to service_role;

create or replace function ppc_private.ascm_supervisor_snapshot()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare active_count integer; known_count integer; expires timestamptz;
begin
  if not coalesce((select enabled from ppc_private.ascm_supervisor_status_config where singleton),false) then
    return null;
  end if;
  select count(*),max(product_count),max(expires_at) into active_count,known_count,expires
    from ppc_private.ascm_supervisor_runs where expires_at > clock_timestamp();
  return jsonb_build_object('enabled',true,'working',active_count>0,
    'productCount',case when active_count=1 then known_count else null end,
    'expiresAt',case when expires is null then null else to_char(expires at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end);
end;
$$;
revoke all on function ppc_private.ascm_supervisor_snapshot() from public, anon, authenticated, service_role, supabase_auth_admin;

-- Keep the exact human roster/poke implementation and add the cue in its
-- existing response. No new client call, session, roster entry or human count.
do $$
begin
  if to_regprocedure('ppc_private.master_presence_without_ascm(jsonb)') is null then
    alter function public.ppc_master_presence(jsonb) set schema ppc_private;
    alter function ppc_private.ppc_master_presence(jsonb) rename to master_presence_without_ascm;
  end if;
end;
$$;
revoke all on function ppc_private.master_presence_without_ascm(jsonb) from public, anon, authenticated, service_role, supabase_auth_admin;
create or replace function public.ppc_master_presence(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; supervisor jsonb;
begin
  result := ppc_private.master_presence_without_ascm(payload);
  if payload->'includeAscmSupervisor'='true'::jsonb then
    -- Status is optional telemetry. A failure must not break human presence.
    begin
      supervisor := ppc_private.ascm_supervisor_snapshot();
      if supervisor is not null then result := result || jsonb_build_object('ascmSupervisor',supervisor); end if;
    exception when others then null;
    end;
  end if;
  return result;
end;
$$;
revoke all on function public.ppc_master_presence(jsonb) from public, anon, authenticated, supabase_auth_admin;
grant execute on function public.ppc_master_presence(jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
