import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createMasterServer, createMasterHandler, masterConfigFromEnv } from '../../server/master-service.mjs';

const codec = globalThis.PortfolioPackage;
const directory = await mkdtemp(join(tmpdir(), 'ppc-master-'));
const filename = join(directory, 'master_ppc.pkg');
const key = codec.generateKey();
const wrongKey = codec.generateKey();
const editorToken = 'Private-team-editor-token-for-fixture-only';
const origin = 'https://monocraft.github.io';
const image = Uint8Array.of(0, 255, 1, 5, 8, 0, 17);
const extra = Uint8Array.of(7, 15, 31);
const servers = [];
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const fixture = {
  version: 4, activeCategoryId: 'pc-gaming-audio', name: 'Shared fixture', customManifest: { keep: [1, 2, 3] },
  packageInfo: { version: 1, updatedAt: '2026-01-01T12:00:00.000Z', comments: 'Keep these master comments.' },
  imageAssets: [{ id: 'asset1', sourceType: 'local', packagePath: 'images/asset1.webp', name: 'Product image', mimeType: 'image/webp' }],
  categories: [{ id: 'pc-gaming-audio', board: { title: 'Preserved board', customBoard: { marker: true }, lanes: [{ id: 'wired', label: 'Wired' }], products: [{
    id: 'p1', name: 'Fixture headset', laneId: 'wired', price: 149.99, imageAssetId: 'asset1', customProduct: { keep: 'source data' },
    generalAvailabilityDate: '2026-06-12', ffsDate: '2026-05-10', endManufacturingDate: '2029-12-31',
    globalAnnouncementDate: '2026-06-01', webReadinessDate: '2026-05-30', finalAssetsDate: '2026-05-29',
    specs: [{ id: 'spec1', label: 'Driver', value: '40 mm', icon: 'Preserve icon' }, { id: 'spec2', label: 'Weight', value: '250 g' }],
    partSkus: [{ id: 'part1', code: 'ABC123', variantId: 'sku1', colorCode: 'BLK', source: 'Preserve source' }],
    variantGroups: [{ id: 'group1', type: 'color', label: 'Colors', privateGroup: 'Preserve metadata', items: [{ id: 'sku1', code: 'BLK', label: 'Black', colorKey: 'black', colorName: 'Black', colorHex: '#000000', imageAssetId: 'asset1', privateItem: true }] }],
    roadmap: { startMonth: '2026-06', launchMonth: '2026-06', endMonth: '2029-12', family: 'Cloud', status: 'embargo', confidence: 'medium', notes: 'Preserve roadmap notes' },
  }] } }],
};

async function sealed(manifest) {
  return codec.encrypt(codec.createZip([
    { name: 'portfolio.json', data: encoder.encode(JSON.stringify(manifest)) },
    { name: 'images/asset1.webp', data: image }, { name: 'attachments/source.bin', data: extra },
  ]), key);
}

