import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The database lives wholly in this process. Never use a live database URL.
const modulePath = process.env.PPC_TEST_PGLITE_MODULE;
if (!modulePath) {
  if (process.env.PPC_REQUIRE_SQL_TESTS === '1') throw new Error('SQL verification requires PPC_TEST_PGLITE_MODULE.');
  console.warn('SKIPPED: ephemeral poke SQL execution; set PPC_TEST_PGLITE_MODULE to enable isolated PostgreSQL verification.');
} else {
  const { PGlite } = await import(pathToFileURL(resolve(modulePath)).href);
  const postgres = new PGlite();
  try {
    await postgres.exec('create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin;');
    for (const filename of (await readdir(resolve('supabase/migrations'))).filter(name => name.endsWith('.sql')).sort()) {
      await postgres.exec(await readFile(resolve('supabase/migrations', filename), 'utf8'));
    }
    const presence = async (sessionId, fields = {}) => (await postgres.query(
      'select public.ppc_master_presence($1::jsonb) as result', [JSON.stringify({ sessionId, ...fields })])).rows[0].result;
    const poke = (sessionId, targetSessionId, id, fields = {}) => presence(sessionId, { ...fields, poke: { id, targetSessionId } });
    const reset = () => postgres.exec('truncate ppc_private.master_pokes, ppc_private.master_presence;');
    const count = async () => (await postgres.query('select count(*)::integer as count from ppc_private.master_pokes')).rows[0].count;

    const first = await presence('recipient-main', { displayName: 'Recipient', activity: 'focused' });
    assert.deepEqual(first.capabilities, { pokes: true, activity: true });
    assert.equal(first.ttlSeconds, 65);
    assert.deepEqual(first.sessions, first.users);
    assert.equal(first.sessions[0].activity, 'focused');
    assert.equal(first.sessions[0].receivePokes, true);
    const editing = await presence('sender-main', { displayName: 'Alex', editing: true, activity: 'idle' });
    assert.equal(editing.sessions.find(row => row.sessionId === 'sender-main').activity, 'editing', 'Editing overrides the requested activity.');
    const browsing = await presence('sender-main', { displayName: 'Alex' });
    assert.equal(browsing.sessions.find(row => row.sessionId === 'sender-main').activity, 'browsing');
    const claimedEditing = await presence('sender-main', { editing: false, activity: 'editing' });
    assert.equal(claimedEditing.sessions.find(row => row.sessionId === 'sender-main').activity, 'browsing', 'Activity cannot claim editing without the authoritative editing flag.');
    await assert.rejects(() => presence(12345678), /Invalid presence session/, 'A numeric session ID cannot pass through JSON text coercion.');
    assert.equal((await poke('sender-main', 'recipient-main', 'poke-first', {
      displayName: 'Alex', fromSessionId: 'impersonator', fromDisplayName: 'Forged',
    })).poke.status, 'queued');
    const delivered = await presence('recipient-main');
    assert.equal(delivered.pokes.length, 1);
    assert.deepEqual(Object.keys(delivered.pokes[0]).sort(), ['createdAt','fromDisplayName','fromSessionId','id','toSessionId']);
    assert.equal(delivered.pokes[0].fromSessionId, 'sender-main');
    assert.equal(delivered.pokes[0].fromDisplayName, 'Alex', 'Sender display identity is copied from presence, ignoring forged from fields.');
    assert.equal(delivered.pokes[0].toSessionId, 'recipient-main');
    assert.equal(Number.isNaN(Date.parse(delivered.pokes[0].createdAt)), false);
    await presence('stranger-main', { ackPokeIds: ['poke-first'] });
    assert.equal((await presence('recipient-main')).pokes.length, 1, 'Another session cannot acknowledge a recipient inbox.');
    assert.deepEqual((await presence('recipient-main', { ackPokeIds: ['poke-first'] })).pokes, []);
    assert.equal(await count(), 1, 'Acknowledgment retains the deduplication and cooldown receipt.');
    assert.equal((await poke('sender-main', 'recipient-main', 'poke-first')).poke.status, 'duplicate');
    assert.deepEqual((await presence('recipient-main')).pokes, []);
    assert.equal((await poke('stranger-main', 'recipient-main', 'poke-first')).poke.status, 'unavailable', 'Another sender cannot reuse an existing global event ID.');
    await assert.rejects(() => poke('sender-main', 'stranger-main', 'poke-first'), /Invalid presence poke replay/);
    const cooldown = await poke('sender-main', 'recipient-main', 'poke-second');
    assert.equal(cooldown.poke.status, 'throttled');
    assert(cooldown.poke.retryAfterSeconds >= 1 && cooldown.poke.retryAfterSeconds <= 5);
    for (let index = 0; index < 6; index += 1) await presence(`recipient-rate-${index}`);
    for (let index = 0; index < 5; index += 1) {
      assert.equal((await poke('sender-main', `recipient-rate-${index}`, `poke-rate-${index}`)).poke.status, 'queued');
    }
    const senderThrottle = (await poke('sender-main', 'recipient-rate-5', 'poke-rate-last')).poke;
    assert.equal(senderThrottle.status, 'throttled');
    assert(senderThrottle.retryAfterSeconds > 5 && senderThrottle.retryAfterSeconds <= 60);
    await postgres.exec("update ppc_private.master_pokes set accepted_at=clock_timestamp()-interval '61 seconds';");
    assert.equal((await poke('sender-main', 'recipient-main', 'poke-after-window')).poke.status, 'queued');

    assert.deepEqual((await presence('recipient-main', { receivePokes: false })).pokes, []);
    assert.equal((await poke('sender-main', 'recipient-main', 'poke-muted')).poke.status, 'unavailable');
    assert.deepEqual((await presence('recipient-main', { receivePokes: true })).pokes, [], 'Unmuting never replays an old inbox.');
    assert.equal((await poke('sender-main', 'recipient-main', 'poke-after-window')).poke.status, 'duplicate');
    assert.equal((await poke('sender-main', 'sender-main', 'poke-self')).poke.status, 'unavailable');
    assert.equal((await poke('sender-main', 'missing-recipient', 'poke-absent')).poke.status, 'unavailable');

    const invalid = [
      { receivePokes: 'false' }, { receivePokes: null }, { activity: 'playful' }, { activity: true }, { activity: null },
      { poke: null }, { poke: [] }, { poke: { id: 12345678, targetSessionId: 'recipient-main' } },
      { poke: { id: 'valid-id-123', targetSessionId: 12345678 } }, { poke: { id: 'short', targetSessionId: 'recipient-main' } },
      { poke: { id: 'valid-id-123', targetSessionId: 'invalid target' } }, { poke: { id: 'x'.repeat(129), targetSessionId: 'recipient-main' } },
      { ackPokeIds: null }, { ackPokeIds: 'poke-first' }, { ackPokeIds: [12345678] }, { ackPokeIds: [null] },
      { ackPokeIds: ['bad id with spaces'] }, { ackPokeIds: Array.from({ length: 33 }, (_, index) => `poke-ack-${index}`) },
    ];
    for (const payload of invalid) await assert.rejects(() => presence('sender-main', payload), /Invalid presence/);
    await presence('recipient-main', { ackPokeIds: Array.from({ length: 32 }, (_, index) => `poke-ack-${index}`) });

    await postgres.query("update ppc_private.master_presence set touched_at=clock_timestamp()-interval '66 seconds' where session_id=$1", ['recipient-main']);
    assert.equal((await poke('sender-main', 'recipient-main', 'poke-stale')).poke.status, 'unavailable');
    assert.equal((await postgres.query('select count(*)::integer as count from ppc_private.master_pokes where to_session_id=$1', ['recipient-main'])).rows[0].count, 0);
    await presence('sender-main', { leave: true });
    assert.equal(await count(), 0, 'Leaving removes incoming and outgoing cues and receipts.');

    await reset();
    await presence('recipient-queue');
    for (let index = 0; index < 17; index += 1) {
      assert.equal((await poke(`sender-queue-${index}`, 'recipient-queue', `poke-queue-${index}`)).poke.status,
        index < 16 ? 'queued' : 'unavailable');
    }
    assert.equal((await presence('recipient-queue')).pokes.length, 16, 'The recipient inbox is capped at 16.');
    await presence('recipient-queue', { ackPokeIds: ['poke-queue-0'] });
    assert.equal((await poke('sender-queue-16', 'recipient-queue', 'poke-queue-16')).poke.status, 'queued');
    assert.equal(await count(), 17, 'Acknowledged rows no longer consume inbox capacity.');

    await reset();
    await presence('recipient-global');
    await postgres.exec("insert into ppc_private.master_pokes(poke_id,from_session_id,from_display_name,to_session_id,acknowledged) select 'seed-global-'||n,'seed-sender-'||n,'Seed','recipient-global',true from generate_series(1,4096) n;");
    assert.equal((await poke('sender-global', 'recipient-global', 'poke-global-full')).poke.status, 'unavailable');
    assert.equal(await count(), 4096, 'The global cap includes acknowledged cooldown receipts.');
    await postgres.exec("update ppc_private.master_pokes set accepted_at=clock_timestamp()-interval '91 seconds';");
    await presence('recipient-global');
    assert.equal(await count(), 4096 - 256, 'Opportunistic expiry cleanup is bounded to 256 rows per request.');
    await reset();
    await presence('recipient-expiry');
    await poke('sender-expiry', 'recipient-expiry', 'poke-expiring');
    await postgres.exec("update ppc_private.master_pokes set accepted_at=clock_timestamp()-interval '91 seconds';");
    assert.deepEqual((await presence('recipient-expiry')).pokes, []);
    assert.equal(await count(), 0);

    await reset();
    await postgres.exec("insert into ppc_private.master_presence(session_id) select 'roster-cap-'||n from generate_series(1,256) n;");
    assert.equal((await presence('roster-overflow')).status, 'full');
    assert.equal((await presence('roster-cap-1')).onlineCount, 256, 'An existing session can refresh a full original roster.');
    assert.equal((await presence('roster-cap-1', { leave: true })).onlineCount, 255);
    assert.equal((await presence('roster-overflow')).onlineCount, 256);

    const permissions = (await postgres.query("select has_function_privilege('anon','public.ppc_master_presence(jsonb)','execute') as anon_rpc, has_function_privilege('authenticated','public.ppc_master_presence(jsonb)','execute') as authenticated_rpc, has_function_privilege('service_role','public.ppc_master_presence(jsonb)','execute') as service_rpc, has_table_privilege('anon','ppc_private.master_pokes','select') as anon_table, has_table_privilege('authenticated','ppc_private.master_pokes','select') as authenticated_table, (select relrowsecurity from pg_class where oid='ppc_private.master_pokes'::regclass) as rls")).rows[0];
    assert.deepEqual(permissions, { anon_rpc: false, authenticated_rpc: false, service_rpc: true, anon_table: false, authenticated_table: false, rls: true });
    await postgres.exec('set role anon');
    await assert.rejects(() => postgres.query('select public.ppc_master_presence($1::jsonb)', [JSON.stringify({ sessionId: 'unauthorized-session' })]), /permission denied/);
    await assert.rejects(() => postgres.query('select * from ppc_private.master_pokes'), /permission denied/);
    await postgres.exec('reset role');
    console.log('Ephemeral poke SQL checked in isolated PostgreSQL: activity, mute, identity, duplicate/ACK retention, target/sender cooldowns, expiry/leave, 16/4096 queue limits, 256-session roster, strict validation and private role permissions.');
  } finally {
    await postgres.close();
  }
}
