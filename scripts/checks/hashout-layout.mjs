import assert from 'node:assert/strict';
import '../../public/js/date-precision.js';
import '../../public/js/ffs-roadmap.js';
import '../../public/js/hashout-layout.js';

const model = globalThis.PortfolioHashoutLayout;
const ffs = globalThis.PortfolioFfsRoadmap;
const horizon = { start: 2026 * 12, end: 2035 * 12 + 11, count: 120 };
const options = { width: 1280, height: 610, leftWidth: 180, headerHeight: 42 };
const same = (actual, expected, context) => assert.ok(Math.abs(actual - expected) < 1e-7, `${context}: ${actual} vs ${expected}`);
const category = (id, products) => ({ id, name: `Category ${id}`, board: { products } });
const product = (id, ffsDate, extra = {}) => ({ id, name: `Provisional ${id}`, ffsDate, roadmap: { status: 'in-planning' }, ...extra });
const quarter = (id, value) => {
  const period = globalThis.PortfolioDatePrecision.parseQuarter(value);
  return product(id, period.start, { plc: { fields: { ffsDate: { value: period.start, period } } } });
};

function accounted(layout) {
  const mapped = layout.glyphs.flatMap(glyph => glyph.memberKeys);
  const unplotted = layout.lanes.flatMap(lane => [...lane.missingEntries, ...lane.outsideEntries, ...lane.offscreenEntries]).map(entry => entry.key);
  const keys = [...mapped, ...unplotted];
  assert.equal(new Set(keys).size, keys.length, 'Every source identity appears in exactly one plotted or unplotted destination.');
  assert.equal(keys.length, layout.counts.total, 'Clustering or viewport clipping cannot silently drop products.');
  assert.equal(layout.counts.visible + layout.counts.offscreen, layout.counts.mapped);
  assert.equal(layout.counts.mapped + layout.counts.missing + layout.counts.outside, layout.counts.total);
  for (const lane of layout.lanes) {
    assert.equal(lane.visibleCount + lane.offscreenCount, lane.mappedCount);
    assert.equal(lane.mappedCount + lane.missingCount + lane.outsideCount, lane.count);
    assert.ok(lane.y >= layout.headerHeight && lane.y + lane.height <= layout.height + 1e-7, 'All selected category lanes remain on one page.');
    for (const glyph of lane.glyphs) {
      assert.ok(glyph.y >= lane.y - 1e-7 && glyph.y + glyph.height <= lane.y + lane.height + 1e-7, 'Glyphs remain within their category lane.');
      assert.equal(glyph.memberKeys.length, glyph.entries.length);
      if (glyph.type === 'group') {
        assert.ok(glyph.centerY - glyph.badgeRadius >= lane.y - 1e-7 && glyph.centerY + glyph.badgeRadius <= lane.y + lane.height + 1e-7,
          'Dense group badges remain inside their category even in very short surfaces');
        same(glyph.x, Math.min(...glyph.members.map(member => member.x)), 'Group bracket starts at an actual member bound');
        same(glyph.x + glyph.width, Math.max(...glyph.members.map(member => member.x + member.width)), 'Group bracket ends at an actual member bound');
        assert.equal(glyph.start, glyph.entries.map(entry => entry.period.start).sort()[0]);
        assert.equal(glyph.end, glyph.entries.map(entry => entry.period.end).sort().at(-1));
      }
    }
  }
}

const portfolio = { categories: Array.from({ length: 11 }, (_, c) => category(`c${c}`, Array.from({ length: c === 10 ? 20 : 22 }, (_, p) => {
  const year = 2026 + (p * 3 + c) % 10;
  const month = String((p * 5 + c) % 12 + 1).padStart(2, '0');
  return product(`p${p}`, `${year}-${month}-15`);
}))) };
const original = JSON.stringify(portfolio);
const entries = model.project(portfolio);
assert.equal(entries.length, 240);
assert.equal(entries.categories.length, 11);
assert.equal(new Set(entries.map(entry => entry.key)).size, 240, 'Identical product IDs in different categories remain distinct.');
assert.equal(entries[0].key, JSON.stringify(['c0', 'p0']));

