import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../../public/js/master-model.js';
import '../../public/js/product-merge.js';
import '../../public/js/package-codec.js';
import '../../public/js/date-precision.js';

const model = globalThis.PortfolioMasterModel, merge = globalThis.PortfolioProductMerge, codec = globalThis.PortfolioPackage;
const copy = (value) => structuredClone(value), plain = (value) => JSON.parse(JSON.stringify(value));
const dates = (manifest, id = 'one') => plain(model.dateEditsForProduct(manifest, id));
const product = (manifest, id = 'one') => manifest.categories[0].board.products.find((item) => item.id === id);
const seed = { version: 4, categories: [{ id: 'audio', board: { lanes: [{ id: 'wired' }], products: [
  { id: 'one', laneId: 'wired', name: 'Headset', generalAvailabilityDate: '2027-01-20', endManufacturingDate: '2030-09-30', roadmap: { startMonth: '2027-01', endMonth: '2030-09' }, specs: [], partSkus: [], variantGroups: [] },
  { id: 'other', laneId: 'wired', name: 'Other headset', ffsDate: '2026-12-01', specs: [], partSkus: [], variantGroups: [] },
] } }] };
function change(manifest, patch, id = 'one') {
  const base = model.snapshot(manifest).products.find((item) => item.productId === id);
  return { productId: id, base: base.values, baseRevisions: base.revisions, patch };
}
function save(manifest, patch, at, actor = 'Planner', id = 'one') {
  return model.mergeChanges(manifest, [change(manifest, patch, id)], { now: at, actor });
}
const firstAt = '2026-10-08T01:00:00.000Z', secondAt = '2026-10-09T01:00:00.000Z';
assert.deepEqual(dates(seed), {}, 'Original/import dates do not invent an edit timestamp.');
const original = copy(seed);
const first = save(seed, { ffsDate: '2026-12-04', generalAvailabilityDate: '2027-01-21' }, firstAt);
assert.equal(first.conflicts.length, 0); assert.deepEqual(seed, original);
assert.deepEqual(dates(first.manifest), {
  generalAvailabilityDate: { at: firstAt, actor: 'Planner', value: '2027-01-21' },
  ffsDate: { at: firstAt, actor: 'Planner', value: '2026-12-04' },
});
assert.deepEqual(first.manifest.masterSync.products.one.dateEdits, model.dateEditsForProduct(first.manifest, 'one'));
assert.deepEqual(dates(first.manifest, 'other'), {});

const independent = model.mergeChanges(first.manifest, [change(seed, { endManufacturingDate: '2030-10-01' })], { now: secondAt, actor: 'Operations' });
assert.equal(independent.conflicts.length, 0, 'Concurrent edits to different date fields merge normally.');
assert.deepEqual(dates(independent.manifest).ffsDate, dates(first.manifest).ffsDate);
assert.deepEqual(dates(independent.manifest).generalAvailabilityDate, dates(first.manifest).generalAvailabilityDate);
assert.deepEqual(dates(independent.manifest).endManufacturingDate, { at: secondAt, actor: 'Operations', value: '2030-10-01' });
const conflict = model.mergeChanges(independent.manifest, [change(seed, { generalAvailabilityDate: '2027-03-01' })], { now: '2026-10-10T01:00:00.000Z', actor: 'Rejected editor' });
assert(conflict.conflicts.length > 0); assert.equal(conflict.manifest, independent.manifest);
assert.deepEqual(dates(conflict.manifest), dates(independent.manifest), 'A conflict never starts any date clock.');
const noop = save(independent.manifest, { ffsDate: '2026-12-04' }, '2026-10-10T02:00:00.000Z', 'No-op editor');
assert.equal(noop.savedFields, 0); assert.equal(noop.manifest, independent.manifest);
assert.deepEqual(dates(noop.manifest), dates(independent.manifest));
const nonDate = save(independent.manifest, { codename: 'Changed only name' }, '2026-10-10T03:00:00.000Z');
assert.deepEqual(dates(nonDate.manifest), dates(independent.manifest), 'Other facts preserve all date clocks.');
const cleared = save(nonDate.manifest, { ffsDate: 'TBD' }, '2026-10-10T04:00:00.000Z', 'Date owner');
assert.deepEqual(dates(cleared.manifest).ffsDate, { at: '2026-10-10T04:00:00.000Z', actor: 'Date owner', value: '' }, 'Clearing a set date to TBD is a genuine edit.');

