import assert from "node:assert/strict";

await import("../../public/js/pptx-pagination.js");
const { MAX_PRODUCT_COLUMNS, paginateProductLanes } = globalThis.PPTXPagination;
assert.equal(MAX_PRODUCT_COLUMNS, 13);

const lane = { id: "headsets", label: "Headsets", order: 0 };
const makeProducts = (count, laneId = lane.id, family = "Headsets") => Array.from({ length: count }, (_, order) => ({
  id: `${laneId}-${order}`, laneId, order, roadmap: { family },
}));
const flatten = (pages) => pages.flatMap((page) => page.rows.flatMap((row) => row.products));
const rowSizes = (pages) => pages.flatMap((page) => page.rows.map((row) => row.products.length));
const freezeDeep = (value) => {
  Object.freeze(value);
  Object.values(value).forEach((child) => {
    if (child && typeof child === "object" && !Object.isFrozen(child)) freezeDeep(child);
  });
  return value;
};

for (const [count, expectedRows, expectedPageRows] of [
  [0, [], [0]], [1, [1], [1]], [13, [13], [1]], [14, [13, 1], [2]],
  [26, [13, 13], [2]], [27, [13, 13, 1], [2, 1]], [40, [13, 13, 13, 1], [2, 2]],
]) {
  const products = makeProducts(count);
  const pages = paginateProductLanes([lane], products);
  assert.deepEqual(rowSizes(pages), expectedRows, `${count} products wrap at 13 columns`);
  assert.deepEqual(pages.map((page) => page.rows.length), expectedPageRows, `${count} products fit the available slide height`);
  assert.deepEqual(flatten(pages), products, "every product is retained in its existing order");
  assert.equal(new Set(flatten(pages)).size, count, "no product appears twice");
  assert.ok(pages.every((page) => page.rows.every((row) => row.products.length <= 13)));
  assert.deepEqual(pages.flatMap((page) => page.rows.map((row) => row.continued)), expectedRows.map((_, index) => index > 0));
  assert.ok(pages.every((page) => page.width === pages[0].width), "the category uses a consistent horizontal scale");
  assert.ok(pages.every((page) => page.height <= page.width * 6.33 / 12.55 + 1e-9), "cards fit the PowerPoint content rectangle");
}

const intactFamilies = [
  ...makeProducts(9, lane.id, "Wired"),
  ...makeProducts(8, lane.id, "Wireless").map((product, index) => ({ ...product, id: `wireless-${index}`, order: index + 9 })),
  ...makeProducts(5, lane.id, "Accessories").map((product, index) => ({ ...product, id: `accessory-${index}`, order: index + 17 })),
];
const familyPages = paginateProductLanes([lane], intactFamilies);
assert.deepEqual(rowSizes(familyPages), [9, 13], "a family fitting a fresh row stays intact even if the preceding row has room for only some of it");
assert.deepEqual(familyPages.flatMap((page) => page.rows.map((row) => row.products.map((product) => product.roadmap.family))), [
  Array(9).fill("Wired"), [...Array(8).fill("Wireless"), ...Array(5).fill("Accessories")],
]);
assert.deepEqual(flatten(familyPages), intactFamilies, "family preservation never reorders products");

const longFamilyProducts = [
  ...makeProducts(3, lane.id, "First"),
  ...makeProducts(15, lane.id, "Large").map((product, index) => ({ ...product, id: `large-${index}`, order: index + 3 })),
  ...makeProducts(7, lane.id, "Last").map((product, index) => ({ ...product, id: `last-${index}`, order: index + 18 })),
];
assert.deepEqual(rowSizes(paginateProductLanes([lane], longFamilyProducts)), [13, 12], "a family larger than the column limit splits without wasting the preceding row");
const customFamilies = intactFamilies.map((product, index) => ({ ...product, exportFamily: index < 8 ? "A" : "B" }));
assert.deepEqual(rowSizes(paginateProductLanes([lane], customFamilies, { getFamily: (product) => product.exportFamily })), [13, 9], "the caller's normalized family accessor takes precedence over stored family fields");
const alternating = makeProducts(14).map((product, index) => ({ ...product, roadmap: { family: index % 2 ? "B" : "A" } }));
assert.deepEqual(flatten(paginateProductLanes([lane], alternating)), alternating, "noncontiguous families are not regrouped or reordered");
const fallbackFamilies = intactFamilies.map(({ roadmap, ...product }) => ({ ...product, family: roadmap.family }));
assert.deepEqual(rowSizes(paginateProductLanes([lane], fallbackFamilies)), [9, 13], "legacy product.family remains supported");

