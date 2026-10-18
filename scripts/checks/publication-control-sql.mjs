import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// These checks catch lost accepted demand, mutating metadata reads, unsafe owner
// recovery, duplicate dispatches and a result overwriting a newer attempt.
globalThis.fetch = async () => { throw new Error('External fetch forbidden in isolated SQL checks'); };
if (process.env.PPC_REQUIRE_SQL_TESTS === '1' && !process.env.PPC_TEST_PGLITE_MODULE) throw new Error('SQL verification requires PPC_TEST_PGLITE_MODULE');
const { PGlite } = await import(process.env.PPC_TEST_PGLITE_MODULE ? pathToFileURL(resolve(process.env.PPC_TEST_PGLITE_MODULE)).href : '@electric-sql/pglite');
const db = new PGlite();
const migration = '202610180002_publication_prepare_control.sql';
const source = 'a'.repeat(40), owner = 'e'.repeat(40), digest = 'c'.repeat(64);
const ids = Array.from({ length: 8 }, (_, i) => `${String(i + 1).repeat(8)}-${String(i + 1).repeat(4)}-4${String(i + 1).repeat(3)}-8${String(i + 1).repeat(3)}-${String(i + 1).repeat(12)}`);
const call = async (name, payload = {}) => (await db.query(`select public.ppc_package_${name}($1::jsonb) result`, [JSON.stringify(payload)])).rows[0].result;
const master = async (name, payload = {}) => (await db.query(`select public.ppc_master_${name}($1::jsonb) result`, [JSON.stringify(payload)])).rows[0].result;
const status = async (promise, want) => { const result = await promise; assert.equal(result.status, want, JSON.stringify(result)); return result; };
const control = () => call('control');
const reset = async () => {
  await db.exec("truncate ppc_private.publication_prepare_attempt; insert into ppc_private.publication_prepare_attempt(singleton) values(true); truncate ppc_private.package_delivery_receipts,ppc_private.package_delivery_candidates; update ppc_private.package_delivery_state set phase='legacy',generation=0,current_id=null,queued_id=null,cleanup_id=null,drive_id=null,folder_id=null,seed=null; truncate ppc_private.master_state,ppc_private.master_receipts;");
  await master('bootstrap', { manifest: { bb: 2, a: 1 }, sourceSha: source, fingerprint: 'f'.repeat(64) });
  await master('ack', { storageRevision: 1, githubSha: 'b'.repeat(40) });
};
const reserve = async (id = ids[1], ownerImagesCommit = null) => {
  const state = await master('read');
  const generation = (await db.query('select generation from ppc_private.package_delivery_state')).rows[0].generation;
  return (await status(call('reserve', { candidateId: id, expectedGeneration: Number(generation), storageRevision: state.storageRevision, sourceSha: state.sourceSha, manifestSha256: state.acceptedManifestSha256, ownerImagesCommit, sha256: digest, bytes: 40 }), 'reserved')).candidate;
};
const ready = async c => {
  const claim = await call('upload_claim', { candidateId: c.candidateId, generation: c.generation });
  await call('upload_result', { candidateId: c.candidateId, generation: c.generation, attemptId: claim.attemptId, outcome: 'stored' });
  await call('finalize', { candidateId: c.candidateId, generation: c.generation, sha256: c.sha256, bytes: c.bytes, envelopeValid: true }); return c;
};
const confirm = c => call('confirm', { candidateId: c.candidateId, generation: c.generation, receipt: { provider: 'sharepoint', kind: c.kind, candidateId: c.candidateId, generation: c.generation, storageRevision: c.storageRevision, sha256: c.sha256, bytes: c.bytes, driveId: 'drive', folderId: 'folder', itemId: `item-${c.candidateId}`, versionId: c.kind === 'seed' ? '4.0' : '1.0', fileName: c.kind === 'seed' ? 'master_ppc.pkg' : `master-r${c.storageRevision}-g${c.generation}-${c.candidateId}.pkg` } });
const seeded = async () => {
  await reset(); await call('phase', { phase: 'seeding', driveId: 'drive', folderId: 'folder', seed: { storageRevision: 1, sourceSha: source, githubSha: 'b'.repeat(40), sha256: digest, bytes: 36 } });
  const seed = (await call('reserve', { candidateId: ids[0], expectedGeneration: 0, storageRevision: 1, sourceSha: source, manifestSha256: null, ownerImagesCommit: null, sha256: digest, bytes: 36, trustedGithubSha: 'b'.repeat(40) })).candidate;
  await confirm(await ready(seed)); await call('phase', { phase: 'sharepoint' }); return seed;
};
const ordinary = async () => { const seed = await seeded(); const c = await ready(await reserve()); await confirm(c); await call('cleanup', { candidateId: seed.candidateId, generation: 1, absent: true }); return c; };
const commit = async () => { const state = await master('read'); return master('commit', { expectedRevision: state.storageRevision, manifest: { a: state.storageRevision + 2 }, changed: true, sessionId: `session-${state.storageRevision}`, requestId: `request-${state.storageRevision}`, fingerprint: 'd'.repeat(64), savedFields: 1, savedProducts: 1 }); };
const snapshot = async () => (await db.query("select jsonb_build_object('s',(select to_jsonb(s) from ppc_private.master_state s),'d',(select to_jsonb(d) from ppc_private.package_delivery_state d),'p',(select to_jsonb(p) from ppc_private.publication_prepare_attempt p),'c',(select jsonb_agg(to_jsonb(c) order by candidate_id) from ppc_private.package_delivery_candidates c),'r',(select jsonb_agg(to_jsonb(r) order by candidate_id) from ppc_private.package_delivery_receipts r)) value")).rows[0].value;
const expireFence = () => db.exec("update ppc_private.publication_prepare_attempt set lease_until=statement_timestamp()-interval '1 second',next_attempt_at=statement_timestamp()-interval '1 second'");
const claim = (key, id = ids[5]) => call('prepare_claim', { prepareKey: key, attemptId: id });
const tests = [];
const test = (name, run) => tests.push({ name, run });

