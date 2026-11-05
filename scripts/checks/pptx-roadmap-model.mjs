import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const context = vm.createContext({ console });
const source = await readFile(new URL('../../public/js/pptx-roadmap-model.js', import.meta.url), 'utf8').catch(error => {
  if (error.code === 'ENOENT') return '';
  throw error;
});
if (source) vm.runInContext(source, context, { timeout: 2000 });
assert.ok(context.PPTXRoadmapModel, 'The browser roadmap model must register before native export.');
const model = context.PPTXRoadmapModel;
const plain = value => JSON.parse(JSON.stringify(value));
const timeline = { startMonth: '2026-02', endMonth: '2026-08', showRoadmapMsrp: true };
const product = (id, startMonth, endMonth, extra = {}) => ({ id, name: `Product ${id}`, family: 'Family', startMonth, endMonth,
  fill: '#595959', textColor: '#FFFFFF', statusLabel: 'In development', priceLabel: '$99', dates: {}, ...extra });
const section = (products, extra = {}) => ({ id: 'alpha', name: 'Alpha', categoryLabel: 'ALPHA', products, ...extra });
let checks = 0;
function check(name, callback) { callback(); checks++; }

check('projection preserves raw incomplete dates without inventing lifecycle months', () => {
  const sections = [section([
    product('dated', '2026-01', '2026-03', { dates: { ffsDate: '2026-02-28', generalAvailabilityDate: { raw: '2026-01-01', precisionPeriod: { label: 'Q1 2026', precision: 'quarter' }, evidence: 'kept' }, endManufacturingDate: '2026-02-30' } }),
    product('missing', '', '2027-01'), product('inverted', '2028-01', '2027-01'), product('unsupported', 'May 2026', '2027-01'),
  ])];
  const before = JSON.stringify(sections);
  const data = model.project(sections, timeline);
  assert.deepEqual(plain(data.categories[0].products.map(item => item.lifecycleCoverage)), ['inRange', 'tbd', 'tbd', 'tbd']);
  assert.equal(data.categories[0].products[1].nativeLifecycleProduct.startMonth, '');
  const dated = data.categories[0].products[0];
  assert.equal(model.sourcePeriod(dated, 'ffsDate'), 'Feb 2026');
  assert.equal(model.sourcePeriod(dated, 'generalAvailabilityDate'), 'Q1 2026');
  assert.equal(model.sourcePeriod(dated, 'endManufacturingDate'), 'TBD');
  assert.equal(dated.dates.generalAvailabilityDate.evidence, 'kept');
  assert.equal(dated.dates.endManufacturingDate.raw, '2026-02-30');
  assert.equal(JSON.stringify(sections), before);
  data.categories[0].products[0].dates.generalAvailabilityDate.precisionPeriod.label = 'changed';
  assert.equal(JSON.stringify(sections), before, 'Projection must deeply detach source evidence.');
});

check('all date columns validate real calendar dates and reject unsupported raw strings', () => {
  for (const field of ['ffsDate', 'generalAvailabilityDate', 'endManufacturingDate', 'globalAnnouncementDate', 'webReadinessDate', 'finalAssetsDate']) {
    for (const value of ['2026-02-30', '2025-02-29', '2026-13-01', 'not a date', '', null, 7]) {
      assert.equal(model.sourcePeriod({ dates: { [field]: { raw: value, validDate: value } } }, field), 'TBD', `${field}: ${value}`);
    }
    assert.equal(model.sourcePeriod({ dates: { [field]: { raw: '2028-02-29', validDate: '2028-02-29' } } }, field), 'Feb 2028');
  }
});

check('outside cohorts preserve source ordering, two adjacent nearest years, and real full-year brackets', () => {
  const data = model.project([section([
    product('main', '2026-02', '2026-08'),
    product('old-near', '2023-03', '2025-01'), product('old-previous', '2021-08', '2024-05'),
    product('next', '2027-11', '2030-03'), product('next-adjacent', '2028-02', '2028-12'),
    product('next-chain', '2029-01', '2031-06'), product('remote', '2034-06', '2036-09'),
    product('tbd', '', ''),
  ])], timeline);
  const before = JSON.stringify(data);
  const plan = model.planRoadmapContent(data);
  const dated = plan.slides.find(slide => slide.section === 'dated');
  assert.deepEqual(plain(dated.productIds), ['main']);
  const groups = plan.slides.filter(slide => slide.section === 'outside-range');
  assert.deepEqual(plain(groups.map(slide => slide.productIds)), [['old-near', 'old-previous'], ['next', 'next-adjacent'], ['next-chain'], ['remote']]);
  assert.deepEqual(plain(groups.map(slide => [slide.timeline.startMonth, slide.timeline.endMonth])), [['2021-01', '2025-12'], ['2027-01', '2030-12'], ['2029-01', '2031-12'], ['2034-01', '2036-12']]);
  assert.equal(new Set(groups.map(slide => slide.periodGroup)).size, 4);
  assert.deepEqual(plain(plan.coverage), { expected: 8, represented: 8, unique: 8, inRange: 1, tbd: 1, outsideRange: 6, missingIds: [], duplicateIds: [], unexpectedIds: [] });
  assert.equal(plan.slides.at(-1).section, 'dates-tbd');
  assert.equal(JSON.stringify(data), before);
});

