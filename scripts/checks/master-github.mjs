import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
await import('../../public/js/package-codec.js');
await import('../../public/js/portfolio-model.js');
await import('../../public/js/master-model.js');
await import('../../public/js/product-merge.js');
await import('../../public/js/master-github.js');

const codec = globalThis.PortfolioPackage;
const github = globalThis.PortfolioMasterGitHub;
const key = codec.generateKey();
const wrongKey = codec.generateKey();
const tokenA = 'github_pat_fixture_A_private_token';
const tokenB = 'github_pat_fixture_B_private_token';
const readToken = 'github_pat_fixture_read_only';
const image = Uint8Array.of(0, 255, 1, 8, 0, 5);
const extra = Uint8Array.of(7, 3, 19);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const manifest = {
  version: 4, activeCategoryId: 'pc-gaming-audio', privateSource: { keep: true },
  packageInfo: { version: 1, updatedAt: '2026-01-01T00:00:00.000Z', comments: 'Preserve package comments.' },
  imageAssets: [{ id: 'image1', sourceType: 'local', packagePath: 'images/image1.webp' }],
  categories: [{ id: 'pc-gaming-audio', board: { lanes: [{ id: 'wired', label: 'Wired' }], savedBoard: { marker: true }, products: [{
    id: 'p1', name: 'Fixture product', price: 99, imageAssetId: 'image1', privateProduct: { note: 'Preserve' },
    generalAvailabilityDate: '2027-01-10', ffsDate: '2026-12-05', endManufacturingDate: '2029-12-31',
    roadmap: { startMonth: '2027-01', launchMonth: '2027-01', endMonth: '2029-12', notes: 'Preserve notes' },
    specs: [{ id: 's1', label: 'Battery', value: '40 hours', icon: 'Preserve icon' }, { id: 's2', label: 'Weight', value: '250 g' }],
    partSkus: [{ id: 'hp1', code: 'HP-001', colorCode: 'BK' }],
    variantGroups: [{ id: 'g1', type: 'color', label: 'Colors', items: [{ id: 'v1', code: 'BK', label: 'Black', imageAssetId: 'image1', extra: 'Preserve' }] }],
  }] } }],
};
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const blobSha = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

async function packageBytes(value) {
  return codec.encrypt(codec.createZip([
    { name: 'portfolio.json', data: encoder.encode(JSON.stringify(value)) },
    { name: 'images/image1.webp', data: image }, { name: 'attachments/extra.bin', data: extra },
  ]), key);
}

function mockGitHub(initial) {
  const blobs = new Map();
  const calls = [];
  let current = blobSha(initial);
  blobs.set(current, initial);
  let onPut = null, loseReply = false, deny422 = false, wrongRaw = null, metadataOverride = null, inlineContent = false;
  const identityFor = access => access === tokenA ? { login: 'team-a', name: 'Alex Team' } : access === tokenB ? { login: 'team-b', name: 'Blair Team' } : access === readToken ? { login: 'viewer', name: 'Viewer' } : null;
  const fetchImpl = async (url, options) => {
    assert.equal(new URL(url).origin, 'https://api.github.com', 'the adapter never follows returned download URLs');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    const access = String(options.headers.Authorization || '').replace(/^Bearer /, '');
    for (const value of [url, JSON.stringify(options.headers), options.body || '']) assert.ok(!value.includes(key), 'the package key never leaves the browser');
    calls.push({ url, method: options.method, access, body: options.body });
    if (access && !identityFor(access)) return json({ message: 'Bad credentials' }, 401);
    if (url === 'https://api.github.com/user') return identityFor(access) ? json(identityFor(access)) : json({}, 401);
    if (url.includes('/git/blobs/')) {
      assert.match(options.headers.Accept, /raw/);
      const sha = url.split('/').at(-1);
      return new Response(wrongRaw || blobs.get(sha), { status: 200 });
    }
    assert.match(url, /^https:\/\/api\.github\.com\/repos\/monocraft\/PPC\/contents\/public\/data\/master_ppc\.pkg(?:\?ref=main)?$/);
    if (options.method === 'GET') return json(metadataOverride || { type: 'file', sha: current, size: blobs.get(current).length, encoding: inlineContent ? 'base64' : 'none', content: inlineContent ? Buffer.from(blobs.get(current)).toString('base64') : '', download_url: 'https://untrusted.invalid/do-not-use' });
    assert.equal(options.method, 'PUT');
    if (access === readToken) return json({ message: 'Resource not accessible' }, 403);
    if (!identityFor(access)) return json({}, 401);
    if (deny422) return json({ message: 'Branch rule rejected' }, 422);
    const body = JSON.parse(options.body);
    assert.equal(body.branch, 'main');
    if (onPut) { const hook = onPut; onPut = null; await hook(); }
    if (body.sha !== current) return json({ message: 'sha does not match' }, 409);
    const bytes = new Uint8Array(Buffer.from(body.content, 'base64'));
    assert.ok(codec.isEncrypted(bytes));
    current = blobSha(bytes); blobs.set(current, bytes);
    if (loseReply) { loseReply = false; throw new TypeError('A committed response was lost'); }
    return json({ content: { sha: current }, commit: { sha: 'c'.repeat(40) } });
  };
  return {
    fetchImpl, calls,
    get current() { return current; }, get bytes() { return blobs.get(current); },
    beforePut(hook) { onPut = hook; }, loseNextReply() { loseReply = true; }, rejectValidation(value) { deny422 = value; },
    setWrongRaw(bytes) { wrongRaw = bytes; }, overrideMetadata(value) { metadataOverride = value; },
    replace(bytes) { current = blobSha(bytes); blobs.set(current, bytes); },
    useInlineMetadata() { inlineContent = true; },
  };
}