test('pure_control_finds_seed_demand_and_expired_recovery_without_writes', async () => {
  await seeded(); let before = await snapshot(); let c = await control();
  assert.equal(c.action, 'prepare'); assert.deepEqual(c.intent, { kind: 'ordinary', ownerImagesCommit: null });
  assert.deepEqual(Object.keys(c).sort(), ['version','action','requestedRevision','publishedRevision','generation','prepareKey','retryAt','intent','candidate','binaryPath','holdCode','archiveAllowed'].sort());
  assert.equal(c.archiveAllowed, false); assert.equal(c.candidate, null); assert.equal(c.binaryPath, null); assert.equal(c.retryAt, null);
  assert.deepEqual(await snapshot(), before);
  const candidate = await reserve(); await db.query("update ppc_private.package_delivery_candidates set expires_at=statement_timestamp()-interval '1 second' where candidate_id=$1::uuid", [candidate.candidateId]);
  before = await snapshot(); c = await control(); assert.equal(c.action, 'recover'); assert.deepEqual(await snapshot(), before);
  await db.exec('begin read only'); try { assert.equal((await control()).action, 'recover'); } finally { await db.exec('rollback'); }
});
test('ordinary_idle_and_lost_dispatch_demand_use_stored_source_sha_exact_19_slots', async () => {
  await ordinary(); let c = await control(); assert.equal(c.action, 'idle'); assert.equal(c.prepareKey, null);
  await commit(); c = await control(); assert.equal(c.action, 'prepare');
  // PostgreSQL jsonb emits spaces in arrays. This literal is independent of the projection.
  const expected = `["ppc-publication-prepare-v1", "sharepoint", "${source}", 2, 1, 2, "${ids[1]}", "publication", null, null, null, null, null, null, null, null, null, null, null]`;
  assert.equal(c.prepareKey, createHash('sha256').update(expected).digest('hex'));
  await db.exec("update ppc_private.master_state set manifest='{\"different\":true}',github_sha=repeat('f',40)");
  assert.equal((await control()).prepareKey, c.prepareKey, 'manifest and Git blob are excluded');
  await db.exec("update ppc_private.master_state set source_sha=repeat('b',40)"); assert.notEqual((await control()).prepareKey, c.prepareKey);
});
test('ready_older_publication_wins_then_newer_demand_continues', async () => {
  await seeded(); const candidate = await ready(await reserve()); await commit();
  let c = await control(); assert.equal(c.action, 'deliver'); assert.equal(c.candidate.storageRevision, 1); assert.equal(c.candidate.objectKey, undefined);
  assert.equal(c.binaryPath, `/api/ascm/publication/${candidate.candidateId}/bytes`); assert.equal(c.prepareKey, null);
  assert.deepEqual(Object.keys(c.candidate).sort(), ['candidateId','generation','storageRevision','sha256','bytes','expiresAt','fileName','provider','driveId','folderId'].sort());
  assert.equal(c.candidate.fileName, `master-r1-g2-${candidate.candidateId}.pkg`); assert.equal(c.candidate.driveId, 'drive'); assert.equal(c.candidate.folderId, 'folder');
  await confirm(candidate); c = await control(); assert.equal(c.action, 'recover'); assert.equal(c.requestedRevision, 2); assert.equal(c.publishedRevision, 1);
  await call('cleanup', { candidateId: ids[0], generation: 1, absent: true }); assert.equal((await control()).action, 'prepare');
});
test('uninitialized_phase_current_and_invalid_source_hold_closed', async () => {
  await reset(); assert.equal((await control()).holdCode, 'PHASE_NOT_READY');
  await db.exec("update ppc_private.package_delivery_state set phase='sharepoint'"); assert.equal((await control()).holdCode, 'CURRENT_MISSING');
  await db.exec('truncate ppc_private.master_state'); assert.equal((await control()).holdCode, 'STATE_INVALID');
  await seeded(); await db.exec("alter table ppc_private.master_state drop constraint master_state_source_sha_check; update ppc_private.master_state set source_sha='invalid'");
  assert.equal((await control()).holdCode, 'STATE_INVALID');
  await db.exec("update ppc_private.master_state set source_sha=repeat('a',40); alter table ppc_private.master_state add constraint master_state_source_sha_check check(source_sha ~ '^[a-f0-9]{40}$')");
});
test('owner_queued_and_cleanup_key_slots_are_exact_and_transient_upload_does_not_reset_key', async () => {
  await ordinary(); const q = await reserve(ids[2], owner);
  const literal = `["ppc-publication-prepare-v1", "sharepoint", "${source}", 1, 1, 2, "${ids[1]}", "publication", null, "${ids[2]}", 3, "${owner}", null, null, null, "${ids[2]}", "${owner}", "${source}", 1]`;
  const c = await control(); assert.equal(c.prepareKey, createHash('sha256').update(literal).digest('hex'));
  await call('upload_claim', { candidateId: q.candidateId, generation: q.generation }); assert.equal((await control()).prepareKey, c.prepareKey);
  await db.query("update ppc_private.package_delivery_candidates set expires_at=statement_timestamp()-interval '1 second' where candidate_id=$1::uuid", [q.candidateId]); await call('current');
  const cleanupLiteral = `["ppc-publication-prepare-v1", "sharepoint", "${source}", 1, 1, 2, "${ids[1]}", "publication", null, null, null, null, "${ids[2]}", 3, "${owner}", "${ids[2]}", "${owner}", "${source}", 1]`;
  assert.equal((await control()).prepareKey, createHash('sha256').update(cleanupLiteral).digest('hex'));
});
test('owner_latch_survives_expiry_cleanup_fresh_identity_and_matching_receipt', async () => {
  await ordinary(); const candidate = await reserve(ids[2], owner); let c = await control(); assert.equal(c.intent.ownerImagesCommit, owner);
  await db.query("update ppc_private.package_delivery_candidates set expires_at=statement_timestamp()-interval '1 second' where candidate_id=$1::uuid", [candidate.candidateId]);
  await call('current'); await call('cleanup', { candidateId: candidate.candidateId, generation: candidate.generation, absent: true });
  c = await control(); assert.equal(c.action, 'prepare'); assert.equal(c.requestedRevision, c.publishedRevision); assert.equal(c.intent.ownerImagesCommit, owner);
  const fresh = await ready(await reserve(ids[3], owner)); await confirm(fresh);
  assert.equal((await db.query('select owner_candidate_id from ppc_private.publication_prepare_attempt')).rows[0].owner_candidate_id, null);
  await call('cleanup', { candidateId: ids[1], generation: 2, absent: true }); assert.equal((await control()).action, 'idle');
});
test('conflicting_owner_intent_holds_even_ready_and_never_overwrites_latch', async () => {
  await ordinary(); await reserve(ids[2], owner); await ready(await reserve(ids[3], 'f'.repeat(40)));
  const c = await control(); assert.equal(c.action, 'held'); assert.equal(c.holdCode, 'OWNER_INTENT_UNKNOWN');
  assert.equal((await db.query('select owner_commit from ppc_private.publication_prepare_attempt')).rows[0].owner_commit, owner);
});
test('published_owner_cleanup_is_settled_history_and_not_unknown_intent', async () => {
  await ordinary(); const ownerCandidate = await ready(await reserve(ids[2], owner)); await confirm(ownerCandidate);
  await call('cleanup', { candidateId: ids[1], generation: 2, absent: true });
  const next = await ready(await reserve(ids[3])); await confirm(next);
  assert.equal((await control()).action, 'recover');
  await call('cleanup', { candidateId: ownerCandidate.candidateId, generation: 3, absent: true }); assert.equal((await control()).action, 'idle');
});
test('backfill_only_unique_outstanding_recorded_owner_intent_and_replay_preserves_state', async () => {
  await ordinary(); await reserve(ids[2], owner);
  await db.exec('truncate ppc_private.publication_prepare_attempt'); await db.exec(await readFile(resolve('supabase/migrations', migration), 'utf8'));
  assert.equal((await control()).intent.ownerImagesCommit, owner);
  let before = await snapshot(); await db.exec(await readFile(resolve('supabase/migrations', migration), 'utf8')); assert.deepEqual(await snapshot(), before);
  await reserve(ids[3], 'f'.repeat(40)); await db.exec('truncate ppc_private.publication_prepare_attempt'); await db.exec(await readFile(resolve('supabase/migrations', migration), 'utf8'));
  assert.equal((await control()).holdCode, 'OWNER_INTENT_UNKNOWN');
});
test('lease_cooldown_failed_uncertain_and_three_attempt_window_preserve_demand', async () => {
  await ordinary(); await commit(); const key = (await control()).prepareKey;
  let result = await status(claim(key), 'claimed');
  const serverTime = Date.parse((await db.query('select statement_timestamp() moment')).rows[0].moment);
  assert(Math.abs(Date.parse(result.leaseUntil) - serverTime - 60000) < 1000);
  assert(Math.abs(Date.parse(result.retryAt) - serverTime - 900000) < 1000);
  assert.equal(Date.parse(result.retryAt) - Date.parse(result.leaseUntil), 840000);
  await status(claim(key, ids[6]), 'busy');
  await status(call('prepare_result', { prepareKey: key, attemptId: ids[6], outcome: 'accepted' }), 'stale');
  result = await status(call('prepare_result', { prepareKey: key, attemptId: ids[5], outcome: 'failed' }), 'failed');
  assert.equal((await control()).action, 'backoff'); assert.equal((await control()).retryAt, result.retryAt);
  await status(claim(key, ids[6]), 'backoff'); await expireFence();
  await status(claim(key, ids[6]), 'claimed'); await status(call('prepare_result', { prepareKey: key, attemptId: ids[5], outcome: 'accepted' }), 'stale');
  await status(call('prepare_result', { prepareKey: key, attemptId: ids[6], outcome: 'uncertain' }), 'uncertain'); await expireFence();
  await status(claim(key, ids[7]), 'claimed'); await expireFence();
  const exhausted = await control(); assert.equal(exhausted.action, 'backoff'); assert.equal(exhausted.holdCode, 'PREPARE_ATTEMPTS_EXHAUSTED');
  await status(claim(key), 'backoff');
  await db.exec("update ppc_private.publication_prepare_attempt set window_started_at=statement_timestamp()-interval '25 hours'");
  await status(claim(key), 'claimed'); assert.equal((await db.query('select attempt_count from ppc_private.publication_prepare_attempt')).rows[0].attempt_count, 1);
  assert.equal((await master('read')).publication.publishedRevision, 1);
});
test('simultaneous_claims_have_one_owner_and_accepted_result_preserves_demand', async () => {
  await ordinary(); await commit(); const key = (await control()).prepareKey;
  const results = await Promise.all([claim(key, ids[5]), claim(key, ids[6])]);
  assert.deepEqual(results.map(r => r.status).sort(), ['busy','claimed']);
  const winner = results.find(r => r.status === 'claimed');
  await status(call('prepare_result', { prepareKey: key, attemptId: winner.attemptId, outcome: 'accepted' }), 'accepted');
  assert.equal((await control()).action, 'backoff'); assert.equal((await control()).requestedRevision, 2); assert.equal((await control()).publishedRevision, 1);
});
test('changed_key_observes_global_fences_then_resets_budget_and_stale_key_cannot_claim', async () => {
  await ordinary(); await commit(); const first = (await control()).prepareKey; await status(claim(first), 'claimed'); await commit();
  const changed = await control(); assert.notEqual(changed.prepareKey, first); assert.equal(changed.action, 'backoff');
  await status(claim(first), 'stale'); await status(claim(changed.prepareKey, ids[6]), 'busy'); await expireFence();
  await status(claim(changed.prepareKey, ids[6]), 'claimed'); assert.equal((await db.query('select attempt_count from ppc_private.publication_prepare_attempt')).rows[0].attempt_count, 1);
  await status(call('prepare_result', { prepareKey: first, attemptId: ids[5], outcome: 'uncertain' }), 'stale');
});
test('ready_and_idle_bypass_dispatch_fences_and_claim_never_dispatches_them', async () => {
  await seeded(); let key = (await control()).prepareKey; await claim(key); await ready(await reserve());
  assert.equal((await control()).action, 'deliver'); await status(claim(key), 'not_needed');
  await ordinary(); await db.exec("update ppc_private.publication_prepare_attempt set next_attempt_at=statement_timestamp()+interval '1 hour'");
  assert.equal((await control()).action, 'idle'); await status(claim('f'.repeat(64)), 'not_needed');
});
test('strict_payloads_and_service_only_rpc_and_table_boundaries', async () => {
  await seeded(); const key = (await control()).prepareKey;
  for (const payload of [null, [], { extra: true }]) await assert.rejects(() => call('control', payload), /Invalid publication control/);
  for (const payload of [{ prepareKey: key, attemptId: 'AAAAAAAA-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, { prepareKey: key, attemptId: ids[5], extra: true }, { prepareKey: 'F'.repeat(64), attemptId: ids[5] }]) await assert.rejects(() => call('prepare_claim', payload), /Invalid publication prepare/);
  for (const outcome of ['stored', null, 1]) await assert.rejects(() => call('prepare_result', { prepareKey: key, attemptId: ids[5], outcome }), /Invalid publication prepare/);
  const row = (await db.query("select relrowsecurity rls from pg_class where oid='ppc_private.publication_prepare_attempt'::regclass")).rows[0]; assert.equal(row.rls, true);
  for (const name of ['control','prepare_claim','prepare_result']) {
    const info = (await db.query(`select provolatile,prosecdef,has_function_privilege('service_role',oid,'execute') service,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') authenticated from pg_proc where oid='public.ppc_package_${name}(jsonb)'::regprocedure`)).rows[0];
    assert.equal(info.service, true); assert.equal(info.anon, false); assert.equal(info.authenticated, false); assert.equal(info.prosecdef, true); if (name === 'control') assert.equal(info.provolatile, 's');
    for (const role of ['anon','authenticated','supabase_auth_admin']) { await db.exec(`set role ${role}`); await assert.rejects(() => call(name), /permission denied/); await db.exec('reset role'); }
  }
  for (const name of ['publication_control','publication_owner_reserved','publication_owner_confirmed']) {
    const permissions = (await db.query(`select has_function_privilege('service_role','ppc_private.${name}()','execute') service,has_function_privilege('anon','ppc_private.${name}()','execute') anon`)).rows[0];
    assert.equal(permissions.service, false); assert.equal(permissions.anon, false);
  }
  await db.exec('set role service_role'); await assert.rejects(() => db.exec('select * from ppc_private.publication_prepare_attempt'), /permission denied/); await db.exec('reset role');
});
try {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid primary key,bucket_id text); alter table storage.objects enable row level security;');
  for (const name of (await readdir(resolve('supabase/migrations'))).filter(name => name.endsWith('.sql') && name <= migration).sort()) await db.exec(await readFile(resolve('supabase/migrations', name), 'utf8'));
  assert.equal((await db.query("select to_regprocedure('public.ppc_package_control(jsonb)') is not null available")).rows[0].available, true, 'Durable publication control RPC must exist to find accepted work without dispatch');
  const failures = [];
  for (const { name, run } of tests) { try { await run(); console.log(`PASS ${name}`); } catch (error) { failures.push(error); console.error(`FAIL ${name}: ${error.message}`); } }
  if (failures.length) throw new AggregateError(failures, `${failures.length} publication control SQL checks failed`);
  console.log(`Publication control SQL passed: ${tests.length}/${tests.length}, real isolated PGlite; external fetch blocked.`);
} catch (error) { console.error(error.message); process.exitCode = 1; } finally { await db.close(); }
