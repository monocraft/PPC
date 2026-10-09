import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
await import('../../public/js/plc-import-ui.js');

const ui = globalThis.PortfolioPlcUI;
assert.ok(ui);
for (const unsafe of ['=SUM(1,2)', '+cmd', '-cmd', '@cmd', '  =formula', '\t=HYPERLINK("bad")']) assert.ok(ui.csvCell(unsafe).startsWith('"\''), 'CSV evidence cannot become a spreadsheet formula.');
assert.equal(ui.csvCell('plain, "text"'), '"plain, ""text"""');

const source = { version: 4, categories: [{ id: 'mice', name: 'Mice', board: { products: [{ id: 'mouse-a', name: 'Synthetic mouse', ffsDate: '2026-11-01', plc: { importedAt: '2026-10-09T16:00:00.000Z', reportDate: '2026-10-08', changedAt: '2026-10-09T16:00:00.000Z', history: [{ field: 'ffsDate', before: '2026-10-01', after: '2026-11-01', sourceFile: '=untrusted.xlsx' }] } }] } }] };
const summarized = ui.sourceSummary(source, { freshness: () => ({ ageDays: 17, importAgeDays: 16, status: 'overdue' }) });
assert.equal(summarized.overdue, 1); assert.equal(summarized.last.reportDate, '2026-10-08');
const reviewLater = ui.sourceSummary({ ...source, plcImports: [{ type: 'import', at: '2026-10-09T16:00:00.000Z', reportDate: '2026-10-09' }, { type: 'review', at: '2026-10-12T16:00:00.000Z', reportDate: '2026-10-09' }] }, { freshness: () => ({}) });
assert.equal(reviewLater.last.importedAt, '2026-10-09T16:00:00.000Z', 'Reviewing an exception later does not make the original workbook newly imported.'); assert.equal(reviewLater.latestRun.type, 'review');
assert.equal(ui.historyRows(source)[0].productName, 'Synthetic mouse');
assert.ok(ui.historyCsv(source).includes('"\'=untrusted.xlsx"'));
const unassignedSource = { categories: [], plcImports: [{ sourceFile: 'Synthetic PLC.xlsx', reportDate: '2026-10-08', rows: [{ key: 'unknown-project', name: 'Synthetic unnamed product', action: 'unmatched', fields: [], observation: { stage: 'DVT', status: 'Pending sample check', forecast: '10K', health: { label: 'Yellow source indicator' }, milestones: { targetFfs: { raw: 'Jan 2027', source: { sheet: 'Synthetic PLC', cell: 'E7' } } }, data: { 'Raw source note (Q7)': 'Unmatched project evidence remains available' } } }] }] };
const observationCsv = ui.historyCsv(unassignedSource);
for (const retained of ['Pending sample check', 'Yellow source indicator', 'Jan 2027', 'Unmatched project evidence remains available', 'E7']) assert.ok(observationCsv.includes(retained), 'CSV retains complete raw evidence for an unmatched source project.');

