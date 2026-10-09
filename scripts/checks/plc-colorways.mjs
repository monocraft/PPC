import assert from 'node:assert/strict';
await import('../../public/js/ascm-import.js');
await import('../../public/js/portfolio-model.js');
await import('../../public/js/master-model.js');
await import('../../public/js/package-codec.js');
await import('../../public/js/plc-import.js');

const importer = globalThis.PLCImporter, model = globalThis.PortfolioMasterModel;
const firstAt = '2026-10-09T16:00:00.000Z', secondAt = '2026-10-23T16:00:00.000Z';
const seed = { version: 4, categories: [{ id: 'microphones', name: 'Microphones', board: { lanes: [{ id: 'usb' }], products: [{
  id: 'synthetic-cast', name: 'Synthetic QuadCast 2 S', codename: 'Aster', laneId: 'usb', ffsDate: '2026-08-14', generalAvailabilityDate: '2026-09-01',
  roadmap: { startMonth: '2026-09', endMonth: '2029-12' }, specs: [],
  partSkus: [{ id: 'existing-hp', code: 'SYNTHETIC-HP-BK', variantId: 'black', colorCode: 'BK' }],
  variantGroups: [{ id: 'colors', type: 'color', label: 'COLOR SKU', items: [{ id: 'black', code: 'BK', label: 'Black', colorKey: 'black', colorName: 'Black', colorHex: '#000000', colorKey2: '', colorName2: '', colorHex2: '' }] }],
}] } }] };
const product = (portfolio) => portfolio.categories[0].board.products[0];
function row(color, date, extra = {}) {
  return { key: `synthetic-${color.toLowerCase()}`, name: `"Aster ${color}" Synthetic QuadCast 2 S Colorway Microphone`, codename: `Aster ${color}`, marketingName: 'Synthetic QuadCast 2 S Colorway Microphone', categoryId: 'microphones', section: 'Colorway', reportDate: '2026-10-08', dates: { ffsDate: { ...importer.parseDate(date, { quarterBasis: 'calendar' }), source: { sheet: 'Synthetic current', cell: 'F4', authoritativeCurrentFfs: true } } }, sources: [], ...extra };
}
const dataset = (rows, reportDate = '2026-10-08', fingerprint = 'synthetic-color-one') => ({ metadata: { fileName: 'Synthetic colors.xlsx', reportDate, fingerprint, reportDateBasis: 'Explicit workbook report date' }, rows: rows.map((entry) => ({ ...entry, reportDate })), diagnostics: [] });
const source = dataset([row('Black', '2026-11-05'), row('White', 'Q2 2028')]);
const assignments = { 'synthetic-black': { productId: 'synthetic-cast', variantId: 'black' }, 'synthetic-white': { productId: 'synthetic-cast', create: true, colorCode: 'WHT', colorName: 'White', colorHex: '#ffffff' } };
const before = structuredClone(seed), initial = importer.buildPlan(source, seed, { reportDate: '2026-10-09', reportDateBasis: 'Import date' });
assert.deepEqual(seed, before, 'suggesting a colorway cannot change product data');
assert(initial.items.every((item) => item.variantBindingNeeded && item.action === 'review'), 'first colorway associations require reviewed color choices');
assert(initial.items.every((item) => item.matchedProductId === 'synthetic-cast'), 'explicit color suffixes suggest the same compatible parent hardware');
assert.throws(() => importer.applyPlan(seed, initial, { now: firstAt, resolutions: { 'synthetic-white': { ffsDate: '2028-04-01' } } }), /color option/, 'an exact date cannot bypass color scope review');
const held = importer.applyPlan(seed, initial, { now: firstAt });
assert.equal(product(held.portfolio).ffsDate, before.categories[0].board.products[0].ffsDate);
assert.equal(held.portfolio.plcReview.entries.length, 2);
const preview = importer.buildPlan(source, seed, { variantAssignments: assignments });
assert.deepEqual(seed, before, 'previewing a new color leaves the portfolio unchanged');
assert(preview.items.every((item) => item.fields[0].status === 'update'), 'distinct colors no longer collide as one product-wide date');
assert(preview.items.every((item) => item.fields[0].current === ''), 'color milestones do not inherit a parent-wide date');
const collected = importer.applyPlan(seed, preview, { now: firstAt, variantAssignments: assignments });
const parent = product(collected.portfolio), whiteId = collected.variantChanges.find((item) => item.sourceKey === 'synthetic-white').variantId;
assert.equal(collected.summary.colorwaysCreated, 1);
assert.equal(collected.portfolio.categories[0].board.products.length, 1, 'two colors remain one portfolio product');
assert.equal(parent.variantGroups[0].items.length, 2);
assert.deepEqual(parent.partSkus, before.categories[0].board.products[0].partSkus, 'existing HP numbers and explicit color links survive; no number is invented');
assert.equal(parent.ffsDate, '2026-08-14', 'color dates never overwrite the parent FFS');
assert.equal(parent.generalAvailabilityDate, '2026-09-01');
assert.deepEqual(parent.roadmap, before.categories[0].board.products[0].roadmap);
assert.equal(importer.getVariantProject(parent, 'black').fields.ffsDate.value, '2026-11-05');
assert.equal(importer.getVariantProject(parent, whiteId).fields.ffsDate.value, '2028-04-01');
assert.equal(importer.getVariantFieldAge(parent, whiteId, 'ffsDate', '2026-10-23').displayValue, 'Q2 2028');
assert.equal(importer.getVariantFieldAge(parent, whiteId, 'ffsDate', '2026-10-23').changeAgeDays, 14);
assert.equal(importer.getVariantProject(parent, whiteId).createdFromSource.key, 'synthetic-white');
assert.equal(importer.getVariantProject(parent, whiteId).codename, 'Aster White');
assert.deepEqual(importer.getVariantProject(parent, whiteId).colorway, { code: 'WHT', colorKey: 'white', colorName: 'White', colorHex: '#ffffff', colorKey2: '', colorName2: '', colorHex2: '' }, 'the reviewed project records its approved canonical color separately from the editable variant row');
assert(parent.plc.identities.every((identity) => identity.variantId && identity.confirmed), 'source identities remember the parent and exact color scope');
assert(parent.plc.history.every((event) => event.variantId && event.variantName), 'color-specific changes are identifiable in product history');
assert(collected.portfolio.plcImports[0].rows.every((entry) => entry.variantId && entry.variantName), 'import receipts preserve color scope');
const repeated = importer.applyPlan(collected.portfolio, importer.buildPlan(source, collected.portfolio), { now: secondAt });
assert(repeated.summary.duplicate);
assert.deepEqual(repeated.portfolio, collected.portfolio, 'identical re-imports preserve clocks, dates, and color rows exactly');
const remembered = importer.buildPlan(dataset([row('White', 'Q3 2028')], '2026-10-22', 'synthetic-color-two'), collected.portfolio);
assert.equal(remembered.items[0].matchedVariantId, whiteId, 'later files reuse the reviewed source-to-color relationship');
assert.equal(remembered.items[0].fields[0].displayCurrent, 'Q2 2028');
const advanced = importer.applyPlan(collected.portfolio, remembered, { now: secondAt });
assert.equal(importer.getVariantFieldAge(product(advanced.portfolio), whiteId, 'ffsDate').displayValue, 'Q3 2028');
assert.equal(importer.getVariantFieldAge(product(advanced.portfolio), whiteId, 'ffsDate').changedAt, secondAt);
assert.equal(importer.getVariantFieldAge(product(advanced.portfolio), 'black', 'ffsDate').changedAt, firstAt);
assert.equal(product(advanced.portfolio).ffsDate, '2026-08-14');
const rebasedColor = structuredClone(collected.portfolio);
product(rebasedColor).variantGroups[0].items.find((item) => item.id === whiteId).colorHex = '#f5f5f5';
const rememberedAfterColorChange = importer.buildPlan(remembered.dataset, rebasedColor);
const unreviewedColor = importer.applyPlan(rebasedColor, rememberedAfterColorChange, { now: secondAt });
assert.equal(importer.getVariantProject(product(unreviewedColor.portfolio), whiteId).colorway.colorHex, '#ffffff', 'a remembered import cannot silently approve an edited or rebased color identity');
const approvedRebinding = importer.applyPlan(unreviewedColor.portfolio, importer.buildPlan(remembered.dataset, unreviewedColor.portfolio, { variantAssignments: { 'synthetic-white': { productId: 'synthetic-cast', variantId: whiteId } } }), { now: '2026-10-24T16:00:00.000Z', variantAssignments: { 'synthetic-white': { productId: 'synthetic-cast', variantId: whiteId } } });
assert.equal(importer.getVariantProject(product(approvedRebinding.portfolio), whiteId).colorway.colorHex, '#f5f5f5', 'an explicit reviewed rebinding captures the newly approved color identity');
assert.deepEqual(importer.getVariantProject(product(approvedRebinding.portfolio), whiteId).fields, importer.getVariantProject(product(unreviewedColor.portfolio), whiteId).fields, 'identity-only approval preserves date values, precision, and all milestone clocks');
const stale = importer.buildPlan(source, advanced.portfolio);
assert.equal(stale.items.find((item) => item.matchedVariantId === whiteId).fields[0].status, 'stale');
assert.throws(() => importer.applyPlan(advanced.portfolio, stale, { resolutions: { 'synthetic-white': { ffsDate: '2028-04-01' } } }), /Older reports/);

