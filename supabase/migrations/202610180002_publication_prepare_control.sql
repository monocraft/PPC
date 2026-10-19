-- Durable metadata-only publication recovery. No Storage, portfolio export,
-- dispatch, phase transition or live service access occurs in this migration.
begin;

create table if not exists ppc_private.publication_prepare_attempt (
  singleton boolean primary key default true check(singleton),
  prepare_key text check(prepare_key ~ '^[a-f0-9]{64}$'),
  attempt_id uuid, lease_until timestamptz, next_attempt_at timestamptz,
  attempt_count integer not null default 0 check(attempt_count between 0 and 3),
  window_started_at timestamptz,
  last_outcome text check(last_outcome in ('accepted','failed','uncertain')),
  owner_candidate_id uuid,
  owner_commit text check(owner_commit ~ '^[a-f0-9]{40}$'),
  owner_source_sha text check(owner_source_sha ~ '^[a-f0-9]{40}$'),
  owner_storage_revision bigint check(owner_storage_revision>0 and owner_storage_revision<9007199254740991),
  owner_unknown boolean not null default false,
  check((owner_candidate_id is null and owner_commit is null and owner_source_sha is null and owner_storage_revision is null)
    or (owner_candidate_id is not null and owner_commit is not null and owner_source_sha is not null and owner_storage_revision is not null))
);
alter table ppc_private.publication_prepare_attempt enable row level security;
revoke all on ppc_private.publication_prepare_attempt from public,anon,authenticated,service_role,supabase_auth_admin;

-- Fence reservations/receipts throughout backfill and trigger installation.
-- Their normal RPCs acquire these same locks before touching candidates.
do $$
begin
  perform 1 from ppc_private.master_state where singleton for update;
  perform 1 from ppc_private.package_delivery_state where singleton for update;
end;
$$;

-- Only a first installation backfills. Retained candidate records prove prior
-- reservation; a matching immutable normal receipt proves its satisfaction.
-- Never guess an unrecorded owner request or choose among conflicting tuples.
do $$
declare n integer; c ppc_private.package_delivery_candidates;
begin
  insert into ppc_private.publication_prepare_attempt(singleton) values(true) on conflict do nothing;
  if not found then return; end if;
  select count(*) into n from (
    select distinct a.owner_images_commit,a.source_sha,a.storage_revision
    from ppc_private.package_delivery_candidates a
    where a.kind='publication' and a.owner_images_commit is not null
      and not exists(select 1 from ppc_private.package_delivery_candidates b
        join ppc_private.package_delivery_receipts r on r.candidate_id=b.candidate_id
        where b.kind='publication' and r.receipt->>'provider'='sharepoint'
          and b.owner_images_commit=a.owner_images_commit and b.source_sha=a.source_sha
          and b.storage_revision>=a.storage_revision)
  ) outstanding;
  if n>1 then update ppc_private.publication_prepare_attempt set owner_unknown=true where singleton;
  elsif n=1 then
    select a.* into c from ppc_private.package_delivery_candidates a
    where a.kind='publication' and a.owner_images_commit is not null
      and not exists(select 1 from ppc_private.package_delivery_candidates b
        join ppc_private.package_delivery_receipts r on r.candidate_id=b.candidate_id
        where b.kind='publication' and r.receipt->>'provider'='sharepoint'
          and b.owner_images_commit=a.owner_images_commit and b.source_sha=a.source_sha
          and b.storage_revision>=a.storage_revision)
    order by a.created_at,a.candidate_id limit 1;
    update ppc_private.publication_prepare_attempt set owner_candidate_id=c.candidate_id,
      owner_commit=c.owner_images_commit,owner_source_sha=c.source_sha,owner_storage_revision=c.storage_revision where singleton;
  end if;
end;
$$;

