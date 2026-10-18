import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../../public/js/package-codec.js';
import { createAscmApi } from '../../supabase/functions/ppc-master/ascm-api.mjs';
import { createMasterGateway, requireReadableManifest, validateManifest, sha256 } from '../../supabase/functions/ppc-master/gateway.mjs';

const secret = 'isolated-status-import-secret-'.padEnd(48, 'x');
const now = () => '2026-10-17T12:00:00.000Z';
const seed = { version: 4, categories: [{ id: 'pc-gaming-audio', board: { lanes: [{ id: 'wired' }], products: [
  { id: 'cloud', name: 'Cloud III', laneId: 'wired', generalAvailabilityDate: '2026-01-15', endManufacturingDate: '2029-12-31', ascm: { basePartNumbers: ['A1AAA'] } },
] } }] };
function workbook() {
  const table = [['Category', 'Base PN', 'GPG 40 char AMO Description', 'GA - General Availability', 'EM - End of Manufacturing'],
    ['Headset', 'A1AAA', 'HyperX Cloud III BLK GAM HS', '2026-01-15', '2029-12-31'],
    ['Headset', 'NEW01', 'HyperX Cloud IV BLK GAM HS', '2026-07-15', '2029-12-31']];
  const rows = table.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${value}</t></is></c>`).join('')}</row>`).join('');
  const files = {
    '[Content_Types].xml': '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    'xl/workbook.xml': '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="ASCM" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
  };
  return globalThis.PortfolioPackage.createZip(Object.entries(files).map(([name, xml]) => ({ name, data: new TextEncoder().encode(xml) })));
}
const body = { sender: 'linny.chen@hp.com', subject: 'ASCM Report Accessories HyperX Release Notification October 2026',
  receivedAt: '2026-09-30T09:01:09Z', messageId: 'private-email-id', fileName: 'ASCM Report_HyperX_2026-09-30.xlsx', workbookBase64: Buffer.from(workbook()).toString('base64') };