const legacy = copy(independent.manifest); delete legacy.masterSync.products.one.dateEdits;
assert.deepEqual(dates(legacy), dates(independent.manifest), 'Older accepted date history recovers the same clocks.');
legacy.masterSync.revision += 1;
legacy.masterSync.history.push({ productId: 'one', path: '@launch', revision: legacy.masterSync.revision, at: '2026-10-11T00:00:00.000Z', before: { generalAvailabilityDate: '2027-01-21', startMonth: '2027-01' }, after: { generalAvailabilityDate: '2027-01-21', startMonth: '2027-02' }, beforeExists: true, afterExists: true, actor: 'Only month' });
assert.deepEqual(dates(legacy).generalAvailabilityDate, dates(first.manifest).generalAvailabilityDate, 'A changed planned month without an exact-date change does not age the exact date.');
const legacyBefore = copy(legacy);
dates(legacy); assert.deepEqual(legacy, legacyBefore, 'Metadata reads remain immutable.');
const backfilled = save(legacy, { codename: 'Backfill old dates' }, '2026-10-12T00:00:00.000Z').manifest;
backfilled.masterSync.history = [];
assert.deepEqual(dates(backfilled), dates(independent.manifest), 'A normal later save preserves recovered clocks independently of bounded history.');
const importedChanged = copy(backfilled); product(importedChanged).ffsDate = '2026-12-20';
assert.equal(dates(importedChanged).ffsDate, undefined, 'A mismatched imported value cannot inherit a stale clock.');

const future = { productId: 'one', path: 'ffsDate', revision: legacy.masterSync.revision + 1, at: '2026-10-13T00:00:00.000Z', before: '', after: '2026-12-04', beforeExists: true, afterExists: true, actor: 'Bad actor' };
const badHistory = copy(legacy);
badHistory.masterSync.history.push(...[
  future, { ...future, revision: 1, at: '2026-02-30T00:00:00.000Z' },
  { ...future, revision: 1, at: 'invalid' }, { ...future, revision: 1, valueTruncated: true },
  { ...future, revision: 1, accepted: false }, { ...future, revision: 1, status: 'rejected' },
  { ...future, revision: 1, kind: 'noop' }, { ...future, revision: 1, after: '2026-02-30' },
  { ...future, revision: 1, before: '2026-12-04' }, { ...future, revision: 1, productId: '__proto__' },
]);
assert.deepEqual(dates(badHistory), dates(independent.manifest), 'Invalid, future-revision, truncated, rejected and no-op audit records are ignored.');
const unknowableLatest = copy(legacy);
unknowableLatest.masterSync.history.push({ ...future, revision: ++unknowableLatest.masterSync.revision, valueTruncated: true, before: 'Truncated earlier facts', after: 'Truncated changed facts' });
assert.equal(dates(unknowableLatest).ffsDate, undefined, 'A newer truncated date operation cannot falsely attribute an earlier retained edit to the current date.');
const malformed = copy(backfilled);
malformed.masterSync.products.one.dateEdits = { ffsDate: { at: 'bad', actor: {}, value: '2026-12-04' }, constructor: { at: firstAt, actor: 'Bad', value: '2026-12-04' }, otherDate: { at: firstAt, actor: 'Bad', value: '2026-12-04' } };
assert.deepEqual(dates(malformed), {}); assert.deepEqual(dates(malformed, '__proto__'), {}); assert.deepEqual(dates(malformed, 'missing'), {});
const minimal = { categories: [{ board: { products: [{ id: 'one', ...model.snapshot(independent.manifest).products[0].values, specs: 'not needed by this read' }] } }], masterSync: independent.manifest.masterSync };
assert.deepEqual(dates(minimal), dates(independent.manifest), 'Tooltip lookup needs only accepted date fields, not full roadmap/spec normalization.');

const created = model.mergeChanges(seed, [{ kind: 'create', productId: 'new', categoryId: 'audio', laneId: 'wired', mine: model.productValues({ name: 'Imported new product', generalAvailabilityDate: '2027-04-01', finalAssetsDate: '2027-03-15' }) }], { now: firstAt, actor: 'Importer', requestId: 'imported-new' });
assert.equal(created.conflicts.length, 0);
assert.deepEqual(dates(created.manifest, 'new'), {
  generalAvailabilityDate: { at: firstAt, actor: 'Importer', value: '2027-04-01' },
  finalAssetsDate: { at: firstAt, actor: 'Importer', value: '2027-03-15' },
});
assert.equal(dates(created.manifest, 'new').ffsDate, undefined, 'Blank dates on new records have no edit clock.');
const legacyCreated = copy(created.manifest); delete legacyCreated.masterSync.products.new.dateEdits;
assert.deepEqual(dates(legacyCreated, 'new'), dates(created.manifest, 'new'), 'Legacy @product creation recovers nonempty initial dates only.');