const one = snapshot => snapshot.products.find(product => product.productId === 'p1');
const change = (snapshot, patch) => ({ productId: 'p1', base: one(snapshot).values, baseRevisions: one(snapshot).revisions, patch });
const savePayload = (snapshot, patch, requestId = randomUUID()) => ({ key, requestId, changes: [change(snapshot, patch)], reason: 'Team fixture edit' });
const database = mockGitHub(await packageBytes(manifest));
const transport = github.createTransport({ token: tokenA, fetchImpl: database.fetchImpl });
const other = github.createTransport({ token: tokenB, fetchImpl: database.fetchImpl });
const publicReader = github.createTransport({ fetchImpl: database.fetchImpl });

assert.equal(github.normalizeConfig({}).path, 'public/data/master_ppc.pkg');
for (const config of [{ owner: 'another' }, { repo: 'other' }, { branch: 'evil' }, { path: '../private' }, { apiBase: 'https://untrusted.invalid' }, { token: tokenA }]) assert.throws(() => github.normalizeConfig(config));
const anonymous = await publicReader.latest({ key });
assert.equal(anonymous.snapshot.canWrite, false);
assert.equal(anonymous.snapshot.identity, null);
const initial = (await transport.latest({ key })).snapshot;
assert.equal(initial.identity.login, 'team-a');
assert.equal(initial.identity.name, 'Alex Team');
assert.equal(initial.source, 'github');
assert.equal(initial.canWrite, true);
const rawGets = () => database.calls.filter(call => call.url.includes('/git/blobs/')).length;
const beforeCached = rawGets();
await transport.latest({ key });
assert.equal(rawGets(), beforeCached, 'unchanged snapshots require only current SHA metadata, not another full package download');
await assert.rejects(transport.latest({ key: wrongKey }), error => error.code === 'INVALID_KEY');
await assert.rejects(publicReader.save(savePayload(initial, { ffsDate: '2026-12-06' })), error => error.code === 'GITHUB_TOKEN_REQUIRED');

const otherInitial = (await other.latest({ key })).snapshot;
database.beforePut(async () => {
  const saved = await other.save(savePayload(otherInitial, { ffsDate: '2026-12-07' }));
  assert.equal(saved.savedProducts, 1);
});
const saved = await transport.save(savePayload(initial, { generalAvailabilityDate: '2027-02-15' }));
assert.equal(one(saved.snapshot).values.generalAvailabilityDate, '2027-02-15');
assert.equal(one(saved.snapshot).values.startMonth, '2027-02');
assert.equal(one(saved.snapshot).values.ffsDate, '2026-12-07', 'a CAS race retries and merges another team\'s independent edit');
assert.deepEqual(saved.snapshot.recentEditors.map(editor => editor.login), ['team-a', 'team-b']);
const latestBase = saved.snapshot;
const existing = database.bytes.slice();
const conflicted = await other.save(savePayload(otherInitial, { generalAvailabilityDate: '2027-03-20' }));
assert.equal(conflicted.code, 'MASTER_CONFLICT');
assert.ok(conflicted.conflicts.length);
assert.deepEqual(database.bytes, existing, 'stale same-field edits make no GitHub commit');
const rebased = await other.save(savePayload(conflicted.snapshot, { generalAvailabilityDate: '2027-03-20' }));
assert.equal(one(rebased.snapshot).values.generalAvailabilityDate, '2027-03-20');
const repeatedRace = await transport.save(savePayload(conflicted.snapshot, { generalAvailabilityDate: '2027-04-20' }));
assert.equal(repeatedRace.code, 'MASTER_CONFLICT', 'a second edit while choosing requires another explicit final-value decision');

