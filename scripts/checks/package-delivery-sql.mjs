import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const migration = '202610170005_package_delivery.sql';
let sql;
try { sql = await readFile(resolve('supabase/migrations', migration), 'utf8'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
assert.equal(typeof sql, 'string', 'Package delivery requires its private transactional migration');
if (process.env.PPC_REQUIRE_SQL_TESTS === '1' && !process.env.PPC_TEST_PGLITE_MODULE) throw new Error('SQL verification requires PPC_TEST_PGLITE_MODULE.');
const { PGlite } = await import(process.env.PPC_TEST_PGLITE_MODULE ? pathToFileURL(resolve(process.env.PPC_TEST_PGLITE_MODULE)).href : '@electric-sql/pglite');
const db = new PGlite();
const applyForwardMigrations = async () => {
  for (const name of (await readdir(resolve('supabase/migrations'))).filter(name => name.endsWith('.sql') && name > migration).sort()) await db.exec(await readFile(resolve('supabase/migrations', name), 'utf8'));
};
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
const source = 'a'.repeat(40), blob = 'b'.repeat(40), digest = 'c'.repeat(64), ownerA = 'a'.repeat(40), ownerB = 'b'.repeat(40);
const call = async (name, payload = {}) => (await db.query(`select public.ppc_package_${name}($1::jsonb) as result`, [JSON.stringify(payload)])).rows[0].result;
const master = async (name, payload = {}) => (await db.query(`select public.ppc_master_${name}($1::jsonb) as result`, [JSON.stringify(payload)])).rows[0].result;
const expectStatus = async (promise, status) => { const result = await promise; assert.equal(result.status, status, JSON.stringify(result)); return result; };
const phaseSeed = () => call('phase', { phase: 'seeding', driveId: 'drive', folderId: 'folder', seed: { storageRevision: 1, sourceSha: source, githubSha: blob, sha256: digest, bytes: 36 } });
const reset = async () => {
  await db.exec('truncate ppc_private.package_delivery_receipts,ppc_private.package_delivery_candidates; update ppc_private.package_delivery_state set phase=\'legacy\',generation=0,current_id=null,queued_id=null,cleanup_id=null,drive_id=null,folder_id=null,seed=null; truncate ppc_private.master_state,ppc_private.master_receipts;');
  await master('bootstrap', { manifest: { bb: 2, a: 1 }, sourceSha: source, fingerprint: 'f'.repeat(64) });
  await master('ack', { storageRevision: 1, githubSha: blob });
};
const seedMeta = (candidateId = ids[0]) => ({ candidateId, expectedGeneration: 0, storageRevision: 1, sourceSha: source, manifestSha256: null, ownerImagesCommit: null, sha256: digest, bytes: 36, trustedGithubSha: blob });
const publicationMeta = async (candidateId = ids[1], patch = {}) => ({ candidateId, expectedGeneration: 1, storageRevision: (await master('read')).storageRevision, sourceSha: source, manifestSha256: (await master('read')).acceptedManifestSha256, ownerImagesCommit: null, sha256: 'd'.repeat(64), bytes: 40, ...patch });
const reserve = async meta => (await expectStatus(call('reserve', meta), 'reserved')).candidate;
const ready = async candidate => {
  const claim = await expectStatus(call('upload_claim', { candidateId: candidate.candidateId, generation: candidate.generation }), 'claimed');
  await expectStatus(call('upload_result', { candidateId: candidate.candidateId, generation: candidate.generation, attemptId: claim.attemptId, outcome: 'stored' }), 'stored');
  await expectStatus(call('finalize', { candidateId: candidate.candidateId, generation: candidate.generation, sha256: candidate.sha256, bytes: candidate.bytes, envelopeValid: true }), 'ready');
  return candidate;
};
const receipt = candidate => ({ provider: 'sharepoint', kind: candidate.kind, candidateId: candidate.candidateId, generation: candidate.generation,
  storageRevision: candidate.storageRevision, sha256: candidate.sha256, bytes: candidate.bytes, driveId: 'drive', folderId: 'folder',
  itemId: `connector-${candidate.candidateId}`, versionId: candidate.kind === 'seed' ? '4.0' : '1.0',
  fileName: candidate.kind === 'seed' ? 'master_ppc.pkg' : `master-r${candidate.storageRevision}-g${candidate.generation}-${candidate.candidateId}.pkg`, confirmedAt: '2026-10-17T12:00:00.000Z' });
const confirm = (candidate, patch = {}) => call('confirm', { candidateId: candidate.candidateId, generation: candidate.generation, receipt: { ...receipt(candidate), ...patch } });
const seeded = async () => { await reset(); await phaseSeed(); const candidate = await ready(await reserve(seedMeta())); await expectStatus(confirm(candidate), 'published'); await call('phase', { phase: 'sharepoint' }); return candidate; };
const commit = async () => master('commit', { expectedRevision: 1, manifest: { a: 3, bb: 2 }, changed: true, sessionId: 'session-proof', requestId: 'request-proof', fingerprint: 'e'.repeat(64), savedFields: 1, savedProducts: 1 });
const tests = [];
const test = (name, run) => tests.push({ name, run });

test('native_jsonb_manifest_digest', async () => {
  await reset();
  assert.equal((await db.query("select encode(sha256(convert_to('abc','UTF8')),'hex') as digest")).rows[0].digest, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const exported = await master('read');
  assert.equal(exported.acceptedManifestSha256, createHash('sha256').update('{"a": 1, "bb": 2}').digest('hex'));
  assert.equal(exported.publication.githubSha, blob);
  await phaseSeed(); assert.equal((await master('read')).publication.githubSha, undefined);
});
test('candidate_slot_and_generation', async () => {
  await seeded(); const meta = await publicationMeta(); const candidate = await reserve(meta);
  assert.equal(candidate.generation, 2); assert.equal(candidate.expectedGeneration, 1); assert.equal(candidate.kind, 'publication');
  assert.equal(candidate.objectKey, `packages/${ids[1]}.pkg`); assert.equal(Date.parse(candidate.expiresAt) - Date.parse(candidate.createdAt), 10800000);
  await call('upload_claim', { candidateId: candidate.candidateId, generation: 2 });
  await expectStatus(call('reserve', { ...meta, candidateId: ids[2] }), 'busy');
  await expectStatus(call('reserve', { ...meta, expectedGeneration: 0 }), 'stale');
  await commit(); await db.exec('update ppc_private.package_delivery_candidates set expires_at=clock_timestamp()-interval \'1 second\' where candidate_id=\'' + ids[1] + '\'');
  await call('current'); await expectStatus(call('reserve', await publicationMeta(ids[2])), 'cleanup_required');
  const expired = await call('current');
  await call('phase', { reconcile: { candidateId: ids[1], generation: 2, attemptId: expired.cleanupUpload.attemptId, outcome: 'absent' }, settled: true });
  await expectStatus(call('cleanup', { candidateId: ids[1], generation: 2, absent: true }), 'cleaned');
  await expectStatus(call('reserve', { ...await publicationMeta(ids[2]), manifestSha256: meta.manifestSha256 }), 'accepted_changed');
  await expectStatus(call('reserve', { ...await publicationMeta(ids[2]), storageRevision: 1 }), 'accepted_changed');
});
test('receipt_provider_gate', async () => {
  await seeded(); const candidate = await ready(await reserve(await publicationMeta()));
  for (const patch of [{ provider: 'github' }, { driveId: 'other' }, { folderId: 'other' }, { fileName: 'master_ppc.pkg' }, { sha256: digest }, { kind: 'seed' }, { itemId: '' }]) await assert.rejects(() => confirm(candidate, patch), /Invalid package receipt/);
  await expectStatus(confirm(candidate), 'published');
  const state = await master('read'); assert.equal(state.publication.provider, 'sharepoint'); assert.equal(state.publication.kind, 'publication');
  assert.equal(state.publication.storageRevision, 1);
  for (const key of ['manifest', 'objectKey', 'driveId', 'folderId', 'manifestSha256', 'downloadUrl']) assert.equal(state.publication[key], undefined);
  await expectStatus(master('ack', { storageRevision: 1, githubSha: 'e'.repeat(40) }), 'delivery_managed');
});
test('same_revision_owner_update', async () => {
  await seeded(); const candidate = await ready(await reserve(await publicationMeta(ids[1], { ownerImagesCommit: ownerA })));
  await expectStatus(confirm(candidate), 'published');
  assert.equal((await master('read')).storageRevision, 1);
  await expectStatus(call('reserve', await publicationMeta(ids[2], { expectedGeneration: 2, ownerImagesCommit: ownerB, sha256: 'e'.repeat(64) })), 'cleanup_required');
  await expectStatus(call('cleanup', { candidateId: ids[0], generation: 1, absent: true }), 'cleaned');
  const next = await reserve(await publicationMeta(ids[2], { expectedGeneration: 2, ownerImagesCommit: ownerB, sha256: 'e'.repeat(64) })); assert.equal(next.generation, 3);
});
test('owner_commit_retry_identity', async () => {
  await seeded(); const meta = await publicationMeta(ids[1], { ownerImagesCommit: ownerB }); await reserve(meta);
  await expectStatus(call('reserve', meta), 'existing');
  for (const patch of [{ ownerImagesCommit: ownerA }, { ownerImagesCommit: null }, { sha256: digest }, { bytes: 41 }, { sourceSha: 'f'.repeat(40) }, { manifestSha256: digest }]) await expectStatus(call('reserve', { ...meta, ...patch }), 'retry_mismatch');
  await call('upload_claim', { candidateId: ids[1], generation: 2 });
  await expectStatus(call('reserve', { ...meta, candidateId: ids[2], ownerImagesCommit: ownerA }), 'busy');
});

test('validated_unclaimed_replacement_fences_old_identity_without_consuming_generation', async () => {
  await seeded(); const metadata = await publicationMeta(); const old = await reserve(metadata);
  const next = await reserve({ ...metadata, candidateId: ids[2], sha256: 'e'.repeat(64), bytes: 44 });
  assert.equal(next.generation, 2); assert.equal(next.expectedGeneration, 1);
  const state = await call('current');
  assert.equal(state.generation, 1); assert.equal(state.queued.candidateId, ids[2]); assert.equal(state.cleanup, null);
  await expectStatus(call('upload_claim', { candidateId: old.candidateId, generation: 2 }), 'stale');
  await expectStatus(call('reserve', metadata), 'stale');
  const retired = (await db.query('select status,sha256,bytes,upload_state from ppc_private.package_delivery_candidates where candidate_id=$1::uuid', [old.candidateId])).rows[0];
  assert.deepEqual(retired, { status: 'cleanup', sha256: 'd'.repeat(64), bytes: 40, upload_state: 'none' });
  await ready(next); await expectStatus(confirm(next), 'published');
  assert.equal((await call('current')).generation, 2);
});

test('replacement_validates_fresh_accepted_metadata_before_retiring_queued_candidate', async () => {
  await seeded(); const oldMeta = await publicationMeta(); const old = await reserve(oldMeta);
  await commit(); const fresh = await publicationMeta(ids[2]);
  for (const patch of [{ storageRevision: 1 }, { manifestSha256: oldMeta.manifestSha256 }, { sourceSha: 'f'.repeat(40) }]) {
    await expectStatus(call('reserve', { ...fresh, ...patch }), 'accepted_changed');
    assert.equal((await call('current')).queued.candidateId, old.candidateId);
  }
  await expectStatus(call('reserve', { ...fresh, expectedGeneration: 0 }), 'stale');
  await assert.rejects(() => call('reserve', { ...fresh, bytes: '44' }), /Invalid package reservation/);
  assert.equal((await call('current')).queued.candidateId, old.candidateId);
  assert.equal((await reserve(fresh)).storageRevision, 2);
  await expectStatus(call('upload_claim', { candidateId: old.candidateId, generation: 2 }), 'stale');
});

test('claim_wins_holds_replacement_until_proven_settled_absent_and_fences_old_attempt', async () => {
  await seeded(); const old = await reserve(await publicationMeta());
  const claim = await expectStatus(call('upload_claim', { candidateId: old.candidateId, generation: 2 }), 'claimed');
  const fresh = await publicationMeta(ids[2], { sha256: 'e'.repeat(64) });
  await expectStatus(call('reserve', fresh), 'busy');
  assert.equal((await call('current')).queued.candidateId, old.candidateId);
  await call('upload_result', { candidateId: old.candidateId, generation: 2, attemptId: claim.attemptId, outcome: 'uncertain' });
  await expectStatus(call('reserve', fresh), 'busy');
  await call('phase', { reconcile: { candidateId: old.candidateId, generation: 2, attemptId: claim.attemptId, outcome: 'absent' }, settled: true });
  await reserve(fresh);
  await expectStatus(call('upload_claim', { candidateId: old.candidateId, generation: 2 }), 'stale');
  await expectStatus(call('upload_result', { candidateId: old.candidateId, generation: 2, attemptId: claim.attemptId, outcome: 'stored' }), 'stale');
});

test('ready_or_stored_candidates_cannot_be_retired_by_reservation', async () => {
  await seeded(); const old = await ready(await reserve(await publicationMeta()));
  await expectStatus(call('reserve', await publicationMeta(ids[2])), 'busy');
  assert.equal((await call('current')).queued.candidateId, old.candidateId);
  await db.query("update ppc_private.package_delivery_candidates set status='reserved' where candidate_id=$1::uuid", [old.candidateId]);
  await expectStatus(call('reserve', await publicationMeta(ids[2])), 'busy');
});
test('published_seed_with_newer_accepted_facts', async () => {
  await reset(); await commit(); const facts = (await master('read')).manifest; await phaseSeed(); const seed = await ready(await reserve(seedMeta()));
  assert.equal(seed.manifestSha256, null); await expectStatus(confirm(seed), 'published');
  const state = await master('read'); assert.deepEqual(state.manifest, facts); assert.equal(state.storageRevision, 2); assert.equal(state.publication.publishedRevision, 1); assert.equal(state.publication.status, 'pending');
  assert.equal((await db.query('select github_sha from ppc_private.master_state')).rows[0].github_sha, blob);
  await call('phase', { phase: 'sharepoint' }); const ordinary = await reserve(await publicationMeta()); assert.equal(ordinary.storageRevision, 2); assert.equal(ordinary.kind, 'publication');
});
test('seed_trusted_blob_mismatch', async () => {
  await reset(); await assert.rejects(() => call('phase', { phase: 'seeding', driveId: 'drive', folderId: 'folder', seed: { storageRevision: 1, sourceSha: source, githubSha: 'f'.repeat(40), sha256: digest, bytes: 36 } }), /Seed does not match trusted publication/);
  await phaseSeed(); await expectStatus(call('reserve', { ...seedMeta(), trustedGithubSha: 'f'.repeat(40) }), 'seed_mismatch');
  await expectStatus(call('reserve', { ...seedMeta(), sha256: 'd'.repeat(64) }), 'seed_mismatch');
  await assert.rejects(() => call('reserve', { ...seedMeta(), kind: 'publication' }), /Invalid package reservation/);
  await expectStatus(call('reserve', { ...seedMeta(), manifestSha256: digest }), 'seed_mismatch');
});
test('seed_cannot_qualify_archive', async () => {
  await seeded(); const state = await master('read');
  const { qualifiesSharePointPublication } = await import('../../supabase/functions/ppc-master/package-delivery-contract.mjs');
  assert.equal(state.publication.storageRevision, 1); assert.equal(state.publication.kind, 'seed'); assert.equal(qualifiesSharePointPublication(state.publication, 1), false);
});
test('expiry_cleanup_lock', async () => {
  await seeded(); const candidate = await reserve(await publicationMeta());
  const claim = await call('upload_claim', { candidateId: candidate.candidateId, generation: 2 }); assert.match(claim.attemptId, /^[a-f0-9-]{36}$/);
  await expectStatus(call('upload_claim', { candidateId: candidate.candidateId, generation: 2 }), 'upload_busy');
  await expectStatus(call('upload_result', { candidateId: candidate.candidateId, generation: 2, attemptId: ids[0], outcome: 'absent' }), 'stale');
  await db.query('update ppc_private.package_delivery_candidates set expires_at=clock_timestamp()-interval \'1 second\' where candidate_id=$1::uuid', [candidate.candidateId]);
  await call('current'); await expectStatus(call('cleanup', { candidateId: candidate.candidateId, generation: 2, absent: true }), 'upload_unsettled');
  await call('upload_result', { candidateId: candidate.candidateId, generation: 2, attemptId: claim.attemptId, outcome: 'uncertain' });
  await expectStatus(call('upload_result', { candidateId: candidate.candidateId, generation: 2, attemptId: claim.attemptId, outcome: 'absent' }), 'upload_unsettled');
  await expectStatus(call('cleanup', { candidateId: candidate.candidateId, generation: 2, absent: true }), 'upload_unsettled');
  await expectStatus(call('reserve', await publicationMeta(ids[2])), 'cleanup_required');
  await call('phase', { reconcile: { candidateId: candidate.candidateId, generation: 2, attemptId: claim.attemptId, outcome: 'absent' }, settled: true });
  await expectStatus(call('cleanup', { candidateId: candidate.candidateId, generation: 2, absent: true }), 'cleaned');
  await reserve(await publicationMeta(ids[2]));
  await expectStatus(call('upload_result', { candidateId: candidate.candidateId, generation: 2, attemptId: claim.attemptId, outcome: 'stored' }), 'stale');
});
test('immutable_retry', async () => {
  await seeded(); const candidate = await ready(await reserve(await publicationMeta())); const published = await confirm(candidate);
  await db.query('update ppc_private.package_delivery_candidates set expires_at=clock_timestamp()-interval \'1 second\' where candidate_id=$1::uuid', [candidate.candidateId]);
  const repeated = await expectStatus(confirm(candidate), 'already_published'); assert.deepEqual(repeated.publication, published.publication);
  await assert.rejects(() => confirm(candidate, { versionId: 'changed' }), /Conflicting package receipt/);
  await assert.rejects(() => db.exec('update ppc_private.package_delivery_receipts set receipt=\'{}\'::jsonb'), /immutable/i);
  await assert.rejects(() => db.exec('delete from ppc_private.package_delivery_receipts'), /immutable/i);
  assert.equal((await db.query('select count(*)::integer n from ppc_private.package_delivery_receipts')).rows[0].n, 2);
});
test('same_transaction_accepted_export_race', async () => {
  await seeded(); const stale = await publicationMeta();
  await db.transaction(async tx => {
    await tx.query('select public.ppc_master_commit($1::jsonb)', [JSON.stringify({ expectedRevision: 1, manifest: { a: 99 }, changed: true, sessionId: 'race-session', requestId: 'race-request', fingerprint: 'e'.repeat(64), savedFields: 1, savedProducts: 1 })]);
    const result = (await tx.query('select public.ppc_package_reserve($1::jsonb) as result', [JSON.stringify(stale)])).rows[0].result;
    assert.equal(result.status, 'accepted_changed', 'the reservation transaction must compare the locked current accepted export');
  });
  assert.deepEqual((await master('read')).manifest, { a: 99 }); assert.equal((await call('current')).queued, null);
});
test('verification_and_attempt_fencing', async () => {
  await seeded(); const candidate = await reserve(await publicationMeta());
  await expectStatus(call('finalize', { candidateId: candidate.candidateId, generation: 2, sha256: candidate.sha256, bytes: candidate.bytes, envelopeValid: true }), 'upload_unsettled');
  const first = await call('upload_claim', { candidateId: candidate.candidateId, generation: 2 });
  await call('upload_result', { candidateId: candidate.candidateId, generation: 2, attemptId: first.attemptId, outcome: 'absent' });
  const second = await call('upload_claim', { candidateId: candidate.candidateId, generation: 2 }); assert.notEqual(second.attemptId, first.attemptId);
  await expectStatus(call('upload_result', { candidateId: candidate.candidateId, generation: 2, attemptId: first.attemptId, outcome: 'stored' }), 'stale');
  await call('upload_result', { candidateId: candidate.candidateId, generation: 2, attemptId: second.attemptId, outcome: 'stored' });
  await assert.rejects(() => call('finalize', { candidateId: candidate.candidateId, generation: 2, sha256: digest, bytes: candidate.bytes, envelopeValid: true }), /verification mismatch/);
  await assert.rejects(() => call('finalize', { candidateId: candidate.candidateId, generation: 2, sha256: candidate.sha256, bytes: candidate.bytes + 1, envelopeValid: true }), /verification mismatch/);
  await assert.rejects(() => call('finalize', { candidateId: candidate.candidateId, generation: 2, sha256: candidate.sha256, bytes: candidate.bytes, envelopeValid: false }), /Invalid package verification/);
  assert.equal((await call('current')).queued.status, 'reserved');
  await call('finalize', { candidateId: candidate.candidateId, generation: 2, sha256: candidate.sha256, bytes: candidate.bytes, envelopeValid: true });
  const confirmations = await Promise.all([confirm(candidate), confirm(candidate)]);
  assert.deepEqual(confirmations.map(value => value.status).sort(), ['already_published', 'published']);
  await expectStatus(call('cleanup', { candidateId: ids[0], generation: 1, absent: false }), 'not_absent');
  assert.equal((await call('current')).cleanup.candidateId, ids[0]);
  await expectStatus(call('cleanup', { candidateId: ids[1], generation: 2, absent: true }), 'stale');
});
test('strict_metadata_and_receipt_uniqueness', async () => {
  await seeded(); const metadata = await publicationMeta();
  for (const patch of [{ sha256: 1e63 }, { sourceSha: 1e39 }, { ownerImagesCommit: 1e39 }, { manifestSha256: 1e63 }, { bytes: '40' }, { expectedGeneration: '1' }, { trustedGithubSha: blob }]) await assert.rejects(() => call('reserve', { ...metadata, ...patch }), /Invalid package reservation/);
  const candidate = await ready(await reserve(metadata));
  for (const patch of [{ itemId: ' ' }, { itemId: ' padded ' }, { versionId: ' padded ' }]) await assert.rejects(() => confirm(candidate, patch), /Invalid package receipt/);
  await assert.rejects(() => confirm(candidate, { itemId: `connector-${ids[0]}`, versionId: '4.0' }), /unique|duplicate/i);
  await expectStatus(confirm(candidate), 'published');
});
test('activation_guards_and_ready_expiry', async () => {
  await reset(); await assert.rejects(() => call('phase', { phase: 'sharepoint' }), /Verified seed required/);
  await db.exec('alter schema storage rename to storage_fixture');
  await assert.rejects(() => phaseSeed(), /activation requires Storage/);
  await db.exec('alter schema storage_fixture rename to storage');
  await phaseSeed(); await db.exec(sql); await applyForwardMigrations(); assert.equal((await call('current')).phase, 'seeding', 'migration replay cannot reset operator state');
  const seed = await ready(await reserve(seedMeta()));
  await db.query('update ppc_private.package_delivery_candidates set expires_at=clock_timestamp()-interval \'1 second\' where candidate_id=$1::uuid', [seed.candidateId]);
  await expectStatus(confirm(seed), 'stale'); const state = await call('current');
  assert.equal(state.current, null); assert.equal(state.cleanup.candidateId, seed.candidateId); assert.equal(state.cleanupUpload.state, 'stored');
  await expectStatus(call('reserve', seedMeta(ids[1])), 'cleanup_required');
});
test('activation_rejects_unreviewed_object_policies', async () => {
  await reset();
  await db.exec('alter table storage.objects disable row level security');
  await assert.rejects(() => phaseSeed(), /activation requires Storage object RLS/);
  assert.equal((await call('current')).phase, 'legacy');
  await db.exec('alter table storage.objects enable row level security');
  for (const [role, command, clause] of [
    ['public', 'select', "using (bucket_id='ppc-package-delivery')"],
    ['anon', 'insert', "with check (bucket_id='ppc-package-delivery')"],
    ['authenticated', 'update', 'using (true) with check (true)'],
    ['authenticated', 'delete', 'using (true)'],
    ['public', 'all', 'using (true) with check (true)'],
    ['authenticated', 'select', "using (bucket_id='unrelated-existing-bucket')"],
  ]) {
    await db.exec(`create policy fixture_exposure on storage.objects for ${command} to ${role} ${clause}`);
    await assert.rejects(() => phaseSeed(), /activation requires reviewed Storage object policies/);
    assert.equal((await call('current')).phase, 'legacy');
    assert.equal((await db.query("select count(*)::integer n from pg_policies where schemaname='storage' and tablename='objects' and policyname='fixture_exposure'")).rows[0].n, 1, 'activation must not alter existing policies');
    await db.exec('drop policy fixture_exposure on storage.objects');
  }
  await db.exec('create role fixture_storage_reader; grant fixture_storage_reader to anon; create policy fixture_inherited_exposure on storage.objects for select to fixture_storage_reader using (true)');
  await assert.rejects(() => phaseSeed(), /activation requires reviewed Storage object policies/);
  await db.exec('drop policy fixture_inherited_exposure on storage.objects; revoke fixture_storage_reader from anon; drop role fixture_storage_reader');
  await db.exec('alter table storage.objects rename to objects_fixture');
  await assert.rejects(() => phaseSeed(), /activation requires Storage object RLS/);
  await db.exec('alter table storage.objects_fixture rename to objects');
  await phaseSeed(); const seed = await ready(await reserve(seedMeta())); await confirm(seed);
  await db.exec('create policy fixture_exposure on storage.objects for select to anon using (true)');
  await assert.rejects(() => call('phase', { phase: 'sharepoint' }), /activation requires reviewed Storage object policies/);
  assert.equal((await call('current')).phase, 'seeding');
  await db.exec('drop policy fixture_exposure on storage.objects');
  await expectStatus(call('phase', { phase: 'sharepoint' }), 'configured');
});
test('receipt_identity_requires_json_strings', async () => {
  await seeded(); await db.exec("update ppc_private.package_delivery_state set drive_id='123',folder_id='456'");
  const candidate = await ready(await reserve(await publicationMeta(ids[1], { sha256: '1'.repeat(64) })));
  const payload = { candidateId: candidate.candidateId, generation: candidate.generation, receipt: { ...receipt(candidate), driveId: '123', folderId: '456' } };
  for (const field of ['sha256', 'driveId', 'folderId']) {
    await assert.rejects(() => db.query(`select public.ppc_package_confirm(jsonb_set($1::jsonb,array['receipt',$2],to_jsonb(($1::jsonb->'receipt'->>$2)::numeric)))`, [JSON.stringify(payload), field]), /Invalid package receipt/);
  }
  await expectStatus(call('confirm', payload), 'published');
});
test('historical_retry_recovers_only_immutable_kind_revision', async () => {
  const seed = await seeded(); const seedPublication = (await call('current')).publication; await commit();
  const first = await ready(await reserve(await publicationMeta())); const firstPublished = await confirm(first);
  await call('cleanup', { candidateId: seed.candidateId, generation: 1, absent: true });
  const second = await ready(await reserve(await publicationMeta(ids[2], { expectedGeneration: 2, sha256: 'e'.repeat(64) })));
  await confirm(second); await call('cleanup', { candidateId: first.candidateId, generation: 2, absent: true });
  await db.exec("update ppc_private.package_delivery_candidates set expires_at=clock_timestamp()-interval '1 second' where generation<3");
  for (const [candidate, publication] of [[seed, seedPublication], [first, firstPublished.publication]]) {
    const partial = receipt(candidate); delete partial.kind; delete partial.storageRevision;
    const result = await expectStatus(call('confirm', { candidateId: candidate.candidateId, generation: candidate.generation, receipt: partial }), 'already_published');
    assert.deepEqual(result.publication, publication); assert.equal((await call('current')).generation, 3);
    for (const patch of [{ sha256: 'f'.repeat(64) }, { itemId: 'different-item' }, { kind: 'wrong' }, { storageRevision: 99 }, { extra: 'not allowed' }]) await assert.rejects(() => call('confirm', { candidateId: candidate.candidateId, generation: candidate.generation, receipt: { ...partial, ...patch } }), /Conflicting package receipt/);
    for (const field of ['provider','candidateId','generation','sha256','bytes','driveId','folderId','itemId','versionId','fileName']) {
      const missing = { ...partial }; delete missing[field];
      await assert.rejects(() => call('confirm', { candidateId: candidate.candidateId, generation: candidate.generation, receipt: missing }), /Conflicting package receipt/);
    }
  }
  assert.equal((await db.query('select count(*)::integer n from ppc_private.package_delivery_receipts')).rows[0].n, 3);
  await reset(); await phaseSeed(); const fresh = await ready(await reserve(seedMeta()));
  const partial = receipt(fresh); delete partial.kind; delete partial.storageRevision;
  await assert.rejects(() => call('confirm', { candidateId: fresh.candidateId, generation: 1, receipt: partial }), /Invalid package receipt/);
  await db.query("update ppc_private.package_delivery_candidates set expires_at=clock_timestamp()-interval '1 second' where candidate_id=$1::uuid", [fresh.candidateId]);
  await expectStatus(call('confirm', { candidateId: fresh.candidateId, generation: 1, receipt: partial }), 'stale');
  assert.equal((await db.query('select count(*)::integer n from ppc_private.package_delivery_receipts')).rows[0].n, 0);
});
test('expired_positive_settlement_rejects_wrong_candidate_generation_attempt_and_preserves_slot', async () => {
  await seeded(); const value = await reserve(await publicationMeta());
  const claimed = await call('upload_claim', { candidateId: value.candidateId, generation: 2 });
  await call('upload_result', { candidateId: value.candidateId, generation: 2, attemptId: claimed.attemptId, outcome: 'uncertain' });
  await db.query("update ppc_private.package_delivery_candidates set expires_at=clock_timestamp()-interval '1 second' where candidate_id=$1::uuid", [value.candidateId]);
  await call('current');
  for (const patch of [{ candidateId: ids[2] }, { generation: 3 }, { attemptId: ids[2] }]) {
    await expectStatus(call('upload_result', { candidateId: value.candidateId, generation: 2, attemptId: claimed.attemptId, outcome: 'stored', ...patch }), 'stale');
    assert.equal((await call('current')).cleanupUpload.state, 'uncertain');
    await expectStatus(call('cleanup', { candidateId: value.candidateId, generation: 2, absent: true }), 'upload_unsettled');
  }
  await expectStatus(call('upload_result', { candidateId: value.candidateId, generation: 2, attemptId: claimed.attemptId, outcome: 'stored' }), 'stored');
  await expectStatus(call('cleanup', { candidateId: value.candidateId, generation: 2, absent: true }), 'cleaned');
  assert.equal((await call('current')).generation, 1);
});

test('forward_migration_replay_preserves_unsettled_identity_and_current_receipt', async () => {
  await seeded(); const value = await reserve(await publicationMeta());
  const claim = await call('upload_claim', { candidateId: value.candidateId, generation: 2 });
  await call('upload_result', { candidateId: value.candidateId, generation: 2, attemptId: claim.attemptId, outcome: 'uncertain' });
  const before = await call('current'); await applyForwardMigrations(); await applyForwardMigrations();
  assert.deepEqual(await call('current'), before);
  await expectStatus(call('reserve', await publicationMeta(ids[2])), 'busy');
});

test('private_role_grants', async () => {
  for (const name of ['reserve', 'upload_claim', 'upload_result', 'finalize', 'confirm', 'current', 'cleanup', 'phase']) {
    for (const role of ['anon', 'authenticated', 'supabase_auth_admin']) {
      await db.exec(`set role ${role}`); await assert.rejects(() => call(name), /permission denied/); await db.exec('reset role');
    }
    const row = (await db.query(`select has_function_privilege('service_role','public.ppc_package_${name}(jsonb)','execute') as service, (select proacl::text from pg_proc where oid='public.ppc_package_${name}(jsonb)'::regprocedure) as acl`)).rows[0];
    assert.equal(row.service, true); assert(!/(?:^|[,{])=/.test(row.acl), 'PUBLIC execute must be revoked');
  }
  await db.exec('set role service_role');
  for (const table of ['package_delivery_state', 'package_delivery_candidates', 'package_delivery_receipts']) await assert.rejects(() => db.exec(`select * from ppc_private.${table}`), /permission denied/);
  await db.exec('reset role');
});
try {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid primary key,bucket_id text); alter table storage.objects enable row level security;');
  for (const name of (await readdir(resolve('supabase/migrations'))).filter(name => name.endsWith('.sql') && name < migration).sort()) await db.exec(await readFile(resolve('supabase/migrations', name), 'utf8'));
  await db.exec(sql); await db.exec(sql);
  await applyForwardMigrations(); await applyForwardMigrations();
  assert.equal((await call('current')).phase, 'legacy');
  assert.deepEqual((await db.query("select public,file_size_limit,allowed_mime_types from storage.buckets where id='ppc-package-delivery'")).rows[0], { public: false, file_size_limit: 67108864, allowed_mime_types: ['application/octet-stream'] });
  const failures = [];
  for (const { name, run } of tests) {
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { failures.push(error); console.error(`FAIL ${name}: ${error.message}`); }
  }
  if (failures.length) throw new AggregateError(failures, `${failures.length} package delivery SQL checks failed`);
  console.log(`Package delivery SQL passed: ${tests.length}/${tests.length}, real isolated PGlite; no live endpoints.`);
} finally { await db.close(); }
