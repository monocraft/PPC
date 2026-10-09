import assert from 'node:assert/strict';

// All examples in this check are invented. The private bi-weekly workbook is
// intentionally not copied into fixtures or embedded in repository files.
await import('../../public/js/ascm-import.js');
await import('../../public/js/package-codec.js');
await import('../../public/js/master-model.js');
await import('../../public/js/plc-import.js');

const importer = globalThis.PLCImporter;
const codec = globalThis.PortfolioPackage;
const model = globalThis.PortfolioMasterModel;
assert.ok(importer, 'PLC importer must register on globalThis.');

const copy = (value) => structuredClone(value);
const xmlText = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const letters = (index) => {
  let result = '';
  for (let remaining = index + 1; remaining > 0; remaining = Math.floor((remaining - 1) / 26)) result = String.fromCharCode(65 + (remaining - 1) % 26) + result;
  return result;
};

function workbook(sheets, { date1904 = false } = {}) {
  const entries = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    'xl/workbook.xml': `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="${date1904 ? 1 : 0}"/><sheets>${sheets.map((sheet, index) => `<sheet name="${xmlText(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}</Relationships>`,
    'xl/styles.xml': '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
  };
  sheets.forEach((sheet, index) => {
    const rows = sheet.rows.map((values, rowIndex) => `<row r="${rowIndex + 1}">${values.flatMap((raw, column) => {
      if (raw === undefined || raw === null) return [];
      const cell = typeof raw === 'object' ? raw : { value: raw };
      const ref = `${letters(column)}${rowIndex + 1}`;
      const formula = cell.formula ? `<f>${xmlText(cell.formula)}</f>` : '';
      if (typeof cell.value === 'number') return [`<c r="${ref}" s="${cell.date ? 1 : 0}">${formula}<v>${cell.value}</v></c>`];
      return [`<c r="${ref}" t="inlineStr">${formula}<is><t xml:space="preserve">${xmlText(cell.value)}</t></is></c>`];
    }).join('')}</row>`).join('');
    const merges = sheet.merges?.length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((ref) => `<mergeCell ref="${xmlText(ref)}"/>`).join('')}</mergeCells>` : '';
    entries[`xl/worksheets/sheet${index + 1}.xml`] = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData>${merges}</worksheet>`;
  });
  return codec.createZip(Object.entries(entries).map(([name, source]) => ({ name, data: new TextEncoder().encode(source) })));
}

function portfolio(products, categoryId = 'pc-gaming-audio') {
  return {
    version: 4,
    categories: [{ id: categoryId, board: { lanes: [{ id: 'wired' }, { id: 'wireless' }], products: products.map((product) => ({ laneId: 'wired', specs: [], partSkus: [], variantGroups: [], roadmap: {}, ...copy(product) })) } }],
  };
}

function product(manifest, id = 'fixture-one') {
  return manifest.categories.flatMap((category) => category.board.products).find((item) => item.id === id);
}

const dateCases = [
  ['2026-10-08', 'exact', '2026-10-08'],
  ['10/8/2026', 'exact', '2026-10-08'],
  ['October 8, 2026', 'exact', '2026-10-08'],
  ['2024-02-29', 'exact', '2024-02-29'],
  ['2026-02-29', 'invalid'],
  ['2026-04-31', 'invalid'],
  ['2026-13-01', 'invalid'],
  ['10/8', 'missing-year'],
  ['October 8', 'missing-year'],
  ['Q4 2026', 'quarter'],
  ['October 2026', 'month'],
  ['TBD', 'blank'],
  ['', 'blank'],
];
for (const [raw, kind, value] of dateCases) {
  const result = importer.parseDate(raw);
  assert.equal(result.kind, kind, `Date classification for ${JSON.stringify(raw)}.`);
  assert.equal(result.value || '', value || '', `Only a complete real date may become a master date: ${JSON.stringify(raw)}.`);
}
assert.equal(importer.parseDate(59, { numeric: true }).value, '1900-02-28');
assert.equal(importer.parseDate(60, { numeric: true }).kind, 'invalid', 'Excel serial 60 is its fictitious leap day, never a real master date.');
assert.equal(importer.parseDate(61, { numeric: true }).value, '1900-03-01');
assert.equal(importer.parseDate(0, { numeric: true, date1904: true }).value, '1904-01-01');
assert.equal(importer.parseDate(1, { numeric: true, date1904: true }).value, '1904-01-02');
assert.notEqual(importer.parseDate(46203, { numeric: false }).kind, 'exact', 'A value explicitly declared nonnumeric must not become an Excel serial date.');
assert.equal(importer.parseDate('2026-10-08 (CN)').value, '2026-10-08', 'A single explicit regional date keeps its real date.');
for (const raw of [
  'CN: 2026-10-08; TH: 2026-10-22',
  '2026-10-08 -> 2026-10-22',
  '2026-10-08 ~ 2026-10-22',
  '10/8/2026 or 10/22/2026',
  'Risk: need confirmation by 10/8/2026 before final schedule',
]) {
  const result = importer.parseDate(raw);
  assert.notEqual(result.kind, 'exact', `Narrative and competing dates need review: ${raw}.`);
  assert.equal(result.value || '', '', 'An unresolved date must not expose an automatic master-date value.');
}

function row({ key = 'fixture-row-1', name = 'Fixture Cloud III', codename = 'Fixture Harvester', categoryId = 'pc-gaming-audio', reportDate = '2026-10-08', ffsDate = '2026-11-05', dates = {}, ...extras } = {}) {
  return {
    key, name, codename, categoryId, projectId: '', section: 'Headset', stage: 'Development', status: 'On schedule', forecast: '', reportDate,
    dates: {
      ffsDate: { ...importer.parseDate(ffsDate), source: { sheet: 'Fixture Status', cell: 'F4', inherited: false, crossProduct: false } },
      ...dates,
    },
    milestones: {}, data: {}, sources: [{ sheet: 'Fixture Status', row: 4 }], ...extras,
  };
}
function dataset(rows, { reportDate = '2026-10-08', fingerprint = 'synthetic-report-2026-10-08', ...metadata } = {}) {
  return { metadata: { fileName: 'synthetic-bi-weekly.xlsx', fingerprint, reportDate, reportDateBasis: 'explicit-report-date', ...metadata }, rows: rows.map((item) => ({ ...item, reportDate })) };
}
function planFor(rows, manifest, options = {}) {
  const plan = importer.buildPlan(dataset(rows, options.metadata), manifest, options);
  assert.ok(Array.isArray(plan.items), 'Import preview needs an enumerable list of row decisions.');
  return plan;
}
function fieldDecision(plan, key = 'fixture-row-1', field = 'ffsDate') {
  const item = plan.items.find((candidate) => candidate.key === key);
  assert.ok(item, `Plan must preserve source row ${key}.`);
  const decision = item.fields.find((candidate) => candidate.field === field);
  assert.ok(decision, `Plan must expose ${field} decision for ${key}.`);
  return decision;
}