-- Existing reservation and confirmation hold master -> delivery already.
-- Their INSERT triggers take the prepare singleton last, in the same order as
-- claim/result. Expiry, replacement and cleanup cannot erase this separate row.
create or replace function ppc_private.publication_owner_reserved()
returns trigger language plpgsql set search_path='' as $$
declare p ppc_private.publication_prepare_attempt;
begin
  if new.kind<>'publication' or new.owner_images_commit is null then return new; end if;
  select * into p from ppc_private.publication_prepare_attempt where singleton for update;
  if p.owner_candidate_id is null and not p.owner_unknown then
    update ppc_private.publication_prepare_attempt set owner_candidate_id=new.candidate_id,
      owner_commit=new.owner_images_commit,owner_source_sha=new.source_sha,owner_storage_revision=new.storage_revision where singleton;
  elsif p.owner_commit is distinct from new.owner_images_commit or p.owner_source_sha is distinct from new.source_sha
    or new.storage_revision<p.owner_storage_revision then
    update ppc_private.publication_prepare_attempt set owner_unknown=true where singleton;
  end if;
  return new;
end;
$$;
drop trigger if exists publication_owner_reserved on ppc_private.package_delivery_candidates;
create trigger publication_owner_reserved after insert on ppc_private.package_delivery_candidates
  for each row execute function ppc_private.publication_owner_reserved();

create or replace function ppc_private.publication_owner_confirmed()
returns trigger language plpgsql set search_path='' as $$
declare c ppc_private.package_delivery_candidates;
begin
  select * into c from ppc_private.package_delivery_candidates where candidate_id=new.candidate_id;
  perform 1 from ppc_private.publication_prepare_attempt where singleton for update;
  update ppc_private.publication_prepare_attempt set owner_candidate_id=null,owner_commit=null,
    owner_source_sha=null,owner_storage_revision=null
  where singleton and not owner_unknown and c.kind='publication' and new.receipt->>'provider'='sharepoint'
    and new.receipt->>'kind'='publication' and owner_commit=c.owner_images_commit
    and owner_source_sha=c.source_sha and c.storage_revision>=owner_storage_revision;
  return new;
end;
$$;
drop trigger if exists publication_owner_confirmed on ppc_private.package_delivery_receipts;
create trigger publication_owner_confirmed after insert on ppc_private.package_delivery_receipts
  for each row execute function ppc_private.publication_owner_confirmed();

-- One stored metadata snapshot; deliberately does not call state_document,
-- package_current/package_expire, hash a manifest, lock or perform writes.
create or replace function ppc_private.publication_control()
returns jsonb language plpgsql stable set search_path='' as $$
declare s ppc_private.master_state; d ppc_private.package_delivery_state;
  p ppc_private.publication_prepare_attempt; c ppc_private.package_delivery_candidates;
  q ppc_private.package_delivery_candidates; x ppc_private.package_delivery_candidates;
  r ppc_private.package_delivery_receipts; snapshot record; action_value text; hold text;
  key_value text; intent_value jsonb; retry_value timestamptz; candidate_value jsonb; path_value text;
  moment timestamptz:=statement_timestamp();
