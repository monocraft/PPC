-- Reports originate from actual owner-authorized connector attempts. These
-- flags are diagnostics only: no token, raw error, URL, or access authority.
begin;

alter table ppc_private.ascm_supervisor_status_config
  add column if not exists outlook_reconnect_required boolean not null default false,
  add column if not exists sharepoint_reconnect_required boolean not null default false;

create or replace function public.ppc_master_ascm_connection(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '1s' as $$
declare
  target_service text;
  connection_state text;
  required boolean;
  binding ppc_private.ascm_supervisor_status_config%rowtype;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'Invalid ASCM connection state';
  end if;
  if jsonb_typeof(payload->'service') is distinct from 'string'
    or jsonb_typeof(payload->'state') is distinct from 'string'
    or (select count(*) from jsonb_object_keys(payload)) <> 2
    or exists(select 1 from jsonb_object_keys(payload) as entry(key) where key not in ('service','state')) then
    raise exception 'Invalid ASCM connection state';
  end if;
  target_service := payload->>'service';
  connection_state := payload->>'state';
  if target_service not in ('outlook','sharepoint') or connection_state not in ('available','reconnect_required') then
    raise exception 'Invalid ASCM connection state';
  end if;
  select * into binding from ppc_private.ascm_supervisor_status_config where singleton for update;
  if not coalesce(binding.enabled,false) then return jsonb_build_object('reported',false); end if;
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
begin
  select * into binding from ppc_private.ascm_supervisor_status_config where singleton;
  if not coalesce(binding.enabled,false) then return null; end if;
  if binding.outlook_reconnect_required then reconnect := array_append(reconnect,'outlook'); end if;
  if binding.sharepoint_reconnect_required then reconnect := array_append(reconnect,'sharepoint'); end if;
  select count(*),max(product_count),max(expires_at) into active_count,known_count,expires
    from ppc_private.ascm_supervisor_runs where expires_at > clock_timestamp();
  return jsonb_build_object('enabled',true,'working',active_count>0,
    'productCount',case when active_count=1 then known_count else null end,
    'expiresAt',case when expires is null then null else to_char(expires at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'reconnectRequired',reconnect);
end;
$$;
revoke all on function ppc_private.ascm_supervisor_snapshot() from public, anon, authenticated, service_role, supabase_auth_admin;

notify pgrst, 'reload schema';
commit;
