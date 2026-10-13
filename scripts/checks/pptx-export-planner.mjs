import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

await import("../../public/js/reference-theme.js");
await import("../../public/js/pptx-pagination.js");
await import("../../public/js/pptx-editable.js");
await import("../../public/js/pptx-export-planner.js");
const planner = globalThis.PPTXExportPlanner, FONT = "HP Forma DJR Office";
const measureText = (text, size = 12) => text.length * .075 * size / 12;
const options = { mode: "merged", startMonth: "2026-01", endMonth: "2026-12", fontFace: FONT, measureText };
const product = (id, extra = {}) => ({ id, name: `Product ${id}`, startMonth: "2026-01", endMonth: "2026-12", fill: "#4D5054", status: "launched", ...extra });
const section = (id, count) => ({ id, name: `Category ${id}`, products: Array.from({ length: count }, (_, index) => product(`${id}-${index}`)) });
const productRows = plan => plan.slides.flatMap(slide => slide.rows.filter(row => row.kind === "product"));
const ids = plan => productRows(plan).map(row => row.product.id);
const originalIds = sections => sections.flatMap(entry => entry.products.map(item => item.id));
const almost = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-7, message || `${actual} != ${expected}`);

assert.equal(planner.EXPORT_FONT_FACE, FONT);
assert.equal(planner.FONT_SIZE, 12);
assert.equal(planner.COMPACT_FONT_SIZE, 7);
assert.equal(planner.COMPACT_ROW_HEIGHT, .16);
assert.equal(planner.COMPACT_BAR_HEIGHT, .08);
for (const count of [0, 1, 16, 25]) {
  const source = [section("a", count)], plan = planner.planRoadmap(source, options);
  assert.equal(plan.requiresDecision, false);
  assert.equal(plan.slides.length, 1);
  assert.equal(plan.slides[0].kind, "roadmap-merged");
  assert.equal(plan.minimumFontSize, 7);
  assert.equal(plan.columnCount, 1);
  assert.deepEqual(plan.canvas, planner.STANDARD_CANVAS);
  assert.deepEqual(ids(plan), originalIds(source));
  assert.ok(productRows(plan).every(row => row.height === .16));
}

