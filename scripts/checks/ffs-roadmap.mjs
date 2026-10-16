import assert from 'node:assert/strict';
import '../../public/js/date-precision.js';
import '../../public/js/ffs-roadmap.js';

const map = globalThis.PortfolioFfsRoadmap;
assert.equal(map.status({ statusType: 'discontinued', roadmap: { status: 'launched' } }), 'end-of-life', 'A manual discontinued flag projects End of life even for standalone FFS consumers.');
const quarter = globalThis.PortfolioDatePrecision.parseQuarter('Q2 2028');
const product = (ffsDate, period, extra = {}) => ({ ffsDate, ...(period ? { plc: { fields: { ffsDate: { value: ffsDate, period } } } } : {}), ...extra });
const options = { leftWidth: 200, monthWidth: 60, rowHeight: 34 };
const range = { start: 2028 * 12, end: 2028 * 12 + 11, count: 12 };
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} vs ${expected}`);

for (const otherDates of [{ generalAvailabilityDate: '2028-06-01' }, { endOfManufacturingDate: '2028-12-01' }, { roadmap: { startMonth: '2028-02', launchMonth: '2028-03', endMonth: '2029-01' } }]) {
  assert.equal(map.period(otherDates), null, 'A product without FFS stays TBD regardless of other milestones.');
  assert.equal(map.geometry(otherDates, range, 100, options), null);
}
assert.equal(map.period({ ffsDate: '' }), null);
for (const invalid of ['2028-02-30', '2027-02-29', '2028-04-31', '2028-13-01', '2028-00-01', '2028-04', '2028-04-01T00:00:00Z', '4/1/2028', 'Q2 2028', '0000-01-01']) {
  assert.equal(map.period({ ffsDate: invalid }), null, `Invalid or undeclared timing cannot masquerade as a calendar day: ${invalid}`);
}
assert.equal(map.period(product('2028-02-29')).label, 'Feb 29, 2028');
assert.equal(map.period(product('2028-04-01')).estimated, true, 'Day precision does not imply official timing.');

const q2Product = product('2028-04-01', quarter, { roadmap: { startMonth: '2028-07', launchMonth: '2028-07', endMonth: '2029-12' }, generalAvailabilityDate: '2028-07-01' });
assert.equal(map.period(q2Product).label, 'Q2 2028');
assert.equal(map.period(q2Product).end, '2028-06-30');
const quarterRect = map.geometry(q2Product, range, 100, options);
assert.equal(quarterRect.kind, 'window');
assert.equal(quarterRect.x, 380, 'FFS quarter starts in April with no GA fallback or one-month launch offset.');
assert.equal(quarterRect.width, 180, 'Q2 uncertainty spans the full April–June window.');
assert.equal(quarterRect.y, 108);
assert.equal(quarterRect.height, 18);
for (const [quarterText, expectedX, expectedWidth] of [['Q1 2028', 200, 180], ['Q4 2028', 740, 180]]) {
  const interval = globalThis.PortfolioDatePrecision.parseQuarter(quarterText);
  const rect = map.geometry(product(interval.start, interval), range, 0, options);
  assert.equal(rect.x, expectedX);
  assert.equal(rect.width, expectedWidth, 'Windows retain inclusive month/year boundaries.');
}
const leapPoint = map.geometry(product('2028-02-29'), range, 0, options);
assert.equal(leapPoint.kind, 'point');
close(leapPoint.centerX, 260 + 28.5 / 29 * 60, 'Leap day lands at its actual location within February');
assert.equal(map.geometry(product('2027-12-31'), range, 0, options), null, 'Earlier FFS is outside this horizon.');
assert.equal(map.geometry(product('2029-01-01'), range, 0, options), null, 'Later FFS is outside this horizon.');
assert.ok(map.geometry(product('2028-01-01'), range, 0, options), 'First horizon day remains visible.');
assert.ok(map.geometry(product('2028-12-31'), range, 0, options), 'Last horizon day remains visible.');

const declarations = [
  [{ precision: 'month', basis: 'calendar', start: '2028-02-01', end: '2028-02-29' }, 'Feb 2028', 60],
  [{ precision: 'half-year', basis: 'calendar', start: '2028-07-01', end: '2028-12-31' }, 'H2 2028', 360],
  [{ precision: 'year', basis: 'calendar', start: '2028-01-01', end: '2028-12-31' }, '2028', 720],
  [{ precision: 'range', basis: 'calendar', start: '2028-04-12', end: '2028-05-08' }, 'Apr 12, 2028 – May 8, 2028', (1 - 11 / 30 + 8 / 31) * 60],
];
for (const [declaration, label, width] of declarations) {
  const entry = product(declaration.start, { ...declaration, label: 'Untrusted imported label' });
  assert.equal(map.period(entry).label, label, 'Labels are derived from declared calendar facts.');
  close(map.geometry(entry, range, 0, options).width, width, 'Declared estimate bounds remain faithful');
}
const acrossYear = { precision: 'range', basis: 'calendar', start: '2027-11-01', end: '2028-02-29' };
const clipped = map.geometry(product(acrossYear.start, acrossYear), range, 0, options);
assert.equal(clipped.x, 200); assert.equal(clipped.width, 120); assert.equal(clipped.clippedBefore, true); assert.equal(clipped.clippedAfter, false);
const lastYear = { precision: 'range', basis: 'calendar', start: '2028-12-01', end: '2029-03-31' };
const clippedEnd = map.geometry(product(lastYear.start, lastYear), range, 0, options);
assert.equal(clippedEnd.width, 60); assert.equal(clippedEnd.clippedAfter, true);
for (const declaration of [
  { precision: 'month', basis: 'calendar', start: '2028-02-01', end: '2028-02-28' },
  { precision: 'half-year', basis: 'calendar', start: '2028-02-01', end: '2028-07-31' },
  { precision: 'year', basis: 'calendar', start: '2028-01-01', end: '2028-11-30' },
  { precision: 'range', basis: 'calendar', start: '2028-04-01', end: '2028-03-31' },
  { ...quarter, basis: 'fiscal' },
]) {
  const result = map.period(product(declaration.start, declaration));
  assert.equal(result.precision, 'day', 'Invalid precision metadata never changes the valid saved scalar date.');
  assert.equal(result.reviewFlag, true, 'Incompatible current period metadata is visible for review.');
}
const edited = { ...q2Product, ffsDate: '2028-08-19' };
assert.equal(map.period(edited).precision, 'day', 'Stale quarter metadata cannot move a manually edited FFS.');
assert.equal(map.period(edited).reviewFlag, false);
const superseded = structuredClone(q2Product);
superseded.plc.fields.ffsDate.supersededAt = '2026-10-13T10:00:00Z';
assert.equal(map.period(superseded).precision, 'day', 'Superseded metadata cannot reappear when its old anchor matches.');
const competing = product('2028-04-01');
competing.plc = { fields: { ffsDate: { value: '2028-04-01', candidates: ['2028-04-01', '2028-08-01'] } } };
assert.equal(map.period(competing).reviewFlag, true);
competing.plc.fields.ffsDate.reviewed = true;
assert.equal(map.period(competing).reviewFlag, false, 'An explicit resolution clears the competing-date flag.');
assert.equal(map.status({ roadmap: { status: 'in-development' }, statusType: 'new', ffsDate: '2020-01-01' }), 'in-development', 'A New badge and an earlier date cannot replace declared lifecycle stage.');
assert.equal(map.status({ ffsDate: '2020-01-01' }), 'unknown', 'Earlier FFS alone never proves release.');
assert.equal(map.status({ roadmap: { status: 'launched' }, ffsDate: '2030-01-01' }), 'launched');
assert.equal(map.geometry(q2Product, { ...range, count: 120 }, 0, options), null, 'Inconsistent horizon dimensions cannot produce misleading placement.');
assert.equal(map.geometry(q2Product, range, 0, { ...options, monthWidth: -1 }), null);
const tenYears = { start: 2026 * 12, end: 2035 * 12 + 11, count: 120 };
assert.ok(map.geometry(product('2035-12-31'), tenYears, 0, options), 'A ten-year map includes its final year.');
assert.equal(map.geometry(product('2036-01-01'), tenYears, 0, options), null, 'The ten-year horizon has a precise later boundary.');
const saved = JSON.stringify(q2Product);
Object.freeze(q2Product.plc.fields.ffsDate.period); Object.freeze(q2Product.plc.fields.ffsDate); Object.freeze(q2Product.roadmap); Object.freeze(q2Product);
map.period(q2Product); map.geometry(q2Product, tenYears, 0, options);
assert.equal(JSON.stringify(q2Product), saved, 'Rendering the FFS map preserves saved product dates, stage, and precision evidence.');

await import('../../public/js/portfolio-model.js');
const retired = { endManufacturingDate: '2000-01-01', roadmap: { status: 'embargo' }, ffsDate: '1999-01-01' };
const retiredBefore = JSON.stringify(retired);
assert.equal(map.status(retired), 'end-of-life', 'The app shares completed manufacturing evidence with Hashout and its exports.');
assert.equal(map.status({ roadmap: { status: 'end-of-life' }, endManufacturingDate: '' }), 'end-of-life', 'An explicit lifecycle EOL does not require inventing an exact date.');
assert.equal(map.status({ roadmap: { status: 'launched' }, endManufacturingDate: '9999-12-31' }), 'launched', 'A future manufacturing date alone leaves the saved stage active.');
assert.equal(JSON.stringify(retired), retiredBefore, 'Projecting End of life never rewrites stored dates or the source stage.');

console.log('FFS map checks passed: independent milestone, strict days, leap placement, faithful estimate windows, horizon clipping, current evidence guards, and explicit lifecycle stage.');