begin
  select ms,ds,ps,cc,qc,xc,rc into snapshot
    from (values(true)) singleton(id)
    left join ppc_private.master_state ms on ms.singleton
    left join ppc_private.package_delivery_state ds on ds.singleton
    left join ppc_private.publication_prepare_attempt ps on ps.singleton
    left join ppc_private.package_delivery_candidates cc on cc.candidate_id=ds.current_id
    left join ppc_private.package_delivery_candidates qc on qc.candidate_id=ds.queued_id
    left join ppc_private.package_delivery_candidates xc on xc.candidate_id=ds.cleanup_id
    left join ppc_private.package_delivery_receipts rc on rc.candidate_id=ds.current_id;
  s:=snapshot.ms; d:=snapshot.ds; p:=snapshot.ps; c:=snapshot.cc;
  q:=snapshot.qc; x:=snapshot.xc; r:=snapshot.rc;
  if s.singleton is null or d.singleton is null or p.singleton is null
    or s.source_sha is null or s.source_sha !~ '^[a-f0-9]{40}$'
    or s.requested_revision<>s.storage_revision or s.published_revision>s.requested_revision
    or s.published_revision<0 then hold:='STATE_INVALID';
  elsif d.phase<>'sharepoint' then hold:='PHASE_NOT_READY';
  elsif c.candidate_id is null or r.candidate_id is null then hold:='CURRENT_MISSING';
  elsif c.generation<>d.generation or r.generation<>c.generation or r.receipt->>'provider' is distinct from 'sharepoint'
    or r.receipt->>'kind' is distinct from c.kind
    or (d.queued_id is not null and q.candidate_id is null) or (d.cleanup_id is not null and x.candidate_id is null)
    or (q.candidate_id is not null and (q.kind<>'publication' or q.expected_generation<>d.generation))
    then hold:='STATE_INVALID';
  elsif p.owner_unknown or exists(select 1 from (values(q.owner_images_commit,q.source_sha,q.storage_revision),
      (x.owner_images_commit,x.source_sha,x.storage_revision)) as o(commit_sha,source_sha,revision)
    where o.commit_sha is not null
      and not exists(select 1 from ppc_private.package_delivery_candidates satisfied
        join ppc_private.package_delivery_receipts proof on proof.candidate_id=satisfied.candidate_id
        where satisfied.kind='publication' and proof.receipt->>'provider'='sharepoint'
          and satisfied.owner_images_commit=o.commit_sha and satisfied.source_sha=o.source_sha
          and satisfied.storage_revision>=o.revision)
      and (p.owner_candidate_id is null or o.commit_sha is distinct from p.owner_commit
      or o.source_sha is distinct from p.owner_source_sha or o.revision<p.owner_storage_revision))
    or (p.owner_candidate_id is not null and q.candidate_id is not null
      and (q.owner_images_commit is distinct from p.owner_commit or q.source_sha is distinct from p.owner_source_sha
        or q.storage_revision<p.owner_storage_revision)) then hold:='OWNER_INTENT_UNKNOWN';
  end if;
  if hold is not null then action_value:='held';
  elsif q.status='ready' and q.upload_state='stored' and q.expires_at>moment then
    action_value:='deliver'; candidate_value:=jsonb_build_object('candidateId',q.candidate_id,
      'generation',q.generation,'storageRevision',q.storage_revision,'sha256',q.sha256,'bytes',q.bytes,
      'expiresAt',to_char(q.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'fileName','master-r'||q.storage_revision::text||'-g'||q.generation::text||'-'||q.candidate_id::text||'.pkg',
      'provider','sharepoint','driveId',d.drive_id,'folderId',d.folder_id);
    path_value:='/api/ascm/publication/'||q.candidate_id::text||'/bytes';
    intent_value:=jsonb_build_object('kind',case when q.owner_images_commit is null then 'ordinary' else 'owner_images' end,'ownerImagesCommit',q.owner_images_commit);
  elsif s.requested_revision=s.published_revision and c.kind='publication' and p.owner_candidate_id is null
    and d.queued_id is null and d.cleanup_id is null then action_value:='idle';
  else
    action_value:=case when d.queued_id is not null or d.cleanup_id is not null then 'recover' else 'prepare' end;
    intent_value:=jsonb_build_object('kind',case when p.owner_candidate_id is null then 'ordinary' else 'owner_images' end,'ownerImagesCommit',p.owner_commit);
    key_value:=encode(sha256(convert_to(jsonb_build_array('ppc-publication-prepare-v1',d.phase,s.source_sha,
      s.requested_revision,s.published_revision,d.generation,c.candidate_id,c.kind,c.owner_images_commit,
      q.candidate_id,q.generation,q.owner_images_commit,x.candidate_id,x.generation,x.owner_images_commit,
      p.owner_candidate_id,p.owner_commit,p.owner_source_sha,p.owner_storage_revision)::text,'UTF8')),'hex');
    retry_value:=greatest(p.lease_until,p.next_attempt_at);
    if p.prepare_key=key_value and p.attempt_count>=3 and p.window_started_at+interval '24 hours'>moment then
      retry_value:=greatest(retry_value,p.window_started_at+interval '24 hours'); hold:='PREPARE_ATTEMPTS_EXHAUSTED';
    end if;
    if retry_value>moment then action_value:='backoff'; else retry_value:=null; end if;
  end if;
  return jsonb_build_object('version',1,'action',action_value,'requestedRevision',s.requested_revision,
    'publishedRevision',s.published_revision,'generation',d.generation,'prepareKey',key_value,
    'retryAt',case when retry_value is null then null else to_char(retry_value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'intent',intent_value,'candidate',candidate_value,'binaryPath',path_value,'holdCode',hold,'archiveAllowed',false);
end;
$$;

create or replace function public.ppc_package_control(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if payload is distinct from '{}'::jsonb then raise exception 'Invalid publication control request'; end if;
  return ppc_private.publication_control();
end;
$$;

create or replace function public.ppc_package_prepare_claim(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p ppc_private.publication_prepare_attempt; projection jsonb; status_value text;
  moment timestamptz; same_window boolean;
begin
  if jsonb_typeof(payload) is distinct from 'object' or (select count(*) from jsonb_object_keys(payload))<>2
    or not payload ?& array['prepareKey','attemptId']
    or jsonb_typeof(payload->'prepareKey') is distinct from 'string' or coalesce(payload->>'prepareKey','') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(payload->'attemptId') is distinct from 'string' or coalesce(payload->>'attemptId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    then raise exception 'Invalid publication prepare claim'; end if;
  perform 1 from ppc_private.master_state where singleton for update;
  perform 1 from ppc_private.package_delivery_state where singleton for update;
  select * into p from ppc_private.publication_prepare_attempt where singleton for update;
  moment:=clock_timestamp(); projection:=ppc_private.publication_control();
  if projection->>'action'='held' then status_value:='held';
  elsif projection->>'action' in ('idle','deliver') then status_value:='not_needed';
  elsif projection->>'prepareKey' is distinct from payload->>'prepareKey' then status_value:='stale';
  elsif p.lease_until>moment then status_value:='busy';
  elsif projection->>'action'='backoff' then status_value:='backoff';
  else
    same_window:=p.prepare_key=payload->>'prepareKey' and p.window_started_at+interval '24 hours'>moment;
    update ppc_private.publication_prepare_attempt set prepare_key=payload->>'prepareKey',attempt_id=(payload->>'attemptId')::uuid,
      lease_until=moment+interval '60 seconds',next_attempt_at=moment+interval '15 minutes',last_outcome=null,
      attempt_count=case when same_window then attempt_count+1 else 1 end,
      window_started_at=case when same_window then window_started_at else moment end
      where singleton returning * into p;
    status_value:='claimed';
  end if;
  return jsonb_build_object('status',status_value,'control',projection,
    'attemptId',case when status_value='claimed' then p.attempt_id else null end,
    'leaseUntil',case when status_value='claimed' then to_char(p.lease_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') else null end,
    'retryAt',case when status_value in ('claimed','busy') then to_char(greatest(p.lease_until,p.next_attempt_at) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      when status_value='backoff' then projection->>'retryAt' else null end);
end;
$$;

create or replace function public.ppc_package_prepare_result(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p ppc_private.publication_prepare_attempt;
begin
  if jsonb_typeof(payload) is distinct from 'object' or (select count(*) from jsonb_object_keys(payload))<>3
    or not payload ?& array['prepareKey','attemptId','outcome']
    or jsonb_typeof(payload->'prepareKey') is distinct from 'string' or coalesce(payload->>'prepareKey','') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(payload->'attemptId') is distinct from 'string' or coalesce(payload->>'attemptId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    or jsonb_typeof(payload->'outcome') is distinct from 'string' or coalesce(payload->>'outcome','') not in ('accepted','failed','uncertain')
    then raise exception 'Invalid publication prepare result'; end if;
  perform 1 from ppc_private.master_state where singleton for update;
  perform 1 from ppc_private.package_delivery_state where singleton for update;
  select * into p from ppc_private.publication_prepare_attempt where singleton for update;
  if p.prepare_key is distinct from payload->>'prepareKey' or p.attempt_id::text is distinct from payload->>'attemptId'
    or (p.last_outcome is not null and p.last_outcome is distinct from payload->>'outcome') then
    return jsonb_build_object('status','stale','retryAt',null);
  end if;
  update ppc_private.publication_prepare_attempt set last_outcome=payload->>'outcome',lease_until=null where singleton;
  return jsonb_build_object('status',payload->>'outcome','retryAt',to_char(p.next_attempt_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end;
$$;

revoke all on function ppc_private.publication_control(),ppc_private.publication_owner_reserved(),ppc_private.publication_owner_confirmed()
  from public,anon,authenticated,service_role,supabase_auth_admin;
revoke all on function public.ppc_package_control(jsonb),public.ppc_package_prepare_claim(jsonb),public.ppc_package_prepare_result(jsonb)
  from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function public.ppc_package_control(jsonb),public.ppc_package_prepare_claim(jsonb),public.ppc_package_prepare_result(jsonb) to service_role;
notify pgrst,'reload schema';
commit;
