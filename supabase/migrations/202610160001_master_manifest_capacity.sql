-- Increase only the stored JSONB manifest ceiling to 8 MiB.
-- Preserve existing private permissions, CAS, receipts and publication state.
-- Return a typed capacity failure before any master state or receipt mutation.
create or replace function public.ppc_master_bootstrap(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare state ppc_private.master_state; inserted integer;
begin
  if jsonb_typeof(payload->'manifest') is distinct from 'object'
     or (payload->>'sourceSha') is null or (payload->>'sourceSha') !~ '^[a-f0-9]{40}$'
     or (payload->>'fingerprint') is null or (payload->>'fingerprint') !~ '^[a-f0-9]{64}$'
  then raise exception 'Invalid bootstrap request'; end if;
  if octet_length((payload->'manifest')::text) > 8388608 then
    return jsonb_build_object('status','manifest_too_large');
  end if;
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
  then raise exception 'Invalid commit request'; end if;
  if octet_length((payload->'manifest')::text) > 8388608 then
    return jsonb_build_object('status','manifest_too_large');
  end if;
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