const six = Object.fromEntries(Object.keys(importer.fieldLabels).map((field, index) => [field, { ...importer.parseDate(`2029-${String(index + 1).padStart(2, '0')}-05`), source: { authoritativeCurrentFfs: true } }]));
six.generalAvailabilityDate.value = '2029-02-05'; six.endManufacturingDate.value = '2029-12-05';
const allSix = importer.applyPlan(collected.portfolio, importer.buildPlan(dataset([row('White', '', { dates: six })], '2026-10-22', 'synthetic-six'), collected.portfolio), { now: secondAt });
for (const field of Object.keys(importer.fieldLabels)) { assert(importer.getVariantFieldAge(product(allSix.portfolio), whiteId, field).populated); assert.equal(importer.getVariantFieldAge(product(allSix.portfolio), whiteId, field).changedAt, secondAt); }
assert.equal(product(allSix.portfolio).generalAvailabilityDate, '2026-09-01', 'explicit variant GA does not alter the product-wide GA');
const blank = row('Silver', '');
const blankSource = dataset([blank], '2026-10-22', 'synthetic-blank-color');
const blankChoice = { [blank.key]: { productId: 'synthetic-cast', create: true, colorCode: 'SLV', colorName: 'Silver', colorHex: '#c0c0c0' } };
const blankResult = importer.applyPlan(seed, importer.buildPlan(blankSource, seed, { variantAssignments: blankChoice }), { now: firstAt, variantAssignments: blankChoice });
assert.equal(blankResult.variantChanges[0].created, true, 'a reviewed color can be created even when no dates exist yet');
assert.equal(importer.getVariantFieldAge(product(blankResult.portfolio), blankResult.variantChanges[0].variantId, 'ffsDate').value, '');
assert.equal(importer.getVariantProject(product(blankResult.portfolio), blankResult.variantChanges[0].variantId).colorway.code, 'SLV', 'identity-only color creation includes its approved color snapshot');