for (const dimensions of [options, { width: 690, height: 430, leftWidth: 135, headerHeight: 42 }, { width: 390, height: 240, leftWidth: 112, headerHeight: 38 }]) {
  const layout = model.layout(entries, horizon, dimensions);
  assert.equal(layout.lanes.length, 11);
  assert.equal(layout.counts.total, 240);
  accounted(layout);
}
const noPlotWidth = model.layout(entries, horizon, { width: 100, leftWidth: 100, height: 240, headerHeight: 38 });
assert.equal(noPlotWidth.counts.outside, 0, 'A temporarily unavailable plot surface never changes the horizon classification.');
assert.equal(noPlotWidth.counts.offscreen, 240);
accounted(noPlotWidth);
const shortRows = model.layout(entries, horizon, { width: 390, height: 48, leftWidth: 112, headerHeight: 38 });
accounted(shortRows);
assert.equal(JSON.stringify(portfolio), original, 'Projection and layout never modify working data.');
const full = model.layout(entries, horizon, options);
assert.equal(JSON.stringify(model.layout(entries, horizon, options).glyphs), JSON.stringify(full.glyphs), 'Placement and group membership are deterministic.');

const selected = model.project(portfolio, ['c7', 'c2']);
assert.deepEqual(selected.categories.map(cat => cat.id), ['c2', 'c7'], 'Category ordering follows the portfolio even when selection order changes.');
assert.equal(selected.length, 44);
assert.equal(model.project(portfolio, []).length, 0, 'An explicit empty selection never means all categories.');
assert.equal(model.project(portfolio, ['missing-category']).categories.length, 0);
assert.equal(model.layout(model.project({ categories: [category('empty', [])] }), horizon, options).lanes.length, 1, 'Selected empty categories remain visible.');

const densePortfolio = { categories: [category('dense', Array.from({ length: 100 }, (_, i) => product(`same-${i}`, '2030-06-17')))] };
const dense = model.layout(model.project(densePortfolio), horizon, options);
assert.equal(dense.glyphs.length, 1);
assert.equal(dense.glyphs[0].type, 'group');
assert.equal(dense.glyphs[0].memberKeys.length, 100);
same(dense.glyphs[0].width, 0, 'Products sharing a day never imply a made-up date interval');
same(dense.glyphs[0].centerX, ffs.geometry(densePortfolio.categories[0].board.products[0], horizon, 0,
  { leftWidth: options.leftWidth, monthWidth: dense.monthWidth, rowHeight: 20 }).centerX, 'A same-day count is anchored to the actual FFS day');
accounted(dense);
for (const date of ['2026-01-01', '2035-12-31']) {
  const boundaryPortfolio = { categories: [category('edge', Array.from({ length: 100 }, (_, i) => product(`edge-${i}`, date)))] };
  const boundary = model.layout(model.project(boundaryPortfolio), horizon, options);
  const glyph = boundary.glyphs[0];
  const exact = ffs.geometry(boundaryPortfolio.categories[0].board.products[0], horizon, 0,
    { leftWidth: options.leftWidth, monthWidth: boundary.monthWidth, rowHeight: 20 }).centerX;
  same(glyph.x, exact, 'Boundary group bracket stays at the actual FFS day');
  same(glyph.members[0].centerX, exact, 'Keeping the count visible cannot move member timing');
  assert.ok(glyph.countLabelX - glyph.badgeRadius >= options.leftWidth + 2 - 1e-7, 'First-date group count remains completely inside the timeline');
  assert.ok(glyph.countLabelX + glyph.badgeRadius <= options.width - 2 + 1e-7, 'Last-date group count remains completely inside the timeline');
  accounted(boundary);
}

const separated = { categories: [category('clear', [product('first', '2026-01-01'), product('last', '2035-12-31'), quarter('q2', 'Q2 2028')])] };
const individual = model.layout(model.project(separated), horizon, options);
assert.deepEqual(individual.glyphs.map(glyph => glyph.type), ['point', 'window', 'point']);
for (const glyph of individual.glyphs) {
  const source = glyph.entries[0].product;
  const geometry = ffs.geometry(source, horizon, 0, { leftWidth: options.leftWidth, monthWidth: individual.monthWidth, rowHeight: 20 });
  if (glyph.type === 'point') same(glyph.centerX, geometry.centerX, 'Point centers retain exact FFS within-month coordinates');
  else { same(glyph.x, geometry.x, 'Quarter window starts at its actual boundary'); same(glyph.width, geometry.width, 'Quarter window retains its actual width'); }
}
accounted(individual);