const initial = portfolio([{ id: 'fixture-one', name: 'Fixture Cloud III', codename: 'Fixture Harvester', ffsDate: '2026-10-01', generalAvailabilityDate: '2026-12-01', price: 129.99, imageAssetId: 'manual-hero', arbitraryManualData: { keep: true } }]);
const initialBefore = copy(initial);
const incoming = row();
const simple = planFor([incoming], initial);
assert.equal(simple.items[0].match.status, 'matched');
assert.equal(simple.items[0].matchedProductId, 'fixture-one');
assert.equal(fieldDecision(simple).status, 'update');
assert.deepEqual(initial, initialBefore, 'Planning must not mutate the current master.');
const firstAt = '2026-10-09T16:00:00.000Z';
const accepted = importer.applyPlan(initial, simple, { now: firstAt });
assert.equal(product(accepted.portfolio).ffsDate, '2026-11-05');
assert.equal(product(accepted.portfolio).generalAvailabilityDate, '2026-12-01', 'FFS cannot implicitly rewrite GA.');
assert.equal(product(accepted.portfolio).price, 129.99);
assert.equal(product(accepted.portfolio).imageAssetId, 'manual-hero');
assert.deepEqual(product(accepted.portfolio).arbitraryManualData, { keep: true });
assert.deepEqual(initial, initialBefore, 'Applying must return a new portfolio.');
assert.ok(product(accepted.portfolio).plc, 'Each accepted observation needs PLC provenance.');
assert.equal(product(accepted.portfolio).plc.fields.ffsDate.value, '2026-11-05');
assert.equal(product(accepted.portfolio).plc.fields.ffsDate.reportDate, '2026-10-08');
assert.equal(product(accepted.portfolio).plc.fields.ffsDate.changedAt, firstAt);
assert.equal(product(accepted.portfolio).plc.fields.ffsDate.sourceFile, 'synthetic-bi-weekly.xlsx', 'Retained fields identify the workbook that supplied their evidence.');
assert.equal(product(accepted.portfolio).plc.fields.ffsDate.fingerprint, 'synthetic-report-2026-10-08');
assert.equal(product(accepted.portfolio).plc.history[0].sourceFile, 'synthetic-bi-weekly.xlsx', 'Historical date changes keep their original source file.');
assert.equal(product(accepted.portfolio).plc.history[0].fingerprint, 'synthetic-report-2026-10-08');
const detachedPreview = planFor([incoming], accepted.portfolio);
const originalSourceFile = product(accepted.portfolio).plc.sourceFile;
detachedPreview.baseline.find((entry) => entry.productId === 'fixture-one').plc.sourceFile = 'Mutated preview-only label';
assert.equal(product(accepted.portfolio).plc.sourceFile, originalSourceFile, 'Returned preview baselines cannot mutate accepted master provenance.');

const repeated = importer.applyPlan(accepted.portfolio, planFor([incoming], accepted.portfolio), { now: '2026-10-10T16:00:00.000Z' });
assert.deepEqual(repeated.portfolio, accepted.portfolio, 'Repeating the same report must not move any update, import, or aging clock.');
const redatedSameSource = importer.buildPlan(dataset([incoming]), accepted.portfolio, { reportDate: '2026-10-22' });
const redatedApplied = importer.applyPlan(accepted.portfolio, redatedSameSource, { now: '2026-10-23T16:00:00.000Z' });
assert.deepEqual(redatedApplied.portfolio, accepted.portfolio, 'The same bytes cannot be relabeled as a newer observation to reset aging.');
const blankPlan = planFor([row({ ffsDate: '' })], accepted.portfolio, { metadata: { reportDate: '2026-10-22', fingerprint: 'synthetic-blank-report' } });
assert.equal(fieldDecision(blankPlan).status, 'blank');
const blankAccepted = importer.applyPlan(accepted.portfolio, blankPlan, { now: '2026-10-23T16:00:00.000Z' });
assert.equal(product(blankAccepted.portfolio).ffsDate, '2026-11-05', 'A bi-weekly blank cannot erase a previously accepted date.');
assert.equal(product(blankAccepted.portfolio).plc.fields.ffsDate.reportDate, '2026-10-08', 'A blank cannot refresh the populated field observation.');

const older = planFor([row({ ffsDate: '2026-10-10' })], accepted.portfolio, { metadata: { reportDate: '2026-09-24', fingerprint: 'synthetic-older-report' } });
assert.equal(fieldDecision(older).status, 'stale', 'Report date governs source order, not upload time.');
assert.equal(product(importer.applyPlan(accepted.portfolio, older, { now: '2026-10-24T16:00:00.000Z' }).portfolio).ffsDate, '2026-11-05');
const conflictingSameDay = planFor([row({ ffsDate: '2026-11-20' })], accepted.portfolio, { metadata: { fingerprint: 'synthetic-revision-same-day' } });
assert.equal(fieldDecision(conflictingSameDay).status, 'review', 'Different values bearing the same source date need review.');

const laterSameValue = planFor([incoming], accepted.portfolio, { metadata: { reportDate: '2026-10-22', fingerprint: 'synthetic-later-confirmation' } });
const confirmed = importer.applyPlan(accepted.portfolio, laterSameValue, { now: '2026-10-23T16:00:00.000Z' });
assert.equal(product(confirmed.portfolio).plc.fields.ffsDate.changedAt, firstAt, 'An unchanged but newly confirmed date keeps the last-change clock.');
assert.equal(product(confirmed.portfolio).plc.fields.ffsDate.reportDate, '2026-10-22', 'A later report advances the observation clock.');

