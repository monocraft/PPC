import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../../public/js/package-codec.js';
import { createMasterGateway } from '../../supabase/functions/ppc-master/gateway.mjs';
import { AscmReviewError } from '../../supabase/functions/ppc-master/ascm-plan.mjs';

const sentinel = 'SENTINEL_PRIVATE_CREDENTIAL_AND_MANIFEST';
const origin = 'https://syntheticproject.supabase.co';
const sourceSecret = `source-${sentinel}`;
const env = { SUPABASE_URL: origin, SUPABASE_SECRET_KEYS: JSON.stringify({ default: `sb_secret_${sentinel}` }),
  PPC_PACKAGE_KEY_HASH: 'a'.repeat(64), PPC_PUBLISHER_SECRET: `publisher-${sentinel}`,
  PPC_ASCM_IMPORT_SECRET: sourceSecret, PPC_ASCM_DATE_POLICY: JSON.stringify({ version: 1, allowUpdates: true, protected: [] }) };
const seed = { version: 4, categories: [{ id: 'pc-gaming-audio', board: { lanes: [{ id: 'wired' }], products: [
  { id: 'cloud-iii', name: 'Cloud III', laneId: 'wired', generalAvailabilityDate: '2026-01-15', endManufacturingDate: '2029-12-31',
    ascm: { basePartNumbers: ['A1AAA'] }, partSkus: [], variantGroups: [] },
] } }] };

