import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
await import('../../public/js/plc-import-ui.js');

const ui = globalThis.PortfolioPlcUI;
assert.ok(ui);
const manyRows = Array.from({ length: 203 }, (_, index) => ({ id: index, searchText: `Synthetic ${index % 2 ? 'mouse' : 'keyboard'} ${index} Project ${index}`, categoryId: index % 2 ? 'mice' : 'keyboards', statuses: [index % 4 ? 'has-ffs' : 'missing-ffs'] }));
const firstPage = ui.browseRows(manyRows);
assert.equal(firstPage.total, 203); assert.equal(firstPage.rows.length, 15); assert.equal(firstPage.pages, 14); assert.equal(firstPage.start, 1); assert.equal(firstPage.end, 15);
const lastPage = ui.browseRows(manyRows, { page: 99 });
assert.equal(lastPage.page, 13); assert.equal(lastPage.rows.length, 8); assert.equal(lastPage.start, 196); assert.equal(lastPage.end, 203);
assert.deepEqual(ui.browseRows(manyRows, { query: 'MOUSE project 101', category: 'mice' }).rows.map(row => row.id), [101], 'Search matches every word across product identity, independent of case.');
assert.equal(ui.browseRows(manyRows, { category: 'keyboards', status: 'missing-ffs' }).total, 51, 'Category and FFS filters apply together before paging.');
const noMatches = ui.browseRows(manyRows, { query: 'unknown project', page: 5 });
assert.equal(noMatches.total, 0); assert.equal(noMatches.page, 0); assert.equal(noMatches.start, 0); assert.equal(noMatches.end, 0); assert.equal(noMatches.pages, 1);
assert.equal(ui.browseRows([{ searchText: 'Café project', statuses: [] }], { query: 'cafe' }).total, 1, 'Search tolerates accents.');
assert.equal(ui.browseRows(manyRows, { pageSize: 500 }).rows.length, 50, 'Bounded page size prevents rendering a full portfolio.');
assert.equal(ui.browseRows(manyRows, { page: NaN, pageSize: Infinity }).rows.length, 15);
assert.equal(manyRows.length, 203, 'Browsing never mutates source records or hides retained export data.');
const matchPortfolio = Array.from({ length: 220 }, (_, index) => ({ product: { id: `product-${index}`, name: `Synthetic product ${index}`, codename: index === 101 ? 'Café Zephyr' : `Code ${index}` }, categoryId: index % 2 ? 'mice' : 'keyboards', categoryName: index % 2 ? 'Mice' : 'Keyboards' }));
const matchingItem = { match: { candidates: [{ productId: 'product-101', score: 98, reason: 'Exact codename' }, { productId: 'product-7', score: 70, reason: 'Similar name' }] } };
assert.deepEqual(ui.matchingProducts(matchPortfolio, matchingItem).map(entry => entry.product.id), ['product-101', 'product-7'], 'An empty match search shows only ranked source suggestions, not a 220-product dropdown.');
assert.equal(ui.matchingProducts(matchPortfolio, matchingItem, 'cafe MICE').at(0).product.id, 'product-101', 'The match picker searches codename and category with accent-insensitive all-word matching.');
assert.equal(ui.matchingProducts(matchPortfolio, matchingItem, 'synthetic').length, 8, 'Match search results are bounded even for a large portfolio.');
assert.equal(ui.matchingProducts(matchPortfolio, matchingItem, 'missing-product').length, 0);
const regionalField = { field: 'ffsDate', status: 'review', kind: 'regional', reason: 'Regional dates differ', raw: '7/20/2026 CN, 8/28/2026 VN', source: { sheet: 'Synthetic PLC', cell: 'H7' }, candidates: [{ kind: 'exact', value: '2026-07-20', region: 'CN' }, { kind: 'exact', value: '2026-08-28', region: 'VN' }, { kind: 'missing-year', value: '', region: 'TH' }] };
const regionalChoices = ui.dateSuggestions(regionalField);
assert.equal(regionalChoices.length, 2); assert.ok(regionalChoices.every(choice => !choice.clear && !choice.blocked), 'Different region/date choices require individual selection.');
assert.equal(regionalChoices[0].source.cell, 'H7'); assert.equal(regionalChoices[0].region, 'CN');
assert.ok(ui.dateSuggestions({ ...regionalField, status: 'stale' }).every(choice => choice.blocked && !choice.clear));
assert.ok(ui.dateSuggestions({ ...regionalField, reason: 'The master has an accepted date change on or after this source report' }).every(choice => choice.blocked), 'Protected newer master dates cannot be selected by source suggestion.');
assert.ok(ui.dateSuggestions(regionalField, { cancelled: true }).every(choice => choice.blocked));
assert.equal(ui.dateSuggestions({ field: 'ffsDate', status: 'update', kind: 'exact', incoming: '2026-11-02', reason: '' }).at(0).clear, true, 'One unambiguous exact source date can be selected in an explicit batch action.');
assert.equal(ui.dateSuggestions({ field: 'ffsDate', status: 'review', kind: 'quarter', incoming: '2028-04-01', period: { label: 'Q2 2028' }, reason: 'PPC has an exact day; confirm before replacing it with quarter precision' }).at(0).clear, false, 'Quarter precision cannot enter a clear-suggestion batch when it would replace an existing exact date.');
for (const unsafe of ['=SUM(1,2)', '+cmd', '-cmd', '@cmd', '  =formula', '\t=HYPERLINK("bad")']) assert.ok(ui.csvCell(unsafe).startsWith('"\''), 'CSV evidence cannot become a spreadsheet formula.');
assert.equal(ui.csvCell('plain, "text"'), '"plain, ""text"""');
assert.equal(ui.csvCell({ precision: 'quarter', label: 'Q2 2028', start: '2028-04-01' }), '"{""precision"":""quarter"",""label"":""Q2 2028"",""start"":""2028-04-01""}"', 'CSV preserves structured precision facts instead of an object placeholder.');

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
await import('../../public/js/plc-import.js');
const realImporter = globalThis.PLCImporter, periodDate = realImporter.parseDate('Q2 2028', { quarterBasis: 'calendar' });
let creationPortfolio = { version: 4, categories: [{ id: 'mice', name: 'Mice', board: { lanes: [{ id: 'planning', name: 'Planning' }], products: [] } }], plcReview: { version: 1, entries: [{ key: 'source-zephyr', row: { key: 'source-zephyr', name: 'Zephyr', codename: 'Zephyr', section: 'Mice', dates: { ffsDate: periodDate, generalAvailabilityDate: { kind: 'exact', value: '2028-08-01', raw: '8/1/2028' } }, sources: [{ sheet: 'Synthetic PLC', cell: 'D7' }] }, matchNeeded: true, fields: ['ffsDate', 'generalAvailabilityDate'], reportDate: '2026-10-09', metadata: { fileName: 'Synthetic PLC.xlsx', fingerprint: 'create-source', reportDate: '2026-10-09' } }] } };
let creationCalls = 0, creationChoices;
const creationController = ui.createController({ document: null, importer: realImporter, adapter: { getPortfolio: () => creationPortfolio, async applyPlan(plan, selected) { creationCalls++; creationChoices = selected; const result = realImporter.applyPlan(creationPortfolio, plan, { ...selected, now: '2026-10-10T12:00:00.000Z' }); creationPortfolio = result.portfolio; return result; } } });
creationController.open({ tab: 'review' });
assert.equal(creationController.confirmCreate('source-zephyr', { name: 'Zephyr', codename: 'Zephyr', categoryId: 'missing' }), false, 'A new source product requires a real confirmed category.');
assert.equal(creationCalls, 0); assert.equal(creationPortfolio.categories[0].board.products.length, 0);
assert.equal(creationController.confirmCreate('source-zephyr', { name: 'Zephyr', codename: 'Zephyr', categoryId: 'mice' }), true, 'A codename-only product can be selected explicitly for creation.');
assert.equal(creationPortfolio.categories[0].board.products.length, 0, 'Selecting creation does not mutate the portfolio before batch confirmation.');
const quarterField = creationController.getState().plan.items[0].fields.find(field => field.field === 'ffsDate'), quarterChoice = ui.dateSuggestions(quarterField)[0];
assert.equal(quarterChoice.label, 'Q2 2028'); assert.ok(quarterChoice.period);
assert.equal(creationController.selectSuggestion('source-zephyr', 'ffsDate', quarterChoice), true);
creationController.open({ tab: 'dates' }); creationController.open({ tab: 'review' });
assert.equal(creationController.getState().resolutions['source-zephyr'].ffsDate.period.label, 'Q2 2028', 'Quarter selection and creation stay intact across view changes.');
assert.equal(creationCalls, 0, 'No dates or products save before explicit batch confirmation.');
assert.equal(await creationController.apply(), true); assert.equal(creationCalls, 1);
assert.deepEqual(creationChoices.deferredFields['source-zephyr'], ['generalAvailabilityDate'], 'Untouched exact source suggestions defer instead of applying or being dismissed.');
const createdProduct = creationPortfolio.categories[0].board.products[0];
assert.equal(createdProduct.name, 'Zephyr'); assert.equal(createdProduct.codename, 'Zephyr'); assert.equal(createdProduct.ffsDate, '2028-04-01'); assert.equal(realImporter.getFieldAge(createdProduct, 'ffsDate').displayValue, 'Q2 2028');
assert.equal(createdProduct.generalAvailabilityDate, '', 'Batch confirmation changes only selected dates on the new product.');
assert.ok(creationPortfolio.plcReview.entries[0].fields.includes('generalAvailabilityDate'), 'An unselected source date stays reviewable after creation.');
assert.ok(ui.historyCsv(creationPortfolio).includes('Q2 2028'), 'CSV history retains quarter labels and precision metadata.');
creationController.open({ tab: 'review' }); creationController.keepDate('source-zephyr', 'generalAvailabilityDate');
assert.equal(await creationController.apply(), true); assert.equal(createdProduct.generalAvailabilityDate, ''); assert.equal(creationPortfolio.plcReview.entries.length, 0, 'Explicit Keep current date resolves that observation without changing PPC.');
creationController.destroy();
const uiSource = await readFile(new URL('../../public/js/plc-import-ui.js', import.meta.url), 'utf8'), uiStyle = await readFile(new URL('../../public/css/plc-import.css', import.meta.url), 'utf8');
assert.ok(!uiSource.includes('Match ${row.name || row.codename || "project"} to portfolio product'), 'The full product dropdown was replaced by a bounded searchable card picker.');
assert.ok(uiSource.includes('tools.open = Boolean(state.matchOpen[item.key])') && uiSource.includes('"Change match"'), 'Already matched products keep their searchable picker collapsed, with disclosure state retained through typing and rerender.');
assert.ok(uiStyle.includes('background: var(--color-surface)') && uiStyle.includes('color: var(--color-text)'), 'PLC surfaces follow the workspace theme tokens.');
assert.ok(html.indexOf('js/plc-import.js') < html.indexOf('js/plc-import-ui.js')); assert.ok(html.indexOf('js/plc-import-ui.js') < html.indexOf('js/app.js'));
for (const id of ['settingsPlcUpdates', 'importPlcReport', 'plcSettingsStatus']) assert.ok(html.includes(`id="${id}"`));
for (const id of ['openPlcUpdates', 'plcToolbarStatus']) assert.ok(!html.includes(`id="${id}"`), 'The biweekly importer has no main-toolbar control.');
const settingsData = html.slice(html.indexOf('id="settingsDataPanel"'), html.indexOf('id="workspaceSettingsDone"'));
for (const id of ['settingsPlcUpdates', 'importPlcReport', 'plcSettingsStatus']) assert.ok(settingsData.includes(`id="${id}"`), 'PLC controls and freshness belong to Settings → Data & export.');
console.log('PLC UI checks passed: bounded search/paging, 220-product match cards, safe explicit date suggestions, regional and newer-date guards, real codename creation/quarter batch confirmation, deferred date retention and Keep PPC, direct collection, original clocks, sharing retries, complete precision-aware exports, and Settings integration.');
