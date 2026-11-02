-- Completed SharePoint checks are private diagnostics, separate from accepted
-- ASCM imports, provider connection flags, active leases and publication state.
begin;

alter table ppc_private.ascm_supervisor_status_config
  add column if not exists last_check_id uuid,
  add column if not exists last_checked_at timestamptz,
  add column if not exists check_outcome text;
do $$
begin
  if not exists(select 1 from pg_constraint
    where conrelid='ppc_private.ascm_supervisor_status_config'::regclass
      and conname='ascm_supervisor_completed_check_pair') then
    alter table ppc_private.ascm_supervisor_status_config
      add constraint ascm_supervisor_completed_check_pair check (
        (last_check_id is null and last_checked_at is null and check_outcome is null)
        or (last_check_id is not null and last_checked_at is not null and check_outcome is not null
          and check_outcome in ('unchanged','staged')));
  end if;
end;
$$;

create or replace function public.ppc_master_ascm_connection(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '1s' as $$
declare
  target_service text;
  connection_state text;
  required boolean;
  completed_check jsonb;
  check_id uuid;
  completed_at timestamptz;
  outcome text;
  binding ppc_private.ascm_supervisor_status_config%rowtype;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'Invalid ASCM connection state';
  end if;
  if jsonb_typeof(payload->'service') is distinct from 'string'
    or (select count(*) from jsonb_object_keys(payload)) <> 2 then
    raise exception 'Invalid ASCM connection state';
  end if;
  target_service := payload->>'service';
  if payload ? 'check' then
    completed_check := payload->'check';
    if target_service <> 'sharepoint' or jsonb_typeof(completed_check) is distinct from 'object' then
      raise exception 'Invalid ASCM connection state';
    end if;
    if (select count(*) from jsonb_object_keys(completed_check)) <> 3
      or exists(select 1 from jsonb_object_keys(completed_check) as entry(key) where key not in ('checkId','completedAt','outcome'))
      or jsonb_typeof(completed_check->'checkId') is distinct from 'string'
      or coalesce(completed_check->>'checkId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      or jsonb_typeof(completed_check->'completedAt') is distinct from 'string'
      or coalesce(completed_check->>'completedAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
      or jsonb_typeof(completed_check->'outcome') is distinct from 'string'
      or coalesce(completed_check->>'outcome','') not in ('unchanged','staged') then
      raise exception 'Invalid ASCM connection state';
    end if;
    check_id := (completed_check->>'checkId')::uuid;
    outcome := completed_check->>'outcome';
    begin
      completed_at := (completed_check->>'completedAt')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Invalid ASCM connection state';
    end;
    if to_char(completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> completed_check->>'completedAt'
      or completed_at > clock_timestamp() then
      raise exception 'Invalid ASCM connection state';
    end if;
  else
    if jsonb_typeof(payload->'state') is distinct from 'string'
      or exists(select 1 from jsonb_object_keys(payload) as entry(key) where key not in ('service','state')) then
      raise exception 'Invalid ASCM connection state';
    end if;
    connection_state := payload->>'state';
    if target_service not in ('outlook','sharepoint') or connection_state not in ('available','reconnect_required') then
      raise exception 'Invalid ASCM connection state';
    end if;
  end if;

  -- Serialize advancement and conflict checks on the existing private singleton.
  select * into binding from ppc_private.ascm_supervisor_status_config where singleton for update;
  if not coalesce(binding.enabled,false) then return jsonb_build_object('reported',false); end if;
  if completed_check is not null then
    if binding.last_check_id=check_id then
      if binding.last_checked_at is distinct from completed_at or binding.check_outcome is distinct from outcome then
        raise exception 'Invalid ASCM connection state';
      end if;
      return jsonb_build_object('reported',true);
    end if;
    if binding.last_checked_at=completed_at then
      raise exception 'Invalid ASCM connection state';
    end if;
    if binding.last_checked_at > completed_at then return jsonb_build_object('reported',true); end if;
    update ppc_private.ascm_supervisor_status_config
      set last_check_id=check_id,last_checked_at=completed_at,check_outcome=outcome where singleton;
    return jsonb_build_object('reported',true);
  end if;

  required := connection_state='reconnect_required';
  if target_service='outlook' and binding.outlook_reconnect_required is distinct from required then
    update ppc_private.ascm_supervisor_status_config set outlook_reconnect_required=required where singleton;
  elsif target_service='sharepoint' and binding.sharepoint_reconnect_required is distinct from required then
    update ppc_private.ascm_supervisor_status_config set sharepoint_reconnect_required=required where singleton;
  end if;
  return jsonb_build_object('reported',true);
end;
$$;
revoke all on function public.ppc_master_ascm_connection(jsonb) from public, anon, authenticated, supabase_auth_admin;
grant execute on function public.ppc_master_ascm_connection(jsonb) to service_role;

create or replace function ppc_private.ascm_supervisor_snapshot()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  active_count integer;
  known_count integer;
  expires timestamptz;
  binding ppc_private.ascm_supervisor_status_config%rowtype;
  reconnect text[] := array[]::text[];
  completed jsonb := '{}'::jsonb;
begin
  select * into binding from ppc_private.ascm_supervisor_status_config where singleton;
  if not coalesce(binding.enabled,false) then return null; end if;
  if binding.outlook_reconnect_required then reconnect := array_append(reconnect,'outlook'); end if;
  if binding.sharepoint_reconnect_required then reconnect := array_append(reconnect,'sharepoint'); end if;
  if binding.last_check_id is not null and binding.last_checked_at <= clock_timestamp()
    and binding.check_outcome in ('unchanged','staged') then
    completed := jsonb_build_object('lastCheckedAt',to_char(binding.last_checked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'checkOutcome',binding.check_outcome);
  end if;
  select count(*),max(product_count),max(expires_at) into active_count,known_count,expires
    from ppc_private.ascm_supervisor_runs where expires_at > clock_timestamp();
  return jsonb_build_object('enabled',true,'working',active_count>0,
    'productCount',case when active_count=1 then known_count else null end,
    'expiresAt',case when expires is null then null else to_char(expires at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'reconnectRequired',reconnect) || completed;
end;
$$;
revoke all on function ppc_private.ascm_supervisor_snapshot() from public, anon, authenticated, service_role, supabase_auth_admin;

notify pgrst, 'reload schema';
commit;