async function sourceBody() {
  const table = [['Exported', '2026-09-30T03:53:45'],
    ['Category', 'Base PN', 'GPG 40 char AMO Description', 'GA - General Availability', 'EM - End of Manufacturing', 'Local (Y/N)', 'Local Code', 'Feature ID', 'Code Name'],
    ['Headset', 'A1AAA', 'HyperX Cloud III BLK GAM HS', '2026-01-15', '2029-12-31', 'N', '', 'F1', 'Cloud III']];
  const rows = table.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${v}</t></is></c>`).join('')}</row>`).join('');
  const files = { '[Content_Types].xml': '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    'xl/workbook.xml': '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="ASCM" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>` };
  const bytes = await globalThis.PortfolioPackage.createZip(Object.entries(files).map(([name, xml]) => ({ name, data: new TextEncoder().encode(xml) })));
  const source = { provider: 'sharepoint', hostname: 'hp.sharepoint.com', sitePath: '/teams/IPSG_SCM_and_Product_Requirements_Info',
    driveId: 'b!Dxcy8q8LE0GivbyM3D6Dq5C5iXHjfxBMsvQrwTpLknS0JFIuvvhlQoilkLMqZkl9', listId: '2e5224b4-f8be-4265-88a5-90b32a66497d',
    listItemId: 908, itemUniqueId: 'e5cb1d81-7071-40b6-93cb-86ef0b577f52', fileName: 'ASCM Report_HyperX_2026-09-30.xlsx',
    relativePath: '(09) September 2026/ASCM Report_HyperX_2026-09-30.xlsx', versionLabel: '2.0', eTag: '"synthetic-2"',
    createdAt: '2026-09-30T09:00:46Z', lastModifiedAt: '2026-10-07T07:44:51Z', bytes: bytes.length };
  const observation = Object.fromEntries(['listItemId', 'itemUniqueId', 'versionLabel', 'eTag', 'bytes'].map(key => [key, source[key]]));
  return { schemaVersion: 1, source, before: observation, after: observation, workbookBase64: Buffer.from(bytes).toString('base64') };
}
const body = await sourceBody();

async function exercise(readBehavior, { commit = false, rateFailure = false, logSinkError = null } = {}) {
  const logs = [], calls = [], original = console.error;
  console.error = (...values) => { logs.push(values); if (logSinkError) throw logSinkError; };
  try {
    const gateway = createMasterGateway({ env, now: () => '2026-10-19T05:07:00.000Z',
      fetchImpl: async (url, options) => {
        const operation = url.split('/').at(-1).slice('ppc_master_'.length);
        calls.push(operation);
        assert.equal(options.headers.apikey, `sb_secret_${sentinel}`);
        if (operation === 'rate') return rateFailure ? readBehavior() : Response.json({ allowed: true });
        if (operation === 'ascm_sharepoint_read') return commit && calls.filter(x => x === operation).length > 1
          ? Response.json({ manifest: seed, storageRevision: 2 }) : commit ? Response.json({ manifest: seed, storageRevision: 1 }) : readBehavior();
        if (operation === 'ascm_sharepoint_commit') return readBehavior();
        assert.fail('Unexpected RPC operation');
      } });
    const response = await gateway(new Request(`${origin}/functions/v1/ppc-master/api/master/ascmsharepoint`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ppc-ascm-secret': sourceSecret }, body: JSON.stringify(body),
    }));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'ASCM_UNAVAILABLE');
    return { logs, calls };
  } finally { console.error = original; }
}
function diagnostic(result, expected) {
  assert.equal(result.logs.length, 1, 'one fixed failure record for one source RPC failure');
  assert.equal(result.logs[0].length, 1, 'one structured log argument only');
  const raw = result.logs[0][0];
  assert.equal(typeof raw, 'string');
  assert.equal(raw.includes(sentinel), false, 'no credential, backend body, or exception text');
  const event = JSON.parse(raw);
  assert.deepEqual(Object.keys(event).sort(), ['elapsedBucket', 'event', 'failureClass', 'operation', 'status'].sort());
  assert.equal(event.event, 'PPC_ASCM_SOURCE_RPC_FAILURE');
  assert.deepEqual({ operation: event.operation, failureClass: event.failureClass, status: event.status }, expected);
  assert.ok(['under_1s', '1_to_5s', '5_to_15s', 'over_15s'].includes(event.elapsedBucket));
}

test('source read HTTP 413/500 and source commit HTTP 500 log only fixed operation/class/status', async () => {
  for (const status of [413, 500]) diagnostic(await exercise(() => Response.json({ private: sentinel }, { status })),
    { operation: 'ascm_sharepoint_read', failureClass: 'HTTP', status });
  diagnostic(await exercise(() => Response.json({ private: sentinel }, { status: 500 }), { commit: true }),
    { operation: 'ascm_sharepoint_commit', failureClass: 'HTTP', status: 500 });
});

test('source timeout, invalid JSON, and transport exceptions retain safe classes', async () => {
  diagnostic(await exercise(() => { const error = new Error(sentinel); error.name = 'TimeoutError'; throw error; }),
    { operation: 'ascm_sharepoint_read', failureClass: 'TIMEOUT', status: 0 });
  diagnostic(await exercise(() => new Response(new ReadableStream({
    start(controller) { const error = new Error(sentinel); error.name = 'AbortError'; controller.error(error); },
  }))), { operation: 'ascm_sharepoint_read', failureClass: 'TIMEOUT', status: 200 });
  diagnostic(await exercise(() => new Response(`{${sentinel}`)),
    { operation: 'ascm_sharepoint_read', failureClass: 'INVALID_RESPONSE', status: 200 });
  diagnostic(await exercise(() => { throw new Error(sentinel); }),
    { operation: 'ascm_sharepoint_read', failureClass: 'TRANSPORT', status: 0 });
});

test('rate failures and successful source read with rejected state do not log source RPC failure', async () => {
  assert.equal((await exercise(() => Response.json({ private: sentinel }, { status: 500 }), { rateFailure: true })).logs.length, 0);
  assert.equal((await exercise(() => Response.json({ manifest: null, storageRevision: 1 }))).logs.length, 0);
});

test('a throwing log sink cannot replace the original source RPC unavailable result', async () => {
  const result = await exercise(() => Response.json({ private: sentinel }, { status: 503 }), {
    logSinkError: new AscmReviewError('MALFORMED_REPORT', sentinel),
  });
  assert.deepEqual(result.calls, ['rate', 'ascm_sharepoint_read']);
  assert.equal(result.logs.length, 1);
});
