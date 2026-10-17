import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import "../../public/js/category-layout.js";
import "../../public/js/package-codec.js";
import { validateDecryptedPackage } from "../publish-master-package.mjs";

const layout = globalThis.PortfolioCategoryLayout, clone = value => JSON.parse(JSON.stringify(value));
const make = () => ({ version: 4, activeCategoryId: "mice", imageAssets: [], categories: [{ id: "mice", name: "Mice", board: {
  version: 1, title: "Mice Portfolio", settings: { roadmap: { categoryLabel: "MICE" }, retained: [false, null] },
  lanes: [{ id: "wired", label: "Wired", order: 0 }, { id: "wireless", label: "Wireless", order: 1, retained: true }],
  products: [0, 4, 4, 9].map((order, index) => ({ id: `p${index}`, name: `Product ${index}`, laneId: index < 2 ? "wired" : "wireless", order, privateField: { preserve: true }, specs: [{ label: "Fact", value: "Keep exact" }] })),
} }] });
{
  const portfolio = make(), before = clone(portfolio), draft = layout.project(portfolio);
  draft[0].name = "Changed draft"; draft[0].lanes.reverse();
  assert.deepEqual(portfolio, before, "Opening, selecting, and changing draft metadata cannot mutate accepted products or layout.");
  const originalProducts = portfolio.categories[0].board.products;
  layout.apply(portfolio, draft, layout.signature(portfolio));
  assert.equal(portfolio.categories[0].name, "Changed draft");
  assert.deepEqual(portfolio.categories[0].board.lanes.map(lane => lane.id), ["wireless", "wired"]);
  assert.equal(portfolio.categories[0].board.products, originalProducts, "Metadata save preserves the actual product list identity.");
  assert.deepEqual(portfolio.categories[0].board.products, before.categories[0].board.products, "Gaps, ties, unknown raw fields and product facts remain byte-equivalent.");
  assert.deepEqual(portfolio.categories[0].board.settings.retained, [false, null]);
}
{
  const portfolio = make(), base = layout.signature(portfolio), draft = layout.project(portfolio);
  portfolio.categories[0].board.products[0].name = "New product fact while editing layout";
  draft[0].title = "New board title"; layout.apply(portfolio, draft, base);
  assert.equal(portfolio.categories[0].board.products[0].name, "New product fact while editing layout", "Concurrent product facts are retained.");
  const stale = layout.project(portfolio), expected = layout.signature(portfolio);
  portfolio.categories[0].name = "Layout changed elsewhere";
  const before = clone(portfolio);
  assert.throws(() => layout.apply(portfolio, stale, expected), /changed elsewhere/);
  assert.deepEqual(portfolio, before, "Conflicting metadata is rejected atomically.");
}
{
  const portfolio = make(), draft = layout.project(portfolio), base = layout.signature(portfolio);
  draft.push({ id: "custom-test-accessories", custom: true, name: "Accessories", title: "Accessories Portfolio", sideLabel: "ACCESSORIES", lanes: [{ id: "main", label: "Main", subtitle: "", order: 0 }] });
  layout.move(draft, "custom-test-accessories", "mice");
  draft[1].lanes.push({ id: "lane-dock", label: "Dock", subtitle: "", order: 2 });
  layout.apply(portfolio, draft, base);
  assert.deepEqual(portfolio.categories.map(category => category.id), ["custom-test-accessories", "mice"]);
  assert.deepEqual(portfolio.categories[0].board.products, [], "A new category is empty; catalog products are never manufactured.");
  const zip = globalThis.PortfolioPackage.createZip([{ name: "portfolio.json", data: new TextEncoder().encode(JSON.stringify(portfolio)) }]);
  const validated = validateDecryptedPackage(zip);
  assert.equal(validated.categoryCount, 2, "The actual package validation accepts portable custom categories.");
  assert.equal(validated.productCount, 4);
  const source = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
  const fn = name => { const value = source.match(new RegExp(`^function ${name}\\([^]*?^\\}`, "m"))?.[0]; assert.ok(value); return value; };
  const sandbox = { fixture: clone(portfolio), PLACEHOLDER_IMAGE: "fixture.svg", CATEGORY_DEFINITIONS: [{ id: "mice", name: "Mice", boardTitle: "Mice", categoryLabel: "MICE", lanes: [], familyOrder: [] }], PortfolioModel: { syncTimelineSettings() {} }, portfolio: null,
    normalizeAscmSnapshot: value => value, packageCodec: () => ({ normalizePackageInfo: value => value }), ensureImageAssetRegistry() {}, catalogImageAssets: () => [], migrateLegacyProductImages() {}, ensureBoardSchema: board => board };
  vm.createContext(sandbox); vm.runInContext(`${fn("categoryDefinition")}\n${fn("ensurePortfolioSchema")}\nglobalThis.loaded = ensurePortfolioSchema(fixture);`, sandbox);
  assert.deepEqual(clone(sandbox.loaded.categories.map(category => category.id)), ["custom-test-accessories", "mice"], "The actual schema loader preserves custom categories and category order on reload/import.");
  assert.deepEqual(clone(sandbox.loaded.categories[1].board.products), make().categories[0].board.products);
}
for (const mutation of [draft => draft.pop(), draft => { draft[0].name = " "; }, draft => { draft[0].lanes.pop(); }, draft => { draft[0].lanes.push({ ...draft[0].lanes[0] }); }, draft => { draft.push({ ...clone(draft[0]), id: "untrusted" }); }]) {
  const portfolio = make(), before = clone(portfolio), draft = layout.project(portfolio); mutation(draft);
  assert.throws(() => layout.apply(portfolio, draft, layout.signature(portfolio)));
  assert.deepEqual(portfolio, before, "Invalid drafts never partly apply.");
}
{
  const listeners = new Map(), host = { dataset: {} }; let rejectionHandled = false;
  const window = { document: { getElementById: () => host }, PortfolioWorkspaceUI: {},
    PortfolioCategoryLayoutAdapter: { getPortfolio: () => null },
    PortfolioWorkspaceReady: { then(_ready, failed) { assert.equal(typeof failed, "function", "A failed opening already has a recovery UI and cannot create an unhandled Category rejection."); failed(Error("Synthetic damaged workspace")); rejectionHandled = true; } },
    addEventListener(type, listener) { listeners.set(type, listener); } };
  vm.runInNewContext(await readFile(new URL("../../public/js/category-layout.js", import.meta.url), "utf8"), { window });
  assert.equal(rejectionHandled, true);
  assert.equal(host.dataset.initialized, undefined, "Do not mark the Category controller initialized before an open portfolio exists.");
  assert.equal(typeof listeners.get("portfolio:workspace-ready"), "function", "Recovery retry readiness can initialize the inline editor even after an earlier open failed.");
}
console.log("Category layout: metadata drafts, exact product preservation, stale rejection, reorder, additions, package validation and reload checks passed.");
