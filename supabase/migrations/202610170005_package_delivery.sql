-- Default-off encrypted delivery cache. No source-data replacement or live
-- access is performed by this migration. Lock order is master, then delivery.
begin;

do $$
begin
  if to_regclass('storage.buckets') is null then
    -- Local master-only installations remain usable in default legacy mode.
    -- Operator activation below requires compatible existing Storage.
    return;
  end if;
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
    values('ppc-package-delivery','ppc-package-delivery',false,67108864,array['application/octet-stream'])
    on conflict(id) do nothing;
  if not exists(select 1 from storage.buckets where id='ppc-package-delivery'
    and name='ppc-package-delivery' and public=false and file_size_limit=67108864
    and allowed_mime_types=array['application/octet-stream']::text[]) then
    raise exception 'Existing package delivery bucket requires operator review';
  end if;
  -- This migration grants no object policies. Operator phase activation below
  -- rejects unreviewed public/reader-role policies without altering them.
end;
$$;

create table if not exists ppc_private.package_delivery_state (
  singleton boolean primary key default true check(singleton),
  phase text not null default 'legacy' check(phase in ('legacy','seeding','sharepoint')),
  generation bigint not null default 0 check(generation>=0 and generation<9007199254740991),
  current_id uuid, queued_id uuid, cleanup_id uuid,
  drive_id text, folder_id text, seed jsonb,
  check(queued_id is null or cleanup_id is null),
  check(current_id is null or current_id is distinct from queued_id),
  check(current_id is null or current_id is distinct from cleanup_id)
);
insert into ppc_private.package_delivery_state(singleton) values(true) on conflict do nothing;

create table if not exists ppc_private.package_delivery_candidates (
  candidate_id uuid primary key,
  kind text not null check(kind in ('seed','publication')),
  generation bigint not null check(generation>0 and generation<9007199254740991),
  expected_generation bigint not null check(expected_generation>=0 and generation=expected_generation+1),
  storage_revision bigint not null check(storage_revision>0 and storage_revision<9007199254740991),
  source_sha text not null check(source_sha ~ '^[a-f0-9]{40}$'),
  manifest_sha256 text, owner_images_commit text,
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  bytes bigint not null check(bytes between 36 and 67108864),
  created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
  status text not null default 'reserved' check(status in ('reserved','ready','published','cleanup')),
  attempt_id uuid, upload_state text not null default 'none' check(upload_state in ('none','uploading','stored','absent','uncertain')),
  check((kind='seed' and manifest_sha256 is null and owner_images_commit is null)
    or (kind='publication' and manifest_sha256 ~ '^[a-f0-9]{64}$')),
  check(owner_images_commit is null or owner_images_commit ~ '^[a-f0-9]{40}$'),
  check((upload_state='none' and attempt_id is null) or (upload_state<>'none' and attempt_id is not null))
);
create table if not exists ppc_private.package_delivery_receipts (
  candidate_id uuid primary key references ppc_private.package_delivery_candidates(candidate_id),
  generation bigint not null unique,
  receipt jsonb not null,
  publication jsonb not null,
  confirmed_at timestamptz not null default clock_timestamp()
);
create unique index if not exists package_delivery_receipt_item_version
  on ppc_private.package_delivery_receipts((receipt->>'driveId'),(receipt->>'itemId'),(receipt->>'versionId'));

alter table ppc_private.package_delivery_state enable row level security;
alter table ppc_private.package_delivery_candidates enable row level security;
alter table ppc_private.package_delivery_receipts enable row level security;
revoke all on ppc_private.package_delivery_state,ppc_private.package_delivery_candidates,ppc_private.package_delivery_receipts
  from public,anon,authenticated,service_role,supabase_auth_admin;

create or replace function ppc_private.package_receipt_immutable()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Package publication receipts are immutable'; end;
$$;
drop trigger if exists package_receipt_immutable on ppc_private.package_delivery_receipts;
create trigger package_receipt_immutable before update or delete on ppc_private.package_delivery_receipts
  for each row execute function ppc_private.package_receipt_immutable();