const manual = copy(accepted.portfolio);
product(manual).ffsDate = '2026-11-07';
const manualPlan = planFor([row({ ffsDate: '2026-11-21' })], manual, { metadata: { reportDate: '2026-10-22', fingerprint: 'synthetic-manual-conflict' } });
assert.equal(fieldDecision(manualPlan).status, 'review', 'A manual date edit after the prior import must remain visible and protected.');
assert.equal(product(importer.applyPlan(manual, manualPlan, { now: '2026-10-23T16:00:00.000Z' }).portfolio).ffsDate, '2026-11-07');
const resolvedManual = importer.applyPlan(manual, manualPlan, { now: '2026-10-23T16:00:00.000Z', resolutions: { 'fixture-row-1': { ffsDate: '2026-11-21' } } });
assert.equal(product(resolvedManual.portfolio).ffsDate, '2026-11-21', 'An explicit reviewed date can resolve a manual conflict.');
const datedBaseline = model.snapshot(initial).products.find((item) => item.productId === 'fixture-one');
const recentlyEditedMaster = model.mergeChanges(initial, [{ productId: 'fixture-one', base: datedBaseline.values, baseRevisions: datedBaseline.revisions, patch: { ffsDate: '2026-11-06' } }], { now: '2026-10-10T16:00:00.000Z', actor: 'Synthetic manual date owner' }).manifest;
const firstImportOldSource = planFor([incoming], recentlyEditedMaster);
assert.equal(fieldDecision(firstImportOldSource).status, 'review', 'The first PLC import respects an accepted master date edit newer than its source.');
assert.equal(product(importer.applyPlan(recentlyEditedMaster, firstImportOldSource, { now: '2026-10-11T16:00:00.000Z' }).portfolio).ffsDate, '2026-11-06');
assert.equal(fieldDecision(planFor([incoming], recentlyEditedMaster, { metadata: { reportDate: '2026-10-22', fingerprint: 'synthetic-newer-than-master-edit' } })).status, 'update', 'A genuinely newer source is eligible after an older accepted master edit.');
const firstLocalEdit = copy(initial);
const firstLocalEditAt = '2026-10-09T18:00:00.000Z';
product(firstLocalEdit).ffsDate = '2026-11-20';
firstLocalEdit.dateLocalEdits = { 'fixture-one': { ffsDate: { at: firstLocalEditAt, value: '2026-11-20', source: 'local' } } };
const firstLocalPlan = planFor([incoming], firstLocalEdit, { reportDate: '2026-10-09', reportDateBasis: 'Import date' });
assert.equal(fieldDecision(firstLocalPlan).status, 'review', 'The first PLC import must protect a current local date edit newer than the original source period.');
const firstLocalHeld = importer.applyPlan(firstLocalEdit, firstLocalPlan, { now: '2026-10-09T19:00:00.000Z' }).portfolio;
assert.equal(product(firstLocalHeld).ffsDate, '2026-11-20');
assert.equal(product(firstLocalHeld).plc.fields.ffsDate, undefined, 'A withheld incoming date cannot gain an accepted observation clock.');
assert.deepEqual(firstLocalHeld.plcReview.entries[0].fields, ['ffsDate']);
assert.equal(firstLocalHeld.dateLocalEdits['fixture-one'].ffsDate.at, firstLocalEditAt);
assert.equal(fieldDecision(planFor([incoming], firstLocalEdit, { metadata: { reportDate: importer.localDay(new Date(firstLocalEditAt)), fingerprint: 'synthetic-same-day-local-edit' } })).status, 'review', 'A calendar-day source cannot establish which same-day edit came first.');
assert.equal(fieldDecision(planFor([incoming], firstLocalEdit, { metadata: { reportDate: '2026-10-22', fingerprint: 'synthetic-later-than-local-edit' } })).status, 'update', 'A source period later than the local edit is eligible for its first PLC observation.');
const ownPlcEdit = copy(firstLocalEdit); ownPlcEdit.dateLocalEdits['fixture-one'].ffsDate.source = 'plc';
assert.equal(fieldDecision(planFor([incoming], ownPlcEdit)).status, 'update', 'The PLC mutation clock must not masquerade as an intervening manual date edit.');
const obsoleteLocalEdit = copy(firstLocalEdit); obsoleteLocalEdit.dateLocalEdits['fixture-one'].ffsDate.value = '2026-11-19';
assert.equal(fieldDecision(planFor([incoming], obsoleteLocalEdit)).status, 'update', 'A local edit clock protects only its corresponding current value.');
const invalidLocalEdit = copy(firstLocalEdit); invalidLocalEdit.dateLocalEdits['fixture-one'].ffsDate.at = 'invalid';
assert.equal(fieldDecision(planFor([incoming], invalidLocalEdit)).status, 'update', 'An invalid legacy clock must not invent local edit history.');
const localConfirmation = importer.applyPlan(firstLocalEdit, planFor([row({ ffsDate: '2026-11-20' })], firstLocalEdit), { now: '2026-10-09T19:00:00.000Z' }).portfolio;
assert.equal(product(localConfirmation).plc.fields.ffsDate.changedAt, firstLocalEditAt, 'Confirming an unchanged manual date preserves its actual local change timestamp.');
assert.equal(product(localConfirmation).plc.fields.ffsDate.observedAt, '2026-10-09T19:00:00.000Z');
const changedAfterPreview = copy(initial);
product(changedAfterPreview).ffsDate = '2026-11-09';
assert.throws(() => importer.applyPlan(changedAfterPreview, simple, { now: firstAt }), /changed since the preview/i, 'A date changed after preview must reject an obsolete plan.');
assert.equal(product(changedAfterPreview).ffsDate, '2026-11-09');

const undated = planFor([row({ reportDate: '' })], initial, { now: firstAt, metadata: { reportDate: '', fingerprint: 'synthetic-undated-report' } });
assert.equal(undated.reportDate, '2026-10-09', 'The user-approved fallback uses the date the file was imported.');
assert.equal(undated.reportDateBasis, 'Import date fallback', 'Fallback dates retain their weaker source provenance.');
assert.equal(fieldDecision(undated).status, 'update');

const crossMerged = row({ dates: { ffsDate: { ...importer.parseDate('2026-11-05'), source: { sheet: 'Fixture Status', cell: 'F5', mergeRange: 'F4:F5', inherited: true, crossProduct: true } } } });
const mergePlan = planFor([crossMerged], initial);
assert.equal(fieldDecision(mergePlan).status, 'review', 'A date merged over independently named products must require review.');
assert.equal(product(importer.applyPlan(initial, mergePlan, { now: firstAt }).portfolio).ffsDate, '2026-10-01');
const cancelledPlan = planFor([row({ cancelled: true })], initial);
assert.equal(fieldDecision(cancelledPlan).status, 'review');
const cancelledApplied = importer.applyPlan(initial, cancelledPlan, { now: firstAt, resolutions: { 'fixture-row-1': { ffsDate: '2026-11-05' } } }).portfolio;
assert.equal(product(cancelledApplied).ffsDate, '2026-10-01', 'Cancelled projects cannot silently revive dates even when another field is reviewed.');
assert.ok(product(cancelledApplied).plc.rows[0].cancelled, 'Cancellation evidence remains available for audit.');
const cachedFormula = planFor([row({ dates: { ffsDate: { ...importer.parseDate('2026-11-05'), source: { sheet: 'Fixture Status', cell: 'F4', formula: true } } } })], initial);
assert.equal(fieldDecision(cachedFormula).status, 'review', 'A formula cache does not act as confirmed source date evidence.');
const regionalPlan = planFor([row({ ffsDate: '2026-11-05 (CN)' })], initial);
assert.equal(fieldDecision(regionalPlan).status, 'review', 'A regional date needs an explicit decision before becoming global FFS.');
const ignoredField = importer.applyPlan(initial, simple, { now: firstAt, skippedFields: { 'fixture-row-1': ['ffsDate'] } }).portfolio;
assert.equal(product(ignoredField).ffsDate, '2026-10-01', 'The reviewer can collect evidence while excluding a date field.');

const duplicateRows = planFor([incoming, row({ key: 'fixture-row-2' })], initial);
assert.ok(duplicateRows.items.some((item) => item.fields.some((field) => field.status === 'review')), 'Two source rows claiming one master field must remain visible as a collision.');
const collisionRows = planFor([incoming, row({ key: 'fixture-row-2', ffsDate: '2026-12-05' })], initial);
assert.equal(product(importer.applyPlan(initial, collisionRows, { now: firstAt }).portfolio).ffsDate, '2026-10-01', 'Conflicting source rows cannot win by sheet order.');

