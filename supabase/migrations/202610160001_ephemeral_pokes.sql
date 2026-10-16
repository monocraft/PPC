-- Private, short-lived presence gestures. The package-key-authenticated gateway
-- invokes this RPC; no browser role receives table access or function execution.
alter table ppc_private.master_presence
  add column if not exists activity text not null default 'browsing'
    check (activity in ('browsing','editing','roadmap','focused','idle')),
  add column if not exists receive_pokes boolean not null default true;

create table if not exists ppc_private.master_pokes (
  poke_id text primary key check (poke_id ~ '^[A-Za-z0-9_-]{8,128}$'),
  from_session_id text not null,
  from_display_name text not null,
  to_session_id text not null,
  accepted_at timestamptz not null default clock_timestamp(),
  acknowledged boolean not null default false,
  check (from_session_id <> to_session_id)
);
create index if not exists master_pokes_expiry on ppc_private.master_pokes(accepted_at);
create index if not exists master_pokes_sender on ppc_private.master_pokes(from_session_id,accepted_at);
create index if not exists master_pokes_inbox on ppc_private.master_pokes(to_session_id,accepted_at)
  where not acknowledged;
alter table ppc_private.master_pokes enable row level security;
revoke all on ppc_private.master_pokes from public, anon, authenticated;
grant all on ppc_private.master_pokes to service_role;