const lanes = [
  { id: "late", label: "Late", order: 2 },
  { id: "early-a", label: "Early A", order: 0 },
  { id: "empty", label: "Empty", order: 1 },
  { id: "early-b", label: "Early B", order: 0 },
];
const unordered = [
  { id: "late-2", laneId: "late", order: 2 },
  { id: "early-a-1", laneId: "early-a", order: 1 },
  { id: "late-tie-first", laneId: "late", order: 0 },
  { id: "early-b-0", laneId: "early-b", order: 0 },
  { id: "early-a-0", laneId: "early-a", order: 0 },
  { id: "late-tie-second", laneId: "late", order: 0 },
];
const orderedPages = paginateProductLanes(lanes, unordered);
assert.deepEqual(orderedPages.flatMap((page) => page.rows.map((row) => row.lane.id)), ["early-a", "early-b", "late"], "lane order is stable and empty lanes do not consume rows");
assert.deepEqual(flatten(orderedPages).map((product) => product.id), ["early-a-0", "early-a-1", "early-b-0", "late-tie-first", "late-tie-second", "late-2"], "product order is stable within each lane");
const original = JSON.stringify({ lanes, products: unordered });
freezeDeep(lanes);
freezeDeep(unordered);
const frozenPages = paginateProductLanes(lanes, unordered);
assert.equal(JSON.stringify({ lanes, products: unordered }), original, "pagination does not mutate source lane, product, or nested family data");
assert.equal(frozenPages[0].rows[0].lane, lanes[1], "rows retain the original lane record");
assert.equal(flatten(frozenPages)[0], unordered[4], "rows retain the original product record");

const orphan = { id: "orphan", laneId: "removed", order: 0 };
const orphanPages = paginateProductLanes([lane, { id: "__pptx-unassigned__", order: 1 }], [...makeProducts(1), orphan]);
assert.equal(flatten(orphanPages).at(-1), orphan, "unknown lane products are exported rather than silently omitted");
assert.equal(orphanPages.at(-1).rows.at(-1).lane.label, "Unassigned");
assert.notEqual(orphanPages.at(-1).rows.at(-1).lane.id, "__pptx-unassigned__", "fallback lane IDs avoid collisions");
assert.deepEqual(flatten(paginateProductLanes([], [orphan])), [orphan], "products survive a category without lane definitions");
assert.throws(() => paginateProductLanes([lane, { ...lane }], []), /Duplicate product lane id/, "ambiguous duplicate lanes fail explicitly instead of exporting products twice");

const manyLanes = Array.from({ length: 5 }, (_, order) => ({ id: `lane-${order}`, order }));
const manyLanePages = paginateProductLanes(manyLanes, manyLanes.flatMap((item) => makeProducts(13, item.id)));
assert.deepEqual(manyLanePages.map((page) => page.rows.length), [2, 2, 1]);
assert.deepEqual(manyLanePages.map((page) => page.height), [1228, 1228, 1228], "the final continuation page reserves the same height so its products cannot be enlarged");
assert.equal(manyLanePages[0].width, 3386, "13 columns determine the category width without the original lane's overflow");
const singlePage = paginateProductLanes([lane], makeProducts(13));
assert.equal(singlePage[0].height, 606, "a single-page category contains only its actual rows with no trailing gap");

const verticalOptions = { maxColumns: 5, cardWidth: 100, cardGap: 0, cardHeight: 100, laneGap: 10, top: 20, bottom: 20, minWidth: 1000, slideWidth: 10, slideHeight: 4 };
const verticalPages = paginateProductLanes([lane], makeProducts(16), verticalOptions);
assert.deepEqual(rowSizes(verticalPages), [5, 5, 5, 1]);
assert.deepEqual(verticalPages.map((page) => page.rows.length), [3, 1], "row count comes from the available slide height and category scale");
assert.ok(verticalPages.every((page) => page.rowsPerSlide === 3 && page.height === 360));
const tallerVerticalPages = paginateProductLanes([lane], makeProducts(16), { ...verticalOptions, cardHeight: 120 });
assert.deepEqual(tallerVerticalPages.map((page) => page.rows.length), [2, 2], "increasing detail height reduces rows before they become too small to fit");
assert.ok(tallerVerticalPages.every((page) => page.rowsPerSlide === 2 && page.height === 290));
const tallOptions = { cardHeight: 3000 };
const tallPages = paginateProductLanes([lane], makeProducts(27), tallOptions);
assert.deepEqual(tallPages.map((page) => page.rows.length), [1, 1, 1], "unusually detailed cards fit at least one row per slide");
assert.ok(tallPages.every((page) => page.width >= 3054 * 12.55 / 6.33 && page.height === 3054 && page.rowsPerSlide === 1));
assert.deepEqual(flatten(tallPages), makeProducts(27), "tall-card pagination retains all products");

const empty = paginateProductLanes([{ id: "empty", order: 0 }], []);
assert.deepEqual(empty, [{ rows: [], width: 1480, height: 54, columns: 0, rowsPerSlide: 1 }], "an empty category has one explicit empty page and no lane rows");
assert.deepEqual(paginateProductLanes(undefined, undefined), empty);

console.log("PPTX product page checks passed: 13-column limits, complete stable product coverage, family continuity, vertical fitting, consistent continuation scale, tall cards, orphan lanes, and immutable inputs.");