let current = structuredClone(source), passedChoices, planOptions, afterChangeCount = 0, applyCount = 0, parseCount = 0, retryCount = 0, rejectApply = false;
const syntheticDataset = { metadata: { fileName: 'Synthetic PLC.xlsx', reportDate: '2026-01-01', fingerprint: 'synthetic-file' }, rows: [{ key: 'synthetic-row', name: 'Source mouse' }, { key: 'unknown-row', name: 'Unknown mouse' }] };
const unknownItem = { key: 'unknown-row', row: syntheticDataset.rows[1], match: { status: 'unmatched' }, matchedProductId: '', fields: [], action: 'unmatched' };
const importer = {
  async parseWorkbook(bytes, options) { parseCount++; assert.ok(bytes instanceof ArrayBuffer); if (options.fileName === 'Broken PLC.xlsx') throw new Error('Workbook integrity failed.'); assert.equal(options.fileName, 'Synthetic PLC.xlsx'); return structuredClone(syntheticDataset); },
  buildPlan(dataset, manifest, options) { planOptions = options; return { dataset, items: [{ key: 'synthetic-row', row: dataset.rows[0], match: { status: 'matched' }, matchedProductId: 'mouse-a', fields: [] }, structuredClone(unknownItem)] }; },
  buildReviewPlan(manifest, options = {}) { return { review: true, dataset: syntheticDataset, items: (manifest.plcReview?.entries || []).map((item) => ({ ...item, matchedProductId: options.selections?.[item.key] || '', match: { status: options.selections?.[item.key] ? 'matched' : 'unmatched' } })) }; },
  freshness() { return { ageDays: 1, importAgeDays: 0, status: 'current' }; },
};
const adapter = {
  getPortfolio: () => current,
  async applyPlan(plan, choices) {
    applyCount++; passedChoices = choices; if (rejectApply) throw new Error('Temporary save failed.');
    if (plan.review) { assert.equal(plan.items[0].matchedProductId, 'mouse-a'); current.plcReview.entries = []; return { portfolio: current, summary: { imported: 1 }, sharing: { status: 'saved', message: 'Saved to master.' } }; }
    assert.equal(choices.automatic, true, 'Dropping a workbook collects without a preview confirmation.');
    const duplicate = Boolean(current.plcImports?.length);
    if (!duplicate) { current = structuredClone(current); current.plcImports = [{ at: '2026-10-09T16:00:00.000Z', sourceFile: 'Synthetic PLC.xlsx', fingerprint: 'synthetic-file', reportDate: planOptions.reportDate, summary: { imported: 1, datesUpdated: 1 }, rows: [] }]; current.plcReview = { version: 1, entries: [structuredClone(unknownItem)] }; }
    return { portfolio: current, summary: { imported: duplicate ? 0 : 1, datesUpdated: duplicate ? 0 : 1, duplicate }, sharing: { status: 'pending', message: 'Saved locally. Shared master is unavailable.' } };
  },
  async retrySharing() { retryCount++; return { status: 'saved', message: 'Saved to master.' }; },
  afterChange() { afterChangeCount += 1; },
};
const controller = ui.createController({ document: null, importer, adapter });
assert.ok(controller.open({ tab: 'import' }));
assert.equal(controller.getState().tab, 'overview', 'Old import entry points open the direct drop surface.');
assert.equal(await controller.loadFile({ name: 'wrong.csv', arrayBuffer: async () => new ArrayBuffer(0) }), false);
assert.match(controller.getState().error, /\.xlsx/);
assert.equal(controller.loadFiles([{ name: 'a.xlsx' }, { name: 'b.xlsx' }]), false); assert.match(controller.getState().error, /one PLC/); assert.equal(parseCount, 0);
assert.equal(await controller.loadFile({ name: 'Synthetic PLC.xlsx', arrayBuffer: async () => new ArrayBuffer(4) }), true);
assert.match(planOptions.reportDate, /^\d{4}-\d{2}-\d{2}$/); assert.equal(planOptions.reportDateBasis, 'Import date'); assert.notEqual(planOptions.reportDate, syntheticDataset.metadata.reportDate, 'Collection uses the import day even when a workbook supplies a different report date.');
assert.equal(applyCount, 1); assert.equal(afterChangeCount, 1); assert.equal(controller.getState().dataset, null);
assert.equal(controller.getState().plan.items.length, 1, 'An unknown product remains in the persistent queue after successful dates were collected.');
assert.equal(controller.getState().result.sharing.status, 'pending'); assert.equal(await controller.retrySharing(), true); assert.equal(retryCount, 1); assert.equal(applyCount, 1, 'Sharing retry never applies dates or increments clocks again.');
assert.equal(controller.getState().result.sharing.status, 'saved');
const originalCollectedAt = current.plcImports[0].at;
assert.equal(await controller.loadFile({ name: 'Synthetic PLC.xlsx', arrayBuffer: async () => new ArrayBuffer(4) }), true); assert.equal(applyCount, 2); assert.equal(controller.getState().result.summary.duplicate, true); assert.equal(current.plcImports[0].at, originalCollectedAt);
const dataBeforeFailure = structuredClone(current);
assert.equal(await controller.loadFile({ name: 'Broken PLC.xlsx', arrayBuffer: async () => new ArrayBuffer(4) }), false); assert.equal(applyCount, 2, 'A failed parse cannot apply anything.'); assert.deepEqual(current, dataBeforeFailure); assert.equal(controller.getState().dataset, null);
controller.destroy(); assert.equal(controller.open(), false);

