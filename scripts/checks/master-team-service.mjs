import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { createMasterServer, createMasterHandler, masterConfigFromEnv } from '../../server/master-service.mjs';

const codec = globalThis.PortfolioPackage;
const key = codec.generateKey();
const wrongKey = codec.generateKey();
const centralToken = 'private-central-GitHub-token-fixture-only';
const origin = 'https://monocraft.github.io';
const image = Uint8Array.of(0, 1, 255, 8, 9);
const extra = Uint8Array.of(17, 26, 32);
const fixture = { version: 4, activeCategoryId: 'audio', privateMetadata: { preserved: true },
  packageInfo: { version: 1, updatedAt: '2026-01-01T00:00:00.000Z', comments: 'Preserve master comments.' },
  imageAssets: [{ id: 'image1', sourceType: 'local', packagePath: 'images/image1.webp' }],
  categories: [{ id: 'audio', board: { lanes: [{ id: 'wired', label: 'Wired' }], products: [{ id: 'p1', name: 'Team headset', laneId: 'wired', imageAssetId: 'image1',
    price: 99, generalAvailabilityDate: '2027-03-15', ffsDate: '2027-02-01', endManufacturingDate: '2029-12-31',
    roadmap: { startMonth: '2027-03', launchMonth: '2027-03', endMonth: '2029-12', notes: 'Preserve notes.' },
    specs: [{ id: 's1', label: 'Weight', value: '250 g', icon: 'Preserve icon' }],
    partSkus: [{ id: 'k1', code: 'TEAM-001', colorCode: 'BK' }],
  }] } }],
};
const encoder = new TextEncoder();
async function seal(manifest, encryptionKey = key) { return codec.encrypt(codec.createZip([
  { name: 'portfolio.json', data: encoder.encode(JSON.stringify(manifest)) },
  { name: 'images/image1.webp', data: image }, { name: 'attachments/source.bin', data: extra },
]), encryptionKey); }
const sha = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const initialBytes = await seal(fixture);
const blobs = new Map([[sha(initialBytes), initialBytes]]);
let currentSha = sha(initialBytes), nextStatus = null, loseReply = false, beforePut = null;
let now = Date.now();
const calls = [];
const githubFetch = async (url, options) => {
  assert.equal(new URL(url).origin, 'https://api.github.com');
  assert.equal(options.headers.Authorization, `Bearer ${centralToken}`, 'only the private service supplies the shared GitHub credential');
  assert.equal(options.redirect, 'error');
  for (const text of [url, JSON.stringify(options.headers), options.body || '']) assert.ok(!text.includes(key), 'the package key never goes to GitHub');
  calls.push({ url, method: options.method, body: options.body });
  assert.notEqual(url, 'https://api.github.com/user', 'the backend never reads or exposes the shared account identity');
  if (nextStatus) { const status = nextStatus; nextStatus = null; return json({ message: `private-error-detail-${centralToken}` }, status); }
  if (url.includes('/git/blobs/')) return new Response(blobs.get(url.split('/').at(-1)), { status: 200 });
  assert.match(url, /^https:\/\/api\.github\.com\/repos\/monocraft\/PPC\/contents\/public\/data\/master_ppc\.pkg(?:\?ref=main)?$/);
  if (options.method === 'GET') return json({ type: 'file', sha: currentSha, size: blobs.get(currentSha).length });
  assert.equal(options.method, 'PUT');
  const body = JSON.parse(options.body);
  assert.deepEqual(Object.keys(body).sort(), ['branch', 'content', 'message', 'sha']);
  assert.equal(body.branch, 'main');
  assert.ok(!/Alex|Blair|Team headset/.test(body.message), 'the plaintext commit message contains no editor/product names');
  if (beforePut) { const callback = beforePut; beforePut = null; await callback(); }
  if (body.sha !== currentSha) return json({ message: 'sha changed' }, 409);
  const bytes = new Uint8Array(Buffer.from(body.content, 'base64'));
  assert.ok(codec.isEncrypted(bytes));
  currentSha = sha(bytes); blobs.set(currentSha, bytes);
  if (loseReply) { loseReply = false; throw new TypeError('Committed reply lost'); }
  return json({ content: { sha: currentSha } });
};