const mergeManifest = copy(first.manifest), kept = product(mergeManifest), donor = product(mergeManifest, 'other');
donor.finalAssetsDate = '2026-12-10';
const baseline = model.snapshot(mergeManifest).products, planned = merge.plan(kept, donor), choices = Object.fromEntries(planned.conflicts.map((item) => [item.key, 'keeper']));
const keeperBase = baseline.find((item) => item.productId === 'one'), sourceBase = baseline.find((item) => item.productId === 'other');
const consolidated = model.mergeChanges(mergeManifest, [{ kind: 'merge', productId: 'one', sourceProductId: 'other', categoryId: 'audio', laneId: 'wired', sourceCategoryId: 'audio', sourceLaneId: 'wired', choices,
  base: keeperBase, sourceBase, baseProductVersion: keeperBase.productVersion, sourceBaseProductVersion: sourceBase.productVersion, mine: model.productValues(merge.resolve(planned, choices)) }], { now: secondAt, actor: 'Consolidator', requestId: 'merge-dates' });
assert.equal(consolidated.conflicts.length, 0);
assert.deepEqual(dates(consolidated.manifest).ffsDate, dates(first.manifest).ffsDate);
assert.deepEqual(dates(consolidated.manifest).generalAvailabilityDate, dates(first.manifest).generalAvailabilityDate);
assert.deepEqual(dates(consolidated.manifest).finalAssetsDate, { at: secondAt, actor: 'Consolidator', value: '2026-12-10' }, 'Filling a keeper date during accepted consolidation starts only that clock.');
const legacyConsolidated = copy(consolidated.manifest); delete legacyConsolidated.masterSync.products.one.dateEdits;
assert.deepEqual(dates(legacyConsolidated), dates(consolidated.manifest), 'Legacy @product consolidation changes and exact diffs recover the same clocks.');

const pruned = copy(independent.manifest);
for (let index = 0; index < 1100; index++) pruned.masterSync.history.push({ productId: 'other', path: 'codename', before: 'a', after: 'b', beforeExists: true, afterExists: true, revision: ++pruned.masterSync.revision, at: secondAt, actor: 'Other editor' });
const afterPruning = save(pruned, { name: 'Name after pruning' }, '2026-10-15T00:00:00.000Z').manifest;
assert(afterPruning.masterSync.history.length <= 1000);
assert(!afterPruning.masterSync.history.some((entry) => entry.path === 'ffsDate'));
assert.deepEqual(dates(afterPruning), dates(independent.manifest), 'History pruning never expires durable date clocks.');
const key = codec.generateKey(), encoder = new TextEncoder(), decoder = new TextDecoder();
const packageBytes = await codec.encrypt(codec.createZip([{ name: 'portfolio.json', data: encoder.encode(JSON.stringify(afterPruning)) }]), key);
assert(!Buffer.from(packageBytes).includes(Buffer.from('Planner')));
const unpacked = JSON.parse(decoder.decode(codec.readZip(await codec.decrypt(packageBytes, key)).get('portfolio.json')));
assert.deepEqual(dates(unpacked), dates(independent.manifest), 'Date clocks survive an encrypted package round trip.');
const detached = model.dateEditsForProduct(unpacked, 'one'); detached.ffsDate.actor = 'Mutated returned data';
assert.equal(dates(unpacked).ffsDate.actor, 'Planner');

