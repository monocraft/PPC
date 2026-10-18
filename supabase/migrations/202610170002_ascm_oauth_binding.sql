-- Optional managed-Auth binding for the owner-only ASCM MCP client.
-- Installing this migration does not enable OAuth or authorize a client.
begin;

create table if not exists ppc_private.ascm_oauth_policy (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  owner_id uuid,
  client_id uuid,
  resource text,
  constraint ascm_oauth_resource check (
    resource is null or resource ~ '^https://[a-z0-9]{20}[.]supabase[.]co/functions/v1/ppc-ascm-mcp/mcp$'
  ),
  constraint ascm_oauth_complete check (
    not enabled or (owner_id is not null and client_id is not null and resource is not null)
  )
);

insert into ppc_private.ascm_oauth_policy(singleton) values (true)
on conflict (singleton) do nothing;
alter table ppc_private.ascm_oauth_policy enable row level security;
revoke all on ppc_private.ascm_oauth_policy from public, anon, authenticated, service_role, supabase_auth_admin;
grant usage on schema ppc_private to supabase_auth_admin;
grant select on ppc_private.ascm_oauth_policy to supabase_auth_admin;
drop policy if exists ascm_auth_reads_policy on ppc_private.ascm_oauth_policy;
create policy ascm_auth_reads_policy on ppc_private.ascm_oauth_policy
  for select to supabase_auth_admin using (true);

create or replace function public.ppc_ascm_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  original_claims jsonb := event -> 'claims';
  binding ppc_private.ascm_oauth_policy%rowtype;
begin
  if jsonb_typeof(original_claims) is distinct from 'object' then
    raise exception 'The ASCM connection is not authorized.' using errcode = '28000';
  end if;
  select * into binding from ppc_private.ascm_oauth_policy where singleton;
  if binding.enabled and original_claims ->> 'client_id' = binding.client_id::text then
    -- Match both canonical managed-Auth identity fields. Never infer an owner
    -- from email or metadata supplied by an OAuth client.
    if original_claims ->> 'sub' is distinct from binding.owner_id::text
      or event ->> 'user_id' is distinct from binding.owner_id::text
      or original_claims ->> 'role' is distinct from 'authenticated'
      or original_claims ->> 'is_anonymous' is distinct from 'false'
      or (event ? 'client_id' and event ->> 'client_id' is distinct from binding.client_id::text)
    then
      raise exception 'The ASCM connection is not authorized.' using errcode = '28000';
    end if;
    -- Refresh carries the same client_id; binding is checked on every issuance,
    -- regardless of authentication_method. Other clients and normal sign-ins
    -- retain every original claim, including their original audience.
    original_claims := jsonb_set(original_claims, '{aud}', to_jsonb(binding.resource));
  end if;
  return jsonb_build_object('claims', original_claims);
end;
$$;

revoke all on function public.ppc_ascm_access_token_hook(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.ppc_ascm_access_token_hook(jsonb) to supabase_auth_admin;

commit;
