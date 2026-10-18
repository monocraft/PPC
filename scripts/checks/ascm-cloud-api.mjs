import assert from 'node:assert/strict';
import '../../public/js/package-codec.js';
import { createHash } from 'node:crypto';
import { requireReadableManifest, publicSnapshot, validateManifest } from '../../supabase/functions/ppc-master/gateway.mjs';

let api;
try { api = await import('../../supabase/functions/ppc-master/ascm-api.mjs'); } catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}
assert.equal(typeof api?.createAscmApi, 'function', 'cloud ASCM API must expose an authenticated transaction handler');
const { createAscmApi } = api;
const clone = value => structuredClone(value);
const secret = 'isolated-import-secret-'.padEnd(48, 'a');
const now = () => '2026-10-17T12:00:00.000Z';
function workbook() {
  const table = [['Category', 'Base PN', 'GPG 40 char AMO Description', 'GA - General Availability', 'EM - End of Manufacturing'],
    ['Headset', 'A1AAA', 'HyperX Cloud III BLK GAM HS', '2026-01-15', '2029-12-31']];
  const rows = table.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${value}</t></is></c>`).join('')}</row>`).join('');
  const files = {
    '[Content_Types].xml': '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    'xl/workbook.xml': '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="ASCM" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
  };
  return globalThis.PortfolioPackage.createZip(Object.entries(files).map(([name, xml]) => ({ name, data: new TextEncoder().encode(xml) })));
}
const bytes = await workbook();
const body = { sender: 'linny.chen@hp.com', subject: 'ASCM Report Accessories HyperX Release Notification October 2026',
  receivedAt: '2026-09-30T09:01:09Z', messageId: 'synthetic-email-id', fileName: 'ASCM Report_HyperX_2026-09-30.xlsx', workbookBase64: Buffer.from(bytes).toString('base64') };
const requestId = 'ascm-' + createHash('sha256').update(bytes).digest('hex');
const seed = { version: 4, imageAssets: [{ id: 'image-1', packagePath: 'images/image-1.png' }], custom: { retain: true },
  categories: [{ id: 'pc-gaming-audio', name: 'PC gaming audio', board: { lanes: [{ id: 'wired', title: 'Wired' }], products: [
    { id: 'cloud-iii', name: 'Cloud III', laneId: 'wired', order: 8, generalAvailabilityDate: '2026-01-15', endManufacturingDate: '2029-12-31',
      ascm: { basePartNumbers: ['A1AAA'] }, specs: [{ id: 'spec-1', label: 'Driver', value: '53 mm' }], partSkus: [], variantGroups: [], custom: { retain: true }, imageAssetId: 'image-1', price: 99 },
  ] } }] };

