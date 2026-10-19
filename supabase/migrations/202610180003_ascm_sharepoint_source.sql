-- Private append-only source observations. No provider access or portfolio data
-- is performed by installation; native acceptance remains ppc_master_commit.
begin;
create table if not exists ppc_private.ascm_sharepoint_receipts (
  observation_id bigserial primary key check(observation_id < 9007199254740991),
  request_id text not null unique check(request_id ~ '^ascm-sp-[a-f0-9]{64}$'),
  fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
  source jsonb not null check(jsonb_typeof(source)='object'),
  before_metadata jsonb not null check(jsonb_typeof(before_metadata)='object'),
  after_metadata jsonb not null check(before_metadata=after_metadata),
  raw_sha256 text not null check(raw_sha256 ~ '^[a-f0-9]{64}$'),
  business_fingerprint_version integer not null check(business_fingerprint_version>0),
  business_sha256 text not null check(business_sha256 ~ '^[a-f0-9]{64}$'),
  report_date date not null check(report_date>=date '2026-09-30'),
  outcome text not null check(outcome in ('accepted','equivalent')),
  accepted_session_id text not null check(accepted_session_id='ascm-sharepoint'),
  accepted_request_id text not null check(accepted_request_id ~ '^ascm-sp-[a-f0-9]{64}$'),
  storage_revision bigint not null check(storage_revision>0 and storage_revision<9007199254740991),
  saved_fields integer not null check(saved_fields>=0),
  saved_products integer not null check(saved_products>=0),
  observed_at timestamptz not null default clock_timestamp()
);
create unique index if not exists ascm_sharepoint_item_version on ppc_private.ascm_sharepoint_receipts((source->>'listItemId'),(source->>'itemUniqueId'),(source->>'versionLabel'));
create index if not exists ascm_sharepoint_stream on ppc_private.ascm_sharepoint_receipts(report_date desc,observation_id desc);
alter table ppc_private.ascm_sharepoint_receipts enable row level security;
revoke all on ppc_private.ascm_sharepoint_receipts from public,anon,authenticated,service_role,supabase_auth_admin;
revoke all on sequence ppc_private.ascm_sharepoint_receipts_observation_id_seq from public,anon,authenticated,service_role,supabase_auth_admin;

create or replace function ppc_private.ascm_sharepoint_immutable()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'SharePoint source observations are immutable'; end;
$$;
drop trigger if exists ascm_sharepoint_immutable on ppc_private.ascm_sharepoint_receipts;
create trigger ascm_sharepoint_immutable before update or delete on ppc_private.ascm_sharepoint_receipts for each row execute function ppc_private.ascm_sharepoint_immutable();

create or replace function ppc_private.ascm_sharepoint_document(r ppc_private.ascm_sharepoint_receipts)
returns jsonb language sql stable set search_path='' as $$
  select case when r.request_id is null then null else jsonb_build_object(
    'observationId',r.observation_id,'requestId',r.request_id,'fingerprint',r.fingerprint,
    'source',r.source,'before',r.before_metadata,'after',r.after_metadata,
    'rawSha256',r.raw_sha256,'businessFingerprintVersion',r.business_fingerprint_version,
    'businessSha256',r.business_sha256,'reportDate',r.report_date,'outcome',r.outcome,
    'acceptedRequestId',r.accepted_request_id,'storageRevision',r.storage_revision,
    'savedFields',r.saved_fields,'savedProducts',r.saved_products) end;
$$;