const mixed = { categories: [category('mixed', [quarter('a', 'Q2 2028'), quarter('b', 'Q2 2028'), product('c', '2028-05-19')])] };
const groupedWindows = model.layout(model.project(mixed), horizon, options);
assert.equal(groupedWindows.glyphs.length, 1);
assert.equal(groupedWindows.glyphs[0].type, 'group');
assert.equal(groupedWindows.glyphs[0].members.filter(member => member.type === 'window').length, 2, 'Grouping retains the true window shapes for detail and highlights.');
assert.equal(groupedWindows.glyphs[0].start, '2028-04-01');
assert.equal(groupedWindows.glyphs[0].end, '2028-06-30');
accounted(groupedWindows);

const timing = { categories: [category('timing', [
  product('missing', '', { generalAvailabilityDate: '2030-01-01', endOfManufacturingDate: '2032-01-01', roadmap: { launchMonth: '2030-01', endMonth: '2032-01', status: 'launched' } }),
  product('invalid', '2028-02-30'), product('before', '2025-12-31'), product('after', '2036-01-01'),
  product('visible', '2028-05-13', { name: 'Same working name', roadmap: { status: 'in-development' } }),
  product('other', '2032-09-13', { name: 'Same working name', roadmap: { status: 'in-planning' } }),
])] };
const timeline = model.layout(model.project(timing), horizon, options);
assert.equal(timeline.counts.missing, 2, 'Missing or invalid FFS never uses GA, EM, or roadmap fallback.');
assert.equal(timeline.counts.outside, 2);
assert.equal(timeline.counts.visible, 2);
assert.equal(timeline.entriesByKey.get(JSON.stringify(['timing', 'visible'])).stage, 'in-development');
assert.equal(timeline.entriesByKey.get(JSON.stringify(['timing', 'other'])).stage, 'in-planning', 'Names cannot merge different source products.');
accounted(timeline);

const viewport = { ...options, viewportStart: 2028 * 12 + 3.25, viewportEnd: 2028 * 12 + 8.25 };
const panned = model.layout(model.project(timing), horizon, viewport);
assert.equal(panned.counts.outside, 2, 'Panning does not relabel in-horizon products as outside the planning horizon.');
assert.equal(panned.counts.offscreen, 1);
assert.equal(panned.counts.visible, 1);
const point = panned.glyphs[0];
const actualPoint = ffs.geometry(point.entries[0].product, horizon, 0,
  { leftWidth: options.leftWidth - (viewport.viewportStart - horizon.start) * panned.monthWidth, monthWidth: panned.monthWidth, rowHeight: 20 });
same(point.centerX, actualPoint.centerX, 'Fractional pan and zoom do not round FFS to a month or alter source dates');
accounted(panned);
const clippedWindow = model.layout(model.project(mixed), horizon, viewport);
assert.ok(clippedWindow.glyphs[0].clippedBefore, 'Window clipping records the hidden beginning without narrowing the saved period.');
assert.equal(clippedWindow.glyphs[0].start, '2028-04-01');
same(clippedWindow.glyphs[0].x, viewport.leftWidth, 'Partially visible windows begin at the viewport boundary');
accounted(clippedWindow);

const unknown = model.layout(model.project({ categories: [category('unknown', [product('p', '2026-01-01', { roadmap: {}, statusType: 'new' })])] }), horizon, options);
assert.equal(unknown.glyphs[0].stage, 'unknown', 'Date and New labels never invent an official lifecycle stage.');
const duplicates = model.project({ categories: [category('identity', [product('p', '2027-01-01'), product('p', '2028-01-01'), product('', '2029-01-01')])] });
assert.equal(duplicates.length, 2, 'Duplicate category/product identities are counted once.');
assert.equal(duplicates.duplicates.length, 1, 'Duplicate identity evidence remains available for review.');
assert.equal(model.layout(duplicates, horizon, options).counts.identityIssues, 1, 'A source row lacking ID remains visible with an identity review flag.');