const server = createMasterServer({ storage: 'github', githubToken: centralToken, fetchImpl: githubFetch, allowedOrigins: [origin], now: () => now });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
async function request(path, body, headers = {}) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (path === '/api/package/latest' && response.ok) return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) };
  const text = await response.text();
  for (const secret of [centralToken, key, wrongKey]) assert.ok(!text.includes(secret), 'responses never expose keys, private credentials, or upstream private errors');
  return { status: response.status, data: JSON.parse(text), response };
}
async function latest() {
  const result = await request('/api/master/latest', { key });
  assert.equal(result.status, 200);
  assert.equal(result.data.snapshot.requiresEditorToken, false);
  assert.equal(result.data.snapshot.requiresGitHubToken, false);
  assert.equal(result.data.snapshot.canWrite, true);
  assert.equal(result.data.snapshot.source, 'service');
  assert.equal(result.data.snapshot.identity, null);
  return result.data.snapshot;
}
const product = snapshot => snapshot.products.find(item => item.productId === 'p1');
const change = (snapshot, patch) => ({ productId: 'p1', base: product(snapshot).values, baseRevisions: product(snapshot).revisions, patch });
const payload = (snapshot, patch, sessionId = 'alex-team-session', editorName = 'Alex', requestId = randomUUID()) => ({ key, sessionId, editorName, requestId, changes: [change(snapshot, patch)] });
const save = (snapshot, patch, sessionId, name) => request('/api/master/save', payload(snapshot, patch, sessionId, name));
async function inspect() {
  const entries = codec.readZip(await codec.decrypt(blobs.get(currentSha), key));
  assert.deepEqual(entries.get('images/image1.webp'), image);
  assert.deepEqual(entries.get('attachments/source.bin'), extra);
  return JSON.parse(new TextDecoder().decode(entries.get('portfolio.json')));
}
try {
  assert.throws(() => createMasterHandler({ storage: 'github', githubToken: centralToken }), /origin/);
  assert.throws(() => createMasterHandler({ storage: 'github', allowedOrigins: [origin] }), /credential/);
  const env = masterConfigFromEnv({ PPC_MASTER_STORAGE: 'github', PPC_GITHUB_TOKEN: centralToken, PPC_ALLOWED_ORIGINS: origin });
  assert.equal(env.storage, 'github'); assert.equal(env.githubToken, centralToken);
  const health = await fetch(`${base}/healthz`);
  assert.deepEqual(await health.json(), { status: 'ok' });
  const preflight = await fetch(`${base}/api/master/save`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);

  const original = await latest();
  const rawBefore = calls.filter(call => call.url.includes('/git/blobs/')).length;
  await latest();
  assert.equal(calls.filter(call => call.url.includes('/git/blobs/')).length, rawBefore, 'repeat reads reuse ciphertext without retaining plaintext');
  const downloaded = await request('/api/package/latest', { key });
  assert.equal(downloaded.status, 200); assert.deepEqual(downloaded.bytes, initialBytes);
  assert.equal((await request('/api/master/latest', { key: wrongKey })).status, 401);
  assert.equal((await request('/api/package/latest', { key: wrongKey })).status, 401);
  assert.equal((await request('/api/master/save', payload(original, { ffsDate: '2027-02-02' }), { Origin: 'https://untrusted.invalid' })).status, 403);
  assert.equal((await request('/api/master/save', { ...payload(original, { ffsDate: '2027-02-02' }), sessionId: undefined })).status, 400);
  assert.equal((await request('/api/master/save', { ...payload(original, { ffsDate: '2027-02-02' }), editorName: 'x'.repeat(61) })).status, 400);
  assert.equal((await request('/api/master/save', { ...payload(original, { ffsDate: '2027-02-02' }), key: wrongKey })).status, 401);

  const two = await Promise.all([
    save(original, { ffsDate: '2027-02-02' }, 'alex-team-session', 'Alex'),
    save(original, { generalAvailabilityDate: '2027-04-15' }, 'blair-team-session', 'Blair'),
  ]);
  assert.deepEqual(two.map(item => item.status), [200, 200], 'two names share the one private connection and merge independent changes');
  let stored = await inspect();
  assert.deepEqual(new Set(stored.masterSync.history.map(item => item.actor)), new Set(['Alex', 'Blair']));
  assert.ok(stored.masterSync.history.every(item => item.actorSource === 'self-reported'));
  assert.deepEqual(stored.privateMetadata, fixture.privateMetadata);
  assert.equal(stored.packageInfo.comments, fixture.packageInfo.comments);
  assert.equal(stored.categories[0].board.products[0].roadmap.launchMonth, '2027-04');
  assert.equal(stored.masterSync.githubRequests.length, 2);
  assert.notEqual(stored.masterSync.githubRequests[0].actor, stored.masterSync.githubRequests[1].actor, 'idempotency separates sessions, independently of display names');

  const concurrent = await latest();
  const competing = await Promise.all([
    save(concurrent, { ffsDate: '2027-02-03' }, 'alex-team-session', 'Alex'),
    save(concurrent, { ffsDate: '2027-02-04' }, 'blair-team-session', 'Blair'),
  ]);
  assert.deepEqual(competing.map(item => item.status).sort(), [200, 409]);
  const loser = competing.find(item => item.status === 409).data;
  assert.equal(loser.code, 'MASTER_CONFLICT');
  assert.ok(loser.conflicts.length);
  const revisionBeforeConflict = currentSha;
  assert.equal((await save(concurrent, { ffsDate: '2027-02-05' }, 'another-team-session', '')).status, 409);
  assert.equal(currentSha, revisionBeforeConflict, 'conflicting changes do not write anything');
  assert.equal((await save(loser.snapshot, { ffsDate: '2027-02-06' }, 'blair-team-session', 'Blair')).status, 200);
  assert.equal((await save(loser.snapshot, { ffsDate: '2027-02-07' }, 'alex-team-session', 'Alex')).status, 409, 'a new change while choosing requires another decision');

  const uncertain = payload(await latest(), { globalAnnouncementDate: '2027-04-01' });
  loseReply = true;
  const recovered = await request('/api/master/save', uncertain);
  assert.equal(recovered.status, 200); assert.equal(recovered.data.alreadySaved, true);
  const already = currentSha;
  assert.equal((await request('/api/master/save', uncertain)).data.alreadySaved, true);
  assert.equal(currentSha, already);
  assert.equal((await request('/api/master/save', { ...uncertain, editorName: 'Changed optional name' })).data.alreadySaved, true, 'renaming a session does not replay an accepted save');
  const reused = structuredClone(uncertain); reused.changes[0].patch.globalAnnouncementDate = '2027-03-31';
  assert.equal((await request('/api/master/save', reused)).status, 400);

  const aba = await latest();
  assert.equal((await save(aba, { finalAssetsDate: '2027-02-05' })).status, 200);
  assert.equal((await save(await latest(), { finalAssetsDate: product(aba).values.finalAssetsDate })).status, 200);
  assert.equal((await save(aba, { finalAssetsDate: '2027-02-04' })).status, 409, 'restored old values still fence intervening writes by revision');

  const collection = await latest();
  assert.equal((await save(collection, { specs: [{ ...product(collection).values.specs[0], value: '240 g' }], partSkus: [...product(collection).values.partSkus, { id: 'k2', code: 'TEAM-002', colorCode: 'WH' }] }, 'anonymous-team-session', '')).status, 200);
  stored = await inspect();
  assert.equal(stored.masterSync.history.at(-1).actor, 'Editor ANON', 'names are optional and anonymous editors still save');
  assert.equal(stored.categories[0].board.products[0].specs[0].icon, 'Preserve icon');

  let roster = await request('/api/master/presence', { key, sessionId: 'alex-team-session', displayName: 'Alex', editing: true, productId: 'p1' });
  assert.equal(roster.status, 200); assert.equal(roster.data.users[0].productName, 'Team headset');
  roster = await request('/api/master/presence', { key, sessionId: 'blair-team-session', displayName: '', editing: false });
  assert.equal(roster.data.onlineCount, 2);
  assert.equal((await request('/api/master/presence', { key: wrongKey, sessionId: 'wrong-key-session' })).status, 401);
  roster = await request('/api/master/presence', { key, sessionId: 'alex-team-session', leave: true });
  assert.equal(roster.data.onlineCount, 1);
  now += 66000;
  roster = await request('/api/master/presence', { key, sessionId: 'fresh-team-session', displayName: 'New' });
  assert.equal(roster.data.onlineCount, 1, 'departed sessions expire without GitHub presence commits');

  for (const status of [401, 403, 404]) {
    nextStatus = status;
    const unavailable = await request('/api/master/latest', { key });
    assert.equal(unavailable.status, 503); assert.equal(unavailable.data.code, 'MASTER_UNAVAILABLE');
    assert.ok(!/token|GitHub account|Contents/i.test(unavailable.data.error), 'connection failures direct the owner to setup, without asking users for tokens');
  }
  assert.equal((await save(await latest(), { uneditableField: 'must reject' })).status, 422);
  const beforeRotation = currentSha;
  const rotated = await seal(await inspect(), wrongKey);
  currentSha = sha(rotated); blobs.set(currentSha, rotated);
  assert.equal((await request('/api/master/presence', { key, sessionId: 'fresh-team-session', displayName: 'New' })).status, 401, 'presence authorization is invalidated when the encrypted master changes keys');
  currentSha = beforeRotation;
  nextStatus = 429;
  const limited = await request('/api/master/latest', { key });
  assert.equal(limited.status, 503); assert.equal(limited.data.code, 'MASTER_UNAVAILABLE');
  assert.ok(Number(limited.response.headers.get('retry-after')) >= 60);
  const blockedCalls = calls.length;
  assert.equal((await request('/api/master/latest', { key })).status, 503);
  assert.equal(calls.length, blockedCalls, 'a shared upstream limit pauses every session until reset');
  assert.ok(calls.filter(call => call.method === 'PUT').every(call => call.url.endsWith('/contents/public/data/master_ppc.pkg')));
  console.log('Private team master checks passed: one server credential, optional self-reported names, key authorization, two-user CAS merges/conflicts, lost-reply idempotency, ciphertext cache, preserved assets, and live presence.');
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
