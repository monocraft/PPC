-- Fenced restart for a reservation that provably has no active writer.
-- Preserve all existing RPC shapes, execute grants, metadata, receipts and caps.
begin;

create or replace function public.ppc_package_reserve(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s ppc_private.master_state; d ppc_private.package_delivery_state; c ppc_private.package_delivery_candidates; retired ppc_private.package_delivery_candidates; candidate_uuid uuid; reservation_kind text; moment timestamptz;
begin
  if jsonb_typeof(payload) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(payload) k where k not in ('candidateId','expectedGeneration','storageRevision','sourceSha','manifestSha256','ownerImagesCommit','sha256','bytes','trustedGithubSha'))
    or not payload ?& array['candidateId','expectedGeneration','storageRevision','sourceSha','manifestSha256','ownerImagesCommit','sha256','bytes']
    or coalesce(payload->>'candidateId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    or jsonb_typeof(payload->'expectedGeneration') is distinct from 'number' or coalesce(payload->>'expectedGeneration','') !~ '^[0-9]{1,16}$'
    or (payload->>'expectedGeneration')::bigint>=9007199254740990
    or jsonb_typeof(payload->'storageRevision') is distinct from 'number' or coalesce(payload->>'storageRevision','') !~ '^[1-9][0-9]{0,15}$'
    or (payload->>'storageRevision')::bigint>=9007199254740991
    or jsonb_typeof(payload->'bytes') is distinct from 'number' or coalesce(payload->>'bytes','') !~ '^[0-9]{2,8}$'
    or (payload->>'bytes')::bigint not between 36 and 67108864
    or jsonb_typeof(payload->'sourceSha') is distinct from 'string' or coalesce(payload->>'sourceSha','') !~ '^[a-f0-9]{40}$'
    or jsonb_typeof(payload->'sha256') is distinct from 'string' or coalesce(payload->>'sha256','') !~ '^[a-f0-9]{64}$'
    or (payload->'manifestSha256'<>'null'::jsonb and (jsonb_typeof(payload->'manifestSha256') is distinct from 'string' or coalesce(payload->>'manifestSha256','') !~ '^[a-f0-9]{64}$'))
    or (payload->'ownerImagesCommit'<>'null'::jsonb and (jsonb_typeof(payload->'ownerImagesCommit') is distinct from 'string' or coalesce(payload->>'ownerImagesCommit','') !~ '^[a-f0-9]{40}$'))
    then raise exception 'Invalid package reservation'; end if;
  select * into s from ppc_private.master_state where singleton for update;
  if not found then return jsonb_build_object('status','uninitialized'); end if;
  perform 1 from ppc_private.package_delivery_state where singleton for update;
  perform ppc_private.package_expire();
  select * into d from ppc_private.package_delivery_state where singleton;
  if d.phase='legacy' then return jsonb_build_object('status','disabled'); end if;
  if (payload->>'expectedGeneration')::bigint<>d.generation then return jsonb_build_object('status','stale'); end if;
  if d.cleanup_id is not null then return jsonb_build_object('status','cleanup_required'); end if;
  candidate_uuid:=(payload->>'candidateId')::uuid;
  select * into c from ppc_private.package_delivery_candidates where candidate_id=candidate_uuid for update;
  if found then
    if c.candidate_id is distinct from d.queued_id then return jsonb_build_object('status','stale'); end if;
    if c.expected_generation::text is distinct from payload->>'expectedGeneration' or c.storage_revision::text is distinct from payload->>'storageRevision'
      or c.source_sha is distinct from payload->>'sourceSha' or c.manifest_sha256 is distinct from payload->>'manifestSha256'
      or c.owner_images_commit is distinct from payload->>'ownerImagesCommit' or c.sha256 is distinct from payload->>'sha256'
      or c.bytes::text is distinct from payload->>'bytes'
      or (c.kind='seed' and d.seed->>'githubSha' is distinct from payload->>'trustedGithubSha')
      then return jsonb_build_object('status','retry_mismatch'); end if;
    return jsonb_build_object('status','existing','candidate',ppc_private.package_candidate(c));
  end if;
  reservation_kind:=case when d.phase='seeding' then 'seed' else 'publication' end;
  if reservation_kind='seed' then
    if d.current_id is not null or payload->'manifestSha256'<>'null'::jsonb or payload->'ownerImagesCommit'<>'null'::jsonb
      or d.seed->>'storageRevision' is distinct from payload->>'storageRevision' or d.seed->>'sourceSha' is distinct from payload->>'sourceSha'
      or d.seed->>'githubSha' is distinct from payload->>'trustedGithubSha' or d.seed->>'sha256' is distinct from payload->>'sha256'
      or d.seed->>'bytes' is distinct from payload->>'bytes' or s.published_revision::text is distinct from d.seed->>'storageRevision'
      or s.github_sha is distinct from d.seed->>'githubSha' or s.source_sha is distinct from d.seed->>'sourceSha'
      then return jsonb_build_object('status','seed_mismatch'); end if;
  else
    if payload ? 'trustedGithubSha' then raise exception 'Invalid package reservation'; end if;
    if s.storage_revision::text is distinct from payload->>'storageRevision' or s.source_sha is distinct from payload->>'sourceSha'
      or encode(sha256(convert_to(s.manifest::text,'UTF8')),'hex') is distinct from payload->>'manifestSha256'
      then return jsonb_build_object('status','accepted_changed'); end if;
  end if;
  -- Validate the replacement against the locked accepted export before touching
  -- the old identity. Claims take the same master/delivery/candidate lock order.
  if d.queued_id is not null then
    select * into retired from ppc_private.package_delivery_candidates where candidate_id=d.queued_id for update;
    if not found or retired.status<>'reserved' or retired.upload_state not in ('none','absent')
      then return jsonb_build_object('status','busy'); end if;
    -- none has never opened Storage; absent was settled by its owning handler
    -- or an operator. Retain immutable metadata and fence all later old claims.
    update ppc_private.package_delivery_candidates set status='cleanup' where candidate_id=retired.candidate_id;
  end if;
  moment:=clock_timestamp();
  insert into ppc_private.package_delivery_candidates(candidate_id,kind,generation,expected_generation,storage_revision,source_sha,manifest_sha256,owner_images_commit,sha256,bytes,created_at,expires_at)
    values(candidate_uuid,reservation_kind,d.generation+1,d.generation,(payload->>'storageRevision')::bigint,payload->>'sourceSha',payload->>'manifestSha256',payload->>'ownerImagesCommit',payload->>'sha256',(payload->>'bytes')::bigint,moment,moment+interval '3 hours') returning * into c;
  update ppc_private.package_delivery_state set queued_id=c.candidate_id where singleton;
  return jsonb_build_object('status','reserved','candidate',ppc_private.package_candidate(c));
end;
$$;

create or replace function public.ppc_package_upload_claim(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d ppc_private.package_delivery_state; c ppc_private.package_delivery_candidates;
begin
  if jsonb_typeof(payload) is distinct from 'object' or (select count(*) from jsonb_object_keys(payload))<>2
    or not payload ?& array['candidateId','generation'] or jsonb_typeof(payload->'generation') is distinct from 'number' then raise exception 'Invalid upload claim'; end if;
  perform 1 from ppc_private.master_state where singleton for update;
  select * into d from ppc_private.package_delivery_state where singleton for update;
  select * into c from ppc_private.package_delivery_candidates where candidate_id::text=payload->>'candidateId' for update;
  if not found or d.phase='legacy' or c.candidate_id is distinct from d.queued_id or c.generation::text is distinct from payload->>'generation' then return jsonb_build_object('status','stale'); end if;
  if c.expires_at<=clock_timestamp() then perform ppc_private.package_expire(); return jsonb_build_object('status','expired'); end if;
  if c.status<>'reserved' then return jsonb_build_object('status','closed'); end if;
  if c.upload_state not in ('none','absent') then return jsonb_build_object('status','upload_busy'); end if;
  update ppc_private.package_delivery_candidates set attempt_id=gen_random_uuid(),upload_state='uploading' where candidate_id=c.candidate_id returning * into c;
  return jsonb_build_object('status','claimed','candidate',ppc_private.package_candidate(c),'attemptId',c.attempt_id);
end;
$$;

notify pgrst,'reload schema';
commit;