function measuredLabels(map, dimensions = {}) {
  return map.lanes.flatMap(lane => lane.glyphs.flatMap(glyph => glyph.members.map(member => ({ key: member.key,
    categoryId: lane.categoryId, anchorX: member.type === 'point' ? member.centerX : member.x + member.width / 2,
    anchorY: glyph.centerY, width: dimensions.width ?? 156, height: dimensions.height ?? 27,
    markerRadius: glyph.type === 'group' ? glyph.badgeRadius : glyph.radius }))));
}
function labelAccounting(map, result) {
  assert.equal(result.hiddenCount + result.labels.length, result.lanes.reduce((sum, lane) => sum + lane.total, 0));
  for (const label of result.labels) {
    const lane = map.lanes.find(item => item.categoryId === label.categoryId);
    assert.ok(map.entriesByKey.has(label.key), 'Every overlay label retains a real source identity.');
    assert.ok(label.x >= map.leftWidth + 4 - 1e-7 && label.x + label.width <= map.width - 4 + 1e-7, 'Labels fit the current plot width.');
    assert.ok(label.y >= lane.y + 4 - 1e-7 && label.y + label.height <= lane.y + lane.height - 4 + 1e-7, 'Labels stay within their category lane.');
  }
  if (result.mode === 'default') for (let i = 0; i < result.labels.length; i++) for (let j = i + 1; j < result.labels.length; j++) {
    const a = result.labels[i], b = result.labels[j];
    assert.ok(a.x + a.width + 6 <= b.x + 1e-7 || b.x + b.width + 6 <= a.x + 1e-7 || a.y + a.height + 6 <= b.y + 1e-7 || b.y + b.height + 6 <= a.y + 1e-7,
      'Automatic overlay rectangles never collide, including their reading gap.');
  }
}
const sparseLabels = measuredLabels(individual);
const sparseOverlay = model.labels(individual, sparseLabels);
assert.equal(sparseOverlay.mode, 'default');
assert.equal(sparseOverlay.labels.length, 3, 'Sparse point and quarter labels appear automatically, including horizon edges.');
labelAccounting(individual, sparseOverlay);
assert.deepEqual(model.labels(individual, [...sparseLabels].reverse()), sparseOverlay, 'Automatic placement is stable independently of incoming label order.');
assert.equal(model.labels(individual, sparseLabels, { mode: 'off' }).labels.length, 0, 'Off hides every name/date overlay even when there is abundant space.');
assert.equal(model.labels(individual, sparseLabels, { mode: 'on' }).labels.length, 3);

const spaciousGrouped = model.layout(model.project(mixed), horizon, { ...options, maxLaneHeight: 550 });
assert.equal(spaciousGrouped.glyphs.length, 1, 'Label placement keeps the existing compact count grouping.');
const beforeGroupedLabels = JSON.stringify(spaciousGrouped.glyphs), beforeMeasurements = measuredLabels(spaciousGrouped);
const groupedOverlay = model.labels(spaciousGrouped, beforeMeasurements);
assert.equal(groupedOverlay.labels.length, 3, 'A few grouped products can each have their own name/date label when the selected category has room.');
assert.deepEqual(new Set(groupedOverlay.labels.map(label => label.key)), new Set(spaciousGrouped.glyphs[0].memberKeys));
labelAccounting(spaciousGrouped, groupedOverlay);
for (const label of groupedOverlay.labels) {
  const originalLabel = beforeMeasurements.find(candidate => candidate.key === label.key);
  same(label.anchorX, originalLabel.anchorX, 'Annotating a grouped member retains its exact FFS anchor');
  same(label.anchorY, originalLabel.anchorY, 'Annotating a grouped member retains its lane position');
}
assert.equal(JSON.stringify(spaciousGrouped.glyphs), beforeGroupedLabels, 'Labels cannot change FFS points, windows, brackets, counts, or ring origins.');

const denseLabels = measuredLabels(dense);
assert.equal(model.labels(dense, denseLabels).labels.length, 0, 'Default suppresses the entire dense lane when any product label cannot fit.');
const forcedDense = model.labels(dense, denseLabels, { mode: 'on' });
assert.equal(forcedDense.labels.length, 100, 'Explicit On overrides automatic suppression and includes every coincident product.');
assert.ok(forcedDense.lanes[0].forcedCount > 0, 'Unavoidable overlap is limited to the explicit On override.');
assert.equal(forcedDense.hiddenCount, 0);
labelAccounting(dense, forcedDense);
const independentPortfolio = { categories: [category('spacious', [product('one', '2027-06-15')]), ...densePortfolio.categories] };
const independentMap = model.layout(model.project(independentPortfolio), horizon, { ...options, maxLaneHeight: 550 });
const independentOverlay = model.labels(independentMap, measuredLabels(independentMap));
assert.deepEqual(independentOverlay.labels.map(label => independentMap.entriesByKey.get(label.key).categoryId), ['spacious'],
  'Automatic density decisions are independent for each category.');