const reopened = ui.createController({ document: null, importer, adapter });
reopened.open({ tab: 'review' }); assert.equal(reopened.getState().plan.items[0].key, 'unknown-row', 'Review queue survives a controller reload.');
const appliedBeforeReloadRetry = applyCount; assert.equal(await reopened.retrySharing(), true); assert.equal(applyCount, appliedBeforeReloadRetry); assert.equal(reopened.getState().result.summary.datesUpdated, 1, 'Retrying sharing after reload keeps the original collection receipt.');
reopened.chooseMatch('unknown-row', 'mouse-a'); assert.equal(reopened.getState().plan.items[0].matchedProductId, 'mouse-a');
assert.equal(await reopened.apply(), true); assert.equal(passedChoices.selections['unknown-row'], 'mouse-a'); assert.equal(passedChoices.automatic, undefined); assert.equal(reopened.getState().plan.items.length, 0);
rejectApply = true; const countBeforeRetry = applyCount;
assert.equal(await reopened.loadFile({ name: 'Synthetic PLC.xlsx', arrayBuffer: async () => new ArrayBuffer(4) }), false); assert.equal(applyCount, countBeforeRetry + 1); assert.ok(reopened.getState().dataset, 'A failed collection retains the parsed workbook for an explicit retry.');
rejectApply = false; assert.equal(await reopened.apply(), true); assert.equal(applyCount, countBeforeRetry + 2); assert.equal(passedChoices.automatic, true);
reopened.destroy();

let releaseParse, busyApplyCount = 0;
const busyController = ui.createController({ document: null, importer: { ...importer, parseWorkbook: () => new Promise((resolve) => { releaseParse = () => resolve(syntheticDataset); }) }, adapter: { ...adapter, applyPlan: async () => { busyApplyCount++; return { summary: {} }; } } });
const inFlight = busyController.loadFile({ name: 'Synthetic PLC.xlsx', arrayBuffer: async () => new ArrayBuffer(4) });
await new Promise((resolve) => setTimeout(resolve, 0)); assert.equal(busyController.getState().busy, true); assert.equal(await busyController.loadFile({ name: 'Synthetic PLC.xlsx', arrayBuffer: async () => new ArrayBuffer(4) }), false); releaseParse(); assert.equal(await inFlight, true); assert.equal(busyApplyCount, 1, 'A second drop while collection is running cannot double-apply.'); busyController.destroy();

const html = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
assert.ok(html.indexOf('js/plc-import.js') < html.indexOf('js/plc-import-ui.js')); assert.ok(html.indexOf('js/plc-import-ui.js') < html.indexOf('js/app.js'));
for (const id of ['settingsPlcUpdates', 'importPlcReport', 'plcSettingsStatus']) assert.ok(html.includes(`id="${id}"`));
for (const id of ['openPlcUpdates', 'plcToolbarStatus']) assert.ok(!html.includes(`id="${id}"`), 'The biweekly importer has no main-toolbar control.');
const settingsData = html.slice(html.indexOf('id="settingsDataPanel"'), html.indexOf('id="workspaceSettingsDone"'));
for (const id of ['settingsPlcUpdates', 'importPlcReport', 'plcSettingsStatus']) assert.ok(settingsData.includes(`id="${id}"`), 'PLC controls and freshness belong to Settings → Data & export.');
console.log('PLC UI checks passed: direct collection once per drop, import-day timestamps, duplicates preserve clocks, persistent partial review, parse failure isolation, collection retry, sharing-only retry, busy guards, traceable exports, CSV formula protection, and script integration.');
