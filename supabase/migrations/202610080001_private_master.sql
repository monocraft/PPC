-- Only the Edge gateway and trusted publisher can reach these records.
create schema if not exists ppc_private;
revoke all on schema ppc_private from public, anon, authenticated;
grant usage on schema ppc_private to service_role;

create table if not exists ppc_private.master_state (
  singleton boolean primary key default true check (singleton),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  storage_revision bigint not null check (storage_revision > 0 and storage_revision < 9007199254740991),
  source_sha text not null check (source_sha ~ '^[a-f0-9]{40}$'),
  bootstrap_fingerprint text not null,
  requested_revision bigint not null,
  published_revision bigint not null default 0,
  github_sha text not null default '',
  publication_error text not null default '',
  published_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  check (published_revision >= 0 and published_revision <= requested_revision),
  check (requested_revision = storage_revision)
);

create table if not exists ppc_private.master_receipts (
  session_id text not null,
  request_id text not null,
  fingerprint text not null,
  storage_revision bigint not null,
  saved_fields integer not null,
  saved_products integer not null,
  accepted_at timestamptz not null default clock_timestamp(),
  primary key (session_id, request_id)
);

create table if not exists ppc_private.master_presence (
  session_id text primary key,
  display_name text not null default '',
  category_id text not null default '',
  product_id text not null default '',
  editing boolean not null default false,
  touched_at timestamptz not null default clock_timestamp()
);
alter table ppc_private.master_presence add column if not exists category_id text not null default '';
create index if not exists master_presence_expiry on ppc_private.master_presence(touched_at);

create table if not exists ppc_private.master_rate_limits (
  bucket text primary key,
  window_start timestamptz not null,
  attempts integer not null
);
create index if not exists master_rate_expiry on ppc_private.master_rate_limits(window_start);

alter table ppc_private.master_state enable row level security;
alter table ppc_private.master_receipts enable row level security;
alter table ppc_private.master_presence enable row level security;
alter table ppc_private.master_rate_limits enable row level security;
revoke all on all tables in schema ppc_private from public, anon, authenticated;
grant all on all tables in schema ppc_private to service_role;

create or replace function ppc_private.state_document(state ppc_private.master_state)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'manifest', state.manifest,
    'storageRevision', state.storage_revision,
    'revision', state.storage_revision,
    'sourceSha', state.source_sha,
    'publication', jsonb_build_object(
      'requestedRevision', state.requested_revision,
      'publishedRevision', state.published_revision,
      'status', case when state.published_revision >= state.requested_revision then 'current'
                     when state.publication_error <> '' then 'error' else 'pending' end,
      'error', state.publication_error,
      'githubSha', state.github_sha,
      'publishedAt', state.published_at
    )
  );
$$;