// Exercise the actual editor binding. Native date controls emit intermediate
// change events while a year segment is being typed; assigning .value in those
// events resets the selected segment in Chromium-based browsers.
const appSource = fs.readFileSync(new URL('../../public/js/app.js', import.meta.url), 'utf8');
const bindingStart = appSource.indexOf('  const bindProductDate = (inputSelector, tbdButtonSelector, fieldName) => {');
const bindingEnd = appSource.indexOf('\n  bindProductDate("#fieldFfsDate"', bindingStart);
assert(bindingStart >= 0 && bindingEnd > bindingStart, 'The real product date binding is available to verify.');
const normalizeDate = /function normalizeProductInfoDate\(value\) \{[\s\S]*?\n\}/.exec(appSource)?.[0];
assert(normalizeDate, 'Use the same exact-date normalization as the editor.');
function editorElement(initial = '') {
  let value = initial;
  const attributes = new Map(), classes = new Set(), listeners = new Map();
  return {
    assignments: 0, focused: false, validity: { valid: true }, textContent: '',
    get value() { return value; },
    set value(next) { value = String(next); this.assignments += 1; },
    userValue(next) { value = String(next); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, next) { attributes.set(name, String(next)); },
    removeAttribute(name) { attributes.delete(name); },
    classList: { toggle(name, force) { if (force) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); } },
    addEventListener(name, handler) { const handlers = listeners.get(name) || []; handlers.push(handler); listeners.set(name, handlers); },
    focus() { this.focused = true; },
    fire(name, options = {}) {
      const event = { key: '', altKey: false, ctrlKey: false, metaKey: false, prevented: false,
        preventDefault() { this.prevented = true; }, ...options };
      for (const handler of listeners.get(name) || []) handler(event);
      return event;
    },
  };
}
function dateEditor() {
  let manifest = save(copy(seed), { ffsDate: '2027-03-15' }, firstAt).manifest;
  const writes = [], fields = new Map(), feedback = editorElement();
  const elements = new Map([['#productDateFeedback', feedback]]);
  const context = vm.createContext({
    product: product(manifest), $: (selector) => elements.get(selector),
    selectedProduct: () => product(manifest), PortfolioDatePrecision: globalThis.PortfolioDatePrecision,
    updateProductMilestone(id, field, value, period = null) {
      const result = model.mergeChanges(manifest, [change(manifest, { [field]: value }, id)], { now: secondAt, actor: 'Date editor' });
      assert.equal(result.conflicts.length, 0);
      manifest = result.manifest;
      // Retain precision evidence exactly as the UI expects when changing modes.
      if (period) {
        const current = product(manifest);
        current.plc ??= { version: 1 }; current.plc.fields ??= {};
        current.plc.fields[field] = { value, period: plain(period) };
      } else if (product(manifest).plc?.fields?.[field]) delete product(manifest).plc.fields[field];
      writes.push({ field, value, period: plain(period), savedFields: result.savedFields });
    },
  });
  vm.runInContext(`${normalizeDate}\n${appSource.slice(bindingStart, bindingEnd)}\nglobalThis.bindDate = bindProductDate;`, context);
  for (const [inputId, field] of [
    ['FfsDate', 'ffsDate'], ['GeneralAvailabilityDate', 'generalAvailabilityDate'],
    ['EndManufacturingDate', 'endManufacturingDate'], ['FinalAssetsDate', 'finalAssetsDate'],
  ]) {
    const selector = `#field${inputId}`;
    const controls = { input: editorElement(product(manifest)[field] || ''), tbd: editorElement(),
      precision: editorElement('exact'), quarter: editorElement() };
    elements.set(selector, controls.input); elements.set(`${selector}Tbd`, controls.tbd);
    elements.set(`${selector}Precision`, controls.precision); elements.set(`${selector}Quarter`, controls.quarter);
    fields.set(field, controls); context.bindDate(selector, `${selector}Tbd`, field);
  }
  return { fields, writes, feedback, current: () => product(manifest), clocks: () => dates(manifest) };
}
const typed = dateEditor(), ffs = typed.fields.get('ffsDate'), originalClock = typed.clocks().ffsDate;
assert.equal(ffs.input.min, '1900-01-01'); assert.equal(ffs.input.max, '9999-12-31');
for (const [key, intermediate] of [['2', '0002-04-01'], ['0', '0020-04-01'], ['2', '0202-04-01'], ['8', '2028-04-01']]) {
  ffs.input.fire('keydown', { key }); ffs.input.userValue(intermediate); ffs.input.fire('change');
  assert.equal(typed.writes.length, 0, 'Each intermediate year stays staged while typing.');
  assert.equal(ffs.input.assignments, 0, 'Year typing must not reset the native date segment.');
  assert.deepEqual(typed.clocks().ffsDate, originalClock, 'Intermediate years cannot change the saved clock.');
}
ffs.input.fire('blur');
assert.equal(typed.current().ffsDate, '2028-04-01'); assert.equal(typed.writes.length, 1);
assert.equal(ffs.input.assignments, 0, 'A complete typed date also keeps its native segment intact.');
assert.deepEqual(typed.clocks().ffsDate, { at: secondAt, actor: 'Date editor', value: '2028-04-01' });
ffs.input.fire('blur');
assert.equal(typed.writes.length, 1, 'A later untouched blur makes no additional update call.'); assert.equal(ffs.input.assignments, 0);
assert.deepEqual(typed.clocks().ffsDate, { at: secondAt, actor: 'Date editor', value: '2028-04-01' }, 'Repeated blur is a no-op for date aging.');

