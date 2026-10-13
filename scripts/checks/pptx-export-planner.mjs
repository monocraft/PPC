import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

await import("../../public/js/reference-theme.js");
await import("../../public/js/pptx-pagination.js");
await import("../../public/js/pptx-editable.js");
await import("../../public/js/pptx-export-planner.js");
const planner = globalThis.PPTXExportPlanner;
const options = { mode: "merged", startMonth: "2026-01", endMonth: "2026-12", measureText: (text) => text.length * .075 };
const product = (id, extra = {}) => ({ id, name: `Product ${id}`, startMonth: "2026-01", endMonth: "2026-12", fill: "#4D5054", status: "launched", ...extra });
const section = (id, count) => ({ id, name: `Category ${id}`, products: Array.from({ length: count }, (_, index) => product(`${id}-${index}`)) });
const detailIds = (plan) => plan.slides.filter((slide) => slide.kind !== "roadmap-overview").flatMap((slide) => slide.rows.filter((row) => row.kind === "product").map((row) => row.product.id));

assert.equal(planner.FONT_SIZE, 12);
for (const count of [0, 1, 16]) {
  const plan = planner.planRoadmap([section("a", count)], options);
  assert.equal(plan.requiresDecision, false);
  assert.equal(plan.slides.length, 1);
  assert.equal(plan.slides[0].kind, "roadmap-merged");
  assert.equal(plan.minimumFontSize, 12);
  assert.deepEqual(detailIds(plan), section("a", count).products.map((entry) => entry.id));
}
const source = [section("a", 19), section("b", 7)];
const before = JSON.stringify(source);
const blocked = planner.planRoadmap(source, options);
assert.equal(blocked.exactFits, false);
assert.equal(blocked.requiresDecision, true);
assert.equal(blocked.slides.length, 0, "an unresolved fit decision cannot silently create a tiny slide");
assert.match(blocked.reason, /26 products across 2 categories/);
const fallback = planner.planRoadmap(source, { ...options, overflow: "overview-details" });
assert.equal(fallback.requiresDecision, false);
assert.equal(fallback.slides[0].kind, "roadmap-overview");
assert.deepEqual(detailIds(fallback), source.flatMap((entry) => entry.products.map((item) => item.id)), "all products occur exactly once on readable detail pages after the overview");
assert.equal(new Set(detailIds(fallback)).size, 26);
assert.ok(fallback.slides.every((slide) => slide.height <= planner.FRAME.height + 1e-9));
assert.deepEqual(fallback.slides.slice(1).map((slide) => slide.rows[0].top), [0, 0, 0], "every detail continuation begins at the top");
const details = planner.planRoadmap(source, { ...options, overflow: "details" });
assert.equal(details.slides.some((slide) => slide.kind === "roadmap-overview"), false);
assert.deepEqual(detailIds(details), detailIds(fallback));
assert.equal(JSON.stringify(source), before, "export planning leaves products, categories, statuses and dates untouched");

