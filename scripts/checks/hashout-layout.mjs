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

console.log('Hashout category layout checks passed (240 products, exact FFS, one-page lanes, exact-origin compact rings, bounded sectors, paging and identity accounting).');
