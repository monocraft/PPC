import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

await import("../../public/js/date-precision.js");
await import("../../public/js/ffs-roadmap.js");
await import("../../public/js/pptx-export-planner.js");
const model = globalThis.PortfolioFfsRoadmap, planner = globalThis.PPTXExportPlanner;
const fixture = (id, date, extra = {}) => ({ id, name: `Working ${id}`, ffsDate: date,
  generalAvailabilityDate: "2050-01-01", endManufacturingDate: "2055-12-31",
  roadmap: { startMonth: "2050-01", endMonth: "2055-12", status: "in-planning" }, ...extra });
const quarter = globalThis.PortfolioDatePrecision.parseQuarter("Q2 2028");
const products = [
  fixture("day", "2028-02-29", { roadmap: { status: "in-development" } }),
  fixture("quarter", quarter.start, { plc: { fields: { ffsDate: { value: quarter.start, period: quarter } } } }),
  fixture("clipped", "2027-12-15", { plc: { fields: { ffsDate: { value: "2027-12-15", period: {
    precision: "range", basis: "calendar", start: "2027-12-15", end: "2028-01-15",
  } } } } }),
  fixture("before", "2027-01-05"),
  fixture("after", "2038-01-01"),
  fixture("missing", "", { roadmap: { status: "in-development" } }),
  fixture("invalid", "2028-02-30"),
  fixture("review", "2037-12-31", { plc: { fields: { ffsDate: { value: "2037-12-31", candidates: ["2037-12-31", "2038-01-31"] } } } }),
];
const before = JSON.stringify(products);
const sections = [{ id: "headsets", name: "Headsets", products: products.map(product => ({
  id: product.id, name: product.name, nameProvisional: product.id === "day",
  startMonth: product.roadmap.startMonth || "2050-01", endMonth: "2055-12",
  status: model.status(product), statusLabel: model.status(product) === "in-development" ? "In development" : "In planning",
  fill: "#2FA27D", ffs: model.period(product),
})) }];
const options = { mode: "merged", timelineMode: "ffs", startMonth: "2028-01", endMonth: "2037-12",
  measureText: (text, size = 12) => String(text).length * .075 * size / 12 };
const plan = planner.planRoadmap(sections, options);
const rows = plan.slides.flatMap(slide => slide.rows.filter(row => row.kind === "product"));
const byId = id => rows.find(row => row.product.id === id).product;
assert.equal(plan.requiresDecision, false);
assert.equal(plan.timelineMode, "ffs");
assert.equal(plan.range.count, 120);
assert.deepEqual(rows.map(row => row.product.id), products.map(product => product.id), "FFS TBD and out-of-range products remain named rows in the ten-year export.");
assert.equal(plan.selectedProductCount, 8);
assert.equal(plan.outsideRangeCount, 2);
assert.equal(plan.unscheduledCount, 2, "Valid GA/EM dates never fill missing or invalid FFS.");
assert.equal(byId("day").point, true);
assert.ok(Math.abs(byId("day").pointPosition - (2028 * 12 + 1 + 28.5 / 29)) < 1e-8, "Leap-day points use the same calendar-day midpoint as the map.");
assert.equal(byId("quarter").point, false);
assert.equal(byId("quarter").endExclusive - byId("quarter").start, 3, "A quarter window covers all three months inclusively.");
assert.match(byId("before").dateLines.join(" "), /Before view\. FFS Jan 5, 2027 · Estimate · In planning/);
assert.match(byId("after").dateLines.join(" "), /After view\. FFS Jan 1, 2038 · Estimate/);
assert.equal(byId("missing").dateLines.join(" "), "FFS TBD · In development");
assert.match(byId("review").dateLines.join(" "), /Review timing/);
assert.equal(JSON.stringify(products), before, "Export planning leaves source milestones, evidence, and lifecycle dates untouched.");

