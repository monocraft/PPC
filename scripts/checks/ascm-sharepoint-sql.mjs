import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Real isolated transactions catch lost native acceptance, incorrect equivalence,
// stale baseline writes and receipt adoption after unrelated master edits.
export async function sourceDatabase() {
  globalThis.fetch = async () => { throw new Error('External fetch forbidden in SharePoint source checks'); };
  if (process.env.PPC_REQUIRE_SQL_TESTS === '1' && !process.env.PPC_TEST_PGLITE_MODULE) throw new Error('SQL verification requires PPC_TEST_PGLITE_MODULE');
  const { PGlite } = await import(process.env.PPC_TEST_PGLITE_MODULE ? pathToFileURL(resolve(process.env.PPC_TEST_PGLITE_MODULE)).href : '@electric-sql/pglite');
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid primary key,bucket_id text); alter table storage.objects enable row level security;');
  for (const name of (await readdir(resolve('supabase/migrations'))).filter(name => name.endsWith('.sql') && name <= '202610180003_ascm_sharepoint_source.sql').sort()) await db.exec(await readFile(resolve('supabase/migrations', name), 'utf8'));
  const database = async (operation, payload = {}) => (await db.query(`select public.ppc_master_${operation}($1::jsonb) result`, [JSON.stringify(payload)])).rows[0].result;
  return { db, database };
}
export const sourceMetadata = Object.freeze({ provider: 'sharepoint', hostname: 'hp.sharepoint.com', sitePath: '/teams/IPSG_SCM_and_Product_Requirements_Info', driveId: 'b!Dxcy8q8LE0GivbyM3D6Dq5C5iXHjfxBMsvQrwTpLknS0JFIuvvhlQoilkLMqZkl9', listId: '2e5224b4-f8be-4265-88a5-90b32a66497d', listItemId: 908, itemUniqueId: 'e5cb1d81-7071-40b6-93cb-86ef0b577f52', fileName: 'ASCM Report_HyperX_2026-09-30.xlsx', relativePath: '(09) September 2026/ASCM Report_HyperX_2026-09-30.xlsx', versionLabel: '2.0', eTag: '"synthetic-2"', createdAt: '2026-09-30T09:00:46Z', lastModifiedAt: '2026-10-07T07:44:51Z', bytes: 256 });
export const observation = source => Object.fromEntries(['listItemId','itemUniqueId','versionLabel','eTag','bytes'].map(key => [key, source[key]]));
const fixture = (major = 2, patch = {}) => {
  const source = { ...sourceMetadata, versionLabel: `${major}.0`, eTag: `"synthetic-${major}"`, ...patch.source };
  return { requestId: `ascm-sp-${String(major).padStart(64, '0')}`, source, before: observation(source), after: observation(source), rawSha256: String(major).padStart(64,'a'), businessFingerprintVersion: 1, businessSha256: 'b'.repeat(64), reportDate: '2026-09-30', fingerprint: String(major).padStart(64,'f'), expectedRevision: 1, expectedSourceObservationId: 0, manifest: { accepted: major }, changed: true, savedFields: 3, savedProducts: 1, ...patch };
};
async function run() {
  const { db, database } = await sourceDatabase();
  const call = payload => database('ascm_sharepoint_commit', payload);
  const read = requestId => database('ascm_sharepoint_read', { requestId });
  const status = async (promise, want) => { const result = await promise; assert.equal(result.status, want, JSON.stringify(result)); return result; };
  const snapshot = async () => (await db.query("select jsonb_build_object('m',(select to_jsonb(s) from ppc_private.master_state s),'r',(select jsonb_agg(to_jsonb(r) order by request_id) from ppc_private.master_receipts r)) value")).rows[0].value;
  try {
    assert.equal((await db.query("select to_regprocedure('public.ppc_master_ascm_sharepoint_commit(jsonb)') is not null available")).rows[0].available, true, 'SharePoint source needs an atomic provenance/native commit wrapper');
    await database('bootstrap', { manifest: { initial: true }, sourceSha: 'a'.repeat(40), fingerprint: 'f'.repeat(64) });
    const first = fixture(); await status(call(first), 'saved');
    let state = await read(first.requestId);
    assert.equal(state.storageRevision, 2); assert.equal(state.sourceReceipt.outcome, 'accepted'); assert.equal(state.receipt.storageRevision, 2);
    const original = structuredClone(state.receipt), baseline = state.baseline;
    const before = await snapshot();
    const eq = fixture(10, { expectedRevision: 2, expectedSourceObservationId: baseline.observationId });
    await status(call(eq), 'saved'); state = await read(eq.requestId);
    assert.equal(state.sourceReceipt.outcome, 'equivalent'); assert.equal(state.sourceReceipt.acceptedRequestId, first.requestId);
    assert.equal(state.sourceReceipt.savedFields, 0); assert.equal(state.sourceReceipt.savedProducts, 0); assert.deepEqual(state.receipt, original);
    assert.deepEqual(await snapshot(), before, 'equivalence must not touch manifest/revision/requestedRevision/clock/native receipts');
    await status(call(first), 'already_saved');
    await status(call({ ...first, rawSha256: 'd'.repeat(64) }), 'request_mismatch');
    await status(call(fixture(3, { expectedRevision: 2, expectedSourceObservationId: state.baseline.observationId })), 'stale_source');
    await status(call(fixture(11, { expectedRevision: 2, expectedSourceObservationId: baseline.observationId })), 'raced');
    const correction = fixture(11, { expectedRevision: 2, expectedSourceObservationId: state.baseline.observationId, businessSha256: 'c'.repeat(64) });
    await status(call({ ...correction, expectedRevision: 1 }), 'raced');
    await status(call({ ...correction, source: { ...correction.source, listItemId: 909 }, before: { ...correction.before, listItemId: 909 }, after: { ...correction.after, listItemId: 909 } }), 'ambiguous_source');
    await status(call({ ...correction, businessFingerprintVersion: 2 }), 'fingerprint_version_mismatch');
    await db.exec("create function ppc_private.test_source_insert_failure() returns trigger language plpgsql as $$ begin raise exception 'Injected source insert failure'; end $$; create trigger test_source_insert_failure before insert on ppc_private.ascm_sharepoint_receipts for each row execute function ppc_private.test_source_insert_failure();");
    await assert.rejects(() => call(correction), /Injected source insert failure/);
    assert.deepEqual(await snapshot(), before, 'native commit must roll back when provenance insertion fails');
    await db.exec('drop trigger test_source_insert_failure on ppc_private.ascm_sharepoint_receipts');
    await status(call(correction), 'saved'); assert.equal((await read(correction.requestId)).storageRevision, 3);
    assert.equal((await read(first.requestId)).receipt.storageRevision, 2, 'old exact receipts retain original revision after corrections');
    await status(call(fixture(12, { expectedRevision: 3, expectedSourceObservationId: state.baseline.observationId })), 'raced');
    state = await read(correction.requestId);
    const nextSource = { ...sourceMetadata, listItemId: 920, itemUniqueId: 'f5cb1d81-7071-40b6-93cb-86ef0b577f52', fileName: 'ASCM Report_HyperX_2026-10-31.xlsx', relativePath: '(10) October 2026/ASCM Report_HyperX_2026-10-31.xlsx', versionLabel: '1.0' };
    const next = fixture(20, { source: nextSource, before: observation(nextSource), after: observation(nextSource), reportDate: '2026-10-31', expectedRevision: 3, expectedSourceObservationId: state.baseline.observationId });
    await status(call(next), 'saved'); assert.equal((await read(next.requestId)).storageRevision, 4, 'new period accepts even with same business digest');
    state=await read(next.requestId);
    const competingSource={...nextSource,versionLabel:'2.0'};
    const competing=fixture(30,{source:competingSource,before:observation(competingSource),after:observation(competingSource),reportDate:'2026-10-31',expectedRevision:4,expectedSourceObservationId:state.baseline.observationId});
    const different=fixture(31,{...competing,requestId:`ascm-sp-${'e'.repeat(64)}`,businessSha256:'d'.repeat(64),source:{...competingSource,versionLabel:'3.0'},before:observation({...competingSource,versionLabel:'3.0'}),after:observation({...competingSource,versionLabel:'3.0'})});
    assert.deepEqual((await Promise.all([call(competing),call(different)])).map(r=>r.status),['saved','raced'],'concurrent equivalent/correction must fence the baseline even when equivalence changes no native revision');
    assert.equal((await read(competing.requestId)).storageRevision,4);assert.equal((await read(competing.requestId)).sourceReceipt.outcome,'equivalent');
    await assert.rejects(() => db.exec('update ppc_private.ascm_sharepoint_receipts set saved_fields=99'), /immutable/);
    for (const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`); await assert.rejects(() => read(first.requestId), /permission denied/); await db.exec('reset role');
    }
    for (const name of ['ascm_sharepoint_read','ascm_sharepoint_commit']) assert.equal((await db.query(`select has_function_privilege('service_role','public.ppc_master_${name}(jsonb)','execute') allowed`)).rows[0].allowed,true);
    assert.equal((await db.query("select relrowsecurity enabled from pg_class where oid='ppc_private.ascm_sharepoint_receipts'::regclass")).rows[0].enabled,true);
    console.log('SharePoint source SQL passed: first/equivalent/correction/new-period/replay/CAS/baseline-race/rollback/immutable/private contracts; real isolated PGlite.');
  } finally { await db.close(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await run();