const dated = [{ id: "dates", name: "Dates", products: [
  product("left", { startMonth: "2025-01", endMonth: "2026-02" }),
  product("right", { startMonth: "2026-11", endMonth: "2027-12" }),
  product("past", { startMonth: "2025-01", endMonth: "2025-12" }),
  product("future", { startMonth: "2027-01", endMonth: "2028-12" }),
  product("missing", { startMonth: "", endMonth: "", statusLabel: "In development" }),
  product("invalid", { startMonth: "2026-13", endMonth: "2026-05" }),
  product("inverted", { startMonth: "2026-12", endMonth: "2026-01" }),
] }];
const datePlan = planner.planRoadmap(dated, options);
assert.deepEqual(detailIds(datePlan), ["left", "right", "missing", "invalid", "inverted"]);
assert.equal(datePlan.outsideRangeCount, 2);
assert.equal(datePlan.unscheduledCount, 3, "missing or invalid dates remain explicit, rather than disappearing");
assert.deepEqual(datePlan.slides[0].rows.find(row => row.product?.id === "missing").product.dateLines, ["Dates TBD. In development"], "unscheduled products keep their known stage in readable native text");
for (const values of [{ startMonth: "invalid" }, { endMonth: "2025-12" }]) {
  const invalid = planner.planRoadmap(source, { ...options, ...values });
  assert.equal(invalid.requiresDecision, true);
  assert.equal(invalid.validRange, false);
  assert.deepEqual(invalid.slides, []);
}
assert.throws(() => planner.planRoadmap([section("duplicate", 1), section("duplicate", 1)], options), /distinct identities/);
assert.throws(() => planner.planRoadmap([{ id: "a", products: [product("dup")] }, { id: "b", products: [product("dup")] }], options), /distinct identities/);
const longName = "HyperX 3D Print - Headband Decoration - Werewolf Ears with a long distinguishing configuration";
const longPlan = planner.planRoadmap([{ id: "long", products: [product("long", { name: longName })] }], options);
const nameLines = longPlan.slides[0].rows.find((row) => row.kind === "product").product.lines;
assert.equal(nameLines.join(" "), longName);
assert.ok(nameLines.length > 1 && nameLines.every((line) => options.measureText(line) <= planner.FRAME.labelWidth - .22));
const token = "W".repeat(100);
assert.equal(planner.wrapName(token, 1, options.measureText).join(""), token, "long unbroken names are wrapped without elision");
const priced = planner.planRoadmap([{ id: "priced", products: [product("priced", { name: longName, priceLabel: "$149.99", statusLabel: "Launched" })] }], options);
const pricedRow = priced.slides[0].rows.find(row => row.kind === "product");
assert.deepEqual(pricedRow.product.priceLines, ["$149.99"]);
assert.equal(pricedRow.height, (pricedRow.product.lines.length + 1) * .2 + .07, "enabled saved MSRP uses measured space, rather than shrinking product names");
const manyCategories = planner.planRoadmap(Array.from({ length: 20 }, (_, index) => section(`many-${index}`, 2)), { ...options, overflow: "overview-details" });
assert.equal(manyCategories.overviewFits, false);
assert.equal(manyCategories.requiresDecision, true, "an oversized overview is also rejected instead of silently shrunk");
assert.equal(planner.planRoadmap(Array.from({ length: 20 }, (_, index) => section(`many-${index}`, 2)), { ...options, overflow: "details" }).requiresDecision, false);

const continuous = [{ id: "coverage", products: [product("one", { endMonth: "2026-02" }), product("two", { startMonth: "2026-02", endMonth: "2026-04" }), product("three", { startMonth: "2026-07", endMonth: "2026-08" }), ...Array.from({ length: 20 }, (_, index) => product(`unscheduled-${index}`, { startMonth: "", endMonth: "" }))] }];
const coverage = planner.planRoadmap(continuous, { ...options, overflow: "overview-details" });
assert.deepEqual(coverage.slides[0].rows[0].intervals, [
  { start: planner.monthIndex("2026-01"), end: planner.monthIndex("2026-04") },
  { start: planner.monthIndex("2026-07"), end: planner.monthIndex("2026-08") },
], "category coverage combines overlapping schedules while preserving gaps");

for (const [sourceWidth, sourceHeight] of [[1000, 300], [300, 1000], [3386, 1707.84]]) {
  const rect = globalThis.PPTXEditable.containTop(sourceWidth, sourceHeight, .38, .74, 12.55, 6.33);
  assert.equal(rect.x, .38); assert.equal(rect.y, .74);
  assert.ok(rect.w <= 12.55 && rect.h <= 6.33);
  assert.ok(Math.abs(rect.w / rect.h - sourceWidth / sourceHeight) < 1e-8);
}
assert.throws(() => globalThis.PPTXEditable.containTop(0, 50, 0, 0, 10, 5), /invalid dimensions/);
const unequal = globalThis.PPTXPagination.paginateProductLanes([{ id: "short" }, { id: "long" }], [
  ...Array.from({ length: 14 }, (_, order) => ({ id: `short-${order}`, laneId: "short", order })),
  ...Array.from({ length: 27 }, (_, order) => ({ id: `long-${order}`, laneId: "long", order })),
]);
assert.equal(unequal.at(-1).rows[0].slot, 0, "a sparse final lane no longer starts in the middle of its page");