function fixture(initialManifest = seed) {
  const calls = [], receipts = new Map();
  let manifest = clone(initialManifest), revision = 1, published = 1, commits = 0;
  let race = false, loseReply = false, hideReceipt = false;
  const document = () => ({ manifest: clone(manifest), storageRevision: revision, publication: { publishedRevision: published, requestedRevision: revision, status: published >= revision ? 'current' : 'pending' } });
  return {
    calls, receipts, get commits() { return commits; }, inspect: document,
    publish(value = revision) { published = value; }, advance() { revision += 1; }, race() { race = true; }, loseReply() { loseReply = true; }, hideReceipt() { hideReceipt = true; },
    async database(operation, payload) {
      calls.push(operation);
      const key = `${payload.sessionId}:${payload.requestId}`;
      if (operation === 'rate') return { allowed: true };
      if (operation === 'read') return { ...document(), ...(!hideReceipt && receipts.has(key) ? { receipt: clone(receipts.get(key)) } : {}) };
      if (operation === 'commit') {
        if (receipts.has(key)) return { ...document(), status: 'already_saved', savedFields: receipts.get(key).savedFields, savedProducts: receipts.get(key).savedProducts };
        if (race || payload.expectedRevision !== revision) return { ...document(), status: 'raced' };
        if (payload.changed) { manifest = clone(payload.manifest); revision += 1; commits += 1; }
        receipts.set(key, { storageRevision: revision, fingerprint: payload.fingerprint, savedFields: payload.savedFields, savedProducts: payload.savedProducts });
        if (loseReply) { loseReply = false; throw new Error('synthetic lost accepted reply'); }
        return { ...document(), status: 'saved', savedFields: payload.savedFields, savedProducts: payload.savedProducts };
      }
      throw new Error('Unexpected isolated RPC');
    },
  };
}
let dispatches = 0;
function handler(db, env = {}) {
  return createAscmApi({ env: { PPC_ASCM_IMPORT_SECRET: secret, ...env }, database: db.database, now,
    dispatchPublication: async () => { dispatches += 1; return true; },
    validateManifest(value) { assert.equal(value.version, 4); globalThis.PortfolioMasterModel.snapshot(value); },
    validateReadableManifest: requireReadableManifest,
  });
}
async function call(handle, payload = body, options = {}) {
  const response = await handle(new Request('https://example.supabase.co/functions/v1/ppc-master/api/master/ascm', {
    method: options.method || 'POST', headers: { 'Content-Type': 'application/json', 'X-PPC-ASCM-Secret': secret, ...options.headers },
    ...(options.method === 'GET' ? {} : { body: options.raw ?? JSON.stringify(payload) }),
  }));
  return { status: response.status, data: await response.json() };
}
let db = fixture(), handle = handler(db);
assert.equal((await call(handler(db, { PPC_ASCM_IMPORT_SECRET: '' }))).status, 404);
assert.equal((await call(handle, body, { headers: { 'X-PPC-ASCM-Secret': 'wrong' } })).status, 401);
assert.equal((await call(handle, body, { headers: { Origin: 'https://monocraft.github.io' } })).status, 403);
assert.equal((await call(handle, body, { method: 'GET' })).status, 405);
assert.equal(db.calls.length, 0, 'disabled, unauthorized, browser and method rejection must not access database');
assert.equal((await call(handle, { ...body, key: 'arbitrary' })).status, 400);
assert.equal((await call(handle, { ...body, subject: 'ASCM Review Notification October 2026' })).status, 400);
assert.equal((await call(handle, { ...body, workbookBase64: 'not-base64!' })).status, 400);
assert.equal((await call(handle, body, { raw: '{' })).status, 400);
assert.equal(db.calls.length, 0, 'invalid source and malformed request must not touch database');
assert.equal((await call(handle, { ...body, workbookBase64: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') })).status, 413);

const initial = await call(handle);
assert.equal(initial.status, 202, JSON.stringify(initial.data));
assert.equal(initial.data.requestId, requestId);
assert.equal(initial.data.storageRevision, 2);
assert.equal(initial.data.archiveAllowed, false, 'accepted import is not published yet');
assert.equal(Object.hasOwn(initial.data, 'reviewReason'), false, 'successful receipts never gain a review reason');
assert.equal(db.commits, 1); assert.equal(dispatches, 1);
assert.deepEqual(db.inspect().manifest.imageAssets, seed.imageAssets);
assert.deepEqual(db.inspect().manifest.custom, seed.custom);
assert.equal(db.inspect().manifest.categories[0].board.products[0].order, 8);
assert.equal(JSON.stringify(initial.data).includes('image-1'), false, 'response never discloses master or assets');
const replay = await call(handle, { ...body, messageId: 'forwarded-duplicate' });
assert.equal(replay.data.alreadySaved, true); assert.equal(db.commits, 1);
assert.equal(replay.data.archiveAllowed, false);
assert.equal(dispatches, 2, 'pending receipt replay recovers a lost idempotent publisher dispatch');
db.publish(2); db.advance();
const published = await call(handle);
assert.equal(published.status, 200); assert.equal(published.data.archiveAllowed, true);
assert.equal(published.data.storageRevision, 2, 'archive gate uses receipt revision, not current unrelated revision');
assert.equal(Object.hasOwn(published.data, 'reviewReason'), false);
// In either cutover phase, legacy Git acknowledgements and historical seed
// receipts cannot satisfy Archive. A native import receipt remains mandatory.
for (const phase of ['seeding', 'sharepoint']) {
  const originalDatabase = db.database;
  let publication = { deliveryPhase: phase, publishedRevision: 99, githubSha: 'a'.repeat(40) };
  const phased = handler({ database: async (operation, payload) => {
    const result = await originalDatabase(operation, payload);
    return operation === 'read' ? { ...result, publication } : result;
  } });
  assert.equal((await call(phased)).data.archiveAllowed, false, 'legacy_ack_cannot_archive');
  publication = { ...publication, provider: 'sharepoint', kind: 'seed', candidateId: '11111111-2222-4333-8444-555555555555', generation: 1, sha256: 'b'.repeat(64), bytes: 36, storageRevision: 2, publishedAt: now() };
  assert.equal((await call(phased)).data.archiveAllowed, false, 'seed receipt cannot archive');
  publication.kind = 'publication'; assert.equal((await call(phased)).data.archiveAllowed, true, 'qualifying normal SharePoint receipt permits native import Archive');
  publication.sha256 = ''; assert.equal((await call(phased)).data.archiveAllowed, false, 'missing digest holds Archive');
}
assert.equal((await call(handle, { ...body, subject: 'ASCM Report Accessories HyperX Release Notification September 2026' })).status, 409, 'same bytes cannot replay as a different publication');

db = fixture(); db.race();
assert.equal((await call(handler(db))).status, 409); assert.equal(db.commits, 0, 'CAS races are held without replanning');
db = fixture(); db.loseReply(); handle = handler(db);
assert.equal((await call(handle)).status, 503);
assert.equal((await call(handle)).data.alreadySaved, true); assert.equal(db.commits, 1, 'lost accepted response retries native receipt');
db = fixture(); db.hideReceipt();
assert.equal((await call(handler(db))).status, 503, 'never claim accepted import without independent receipt readback');
db = fixture();
const badZip = { ...body, workbookBase64: Buffer.from('inert-not-xlsx').toString('base64') };
assert.equal((await call(handler(db), badZip)).status, 400); assert.equal(db.commits, 0);
const dateSeed = clone(seed);
dateSeed.categories[0].board.products[0].generalAvailabilityDate = '2026-01-01';
db = fixture(dateSeed);
const beforeReviewDispatches = dispatches;
const dateReview = await call(handler(db));
assert.equal(dateReview.status, 409);
assert.equal(dateReview.data.code, 'ASCM_REVIEW_REQUIRED');
assert.equal(dateReview.data.archiveAllowed, false);
assert.equal(db.commits, 0, 'unknown device locks hold an existing date update');
assert.equal(dispatches, beforeReviewDispatches);
db = fixture(dateSeed);
assert.equal((await call(handler(db, { PPC_ASCM_DATE_POLICY: JSON.stringify({ version: 1, allowUpdates: true, protected: [] }) }))).status, 202);
assert.equal(db.inspect().manifest.categories[0].board.products[0].generalAvailabilityDate, '2026-01-15');
db = fixture(dateSeed);
const beforeProtectedDispatches = dispatches;
const protectedReview = await call(handler(db, { PPC_ASCM_DATE_POLICY: JSON.stringify({ version: 1, allowUpdates: true, protected: [{ productId: 'cloud-iii', fields: ['generalAvailabilityDate'] }] }) }));
assert.equal(protectedReview.status, 409);
assert.equal(protectedReview.data.code, 'ASCM_REVIEW_REQUIRED');
assert.equal(protectedReview.data.archiveAllowed, false);
assert.equal(db.commits, 0);
assert.equal(dispatches, beforeProtectedDispatches);
assert.deepEqual([dateReview.data.reviewReason, protectedReview.data.reviewReason], ['DATE_POLICY_REQUIRED', 'PROTECTED_DATE'],
  'real lifecycle protection holds expose their distinct safe reasons');
assert.equal((await call(handler(db, { PPC_ASCM_DATE_POLICY: 'malformed' }))).status, 503);

const reviewPlan = await import('../../supabase/functions/ppc-master/ascm-plan.mjs');
const expectedReviewReasons = ['AMBIGUOUS_MATCH', 'CATEGORY_RELOCATION', 'DATE_POLICY_REQUIRED', 'DUPLICATE_MATCH',
  'INCOMPATIBLE_MAPPING', 'INCOMPLETE_NEW_PRODUCT', 'MALFORMED_REPORT', 'MASTER_CONFLICT', 'PRODUCT_ID_COLLISION',
  'PROTECTED_DATE', 'STALE_REPORT', 'TOO_MANY_GROUPS'];
assert(Array.isArray(reviewPlan.ASCM_REVIEW_REASONS));
assert(Object.isFrozen(reviewPlan.ASCM_REVIEW_REASONS));
assert.deepEqual(reviewPlan.ASCM_REVIEW_REASONS, expectedReviewReasons);
const privateSentinel = 'review-private-sentinel';
const invalidReviewReasons = [undefined, null, 42, {}, [], '', 'UNKNOWN_REVIEW_REASON', 'DATE_POLICY_REQUIRED '];
for (const reason of [...expectedReviewReasons, ...invalidReviewReasons]) {
  const error = new reviewPlan.AscmReviewError(reason, privateSentinel, { productId: privateSentinel, sourceRow: 12 });
  db = fixture(); let rejectedDispatches = 0;
  const rejecting = createAscmApi({ env: { PPC_ASCM_IMPORT_SECRET: secret }, database: db.database, now,
    dispatchPublication: async () => { rejectedDispatches++; return true; },
    validateManifest() { throw error; }, validateReadableManifest: requireReadableManifest });
  const held = await call(rejecting);
  assert.equal(held.status, 409);
  assert.deepEqual(held.data, { code: 'ASCM_REVIEW_REQUIRED', error: 'The report needs owner review. No report changes were saved.',
    archiveAllowed: false, ...(expectedReviewReasons.includes(reason) ? { reviewReason: reason } : {}) });
  assert.equal(JSON.stringify(held.data).includes(privateSentinel), false);
  assert.equal(db.commits, 0); assert.equal(rejectedDispatches, 0);
  assert.deepEqual(db.calls, ['rate', 'read'], 'review diagnostics add no database access or commits');
}
db = fixture(); let lookalikeDispatches = 0;
const lookalike = Object.assign(new Error(privateSentinel), { name: 'AscmReviewError', code: 'DATE_POLICY_REQUIRED', details: { productId: privateSentinel } });
const rejectingLookalike = createAscmApi({ env: { PPC_ASCM_IMPORT_SECRET: secret }, database: db.database, now,
  dispatchPublication: async () => { lookalikeDispatches++; return true; },
  validateManifest() { throw lookalike; }, validateReadableManifest: requireReadableManifest });
const lookalikeResponse = await call(rejectingLookalike);
assert.equal(lookalikeResponse.status, 503);
assert.deepEqual(lookalikeResponse.data, { code: 'ASCM_UNAVAILABLE', error: 'The ASCM import could not be confirmed. Keep the email and retry later.', archiveAllowed: false });
assert.equal(JSON.stringify(lookalikeResponse.data).includes(privateSentinel), false);
assert.equal(db.commits, 0); assert.equal(lookalikeDispatches, 0); assert.deepEqual(db.calls, ['rate', 'read']);
const { createMasterGateway } = await import('../../supabase/functions/ppc-master/gateway.mjs');
db = fixture();
const gatewayEnv = { PPC_PACKAGE_KEY_HASH: 'a'.repeat(64), PPC_PUBLISHER_SECRET: 'p'.repeat(48), PPC_ASCM_IMPORT_SECRET: secret };
const integrated = createMasterGateway({ env: gatewayEnv, rpc: db.database, now });
assert.equal((await call(integrated)).status, 202, 'actual gateway routes the optional transaction without exposing the ordinary key or publisher credential');
assert.equal(db.commits, 1);
db = fixture();
assert.equal((await call(createMasterGateway({ env: { ...gatewayEnv, PPC_ASCM_IMPORT_SECRET: '' }, rpc: db.database, now }))).status, 404);
assert.equal(db.calls.length, 0, 'ordinary deployed gateway keeps new operation unavailable without explicit configuration');
db = fixture();
const unreadable = createAscmApi({ env: { PPC_ASCM_IMPORT_SECRET: secret }, database: db.database, now,
  validateManifest: () => {}, validateReadableManifest() { throw new Error('synthetic full public response exceeds browser limit'); } });
assert.equal((await call(unreadable)).status, 503, 'a valid raw manifest must still pass the complete public response guard');
assert.equal(db.commits, 0, 'oversized public responses are rejected before commit');
// Real near-capacity metadata growth: a bare product snapshot can fit while
// the public response including masterSync crosses the browser transport cap.
const model = globalThis.PortfolioMasterModel;
const wideProduct = { name: 'N', laneId: 'wired', price: 1, roadmap: {} };
for (const field of model.DATE_FIELDS) wideProduct[field] = '2026-01-01';
for (const field of model.PRODUCT_FIELDS) if (field !== 'price') wideProduct[field] = 'X';
for (const [field, property] of Object.entries(model.ROADMAP_FIELDS)) wideProduct.roadmap[property] = ['startMonth', 'endMonth'].includes(field) ? '2026-01' : 'X';
const capacitySeed = { version: 4, categories: [
  { id: 'c'.repeat(180), board: { lanes: [{ id: 'wired' }], products: Array.from({ length: 13000 }, (_, index) => ({ ...clone(wideProduct), id: `p${index}` })) } },
  { id: 'pc-gaming-audio', board: { lanes: [{ id: 'wired' }], products: [{ id: 'cloud-iii', name: 'Cloud III', laneId: 'wired', generalAvailabilityDate: '2026-01-01', endManufacturingDate: '2029-12-31', ascm: { basePartNumbers: ['A1AAA'] } }] } },
] };
const wireLimit = 12 * 1024 * 1024 - 64 * 1024;
const wireSize = manifest => Buffer.byteLength(JSON.stringify({ snapshot: publicSnapshot({ manifest, storageRevision: 1, publication: { requestedRevision: 1, publishedRevision: 1, status: 'current' } }, 'compact-v1') }));
capacitySeed.masterSync = { customOwnerPadding: 'x'.repeat(Math.max(0, wireLimit - wireSize(capacitySeed) - 100000)) };
assert(wireSize(capacitySeed) < wireLimit);
validateManifest(capacitySeed); requireReadableManifest(capacitySeed);
const { planAscmImport } = await import('../../supabase/functions/ppc-master/ascm-plan.mjs');
const capacityDataset = await globalThis.ASCMImporter.parseAscmWorkbook(bytes);
capacityDataset.metadata.fileName = body.fileName;
const capacityPlan = planAscmImport({ manifest: capacitySeed, dataset: capacityDataset, reportDate: '2026-09-30', importedAt: now(),
  requestId, datePolicy: { version: 1, allowUpdates: true, protected: [] } });
validateManifest(capacityPlan.manifest);
assert(Buffer.byteLength(JSON.stringify({ snapshot: model.snapshot(capacityPlan.manifest) })) < wireLimit, 'bare product snapshot fits and cannot catch this regression');
assert(wireSize(capacityPlan.manifest) > wireLimit, 'public metadata crosses the real browser response limit');
db = fixture(capacitySeed);
const capacityApi = createMasterGateway({ env: { ...gatewayEnv, PPC_ASCM_DATE_POLICY: JSON.stringify({ version: 1, allowUpdates: true, protected: [] }) }, rpc: db.database, now });
assert.equal((await call(capacityApi)).data.archiveAllowed, false);
assert.equal(db.commits, 0, 'full public response growth cannot commit an unreadable master even when raw manifest fits');
console.log('ASCM cloud API checks passed: optional auth, bounded source validation, real XLSX/model transaction, preservation, immutable receipts, CAS/lost reply, publication archive gate and private response.');