const abaBase = (await transport.latest({ key })).snapshot;
await other.save(savePayload(abaBase, { ffsDate: '2026-12-09' }));
await other.save(savePayload((await other.latest({ key })).snapshot, { ffsDate: one(abaBase).values.ffsDate }));
const aba = await transport.save(savePayload(abaBase, { ffsDate: '2026-12-10' }));
assert.equal(aba.code, 'MASTER_CONFLICT', 'master revisions detect a changed-away-and-back value');

const idempotentBase = (await transport.latest({ key })).snapshot;
const requestId = randomUUID();
const payload = savePayload(idempotentBase, { webReadinessDate: '2027-02-25' }, requestId);
database.loseNextReply();
const idempotent = await transport.save(payload);
assert.equal(idempotent.alreadySaved, true, 'a lost reply is recovered from the encrypted completion journal');
const putsAfterLostReply = database.calls.filter(call => call.method === 'PUT').length;
const duplicate = await transport.save(payload);
assert.equal(duplicate.alreadySaved, true);
assert.equal(database.calls.filter(call => call.method === 'PUT').length, putsAfterLostReply, 'retrying a completed request never creates another commit');
await assert.rejects(transport.save({ ...payload, reason: 'Different request intent' }), error => error.code === 'INVALID_REQUEST');

const specBase = (await transport.latest({ key })).snapshot;
const specsA = structuredClone(one(specBase).values.specs), specsB = structuredClone(specsA);
specsA[0].value = '60 hours'; specsB[1].value = '240 g';
await transport.save(savePayload(specBase, { specs: specsA }));
const specsMerged = await other.save(savePayload(specBase, { specs: specsB }));
assert.equal(one(specsMerged.snapshot).values.specs[0].value, '60 hours');
assert.equal(one(specsMerged.snapshot).values.specs[1].value, '240 g');
const skuBase = specsMerged.snapshot;
await transport.save(savePayload(skuBase, { partSkus: [...one(skuBase).values.partSkus, { id: 'hp2', code: 'HP-002' }] }));
const added = await other.save(savePayload(skuBase, { partSkus: [...one(skuBase).values.partSkus, { id: 'hp3', code: 'HP-003' }] }));
assert.equal(one(added.snapshot).values.partSkus.length, 3);

const entries = codec.readZip(await codec.decrypt(database.bytes, key));
const persisted = JSON.parse(decoder.decode(entries.get('portfolio.json')));
assert.deepEqual(entries.get('images/image1.webp'), image);
assert.deepEqual(entries.get('attachments/extra.bin'), extra);
assert.deepEqual(persisted.privateSource, manifest.privateSource);
assert.equal(persisted.categories[0].board.products[0].privateProduct.note, 'Preserve');
assert.equal(persisted.categories[0].board.products[0].specs[0].icon, 'Preserve icon');
assert.equal(persisted.categories[0].board.products[0].variantGroups[0].items[0].extra, 'Preserve');
assert.equal(persisted.packageInfo.comments, manifest.packageInfo.comments);
for (const secret of [tokenA, tokenB, key]) assert.ok(!JSON.stringify(persisted).includes(secret), 'keys and personal tokens are never stored in history or the package');
assert.ok(persisted.masterSync.githubRequests.length <= 64);
assert.equal(persisted.masterSync.history.at(-1).actor, 'team-b', 'audit authors come from authenticated /user rather than a typed label');
const pulled = await github.downloadLatest({ fetchImpl: database.fetchImpl });
assert.deepEqual(pulled, database.bytes, 'complete package pulls return the actual GitHub master after team saves');