// Inspect the actual native file, using the same bundled library and serializer
// as the application. Names/timelines are grouped, editable objects.
const library = { console, setTimeout, clearTimeout, setImmediate, clearImmediate, Buffer, Blob, URL, TextEncoder, TextDecoder };
vm.createContext(library);
for (const file of ["vendor/pptxgen.bundle.js", "js/reference-theme.js", "js/pptx-editable.js", "js/pptx-export-planner.js"]) {
  vm.runInContext(await readFile(new URL(`../../public/${file}`, import.meta.url), "utf8"), library);
}
const deck = new library.PptxGenJS(); deck.layout = "LAYOUT_WIDE";
for (const slide of datePlan.slides) library.PPTXExportPlanner.addSlide(deck, slide, { fontFace: "Jost" });
for (const slide of fallback.slides) library.PPTXExportPlanner.addSlide(deck, slide, { fontFace: "Jost" });
const zip = await library.JSZip.loadAsync(await library.PPTXEditable.serialize(deck), { checkCRC32: true });
const xmlSlides = [];
for (let index = 0; index < deck._slides.length; index++) xmlSlides.push(await zip.file(`ppt/slides/slide${index + 1}.xml`).async("string"));
const groups = xmlSlides.flatMap((xml) => [...xml.matchAll(/<p:grpSp>[\s\S]*?<\/p:grpSp>/g)].map((match) => match[0]));
assert.equal(groups.length, 31, "five range-selected names plus all26 fallback products remain separate native editable groups");
for (const xml of groups) {
  assert.ok(xml.includes('<a:latin typeface="Jost"'));
  assert.ok([...xml.matchAll(/\bsz="(\d+)"/g)].every((match) => Number(match[1]) >= 1200), "every native product label is at least12pt");
  assert.equal((xml.match(/<p:sp>/g) || []).length, 2, "each group retains its exact name and timeline or dates-TBD field");
  assert.ok(!xml.includes("<p:pic>"), "timeline evidence stays native instead of rasterized");
}
assert.ok(xmlSlides[1].includes("Category summaries; full product names and statuses follow on detailed pages."));
const priceDeck = new library.PptxGenJS(); priceDeck.layout = "LAYOUT_WIDE";
library.PPTXExportPlanner.addSlide(priceDeck, priced.slides[0], { fontFace: "Jost" });
const priceZip = await library.JSZip.loadAsync(await library.PPTXEditable.serialize(priceDeck));
const priceXml = await priceZip.file("ppt/slides/slide1.xml").async("string");
assert.ok(priceXml.includes("$149.99") && priceXml.includes('name="Status: Launched"'), "enabled MSRP and the meaning of native status colors remain visible in the actual file");
const axisTexts = [];
const axisRecorder = { ShapeType: { rect: "rect" }, addSlide: () => ({ addShape() {}, addText: (text, rect) => { if (rect.y === .89) axisTexts.push({ text, rect }); } }) };
const clippedYear = planner.planRoadmap([section("axis", 1)], { ...options, startMonth: "2021-08", endMonth: "2031-09" });
planner.addSlide(axisRecorder, clippedYear.slides[0]);
assert.equal(axisTexts[0].text, "2021");
assert.ok(axisTexts[0].rect.w >= .42, "partial first-year axis labels reserve measured text width at12pt without changing the timeline scale");
assert.equal((await zip.file("ppt/presentation.xml").async("string")).includes('cx="12192000" cy="6858000"'), true);
assert.ok(xmlSlides.every((xml) => [...xml.matchAll(/<a:ln\b[^>]*>[\s\S]*?<\/a:ln>/g)].every((match) =>
  match[0] === "<a:ln></a:ln>" || /\bw="0"/.test(match[0]) || /<a:alpha val="0"\s*\/>/.test(match[0]))), "ordinary roadmap shapes carry no visible decorative outlines");
const index = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
assert.match(index, /value="categories" checked/);
assert.match(index, /Merge into one slide/);
assert.match(index, /One slide overview \+ detailed pages/);
assert.ok(index.indexOf('src="js/pptx-export-planner.js"') < index.indexOf('src="js/app.js"'));
console.log("PPTX planner checks passed: top-aligned cards/continuations, readable native merged labels, explicit fit decisions, full fallback coverage, exact range/TBD behavior, metadata immutability, grouped timelines and valid editable OOXML.");