const twoNames = portfolio([
  { id: 'fixture-one', name: 'Fixture Cloud III', codename: 'Fixture Harvester', ffsDate: '2026-10-01' },
  { id: 'fixture-two', name: 'Fixture Cloud III', codename: 'Fixture Harvester', ffsDate: '2026-10-02' },
]);
assert.notEqual(planFor([incoming], twoNames).items[0].match.status, 'matched', 'Duplicate exact names and codenames cannot be matched automatically.');
assert.deepEqual(planFor([incoming], twoNames).items[0].match.candidates.map((item) => item.productId).sort(), ['fixture-one', 'fixture-two']);
const chosenDuplicate = planFor([incoming], twoNames, { selections: { 'fixture-row-1': 'fixture-one' } });
assert.equal(chosenDuplicate.items[0].matchedProductId, 'fixture-one', 'A reviewed choice must resolve duplicate exact candidates.');
const chosenApplied = importer.applyPlan(twoNames, chosenDuplicate, { now: firstAt }).portfolio;
assert.equal(product(chosenApplied).ffsDate, '2026-11-05');
assert.equal(product(chosenApplied, 'fixture-two').ffsDate, '2026-10-02', 'A reviewed identity updates only the chosen product.');
const nearFamilies = portfolio([
  { id: 'fixture-one', name: 'Fixture Cloud III Wireless', codename: 'Fixture Harvester Wireless' },
  { id: 'fixture-two', name: 'Fixture Cloud III Wired', codename: 'Fixture Harvester Wired' },
]);
assert.notEqual(planFor([incoming], nearFamilies).items[0].match.status, 'matched', 'A shortened family name cannot choose its wired or wireless sibling.');
assert.equal(planFor([row({ name: 'Fixture Cloud III Wireless', codename: 'Fixture Harvester Wireless' })], nearFamilies).items[0].matchedProductId, 'fixture-one');
const consoleVariant = portfolio([{ id: 'fixture-ps', name: 'Fixture Cloud III PS5', codename: 'Fixture Harvester', specs: [{ id: 'platform', label: 'Platform', value: 'PlayStation' }] }], 'console-gaming-audio');
assert.notEqual(planFor([row({ name: 'Fixture Cloud III Xbox', categoryId: 'console-gaming-audio' })], consoleVariant).items[0].match.status, 'matched', 'A shared codename cannot override a known incompatible console platform.');
const wiredVariant = portfolio([{ id: 'fixture-wired', name: 'Fixture Cloud III Wired', codename: 'Fixture Harvester' }]);
assert.notEqual(planFor([row({ name: 'Fixture Cloud III Wireless' })], wiredVariant).items[0].match.status, 'matched', 'A shared codename cannot change an explicitly wired product into its wireless variant.');
const categories = { version: 4, categories: [
  ...portfolio([{ id: 'fixture-one', name: 'Fixture Cloud III', codename: 'Fixture Harvester' }]).categories,
  ...portfolio([{ id: 'fixture-console', name: 'Fixture Cloud III', codename: 'Fixture Harvester' }], 'console-gaming-audio').categories,
] };
assert.equal(planFor([incoming], categories).items[0].matchedProductId, 'fixture-one', 'Matching must respect portfolio category boundaries.');
assert.equal(planFor([row({ categoryId: 'console-gaming-audio' })], categories).items[0].matchedProductId, 'fixture-console');

assert.equal(planFor([row({ productId: 'fixture-one', name: 'Renamed fixture' })], initial).items[0].matchedProductId, 'fixture-one', 'An explicit PPC product ID survives a marketing rename.');
const skuPortfolio = portfolio([{ id: 'fixture-one', name: 'Curated fixture name', codename: 'Curated fixture codename', partSkus: [{ id: 'sku-a', code: 'FIXTURE-A01' }] }]);
assert.equal(planFor([row({ name: 'Source fixture name', codename: 'Source fixture codename', skus: ['fixture-a01'] })], skuPortfolio).items[0].matchedProductId, 'fixture-one', 'A unique canonical HP SKU may bridge different names.');
const duplicatedSku = copy(skuPortfolio);
duplicatedSku.categories[0].board.products.push({ ...copy(product(skuPortfolio)), id: 'fixture-two' });
assert.notEqual(planFor([row({ skus: ['FIXTURE-A01'] })], duplicatedSku).items[0].match.status, 'matched', 'A SKU claimed by two products requires a human choice.');
const explicitConflict = planFor([row({ productId: 'fixture-one', skus: ['FIXTURE-A01'] })], portfolio([
  { id: 'fixture-one', name: 'Fixture Cloud III', codename: 'Fixture Harvester' },
  { id: 'fixture-two', name: 'Other fixture', codename: 'Other codename', partSkus: [{ id: 'sku-a', code: 'FIXTURE-A01' }] },
]));
assert.notEqual(explicitConflict.items[0].match.status, 'matched', 'Disagreeing strong identifiers cannot choose one product silently.');
const aliasPlan = planFor([row({ name: 'Legacy fixture label', codename: 'Legacy fixture code' })], initial, { aliases: { 'fixture-row-1': 'fixture-one' } });
assert.equal(aliasPlan.items[0].matchedProductId, 'fixture-one', 'A reviewed saved alias permits reliable later imports.');
const remembered = copy(initial);
product(remembered).plc = { identities: [{ key: 'legacy-fixture-row', name: 'Legacy fixture label', codename: 'Legacy fixture code' }] };
assert.equal(planFor([row({ key: 'legacy-fixture-row', name: 'Legacy fixture label', codename: 'Legacy fixture code' })], remembered).items[0].matchedProductId, 'fixture-one', 'Accepted PLC identities survive later workbook runs.');
const numericProject = planFor([row({ projectId: '1', name: 'Unrelated fixture', codename: 'Unknown fixture' })], portfolio([{ id: '1', name: 'Fixture Cloud III', codename: 'Fixture Harvester' }]));
assert.notEqual(numericProject.items[0].match.status, 'matched', 'The workbook section counter is never a stable product ID.');

const mixedObservation = copy(accepted.portfolio);
product(mixedObservation).generalAvailabilityDate = '2027-01-01';
product(mixedObservation).plc.reportDate = '2026-11-05';
product(mixedObservation).plc.fields.generalAvailabilityDate = { value: '2027-01-01', reportDate: '2026-11-05', changedAt: firstAt, observedAt: firstAt };
const mixedDates = planFor([row({ ffsDate: '2026-12-01', dates: { generalAvailabilityDate: { ...importer.parseDate('2027-02-01'), source: { sheet: 'Fixture Status', cell: 'I4', inherited: false, crossProduct: false } } } })], mixedObservation, { metadata: { reportDate: '2026-10-22', fingerprint: 'synthetic-mixed-age' } });
assert.equal(fieldDecision(mixedDates, 'fixture-row-1', 'ffsDate').status, 'update', 'A report newer than FFS provenance may update FFS.');
assert.equal(fieldDecision(mixedDates, 'fixture-row-1', 'generalAvailabilityDate').status, 'stale', 'The same report can be stale for independently newer GA provenance.');
const mixedApplied = importer.applyPlan(mixedObservation, mixedDates, { now: '2026-11-06T16:00:00.000Z' }).portfolio;
assert.equal(product(mixedApplied).ffsDate, '2026-12-01');
assert.equal(product(mixedApplied).generalAvailabilityDate, '2027-01-01');
assert.equal(product(mixedApplied).plc.reportDate, '2026-11-05', 'A partial older observation cannot move the product freshness backward.');
const lifecycleMaster = portfolio([{ id: 'fixture-one', name: 'Fixture Cloud III', codename: 'Fixture Harvester', generalAvailabilityDate: '2026-12-01', endManufacturingDate: '2028-12-01' }]);
const invalidLifecycle = planFor([row({ dates: { generalAvailabilityDate: { ...importer.parseDate('2029-01-01'), source: { sheet: 'Fixture Status', cell: 'I4' } } } })], lifecycleMaster);
assert.equal(fieldDecision(invalidLifecycle, 'fixture-row-1', 'generalAvailabilityDate').status, 'review', 'A source GA after the saved manufacturing end needs review.');
const lifecycleBefore = copy(lifecycleMaster);
assert.throws(() => importer.applyPlan(lifecycleMaster, invalidLifecycle, { now: firstAt, resolutions: { 'fixture-row-1': { generalAvailabilityDate: '2029-01-01' } } }), /GA after end|GA would fall after|date order/i, 'Even a reviewed date must preserve calendar ordering.');
assert.deepEqual(lifecycleMaster, lifecycleBefore, 'A rejected multi-field resolution must never partially mutate the input.');

