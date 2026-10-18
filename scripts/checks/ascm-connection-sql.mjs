import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const migration = '202610170004_ascm_connection_reporting.sql';
let sql;
try { sql = await readFile(resolve('supabase/migrations', migration), 'utf8'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
assert.equal(typeof sql, 'string', 'ASCM connection reporting needs an exact private default-disabled migration');
const pgliteModule = process.env.PPC_TEST_PGLITE_MODULE
  ? pathToFileURL(resolve(process.env.PPC_TEST_PGLITE_MODULE)).href : '@electric-sql/pglite';
const { PGlite } = await import(pgliteModule);
const db = new PGlite();
const connection = async payload => (await db.query('select public.ppc_master_ascm_connection($1::jsonb) as result', [JSON.stringify(payload)])).rows[0].result;
const presence = async () => (await db.query('select public.ppc_master_presence($1::jsonb) as result', [JSON.stringify({ sessionId: 'real-human-session', displayName: 'Real editor', includeAscmSupervisor: true })])).rows[0].result;
try {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin;');
  for (const name of (await readdir(resolve('supabase/migrations'))).filter(name => name.endsWith('.sql') && name !== migration).sort()) {
    await db.exec(await readFile(resolve('supabase/migrations', name), 'utf8'));
  }
  await db.exec(sql); await db.exec(sql);
  const config = async () => (await db.query('select enabled,outlook_reconnect_required,sharepoint_reconnect_required from ppc_private.ascm_supervisor_status_config')).rows[0];
  assert.deepEqual(await config(), { enabled: false, outlook_reconnect_required: false, sharepoint_reconnect_required: false });
  assert.deepEqual(await connection({ service: 'outlook', state: 'reconnect_required' }), { reported: false });
  assert.deepEqual(await config(), { enabled: false, outlook_reconnect_required: false, sharepoint_reconnect_required: false });
  assert.equal((await presence()).ascmSupervisor, undefined);
  await db.exec('update ppc_private.ascm_supervisor_status_config set enabled=true');
  const before = await presence();
  assert.deepEqual(before.ascmSupervisor, { enabled: true, working: false, productCount: null, expiresAt: null, reconnectRequired: [] });
  assert.deepEqual(await connection({ service: 'sharepoint', state: 'reconnect_required' }), { reported: true });
  assert.deepEqual((await presence()).ascmSupervisor.reconnectRequired, ['sharepoint']);
  assert.deepEqual(await connection({ service: 'outlook', state: 'reconnect_required' }), { reported: true });
  let reported = await presence();
  assert.deepEqual(reported.ascmSupervisor.reconnectRequired, ['outlook', 'sharepoint'], 'fixed order does not depend on arrival order');
  const saved = await config();
  assert.deepEqual(await connection({ service: 'outlook', state: 'reconnect_required' }), { reported: true });
  assert.deepEqual(await config(), saved, 'duplicate failure reports are idempotent');
  await db.exec(sql);
  assert.deepEqual(await config(), saved, 'reapplying source does not reset accepted diagnostic flags');
  assert.deepEqual(await connection({ service: 'outlook', state: 'available' }), { reported: true });
  assert.deepEqual((await presence()).ascmSupervisor.reconnectRequired, ['sharepoint']);
  const lease = '11111111-1111-4111-8111-111111111111';
  await db.query('select public.ppc_master_ascm_status($1::jsonb)', [JSON.stringify({ phase: 'begin', leaseId: lease })]);
  await db.query('select public.ppc_master_ascm_status($1::jsonb)', [JSON.stringify({ phase: 'plan', leaseId: lease, productCount: 5 })]);
  const active = (await presence()).ascmSupervisor;
  assert.equal(active.working, true); assert.equal(active.productCount, 5);
  await connection({ service: 'sharepoint', state: 'available' });
  reported = await presence();
  assert.deepEqual(reported.ascmSupervisor, { ...active, reconnectRequired: [] });
  assert.equal(reported.onlineCount, before.onlineCount); assert.equal(reported.sessions.length, before.sessions.length);
  assert.deepEqual(reported.capabilities, before.capabilities); assert.deepEqual(reported.pokes, before.pokes);
  for (const payload of [null, [], {}, { service: 'teams', state: 'reconnect_required' },
    { service: 'outlook', state: 'fixed' }, { service: 'Outlook', state: 'available' },
    { service: 'outlook', state: 'available', error: 'raw private error' },
    { service: 'sharepoint', state: true }, { service: {}, state: 'available' }]) {
    await assert.rejects(() => connection(payload), /Invalid ASCM connection/);
  }
  for (const role of ['anon', 'authenticated', 'supabase_auth_admin']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(() => connection({ service: 'outlook', state: 'reconnect_required' }), /permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  await assert.rejects(() => db.exec('select * from ppc_private.ascm_supervisor_status_config'), /permission denied/);
  assert.deepEqual(await connection({ service: 'outlook', state: 'reconnect_required' }), { reported: true });
  await db.exec('reset role');
  await db.exec('update ppc_private.ascm_supervisor_status_config set enabled=false');
  assert.deepEqual(await connection({ service: 'outlook', state: 'available' }), { reported: false });
  assert.equal((await config()).outlook_reconnect_required, true, 'disabled reporting cannot pretend a connector became available');
  assert.equal((await presence()).ascmSupervisor, undefined);
  console.log('ASCM connection SQL passed: default-off, exact enums, idempotent flags, fixed ordering, preserved lease/human presence and service-only reporting.');
} finally { await db.close(); }