assert.equal(independentOverlay.lanes.find(lane => lane.categoryId === 'dense').enabled, false);
labelAccounting(independentMap, independentOverlay);
const shortLabelMap = model.layout(model.project(separated), horizon, { ...options, height: 62, headerHeight: 42 });
assert.equal(model.labels(shortLabelMap, measuredLabels(shortLabelMap)).labels.length, 0, 'A short category never clips or squeezes automatic labels.');
const sparseFiftyMap = model.layout(model.project({ categories: [category('fifty', [product('first', '2028-01-15'), product('last', '2033-06-12')])] }), horizon,
  { width: 651, height: 96, leftWidth: 112, headerHeight: 46, maxLaneHeight: 50 });
const sparseFiftyLabels = measuredLabels(sparseFiftyMap, { width: 100 });
assert.ok(sparseFiftyMap.glyphs.every(glyph => glyph.radius === 4.5), 'This regression exercises normal point marker clearance.');
const sparseFiftyOverlay = model.labels(sparseFiftyMap, sparseFiftyLabels);
assert.equal(sparseFiftyOverlay.labels.length, 2, 'A sparse 50px category supports full-height adjacent labels even when track centers sit near its top edge.');
labelAccounting(sparseFiftyMap, sparseFiftyOverlay);
for (const label of sparseFiftyOverlay.labels) {
  const marker = sparseFiftyMap.glyphs.find(glyph => glyph.memberKeys.includes(label.key));
  assert.ok(label.x >= marker.centerX + marker.radius + 4 + 5 || label.x + label.width <= marker.centerX - marker.radius - 4 - 5,
    'The small vertical correction never compromises the full marker halo and label clearance.');
  same(label.anchorY, marker.centerY, 'Only the annotation moves inside the lane; its marker anchor remains exact');
}
const narrowLabelMap = model.layout(model.project(separated), horizon, { width: 390, height: 350, leftWidth: 112, headerHeight: 42, maxLaneHeight: 350 });
const narrowOverlay = model.labels(narrowLabelMap, measuredLabels(narrowLabelMap, { width: 112 }));
labelAccounting(narrowLabelMap, narrowOverlay);
const narrowImpossible = model.labels(narrowLabelMap, measuredLabels(narrowLabelMap, { width: 500 }));
assert.equal(narrowImpossible.labels.length, 0, 'Measured labels wider than the viewport cannot leak into adjacent columns in Default.');
const invalidLabels = [...sparseLabels, { ...sparseLabels[0] }, { ...sparseLabels[0], key: 'not-a-source-product' }];
assert.equal(model.labels(individual, invalidLabels).labels.length, 3, 'Duplicate measurements or unknown identities cannot create phantom products.');
assert.equal(model.labels(individual, []).labels.length, 0);
assert.equal(JSON.stringify(portfolio), original, 'All overlay modes leave the source working names and FFS evidence unchanged.');

const annualWindows = model.seasonalWindows(horizon);
assert.equal(annualWindows.length, 20, 'The ten-year horizon repeats both shared FFS planning months each year.');
assert.deepEqual(annualWindows.slice(0, 2).map(window => [window.season, window.type, window.startMonth, window.endMonth]),
  [['spring', 'ffs', 2026 * 12 + 1, 2026 * 12 + 2], ['fall', 'ffs', 2026 * 12 + 6, 2026 * 12 + 7]],
  'Spring and Fall FFS guides are exactly February and July, using an exclusive month end.');
assert.equal(annualWindows.find(window => window.year === 2028 && window.season === 'spring').end, '2028-02-29', 'February guides retain leap day.');
assert.equal(annualWindows[0].end, '2026-02-28');
assert.ok(Object.isFrozen(annualWindows) && annualWindows.every(Object.isFrozen), 'Calendar guides are immutable view data.');
assert.deepEqual(model.seasonalWindows(horizon), annualWindows, 'Annual planning guides are deterministic.');
const contextualWindows = model.seasonalWindows(horizon, { context: true });
assert.equal(contextualWindows.length, 40);
assert.deepEqual(contextualWindows.slice(0, 4).map(window => [window.season, window.type, window.start.slice(5, 7)]),
  [['spring', 'ffs', '02'], ['spring', 'on-shelf', '05'], ['fall', 'ffs', '07'], ['fall', 'on-shelf', '10']],
  'Optional May/October on-shelf context is distinct from the FFS placement months.');