const typedReports = dataset([incoming]);
const sourceDateBefore = copy(typedReports.metadata);
const override = importer.buildPlan(typedReports, initial, { reportDate: '2026-10-22' });
assert.deepEqual(typedReports.metadata, sourceDateBefore, 'A report-date override must not mutate the parsed workbook metadata.');
assert.equal(override.reportDate, '2026-10-22');
assert.equal(fieldDecision(override).reportDate, '2026-10-22', 'A reviewed official-date override governs rows sharing the workbook report date.');
const sectionSpecific = dataset([incoming]);
sectionSpecific.rows[0].reportDate = '2026-09-13';
const overriddenSection = importer.buildPlan(sectionSpecific, initial, { reportDate: '2026-10-22' });
assert.equal(fieldDecision(overriddenSection).reportDate, '2026-09-13', 'An explicitly older section date keeps its own source ordering.');

const fresh = importer.freshness(product(confirmed.portfolio).plc, '2026-10-29');
assert.equal(fresh.ageDays, 7, 'Source aging counts calendar days from the latest report observation.');
assert.equal(fresh.nextDueDate, '2026-11-05', 'Bi-weekly cadence places the next report fourteen days after the source report.');
const aged = importer.freshness(product(confirmed.portfolio).plc, '2026-11-06');
assert.equal(aged.ageDays, 15);
assert.notEqual(aged.status, fresh.status, 'Fresh and overdue reports must have different visible freshness status.');
assert.deepEqual(importer.freshness(null, '2026-10-29'), { ageDays: null, importAgeDays: null, changeAgeDays: null, status: 'unknown', nextDueDate: '' });
const malformedFreshness = importer.freshness({ version: 1, reportDate: 'bad', importedAt: 'bad', changedAt: '2026-02-30' }, '2026-10-29');
assert.equal(malformedFreshness.ageDays, null);
assert.equal(malformedFreshness.changeAgeDays, null, 'Invalid calendar dates cannot silently normalize into a valid aging date.');
assert.equal(malformedFreshness.status, 'unknown');
assert.equal(malformedFreshness.nextDueDate, '');

const sourceSheet = {
  name: 'Bi-Weekly Update(2026)',
  rows: [
    ['Synthetic status fixture'],
    Array.from({ length: 17 }, (_, column) => column === 16 ? '10/5~10/8/2026' : ''),
    ['', 'No', 'Headset/Microphone/Acc(2)', 'Stage', 'Target FFS\n(POR passed)', 'Current FFS', 'FXLH by Air(2 WKS)\nto US4C/CH23', 'Health status', '', '', '', '', '', '', '', '', 'Status in WK41/2026'],
    ['', 1, 'Fixture Cloud III\n"Fixture Harvester"', 'Development', '2026-10-01', '2026-11-05', '2026-12-01', 'Green', '', '', '', '', '', '', '', '', 'Ready for next review'],
    ['', 2, 'Fixture Cloud III Wireless\n"Fixture Harvester Wireless"', '', '2026-10-10', undefined, '', 'Green', '', '', '', '', '', '', '', '', 'Awaiting confirmation'],
    [],
    ['', 'No', 'Mice Lineups', 'Stage', 'Original FFS\n(Roadmap)', 'Current FFS', 'FXLH by Air(2 WKS)\nto US4C/CH23', 'Health status', '', '', '', '', '', '', '', '', 'Status in WK41/2026'],
    ['', 1, 'Fixture Pulsefire Mini\n"Fixture Pulse"', 'Development', 'Q4 2026', '10/22', '', 'Yellow', '', '', '', '', '', '', '', '', 'Missing source year'],
  ],
  merges: ['D4:D5', 'F4:F5'],
};
const workbookBytes = workbook([sourceSheet]);
const parsed = await importer.parseWorkbook(workbookBytes, { fileName: 'synthetic-bi-weekly.xlsx' });
assert.equal(parsed.metadata.fileName, 'synthetic-bi-weekly.xlsx');
assert.equal(parsed.metadata.reportDate, '2026-10-08', 'The end of the explicit report window provides its source date.');
assert.match(parsed.metadata.fingerprint, /^[a-f0-9]{64}$/i, 'Source identity must use the bytes of the workbook.');
assert.equal(parsed.rows.length, 3, 'Section headings and separator rows cannot turn into product records.');
const parsedCloud = parsed.rows.find((item) => item.name.includes('Cloud III') && !item.name.includes('Wireless'));
const parsedWireless = parsed.rows.find((item) => item.name.includes('Wireless'));
const parsedMouse = parsed.rows.find((item) => item.name.includes('Pulsefire'));
assert.equal(parsedCloud.categoryId, 'pc-gaming-audio');
assert.equal(parsedMouse.categoryId, 'mice', 'Section context must reset category after a separator.');
assert.equal(parsedMouse.dates.ffsDate.kind, 'missing-year');
assert.equal(parsedCloud.dates.ffsDate.source.crossProduct, true, 'The top cell of a cross-product merged date is also unsafe to auto-apply.');
assert.equal(parsedWireless.dates.ffsDate.source.crossProduct, true);
assert.equal(parsedWireless.dates.ffsDate.source.inherited, true);
assert.equal(parsedWireless.dates.ffsDate.source.mergeRange, 'F4:F5');
assert.equal(parsedWireless.dates.ffsDate.source.sheet, 'Bi-Weekly Update(2026)');
const parsedAgain = await importer.parseWorkbook(workbookBytes, { fileName: 'renamed-synthetic.xlsx' });
assert.equal(parsedAgain.metadata.fingerprint, parsed.metadata.fingerprint, 'Renaming a report does not create a new source identity.');
const changedBytes = workbook([{ ...sourceSheet, rows: sourceSheet.rows.map((values, index) => index === 3 ? values.map((value, column) => column === 16 ? 'Different observation' : value) : values) }]);
const parsedChanged = await importer.parseWorkbook(changedBytes, { fileName: 'synthetic-bi-weekly.xlsx' });
assert.notEqual(parsedChanged.metadata.fingerprint, parsed.metadata.fingerprint, 'A changed source observation must receive a different identity.');
const olderSheet = { ...sourceSheet, name: 'Bi-Weekly Update(2025)', rows: sourceSheet.rows.map((values, index) => index === 1 ? values.map((value, column) => column === 16 ? '10/5~10/8/2025' : value) : values) };
const withHistory = await importer.parseWorkbook(workbook([olderSheet, sourceSheet]), { fileName: 'synthetic-with-history.xlsx' });
assert.equal(withHistory.metadata.reportDate, '2026-10-08');
assert.equal(withHistory.metadata.sheets[0].name, 'Bi-Weekly Update(2026)', 'A historical tab appearing first cannot become the active source.');
assert.equal(withHistory.rows.length, 3, 'Historical snapshots are inventoried without producing current date updates.');
await assert.rejects(() => importer.parseWorkbook(workbook([sourceSheet, { ...sourceSheet, name: 'Another current snapshot' }]), { fileName: 'synthetic-ambiguous.xlsx' }), /ambiguous/i, 'Equally current tables require an explicit source selection.');
const typedNumeric = { ...sourceSheet, merges: [], rows: sourceSheet.rows.map((values, index) => index === 3 ? values.map((value, column) => column === 5 ? { value: 46203, date: true } : value) : values) };
const numericReport = await importer.parseWorkbook(workbook([typedNumeric]), { fileName: 'synthetic-typed-date.xlsx' });
assert.equal(numericReport.rows[0].dates.ffsDate.value, importer.parseDate(46203, { numeric: true }).value, 'A date-formatted Excel numeric cell uses the workbook calendar.');
const untypedNumeric = { ...sourceSheet, merges: [], rows: sourceSheet.rows.map((values, index) => index === 3 ? values.map((value, column) => column === 5 ? 46203 : value) : values) };
const untypedReport = await importer.parseWorkbook(workbook([untypedNumeric]), { fileName: 'synthetic-untyped-number.xlsx' });
assert.notEqual(untypedReport.rows[0].dates.ffsDate.kind, 'exact', 'An unformatted numeric value remains raw evidence instead of becoming a date.');
const horizontalMerge = { ...sourceSheet, merges: ['E4:F4'], rows: sourceSheet.rows.map((values, index) => index === 3 ? values.map((value, column) => column === 5 ? undefined : value) : values) };
const horizontalReport = await importer.parseWorkbook(workbook([horizontalMerge]), { fileName: 'synthetic-horizontal-merge.xlsx' });
assert.equal(horizontalReport.rows[0].dates.ffsDate.value, '2026-10-01');
assert.equal(horizontalReport.rows[0].dates.ffsDate.source.cell, 'E4');
assert.equal(horizontalReport.rows[0].dates.ffsDate.source.inherited, true);
assert.equal(horizontalReport.rows[0].dates.ffsDate.source.crossProduct, false, 'A horizontal merge within one product does not imply several product identities.');
await assert.rejects(() => importer.parseWorkbook(new Uint8Array([1, 2, 3]), { fileName: 'broken.xlsx' }), 'A corrupt archive must fail before exposing importable rows.');