create or replace function ppc_private.package_candidate(c ppc_private.package_delivery_candidates)
returns jsonb language sql stable set search_path='' as $$
  select case when c.candidate_id is null then null else jsonb_build_object(
    'candidateId',c.candidate_id,'kind',c.kind,'generation',c.generation,'expectedGeneration',c.expected_generation,
    'storageRevision',c.storage_revision,'sourceSha',c.source_sha,'manifestSha256',c.manifest_sha256,
    'ownerImagesCommit',c.owner_images_commit,'sha256',c.sha256,'bytes',c.bytes,
    'objectKey','packages/'||c.candidate_id::text||'.pkg',
    'createdAt',to_char(c.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt',to_char(c.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'status',c.status) end;
$$;
create or replace function ppc_private.package_upload(c ppc_private.package_delivery_candidates)
returns jsonb language sql stable set search_path='' as $$
  select case when c.candidate_id is null then null else jsonb_build_object('candidateId',c.candidate_id,
    'generation',c.generation,'attemptId',c.attempt_id,'state',c.upload_state) end;
$$;
-- Caller holds master and delivery locks. Expiry closes the candidate but does
-- not assert an upload has stopped, delete an object, or release the extra slot.
create or replace function ppc_private.package_expire()
returns void language plpgsql set search_path='' as $$
declare d ppc_private.package_delivery_state; c ppc_private.package_delivery_candidates;
begin
  select * into d from ppc_private.package_delivery_state where singleton;
  select * into c from ppc_private.package_delivery_candidates where candidate_id=d.queued_id;
  if found and c.expires_at<=clock_timestamp() then
    update ppc_private.package_delivery_candidates set status='cleanup' where candidate_id=c.candidate_id;
    update ppc_private.package_delivery_state set queued_id=null,cleanup_id=c.candidate_id where singleton;
  end if;
end;
$$;

create or replace function ppc_private.state_document(state ppc_private.master_state)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('manifest',state.manifest,'storageRevision',state.storage_revision,
    'revision',state.storage_revision,'sourceSha',state.source_sha,
    'acceptedManifestSha256',encode(sha256(convert_to(state.manifest::text,'UTF8')),'hex'),
    'publication',jsonb_build_object('requestedRevision',state.requested_revision,'publishedRevision',state.published_revision,
      'status',case when state.published_revision>=state.requested_revision then 'current'
        when state.publication_error<>'' then 'error' else 'pending' end,
      'error',state.publication_error,'publishedAt',state.published_at)
      || case when d.phase='legacy' then jsonb_build_object('githubSha',state.github_sha)
        else jsonb_build_object('deliveryPhase',d.phase)||coalesce(r.publication,'{}'::jsonb) end)
    from ppc_private.package_delivery_state d
    left join ppc_private.package_delivery_receipts r on r.candidate_id=d.current_id where d.singleton;
$$;

create or replace function public.ppc_package_current(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d ppc_private.package_delivery_state; result jsonb;
begin
  if payload is distinct from '{}'::jsonb then raise exception 'Invalid package current request'; end if;
  perform 1 from ppc_private.master_state where singleton for update;
  perform 1 from ppc_private.package_delivery_state where singleton for update;
  perform ppc_private.package_expire();
  select * into d from ppc_private.package_delivery_state where singleton;
  select jsonb_build_object('phase',d.phase,'generation',d.generation,
    'current',ppc_private.package_candidate(c),'queued',ppc_private.package_candidate(q),
    'cleanup',ppc_private.package_candidate(x),'upload',ppc_private.package_upload(q),'cleanupUpload',ppc_private.package_upload(x),
    'publication',r.publication,'policy',jsonb_build_object('provider','sharepoint','host','hp.sharepoint.com',
      'driveId',d.drive_id,'folderId',d.folder_id)) into result
    from ppc_private.package_delivery_state singleton
    left join ppc_private.package_delivery_candidates c on c.candidate_id=d.current_id
    left join ppc_private.package_delivery_candidates q on q.candidate_id=d.queued_id
    left join ppc_private.package_delivery_candidates x on x.candidate_id=d.cleanup_id
    left join ppc_private.package_delivery_receipts r on r.candidate_id=d.current_id where singleton.singleton;
  return result;
end;
$$;

create or replace function public.ppc_package_phase(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s ppc_private.master_state; d ppc_private.package_delivery_state; c ppc_private.package_delivery_candidates; seed_value jsonb; target text;
begin
  select * into s from ppc_private.master_state where singleton for update;
  if not found then return jsonb_build_object('status','uninitialized'); end if;
  select * into d from ppc_private.package_delivery_state where singleton for update;
  if jsonb_typeof(payload) is distinct from 'object' then raise exception 'Invalid package phase'; end if;
  if payload ? 'reconcile' then
    if (select count(*) from jsonb_object_keys(payload))<>2 or payload->'settled' is distinct from 'true'::jsonb
      or jsonb_typeof(payload->'reconcile') is distinct from 'object'
      or (select count(*) from jsonb_object_keys(payload->'reconcile'))<>4
      or exists(select 1 from jsonb_object_keys(payload->'reconcile') k where k not in ('candidateId','generation','attemptId','outcome'))
      then raise exception 'Invalid package reconciliation'; end if;
    select * into c from ppc_private.package_delivery_candidates where candidate_id::text=payload->'reconcile'->>'candidateId';
    if not found or c.candidate_id is distinct from coalesce(d.queued_id,d.cleanup_id)
      or c.generation::text is distinct from payload->'reconcile'->>'generation'
      or c.attempt_id::text is distinct from payload->'reconcile'->>'attemptId'
      or c.upload_state not in ('uploading','uncertain') then return jsonb_build_object('status','stale'); end if;
    target:=payload->'reconcile'->>'outcome';
    if target not in ('stored','absent') or target is null then raise exception 'Invalid package reconciliation'; end if;
    update ppc_private.package_delivery_candidates set upload_state=target where candidate_id=c.candidate_id;
    return jsonb_build_object('status','reconciled');
  end if;
  if to_regclass('storage.buckets') is null then raise exception 'Package delivery activation requires Storage'; end if;
  if not exists(select 1 from storage.buckets where id='ppc-package-delivery'
    and name='ppc-package-delivery' and public=false and file_size_limit=67108864
    and allowed_mime_types=array['application/octet-stream']::text[]) then raise exception 'Package delivery activation requires compatible private bucket'; end if;
  if not exists(select 1 from pg_class where oid=to_regclass('storage.objects')
    and relkind in ('r','p') and relrowsecurity) then raise exception 'Package delivery activation requires Storage object RLS'; end if;
  -- General SQL predicate applicability cannot be safely proven here. Reject
  -- every command policy available to public/anon/authenticated, including
  -- inherited roles and even apparently unrelated-bucket predicates. This is
  -- an activation hold for operator review, never permission to rewrite them.
  if exists(select 1 from pg_policy p cross join lateral unnest(p.polroles) as policy_role(role_id)
    where p.polrelid=to_regclass('storage.objects') and case when policy_role.role_id=0 then true
      else pg_has_role('anon',policy_role.role_id,'MEMBER') or pg_has_role('authenticated',policy_role.role_id,'MEMBER') end)
    then raise exception 'Package delivery activation requires reviewed Storage object policies'; end if;
  target:=payload->>'phase';
  if target='seeding' then
    seed_value:=payload->'seed';
    if (select count(*) from jsonb_object_keys(payload))<>4
      or exists(select 1 from jsonb_object_keys(payload) k where k not in ('phase','driveId','folderId','seed'))
      or jsonb_typeof(seed_value) is distinct from 'object' or (select count(*) from jsonb_object_keys(seed_value))<>5
      or exists(select 1 from jsonb_object_keys(seed_value) k where k not in ('storageRevision','sourceSha','githubSha','sha256','bytes'))
      or jsonb_typeof(payload->'driveId') is distinct from 'string' or coalesce(payload->>'driveId','') !~ '^[^[:cntrl:]]+$' or length(payload->>'driveId')>512 or btrim(payload->>'driveId')<>payload->>'driveId'
      or jsonb_typeof(payload->'folderId') is distinct from 'string' or coalesce(payload->>'folderId','') !~ '^[^[:cntrl:]]+$' or length(payload->>'folderId')>512 or btrim(payload->>'folderId')<>payload->>'folderId'
      or jsonb_typeof(seed_value->'storageRevision') is distinct from 'number' or coalesce(seed_value->>'storageRevision','') !~ '^[1-9][0-9]{0,15}$'
      or jsonb_typeof(seed_value->'bytes') is distinct from 'number' or coalesce(seed_value->>'bytes','') !~ '^[0-9]{2,8}$'
      or (seed_value->>'bytes')::bigint not between 36 and 67108864
      or jsonb_typeof(seed_value->'sourceSha') is distinct from 'string' or coalesce(seed_value->>'sourceSha','') !~ '^[a-f0-9]{40}$'
      or jsonb_typeof(seed_value->'githubSha') is distinct from 'string' or coalesce(seed_value->>'githubSha','') !~ '^[a-f0-9]{40}$'
      or jsonb_typeof(seed_value->'sha256') is distinct from 'string' or coalesce(seed_value->>'sha256','') !~ '^[a-f0-9]{64}$'
      then raise exception 'Invalid package phase'; end if;
    if d.phase='seeding' and d.drive_id=payload->>'driveId' and d.folder_id=payload->>'folderId' and d.seed=seed_value then return jsonb_build_object('status','configured','phase',d.phase); end if;
    if d.phase<>'legacy' or d.current_id is not null or d.queued_id is not null or d.cleanup_id is not null then raise exception 'Invalid package phase transition'; end if;
    if s.published_revision<1 or s.published_revision::text is distinct from seed_value->>'storageRevision'
      or s.source_sha is distinct from seed_value->>'sourceSha' or s.github_sha is distinct from seed_value->>'githubSha'
      then raise exception 'Seed does not match trusted publication'; end if;
    update ppc_private.package_delivery_state set phase=target,drive_id=payload->>'driveId',folder_id=payload->>'folderId',seed=seed_value where singleton;
  elsif target='sharepoint' then
    if payload<>jsonb_build_object('phase','sharepoint') then raise exception 'Invalid package phase'; end if;
    if d.phase='sharepoint' then return jsonb_build_object('status','configured','phase',target); end if;
    if d.phase<>'seeding' or d.current_id is null or d.queued_id is not null or d.cleanup_id is not null
      or not exists(select 1 from ppc_private.package_delivery_receipts where candidate_id=d.current_id and receipt->>'kind'='seed') then raise exception 'Verified seed required before SharePoint activation'; end if;
    update ppc_private.package_delivery_state set phase=target where singleton;
  else raise exception 'Invalid package phase transition'; end if;
  return jsonb_build_object('status','configured','phase',target);
end;
$$;

create or replace function public.ppc_package_reserve(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s ppc_private.master_state; d ppc_private.package_delivery_state; c ppc_private.package_delivery_candidates; candidate_uuid uuid; reservation_kind text; moment timestamptz;
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
  select * into c from ppc_private.package_delivery_candidates where candidate_id=candidate_uuid;
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
  if d.queued_id is not null then return jsonb_build_object('status','busy'); end if;
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
  select * into c from ppc_private.package_delivery_candidates where candidate_id::text=payload->>'candidateId';
  if not found or d.phase='legacy' or c.candidate_id is distinct from d.queued_id or c.generation::text is distinct from payload->>'generation' then return jsonb_build_object('status','stale'); end if;
  if c.expires_at<=clock_timestamp() then perform ppc_private.package_expire(); return jsonb_build_object('status','expired'); end if;
  if c.status<>'reserved' then return jsonb_build_object('status','closed'); end if;
  if c.upload_state not in ('none','absent') then return jsonb_build_object('status','upload_busy'); end if;
  update ppc_private.package_delivery_candidates set attempt_id=gen_random_uuid(),upload_state='uploading' where candidate_id=c.candidate_id returning * into c;
  return jsonb_build_object('status','claimed','candidate',ppc_private.package_candidate(c),'attemptId',c.attempt_id);
end;
$$;

create or replace function public.ppc_package_upload_result(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d ppc_private.package_delivery_state; c ppc_private.package_delivery_candidates; outcome text;
begin
  if jsonb_typeof(payload) is distinct from 'object' or (select count(*) from jsonb_object_keys(payload))<>4
    or not payload ?& array['candidateId','generation','attemptId','outcome'] or jsonb_typeof(payload->'generation') is distinct from 'number'
    or coalesce(payload->>'outcome','') not in ('stored','absent','uncertain') then raise exception 'Invalid upload result'; end if;
  perform 1 from ppc_private.master_state where singleton for update;
  select * into d from ppc_private.package_delivery_state where singleton for update;
  select * into c from ppc_private.package_delivery_candidates where candidate_id::text=payload->>'candidateId';
  if not found or c.candidate_id is distinct from coalesce(d.queued_id,d.cleanup_id) or c.generation::text is distinct from payload->>'generation'
    or c.attempt_id is null or c.attempt_id::text is distinct from payload->>'attemptId' then return jsonb_build_object('status','stale'); end if;
  outcome:=payload->>'outcome';
  -- Normal absent is permitted ONLY from the still-owning handler after it
  -- has proven its write settled. A subsequent 404 cannot settle uncertainty.
  if c.upload_state='uncertain' and outcome='absent' then return jsonb_build_object('status','upload_unsettled'); end if;
  if c.upload_state in ('stored','absent') and outcome<>c.upload_state then return jsonb_build_object('status','stale'); end if;
  update ppc_private.package_delivery_candidates set upload_state=outcome where candidate_id=c.candidate_id;
  return jsonb_build_object('status',outcome);
end;
$$;

create or replace function public.ppc_package_finalize(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d ppc_private.package_delivery_state; c ppc_private.package_delivery_candidates;
begin
  if jsonb_typeof(payload) is distinct from 'object' or (select count(*) from jsonb_object_keys(payload))<>5
    or not payload ?& array['candidateId','generation','sha256','bytes','envelopeValid'] or payload->'envelopeValid' is distinct from 'true'::jsonb
    or jsonb_typeof(payload->'generation') is distinct from 'number' or jsonb_typeof(payload->'bytes') is distinct from 'number' then raise exception 'Invalid package verification'; end if;
  perform 1 from ppc_private.master_state where singleton for update;
  select * into d from ppc_private.package_delivery_state where singleton for update;
  select * into c from ppc_private.package_delivery_candidates where candidate_id::text=payload->>'candidateId';
  if not found or c.candidate_id is distinct from d.queued_id or c.generation::text is distinct from payload->>'generation' then return jsonb_build_object('status','stale'); end if;
  if c.expires_at<=clock_timestamp() then perform ppc_private.package_expire(); return jsonb_build_object('status','expired'); end if;
  if c.sha256 is distinct from payload->>'sha256' or c.bytes::text is distinct from payload->>'bytes' then raise exception 'Package verification mismatch'; end if;
  if c.upload_state<>'stored' then return jsonb_build_object('status','upload_unsettled'); end if;
  if c.status not in ('reserved','ready') then return jsonb_build_object('status','stale'); end if;
  update ppc_private.package_delivery_candidates set status='ready' where candidate_id=c.candidate_id returning * into c;
  return jsonb_build_object('status','ready','candidate',ppc_private.package_candidate(c));
end;
$$;

create or replace function public.ppc_package_confirm(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s ppc_private.master_state; d ppc_private.package_delivery_state; c ppc_private.package_delivery_candidates; existing ppc_private.package_delivery_receipts; r jsonb; p jsonb; moment timestamptz;
begin
  if jsonb_typeof(payload) is distinct from 'object' or (select count(*) from jsonb_object_keys(payload))<>3
    or not payload ?& array['candidateId','generation','receipt'] or jsonb_typeof(payload->'generation') is distinct from 'number'
    or jsonb_typeof(payload->'receipt') is distinct from 'object' then raise exception 'Invalid package receipt'; end if;
  select * into s from ppc_private.master_state where singleton for update;
  select * into d from ppc_private.package_delivery_state where singleton for update;
  select * into c from ppc_private.package_delivery_candidates where candidate_id::text=payload->>'candidateId';
  if not found or c.generation::text is distinct from payload->>'generation' then return jsonb_build_object('status','stale','publication',null); end if;
  r:=payload->'receipt';
  select * into existing from ppc_private.package_delivery_receipts where candidate_id=c.candidate_id;
  if found then
    -- The old candidate may no longer be in current/queued after its object
    -- was retired. Recover only these two absent metadata fields from the
    -- immutable receipt; never accept caller nulls, other omissions or edits.
    if not r ? 'kind' then r:=r||jsonb_build_object('kind',existing.receipt->'kind'); end if;
    if not r ? 'storageRevision' then r:=r||jsonb_build_object('storageRevision',existing.receipt->'storageRevision'); end if;
    if (existing.receipt-'confirmedAt') is distinct from (r-'confirmedAt') then raise exception 'Conflicting package receipt'; end if;
    return jsonb_build_object('status','already_published','publication',existing.publication);
  end if;
  if c.candidate_id is distinct from d.queued_id or c.expected_generation<>d.generation or c.status<>'ready'
    or c.upload_state<>'stored' or c.expires_at<=clock_timestamp() or d.cleanup_id is not null then
    perform ppc_private.package_expire(); return jsonb_build_object('status','stale','publication',null);
  end if;
  if exists(select 1 from jsonb_object_keys(r) k where k not in ('provider','kind','candidateId','generation','storageRevision','sha256','bytes','driveId','folderId','itemId','versionId','fileName','confirmedAt'))
    or not r ?& array['provider','kind','candidateId','generation','storageRevision','sha256','bytes','driveId','folderId','itemId','versionId','fileName']
    or r->>'provider' is distinct from 'sharepoint' or r->>'kind' is distinct from c.kind
    or r->>'candidateId' is distinct from c.candidate_id::text or r->>'generation' is distinct from c.generation::text
    or r->>'storageRevision' is distinct from c.storage_revision::text or r->>'sha256' is distinct from c.sha256 or r->>'bytes' is distinct from c.bytes::text
    or jsonb_typeof(r->'generation') is distinct from 'number' or jsonb_typeof(r->'storageRevision') is distinct from 'number' or jsonb_typeof(r->'bytes') is distinct from 'number'
    or jsonb_typeof(r->'sha256') is distinct from 'string' or jsonb_typeof(r->'driveId') is distinct from 'string' or jsonb_typeof(r->'folderId') is distinct from 'string'
    or r->>'driveId' is distinct from d.drive_id or r->>'folderId' is distinct from d.folder_id
    or jsonb_typeof(r->'itemId') is distinct from 'string' or coalesce(r->>'itemId','') !~ '^[^[:cntrl:]]+$' or length(r->>'itemId')>512 or btrim(r->>'itemId')<>r->>'itemId'
    or jsonb_typeof(r->'versionId') is distinct from 'string' or coalesce(r->>'versionId','') !~ '^[^[:cntrl:]]+$' or length(r->>'versionId')>512 or btrim(r->>'versionId')<>r->>'versionId'
    or (c.kind='seed' and (r->>'fileName' is distinct from 'master_ppc.pkg' or r->>'versionId' is distinct from '4.0'))
    or (c.kind='publication' and r->>'fileName' is distinct from 'master-r'||c.storage_revision::text||'-g'||c.generation::text||'-'||c.candidate_id::text||'.pkg')
    then raise exception 'Invalid package receipt'; end if;
  moment:=clock_timestamp();
  r:=(r-'confirmedAt')||jsonb_build_object('confirmedAt',to_char(moment at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  p:=jsonb_build_object('provider','sharepoint','kind',c.kind,'generation',c.generation,'candidateId',c.candidate_id,
    'sha256',c.sha256,'bytes',c.bytes,'storageRevision',c.storage_revision,'publishedAt',r->>'confirmedAt');
  insert into ppc_private.package_delivery_receipts(candidate_id,generation,receipt,publication,confirmed_at) values(c.candidate_id,c.generation,r,p,moment);
  if d.current_id is not null then update ppc_private.package_delivery_candidates set status='cleanup' where candidate_id=d.current_id; end if;
  update ppc_private.package_delivery_candidates set status='published' where candidate_id=c.candidate_id;
  update ppc_private.package_delivery_state set current_id=c.candidate_id,generation=c.generation,queued_id=null,cleanup_id=d.current_id where singleton;
  -- Seed may lag accepted facts. Never replace manifest/source/Git blob/receipts.
  update ppc_private.master_state set published_revision=greatest(published_revision,c.storage_revision),published_at=moment,publication_error='' where singleton;
  return jsonb_build_object('status','published','publication',p);
end;
$$;

create or replace function public.ppc_package_cleanup(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d ppc_private.package_delivery_state; c ppc_private.package_delivery_candidates;
begin
  if jsonb_typeof(payload) is distinct from 'object' or (select count(*) from jsonb_object_keys(payload))<>3
    or not payload ?& array['candidateId','generation','absent'] or jsonb_typeof(payload->'generation') is distinct from 'number' then raise exception 'Invalid package cleanup'; end if;
  perform 1 from ppc_private.master_state where singleton for update;
  select * into d from ppc_private.package_delivery_state where singleton for update;
  select * into c from ppc_private.package_delivery_candidates where candidate_id::text=payload->>'candidateId';
  if not found or c.candidate_id is distinct from d.cleanup_id or c.generation::text is distinct from payload->>'generation' then return jsonb_build_object('status','stale'); end if;
  if c.upload_state in ('uploading','uncertain') then return jsonb_build_object('status','upload_unsettled'); end if;
  if payload->'absent' is distinct from 'true'::jsonb then return jsonb_build_object('status','not_absent'); end if;
  update ppc_private.package_delivery_state set cleanup_id=null where singleton;
  return jsonb_build_object('status','cleaned');
end;
$$;

-- Legacy acknowledgement is retained only while the operator policy is legacy.
create or replace function public.ppc_master_ack(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare state ppc_private.master_state; revision bigint; delivery_phase text;
begin
  revision:=(payload->>'storageRevision')::bigint;
  if coalesce(payload->>'githubSha','') !~ '^[a-f0-9]{40}$' or revision<1 then raise exception 'Invalid publication receipt'; end if;
  select * into state from ppc_private.master_state where singleton for update;
  if not found then return jsonb_build_object('status','uninitialized'); end if;
  select phase into delivery_phase from ppc_private.package_delivery_state where singleton for update;
  if delivery_phase<>'legacy' then return jsonb_build_object('status','delivery_managed'); end if;
  if revision>state.storage_revision then return jsonb_build_object('status','invalid_revision'); end if;
  if revision<state.published_revision then return jsonb_build_object('status','stale_revision'); end if;
  update ppc_private.master_state set published_revision=revision,github_sha=payload->>'githubSha',published_at=clock_timestamp(),publication_error='' where singleton returning * into state;
  return ppc_private.state_document(state)||jsonb_build_object('status','acknowledged');
end;
$$;

revoke all on function ppc_private.package_candidate(ppc_private.package_delivery_candidates),ppc_private.package_upload(ppc_private.package_delivery_candidates),ppc_private.package_expire(),ppc_private.package_receipt_immutable()
  from public,anon,authenticated,service_role,supabase_auth_admin;
revoke all on function ppc_private.state_document(ppc_private.master_state) from public,anon,authenticated,service_role,supabase_auth_admin;
revoke all on function public.ppc_package_current(jsonb),public.ppc_package_phase(jsonb),public.ppc_package_reserve(jsonb),public.ppc_package_upload_claim(jsonb),public.ppc_package_upload_result(jsonb),public.ppc_package_finalize(jsonb),public.ppc_package_confirm(jsonb),public.ppc_package_cleanup(jsonb)
  from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function public.ppc_package_current(jsonb),public.ppc_package_phase(jsonb),public.ppc_package_reserve(jsonb),public.ppc_package_upload_claim(jsonb),public.ppc_package_upload_result(jsonb),public.ppc_package_finalize(jsonb),public.ppc_package_confirm(jsonb),public.ppc_package_cleanup(jsonb) to service_role;
notify pgrst,'reload schema';
commit;