assert.equal(contextualWindows[0].onShelfMonth, 2026 * 12 + 4, 'A February FFS guide points to the ideal May on-shelf month in the same year.');
assert.equal(contextualWindows[0].onShelfLabel, 'May 2026');
assert.equal(contextualWindows[2].onShelfMonth, 2026 * 12 + 9, 'A July FFS guide points to the ideal October on-shelf month in the same year.');
assert.equal(contextualWindows[2].onShelfLabel, 'Oct 2026');
assert.ok(contextualWindows.filter(window => window.type === 'ffs').every(window => window.onShelfMonth - window.startMonth === 3),
  'Every shared FFS guide keeps its three-month seasonal planning relationship without declaring product readiness.');
const crossingYear = { start: 2027 * 12 + 11, end: 2028 * 12 + 1, count: 3 };
const crossYearWindows = model.seasonalWindows(crossingYear, { context: true });
assert.equal(crossYearWindows.length, 1, 'A December-through-February horizon does not invent a December season or leak neighboring years.');
assert.equal(crossYearWindows[0].start, '2028-02-01');
assert.equal(crossYearWindows[0].end, '2028-02-29');
const clippedSeason = model.seasonalWindows(horizon, { viewportStart: 2028 * 12 + 1.25, viewportEnd: 2028 * 12 + 1.75 });
assert.equal(clippedSeason.length, 1);
same(clippedSeason[0].displayStart, 2028 * 12 + 1.25, 'A partially visible month begins at the actual fractional viewport bound');
same(clippedSeason[0].displayEnd, 2028 * 12 + 1.75, 'A partially visible month ends at the actual fractional viewport bound');
assert.equal(clippedSeason[0].start, '2028-02-01', 'Visual clipping cannot narrow the calendar window used for matching.');
assert.equal(clippedSeason[0].end, '2028-02-29');
assert.equal(model.seasonalWindows({ start: horizon.start, end: horizon.end, count: 2 }).length, 0, 'Malformed horizons have no planning guides.');
assert.equal(model.seasonalWindows(horizon, { viewportStart: horizon.end + 1, viewportEnd: horizon.end + 2 }).length, 0);
assert.equal(model.seasonalWindows(horizon, { viewportStart: 10, viewportEnd: 5 }).length, 0);

const leapMatch = model.windowMatches(ffs.period(product('leap', '2028-02-29')), annualWindows);
assert.equal(leapMatch.length, 1);
assert.equal(leapMatch[0].match, 'within', 'A day-precision FFS can be identified as falling within the key month.');
assert.equal(leapMatch[0].overlapStart, '2028-02-29');
assert.equal(leapMatch[0].overlapEnd, '2028-02-29');
assert.equal(model.windowMatches(ffs.period(product('next-day', '2028-03-01')), annualWindows).length, 0, 'An adjacent month never matches a February guide.');
const exactMonthMatch = model.windowMatches({ start: '2028-07-01', end: '2028-07-31', precision: 'month' }, annualWindows);
assert.equal(exactMonthMatch[0].season, 'fall');
assert.equal(exactMonthMatch[0].match, 'within');
const broadQuarter = model.windowMatches(ffs.period(quarter('q1', 'Q1 2028')), annualWindows);
assert.equal(broadQuarter.length, 1);
assert.equal(broadQuarter[0].match, 'overlap', 'Quarter precision reports possible overlap, never a firm February commitment.');
assert.equal(broadQuarter[0].overlapStart, '2028-02-01');
assert.equal(broadQuarter[0].overlapEnd, '2028-02-29');
const broadYear = model.windowMatches({ start: '2028-01-01', end: '2028-12-31', precision: 'year' }, contextualWindows);
assert.equal(broadYear.length, 2);
assert.ok(broadYear.every(match => match.match === 'overlap' && match.type === 'ffs'), 'Year precision only overlaps FFS guides and never claims an on-shelf date.');
assert.equal(model.windowMatches(ffs.period(product('may', '2028-05-15')), annualWindows).length, 0, 'On-shelf months do not become FFS windows.');
assert.equal(model.windowMatches(ffs.period(product('may', '2028-05-15')), contextualWindows).length, 0,
  'A May FFS cannot match the ideal Spring on-shelf context or imply that product will be on shelves in May.');
