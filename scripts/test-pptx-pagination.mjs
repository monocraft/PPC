import assert from "node:assert/strict";

await import("../pptx-pagination.js");

const {
  MAX_PRODUCTS_PER_SLIDE,
  paginateRoadmapGroups,
} = globalThis.PPTXPagination;

assert.equal(MAX_PRODUCTS_PER_SLIDE, 22);

const expectedPageSizes = new Map([
  [0, [0]],
  [1, [1]],
  [22, [22]],
  [23, [22, 1]],
  [44, [22, 22]],
  [45, [22, 22, 1]],
]);

for (const [productCount, expected] of expectedPageSizes) {
  const products = Array.from({ length: productCount }, (_, index) => ({ id: `p-${index + 1}` }));
  const pages = paginateRoadmapGroups([{ family: "Boundary", products }]);
  const pageSizes = pages.map((page) => page.reduce((sum, group) => sum + group.products.length, 0));
  assert.deepEqual(pageSizes, expected, `Unexpected page sizes for ${productCount} products.`);
  assert.deepEqual(
    pages.flatMap((page) => page.flatMap((group) => group.products.map((product) => product.id))),
    products.map((product) => product.id),
  );
  assert.ok(pageSizes.every((size) => size <= MAX_PRODUCTS_PER_SLIDE));
}

const longFamilyProducts = Array.from({ length: 30 }, (_, index) => ({ id: `long-${index + 1}` }));
const secondFamilyProducts = Array.from({ length: 15 }, (_, index) => ({ id: `second-${index + 1}` }));
const sourceGroups = [
  { family: "Long Family", products: longFamilyProducts },
  { family: "Second Family", products: secondFamilyProducts },
];
const roadmapPages = paginateRoadmapGroups(sourceGroups);

assert.deepEqual(
  roadmapPages.map((page) => page.reduce((sum, group) => sum + group.products.length, 0)),
  [22, 8, 15],
);
assert.deepEqual(
  roadmapPages.map((page) => page.map((group) => `${group.family}:${group.continued}:${group.products.length}`)),
  [
    ["Long Family:false:22"],
    ["Long Family:true:8"],
    ["Second Family:false:15"],
  ],
);
assert.deepEqual(
  roadmapPages.flatMap((page) => page.flatMap((group) => group.products.map((product) => product.id))),
  [...longFamilyProducts, ...secondFamilyProducts].map((product) => product.id),
);
assert.equal(sourceGroups[0].continued, undefined);
assert.equal(sourceGroups[0].products.length, 30);
assert.deepEqual(paginateRoadmapGroups([]), [[]]);

const intactFamilies = paginateRoadmapGroups([
  { family: "First", products: Array.from({ length: 18 }, (_, index) => ({ id: `first-${index}` })) },
  { family: "Second", products: Array.from({ length: 10 }, (_, index) => ({ id: `second-${index}` })) },
]);
assert.deepEqual(
  intactFamilies.map((page) => page.map((group) => `${group.family}:${group.continued}:${group.products.length}`)),
  [["First:false:18"], ["Second:false:10"]],
);

console.log("PPTX roadmap pagination tests passed: boundaries, order, continuation groups, and immutability.");