create or replace function public.ppc_master_read(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  -- One MVCC snapshot must cover receipt and state. Otherwise a replay could
  -- miss a newly committed receipt and incorrectly conflict with a later edit.
  select ppc_private.state_document(state) || case when receipt.request_id is null then '{}'::jsonb
    else jsonb_build_object('receipt', jsonb_build_object(
      'fingerprint',receipt.fingerprint,'storageRevision',receipt.storage_revision,
      'savedFields',receipt.saved_fields,'savedProducts',receipt.saved_products)) end
    into result from ppc_private.master_state state
    left join ppc_private.master_receipts receipt
      on receipt.session_id=payload->>'sessionId' and receipt.request_id=payload->>'requestId'
    where state.singleton;
  if not found then return jsonb_build_object('status','uninitialized'); end if;
  return result;
end;
$$;

create or replace function public.ppc_master_bootstrap(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare state ppc_private.master_state; inserted integer;
begin
  if jsonb_typeof(payload->'manifest') is distinct from 'object'
     or octet_length((payload->'manifest')::text) > 4194304
     or (payload->>'sourceSha') is null or (payload->>'sourceSha') !~ '^[a-f0-9]{40}$'
     or (payload->>'fingerprint') is null or (payload->>'fingerprint') !~ '^[a-f0-9]{64}$'
  then raise exception 'Invalid bootstrap request'; end if;
  insert into ppc_private.master_state(singleton,manifest,storage_revision,source_sha,bootstrap_fingerprint,
    requested_revision,published_revision,github_sha)
    values(true,payload->'manifest',1,payload->>'sourceSha',payload->>'fingerprint',1,0,payload->>'sourceSha')
    on conflict(singleton) do nothing;
  get diagnostics inserted = row_count;
  select * into state from ppc_private.master_state where singleton;
  if state.bootstrap_fingerprint <> payload->>'fingerprint' then
    return jsonb_build_object('status','already_initialized');
  end if;
  return ppc_private.state_document(state) || jsonb_build_object('status',case when inserted=1 then 'initialized' else 'already_seeded' end);
end;
$$;

create or replace function public.ppc_master_commit(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare state ppc_private.master_state; receipt ppc_private.master_receipts; changed boolean;
begin
  if coalesce(payload->>'sessionId','') !~ '^[A-Za-z0-9_-]{8,128}$'
     or coalesce(payload->>'requestId','') !~ '^[A-Za-z0-9_-]{8,128}$'
     or coalesce(payload->>'fingerprint','') !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(payload->'manifest') is distinct from 'object'
     or octet_length((payload->'manifest')::text) > 4194304
  then raise exception 'Invalid commit request'; end if;
  select * into state from ppc_private.master_state where singleton for update;
  if not found then return jsonb_build_object('status','uninitialized'); end if;
  select * into receipt from ppc_private.master_receipts
    where session_id = payload->>'sessionId' and request_id = payload->>'requestId';
  if found then
    if receipt.fingerprint <> payload->>'fingerprint' then return jsonb_build_object('status','request_mismatch'); end if;
    return ppc_private.state_document(state) || jsonb_build_object('status','already_saved','savedFields',receipt.saved_fields,'savedProducts',receipt.saved_products);
  end if;
  if state.storage_revision <> (payload->>'expectedRevision')::bigint then
    return ppc_private.state_document(state) || jsonb_build_object('status','raced');
  end if;
  changed := coalesce((payload->>'changed')::boolean,false);
  if changed then
    if state.storage_revision >= 9007199254740990 then raise exception 'Revision exhausted'; end if;
    update ppc_private.master_state set manifest=payload->'manifest',storage_revision=storage_revision+1,
      requested_revision=storage_revision+1,publication_error='',updated_at=clock_timestamp()
      where singleton returning * into state;
  end if;
  insert into ppc_private.master_receipts(session_id,request_id,fingerprint,storage_revision,saved_fields,saved_products)
    values(payload->>'sessionId',payload->>'requestId',payload->>'fingerprint',state.storage_revision,
      greatest(0,(payload->>'savedFields')::integer),greatest(0,(payload->>'savedProducts')::integer));
  return ppc_private.state_document(state) || jsonb_build_object('status','saved',
    'savedFields',(payload->>'savedFields')::integer,'savedProducts',(payload->>'savedProducts')::integer);
end;
$$;

create or replace function public.ppc_master_rate(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_window timestamptz; rate_count integer; window_seconds integer; maximum integer;
begin
  window_seconds := least(3600,greatest(1,(payload->>'windowSeconds')::integer));
  maximum := least(10000,greatest(1,(payload->>'maximum')::integer));
  if coalesce(payload->>'bucket','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid rate bucket'; end if;
  current_window := to_timestamp(floor(extract(epoch from clock_timestamp())/window_seconds)*window_seconds);
  insert into ppc_private.master_rate_limits(bucket,window_start,attempts)
    values(payload->>'bucket',current_window,1)
    on conflict(bucket) do update set
      attempts=case when ppc_private.master_rate_limits.window_start=current_window then ppc_private.master_rate_limits.attempts+1 else 1 end,
      window_start=current_window
    returning attempts into rate_count;
  -- Bounded opportunistic cleanup avoids an unbounded public-IP bucket table.
  delete from ppc_private.master_rate_limits where bucket in (
    select bucket from ppc_private.master_rate_limits where window_start < clock_timestamp()-interval '2 hours' limit 200);
  return jsonb_build_object('allowed',rate_count <= maximum,'retryAfter',window_seconds);
end;
$$;

create or replace function public.ppc_master_presence(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare roster jsonb; count_sessions integer;
begin
  if coalesce(payload->>'sessionId','') !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'Invalid presence session'; end if;
  delete from ppc_private.master_presence where touched_at <= clock_timestamp()-interval '65 seconds';
  if coalesce((payload->>'leave')::boolean,false) then
    delete from ppc_private.master_presence where session_id=payload->>'sessionId';
  else
    -- The bounded roster makes anonymous shared-name presence predictable.
    perform pg_advisory_xact_lock(78307412);
    select count(*) into count_sessions from ppc_private.master_presence;
    if count_sessions >= 256 and not exists(select 1 from ppc_private.master_presence where session_id=payload->>'sessionId') then
      return jsonb_build_object('status','full');
    end if;
    insert into ppc_private.master_presence(session_id,display_name,category_id,product_id,editing,touched_at)
      values(payload->>'sessionId',left(coalesce(payload->>'displayName',''),60),left(coalesce(payload->>'categoryId',''),180),left(coalesce(payload->>'productId',''),180),
        coalesce((payload->>'editing')::boolean,false),clock_timestamp())
      on conflict(session_id) do update set display_name=excluded.display_name,category_id=excluded.category_id,product_id=excluded.product_id,
        editing=excluded.editing,touched_at=excluded.touched_at;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('sessionId',session_id,'displayName',display_name,
    'categoryId',category_id,'productId',product_id,'editing',editing,'lastSeenAt',touched_at) order by touched_at desc),'[]'::jsonb)
    into roster from ppc_private.master_presence where touched_at > clock_timestamp()-interval '65 seconds';
  return jsonb_build_object('sessions',roster,'users',roster,'onlineCount',jsonb_array_length(roster),'ttlSeconds',65);
end;
$$;

create or replace function public.ppc_master_ack(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare state ppc_private.master_state; revision bigint;
begin
  revision := (payload->>'storageRevision')::bigint;
  if coalesce(payload->>'githubSha','') !~ '^[a-f0-9]{40}$' or revision < 1 then raise exception 'Invalid publication receipt'; end if;
  select * into state from ppc_private.master_state where singleton for update;
  if not found then return jsonb_build_object('status','uninitialized'); end if;
  if revision > state.storage_revision then return jsonb_build_object('status','invalid_revision'); end if;
  if revision < state.published_revision then return jsonb_build_object('status','stale_revision'); end if;
  if revision >= state.published_revision then
    update ppc_private.master_state set published_revision=revision,github_sha=payload->>'githubSha',
      published_at=clock_timestamp(),publication_error='' where singleton returning * into state;
  end if;
  return ppc_private.state_document(state) || jsonb_build_object('status','acknowledged');
end;
$$;

create or replace function public.ppc_master_failure(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare state ppc_private.master_state; revision bigint;
begin
  revision := (payload->>'storageRevision')::bigint;
  select * into state from ppc_private.master_state where singleton for update;
  if not found then return jsonb_build_object('status','uninitialized'); end if;
  if revision > state.published_revision and revision <= state.requested_revision then
    update ppc_private.master_state set publication_error='The GitHub package update is waiting to retry.'
      where singleton returning * into state;
  end if;
  return ppc_private.state_document(state) || jsonb_build_object('status','recorded');
end;
$$;

revoke all on function ppc_private.state_document(ppc_private.master_state) from public, anon, authenticated;
revoke all on function public.ppc_master_read(jsonb) from public, anon, authenticated;
revoke all on function public.ppc_master_bootstrap(jsonb) from public, anon, authenticated;
revoke all on function public.ppc_master_commit(jsonb) from public, anon, authenticated;
revoke all on function public.ppc_master_rate(jsonb) from public, anon, authenticated;
revoke all on function public.ppc_master_presence(jsonb) from public, anon, authenticated;
revoke all on function public.ppc_master_ack(jsonb) from public, anon, authenticated;
revoke all on function public.ppc_master_failure(jsonb) from public, anon, authenticated;
grant execute on function public.ppc_master_read(jsonb) to service_role;
grant execute on function public.ppc_master_bootstrap(jsonb) to service_role;
grant execute on function public.ppc_master_commit(jsonb) to service_role;
grant execute on function public.ppc_master_rate(jsonb) to service_role;
grant execute on function public.ppc_master_presence(jsonb) to service_role;
grant execute on function public.ppc_master_ack(jsonb) to service_role;
grant execute on function public.ppc_master_failure(jsonb) to service_role;

-- No email/password or anonymous Supabase signup is needed. The Edge gateway
-- verifies the same package unlock key before invoking these restricted RPCs.