check('pagination includes only supplied visible identities and keeps all TBD rows', () => {
  const records = Array.from({ length: 45 }, (_, index) => product(`visible-${index}`, '2026-01', '2027-12'));
  const plan = model.planRoadmapContent(model.project([section(records), section(Array.from({ length: 15 }, (_, index) => product(`tbd-${index}`, '', '')), { id: 'beta', name: 'Beta' })], timeline));
  assert.deepEqual(plain(plan.slides.filter(slide => slide.page).map(slide => slide.productIds.length)), [21, 21, 3]);
  assert.deepEqual(plain(plan.slides.filter(slide => slide.section === 'dates-tbd').map(slide => slide.productIds.length)), [14, 1]);
  assert.equal(plan.coverage.unique, 60);
  assert.ok(plan.slides.every(slide => !slide.page || slide.page.units <= 21));
  assert.throws(() => model.project([section([records[0], records[0]])], timeline), /duplicate|distinct/i);
});

check('oversized labels fail instead of looping or crossing the footer', () => {
  for (const extra of [{ name: 'W'.repeat(100000) }, { family: 'W '.repeat(1000) }]) {
    context.large = [section([product('large', '2026-01', '2027-12', extra)])];
    assert.throws(() => vm.runInContext("PPTXRoadmapModel.planRoadmapContent(PPTXRoadmapModel.project(large,{startMonth:'2026-02',endMonth:'2026-08'}))", context, { timeout: 2000 }), /exceeds|too long|cannot fit/i);
  }
  assert.throws(() => model.categoryStripHeight('x', 100, () => 5000), /category.*(exceeds|too long|cannot fit)/i);
});

check('visible interval includes touched edge months and handles rails, clamps, and hidden panes', () => {
  const viewport = { startMonth: '2026-01', endMonth: '2026-12', scrollLeft: 0, clientWidth: 320, monthWidth: 60, railWidth: 200 };
  const cases = [
    [{}, { startMonth: '2026-01', endMonth: '2026-02' }],
    [{ scrollLeft: .1 }, { startMonth: '2026-01', endMonth: '2026-03' }],
    [{ scrollLeft: 60 }, { startMonth: '2026-02', endMonth: '2026-03' }],
    [{ scrollLeft: 59.9 }, { startMonth: '2026-01', endMonth: '2026-03' }],
    [{ scrollLeft: 660, clientWidth: 500 }, { startMonth: '2026-12', endMonth: '2026-12' }],
    [{ scrollLeft: -50 }, { startMonth: '2026-01', endMonth: '2026-02' }],
    [{ scrollLeft: 720 }, null], [{ clientWidth: 200 }, null], [{ clientWidth: 0 }, null], [{ monthWidth: 0 }, null],
  ];
  for (const [change, expected] of cases) assert.deepEqual(plain(model.visibleRoadmapPeriod({ ...viewport, ...change })), expected);
  assert.deepEqual(plain(model.visibleRoadmapPeriod({ ...viewport, startMonth: '0001-01', endMonth: '0001-12' })), { startMonth: '0001-01', endMonth: '0001-02' });
  assert.equal(model.sourcePeriod({ dates: { ffsDate: { raw: '0001-01-02', validDate: '0001-01-02' } } }, 'ffsDate'), 'Jan 0001');
});

check('long calendar brackets remain exact while the renderer may choose compact or coarse labels', () => {
  const plan = model.planRoadmapContent(model.project([section([product('old', '1980-02', '2025-12')])], timeline));
  assert.deepEqual(plain(plan.slides[0].timeline), { startMonth: '1980-01', endMonth: '2025-12', showRoadmapMsrp: true });
  assert.equal(model.indexMonth(13), '0001-02');
});

const metrics = JSON.parse(await readFile(new URL('../../public/assets/pptx/arial-narrow-metrics.json', import.meta.url), 'utf8'));
const measure = model.createReferenceTextMeasurer(metrics);
check('numeric reference facts reproduce actual regular/bold/punctuation widths without browser fonts', () => {
  assert.ok(Math.abs(measure('Wireless Gaming Headsets', 24) - 238.4499969482422) < .01);
  assert.ok(Math.abs(measure('COMMERCIAL HEADSETS', 64 / 3, true) - 220.27000427246094) < .01);
  assert.ok(Math.abs(measure('Trademark™ and Café — €100', 112 / 3, true) - 438.989990234375) < .01);
  assert.ok(measure('字🙂', 24) >= 48, 'Unmapped code points reserve conservative space instead of zero width.');
  assert.deepEqual(plain(model.wrapFamilyForDisplay('COMMERCIAL HEADSETS', measure)), ['COMMERCIAL', 'HEADSETS']);
  assert.throws(() => model.createReferenceTextMeasurer({}), /metric/i);
  assert.ok(model.categoryStripHeight('HEADSET', 100, measure) >= 128);
});
console.log(`Roadmap model checks passed: ${checks} groups; raw dates, exact coverage, bounded pagination, touched viewport months, and numeric reference metrics.`);