assert.equal(model.windowMatches(ffs.period(product('october', '2028-10-15')), contextualWindows).length, 0,
  'An October FFS cannot match the ideal Fall on-shelf context.');
assert.equal(model.windowMatches({ generalAvailabilityDate: '2028-02-12', endOfManufacturingDate: '2028-07-01' }, annualWindows).length, 0,
  'Calendar matching cannot substitute GA or EM for missing FFS evidence.');
assert.equal(model.windowMatches(null, annualWindows).length, 0);
assert.equal(model.windowMatches({ start: '2027-02-29', end: '2027-02-29', precision: 'day' }, annualWindows).length, 0, 'Invalid calendar days cannot match a guide.');
assert.equal(model.windowMatches({ start: '2028-07-01', end: '2028-02-01', precision: 'range' }, annualWindows).length, 0);
const matchingPeriod = Object.freeze(ffs.period(quarter('immutable-q1', 'Q1 2028')));
const beforeSeasonMatch = JSON.stringify({ horizon, annualWindows, matchingPeriod });
assert.equal(model.windowMatches(matchingPeriod, annualWindows)[0].match, 'overlap');
assert.equal(JSON.stringify({ horizon, annualWindows, matchingPeriod }), beforeSeasonMatch, 'Matching never mutates source periods, calendar guides, or horizon settings.');

function radialAccounting(result, dimensions) {
  assert.deepEqual(result.center, result.anchor, 'Every expansion remains at the exact original cluster origin.');
  assert.equal(result.connector, null, 'An anchored expansion never adds lines or a relocated center.');
  assert.equal(result.positions.length, result.endIndex - result.startIndex);
  assert.equal(result.slots, result.positions, 'Renderer aliases use the same tested positions.');
  assert.equal(result.pageSize, result.capacity);
  for (const position of result.positions) {
    assert.ok(position.x - result.targetSize / 2 >= dimensions.leftWidth + result.padding - 1e-7);
    assert.ok(position.x + result.targetSize / 2 <= dimensions.width - result.padding + 1e-7);
    assert.ok(position.y - result.targetSize / 2 >= dimensions.headerHeight + result.padding - 1e-7);
    assert.ok(position.y + result.targetSize / 2 <= dimensions.height - result.padding + 1e-7);
    if (result.showCenterControl) {
      assert.ok(Math.hypot(position.x - result.center.x, position.y - result.center.y) >= result.targetSize + result.gap - 1e-7,
        'Product interaction targets never overlap the center close control.');
    }
  }
  for (let i = 0; i < result.positions.length; i++) for (let j = i + 1; j < result.positions.length; j++) {
    assert.ok(Math.hypot(result.positions[i].x - result.positions[j].x, result.positions[i].y - result.positions[j].y) >= result.targetSize + result.gap - 1e-7,
      'Neighboring circular interaction targets retain their full target size and gap.');
  }
}