const storedBytes = codec.createZip([{ name: 'portfolio.json', data: new TextEncoder().encode(JSON.stringify(confirmed.portfolio)) }]);
const key = codec.generateKey();
const encrypted = await codec.encrypt(storedBytes, key);
const unpacked = JSON.parse(new TextDecoder().decode(codec.readZip(await codec.decrypt(encrypted, key)).get('portfolio.json')));
assert.deepEqual(product(unpacked).plc, product(confirmed.portfolio).plc, 'PLC provenance and aging survive the encrypted master/package format.');
const sharedValues = model.productValues(product(confirmed.portfolio));
assert.deepEqual(sharedValues.plc, product(confirmed.portfolio).plc, 'The shared master must include PLC provenance in its editable product values.');
const sharedApplied = model.applyProductValues(product(initial), sharedValues);
assert.deepEqual(sharedApplied.plc, product(confirmed.portfolio).plc, 'A shared-master reload restores the source identity and field clocks.');
assert.throws(() => model.productValues({ ...product(initial), plc: JSON.parse('{"version":1,"constructor":{"polluted":true}}') }), /PLC evidence key/i, 'Imported PLC metadata must reject prototype-control keys.');
assert.throws(() => model.productValues({ ...product(initial), plc: { version: 1, rows: Array.from({ length: 1001 }, () => ({})) } }), /PLC evidence/i, 'Unbounded observations cannot enter the shared-master model.');
const masterSeed = model.snapshot(initial);
const masterBase = masterSeed.products.find((item) => item.productId === 'fixture-one');
const masterSaved = model.mergeChanges(initial, [{ productId: 'fixture-one', base: masterBase.values, baseRevisions: masterBase.revisions, patch: { ffsDate: product(confirmed.portfolio).ffsDate, plc: sharedValues.plc } }], { now: firstAt, actor: 'Synthetic PLC import' });
assert.equal(masterSaved.conflicts.length, 0);
assert.deepEqual(product(masterSaved.manifest).plc, sharedValues.plc, 'An accepted shared-master save persists full PLC provenance.');

// The repeat-import flow keeps exact facts and defers only the exceptions. All
// queue fixtures are invented and can survive an ordinary JSON/storage reload.
const savedReload = (manifest) => JSON.parse(JSON.stringify(manifest));
const preciseDate = (value, cell = 'I4') => ({ ...importer.parseDate(value), source: { sheet: 'Fixture Status', cell } });
const partialRow = row({ dates: { generalAvailabilityDate: preciseDate('Q1 2027') } });
const partialPlan = planFor([partialRow], initial, { metadata: { fileName: 'synthetic-partial.xlsx', fingerprint: 'partial-queue-source', reportDate: '2026-10-08' } });
const partialApplied = importer.applyPlan(initial, partialPlan, { now: firstAt });
assert.equal(product(partialApplied.portfolio).ffsDate, '2026-11-05', 'An ambiguous GA must not block the same row\'s exact FFS.');
assert.equal(product(partialApplied.portfolio).generalAvailabilityDate, '2026-12-01');
assert.equal(partialApplied.summary.pendingReview, 1);
const savedPartial = savedReload(partialApplied.portfolio);
assert.equal(savedPartial.plcReview.version, 1);
assert.deepEqual(savedPartial.plcReview.entries[0].fields, ['generalAvailabilityDate']);
assert.equal(savedPartial.plcReview.entries[0].row.dates.generalAvailabilityDate.kind, 'quarter');
assert.equal(savedPartial.plcReview.entries[0].row.dates.generalAvailabilityDate.raw, 'Q1 2027');
assert.equal(savedPartial.plcReview.entries[0].metadata.fileName, 'synthetic-partial.xlsx');
assert.equal(savedPartial.plcReview.entries[0].metadata.fingerprint, 'partial-queue-source');
assert.equal(product(savedPartial).plc.fields.generalAvailabilityDate, undefined, 'A withheld date cannot gain a new observation timestamp.');
const partialReview = importer.buildReviewPlan(savedPartial, { now: '2026-10-23T16:00:00.000Z' });
assert.equal(partialReview.review, true);
assert.deepEqual(partialReview.items[0].fields.map((field) => field.field), ['generalAvailabilityDate'], 'A later review targets the saved exception without reobserving previously collected FFS.');
assert.equal(fieldDecision(partialReview, 'fixture-row-1', 'generalAvailabilityDate').reportDate, '2026-10-08');
const partialResolved = importer.applyPlan(savedPartial, partialReview, { now: '2026-10-23T16:00:00.000Z', resolutions: { 'fixture-row-1': { generalAvailabilityDate: '2027-02-05' } } });
assert.equal(partialResolved.portfolio.plcReview.entries.length, 0);
const reviewedGa = product(partialResolved.portfolio).plc.fields.generalAvailabilityDate;
assert.equal(reviewedGa.value, '2027-02-05'); assert.equal(reviewedGa.reviewed, true);
assert.equal(reviewedGa.sourceFile, 'synthetic-partial.xlsx'); assert.equal(reviewedGa.fingerprint, 'partial-queue-source');
assert.equal(reviewedGa.reportDate, '2026-10-08', 'Review time must never become the original field\'s source report date.');
assert.equal(reviewedGa.observedAt, '2026-10-23T16:00:00.000Z');
assert.equal(product(partialResolved.portfolio).plc.fields.ffsDate.observedAt, firstAt, 'Reviewing another field preserves the original FFS observation clock.');
assert.equal(product(partialResolved.portfolio).plc.history.at(-1).fingerprint, 'partial-queue-source');