const source = Array.from({ length: 11 }, (_, category) => ({
  id: `category-${category}`, name: `Category ${category}`,
  products: Array.from({ length: category < 7 ? 18 : 17 }, (_, index) => product(`c${category}-p${index}`, {
    family: `Family ${Math.floor(index / 4)}`, endMonth: "2028-12",
  })),
}));
assert.equal(originalIds(source).length, 194);
const before = JSON.stringify(source), blocked = planner.planRoadmap(source, { ...options, endMonth: "2028-12" });
assert.equal(blocked.requiresDecision, true);
assert.deepEqual(blocked.slides, [], "over-capacity data cannot be silently truncated by default");
assert.equal(blocked.selectedProductCount, 194);
assert.equal(blocked.cutoff.includedCount, 136, "the independently counted short-name/family fixture fits29.72in of flow under31.5in total height");
assert.equal(blocked.cutoff.excludedCount, 58);
assert.deepEqual(blocked.cutoff.lastIncluded, { id: "c7-p9", name: "Product c7-p9", categoryName: "Category 7" });
assert.deepEqual(blocked.cutoff.firstExcluded, { id: "c7-p10", name: "Product c7-p10", categoryName: "Category 7" });
assert.equal(planner.planRoadmap(source, { ...options, endMonth: "2028-12", limitToFit: "true" }).requiresDecision, true, "only explicit true accepts a partial export");
const large = planner.planRoadmap(source, { ...options, endMonth: "2028-12", limitToFit: true });
assert.equal(large.requiresDecision, false);
assert.equal(large.slides.length, 1, "all actual product rows stay on one merged slide");
assert.ok(large.canvas.width > planner.STANDARD_CANVAS.width && large.canvas.width <= 56);
assert.ok(large.canvas.height > planner.STANDARD_CANVAS.height && large.canvas.height <= 31.5);
almost(large.canvas.width / large.canvas.height, 16 / 9);
assert.equal(large.columnCount, 1, "dense merged data stays under one shared calendar");
assert.deepEqual(ids(large), originalIds(source).slice(0, 136), "exactly the explicitly accepted fitting prefix is exported once and in order");
assert.equal(new Set(ids(large)).size, 136);
assert.equal(large.selectedTotal, 194);
assert.equal(large.includedProductCount, 136);
assert.equal(large.excludedProductCount, 58);
assert.deepEqual(large.cutoff, blocked.cutoff);
assert.equal(JSON.stringify(source), before, "planning preserves all source values and arrays");
assert.ok(large.slides[0].rows.every(row => ["category", "family", "product"].includes(row.kind)), "no aggregate category summaries replace product evidence");
const columns = large.slides[0].columns;
assert.ok(columns.every(column => column.rows[0].kind === "category" && column.rows[0].top === 0));
assert.ok(columns.every(column => column.height <= column.frame.height + 1e-7));
assert.equal(columns.length, 1);
assert.equal(columns[0].rows.filter(row => row.kind === "category").length, 8, "the single prefix never repeats category headings for continuation columns");
assert.ok(columns.every(column => column.frame.y === 1.25));
assert.ok(columns.every(column => column.frame.timelineWidth / 36 >= large.monthWidth - 1e-7));
assert.ok(columns.every(column => column.frame.x + column.frame.width <= large.canvas.width));
assert.equal(planner.planRoadmap(source, { ...options, endMonth: "2028-12", overflow: "overview-details" }).slides.length, 0, "obsolete overflow input cannot authorize a summary or partial export");
const fullFitting = planner.planRoadmap([section("complete", 150)], { ...options, endMonth: "2028-12" });
assert.equal(fullFitting.requiresDecision, false);
assert.equal(fullFitting.cutoff, undefined);
assert.equal(ids(fullFitting).length, 150, "a complete fitting selection needs no cutoff checkbox");
const details = planner.planRoadmap(source, { ...options, mode: "categories", endMonth: "2028-12" });
assert.equal(details.minimumFontSize, 12);
assert.ok(details.slides.every(slide => slide.kind === "roadmap-detail" && slide.height <= planner.FRAME.height + 1e-7));
assert.deepEqual(ids(details), originalIds(source));
const wideCategory = planner.planRoadmap([section("wide", 3)], { ...options, mode: "categories", startMonth: "2025-12", endMonth: "2035-01" });
assert.equal(wideCategory.requiresDecision, false);
assert.ok(wideCategory.canvas.width > planner.STANDARD_CANVAS.width && wideCategory.canvas.width <= 56);
assert.ok((wideCategory.slides[0].frame.width - planner.FRAME.labelWidth) / wideCategory.range.count >= wideCategory.monthWidth);
assert.deepEqual(ids(wideCategory), ["wide-0", "wide-1", "wide-2"]);

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
assert.deepEqual(ids(datePlan), ["left", "right", "missing", "invalid", "inverted"]);
assert.equal(datePlan.outsideRangeCount, 2);
assert.equal(datePlan.unscheduledCount, 3, "invalid/unknown dates retain their actual named product row");
assert.equal(productRows(datePlan).find(row => row.product.id === "missing").product.dateLines.join(" "), "Dates TBD. In development");
for (const values of [{ startMonth: "invalid" }, { endMonth: "2025-12" }]) {
  const invalid = planner.planRoadmap(source, { ...options, ...values });
  assert.equal(invalid.requiresDecision, true); assert.equal(invalid.validRange, false); assert.deepEqual(invalid.slides, []);
}
const impossible = planner.planRoadmap(source, { ...options, startMonth: "1900-01", endMonth: "2100-12" });
assert.equal(impossible.requiresDecision, true);
assert.equal(impossible.validRange, true);
assert.deepEqual(impossible.slides, []);
assert.match(impossible.reason, /56-inch/);
assert.equal(impossible.cutoff, undefined, "a calendar wider than56in cannot be solved by dropping products");
assert.equal(planner.planRoadmap(source, { ...options, startMonth: "1900-01", endMonth: "2100-12", limitToFit: true }).requiresDecision, true);
const tooTall = planner.planRoadmap([section("tall", 400)], options);
assert.equal(tooTall.requiresDecision, true);
assert.deepEqual(tooTall.slides, [], "a stack above56in is rejected without splitting or shrinking names");
assert.throws(() => planner.planRoadmap([section("duplicate", 1), section("duplicate", 1)], options), /distinct identities/);
assert.throws(() => planner.planRoadmap([{ id: "a", products: [product("dup")] }, { id: "b", products: [product("dup")] }], options), /distinct identities/);
assert.throws(() => planner.planRoadmap(source, { ...options, measureText: () => NaN }), /could not be measured/);
const longName = "HyperX 3D Print - Headband Decoration - Werewolf Ears with a long distinguishing configuration";
const priced = planner.planRoadmap([{ id: "priced", name: "Priced", products: [
  product("priced", { name: longName, priceLabel: "39.99 (NA) / 49.99 (RoW)", statusLabel: "Launched" }),
  product("ordinary", { priceLabel: "$149.99" }),
] }], options);
const pricedRow = productRows(priced)[0];
assert.equal(pricedRow.product.lines.join(" "), longName);
assert.ok(pricedRow.product.lines.every(line => measureText(line, 7) <= 2.60));
assert.equal(pricedRow.product.priceLines.join(" "), "39.99 (NA) / 49.99 (RoW)");
almost(pricedRow.height, Math.max(pricedRow.product.lines.length, pricedRow.product.priceLines.length) * .16);
assert.equal(productRows(priced)[1].height, .16, "ordinary MSRP stays inline rather than increasing every product row");
assert.equal(priced.slides[0].frame.priceWidth, .52);
assert.equal(planner.wrapName("W".repeat(100), 1, text => measureText(text, 7)).join(""), "W".repeat(100));