create or replace function public.ppc_master_presence(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  roster jsonb;
  inbox jsonb := '[]'::jsonb;
  result jsonb;
  poke_result jsonb;
  count_sessions integer;
  queue_count integer;
  sender_count integer;
  sender_id text := payload->>'sessionId';
  sender_name text;
  target_id text;
  requested_id text;
  previous_sender text;
  previous_target text;
  requested_activity text;
  accepting_pokes boolean;
  is_editing boolean;
  is_leaving boolean;
  ack_ids text[] := array[]::text[];
  now_at timestamptz;
  earliest_sender timestamptz;
  latest_target timestamptz;
  retry_seconds integer := 0;
begin
  if jsonb_typeof(payload->'sessionId') is distinct from 'string'
    or coalesce(sender_id,'') !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'Invalid presence session';
  end if;
  if payload ? 'receivePokes' and jsonb_typeof(payload->'receivePokes') is distinct from 'boolean' then
    raise exception 'Invalid presence poke preference';
  end if;
  if payload ? 'activity' and (jsonb_typeof(payload->'activity') is distinct from 'string'
    or payload->>'activity' not in ('browsing','editing','roadmap','focused','idle')) then
    raise exception 'Invalid presence activity';
  end if;
  if payload ? 'poke' then
    if jsonb_typeof(payload->'poke') is distinct from 'object'
      or jsonb_typeof(payload->'poke'->'id') is distinct from 'string'
      or coalesce(payload->'poke'->>'id','') !~ '^[A-Za-z0-9_-]{8,128}$'
      or jsonb_typeof(payload->'poke'->'targetSessionId') is distinct from 'string'
      or coalesce(payload->'poke'->>'targetSessionId','') !~ '^[A-Za-z0-9_-]{8,128}$' then
      raise exception 'Invalid presence poke';
    end if;
    requested_id := payload->'poke'->>'id';
    target_id := payload->'poke'->>'targetSessionId';
  end if;
  if payload ? 'ackPokeIds' then
    if jsonb_typeof(payload->'ackPokeIds') is distinct from 'array' then
      raise exception 'Invalid presence poke acknowledgments';
    end if;
    if jsonb_array_length(payload->'ackPokeIds') > 32 then
      raise exception 'Invalid presence poke acknowledgments';
    end if;
    if exists(select 1 from jsonb_array_elements(payload->'ackPokeIds') as entry(value)
      where jsonb_typeof(value) is distinct from 'string' or value #>> '{}' !~ '^[A-Za-z0-9_-]{8,128}$') then
      raise exception 'Invalid presence poke acknowledgments';
    end if;
    select coalesce(array_agg(value),array[]::text[]) into ack_ids
      from jsonb_array_elements_text(payload->'ackPokeIds') as entry(value);
  end if;
  is_editing := coalesce((payload->>'editing')::boolean,false);
  is_leaving := coalesce((payload->>'leave')::boolean,false);
  accepting_pokes := coalesce((payload->>'receivePokes')::boolean,true);
  requested_activity := case when is_editing then 'editing'
    when payload->>'activity'='editing' then 'browsing'
    else coalesce(payload->>'activity','browsing') end;

  -- Reuse the roster lock so target departure, queue bounds, duplicate checks
  -- and the two sliding cooldowns are atomic with concurrent heartbeats.
  perform pg_advisory_xact_lock(78307412);
  now_at := clock_timestamp();
  delete from ppc_private.master_presence where touched_at <= now_at-interval '65 seconds';
  if is_leaving then
    delete from ppc_private.master_presence where session_id=sender_id;
    delete from ppc_private.master_pokes where from_session_id=sender_id or to_session_id=sender_id;
  else
    select count(*) into count_sessions from ppc_private.master_presence;
    if count_sessions >= 256 and not exists(select 1 from ppc_private.master_presence where session_id=sender_id) then
      return jsonb_build_object('status','full','capabilities',jsonb_build_object('pokes',true,'activity',true),'pokes',inbox);
    end if;
    insert into ppc_private.master_presence(session_id,display_name,category_id,product_id,editing,activity,receive_pokes,touched_at)
      values(sender_id,left(coalesce(payload->>'displayName',''),60),left(coalesce(payload->>'categoryId',''),180),
        left(coalesce(payload->>'productId',''),180),is_editing,requested_activity,accepting_pokes,now_at)
      on conflict(session_id) do update set display_name=excluded.display_name,category_id=excluded.category_id,
        product_id=excluded.product_id,editing=excluded.editing,activity=excluded.activity,
        receive_pokes=excluded.receive_pokes,touched_at=excluded.touched_at;
    -- Retain accepted receipts after acknowledgment/mute. Removing them here
    -- would let retries redeliver gestures or bypass the sender cooldowns.
    update ppc_private.master_pokes set acknowledged=true
      where to_session_id=sender_id and not acknowledged
        and (not accepting_pokes or poke_id=any(ack_ids));
  end if;

  -- Each heartbeat performs bounded cleanup; all retained rows, including ACK
  -- receipts, count toward the absolute 4,096-row cap below.
  delete from ppc_private.master_pokes where poke_id in (
    select poke.poke_id from ppc_private.master_pokes poke
    where poke.accepted_at <= now_at-interval '90 seconds'
      or not exists(select 1 from ppc_private.master_presence recipient where recipient.session_id=poke.to_session_id)
    order by poke.accepted_at limit 256);

  if requested_id is not null then
    select from_session_id,to_session_id into previous_sender,previous_target
      from ppc_private.master_pokes where poke_id=requested_id;
    if found then
      -- IDs are globally unique because recipients acknowledge/deduplicate by
      -- ID. Another sender's collision can never reveal or overwrite its cue.
      if previous_sender=sender_id and previous_target<>target_id then raise exception 'Invalid presence poke replay'; end if;
      poke_result := jsonb_build_object('id',requested_id,'status',
        case when previous_sender=sender_id then 'duplicate' else 'unavailable' end);
    elsif is_leaving or target_id=sender_id or not exists(
      select 1 from ppc_private.master_presence where session_id=target_id and receive_pokes) then
      poke_result := jsonb_build_object('id',requested_id,'status','unavailable');
    else
      select count(*),min(accepted_at) into sender_count,earliest_sender
        from ppc_private.master_pokes where from_session_id=sender_id and accepted_at > now_at-interval '60 seconds';
      select max(accepted_at) into latest_target from ppc_private.master_pokes
        where from_session_id=sender_id and to_session_id=target_id and accepted_at > now_at-interval '5 seconds';
      if sender_count >= 6 then
        retry_seconds := greatest(1,ceil(extract(epoch from earliest_sender+interval '60 seconds'-now_at))::integer);
      end if;
      if latest_target is not null then
        retry_seconds := greatest(retry_seconds,1,ceil(extract(epoch from latest_target+interval '5 seconds'-now_at))::integer);
      end if;
      if retry_seconds > 0 then
        poke_result := jsonb_build_object('id',requested_id,'status','throttled','retryAfterSeconds',retry_seconds);
      else
        select count(*) into queue_count from ppc_private.master_pokes;
        if queue_count >= 4096 or (select count(*) from ppc_private.master_pokes
          where to_session_id=target_id and not acknowledged) >= 16 then
          poke_result := jsonb_build_object('id',requested_id,'status','unavailable');
        else
          -- Display identity comes only from the current sender's presence row;
          -- any fromSessionId/fromDisplayName fields in the request are ignored.
          select display_name into sender_name from ppc_private.master_presence where session_id=sender_id;
          insert into ppc_private.master_pokes(poke_id,from_session_id,from_display_name,to_session_id,accepted_at)
            values(requested_id,sender_id,sender_name,target_id,now_at);
          poke_result := jsonb_build_object('id',requested_id,'status','queued');
        end if;
      end if;
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('sessionId',session_id,'displayName',display_name,
    'categoryId',category_id,'productId',product_id,'editing',editing,'activity',activity,
    'receivePokes',receive_pokes,'lastSeenAt',touched_at) order by touched_at desc),'[]'::jsonb)
    into roster from ppc_private.master_presence where touched_at > now_at-interval '65 seconds';
  select coalesce(jsonb_agg(jsonb_build_object('id',poke_id,'fromSessionId',from_session_id,
    'fromDisplayName',from_display_name,'toSessionId',to_session_id,'createdAt',accepted_at)
    order by accepted_at,poke_id),'[]'::jsonb) into inbox from (
      select * from ppc_private.master_pokes where to_session_id=sender_id and not acknowledged
        and accepted_at > now_at-interval '90 seconds' order by accepted_at,poke_id limit 16
    ) pending;
  result := jsonb_build_object('sessions',roster,'users',roster,'onlineCount',jsonb_array_length(roster),
    'ttlSeconds',65,'capabilities',jsonb_build_object('pokes',true,'activity',true),'pokes',inbox);
  if poke_result is not null then result := result || jsonb_build_object('poke',poke_result); end if;
  return result;
end;
$$;

revoke all on function public.ppc_master_presence(jsonb) from public, anon, authenticated;
grant execute on function public.ppc_master_presence(jsonb) to service_role;