for (const [invalid, validity] of [
  ['1899-12-31', true], ['10000-01-01', true], ['2027-02-29', true], ['2028-02-30', true], ['', false],
]) {
  const invalidEditor = dateEditor(), control = invalidEditor.fields.get('ffsDate');
  control.input.fire('keydown', { key: 'Backspace' }); control.input.userValue(invalid); control.input.validity.valid = validity;
  control.input.fire('change'); control.input.fire('blur');
  assert.equal(invalidEditor.writes.length, 0, `Invalid exact date ${invalid || 'an incomplete native segment'} cannot be committed.`);
  assert.equal(invalidEditor.current().ffsDate, '2027-03-15');
  assert.equal(control.input.value, invalid, 'Invalid input remains available to correct.');
  assert.equal(control.input.assignments, 0, 'Validation must not force the native control back to the saved date.');
  assert.equal(control.input.getAttribute('aria-invalid'), 'true'); assert.match(invalidEditor.feedback.textContent, /four-digit year/i);
  assert.equal(invalidEditor.clocks().ffsDate.at, firstAt);
}
const enterEditor = dateEditor(), enterFfs = enterEditor.fields.get('ffsDate');
enterFfs.input.fire('keydown', { key: '2' }); enterFfs.input.userValue('2028-02-29'); enterFfs.input.fire('change');
assert(enterFfs.input.fire('keydown', { key: 'Enter' }).prevented);
assert.equal(enterEditor.writes.length, 1); assert.equal(enterEditor.current().ffsDate, '2028-02-29');
enterFfs.input.fire('blur'); assert.equal(enterEditor.writes.length, 1, 'Enter followed by blur commits once.');
assert.equal(enterFfs.input.assignments, 0);

const calendarEditor = dateEditor(), calendarFfs = calendarEditor.fields.get('ffsDate');
calendarFfs.input.fire('keydown', { key: '2' }); calendarFfs.input.userValue('0002-04-01'); calendarFfs.input.fire('change');
calendarFfs.input.fire('pointerdown'); calendarFfs.input.userValue('2028-05-20'); calendarFfs.input.fire('change');
assert.equal(calendarEditor.current().ffsDate, '2028-05-20', 'Opening the calendar after typing allows an immediate calendar selection.');
assert.equal(calendarEditor.writes.length, 1); assert.equal(calendarFfs.input.assignments, 0);
calendarFfs.input.fire('blur'); assert.equal(calendarEditor.writes.length, 1, 'Calendar selection followed by blur commits once.');
assert.equal(calendarEditor.clocks().ffsDate.at, secondAt);