async function start(options = {}) {
  const server = createMasterServer({ packageFile: filename, allowedOrigins: [origin], editorToken, rateLimit: 1000, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

async function request(base, path = '/api/master/latest', body = { key, editorToken }, options = {}) {
  const response = await fetch(`${base}${path}`, {
    method: options.method || 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...options.headers },
    ...(options.method === 'GET' || options.method === 'OPTIONS' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  if (path === '/api/package/latest' && response.ok) return { response, bytes: new Uint8Array(await response.arrayBuffer()) };
  if (response.status === 204) return { response };
  const text = await response.text();
  const data = JSON.parse(text);
  for (const secret of [key, wrongKey, editorToken, filename, directory]) assert.ok(!text.includes(secret), 'responses must not expose service credentials or private file paths');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return { response, data };
}

const product = snapshot => snapshot.products.find(item => item.productId === 'p1');
const change = (snapshot, patch) => ({ productId: 'p1', base: product(snapshot).values, baseRevisions: product(snapshot).revisions, patch });
const saveBody = changes => ({ key, editorToken, requestId: randomUUID(), changes, actor: 'Fixture user', team: 'Product', reason: 'Fixture update' });
const save = (base, snapshot, patch) => request(base, '/api/master/save', saveBody([change(snapshot, patch)]));

async function latest(base) {
  const result = await request(base);
  assert.equal(result.response.status, 200);
  return result.data.snapshot;
}

async function inspect() {
  const bytes = new Uint8Array(await readFile(filename));
  assert.ok(codec.isEncrypted(bytes));
  assert.ok(!Buffer.from(bytes).includes(Buffer.from(fixture.packageInfo.comments)), 'master comments remain encrypted on disk');
  const entries = codec.readZip(await codec.decrypt(bytes, key));
  assert.deepEqual(entries.get('images/asset1.webp'), image, 'master updates must preserve image bytes');
  assert.deepEqual(entries.get('attachments/source.bin'), extra, 'master updates must preserve all extra ZIP entries');
  return JSON.parse(decoder.decode(entries.get('portfolio.json')));
}

try {
  await writeFile(filename, await sealed(fixture));
  const base = await start();
  const original = await latest(base);
  assert.equal(original.canWrite, true);
  assert.equal(original.requiresEditorToken, true);
  assert.equal(typeof original.revision, 'string');
  assert.deepEqual(original.packageInfo, fixture.packageInfo);
  assert.equal(product(original).values.ffsDate, '2026-05-10');

  const withoutEditor = await request(base, '/api/master/latest', { key });
  assert.equal(withoutEditor.response.status, 200);
  assert.equal(withoutEditor.data.snapshot.canWrite, false, 'read key alone never grants remote edits');
  let rejected = await request(base, '/api/master/save', { ...saveBody([change(original, { ffsDate: '2026-05-11' })]), editorToken: '' });
  assert.equal(rejected.response.status, 403);
  assert.equal(rejected.data.code, 'EDITOR_KEY_REQUIRED');
  rejected = await request(base, '/api/master/latest', { key: wrongKey });
  assert.equal(rejected.response.status, 401);
  assert.equal(rejected.data.code, 'INVALID_KEY');
  rejected = await request(base, '/api/master/save', { ...saveBody([change(original, { ffsDate: '2026-05-11' })]), force: true });
  assert.equal(rejected.response.status, 400, 'force overwrite must never bypass stale-edit checks');
  rejected = await request(base, '/api/master/latest', { key }, { headers: { Origin: 'https://untrusted.invalid' } });
  assert.equal(rejected.response.status, 403);
  assert.equal(rejected.response.headers.get('access-control-allow-origin'), null);

  const launchSave = await save(base, original, { generalAvailabilityDate: '2026-07-15' });
  assert.equal(launchSave.response.status, 200);
  assert.equal(launchSave.data.snapshot.packageInfo.comments, 'Fixture update');
  assert.equal(launchSave.data.snapshot.packageInfo.updatedAt, launchSave.data.snapshot.masterSync.history.at(-1).at, 'accepted business updates and their footer use the same save timestamp');
  assert.equal(product(launchSave.data.snapshot).values.startMonth, '2026-07', 'exact launch changes derive roadmap months');
  const ffsSave = await save(base, original, { ffsDate: '2026-05-20' });
  assert.equal(ffsSave.response.status, 200, 'another team can merge an unrelated date from its stale snapshot');
  assert.equal(product(ffsSave.data.snapshot).values.generalAvailabilityDate, '2026-07-15');
  assert.equal(ffsSave.data.snapshot.masterSync.history.at(-1).path, 'ffsDate', 'accepted snapshots include current audit history for subsequent master exports');
  assert.equal(ffsSave.data.snapshot.masterSync.history.at(-1).requestId, ffsSave.data.requestId);
  assert.deepEqual((await latest(base)).masterSync, (await inspect()).masterSync, 'authenticated snapshots carry the durable current master revision metadata');
  const beforeConflict = await readFile(filename);
  const conflicting = await save(base, original, { generalAvailabilityDate: '2026-08-10', globalAnnouncementDate: '2026-07-30' });
  assert.equal(conflicting.response.status, 409);
  assert.equal(conflicting.data.code, 'MASTER_CONFLICT');
  assert.ok(conflicting.data.conflicts.length);
  assert.equal(product(conflicting.data.snapshot).values.generalAvailabilityDate, '2026-07-15');
  assert.deepEqual(await readFile(filename), beforeConflict, 'a conflict commits none of the requested fields');
  const resolved = await save(base, conflicting.data.snapshot, { generalAvailabilityDate: '2026-08-10', globalAnnouncementDate: '2026-07-30' });
  assert.equal(resolved.response.status, 200, 'choosing a final date rebases against the supplied current master');

  const concurrentBase = resolved.data.snapshot;
  const concurrent = await Promise.all([
    save(base, concurrentBase, { ffsDate: '2026-05-21' }), save(base, concurrentBase, { ffsDate: '2026-05-22' }),
  ]);
  assert.deepEqual(concurrent.map(result => result.response.status).sort(), [200, 409], 'same-field simultaneous requests produce one saved value and one decision');
  const raceLoser = concurrent.find(result => result.response.status === 409);
  const thirdSave = await save(base, raceLoser.data.snapshot, { ffsDate: '2026-05-23' });
  assert.equal(thirdSave.response.status, 200);
  const staleResolution = await save(base, raceLoser.data.snapshot, { ffsDate: '2026-05-24' });
  assert.equal(staleResolution.response.status, 409, 'a second race while deciding must ask for a fresh decision');

  const abaBase = await latest(base);
  assert.equal((await save(base, abaBase, { finalAssetsDate: '2026-05-28' })).response.status, 200);
  assert.equal((await save(base, await latest(base), { finalAssetsDate: product(abaBase).values.finalAssetsDate })).response.status, 200);
  assert.equal((await save(base, abaBase, { finalAssetsDate: '2026-05-27' })).response.status, 409, 'field revisions detect an intervening change restored to its old value');

  const collectionBase = await latest(base);
  const teamOneSpecs = structuredClone(product(collectionBase).values.specs);
  const teamTwoSpecs = structuredClone(product(collectionBase).values.specs);
  teamOneSpecs[0].value = '50 mm';
  teamTwoSpecs[1].value = '260 g';
  assert.equal((await save(base, collectionBase, { specs: teamOneSpecs })).response.status, 200);
  const specMerge = await save(base, collectionBase, { specs: teamTwoSpecs });
  assert.equal(specMerge.response.status, 200, 'different specification rows merge from independent users');
  assert.equal(product(specMerge.data.snapshot).values.specs[0].value, '50 mm');
  assert.equal(product(specMerge.data.snapshot).values.specs[1].value, '260 g');
  const sameSpec = await save(base, collectionBase, { specs: [{ ...teamOneSpecs[0], value: '60 mm' }, teamOneSpecs[1]] });
  assert.equal(sameSpec.response.status, 409, 'competing changes to the same specification ask for a decision');

  const skuBase = await latest(base);
  const newSkuOne = [...product(skuBase).values.partSkus, { id: 'part2', code: 'DEF456', variantId: 'sku1', colorCode: 'BLK' }];
  const newSkuTwo = [...product(skuBase).values.partSkus, { id: 'part3', code: 'GHI789', variantId: 'sku1', colorCode: 'BLK' }];
  assert.equal((await save(base, skuBase, { partSkus: newSkuOne })).response.status, 200);
  const addedSku = await save(base, skuBase, { partSkus: newSkuTwo });
  assert.equal(addedSku.response.status, 200, 'independent new SKU rows must both survive');
  assert.deepEqual(product(addedSku.data.snapshot).values.partSkus.map(item => item.id).sort(), ['part1', 'part2', 'part3']);

  const cleanBase = await latest(base);
  rejected = await save(base, cleanBase, { privateUneditable: 'Must not persist' });
  assert.equal(rejected.response.status, 422);
  rejected = await save(base, cleanBase, { generalAvailabilityDate: '2035-01-01' });
  assert.equal(rejected.response.status, 422, 'launch after the exact end date must not silently save');
  rejected = await save(base, cleanBase, { ffsDate: '2026-02-30' });
  assert.equal(rejected.response.status, 422, 'invalid calendar days must fail validation');

  const persisted = await inspect();
  const persistedProduct = persisted.categories[0].board.products[0];
  assert.deepEqual(persisted.customManifest, fixture.customManifest);
  assert.deepEqual(persisted.categories[0].board.customBoard, fixture.categories[0].board.customBoard);
  assert.deepEqual(persistedProduct.customProduct, fixture.categories[0].board.products[0].customProduct);
  assert.equal(persistedProduct.price, fixture.categories[0].board.products[0].price);
  assert.equal(persistedProduct.imageAssetId, 'asset1');
  assert.equal(persistedProduct.roadmap.notes, 'Preserve roadmap notes');
  assert.equal(persistedProduct.specs[0].icon, 'Preserve icon');
  assert.equal(persistedProduct.partSkus[0].source, 'Preserve source');
  assert.equal(persistedProduct.variantGroups[0].items[0].privateItem, true);
  assert.equal(persisted.packageInfo.comments, 'Fixture update', 'accepted updates replace the initial comments with the saved note');
  assert.ok(persisted.packageInfo.updatedAt > fixture.packageInfo.updatedAt);
  const restarted = await start();
  assert.deepEqual(product(await latest(restarted)).values, product(cleanBase).values, 'a new server instance reads the durable saved master');
  const downloaded = await request(restarted, '/api/package/latest', { key });
  assert.equal(downloaded.response.status, 200);
  assert.deepEqual(downloaded.bytes, new Uint8Array(await readFile(filename)), 'Pull latest uses the same master that accepted team saves');
  const sharedSnapshot = await latest(base);
  const independentServers = await Promise.all([
    save(base, sharedSnapshot, { webReadinessDate: '2026-05-28' }),
    save(restarted, sharedSnapshot, { globalAnnouncementDate: '2026-08-01' }),
  ]);
  assert.deepEqual(independentServers.map(result => result.response.status), [200, 200], 'separate handlers sharing one file serialize and merge independent team saves');

  const readonly = await start({ editorToken: '' });
  const readSnapshot = await latest(readonly);
  assert.equal(readSnapshot.canWrite, false);
  rejected = await save(readonly, readSnapshot, { ffsDate: '2026-05-25' });
  assert.equal(rejected.response.status, 403);
  assert.equal(rejected.data.code, 'WRITES_DISABLED', 'remote service defaults to disabled writes without an edit token');
  const local = await start({ allowedOrigins: undefined, editorToken: '', allowLocalEdits: true });
  const localSnapshot = await request(local, '/api/master/latest', { key }, { headers: { Origin: local } });
  assert.equal(localSnapshot.response.status, 200);
  assert.equal(localSnapshot.data.snapshot.canWrite, true);
  const localSave = await request(local, '/api/master/save', { ...saveBody([change(localSnapshot.data.snapshot, { ffsDate: '2026-05-25' })]), editorToken: undefined }, { headers: { Origin: local } });
  assert.equal(localSave.response.status, 200, 'same-origin loopback trial supports saving without a second edit key');
  rejected = await request(local, '/api/master/latest', { key }, { headers: { Origin: 'http://localhost:12345' } });
  assert.equal(rejected.response.status, 403, 'a different local authority cannot obtain implicit trial access');
  rejected = await request(local, '/api/master/latest', { key }, { headers: { Origin: origin } });
  assert.equal(rejected.response.status, 403, 'a remote page cannot use implicit local edit access');

  const goodBytes = await readFile(filename);
  await writeFile(filename, Buffer.from('Not an encrypted package'));
  rejected = await request(base);
  assert.equal(rejected.response.status, 503);
  assert.ok(!rejected.data.error.includes('Not an encrypted package'));
  await writeFile(filename, goodBytes);
  const tampered = Buffer.from(goodBytes);
  tampered[tampered.length - 1] ^= 1;
  await writeFile(filename, tampered);
  rejected = await request(base);
  assert.equal(rejected.response.status, 401, 'authenticated corruption is rejected before serving data');
  await writeFile(filename, goodBytes);
  const beforeExternal = await latest(base);
  const externalMaster = await inspect();
  externalMaster.customManifest.externalUpdate = 'Preserve an outside publisher update';
  externalMaster.categories[0].board.products[0].ffsDate = '2026-05-26';
  await writeFile(filename, await sealed(externalMaster));
  rejected = await save(base, beforeExternal, { ffsDate: '2026-05-27' });
  assert.equal(rejected.response.status, 409, 'external master replacement is re-read and same-field edits conflict');
  const externalMerge = await save(base, beforeExternal, { finalAssetsDate: '2026-05-26' });
  assert.equal(externalMerge.response.status, 200, 'an unrelated edit merges onto the latest external master');
  assert.equal((await inspect()).customManifest.externalUpdate, 'Preserve an outside publisher update');
  rejected = await request(base, '/api/master/latest', ' '.repeat(1024 * 1024 + 1));
  assert.equal(rejected.response.status, 413, 'oversized requests are rejected before data is parsed');
  const preflight = await request(base, '/api/master/save', undefined, {
    method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
  });
  assert.equal(preflight.response.status, 204);
  assert.equal(preflight.response.headers.get('access-control-allow-origin'), origin);
  await writeFile(`${filename}.master.lock`, JSON.stringify({ version: 1, pid: process.pid, nonce: randomUUID() }));
  rejected = await save(base, await latest(base), { ffsDate: '2026-05-26' });
  assert.equal(rejected.response.status, 503, 'a second cooperating process cannot write through the file lock');
  await rm(`${filename}.master.lock`);
  assert.deepEqual((await readdir(directory)).sort(), ['master_ppc.pkg'], 'no plaintext, key, lock, or staging files remain after requests');

  let presenceNow = Date.parse('2026-10-07T16:00:00.000Z');
  const presenceBase = await start({ presenceTtlMs: 1000, presenceMaxUsers: 2, now: () => presenceNow });
  const presencePath = '/api/master/presence';
  const sessionOne = randomUUID(), sessionTwo = randomUUID(), sessionThree = randomUUID();
  const firstViewer = await request(presenceBase, presencePath, { key, sessionId: sessionOne });
  assert.equal(firstViewer.response.status, 200);
  assert.equal(firstViewer.data.onlineCount, 1);
  assert.equal(firstViewer.data.users[0].displayName, '', 'anonymous sessions do not acquire a verified name');
  assert.equal(firstViewer.data.users[0].editing, false);
  const secondViewer = await request(presenceBase, presencePath, { key, sessionId: sessionTwo, displayName: 'Casey', editing: true, productId: 'p1' });
  assert.equal(secondViewer.response.status, 200);
  assert.equal(secondViewer.data.onlineCount, 2);
  assert.equal(secondViewer.data.users.find(user => user.sessionId === sessionTwo).productName, 'Fixture headset');
  assert.equal(secondViewer.data.users.find(user => user.sessionId === sessionTwo).editing, true);
  rejected = await request(presenceBase, presencePath, { key: wrongKey, sessionId: sessionThree });
  assert.equal(rejected.response.status, 401, 'viewer lists always require the current encrypted master key');
  rejected = await request(presenceBase, presencePath, { key, sessionId: sessionThree });
  assert.equal(rejected.response.status, 429, 'the in-memory presence list has a firm session cap');
  const updatedViewer = await request(presenceBase, presencePath, { key, sessionId: sessionOne, displayName: 'Alex\u0000', editing: true, productId: 'p1' });
  assert.equal(updatedViewer.response.status, 200);
  assert.equal(updatedViewer.data.onlineCount, 2, 'heartbeats update a session rather than duplicating it');
  assert.equal(updatedViewer.data.users.find(user => user.sessionId === sessionOne).displayName, 'Alex');
  rejected = await request(presenceBase, presencePath, { key, sessionId: sessionOne }, { headers: { Origin: 'https://untrusted.invalid' } });
  assert.equal(rejected.response.status, 403);
  rejected = await request(presenceBase, presencePath, { key, sessionId: sessionOne, displayName: 'x'.repeat(61) });
  assert.equal(rejected.response.status, 400);
  const missingProduct = await request(presenceBase, presencePath, { key, sessionId: sessionOne, editing: true, productId: 'does-not-exist' });
  assert.equal(missingProduct.response.status, 200);
  assert.equal(missingProduct.data.users.find(user => user.sessionId === sessionOne).editing, false, 'a nonexistent product reports viewing without an invented product name');
  const left = await request(presenceBase, presencePath, { key, sessionId: sessionTwo, leave: true });
  assert.equal(left.data.onlineCount, 1);
  assert.ok(!left.data.users.some(user => user.sessionId === sessionTwo));
  await request(presenceBase, presencePath, { key, sessionId: sessionTwo });
  presenceNow += 1001;
  const afterExpiry = await request(presenceBase, presencePath, { key, sessionId: sessionThree });
  assert.equal(afterExpiry.data.onlineCount, 1, 'missed heartbeats expire without leaving stale avatar circles');
  assert.equal(afterExpiry.data.users[0].sessionId, sessionThree);
  const separateServer = await start();
  const isolatedPresence = await request(separateServer, presencePath, { key, sessionId: sessionOne });
  assert.equal(isolatedPresence.data.onlineCount, 1, 'presence is private to one handler and never persisted into the master');
  const preRotationBytes = await readFile(filename);
  const rotationEntries = codec.readZip(await codec.decrypt(preRotationBytes, key));
  await writeFile(filename, await codec.encrypt(codec.createZip([...rotationEntries].map(([name, data]) => ({ name, data }))), wrongKey));
  rejected = await request(presenceBase, presencePath, { key, sessionId: sessionThree });
  assert.equal(rejected.response.status, 401, 'cached presence authorization becomes invalid when the encrypted master key rotates');
  const rotatedPresence = await request(presenceBase, presencePath, { key: wrongKey, sessionId: sessionThree });
  assert.equal(rotatedPresence.response.status, 200);
  await writeFile(filename, preRotationBytes);
  assert.deepEqual((await readdir(directory)).sort(), ['master_ppc.pkg'], 'presence creates no private user or key files');
  const limitedPresenceServer = await start({ rateLimit: 1, presenceRateLimit: 10 });
  const limitedBaseSnapshot = await latest(base);
  for (let index = 0; index < 3; index += 1) {
    const heartbeat = await request(limitedPresenceServer, presencePath, { key, sessionId: sessionOne });
    assert.equal(heartbeat.response.status, 200);
  }
  const afterHeartbeatsSave = await save(limitedPresenceServer, limitedBaseSnapshot, { ffsDate: '2026-05-28' });
  assert.equal(afterHeartbeatsSave.response.status, 200, 'presence has a separate rate budget and cannot exhaust ordinary team saves');

  const options = masterConfigFromEnv({ PPC_MASTER_FILE: filename, PPC_MASTER_WRITE_TOKEN: editorToken, PPC_MASTER_LOCAL_EDITS: '1', PPC_ALLOWED_ORIGINS: origin });
  assert.equal(options.packageFile, filename);
  assert.equal(options.editorToken, editorToken);
  assert.equal(options.allowLocalEdits, true);
  assert.throws(() => createMasterHandler({ packageFile: filename, allowedOrigins: ['*'] }));
  assert.throws(() => createMasterHandler({ packageFile: filename, editorToken: 'short' }));
  const implementation = await readFile(new URL('../../server/master-service.mjs', import.meta.url), 'utf8');
  assert.ok(!implementation.includes('console.'), 'master requests and credentials are never logged');
  assert.match(implementation, /plaintext\?\.fill\(0\)/);
  const legacy = structuredClone(persisted);
  legacy.packageInfo = { ...fixture.packageInfo, updatedAt: new Date(Date.parse(legacy.masterSync.history.at(-1).at) + 1).toISOString() };
  const legacyBytes = await sealed(legacy);
  await writeFile(filename, legacyBytes);
  const legacySnapshot = await latest(await start());
  assert.equal(legacySnapshot.packageInfo.comments, 'Fixture update', 'legacy service reads recover the last accepted note even when the old save stamp reused initial comments');
  assert.equal(legacySnapshot.packageInfo.updatedAt, legacy.masterSync.history.at(-1).at);
  assert.deepEqual(new Uint8Array(await readFile(filename)), legacyBytes, 'reading corrected legacy information leaves the encrypted master untouched');
  console.log('Master service checks passed: encrypted persistence, team merges, conflict decisions, races, preserved images, auth, local trial, and authenticated viewer presence with expiry.');
} finally {
  await Promise.all(servers.map(server => new Promise(resolveClosed => { server.closeAllConnections(); server.close(resolveClosed); })));
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()), 'cleanup remains inside the temporary fixture directory');
  assert.ok(basename(directory).startsWith('ppc-master-'));
  await rm(directory, { recursive: true, force: true });
}
