import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
const start = source.indexOf("  // One neutral calendar surface: typography, sparse ticks, and year seams.");
const end = source.indexOf("\n  roadmapHitRegions.set(targetCanvas, regions);", start);
assert.ok(start >= 0 && end > start, "The check runs the actual canvas calendar header.");
const sandbox = {
  Math, String, ROADMAP_HEADER_HEIGHT: 88, ROADMAP_LEFT_WIDTH: 190, roadmapMonthWidth: 82,
  UI_PALETTE: { inkBlack: "#171717", whiteSmoke: "#eeeeec", greyOlive: "#929593", silver: "#c3c8c5", midGrey: "#949896", starDust: "#deded9" },
  drawYearSeamSegment() {}, roadmapSpanLabel: (count) => `${count} MONTH VIEW`, roadmapLabel: (month) => month,
};
vm.createContext(sandbox);
vm.runInContext(`function drawHeader(context, { range, stickyX = 0, stickyY = 0, clientWidth = 800, exportMode = false, selectedGuides = null }) {
  const timelineX = ROADMAP_LEFT_WIDTH, timelineWidth = range.count * roadmapMonthWidth, width = timelineX + timelineWidth + 24;
  const targetScroll = { clientWidth };
  ${source.slice(start, end)}
}`, sandbox);