const repeatPartial = importer.applyPlan(savedPartial, planFor([partialRow], savedPartial, { metadata: { fileName: 'synthetic-partial.xlsx', fingerprint: 'partial-queue-source', reportDate: '2026-10-08' } }), { now: '2026-10-30T16:00:00.000Z' });
assert.equal(repeatPartial.summary.duplicate, true);
assert.deepEqual(repeatPartial.portfolio, savedPartial, 'Repeated identical bytes preserve both field clocks and the unresolved queue\'s timestamps.');

const missingMatch = row({ key: 'queued-product', name: 'Unknown fixture source', codename: 'Unknown fixture codename', dates: { finalAssetsDate: preciseDate('2026-11-01', 'J4') } });
const matchQueued = importer.applyPlan(initial, planFor([missingMatch], initial, { metadata: { fileName: 'synthetic-unmatched.xlsx', fingerprint: 'unmatched-queue-source', reportDate: '2026-09-24' } }), { now: firstAt }).portfolio;
assert.equal(matchQueued.plcReview.entries[0].matchNeeded, true); assert.equal(product(matchQueued).plc, undefined);
const restoredMatch = savedReload(matchQueued);
const queuedMatchReview = importer.buildReviewPlan(restoredMatch, { selections: { 'queued-product': 'fixture-one' } });
assert.equal(queuedMatchReview.items[0].match.reason, 'Selected product');
const matchResolved = importer.applyPlan(restoredMatch, queuedMatchReview, { now: '2026-10-23T16:00:00.000Z' }).portfolio;
assert.equal(matchResolved.plcReview.entries.length, 0); assert.equal(product(matchResolved).ffsDate, '2026-11-05');
assert.equal(product(matchResolved).finalAssetsDate, '2026-11-01');
assert.equal(product(matchResolved).plc.fields.ffsDate.reportDate, '2026-09-24');
assert.equal(product(matchResolved).plc.fields.ffsDate.sourceFile, 'synthetic-unmatched.xlsx');
assert.equal(product(matchResolved).plc.fields.ffsDate.fingerprint, 'unmatched-queue-source');
assert.equal(planFor([missingMatch], matchResolved, { metadata: { reportDate: '2026-10-22', fingerprint: 'later-matched-source' } }).items[0].matchedProductId, 'fixture-one', 'A persisted reviewed identity makes the next file a direct import.');

const pendingOctober = importer.applyPlan(savedPartial, planFor([row({ dates: { generalAvailabilityDate: preciseDate('Q2 2027') } })], savedPartial, { metadata: { fingerprint: 'newer-queue-source', fileName: 'synthetic-newer.xlsx', reportDate: '2026-10-22' } }), { now: '2026-10-23T16:00:00.000Z' }).portfolio;
assert.equal(pendingOctober.plcReview.entries.length, 1); assert.equal(pendingOctober.plcReview.entries[0].metadata.fingerprint, 'newer-queue-source');
assert.equal(pendingOctober.plcReview.entries[0].row.dates.generalAvailabilityDate.raw, 'Q2 2027', 'The current source replaces its older unresolved value.');
const olderQueueRetry = importer.applyPlan(pendingOctober, planFor([partialRow], pendingOctober, { metadata: { fileName: 'synthetic-partial.xlsx', fingerprint: 'partial-queue-source', reportDate: '2026-10-08' } }), { now: '2026-10-24T16:00:00.000Z' }).portfolio;
assert.deepEqual(olderQueueRetry.plcReview, pendingOctober.plcReview, 'Uploading an older workbook cannot replace the current review exception.');
const olderSectionDataset = dataset([row({ dates: { generalAvailabilityDate: preciseDate('Q1 2027') } })], { fileName: 'synthetic-section-date.xlsx', fingerprint: 'older-section-source', reportDate: '2026-10-08' });
olderSectionDataset.rows[0].reportDate = '2026-09-13'; olderSectionDataset.rows[0].reportDateBasis = 'older-section-week';
const olderSectionQueued = importer.applyPlan(initial, importer.buildPlan(olderSectionDataset, initial), { now: firstAt }).portfolio;
const olderSectionReview = importer.buildReviewPlan(savedReload(olderSectionQueued));
assert.equal(fieldDecision(olderSectionReview, 'fixture-row-1', 'generalAvailabilityDate').reportDate, '2026-09-13');
const olderSectionResolved = importer.applyPlan(olderSectionQueued, olderSectionReview, { now: '2026-10-23T16:00:00.000Z', resolutions: { 'fixture-row-1': { generalAvailabilityDate: '2027-01-05' } } }).portfolio;
assert.equal(product(olderSectionResolved).plc.fields.generalAvailabilityDate.reportDate, '2026-09-13', 'A reviewed older section keeps its own report date and the workbook identity.');
assert.equal(product(olderSectionResolved).plc.fields.generalAvailabilityDate.fingerprint, 'older-section-source');
assert.equal(product(olderSectionResolved).plc.fields.generalAvailabilityDate.sourceFile, 'synthetic-section-date.xlsx');

// Each displayed date has independent change, observation, and accepted clocks.
const allDates = { generalAvailabilityDate: '2026-12-01', ffsDate: '2026-11-05', endManufacturingDate: '2028-12-31', globalAnnouncementDate: '2026-11-20', webReadinessDate: '2026-11-25', finalAssetsDate: '2026-11-15' };
assert.deepEqual(Object.keys(importer.fieldLabels).sort(), Object.keys(allDates).sort());
const emptyDates = portfolio([{ id: 'fixture-one', name: 'Fixture Cloud III', codename: 'Fixture Harvester' }]);
const allDateRow = row({ dates: Object.fromEntries(Object.entries(allDates).map(([field, value]) => [field, preciseDate(value)])) });
const datedAll = importer.applyPlan(emptyDates, planFor([allDateRow], emptyDates), { now: firstAt }).portfolio;
for (const [field, value] of Object.entries(allDates)) {
  const age = importer.getFieldAge(product(datedAll), field, '2026-10-30', { accepted: { value, at: '2026-10-10T16:00:00.000Z' } });
  assert.equal(age.value, value); assert.equal(age.populated, true);
  assert.equal(age.changedAt, firstAt); assert.equal(age.changeAgeDays, 21);
  assert.equal(age.observedAt, firstAt); assert.equal(age.observedAgeDays, 21);
  assert.equal(age.acceptedAgeDays, 20); assert.equal(age.sourceAgeDays, 22);
  assert.equal(age.sourceFile, 'synthetic-bi-weekly.xlsx');
}
const secondDateRow = row({ ffsDate: '', dates: { webReadinessDate: preciseDate('2026-11-27') } });
const independentlyUpdated = importer.applyPlan(datedAll, planFor([secondDateRow], datedAll, { metadata: { fingerprint: 'independent-web-source', reportDate: '2026-10-22' } }), { now: '2026-10-23T16:00:00.000Z' }).portfolio;
assert.equal(importer.getFieldAge(product(independentlyUpdated), 'webReadinessDate', '2026-10-30').changeAgeDays, 7);
assert.equal(importer.getFieldAge(product(independentlyUpdated), 'ffsDate', '2026-10-30').changeAgeDays, 21);
assert.equal(importer.getFieldAge(product(independentlyUpdated), 'ffsDate', '2026-10-30').observedAgeDays, 21, 'A blank FFS in the new file preserves its independently aging observation.');
assert.equal(importer.getFieldAge(product(independentlyUpdated), 'finalAssetsDate', '2026-10-30').observedAgeDays, 21, 'An absent field cannot borrow another milestone\'s newer clock.');
assert.equal(importer.getFieldAge(product(datedAll), 'ffsDate', '2026-10-30', { accepted: { value: '2026-11-06', at: firstAt } }).acceptedAt, '', 'An accepted timestamp is valid only for the corresponding current date.');
const legacyAge = importer.getFieldAge(product(initial), 'ffsDate', '2026-10-30');
assert.equal(legacyAge.populated, true); assert.equal(legacyAge.changeAgeDays, null); assert.equal(legacyAge.observedAgeDays, null, 'An existing legacy date must not receive an invented timestamp.');
assert.equal(importer.getFieldAge(product(initial), 'webReadinessDate', '2026-10-30').populated, false);