const radialDimensions = { width: 1280, height: 610, leftWidth: 180, headerHeight: 42, preferredRadius: 108, targetSize: 44, gap: 4, maxVisible: 12 };
const unchangedDateGlyphs = JSON.stringify(full.glyphs);
for (const dimensions of [radialDimensions,
  { width: 1280, height: 610, leftWidth: 166, headerHeight: 46, targetSize: 28, gap: 6, maxVisible: 12 },
  { width: 690, height: 350, leftWidth: 142, headerHeight: 46, targetSize: 28, gap: 8, maxVisible: 12 },
  { width: 390, height: 240, leftWidth: 112, headerHeight: 46, targetSize: 28, gap: 6, maxVisible: 12 },
  { width: 690, height: 350, leftWidth: 142, headerHeight: 46, preferredRadius: 80, maxVisible: 8 },
  { width: 390, height: 240, leftWidth: 112, headerHeight: 46, preferredRadius: 80, maxVisible: 8 },
  { width: 650, height: 120, leftWidth: 142, headerHeight: 46, preferredRadius: 80, maxVisible: 8 },
  { width: 260, height: 180, leftWidth: 142, headerHeight: 46, preferredRadius: 80, maxVisible: 8 }]) {
  for (const anchor of [{ x: dimensions.leftWidth + 1, y: dimensions.headerHeight + 1 },
    { x: dimensions.width - 1, y: dimensions.headerHeight + 1 },
    { x: dimensions.leftWidth + 1, y: dimensions.height - 1 }, { x: dimensions.width - 1, y: dimensions.height - 1 },
    { x: (dimensions.leftWidth + dimensions.width) / 2, y: (dimensions.headerHeight + dimensions.height) / 2 }]) {
    for (const total of [2, 3, 8, 12, 100]) {
      const result = model.radialLayout(total, { ...dimensions, anchor });
      assert.ok(result.fit && result.capacity > 0, 'Normal and short map surfaces offer a bounded product picker.');
      radialAccounting(result, dimensions);
      const pageIndices = [];
      for (let page = 0; page < result.pageCount; page++) {
        const part = model.radialLayout(total, { ...dimensions, anchor, page });
        radialAccounting(part, dimensions);
        assert.deepEqual(part.center, result.center, 'Paging, including a partial last page, never moves the radial control center.');
        same(part.radius, result.radius, 'Radial pages retain the same orbit scale');
        pageIndices.push(...part.positions.map(position => position.index));
      }
      assert.deepEqual(pageIndices, Array.from({ length: total }, (_, index) => index), 'Paging offers each group member exactly once without a dense spiral.');
    }
  }
}
const centralAnchor = { x: 730, y: 325 };
const centeredOrbit = model.radialLayout(100, { ...radialDimensions, anchor: centralAnchor });
assert.deepEqual(centeredOrbit.center, centralAnchor, 'An orbit keeps its original cluster anchor when there is room.');
assert.equal(centeredOrbit.connector, null);
assert.equal(centeredOrbit.capacity, 12);
assert.equal(centeredOrbit.pageCount, 9);
same(centeredOrbit.radius, 48 / (2 * Math.sin(Math.PI / 12)), 'A twelve-member touch ring uses the minimal radius required by its target spacing');
for (const [targetSize, gap] of [[28, 6], [28, 8], [44, 4]]) {
  let previousRadius = 0;
  for (let total = 2; total <= 12; total++) {
    const compact = model.radialLayout(total, { ...radialDimensions, targetSize, gap, anchor: centralAnchor });
    const minimum = Math.max(targetSize + gap, (targetSize + gap) / (2 * Math.sin(Math.PI / total)));
    assert.equal(compact.capacity, total, 'An unconstrained ring shows the requested members together.');
    same(compact.radius, minimum, 'Ring radius derives from actual member count and target spacing');
    assert.ok(compact.radius >= previousRadius - 1e-7, 'Adding members never shrinks an unconstrained compact ring.');
    previousRadius = compact.radius;
    radialAccounting(compact, radialDimensions);
  }
}
const leftTwoAnchor = { x: radialDimensions.leftWidth + 27, y: 325 };
assert.deepEqual(model.radialLayout(2, { ...radialDimensions, anchor: leftTwoAnchor }).center, leftTwoAnchor,
  'A small boundary group expands from its original count without any horizontal shift.');
const shortOrbit = model.radialLayout(100, { width: 650, height: 120, leftWidth: 142, headerHeight: 46, anchor: { x: 400, y: 83 } });
assert.equal(shortOrbit.mode, 'arc');
assert.equal(shortOrbit.capacity, 2, 'A short map preserves full-size targets by offering a few products at a time.');
const tinyDimensions = { width: 200, height: 146, leftWidth: 142, headerHeight: 46 };
const tiny = model.radialLayout(100, { ...tinyDimensions, anchor: { x: 170, y: 62 } });
assert.equal(tiny.mode, 'arc');
assert.equal(tiny.capacity, 1);
assert.equal(tiny.showCenterControl, true, 'A one-member page retains an origin control separated from the product target.');
radialAccounting(tiny, tinyDimensions);
assert.equal(model.radialLayout(100, { width: 150, height: 80, leftWidth: 142, headerHeight: 46 }).fit, false,
  'An impossible target surface is explicit rather than using clipped controls.');
assert.equal(model.radialLayout(0, radialDimensions).capacity, 0);
assert.deepEqual(model.radial({ x: 730, y: 325 }, { ...radialDimensions, total: 100 }).positions, centeredOrbit.positions, 'Both agreed renderer entry points use identical geometry.');
assert.equal(JSON.stringify(full.glyphs), unchangedDateGlyphs, 'An in-place radial picker cannot move map dates, brackets, or members.');

console.log('Hashout category layout checks passed (240 products, exact FFS, collision-aware name/date overlays, explicit On/Off, exact-origin compact rings, paging and identity accounting).');