for (const name of ['Synthetic QuadCast 3 S White Microphone', 'Synthetic QuadCast 2 White Microphone', 'Synthetic QuadCast 2 S mini White Microphone', 'Synthetic QuadCast 2 S Wireless White Microphone']) {
  const incompatible = row('White', '2027-04-05', { name, marketingName: name });
  const target = structuredClone(seed); if (/Wireless/.test(name)) product(target).name += ' Wired';
  assert.throws(() => importer.buildPlan(dataset([incompatible]), target, { variantAssignments: { 'synthetic-white': assignments['synthetic-white'] } }), /Hardware|Wired|hardware/, 'color assignment cannot collapse differing generations, S editions, mini hardware, or connections');
}
const collisionRows = dataset([row('Black', '2027-01-05'), row('Black', '2027-02-05', { key: 'synthetic-black-second' })]);
const collisionChoices = { 'synthetic-black': assignments['synthetic-black'], 'synthetic-black-second': assignments['synthetic-black'] };
const collision = importer.buildPlan(collisionRows, seed, { variantAssignments: collisionChoices });
assert(collision.items.every((item) => item.fields[0].status === 'review'), 'two dates for the same color remain a conflict');
assert.throws(() => importer.applyPlan(seed, collision, { variantAssignments: collisionChoices, resolutions: { 'synthetic-black': { ffsDate: '2027-01-05' }, 'synthetic-black-second': { ffsDate: '2027-02-05' } } }), /different dates/);
const changed = structuredClone(seed); product(changed).ffsDate = '2026-08-15';
assert.throws(() => importer.applyPlan(changed, preview, { variantAssignments: assignments }), /changed since the preview/);
const removed = structuredClone(collected.portfolio); product(removed).variantGroups[0].items = product(removed).variantGroups[0].items.filter((item) => item.id !== whiteId);
assert(importer.buildPlan(source, removed).items.find((item) => item.key === 'synthetic-white').variantBindingNeeded, 'a deleted color cannot be resurrected from a remembered identity');
const dual = structuredClone(seed);
product(dual).variantGroups[0].items = [{ id: 'white-pink', code: 'WHT', colorName: 'White', colorHex: '#ffffff', colorKey: 'white', colorName2: 'Pink', colorHex2: '#ff00ff', colorKey2: 'pink' }];
const whiteOnly = dataset([row('White', '2027-04-05')]);
assert.throws(() => importer.buildPlan(whiteOnly, dual, { variantAssignments: { 'synthetic-white': { productId: 'synthetic-cast', variantId: 'white-pink' } } }), /secondary color/, 'a single white source cannot be mapped to a white/pink option that reuses the WHT code');
const whiteSingle = importer.applyPlan(dual, importer.buildPlan(whiteOnly, dual, { variantAssignments: { 'synthetic-white': assignments['synthetic-white'] } }), { now: firstAt, variantAssignments: { 'synthetic-white': assignments['synthetic-white'] } });
assert.equal(product(whiteSingle.portfolio).variantGroups[0].items.length, 2, 'a distinct single color can be added while retaining a dual option with the same code');
assert.notEqual(whiteSingle.variantChanges[0].variantId, 'white-pink');
assert.equal(product(whiteSingle.portfolio).variantGroups[0].items[0].colorName2, 'Pink', 'adding a single color never rewrites an existing dual color');
model.snapshot(whiteSingle.portfolio);
const editedColors = structuredClone(collected.portfolio);
const altered = product(editedColors).variantGroups[0].items.find((item) => item.id === whiteId); altered.colorName2 = 'Pink'; altered.colorHex2 = '#ff00ff'; altered.colorKey2 = 'pink';
assert(importer.buildPlan(source, editedColors).items.find((item) => item.key === 'synthetic-white').variantBindingNeeded, 'a remembered binding is held when its secondary color changes');
const separateRow = row('White', '2027-04-05', { name: '"Aster White" Synthetic QuadCast 3 S White Microphone', marketingName: 'Synthetic QuadCast 3 S White Microphone' });
const separateSource = dataset([separateRow]);
const separateChoice = { 'synthetic-white': { name: separateRow.marketingName, codename: separateRow.codename, categoryId: 'microphones' } };
assert.throws(() => importer.buildPlan(separateSource, seed, { createProducts: separateChoice }), /different hardware/, 'a color source cannot create a duplicate product without explicit separate-hardware review');
separateChoice['synthetic-white'].separateProduct = true;
const separate = importer.applyPlan(seed, importer.buildPlan(separateSource, seed, { createProducts: separateChoice }), { now: firstAt, createProducts: separateChoice });
assert.equal(separate.portfolio.categories[0].board.products.length, 2);
const separateProduct = separate.portfolio.categories[0].board.products[1];
assert.equal(separateProduct.ffsDate, '2027-04-05', 'a deliberately separate generation keeps its product-wide milestones');
assert.equal(separateProduct.plc.createdFromSource.separateProduct, true);
assert.equal(importer.buildPlan(separateSource, separate.portfolio).items[0].variantBindingNeeded, false);

const snapshot = model.snapshot(collected.portfolio);
const shared = model.applyProductValues(parent, snapshot.products[0].values);
assert.deepEqual(shared.plc.variantProjects, parent.plc.variantProjects, 'color clocks and quarter metadata survive the existing shared-master schema');
const codec = globalThis.PortfolioPackage, key = codec.generateKey();
const zip = codec.createZip([{ name: 'portfolio.json', data: new TextEncoder().encode(JSON.stringify(collected.portfolio)) }]);
const decrypted = JSON.parse(new TextDecoder().decode(codec.readZip(await codec.decrypt(await codec.encrypt(zip, key), key)).get('portfolio.json')));
assert.deepEqual(product(decrypted).plc.variantProjects, parent.plc.variantProjects, 'encrypted package round-trip retains scoped color milestones');
console.log('PLC colorway checks passed: one parent with reviewed colors, independent six-field dates and quarter clocks, remembered binding, immutable previews, retained HP assignments, collision/hardware/stale guards, duplicate re-imports, and shared/encrypted round trips.');