const drawn = [], recorder = { ShapeType: { rect: "rect", line: "line", donut: "donut" }, addSlide: () => ({
  addShape: (kind, rectangle) => drawn.push({ kind, ...rectangle }), addText: (text, rectangle) => drawn.push({ text, ...rectangle }),
}) };
planner.addSlide(recorder, plan.slides[0]);
const frame = plan.slides[0].columns[0].frame, monthWidth = frame.timelineWidth / plan.range.count;
const dayShape = drawn.find(shape => shape.objectName === "ppc-roadmap-0-part-1");
assert.equal(dayShape.kind, "donut");
assert.equal(drawn.find(shape => shape.objectName === "ppc-roadmap-0-part-0").bold, true, "The full product name is the primary Hashout export label.");
assert.equal(drawn.find(shape => shape.objectName === "ppc-roadmap-0-part-2").bold, undefined, "Date, stage, and estimate details retain secondary text emphasis.");
const mapPoint = model.geometry(products[0], plan.range, 0, { leftWidth: frame.timelineX, monthWidth, rowHeight: 32 });
assert.ok(Math.abs(dayShape.x + dayShape.w / 2 - mapPoint.centerX) < 1e-8, "Native PowerPoint points align with map geometry independently of GA/EM.");
const quarterShape = drawn.find(shape => shape.objectName === "ppc-roadmap-1-part-1");
assert.ok(Math.abs(quarterShape.w - monthWidth * 3) < 1e-8);
assert.equal(quarterShape.line.dashType, "dash");
assert.equal(drawn.find(shape => shape.objectName === "ppc-roadmap-2-part-1").x, frame.timelineX, "A partially visible FFS window clips at the first calendar boundary.");
assert.equal(drawn.filter(shape => shape.kind === "donut").length, 2);
assert.ok(drawn.filter(shape => shape.kind === "donut").every(shape => shape.w === .10), "Day markers stay legible at the final horizon day instead of collapsing at the edge.");
assert.ok(drawn.every(item => item.x >= 0 && item.y >= 0 && item.x + item.w <= plan.canvas.width + 1e-6 && item.y + item.h <= plan.canvas.height + 1e-6));
assert.equal(drawn.filter(item => item.objectName?.includes(":month:")).length, 120);
assert.equal(drawn.filter(item => item.objectName?.includes(":year:")).length, 10);

// Inspect the actual native PowerPoint file, including independent editable
// groups and geometry, rather than accepting renderer calls alone.
const runtime = { console, setTimeout, clearTimeout, setImmediate, clearImmediate, Buffer, Blob, URL, TextEncoder, TextDecoder };
vm.createContext(runtime);
for (const file of ["vendor/pptxgen.bundle.js", "js/reference-theme.js", "js/pptx-editable.js", "js/pptx-export-planner.js"]) {
  vm.runInContext(await readFile(new URL(`../../public/${file}`, import.meta.url), "utf8"), runtime);
}
for (const mode of ["merged", "categories"]) {
  const exportPlan = planner.planRoadmap(sections, { ...options, mode });
  const deck = new runtime.PptxGenJS();
  runtime.PPTXExportPlanner.configureDeckCanvas(deck, exportPlan);
  for (const slide of exportPlan.slides) runtime.PPTXExportPlanner.addSlide(deck, slide);
  const zip = await runtime.JSZip.loadAsync(await runtime.PPTXEditable.serialize(deck), { checkCRC32: true });
  const xml = (await Promise.all(exportPlan.slides.map((_, index) => zip.file(`ppt/slides/slide${index + 1}.xml`).async("string")))).join("\n");
  const groups = [...xml.matchAll(/<p:grpSp>[\s\S]*?<\/p:grpSp>/g)].map(match => match[0]);
  assert.equal(groups.length, products.length);
  assert.equal((xml.match(/prst="donut"/g) || []).length, 2);
  assert.ok(xml.includes("FFS Q2 2028 · Estimate · In planning"));
  assert.ok(xml.includes("FFS TBD · In development"));
  assert.ok(xml.includes("Before view. FFS Jan 5, 2027"));
  assert.ok(xml.includes("After view. FFS Jan 1, 2038"));
  assert.ok(xml.includes("Review timing") && xml.includes("(working name)"));
  assert.ok(xml.includes("Planning estimates; working names may change"));
  assert.ok(xml.includes(mode === "merged" ? "Combined Hashout roadmap" : "Headsets Hashout roadmap"));
  assert.ok(!xml.includes("2050") && !xml.includes("2055") && !xml.includes("<p:pic>"), "FFS export has no lifecycle-date bars or flattened product images.");
  assert.ok(groups.slice(0, 3).every(group => (group.match(/<p:sp>/g) || []).length === 3));
  assert.ok(groups.slice(3, 7).every(group => (group.match(/<p:sp>/g) || []).length === 2));
  for (const group of groups) {
    const name = [...group.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map(match => match[0]).find(shape => /name="[^"]*-part-0"/.test(shape));
    assert.ok(name && /<a:rPr\b[^>]*\bb="1"/.test(name), "Actual native product-name text is bold on every Hashout export page.");
  }
}
console.log("FFS PowerPoint checks passed: ten-year native point/window geometry, leap-day and clipping alignment, retained outside/TBD stages and estimates, timing-review labels, editable groups, and no GA/EM substitution.");
