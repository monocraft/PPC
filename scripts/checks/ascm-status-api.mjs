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
function workbook(whitespace = '') {
  const table = [['Category', 'Base PN', 'GPG 40 char AMO Description', 'GA - General Availability', 'EM - End of Manufacturing'],
    ['Headset', 'A1AAA', 'HyperX Cloud III BLK GAM HS', '2026-01-15', '2029-12-31'],
    ['Headset', 'NEW01', 'HyperX Cloud IV BLK GAM HS', '2026-07-15', '2029-12-31']];
  const rows = table.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${value}</t></is></c>`).join('')}</row>`).join('');
  const files = {
    '[Content_Types].xml': '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    'xl/workbook.xml': '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="ASCM" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet>${whitespace}<sheetData>${rows}</sheetData></worksheet>`,
  };
  return globalThis.PortfolioPackage.createZip(Object.entries(files).map(([name, xml]) => ({ name, data: new TextEncoder().encode(xml) })));
}
const body = { sender: 'linny.chen@hp.com', subject: 'ASCM Report Accessories HyperX Release Notification October 2026',
  receivedAt: '2026-09-30T09:01:09Z', messageId: 'private-email-id', fileName: 'ASCM Report_HyperX_2026-09-30.xlsx', workbookBase64: Buffer.from(workbook()).toString('base64') };
function fixture({ statusFailure, commitFailure, beginStatus = 'started', initialManifest = seed } = {}) {
  const events = [], receipts = new Map(); let manifest = structuredClone(initialManifest), revision = 1;
  const state = (requestId) => ({ manifest: structuredClone(manifest), storageRevision: revision, publication: { publishedRevision: 1 },
    ...(receipts.has(requestId) ? { receipt: structuredClone(receipts.get(requestId)) } : {}) });
  return { events, state, database: async (operation, payload) => {
    events.push({ operation, payload });
    if (operation === 'rate') return { allowed: true };
    if (operation === 'read') return state(payload.requestId);
    if (operation === 'ascm_status') {
      if (statusFailure === payload.phase) throw new Error('optional telemetry failed with private details');
      return { status: payload.phase === 'begin' ? beginStatus : payload.phase === 'end' ? 'ended' : 'updated' };
    }
    if (operation === 'commit') {
      if (commitFailure) throw new Error('native commit failed');
      revision += 1; manifest = structuredClone(payload.manifest);
      receipts.set(payload.requestId, { fingerprint: payload.fingerprint, storageRevision: revision, savedFields: payload.savedFields, savedProducts: payload.savedProducts });
      return { status: 'saved' };
    }
    throw new Error('Unexpected RPC');
  } };
}
function handler(db, ...options) {
  const enabled = options.length ? options[0] : 'true';
  return createAscmApi({ env: { PPC_ASCM_IMPORT_SECRET: secret, PPC_ASCM_STATUS_ENABLED: enabled }, database: db.database,
    now: options[1] || now, validateManifest, validateReadableManifest: requireReadableManifest });
}
async function call(handle, payload = body, suppliedSecret = secret) {
  const response = await handle(new Request('https://fixture.supabase.co/api/master/ascm', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PPC-ASCM-Secret': suppliedSecret }, body: JSON.stringify(payload) }));
  return { status: response.status, data: await response.json() };
}
const phases = db => db.events.filter(event => event.operation === 'ascm_status').map(event => event.payload.phase);
const acceptedAt = '2026-10-16T12:00:00.000Z';
const withAcceptedAt = value => ({ ...structuredClone(seed), ascmSnapshot: { importedAt: value } });
const idle = { enabled: true, working: false, productCount: null, expiresAt: null, reconnectRequired: [] };
const working = { enabled: true, working: true, productCount: 2, expiresAt: '2026-10-17T12:02:00.000Z', reconnectRequired: [] };
async function presenceFixture(options = {}) {
  const { manifest = seed, enabled = true, clock = now } = options;
  const supervisor = Object.hasOwn(options, 'supervisor') ? options.supervisor : idle;
  const key = globalThis.PortfolioPackage.generateKey(), calls = [];
  const gateway = createMasterGateway({ env: { PPC_PACKAGE_KEY_HASH: await sha256(key), PPC_PUBLISHER_SECRET: secret,
    PPC_ASCM_STATUS_ENABLED: enabled ? 'true' : '' }, now: clock,
    rpc: async (operation, payload) => {
      calls.push({ operation, payload });
      if (operation === 'rate') return { allowed: true };
      if (operation === 'read') return { manifest, storageRevision: 1 };
      assert.equal(operation, 'presence');
      return { sessions: [{ sessionId: 'real-user-session', displayName: 'Real user' }], onlineCount: 1, ascmSupervisor: supervisor };
    } });
  return { calls, request: async (extra = {}) => {
    const response = await gateway(new Request('https://fixture.supabase.co/api/master/presence', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, sessionId: 'real-user-session', ...extra }) }));
    return { status: response.status, data: await response.json() };
  } };
}
async function sampleAcceptedTime(db, expected, clock = now) {
  const fixture = await presenceFixture({ manifest: db.state().manifest, clock });
  const result = await fixture.request();
  assert.equal(result.status, 200);
  assert.equal(result.data.ascmSupervisor.lastUpdatedAt, expected);
  assert.deepEqual(fixture.calls.map(call => call.operation), ['rate', 'rate', 'read', 'presence']);
}

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

test('optional begin plan or end failure preserves actual commit outcomes and accepted update times', async () => {
  for (const statusFailure of ['begin', 'plan', 'end']) {
    for (const commitFailure of [false, true]) {
      const db = fixture({ statusFailure, commitFailure, initialManifest: withAcceptedAt(acceptedAt) });
      const result = await call(handler(db));
      assert.equal(result.status, commitFailure ? 503 : 202, `${statusFailure}, commitFailure=${commitFailure}`);
      assert.equal(result.data.archiveAllowed, false);
      assert.deepEqual(phases(db), statusFailure === 'begin' ? ['begin'] : ['begin', 'plan', 'end']);
      const expected = commitFailure ? acceptedAt : '2026-10-17T12:00:00.000Z';
      assert.equal(db.state().manifest.ascmSnapshot.importedAt, expected);
      await sampleAcceptedTime(db, expected);
    }
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
        if (operation === 'read') return { manifest: withAcceptedAt(acceptedAt), storageRevision: 1 };
        assert.equal(operation, 'presence');
        return { sessions: [{ sessionId: 'real-user-session', displayName: 'Real user' }], onlineCount: 1,
          ascmSupervisor: { ...working, lastUpdatedAt: '2026-10-17T11:59:00.000Z', privateMail: 'must not escape' } };
      } });
    const request = payload => new Request('https://fixture.supabase.co/api/master/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const response = await gateway(request({ key, sessionId: 'real-user-session' }));
    assert.equal(response.status, 200); const result = await response.json();
    assert.deepEqual(calls.map(call => call.operation), ['rate', 'rate', 'read', 'presence']);
    const payload = calls.at(-1).payload;
    assert.equal(payload.includeAscmSupervisor, enabled ? true : undefined);
    assert.equal(payload.ascmSupervisor, undefined); assert.equal(payload.productCount, undefined);
    assert.equal(result.onlineCount, 1); assert.equal(result.sessions.length, 1);
    assert.equal(result.sessions[0].sessionId, 'real-user-session'); assert.equal(result.sessions[0].displayName, 'Real user');
    assert.deepEqual(result.ascmSupervisor, enabled ? { ...working, lastUpdatedAt: acceptedAt } : undefined);
    assert.equal(JSON.stringify(result).includes('must not escape'), false);
    for (const claim of [
      { includeAscmSupervisor: true, ascmSupervisor: { enabled: true, working: true, productCount: 9999 }, productCount: 9999 },
      { lastUpdatedAt: '2026-10-17T11:59:00.000Z' },
    ]) {
      const before = calls.length;
      const spoofed = await gateway(request({ key, sessionId: 'real-user-session', ...claim }));
      assert.equal(spoofed.status, 400);
      assert.deepEqual(calls.slice(before).map(call => call.operation), ['rate'], 'spoofed status fields never reach presence or any status RPC');
    }
  }
});

test('presence admits only canonical nonfuture accepted timestamps without changing valid activity', async () => {
  for (const [input, expected] of [
    ['2026-10-16T12:00:00Z', acceptedAt], [acceptedAt, acceptedAt], ['2026-10-17T12:00:00.000Z', '2026-10-17T12:00:00.000Z'],
    [undefined, undefined], [null, undefined], [false, undefined], [0, undefined], [{}, undefined], [[], undefined],
    ['', undefined], [' 2026-10-16T12:00:00Z', undefined], ['2026-02-30T12:00:00.000Z', undefined],
    ['2026-10-16T12:00:00+00:00', undefined], ['2026-10-16T12:00:00.00Z', undefined],
    ['2026-10-16T12:00:00.0000Z', undefined], ['2026-10-17T12:00:00.001Z', undefined],
  ]) {
    for (const [supervisor, expectedActivity] of [[idle, idle], [working, working],
      [{ ...working, expiresAt: '2026-10-17T11:59:59.000Z' }, idle]]) {
      const activity = { ...supervisor, reconnectRequired: ['sharepoint'] };
      const fixture = await presenceFixture({ manifest: withAcceptedAt(input), supervisor: activity });
      const result = await fixture.request();
      assert.equal(result.status, 200);
      assert.deepEqual(result.data.ascmSupervisor, { ...expectedActivity, reconnectRequired: ['sharepoint'],
        ...(expected === undefined ? {} : { lastUpdatedAt: expected }) });
      assert.equal(Object.hasOwn(result.data.ascmSupervisor, 'lastUpdatedAt'), expected !== undefined);
      assert.deepEqual(fixture.calls.map(call => call.operation), ['rate', 'rate', 'read', 'presence']);
    }
  }
  const invalidClock = await presenceFixture({ manifest: withAcceptedAt(acceptedAt), clock: () => 'invalid clock' });
  assert.deepEqual((await invalidClock.request()).data.ascmSupervisor, idle, 'an invalid clock cannot admit an accepted timestamp');
});

test('presence requires object-valued accepted metadata and never substitutes RPC timestamps or enables invalid status', async () => {
  const arraySnapshot = []; arraySnapshot.importedAt = acceptedAt;
  for (const snapshot of [undefined, null, [], arraySnapshot, acceptedAt]) {
    const fixture = await presenceFixture({ manifest: { ...seed, ascmSnapshot: snapshot }, supervisor: { ...idle, lastUpdatedAt: acceptedAt } });
    assert.deepEqual((await fixture.request()).data.ascmSupervisor, idle);
  }
  for (const supervisor of [undefined, null, [], {}, { ...idle, enabled: false }, { ...working, productCount: 501 },
    { ...working, expiresAt: '2026-10-18T12:00:00.000Z' }]) {
    const fixture = await presenceFixture({ manifest: withAcceptedAt(acceptedAt), supervisor });
    assert.equal(Object.hasOwn((await fixture.request()).data, 'ascmSupervisor'), false);
  }
  const disabled = await presenceFixture({ manifest: withAcceptedAt(acceptedAt), supervisor: { ...idle, lastUpdatedAt: acceptedAt }, enabled: false });
  assert.equal(Object.hasOwn((await disabled.request()).data, 'ascmSupervisor'), false);
});

test('new workbook evidence with unchanged business rows advances accepted time while receipt replay and rejection do not', async () => {
  const db = fixture(), firstTime = () => acceptedAt;
  const first = await call(handler(db, 'true', firstTime));
  assert.equal(first.status, 202);
  assert.equal(db.state().manifest.ascmSnapshot.importedAt, acceptedAt);
  const businessRows = () => globalThis.PortfolioMasterModel.snapshot(db.state().manifest).products.map(({ productId, values }) => ({ productId, values }));
  const before = businessRows();
  const metadataOnly = { ...body, workbookBase64: Buffer.from(workbook('\n  ')).toString('base64') };
  assert.notEqual(metadataOnly.workbookBase64, body.workbookBase64, 'different eligible bytes derive a new digest and request identity');
  const second = await call(handler(db), metadataOnly);
  assert.equal(second.status, 202); assert.equal(second.data.alreadySaved, false);
  assert.notEqual(second.data.requestId, first.data.requestId);
  assert.equal(second.data.summary.savedFields, 0, 'source evidence can be accepted without business-field changes');
  assert.deepEqual(businessRows(), before);
  assert.equal(db.state().manifest.ascmSnapshot.importedAt, '2026-10-17T12:00:00.000Z');
  await sampleAcceptedTime(db, '2026-10-17T12:00:00.000Z');
  const acceptedManifest = db.state().manifest;
  const commits = db.events.filter(event => event.operation === 'commit').length;
  const later = () => '2026-10-18T12:00:00.000Z';
  for (const [payload, receipt] of [[metadataOnly, second.data], [body, first.data]]) {
    const replay = await call(handler(db, 'true', later), payload);
    assert.equal(replay.status, 202); assert.equal(replay.data.alreadySaved, true);
    assert.equal(replay.data.storageRevision, receipt.storageRevision, 'replay keeps its immutable receipt revision');
    assert.deepEqual(replay.data.summary, receipt.summary);
    assert.deepEqual(db.state().manifest, acceptedManifest);
    await sampleAcceptedTime(db, '2026-10-17T12:00:00.000Z', later);
  }
  assert.equal(db.events.filter(event => event.operation === 'commit').length, commits);
  const rejected = await call(handler(db, 'true', later), { ...body, workbookBase64: Buffer.from('not-xlsx').toString('base64') });
  assert.equal(rejected.status, 400); assert.equal(rejected.data.archiveAllowed, false);
  assert.deepEqual(db.state().manifest, acceptedManifest);
  assert.equal(db.events.filter(event => event.operation === 'commit').length, commits);
  await sampleAcceptedTime(db, '2026-10-17T12:00:00.000Z', later);
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