const configured = { defineLayout(value) { this.definition = value; } };
assert.deepEqual(planner.configureDeckCanvas(configured), planner.STANDARD_CANVAS);
assert.equal(configured.layout, "LAYOUT_WIDE");
planner.configureDeckCanvas(configured, large);
assert.equal(configured.layout, "PPC_COMPACT_ROADMAP");
assert.deepEqual(configured.definition, { name: "PPC_COMPACT_ROADMAP", ...large.canvas });
assert.throws(() => planner.configureDeckCanvas(configured, { canvas: { width: 57, height: 57 * 9 / 16 } }), /invalid/);
assert.throws(() => planner.configureDeckCanvas(configured, { canvas: { width: 20, height: 20 } }), /invalid/, "all final slides retain16:9");

const controls = {
  '#pptxRoadmapOptions': {}, '#pptxRoadmapLimitOptions': {}, '#pptxRoadmapCutoff': {}, '#pptxRoadmapFit': {}, '#pptxRoadmapCoverage': {},
  '#pptxRoadmapStart': { value: "2026-01" }, '#pptxRoadmapEnd': { value: "2028-12" }, '#pptxRoadmapLimit': { checked: false },
  'input[name="pptxRoadmapLayout"]:checked': { value: "merged" },
};
const form = { querySelector: selector => controls[selector] || null };
assert.equal(planner.readOptions(form).limitToFit, false);
planner.syncDialog(form, blocked);
assert.equal(controls['#pptxRoadmapLimitOptions'].hidden, false);
assert.match(controls['#pptxRoadmapCutoff'].textContent, /first 136 of 194 products/);
assert.ok(controls['#pptxRoadmapCutoff'].textContent.includes("Category 7 — Product c7-p9"));
assert.ok(controls['#pptxRoadmapCutoff'].textContent.includes("Product c7-p10"));
assert.match(controls['#pptxRoadmapCutoff'].textContent, /would be excluded if you choose/);
controls['#pptxRoadmapLimit'].checked = true;
assert.equal(planner.readOptions(form).limitToFit, true);
planner.syncDialog(form, large);
assert.match(controls['#pptxRoadmapCoverage'].textContent, /includes 136 and excludes 58 by your choice/);
planner.syncDialog(form, impossible);
assert.equal(controls['#pptxRoadmapLimitOptions'].hidden, true);
assert.equal(controls['#pptxRoadmapCutoff'].textContent, "");
planner.syncDialog(form, large, { includeRoadmap: false });
assert.equal(controls['#pptxRoadmapOptions'].hidden, true);
assert.equal(controls['#pptxRoadmapLimitOptions'].hidden, true);