function fixture({ statusFailure, commitFailure, beginStatus = 'started' } = {}) {
  const events = []; let manifest = structuredClone(seed), receipt = null, revision = 1;
  const state = () => ({ manifest: structuredClone(manifest), storageRevision: revision, publication: { publishedRevision: 1 }, ...(receipt ? { receipt } : {}) });
  return { events, database: async (operation, payload) => {
    events.push({ operation, payload });
    if (operation === 'rate') return { allowed: true };
    if (operation === 'read') return state();
    if (operation === 'ascm_status') {
      if (statusFailure === payload.phase) throw new Error('optional telemetry failed with private details');
      return { status: payload.phase === 'begin' ? beginStatus : payload.phase === 'end' ? 'ended' : 'updated' };
    }
    if (operation === 'commit') {
      if (commitFailure) throw new Error('native commit failed');
      revision += 1; manifest = structuredClone(payload.manifest);
      receipt = { fingerprint: payload.fingerprint, storageRevision: revision, savedFields: payload.savedFields, savedProducts: payload.savedProducts };
      return { status: 'saved' };
    }
    throw new Error('Unexpected RPC');
  } };
}
function handler(db, ...options) {
  const enabled = options.length ? options[0] : 'true';
  return createAscmApi({ env: { PPC_ASCM_IMPORT_SECRET: secret, PPC_ASCM_STATUS_ENABLED: enabled }, database: db.database,
    now, validateManifest, validateReadableManifest: requireReadableManifest });
}
async function call(handle, payload = body, suppliedSecret = secret) {
  const response = await handle(new Request('https://fixture.supabase.co/api/master/ascm', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PPC-ASCM-Secret': suppliedSecret }, body: JSON.stringify(payload) }));
  return { status: response.status, data: await response.json() };
}
const phases = db => db.events.filter(event => event.operation === 'ascm_status').map(event => event.payload.phase);

test('real parsed planning reports the exact affected product count before native commit and closes its own lease', async () => {
  const db = fixture(); const result = await call(handler(db));
  assert.equal(result.status, 202); assert.equal(result.data.archiveAllowed, false);
  assert.deepEqual(phases(db), ['begin', 'plan', 'end']);
  const activity = db.events.filter(event => event.operation === 'ascm_status');
  assert.match(activity[0].payload.leaseId, /^[a-f0-9-]{36}$/);
  assert(activity.every(event => event.payload.leaseId === activity[0].payload.leaseId));
  assert.equal(activity[1].payload.productCount, 2, 'one existing evidence update plus one real creation');
  const commitIndex = db.events.findIndex(event => event.operation === 'commit');
  assert(db.events.findIndex(event => event.operation === 'ascm_status' && event.payload.phase === 'plan') < commitIndex);
  assert.equal(db.events[commitIndex].payload.savedProducts, 2);
  assert.equal(db.events.at(-1).payload.phase, 'end');
  assert(!JSON.stringify(activity).includes(body.messageId)); assert(!JSON.stringify(activity).includes('Cloud'));
  assert.equal((await call(handler(db))).data.alreadySaved, true);
  assert.deepEqual(phases(db), ['begin', 'plan', 'end'], 'immutable receipt replays do not manufacture active product work');
});

test('status is default-off and unauthorized or ineligible requests do not start leases', async () => {
  for (const enabled of ['', 'false', 'TRUE', undefined]) {
    const db = fixture(); assert.equal((await call(handler(db, enabled))).status, 202);
    assert.deepEqual(phases(db), []);
  }
  for (const [payload, credential] of [[body, 'wrong'], [{ ...body, subject: 'Weekly review' }, secret]]) {
    const db = fixture(); await call(handler(db), payload, credential);
    assert.equal(db.events.length, 0);
  }
});

test('commit failure and malformed workbook cleanup cannot leave successful status or archive permission', async () => {
  const db = fixture({ commitFailure: true });
  const result = await call(handler(db)); assert.equal(result.status, 503); assert.equal(result.data.archiveAllowed, false);
  assert.deepEqual(phases(db), ['begin', 'plan', 'end']);
  const malformed = fixture(); const rejected = await call(handler(malformed), { ...body, workbookBase64: Buffer.from('not-xlsx').toString('base64') });
  assert.equal(rejected.status, 400); assert.equal(rejected.data.archiveAllowed, false);
  assert.deepEqual(phases(malformed), ['begin', 'end']);
  assert.equal(malformed.events.some(event => event.operation === 'commit'), false);
});

test('optional status failure never changes accepted receipt behavior and failed begin has no cleanup call', async () => {
  for (const statusFailure of ['begin', 'plan', 'end']) {
    const db = fixture({ statusFailure }); const result = await call(handler(db));
    assert.equal(result.status, 202); assert.equal(result.data.archiveAllowed, false);
    assert.deepEqual(phases(db), statusFailure === 'begin' ? ['begin'] : ['begin', 'plan', 'end']);
  }
  const disabled = fixture({ beginStatus: 'disabled' }); assert.equal((await call(handler(disabled))).status, 202);
  assert.deepEqual(phases(disabled), ['begin'], 'private disabled policy starts no lease and requires no followup writes');
});

test('presence status piggybacks the existing RPC while the gateway ignores all browser status claims', async () => {
  const key = globalThis.PortfolioPackage.generateKey();
  const common = { PPC_PACKAGE_KEY_HASH: await sha256(key), PPC_PUBLISHER_SECRET: secret };
  for (const enabled of [false, true]) {
    const calls = [];
    const gateway = createMasterGateway({ env: { ...common, PPC_ASCM_STATUS_ENABLED: enabled ? 'true' : '' }, now,
      rpc: async (operation, payload) => {
        calls.push({ operation, payload });
        if (operation === 'rate') return { allowed: true };
        if (operation === 'read') return { manifest: seed, storageRevision: 1 };
        assert.equal(operation, 'presence');
        return { sessions: [{ sessionId: 'real-user-session', displayName: 'Real user' }], onlineCount: 1,
          ascmSupervisor: { enabled: true, working: true, productCount: 2, expiresAt: '2026-10-17T12:02:00.000Z' } };
      } });
    const request = payload => new Request('https://fixture.supabase.co/api/master/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const response = await gateway(request({ key, sessionId: 'real-user-session' }));
    assert.equal(response.status, 200); const result = await response.json();
    assert.deepEqual(calls.map(call => call.operation), ['rate', 'rate', 'read', 'presence']);
    const payload = calls.at(-1).payload;
    assert.equal(payload.includeAscmSupervisor, enabled ? true : undefined);
    assert.equal(payload.ascmSupervisor, undefined); assert.equal(payload.productCount, undefined);
    assert.equal(result.onlineCount, 1); assert.equal(result.sessions.length, 1);
    assert.equal(result.ascmSupervisor?.productCount, enabled ? 2 : undefined);
    const before = calls.length;
    const spoofed = await gateway(request({ key, sessionId: 'real-user-session', includeAscmSupervisor: true,
      ascmSupervisor: { enabled: true, working: true, productCount: 9999 }, productCount: 9999 }));
    assert.equal(spoofed.status, 400);
    assert.deepEqual(calls.slice(before).map(call => call.operation), ['rate'], 'spoofed status fields never reach presence or any status RPC');
  }
});

test('presence drops malformed oversized or stale lease data and exposes only the four allowed activity fields', async () => {
  const key = globalThis.PortfolioPackage.generateKey();
  const base = { enabled: true, working: true, productCount: 2, expiresAt: '2026-10-17T12:02:00.000Z', reconnectRequired: [] };
  for (const [value, expected] of [
    [{ ...base, productCount: 501 }, undefined], [{ ...base, productCount: -1 }, undefined],
    [{ ...base, expiresAt: '2026-10-17T12:02:00+00:00' }, undefined],
    [{ ...base, expiresAt: '2026-10-18T12:02:00.000Z' }, undefined],
    [{ ...base, working: false }, undefined],
    [{ ...base, expiresAt: '2026-10-17T11:59:59.000Z' }, { enabled: true, working: false, productCount: null, expiresAt: null, reconnectRequired: [] }],
    [{ ...base, privateMail: 'must not escape' }, base],
  ]) {
    const gateway = createMasterGateway({ env: { PPC_PACKAGE_KEY_HASH: await sha256(key), PPC_PUBLISHER_SECRET: secret, PPC_ASCM_STATUS_ENABLED: 'true' }, now,
      rpc: async operation => operation === 'rate' ? { allowed: true } : operation === 'read' ? { manifest: seed, storageRevision: 1 }
        : { sessions: [], onlineCount: 0, ascmSupervisor: value } });
    const response = await gateway(new Request('https://fixture.supabase.co/api/master/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, sessionId: 'status-test-session' }) }));
    assert.equal(response.status, 200); const result = await response.json();
    assert.deepEqual(result.ascmSupervisor, expected); assert.equal(result.onlineCount, 0);
    assert.equal(JSON.stringify(result).includes('must not escape'), false);
  }
});