const localClocks = savedReload(datedAll), dateSnapshot = importer.snapshotDateValues(localClocks);
const unchangedSnapshot = importer.recordDateChanges(dateSnapshot, localClocks, { now: '2026-10-10T16:00:00.000Z' });
assert.deepEqual(unchangedSnapshot, dateSnapshot); assert.equal(localClocks.dateLocalEdits, undefined, 'Rendering or saving unchanged data cannot start new aging clocks.');
product(localClocks).ffsDate = '2026-11-07';
const afterManualChange = importer.recordDateChanges(dateSnapshot, localClocks, { now: '2026-10-11T16:00:00.000Z' });
assert.deepEqual(Object.keys(localClocks.dateLocalEdits['fixture-one']), ['ffsDate']);
assert.equal(product(localClocks).plc.fields.ffsDate.supersededAt, '2026-10-11T16:00:00.000Z');
assert.equal(product(localClocks).plc.fields.webReadinessDate.supersededAt, undefined);
product(localClocks).ffsDate = allDates.ffsDate;
importer.recordDateChanges(afterManualChange, localClocks, { now: '2026-10-12T16:00:00.000Z' });
const localFfs = importer.getFieldAge(product(localClocks), 'ffsDate', '2026-10-30', { local: localClocks.dateLocalEdits['fixture-one'].ffsDate, accepted: { value: allDates.ffsDate, at: firstAt } });
assert.equal(localFfs.changedAt, '2026-10-12T16:00:00.000Z'); assert.equal(localFfs.changeAgeDays, 18);
assert.equal(localFfs.sourceFile, '', 'Editing away and back cannot revive the old source observation merely because its value matches again.');
assert.equal(localFfs.sourceAgeDays, null);
assert.equal(fieldDecision(planFor([row({ ffsDate: '2026-11-21' })], localClocks, { metadata: { reportDate: '2026-10-22', fingerprint: 'after-away-back' } })).status, 'review', 'A changed-and-restored manual date still requires review before a later import overwrites it.');
const freshPlcMutation = savedReload(datedAll), beforeFreshPlc = importer.snapshotDateValues(freshPlcMutation);
product(freshPlcMutation).ffsDate = '2026-11-09';
importer.recordDateChanges(beforeFreshPlc, freshPlcMutation, { now: '2026-10-23T16:00:00.000Z', source: 'plc' });
assert.equal(freshPlcMutation.dateLocalEdits['fixture-one'].ffsDate.source, 'plc');
assert.equal(product(freshPlcMutation).plc.fields.ffsDate.supersededAt, undefined, 'A recorded PLC mutation must not mark its own source as superseded.');

const fullSource = dataset([partialRow], { fileName: 'synthetic-full-source.xlsx', fingerprint: 'full-supporting-source', reportDate: '2026-10-08' });
fullSource.supportingRows = [{ key: 'unmatched-support', name: 'Project absent from PPC', codename: 'Unmatched supporting project',
  milestones: { targetFfs: preciseDate('Q2 2027', 'K12') }, data: { forecast: '12K', owner: 'Synthetic owner' }, sources: [{ sheet: 'Supporting planning', cell: 'K12' }] },
  { key: 'another-support', name: 'Another supporting project', milestones: { shipment: preciseDate('2026-12-15', 'J9') }, data: { cost: 'Synthetic cost observation' } }];
fullSource.rows[0].observations = [copy(fullSource.supportingRows[0])];
const fullCollected = importer.applyPlan(initial, importer.buildPlan(fullSource, initial), { now: firstAt }).portfolio;
assert.deepEqual(fullCollected.plcCollection.supportingRows, fullSource.supportingRows, 'The source snapshot retains all typed supporting evidence even when its products are absent from PPC.');
assert.equal(fullCollected.plcCollection.primaryRows[0].observations, undefined, 'Attached observations are stored once in the complete supporting snapshot.');
assert.equal(fullCollected.plcCollection.primaryRows[0].dates.generalAvailabilityDate.kind, 'quarter');
assert.deepEqual(fullCollected.plcCollection.metadata, fullSource.metadata);
assert.deepEqual(savedReload(fullCollected).plcCollection, fullCollected.plcCollection, 'Source precision, references, and unmatched supporting notes survive storage reload.');
const fullReview = importer.buildReviewPlan(savedReload(fullCollected));
const fullReviewed = importer.applyPlan(fullCollected, fullReview, { now: '2026-10-23T16:00:00.000Z', resolutions: { 'fixture-row-1': { generalAvailabilityDate: '2027-02-05' } } }).portfolio;
assert.deepEqual(fullReviewed.plcCollection, fullCollected.plcCollection, 'A later decision preserves the original raw workbook snapshot.');
const fullRepeated = importer.applyPlan(fullReviewed, importer.buildPlan(fullSource, fullReviewed), { now: '2026-10-24T16:00:00.000Z' }).portfolio;
assert.deepEqual(fullRepeated.plcCollection, fullCollected.plcCollection, 'Duplicate bytes retain the snapshot\'s original import timestamp.');
const oldSupportSource = dataset([partialRow], { fingerprint: 'older-supporting-source', reportDate: '2026-09-24' });
oldSupportSource.supportingRows = [{ name: 'Older supporting observation', data: { forecast: 'Obsolete forecast' } }];
const oldSupportApplied = importer.applyPlan(fullRepeated, importer.buildPlan(oldSupportSource, fullRepeated, { reportDate: '2026-10-30', reportDateBasis: 'Import date' }), { now: '2026-10-30T16:00:00.000Z' }).portfolio;
assert.deepEqual(oldSupportApplied.plcCollection, fullCollected.plcCollection, 'A later upload cannot replace the current complete snapshot with an older report.');
const oversizedSource = dataset([], { fingerprint: 'oversized-supporting-source', reportDate: '2026-10-22' });
oversizedSource.supportingRows = Array.from({ length: 100 }, (_, index) => ({ name: `Synthetic supporting project ${index}`, data: { note: 'x'.repeat(31000) } }));
const beforeOversize = copy(fullRepeated);
assert.throws(() => importer.applyPlan(fullRepeated, importer.buildPlan(oversizedSource, fullRepeated), { now: '2026-10-23T16:00:00.000Z' }), /collected source evidence is too large/i);
assert.deepEqual(fullRepeated, beforeOversize, 'An oversized supporting snapshot cannot partially replace existing product evidence or the retained collection.');

console.log('PLC import checks passed: strict dates and Excel calendars, source-byte fingerprints, section and merged-cell provenance, stable identity/SKU matching, product ambiguity, partial updates, stale and manual conflicts, unchanged confirmation, report collisions, immutable previews, persisted review queues and complete supporting snapshots, duplicate/superseding sources, independent field aging, genuine local edits and changed-back source protection, and encrypted/shared-master round trips.');