for (const [sourceWidth, sourceHeight] of [[1000, 300], [300, 1000], [3386, 1707.84]]) {
  const rect = globalThis.PPTXEditable.containTop(sourceWidth, sourceHeight, .38, .74, 12.55, 6.33);
  assert.equal(rect.x, .38); assert.equal(rect.y, .74); assert.ok(rect.w <= 12.55 && rect.h <= 6.33);
  almost(rect.w / rect.h, sourceWidth / sourceHeight);
}
const unequal = globalThis.PPTXPagination.paginateProductLanes([{ id: "short" }, { id: "long" }], [
  ...Array.from({ length: 14 }, (_, order) => ({ id: `short-${order}`, laneId: "short", order })),
  ...Array.from({ length: 27 }, (_, order) => ({ id: `long-${order}`, laneId: "long", order })),
]);
assert.equal(unequal.at(-1).rows[0].slot, 0);

// Serialize the real bundled exporter and inspect native OOXML, not a mock
// declaration of requested font sizes. Every product is an editable group.
const library = { console, setTimeout, clearTimeout, setImmediate, clearImmediate, Buffer, Blob, URL, TextEncoder, TextDecoder };
vm.createContext(library);
for (const file of ["vendor/pptxgen.bundle.js", "js/reference-theme.js", "js/pptx-editable.js", "js/pptx-export-planner.js"]) vm.runInContext(await readFile(new URL(`../../public/${file}`, import.meta.url), "utf8"), library);
const buildFile = async plan => {
  const deck = new library.PptxGenJS(); library.PPTXExportPlanner.configureDeckCanvas(deck, plan);
  for (const slide of plan.slides) library.PPTXExportPlanner.addSlide(deck, slide);
  return library.JSZip.loadAsync(await library.PPTXEditable.serialize(deck), { checkCRC32: true });
};
const zip = await buildFile(large), xml = await zip.file("ppt/slides/slide1.xml").async("string");
const groups = [...xml.matchAll(/<p:grpSp>[\s\S]*?<\/p:grpSp>/g)].map(match => match[0]);
assert.equal(groups.length, 136, "the native file contains only the explicitly accepted136-product prefix");
for (const group of groups) {
  assert.ok(group.includes(`<a:latin typeface="${FONT}"`));
  assert.ok([...group.matchAll(/\bsz="(\d+)"/g)].every(match => Number(match[1]) === 700));
  assert.equal((group.match(/<p:sp>/g) || []).length, 2);
  assert.ok(!group.includes("<p:pic>"));
  assert.match(group, /<a:ext cx="\d+" cy="73152"\/>/, "scheduled bars are exactly0.08in in the native file");
  assert.match(group, /<a:ext cx="\d+" cy="146304"\/>/, "single-line groups have0.16in native bounds");
}
assert.ok(!xml.includes("Jost") && !xml.includes("Arial"), "all roadmap text uses only the export font family");
assert.ok(!xml.includes("Category summary") && !xml.includes("Category coverage"));
assert.equal((xml.match(/name="Calendar: \d+:month:/g) || []).length, large.columnCount * 36);
assert.equal((xml.match(/name="Calendar: \d+:quarter:/g) || []).length, large.columnCount * 12);
assert.equal((xml.match(/name="Calendar: \d+:year:/g) || []).length, large.columnCount * 3);
assert.ok(!/<a:t>Q[1-4] \d/.test(xml), "the quarter track does not redundantly append the year");
const presentation = await zip.file("ppt/presentation.xml").async("string");
assert.ok(presentation.includes(`cx="${Math.round(large.canvas.width * 914400)}" cy="${Math.round(large.canvas.height * 914400)}"`));
const priceZip = await buildFile(priced), priceXml = await priceZip.file("ppt/slides/slide1.xml").async("string");
const priceGroups = [...priceXml.matchAll(/<p:grpSp>[\s\S]*?<\/p:grpSp>/g)].map(match => match[0]);
assert.ok(priceGroups.every(group => (group.match(/<p:sp>/g) || []).length === 3));
assert.ok(priceXml.includes("$149.99") && priceXml.includes('name="Status: Launched"'));
const dateZip = await buildFile(datePlan), dateXml = await dateZip.file("ppt/slides/slide1.xml").async("string");
assert.ok(dateXml.includes("Dates TBD. In development"));
const categoryZip = await buildFile(wideCategory), categoryXml = await categoryZip.file("ppt/slides/slide1.xml").async("string");
assert.equal((categoryXml.match(/name="Calendar: 0:month:/g) || []).length, 110);
assert.ok([...categoryXml.matchAll(/<p:grpSp>[\s\S]*?<\/p:grpSp>/g)].every(match => [...match[0].matchAll(/\bsz="(\d+)"/g)].every(size => Number(size[1]) === 1200)), "long category periods enlarge the calendar without inflating12pt product labels");

// Probe partial years, all months, fixed bar geometry and object bounds through
// the exact renderer. Only intentional calendar seams carry visible strokes.
const drawn = [];
const recorder = { ShapeType: { rect: "rect", line: "line" }, addSlide: () => ({ addShape: (kind, rect) => drawn.push({ kind, ...rect }), addText: (text, rect) => drawn.push({ text, ...rect }) }) };
const partial = planner.planRoadmap([section("axis", 1)], { ...options, startMonth: "2025-12", endMonth: "2035-01" });
assert.equal(partial.requiresDecision, false);
planner.addSlide(recorder, partial.slides[0]);
assert.equal(drawn.filter(item => item.objectName?.includes(":month:")).length, 110);
assert.equal(drawn.find(item => item.objectName?.includes(":year:")).text, "2025");
assert.ok(drawn.filter(item => item.objectName?.includes(":year:")).every(item => item.fontSize === 16));
assert.ok(drawn.filter(item => item.text === "Product axis-0").every(item => item.fontSize === 7));
assert.ok(drawn.every(item => item.x >= 0 && item.y >= 0 && item.x + item.w <= partial.canvas.width + 1e-6 && item.y + item.h <= partial.canvas.height + 1e-6));
assert.ok(drawn.filter(item => item.kind !== "line" && !item.text).every(item => item.line.width === 0 || item.line.transparency === 100));
const index = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
assert.match(index, /value="categories" checked/);
assert.ok(!index.includes("One slide overview + detailed pages"));
assert.ok(index.indexOf('src="js/pptx-export-planner.js"') < index.indexOf('src="js/app.js"'));
console.log("PPTX planner checks passed: exact7pt native HP Forma groups,0.16in rows/0.08in bars, one shared calendar on16:9, explicit named cutoff/partial-export acceptance, all monthly labels, exact range/TBD/MSRP coverage and source immutability.");