const denied = github.createTransport({ token: readToken, fetchImpl: database.fetchImpl });
const deniedBase = (await denied.latest({ key })).snapshot;
await assert.rejects(denied.save(savePayload(deniedBase, { ffsDate: '2026-12-11' })), error => error.code === 'GITHUB_PERMISSION_DENIED');
const invalid = github.createTransport({ token: 'invalid-token', fetchImpl: database.fetchImpl });
await assert.rejects(invalid.getIdentity(), error => error.code === 'INVALID_GITHUB_TOKEN');
database.rejectValidation(true);
const validationBase = (await transport.latest({ key })).snapshot;
const beforeInvalidPut = database.calls.filter(call => call.method === 'PUT').length;
await assert.rejects(transport.save(savePayload(validationBase, { ffsDate: '2026-12-12' })), error => error.code === 'GITHUB_SAVE_REJECTED');
assert.equal(database.calls.filter(call => call.method === 'PUT').length, beforeInvalidPut + 1, '422 without a changed SHA is not repeatedly retried');
database.rejectValidation(false);
const large = github.createTransport({ fetchImpl: database.fetchImpl });
database.overrideMetadata({ type: 'file', sha: database.current, size: 64 * 1024 * 1024 + 1 });
await assert.rejects(large.readPackage(), error => error.code === 'INVALID_MASTER');
database.overrideMetadata(null);
database.setWrongRaw(Uint8Array.of(1, 2, 3));
await assert.rejects(large.readPackage(), error => error.code === 'INVALID_MASTER');
database.setWrongRaw(null);
assert.throws(() => transport.request({ operation: 'presence', key }), error => error.code === 'UNSUPPORTED_OPERATION');
const inlineBytes = await codec.encrypt(codec.createZip([
  { name: 'portfolio.json', data: encoder.encode(JSON.stringify(manifest)) },
  { name: 'images/image1.webp', data: image }, { name: 'attachments/large.bin', data: new Uint8Array(256 * 1024).fill(7) },
]), key);
const inlineDatabase = mockGitHub(inlineBytes);
inlineDatabase.useInlineMetadata();
const inlineTransport = github.createTransport({ fetchImpl: inlineDatabase.fetchImpl });
assert.equal((await inlineTransport.latest({ key })).snapshot.products.length, 1, 'inline metadata larger than 256 KiB is supported for valid sub-1 MiB GitHub files');
assert.equal(inlineDatabase.calls.filter(call => call.url.includes('/git/blobs/')).length, 1, 'inline metadata content is ignored in favor of the immutable blob');

let limitedCalls = 0;
const rateLimited = github.createTransport({ fetchImpl: async () => {
  limitedCalls += 1;
  return json({}, 403, { 'Retry-After': '120' });
} });
await assert.rejects(rateLimited.latest({ key }), error => error.code === 'GITHUB_RATE_LIMIT' && error.retryUntil > Date.now());
await assert.rejects(rateLimited.latest({ key }), error => error.code === 'GITHUB_RATE_LIMIT');
assert.equal(limitedCalls, 1, 'background retries pause locally until GitHub\'s rate limit resets');
rateLimited.setToken(tokenA);
await assert.rejects(rateLimited.getIdentity(), error => error.code === 'GITHUB_RATE_LIMIT');
assert.equal(limitedCalls, 2, 'connecting another credential resets the local quota backoff');
const secondaryRate = github.createTransport({ fetchImpl: async () => json({ message: 'Secondary rate limit reached.' }, 403) });
await assert.rejects(secondaryRate.latest({ key }), error => error.code === 'GITHUB_RATE_LIMIT' && error.retryUntil >= Date.now() + 59000, 'secondary quota errors without headers still wait at least a minute');

const stalled = github.createTransport({ token: tokenA, requestTimeoutMs: 50, fetchImpl: async (url, options) => new Promise((resolve, reject) => {
  options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
}) });
await assert.rejects(stalled.getIdentity(), error => error.code === 'UNAVAILABLE', 'a stalled request has a bounded deadline');
const stalledBody = github.createTransport({ token: tokenA, requestTimeoutMs: 50, fetchImpl: async (url, options) => new Response(new ReadableStream({
  start(controller) { options.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true }); },
})) });
await assert.rejects(stalledBody.getIdentity(), error => error.code === 'UNAVAILABLE', 'the request deadline also covers a stalled response body');
const deadlineDatabase = mockGitHub(await packageBytes(manifest));
let stallAcceptedReply = true;
const deadlineTransport = github.createTransport({ token: tokenA, requestTimeoutMs: 50, fetchImpl: async (url, options) => {
  const response = await deadlineDatabase.fetchImpl(url, options);
  if (options.method === 'PUT' && stallAcceptedReply) {
    stallAcceptedReply = false;
    return new Response(new ReadableStream({ start(controller) { options.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true }); } }));
  }
  return response;
} });
const deadlineSnapshot = (await deadlineTransport.latest({ key })).snapshot;
const recoveredDeadline = await deadlineTransport.save(savePayload(deadlineSnapshot, { ffsDate: '2026-12-14' }));
assert.equal(recoveredDeadline.alreadySaved, true, 'an upload response timeout checks the committed journal rather than creating a second commit');
transport.disconnect();
assert.equal(transport.hasToken(), false);
await assert.rejects(transport.save(savePayload(validationBase, { ffsDate: '2026-12-13' })), error => error.code === 'GITHUB_TOKEN_REQUIRED');
const source = await readFile(new URL('../../public/js/master-github.js', import.meta.url), 'utf8');
assert.ok(!source.includes('localStorage') && !source.includes('sessionStorage') && !source.includes('console.'), 'credentials have no browser storage or logging path');
console.log('GitHub master checks passed: immutable encrypted reads, authenticated authors, CAS merges/conflicts, ABA, lost reply recovery, complete ZIP preservation, bounded requests, and memory-only tokens.');
