import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
const functions = ["scrollSelectedIntoView", "scrollRoadmapSelected"].map((name) => {
  const definition = source.match(new RegExp(`^function ${name}\\([^]*?^\\}`, "m"))?.[0];
  assert.ok(definition, `Exercise the actual ${name} function.`);
  return definition;
}).join("\n");
const freeze = (value) => {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: expected ${expected}, received ${actual}`);

function harness({ zoom = 1, cards = [], bars = [], rows = [], width = 900, height = 620, left = 450, top = 770 } = {}) {
  const canvas = {};
  const scrollCalls = [];
  const scroll = {
    clientWidth: width, clientHeight: height, scrollWidth: 15000, scrollHeight: 15000, scrollLeft: left, scrollTop: top,
    querySelector(selector) { assert.equal(selector, "canvas"); return canvas; },
    scrollTo(options) {
      scrollCalls.push(JSON.parse(JSON.stringify(options)));
      // Match native scrollers at boundaries. Requested offsets are checked
      // separately, so browser clamping cannot conceal a negative request.
      if (options.left !== undefined) this.scrollLeft = Math.max(0, Math.min(this.scrollWidth - this.clientWidth, options.left));
      if (options.top !== undefined) this.scrollTop = Math.max(0, Math.min(this.scrollHeight - this.clientHeight, options.top));
    },
  };
  const business = freeze({
    categories: [{ id: "audio", products: [{ id: "selected", name: "Cloud", generalAvailabilityDate: "2026-06-11", endManufacturingDate: "2029-07-12", roadmap: { startMonth: "2026-06", endMonth: "2029-07" } }] }],
    settings: { timeline: { startMonth: "2026-01", endMonth: "2028-12" } },
    masterLocalBaseline: { revision: 4 },
  });
  const before = JSON.stringify(business);
  const context = {
    selectedId: "selected", zoom, renderedCards: freeze(cards), canvasScroll: scroll,
    roadmapHitRegions: new Map([[canvas, freeze(bars)]]), roadmapRowRegions: new Map([[canvas, freeze(rows)]]),
    ROADMAP_LEFT_WIDTH: 190, ROADMAP_HEADER_HEIGHT: 88, portfolio: business,
    updateBoard() { throw new Error("Selection reveal cannot update product data."); },
    updateTimelineSettings() { throw new Error("Selection reveal cannot change the configured range."); },
  };
  vm.createContext(context); new vm.Script(functions).runInContext(context);
  return { context, scroll, scrollCalls, assertUnchanged() { assert.equal(JSON.stringify(business), before, "Reveal preserves products, dates, configured range, and shared baseline."); } };
}

// Later cards in lower lanes must be revealed on both axes at different scales.
for (const zoom of [0.4, 1, 2.1]) {
  const card = { productId: "selected", x: 2200, y: 3900, width: 240, height: 220 };
  const h = harness({ zoom, cards: [{ productId: "other", x: 10, y: 10, width: 240, height: 220 }, card] });
  h.context.scrollSelectedIntoView();
  near((card.x + card.width / 2) * zoom - h.scroll.scrollLeft, h.scroll.clientWidth / 2, "The selected card is centered horizontally at its current zoom");
  near((card.y + card.height / 2) * zoom - h.scroll.scrollTop, h.scroll.clientHeight / 2, "The selected lower-lane card is centered vertically at its current zoom");
  assert.equal(h.scrollCalls[0].behavior, "smooth"); h.assertUnchanged();
}

{
  const h = harness({ zoom: 0.4, cards: [{ productId: "selected", x: 18, y: 12, width: 240, height: 420 }] });
  h.context.scrollSelectedIntoView();
  assert.equal(h.scrollCalls[0].left, 0); assert.equal(h.scrollCalls[0].top, 0, "First-row cards never request a negative offset.");
  h.assertUnchanged();
}

{
  const card = { productId: "selected", x: 1800, y: 2900, width: 700, height: 580 };
  const h = harness({ zoom: 2, cards: [card] }); h.context.scrollSelectedIntoView();
  const visibleLeft = card.x * 2 - h.scroll.scrollLeft, visibleTop = card.y * 2 - h.scroll.scrollTop;
  assert.ok(visibleLeft >= 0 && visibleLeft < h.scroll.clientWidth / 2, "An oversized card keeps its leading edge accessible.");
  assert.ok(visibleTop >= 0 && visibleTop < h.scroll.clientHeight / 2, "An oversized card keeps its heading accessible.");
  h.assertUnchanged();
}

// Roadmap centering must use the actual timeline body, without centering a
// selected bar behind the frozen product rail or calendar header.
for (const [width, height, smooth] of [[1100, 720, true], [560, 410, false]]) {
  const bar = { productId: "selected", x: 3200, y: 2700, width: 440, height: 32 };
  const h = harness({ width, height, bars: [bar], rows: [{ productId: "selected", y: 2690, height: 50 }] });
  h.context.scrollRoadmapSelected(h.scroll, smooth);
  near(bar.x + bar.width / 2 - h.scroll.scrollLeft, 190 + (width - 190) / 2, "The selected bar center is in the available timeline body");
  near(bar.y + bar.height / 2 - h.scroll.scrollTop, 88 + (height - 88) / 2, "The selected bar is below the frozen header");
  assert.equal(h.scrollCalls[0].behavior, smooth ? "smooth" : "auto"); h.assertUnchanged();
}

for (const missingDates of [false, true]) {
  const row = { productId: "selected", y: 2600, height: 42 };
  const h = harness({ bars: [{ productId: "other", x: 900, y: 2500, width: 400, height: 32 }], rows: [row], left: 975 });
  if (missingDates) h.context.roadmapHitRegions.clear();
  h.context.scrollRoadmapSelected(h.scroll);
  assert.equal(h.scroll.scrollLeft, 975, "A selected off-range or undated product reveals its row without resetting horizontal navigation.");
  near(row.y + row.height / 2 - h.scroll.scrollTop, 88 + (h.scroll.clientHeight - 88) / 2, "The row-only fallback reveals the selected name vertically");
  h.assertUnchanged();
}

{
  const h = harness({ bars: [{ productId: "selected", x: 190, y: 88, width: 12, height: 30 }] });
  h.context.scrollRoadmapSelected(h.scroll);
  assert.equal(h.scrollCalls[0].left, 0); assert.equal(h.scrollCalls[0].top, 0, "An early product never requests an offset before the timeline origin.");
  h.assertUnchanged();
}

for (const kind of ["none", "another product", "cleared selection"]) {
  const other = { productId: "other", x: 2100, y: 2700, width: 240, height: 60 };
  const h = harness(kind === "another product" ? { cards: [other], bars: [other], rows: [other] } : {});
  if (kind === "cleared selection") h.context.selectedId = null;
  h.context.scrollSelectedIntoView(); h.context.scrollRoadmapSelected(h.scroll);
  assert.equal(h.scrollCalls.length, 0, `${kind}: no matching card, bar, or row leaves the user's view untouched.`);
  assert.equal(h.scroll.scrollLeft, 450); assert.equal(h.scroll.scrollTop, 770); h.assertUnchanged();
}

const html = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
assert.ok(!/id="(?:navSelected|roadmapNavSelected|splitRoadmapNavSelected|roadmapShowSelected)"/.test(html), "Manual Show selected controls stay removed while automatic selection reveal remains available.");
console.log("Selection reveal checks passed: products on both axes and zoom levels, oversized/boundary cards, roadmap centering outside frozen chrome, undated/off-range row fallback, no-selection no-op, and unchanged product data.");
