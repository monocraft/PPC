import assert from "node:assert/strict";
await import("../../public/js/roadmap-interaction.js");
const interaction = globalThis.RoadmapInteraction;
const product = (id, family, startMonth = "2026-01", order) => ({
  id, name: `Product ${id}`, laneId: `lane-${id}`, order: 17,
  generalAvailabilityDate: "2026-01-12", endManufacturingDate: "2028-06-20",
  roadmap: { family, startMonth, endMonth: "2028-06", status: "in-development", notes: "Keep notes", ...(order === undefined ? {} : { order }) },
});

const unsorted = [
  product("z", "Alpha", "2024-01"), product("c", "Alpha", "2026-03", 2),
  product("a", "Alpha", "2026-01", 0), product("b", "Alpha", "2026-02", 1),
  product("early", "Alpha", "2023-01"), product("invalid", "Alpha", "invalid", -1),
];
const beforeSort = structuredClone(unsorted);
assert.deepEqual(interaction.sortProducts(unsorted).map(({ id }) => id), ["a", "b", "c", "early", "z", "invalid"], "saved roadmap order takes precedence over dates while legacy products retain date order");
assert.deepEqual(unsorted, beforeSort, "sorting must not mutate products or the caller's array");
const invalidOrder = [product("c", "Alpha", "2026-03", NaN), product("b", "Alpha", "2026-02", Infinity), product("a", "Alpha", "2026-01", "0")];
assert.deepEqual(interaction.sortProducts(invalidOrder).map(({ id }) => id), ["a", "b", "c"], "non-finite and nonnumeric saved orders fall back to dates");

const a = product("a", "Alpha", "2026-01", 0);
const b = product("b", "Alpha", "2026-01", 1);
const c = product("c", "Alpha", "2026-01", 2);
const d = product("d", "Beta", "2026-01", 0);
const groups = [{ family: "Alpha", products: [a, b, c] }, { family: "Beta", products: [d] }, { family: "Empty", products: [] }];
const geometry = { headerHeight: 100, groupHeaderHeight: 20, rowHeight: 40 };
assert.deepEqual(interaction.dropTarget(groups, "b", 80, geometry), { family: "Alpha", beforeId: "a", afterId: null, lineY: 120, index: 0 }, "a drop above the first group targets its first row");
assert.deepEqual(interaction.dropTarget(groups, "b", 140, geometry), { family: "Alpha", beforeId: "c", afterId: "a", lineY: 200, index: 1 }, "midpoints choose the neighboring row and omit the dragged product as an anchor");
assert.deepEqual(interaction.dropTarget(groups, "b", 235, geometry), { family: "Alpha", beforeId: null, afterId: "c", lineY: 240, index: 2 }, "the family tail can accept a drop");
assert.deepEqual(interaction.dropTarget(groups, "b", 250, geometry), { family: "Beta", beforeId: "d", afterId: null, lineY: 260, index: 0 }, "the next family header targets that family, making cross-family movement explicit");
assert.deepEqual(interaction.dropTarget(groups, "b", 240, geometry), { family: "Beta", beforeId: "d", afterId: null, lineY: 260, index: 0 }, "the exact family boundary resolves consistently to the next family header");
assert.deepEqual(interaction.dropTarget(groups, "b", 500, geometry), { family: "Empty", beforeId: null, afterId: null, lineY: 320, index: 0 }, "empty groups and a drop past the last group remain valid targets");
assert.equal(interaction.dropTarget([], "b", 100, geometry), null);
assert.equal(interaction.dropTarget(groups, "b", NaN, geometry), null);
assert.deepEqual(interaction.dropTarget([{ family: "Solo", products: [b] }], "b", 135, geometry), { family: "Solo", beforeId: null, afterId: null, lineY: 120, index: 0 });

const hidden1 = product("hidden-1", "Alpha", "2026-01", 1);
const hidden2 = product("hidden-2", "Alpha", "2026-01", 3);
const moving = product("moving", "Alpha", "2026-01", 4);
const fullFamily = [product("a", "Alpha", "2026-01", 0), hidden1, product("c", "Alpha", "2026-01", 2), hidden2, moving, d];
const untouchedFields = fullFamily.map(({ roadmap, ...fields }) => ({ ...fields, roadmap: Object.fromEntries(Object.entries(roadmap).filter(([key]) => !["family", "order"].includes(key))) }));
assert.equal(interaction.reorderProducts(fullFamily, "moving", { family: "Alpha", beforeId: "c", afterId: "a", index: 1 }), true);
assert.deepEqual(interaction.sortProducts(fullFamily.filter(({ roadmap }) => roadmap.family === "Alpha")).map(({ id }) => id), ["a", "hidden-1", "moving", "c", "hidden-2"], "filtered anchors insert into the complete family without losing or rearranging invisible products");
assert.equal(interaction.reorderProducts(fullFamily, "moving", { beforeId: "a", index: 0 }), true);
assert.equal(moving.roadmap.family, "Alpha", "a target without an explicit family retains the source family");
assert.equal(interaction.reorderProducts(fullFamily, "moving", { family: "Beta", beforeId: "d", index: 0 }), true);
assert.deepEqual(interaction.sortProducts(fullFamily.filter(({ roadmap }) => roadmap.family === "Beta")).map(({ id }) => id), ["moving", "d"]);
assert.deepEqual(interaction.sortProducts(fullFamily.filter(({ roadmap }) => roadmap.family === "Alpha")).map(({ roadmap }) => roadmap.order), [0, 1, 2, 3], "cross-family moves close the source family gap");
assert.equal(interaction.reorderProducts(fullFamily, "missing", { family: "Beta" }), false);
assert.equal(interaction.reorderProducts(fullFamily, "moving", null), false);
assert.equal(interaction.reorderProducts(fullFamily, "moving", { family: "Beta", beforeId: "d", index: 0 }), false, "repeating an existing order is a no-op");
assert.deepEqual(fullFamily.map(({ roadmap, ...fields }) => ({ ...fields, roadmap: Object.fromEntries(Object.entries(roadmap).filter(([key]) => !["family", "order"].includes(key))) })), untouchedFields, "reordering changes only roadmap family and order; portfolio positions, dates, status, and notes remain intact");
const tailMove = [product("x", "Alpha", "2026-01", 0), product("hidden", "Alpha", "2026-01", 1), product("y", "Alpha", "2026-01", 2), product("z", "Beta", "2026-01", 0)];
interaction.reorderProducts(tailMove, "z", { family: "Alpha", beforeId: null, afterId: "y", index: 2 });
assert.deepEqual(interaction.sortProducts(tailMove.filter(({ roadmap }) => roadmap.family === "Alpha")).map(({ id }) => id), ["x", "hidden", "y", "z"], "a filtered tail drop retains invisible family members");