create or replace function public.ppc_master_ascm_sharepoint_read(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if jsonb_typeof(payload) is distinct from 'object' or (select count(*) from jsonb_object_keys(payload))<>1
    or coalesce(payload->>'requestId','') !~ '^ascm-sp-[a-f0-9]{64}$' then raise exception 'Invalid SharePoint source read'; end if;
  -- One statement/MVCC snapshot covers master, exact observation, linked native
  -- acceptance, publication and the latest source fence (including equivalence).
  select ppc_private.state_document(s) || jsonb_build_object(
    'sourceReceipt',ppc_private.ascm_sharepoint_document(r),
    'baseline',ppc_private.ascm_sharepoint_document(b),
    'receipt',case when n.request_id is null then null else jsonb_build_object(
      'fingerprint',n.fingerprint,'storageRevision',n.storage_revision,
      'savedFields',n.saved_fields,'savedProducts',n.saved_products) end)
  into result from ppc_private.master_state s
  left join ppc_private.ascm_sharepoint_receipts r on r.request_id=payload->>'requestId'
  left join ppc_private.master_receipts n on n.session_id=r.accepted_session_id and n.request_id=r.accepted_request_id
  left join lateral(select * from ppc_private.ascm_sharepoint_receipts order by observation_id desc limit 1) b on true
  where s.singleton;
  return coalesce(result,jsonb_build_object('status','uninitialized'));
end;
$$;

create or replace function public.ppc_master_ascm_sharepoint_commit(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s ppc_private.master_state; r ppc_private.ascm_sharepoint_receipts; b ppc_private.ascm_sharepoint_receipts;
  n ppc_private.master_receipts; result jsonb; equivalent boolean:=false; src jsonb:=payload->'source'; day date;
begin
  if jsonb_typeof(payload) is distinct from 'object' or (select count(*) from jsonb_object_keys(payload))<>15
    or not(payload ?& array['requestId','fingerprint','source','before','after','rawSha256','businessFingerprintVersion','businessSha256','reportDate','expectedRevision','expectedSourceObservationId','manifest','changed','savedFields','savedProducts'])
    or coalesce(payload->>'requestId','') !~ '^ascm-sp-[a-f0-9]{64}$'
    or coalesce(payload->>'fingerprint','') !~ '^[a-f0-9]{64}$'
    or coalesce(payload->>'rawSha256','') !~ '^[a-f0-9]{64}$'
    or coalesce(payload->>'businessSha256','') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(payload->'businessFingerprintVersion') is distinct from 'number'
    or coalesce(payload->>'businessFingerprintVersion','') !~ '^[1-9][0-9]{0,8}$'
    or jsonb_typeof(payload->'expectedRevision') is distinct from 'number'
    or coalesce(payload->>'expectedRevision','') !~ '^[1-9][0-9]{0,15}$'
    or jsonb_typeof(payload->'expectedSourceObservationId') is distinct from 'number'
    or coalesce(payload->>'expectedSourceObservationId','') !~ '^(0|[1-9][0-9]{0,15})$'
    or jsonb_typeof(payload->'manifest') is distinct from 'object'
    or jsonb_typeof(payload->'changed') is distinct from 'boolean'
    or jsonb_typeof(payload->'savedFields') is distinct from 'number' or coalesce(payload->>'savedFields','') !~ '^[0-9]{1,8}$'
    or jsonb_typeof(payload->'savedProducts') is distinct from 'number' or coalesce(payload->>'savedProducts','') !~ '^[0-9]{1,8}$'
    or coalesce(payload->>'reportDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(src) is distinct from 'object' or (select count(*) from jsonb_object_keys(src))<>14
    or src->>'provider' is distinct from 'sharepoint' or src->>'hostname' is distinct from 'hp.sharepoint.com'
    or src->>'sitePath' is distinct from '/teams/IPSG_SCM_and_Product_Requirements_Info'
    or src->>'driveId' is distinct from 'b!Dxcy8q8LE0GivbyM3D6Dq5C5iXHjfxBMsvQrwTpLknS0JFIuvvhlQoilkLMqZkl9'
    or src->>'listId' is distinct from '2e5224b4-f8be-4265-88a5-90b32a66497d'
    or jsonb_typeof(src->'listItemId') is distinct from 'number' or coalesce(src->>'listItemId','') !~ '^[1-9][0-9]{0,15}$'
    or coalesce(src->>'itemUniqueId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    or coalesce(src->>'versionLabel','') !~ '^[1-9][0-9]{0,14}\.0$'
    or src->>'fileName' is distinct from 'ASCM Report_HyperX_'||(payload->>'reportDate')||'.xlsx'
    or jsonb_typeof(src->'bytes') is distinct from 'number' or coalesce(src->>'bytes','') !~ '^[1-9][0-9]{0,6}$'
    or (src->>'bytes')::bigint>2097152
    or coalesce(length(src->>'eTag'),0) not between 1 and 512
    or jsonb_typeof(payload->'before') is distinct from 'object' or (select count(*) from jsonb_object_keys(payload->'before'))<>5
    or payload->'before' is distinct from payload->'after'
    or payload->'before' is distinct from jsonb_build_object('listItemId',src->'listItemId','itemUniqueId',src->'itemUniqueId','versionLabel',src->'versionLabel','eTag',src->'eTag','bytes',src->'bytes')
  then raise exception 'Invalid SharePoint source commit'; end if;
  day:=(payload->>'reportDate')::date;
  if day<date '2026-09-30' then return jsonb_build_object('status','stale_source'); end if;
  select * into s from ppc_private.master_state where singleton for update;
  if not found then return jsonb_build_object('status','uninitialized'); end if;
  select * into r from ppc_private.ascm_sharepoint_receipts where request_id=payload->>'requestId';
  if found then
    if r.fingerprint<>payload->>'fingerprint' or r.raw_sha256<>payload->>'rawSha256' or r.business_sha256<>payload->>'businessSha256'
      or r.business_fingerprint_version<>(payload->>'businessFingerprintVersion')::integer
    then return jsonb_build_object('status','request_mismatch'); end if;
    return jsonb_build_object('status','already_saved');
  end if;
  select * into b from ppc_private.ascm_sharepoint_receipts order by observation_id desc limit 1;
  if s.storage_revision<>(payload->>'expectedRevision')::bigint
    or coalesce(b.observation_id,0)<>(payload->>'expectedSourceObservationId')::bigint
  then return jsonb_build_object('status','raced'); end if;
  if b.request_id is not null then
    if b.business_fingerprint_version<>(payload->>'businessFingerprintVersion')::integer then return jsonb_build_object('status','fingerprint_version_mismatch'); end if;
    if day<b.report_date then return jsonb_build_object('status','stale_source'); end if;
    if day=b.report_date then
      if src->'listItemId' is distinct from b.source->'listItemId' or src->>'itemUniqueId'<>b.source->>'itemUniqueId' then return jsonb_build_object('status','ambiguous_source'); end if;
      if split_part(src->>'versionLabel','.',1)::bigint<=split_part(b.source->>'versionLabel','.',1)::bigint then return jsonb_build_object('status','stale_source'); end if;
      equivalent:=b.business_sha256=payload->>'businessSha256';
    end if;
  elsif (payload->>'businessFingerprintVersion')::integer<>1 then return jsonb_build_object('status','fingerprint_version_mismatch'); end if;
  if equivalent then
    select * into n from ppc_private.master_receipts where session_id=b.accepted_session_id and request_id=b.accepted_request_id;
    if not found or n.storage_revision<>b.storage_revision then raise exception 'Missing original native source receipt'; end if;
  else
    result:=public.ppc_master_commit(jsonb_build_object('sessionId','ascm-sharepoint','requestId',payload->>'requestId',
      'expectedRevision',payload->'expectedRevision','fingerprint',payload->>'fingerprint','manifest',payload->'manifest',
      'changed',payload->'changed','savedFields',payload->'savedFields','savedProducts',payload->'savedProducts'));
    if result->>'status' not in ('saved','already_saved') then return result; end if;
    -- Do not trust commit's current revision on replay. Read immutable receipt.
    select * into n from ppc_private.master_receipts where session_id='ascm-sharepoint' and request_id=payload->>'requestId';
    if not found or n.fingerprint<>payload->>'fingerprint' then raise exception 'Missing original native source receipt'; end if;
  end if;
  insert into ppc_private.ascm_sharepoint_receipts(request_id,fingerprint,source,before_metadata,after_metadata,raw_sha256,
    business_fingerprint_version,business_sha256,report_date,outcome,accepted_session_id,accepted_request_id,storage_revision,saved_fields,saved_products)
  values(payload->>'requestId',payload->>'fingerprint',src,payload->'before',payload->'after',payload->>'rawSha256',
    (payload->>'businessFingerprintVersion')::integer,payload->>'businessSha256',day,case when equivalent then 'equivalent' else 'accepted' end,
    n.session_id,n.request_id,n.storage_revision,case when equivalent then 0 else n.saved_fields end,case when equivalent then 0 else n.saved_products end);
  return jsonb_build_object('status','saved');
end;
$$;
revoke all on function ppc_private.ascm_sharepoint_immutable(),ppc_private.ascm_sharepoint_document(ppc_private.ascm_sharepoint_receipts) from public,anon,authenticated,service_role,supabase_auth_admin;
revoke all on function public.ppc_master_ascm_sharepoint_read(jsonb),public.ppc_master_ascm_sharepoint_commit(jsonb) from public,anon,authenticated,supabase_auth_admin;
grant execute on function public.ppc_master_ascm_sharepoint_read(jsonb),public.ppc_master_ascm_sharepoint_commit(jsonb) to service_role;
commit;