for (const [field, invalid] of [['generalAvailabilityDate', '2031-01-01'], ['endManufacturingDate', '2026-01-01']]) {
  const rangeEditor = dateEditor(), control = rangeEditor.fields.get(field), before = rangeEditor.current()[field];
  control.input.fire('keydown', { key: '2' }); control.input.userValue(invalid); control.input.fire('change'); control.input.fire('blur');
  assert.equal(rangeEditor.writes.length, 0); assert.equal(rangeEditor.current()[field], before);
  assert.equal(control.input.value, invalid); assert.equal(control.input.assignments, 0);
  assert.equal(control.input.getAttribute('aria-invalid'), 'true'); assert.match(rangeEditor.feedback.textContent, /manufacturing.*general availability/i);
}
const quarterEditor = dateEditor(), quarterFfs = quarterEditor.fields.get('ffsDate');
quarterFfs.input.fire('keydown', { key: '2' }); quarterFfs.input.userValue('0002-04-01'); quarterFfs.input.fire('change');
quarterFfs.precision.userValue('quarter'); quarterFfs.precision.fire('change'); quarterFfs.input.validity.valid = false;
quarterFfs.quarter.userValue('Q2 2028'); quarterFfs.quarter.fire('change');
assert.equal(quarterEditor.current().ffsDate, '2028-04-01'); assert.equal(quarterEditor.writes.length, 1);
assert.equal(quarterEditor.writes[0].period.label, 'Q2 2028', 'The keyboard fix keeps quarter precision and its roadmap anchor.');
quarterFfs.quarter.userValue('Q2 1899'); quarterFfs.quarter.fire('change');
assert.equal(quarterEditor.writes.length, 1); assert.equal(quarterFfs.quarter.value, 'Q2 1899');
assert.equal(quarterFfs.quarter.getAttribute('aria-invalid'), 'true');
const savedQuarter = plain(quarterEditor.current().plc.fields.ffsDate), savedQuarterClock = quarterEditor.clocks().ffsDate;
quarterFfs.input.validity.valid = true;
quarterFfs.precision.userValue('exact'); quarterFfs.precision.fire('change');
assert.equal(quarterFfs.input.value, '', 'Replacing a quarter asks for a verified exact day.');
assert(quarterFfs.input.focused); quarterFfs.input.fire('blur');
assert.equal(quarterEditor.writes.length, 1, 'Focusing and leaving an empty exact field cannot erase the saved quarter.');
assert.equal(quarterEditor.current().ffsDate, '2028-04-01');
assert.deepEqual(plain(quarterEditor.current().plc.fields.ffsDate), savedQuarter);
assert.deepEqual(quarterEditor.clocks().ffsDate, savedQuarterClock);
quarterFfs.input.fire('keydown', { key: 'Enter' }); quarterFfs.input.fire('blur');
assert.equal(quarterEditor.writes.length, 1, 'Enter in an untouched empty exact field preserves the quarter.');
quarterFfs.input.fire('change');
assert.equal(quarterEditor.writes.length, 1, 'Even an empty native change cannot replace a saved quarter with TBD.');
assert.equal(quarterEditor.current().ffsDate, '2028-04-01');
assert.deepEqual(plain(quarterEditor.current().plc.fields.ffsDate), savedQuarter);
assert.deepEqual(quarterEditor.clocks().ffsDate, savedQuarterClock);
quarterFfs.input.fire('keydown', { key: '2' }); quarterFfs.input.userValue('2028-05-10'); quarterFfs.input.fire('change');
assert.equal(quarterEditor.writes.length, 1, 'A replacement exact day stages while typing.');
quarterFfs.input.fire('blur');
assert.equal(quarterEditor.writes.length, 2); assert.equal(quarterEditor.current().ffsDate, '2028-05-10');
assert.equal(quarterEditor.current().plc.fields.ffsDate, undefined, 'A verified exact replacement removes quarter evidence.');
assert.equal(quarterEditor.clocks().ffsDate.value, '2028-05-10');

const untouchedEditor = dateEditor(), untouchedFfs = untouchedEditor.fields.get('ffsDate');
untouchedFfs.input.focus(); untouchedFfs.input.fire('blur');
assert.equal(untouchedEditor.writes.length, 0, 'Simply focusing a saved exact date and leaving does not update it.');
assert.equal(untouchedFfs.input.assignments, 0); assert.equal(untouchedEditor.clocks().ffsDate.at, firstAt);

const independentEditor = dateEditor(), independentFfs = independentEditor.fields.get('ffsDate'), assets = independentEditor.fields.get('finalAssetsDate');
independentFfs.input.fire('keydown', { key: '2' }); independentFfs.input.userValue('0020-04-01'); independentFfs.input.fire('change');
assets.input.fire('pointerdown'); assets.input.userValue('2028-03-20'); assets.input.fire('change');
assert.equal(independentEditor.current().finalAssetsDate, '2028-03-20'); assert.equal(independentEditor.current().ffsDate, '2027-03-15');
assert.equal(independentEditor.clocks().ffsDate.at, firstAt); assert.equal(independentEditor.clocks().finalAssetsDate.at, secondAt);
independentFfs.tbd.fire('click'); assert.equal(independentEditor.current().ffsDate, ''); assert.equal(independentFfs.input.value, '');
independentFfs.input.fire('pointerdown'); independentFfs.input.userValue('2028-04-20'); independentFfs.input.fire('change');
assert.equal(independentEditor.current().ffsDate, '2028-04-20', 'Explicit TBD clears pending typing and a later calendar date can be selected.');
console.log('Date edit metadata checks passed: durable clocks, accepted saves, no-op/conflict stability, legacy recovery, package round trips, staged four-digit native year typing, correction-preserving validation, single calendar and Enter commits, empty exact-mode quarter protection, range protection and independent fields.');