const filteredSource = [product("a", "Alpha", "2026-01", 0), product("hidden-before", "Alpha", "2026-01", 1), product("moving", "Alpha", "2026-01", 2), product("hidden-after", "Alpha", "2026-01", 3), product("c", "Alpha", "2026-01", 4)];
const filteredBefore = structuredClone(filteredSource);
const sourceTarget = interaction.dropTarget([{ family: "Alpha", products: filteredSource.filter(({ id }) => !id.startsWith("hidden")) }], "moving", 180, geometry);
assert.equal(interaction.reorderProducts(filteredSource, "moving", sourceTarget), false, "dropping over the original filtered row is a no-op");
assert.deepEqual(filteredSource, filteredBefore, "a source-row drop cannot move the source past invisible neighbors");
const soloTarget = interaction.dropTarget([{ family: "Alpha", products: [filteredSource[2]] }], "moving", 180, geometry);
assert.equal(interaction.reorderProducts(filteredSource, "moving", soloTarget), false, "a family with only the source visible preserves its position among hidden products");

const drag = { originalStart: 24000, originalEnd: 24005, mode: "move" };
assert.deepEqual(interaction.draftDates(drag, 149, 100, 1), { start: 24001, end: 24006 });
assert.deepEqual(interaction.draftDates(drag, -150, 100, 1), { start: 23998, end: 24003 }, "snapping is symmetric in either drag direction");
assert.deepEqual(interaction.draftDates(drag, 450, 100, 3), { start: 24006, end: 24011 }, "quarter snapping preserves product duration");
assert.deepEqual(interaction.draftDates({ ...drag, mode: "start" }, 900, 100, 1), { start: 24005, end: 24005 }, "start resizing cannot cross the end");
assert.deepEqual(interaction.draftDates({ ...drag, mode: "end" }, -900, 100, 1), { start: 24000, end: 24000 }, "end resizing cannot cross the start");
assert.deepEqual(interaction.draftDates({ ...drag, mode: "start" }, -300, 100, 1), { start: 23997, end: 24005 });
assert.deepEqual(interaction.draftDates({ ...drag, mode: "end" }, 600, 100, 6), { start: 24000, end: 24011 });
assert.deepEqual(interaction.draftDates(drag, 600, 0, 1), { start: 24000, end: 24005 }, "invalid display scale cannot corrupt saved endpoints");
assert.deepEqual(drag, { originalStart: 24000, originalEnd: 24005, mode: "move" }, "drafting leaves drag origins unchanged");
assert.throws(() => interaction.draftDates({ ...drag, originalStart: NaN }, 10, 100, 1), RangeError);
assert.throws(() => interaction.draftDates({ ...drag, mode: "unknown" }, 10, 100, 1), RangeError);

console.log("Roadmap interaction checks passed: saved ordering, row and family drop targets, preserved filtered products and portfolio positions, cross-family moves, and snapped endpoint resizing.");

const measureLabel = (text) => [...text].length * 6;
for (const name of ["Cloud Alpha", "Cloud Jet Wireless Headset", "VeryLongUnbrokenProductIdentifierForFit", "  Long   product  name  "]) {
  const lines = interaction.labelLines(name, 117, measureLabel);
  assert.ok(lines.length > 0 && lines.length <= 2);
  assert.ok(lines.every((line) => measureLabel(line) <= 117), "names never overlap the timeline");
}
assert.deepEqual(interaction.labelLines("Cloud Jet Wireless",117,measureLabel), ["Cloud Jet Wireless"]);
assert.deepEqual(interaction.labelLines("Cloud Jet Wireless Headset",117,measureLabel), ["Cloud Jet Wireless", "Headset"]);
assert.deepEqual(interaction.labelLines("",117,measureLabel), []);
assert.deepEqual(interaction.labelLines("Cloud",0,measureLabel), []);
