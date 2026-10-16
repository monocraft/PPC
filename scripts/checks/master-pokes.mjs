import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createMasterServer } from '../../server/master-service.mjs';
import { createMasterGateway, sha256 } from '../../supabase/functions/ppc-master/gateway.mjs';
import '../../public/js/master-client.js';

const codec = globalThis.PortfolioPackage, model = globalThis.PortfolioMasterModel;
const key = codec.generateKey(), wrongKey = codec.generateKey();
const origin = 'http://127.0.0.1:4190';
const manifest = { version: 4, activeCategoryId: 'fixture-category', categories: [{ id: 'fixture-category', name: 'Fixture', board: { lanes: [{ id: 'fixture-lane', label: 'Fixture' }], products: [{ id: 'fixture-product', laneId: 'fixture-lane', name: 'Fixture product' }] } }] };
const directory = await mkdtemp(join(tmpdir(), 'ppc-poke-check-'));
const filename = join(directory, 'fixture.pkg');
const encrypted = await codec.encrypt(codec.createZip([{ name: 'portfolio.json', data: new TextEncoder().encode(JSON.stringify(manifest)) }]), key);
await writeFile(filename, encrypted);
let clock = Date.parse('2026-10-16T12:00:00Z');
const server = createMasterServer({ packageFile: filename, allowedOrigins: [origin], now: () => clock });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const endpoint = `http://127.0.0.1:${server.address().port}/api/master`;
const sender = 'poke-sender-session', target = 'poke-target-session';
const call = async (sessionId, details = {}, access = key) => {
  const response = await fetch(`${endpoint}/presence`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ key: access, sessionId, ...details }) });
  const text = await response.text();
  assert.ok(!text.includes(key) && !text.includes(wrongKey) && !text.includes(filename), 'no credentials or private paths in replies');
  return { status: response.status, data: JSON.parse(text) };
};
try {
  const probe = await call(sender, { displayName: 'Alex\u0000', activity: 'roadmap' });
  assert.equal(probe.data.capabilities.pokes, true);
  assert.equal(probe.data.users[0].activity, 'roadmap');
  assert.equal(probe.data.users[0].receivePokes, true);
  await call(target, { displayName: 'Casey' });
  const sent = await call(sender, { poke: { id: 'poke-event-one', targetSessionId: target } });
  assert.equal(sent.data.poke.status, 'queued');
  assert.equal((await call(sender, { poke: { id: 'poke-event-one', targetSessionId: target } })).data.poke.status, 'duplicate');
  assert.equal((await call(target, {}, wrongKey)).status, 401);
  let inbox = (await call(target)).data.pokes;
  assert.equal(inbox.length, 1);
  assert.deepEqual(inbox[0], { id: 'poke-event-one', fromSessionId: sender, fromDisplayName: 'Alex', toSessionId: target, createdAt: new Date(clock).toISOString() });
  assert.equal((await call(sender)).data.pokes.length, 0, 'only the intended recipient can see an inbox');
  assert.equal((await call(target, { ackPokeIds: ['poke-event-one'] })).data.pokes.length, 0);
  assert.equal((await call(sender, { poke: { id: 'poke-event-two', targetSessionId: target } })).data.poke.status, 'throttled', 'acknowledgement does not reset abuse limits');
  clock += 5001;
  assert.equal((await call(sender, { poke: { id: 'poke-event-three', targetSessionId: target } })).data.poke.status, 'queued');
  assert.equal((await call(target, { receivePokes: false })).data.pokes.length, 0);
  clock += 5001;
  assert.equal((await call(sender, { poke: { id: 'poke-event-muted', targetSessionId: target } })).data.poke.status, 'unavailable');
  assert.equal((await call(target, { receivePokes: true })).data.pokes.length, 0, 'unmuting does not replay discarded interactions');
  assert.equal((await call(sender, { poke: { id: 'poke-event-self', targetSessionId: sender } })).data.poke.status, 'unavailable');
  for (const details of [{ activity: 'invented' }, { receivePokes: 'false' }, { ackPokeIds: Array(33).fill('poke-event-one') }, { poke: { id: 12345678, targetSessionId: target } }, { poke: { id: 'poke-invalid-extra', targetSessionId: target, fromDisplayName: 'Spoof' } }]) assert.equal((await call(sender, details)).status, 400);
  assert.equal((await call(sender, { editing: false, activity: 'editing' })).data.users.find((entry) => entry.sessionId === sender).activity, 'browsing');
  assert.equal((await call(sender, { editing: true, productId: 'fixture-product', activity: 'idle' })).data.users.find((entry) => entry.sessionId === sender).activity, 'editing');
  clock += 65001;
  assert.equal((await call(sender, { poke: { id: 'poke-event-expired', targetSessionId: target } })).data.poke.status, 'unavailable');

  // Six accepted interactions per minute remain bounded after acknowledgements.
  await call(target);
  for (let index = 0; index < 6; index += 1) {
    const result = await call(sender, { poke: { id: `rate-event-${index}`, targetSessionId: target } });
    assert.equal(result.data.poke.status, 'queued'); clock += 5001;
  }
  assert.equal((await call(sender, { poke: { id: 'rate-event-over', targetSessionId: target } })).data.poke.status, 'throttled');
  await call(target, { ackPokeIds: Array.from({ length: 6 }, (_, index) => `rate-event-${index}`) });
  assert.equal((await call(sender, { poke: { id: 'rate-event-over-ack', targetSessionId: target } })).data.poke.status, 'throttled');

  clock += 90001; await call(target);
  for (let index = 0; index < 17; index += 1) {
    const result = await call(`queue-sender-${index}`, { poke: { id: `queue-event-${index}`, targetSessionId: target } });
    assert.equal(result.data.poke.status, index < 16 ? 'queued' : 'unavailable');
  }
  assert.equal((await call(target)).data.pokes.length, 16);
  await call(target, { leave: true });
  assert.equal((await call(target)).data.pokes.length, 0, 'leaving discards transient inboxes');
  assert.deepEqual(await readFile(filename), Buffer.from(encrypted), 'presence interactions never modify the encrypted master');

  let rpcPayload;
  const gateway = createMasterGateway({ env: { PPC_PACKAGE_KEY_HASH: await sha256(key), PPC_PUBLISHER_SECRET: 'isolated-fixture-publisher-secret-123456789', PPC_ALLOWED_ORIGINS: origin }, rpc: async (operation, payload) => {
    if (operation === 'rate') return { allowed: true };
    if (operation === 'read') return { manifest, storageRevision: 1 };
    if (operation === 'presence') {
      rpcPayload = payload;
      return { sessions: [], capabilities: { pokes: true, activity: true }, poke: payload.poke ? { id: payload.poke.id, status: 'queued' } : undefined,
        pokes: [{ id: 'gateway-event-one', fromSessionId: target, fromDisplayName: 'Casey\u0000', toSessionId: sender, createdAt: new Date(clock).toISOString(), key: 'never retain arbitrary event fields' }, { id: 'wrong-target-event', fromSessionId: target, toSessionId: target, createdAt: new Date(clock).toISOString() }] };
    }
    throw new Error(`Unexpected isolated RPC ${operation}`);
  } });
  const adapter = { getProducts: () => [], getBaselineProducts: () => [], applyPatches() {} };
  const session = globalThis.PortfolioMasterClient.createSession({ endpoint: 'https://fixture.invalid/api/master', adapter,
    fetchImpl: (url, options) => gateway(new Request(url, options)) });
  session.markImported([], key);
  const result = await session.presence({ sessionId: sender, activity: 'roadmap', receivePokes: false, poke: { id: 'gateway-send-one', targetSessionId: target }, ackPokeIds: ['old-event-one'] });
  assert.equal(rpcPayload.activity, 'roadmap'); assert.equal(rpcPayload.receivePokes, false);
  assert.deepEqual(rpcPayload.poke, { id: 'gateway-send-one', targetSessionId: target });
  assert.deepEqual(rpcPayload.ackPokeIds, ['old-event-one']);
  assert.equal(result.poke.status, 'queued'); assert.equal(result.pokes.length, 1);
  assert.equal(result.pokes[0].fromDisplayName, 'Casey');
  assert.equal(Object.hasOwn(result.pokes[0], 'key'), false);
  assert.equal(session.getState().presenceCapabilities.pokes, true);
  assert.equal(Object.hasOwn(session.getState(), 'key'), false);
  session.disconnect(); assert.equal(session.getState().presenceCapabilities.pokes, false);
  const legacy = await globalThis.PortfolioMasterClient.request({ endpoint: 'https://fixture.invalid/api/master', operation: 'presence', key, sessionId: sender,
    poke: { id: 'legacy-event-one', targetSessionId: target }, fetchImpl: async () => new Response(JSON.stringify({ sessions: [], poke: { id: 'legacy-event-one', status: 'queued' }, pokes: result.pokes }), { headers: { 'Content-Type': 'application/json' } }) });
  assert.equal(legacy.capabilities.pokes, false); assert.equal(legacy.poke, undefined); assert.deepEqual(legacy.pokes, []);
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(directory, { recursive: true, force: true });
}
console.log('Ephemeral poke checks passed: authenticated private delivery, retry/ack, mute, activity, TTL, queue/rate caps, legacy negotiation and unchanged master bytes.');