function recordingContext() {
  const records = [], stack = [];
  let clip = null, path = [];
  const intersect = (first, second) => {
    if (!first) return { ...second };
    const left = Math.max(first.left, second.left), top = Math.max(first.top, second.top);
    return { left, top, right: Math.max(left, Math.min(first.right, second.right)), bottom: Math.max(top, Math.min(first.bottom, second.bottom)) };
  };
  const context = {
    font: "10px Arial", fillStyle: "", textAlign: "left", textBaseline: "alphabetic", strokeStyle: "", lineWidth: 1,
    save() { stack.push({ clip: clip && { ...clip }, font: this.font, fillStyle: this.fillStyle, textAlign: this.textAlign, textBaseline: this.textBaseline }); },
    restore() { const saved = stack.pop(); assert.ok(saved, "Every canvas restore has a matching save."); const { clip: savedClip, ...styles } = saved; clip = savedClip; Object.assign(this, styles); },
    beginPath() { path = []; }, rect(x, y, width, height) { assert.ok(width >= 0 && height >= 0); path.push({ left: x, top: y, right: x + width, bottom: y + height }); },
    clip() { assert.equal(path.length, 1, "Header clips are explicit rectangles."); clip = intersect(clip, path[0]); },
    fillText(text, x, y) { records.push({ text, x, y, font: this.font, clip: clip && { ...clip } }); },
    fillRect() {}, moveTo() {}, lineTo() {}, stroke() {},
    measureText(text) { return { width: String(text).length * Number(this.font.match(/(\d+)px/)?.[1] || 10) * 0.56 }; },
  };
  return { context, records, stack };
}
const month = (year, number = 1) => year * 12 + number - 1;
const range = (start, end) => ({ start, end, count: end - start + 1 });
function paint({ start = month(2026), end = month(2028, 12), left = 0, top = 0, width = 800, monthWidth = 82, exportMode = false } = {}) {
  const result = recordingContext(); sandbox.roadmapMonthWidth = monthWidth;
  sandbox.drawHeader(result.context, { range: range(start, end), stickyX: exportMode ? 0 : left, stickyY: exportMode ? 0 : top, clientWidth: width, exportMode });
  assert.equal(result.stack.length, 0);
  const years = result.records.filter((record) => record.font === "800 26px Arial");
  const labels = result.records.filter((record) => !/^\d{4}$/.test(record.text));
  return { ...result, years, labels };
}
const label = (result, year) => result.years.find((record) => record.text === String(year));
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: expected ${expected}, received ${actual}`);

// The canvas itself scrolls, so fixed headers add each scroll offset exactly once.
for (const monthWidth of [8, 17.25, 41.4, 82, 112]) {
  const span = 12 * monthWidth;
  for (const left of [0, 0.25, span * 0.2, span * 0.8, span - 0.5]) {
    for (const top of [0, 0.5, 120, 301.75]) {
      const result = paint({ left, top, monthWidth });
      const current = label(result, 2026);
      assert.ok(current, "The partly visible year is drawn until its calendar span ends.");
      near(current.x - left, 200, "A pinned year keeps a stable viewport x, including fractional scroll offsets");
      near(current.y - top, 31, "The year baseline stays fixed during vertical and diagonal panning");
      near(current.clip.left - left, 190, "The title clip starts beside the sticky lane rail");
      assert.ok(current.clip.right <= 190 + span + 1e-8, "An outgoing year never paints into the following year.");
      assert.equal(current.clip.top - top, 0); assert.equal(current.clip.bottom - top, 38);
      assert.ok(result.years.every((record) => record.clip.right <= Math.min(190 + 36 * monthWidth, left + 800) + 1e-8), "Every year is clipped at the viewport or timeline edge.");
    }
  }
}

// A title stays pinned near year-end instead of sliding backward to fit its text width.
const boundary = 12 * 82;
for (const left of [boundary - 90, boundary - 60, boundary - 30, boundary - 10, boundary - 0.25]) {
  const result = paint({ left });
  near(label(result, 2026).x - left, 200, "The outgoing title does not jump as its remaining space shrinks");
  const incoming = label(result, 2027);
  near(incoming.x - left, 200 + boundary - left, "The incoming title follows its year seam smoothly");
  assert.ok(label(result, 2026).clip.right <= incoming.clip.left, "Adjacent titles cannot overlap.");
}
assert.equal(label(paint({ left: boundary }), 2026), undefined, "An ended year disappears exactly at the calendar boundary.");
near(label(paint({ left: boundary }), 2027).x - boundary, 200, "The next year takes over the same pinned anchor at the boundary.");
near(label(paint({ left: boundary + 0.25 }), 2027).x - boundary - 0.25, 200, "The new title remains pinned after handoff.");

// Custom ranges begin and end partway through years; their seams still align with months.
const customStart = month(2026, 10), customEnd = month(2028, 2), customWidth = 31.5, firstSpan = 3 * customWidth;
for (const left of [0, firstSpan / 2, firstSpan - 0.125, firstSpan, firstSpan + 91.75]) {
  const result = paint({ start: customStart, end: customEnd, left, top: 84.25, monthWidth: customWidth, width: 390 });
  assert.ok(result.years.length > 0);
  const current = result.years[0]; near(current.x - left, 200, "A partial first year uses the same viewport anchor");
  assert.ok(result.years.every((record) => record.clip.left >= left + 190), "No partial year title can spill beneath the rail.");
  assert.ok(result.years.every((record) => record.clip.right <= left + 390), "A narrow viewport clips the right edge too.");
}
const grid = paint({ left: 213.25, top: 201.5 });
const jan = grid.labels.find((record) => record.text === "January" && record.x < 500);
near(jan.x, 190 + 82 / 2, "Month labels retain their calendar coordinates"); near(jan.y - 201.5, 74, "Month labels retain their fixed baseline");
const q1 = grid.labels.find((record) => record.text === "Q1" && record.x < 500);
near(q1.x, 190 + 3 * 82 / 2, "Quarter labels align to their original three-month span"); near(q1.y - 201.5, 52, "Quarter labels retain their fixed baseline");

const exported = paint({ left: 550, top: 140, width: 350, exportMode: true });
assert.deepEqual(exported.years.map((record) => record.text), ["2026", "2027", "2028"], "Exports render the complete timeline rather than the on-screen viewport.");
assert.deepEqual(exported.years.map((record) => record.x), [200, 200 + 12 * 82, 200 + 24 * 82]);
assert.ok(exported.years.every((record) => record.y === 31 && record.clip.top === 0));
assert.equal(paint({ width: 180 }).years.length, 0, "A viewport narrower than the fixed rail has no visible calendar titles.");
assert.equal(paint({ left: 4000 }).years.length, 0, "Clipped-off years are not drawn beyond the timeline.");

console.log("Roadmap header checks passed: stable two-axis year anchors, fractional offsets and zoom levels, clipped partial years, smooth boundary handoff, unchanged month/quarter alignment, narrow viewports, and complete exports.");
