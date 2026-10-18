import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const migration = '202610170003_ascm_supervisor_status.sql';
let sql;
try { sql = await readFile(resolve('supabase/migrations', migration), 'utf8'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
assert.equal(typeof sql, 'string', 'ASCM activity status needs a private default-disabled lease migration');
const pgliteModule = process.env.PPC_TEST_PGLITE_MODULE
  ? pathToFileURL(resolve(process.env.PPC_TEST_PGLITE_MODULE)).href : '@electric-sql/pglite';
const { PGlite } = await import(pgliteModule);
const db = new PGlite();
const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const status = async payload => (await db.query('select public.ppc_master_ascm_status($1::jsonb) as result', [JSON.stringify(payload)])).rows[0].result;
const presence = async payload => (await db.query('select public.ppc_master_presence($1::jsonb) as result', [JSON.stringify({ sessionId: 'status-human-session', displayName: 'Real editor', ...payload })])).rows[0].result;
const withoutTimes = value => value.map(({ lastSeenAt, ...rest }) => rest);
try {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin;');
  const migrations = (await readdir(resolve('supabase/migrations'))).filter(name => name.endsWith('.sql')).sort();
  for (const name of migrations.filter(name => name < migration)) {
    await db.exec(await readFile(resolve('supabase/migrations', name), 'utf8'));
  }
  const before = await presence({ activity: 'focused' });
  await db.exec(sql); await db.exec(sql);
  for (const name of migrations.filter(name => name > migration)) await db.exec(await readFile(resolve('supabase/migrations', name), 'utf8'));
  assert.deepEqual((await db.query('select enabled from ppc_private.ascm_supervisor_status_config')).rows, [{ enabled: false }]);
  assert.equal((await status({ phase: 'begin', leaseId: first })).status, 'disabled');
  assert.equal((await presence({ includeAscmSupervisor: true })).ascmSupervisor, undefined, 'disabled private configuration exposes no status');
  assert.equal((await presence({ ascmSupervisor: { enabled: true, working: true, productCount: 99 } })).ascmSupervisor, undefined);
  await db.exec('update ppc_private.ascm_supervisor_status_config set enabled=true;');
  assert.equal((await presence({})).ascmSupervisor, undefined, 'presence must explicitly opt in through the server');
  const idle = await presence({ includeAscmSupervisor: true, activity: 'focused' });
  assert.deepEqual(idle.ascmSupervisor, { enabled: true, working: false, productCount: null, expiresAt: null, reconnectRequired: [] });
  assert.deepEqual(withoutTimes(idle.sessions), withoutTimes(before.sessions));
  assert.deepEqual(idle.sessions, idle.users); assert.equal(idle.onlineCount, 1);
  assert.deepEqual(idle.capabilities, before.capabilities); assert.deepEqual(idle.pokes, before.pokes);

  const began = await status({ phase: 'begin', leaseId: first });
  assert.equal(began.status, 'started');
  let active = (await presence({ includeAscmSupervisor: true })).ascmSupervisor;
  assert.equal(active.working, true); assert.equal(active.productCount, null);
  assert.deepEqual(Object.keys(active).sort(), ['enabled', 'expiresAt', 'productCount', 'reconnectRequired', 'working']);
  const timing = (await db.query('select extract(epoch from expires_at-started_at)::integer as seconds from ppc_private.ascm_supervisor_runs')).rows[0];
  assert.equal(timing.seconds, 120); assert(Number.isFinite(Date.parse(active.expiresAt)));
  const expires = active.expiresAt;
  assert.equal((await status({ phase: 'begin', leaseId: first })).status, 'exists', 'duplicate attempts never renew a lease');
  assert.equal((await status({ phase: 'plan', leaseId: first, productCount: 3 })).status, 'updated');
  active = (await presence({ includeAscmSupervisor: true })).ascmSupervisor;
  assert.equal(active.productCount, 3); assert.equal(active.expiresAt, expires);
  assert.equal((await status({ phase: 'begin', leaseId: second })).status, 'started');
  await status({ phase: 'plan', leaseId: second, productCount: 5 });
  assert.equal((await presence({ includeAscmSupervisor: true })).ascmSupervisor.productCount, null, 'concurrent plans cannot fabricate a unique product count by summing overlapping reports');
  await status({ phase: 'end', leaseId: first });
  assert.equal((await presence({ includeAscmSupervisor: true })).ascmSupervisor.productCount, 5);
  await status({ phase: 'end', leaseId: first });
  await status({ phase: 'plan', leaseId: first, productCount: 99 });
  assert.equal((await presence({ includeAscmSupervisor: true })).ascmSupervisor.productCount, 5, 'stale cleanup and updates do not clear or replace a newer attempt');
  await db.exec("update ppc_private.ascm_supervisor_runs set started_at=now()-interval '121 seconds',expires_at=now()-interval '1 second';");
  assert.deepEqual((await presence({ includeAscmSupervisor: true })).ascmSupervisor, idle.ascmSupervisor, 'expired work disappears without waiting for a cleanup writer');
  assert.equal((await status({ phase: 'plan', leaseId: second, productCount: 5 })).status, 'expired');
  await status({ phase: 'begin', leaseId: first });
  assert.equal((await db.query('select count(*)::integer as n from ppc_private.ascm_supervisor_runs')).rows[0].n, 1, 'new attempts prune expired leases');

  for (const payload of [{ phase: 'begin', leaseId: 'bad' }, { phase: 'plan', leaseId: first, productCount: -1 },
    { phase: 'plan', leaseId: first, productCount: '3' }, { phase: 'plan', leaseId: first, productCount: 501 },
    { phase: 'plan', leaseId: first, productCount: 1.5 }, { phase: 'begin', leaseId: first, productName: 'private data' },
    { phase: 'begin', leaseId: first, leaseSeconds: 999999 }, { phase: 'other', leaseId: first }]) {
    await assert.rejects(() => status(payload), /Invalid ASCM status/);
  }
  for (let index = 0; index < 63; index += 1) {
    const leaseId = `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`;
    assert.equal((await status({ phase: 'begin', leaseId })).status, 'started');
  }
  assert.equal((await status({ phase: 'begin', leaseId: second })).status, 'full');
  assert.equal((await db.query('select count(*)::integer as n from ppc_private.ascm_supervisor_runs')).rows[0].n, 64);
  for (const role of ['anon', 'authenticated', 'supabase_auth_admin']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(() => status({ phase: 'end', leaseId: first }), /permission denied/);
    await assert.rejects(() => db.exec('select * from ppc_private.ascm_supervisor_runs'), /permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  await assert.rejects(() => db.exec('select * from ppc_private.ascm_supervisor_runs'), /permission denied/);
  await assert.rejects(() => db.exec('update ppc_private.ascm_supervisor_status_config set enabled=false'), /permission denied/);
  assert.equal((await status({ phase: 'end', leaseId: first })).status, 'ended');
  await db.exec('reset role');
  await db.exec('update ppc_private.ascm_supervisor_status_config set enabled=false');
  assert.equal((await presence({ includeAscmSupervisor: true })).ascmSupervisor, undefined);
  console.log('ASCM status SQL passed: disabled policy, unchanged human presence, fixed leases, concurrent unknown count, expiry, stale cleanup, bounds and private role grants.');
} finally { await db.close(); }
