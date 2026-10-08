import assert from "node:assert/strict";
import "../../public/js/product-issues.js";

const integrity = globalThis.PortfolioProductIssues;
const product = (id, name, sku, overrides = {}) => ({ id, name, laneId: "wireless", partSkus: sku ? [{ id: `${id}-hp`, code: sku }] : [],
  variantGroups: [{ id: `${id}-colors`, type: "color", items: [{ id: `${id}-black`, code: "BK" }] }], ...overrides });
const category = (id, name, items) => ({ id, name, board: { lanes: [{ id: "wireless", label: "Wireless" }], products: items } });
const first = product("a", "Cloud III™", " ABC123 ");
const other = product("b", " cloud   iii ", "abc123");
const third = product("c", "Cloud III Wireless", "DEF456");
const state = { categories: [category("pc", "PC Audio", [first, third]), category("console", "Console Audio", [other])] };
const before = JSON.stringify(state);
const issues = integrity.scan(state);
assert.equal(JSON.stringify(state), before, "finding duplicates must not rewrite or delete content");
assert.equal(issues.filter((issue) => issue.kind === "hp-sku").length, 1, "HP codes are case insensitive and trim surrounding whitespace across categories");
assert.equal(issues.filter((issue) => issue.kind === "variant-sku").length, 0, "BK variants on different products are valid");
const possible = issues.find((issue) => issue.kind === "possible-name");
assert.equal(possible.severity, "info", "matching names remain a nonblocking possible match");
assert.equal(possible.members.length, 2, "wireless suffix must not be erased into an additional match");
assert.equal(possible.members[1].categoryName, "Console Audio");
assert.equal(possible.members[0].laneName, "Wireless");
assert.ok(possible.guidance.includes("do not block saving"));
const skuIssue = issues.find((issue) => issue.kind === "hp-sku");
const warningMessages = [];
const crossController = integrity.createController({ document: null, adapter: { getPortfolio: () => state }, notifications: {
  publish: (notification) => warningMessages.push(notification), resolve() {},
} });
assert.equal(warningMessages.at(-1).severity, "warning", "cross-product HP assignments are warnings even without a blocking local error");
crossController.destroy();
const nameMessages = [];
const nameOnly = integrity.createController({ document: null, adapter: { getPortfolio: () => ({ categories: [category("pc", "PC Audio", [product("n1", "Same"), product("n2", " same ")])] }) }, notifications: {
  publish: (notification) => nameMessages.push(notification), resolve() {},
} });
assert.equal(nameMessages.at(-1).severity, "info", "possible names alone stay informational");
nameOnly.destroy();
assert.equal(skuIssue.members[0].focus.section, "partSkus");
assert.equal(skuIssue.members[0].focus.rowIndex, 0);
assert.equal(skuIssue.members[1].locator.categoryIndex, 1);
const navigation = integrity.navigationFor(state, skuIssue.members[1]);
assert.equal(navigation.product, other, "navigation points to the actual record in the other category");
assert.equal(navigation.clearSearch, true, "find action requests clearing hidden comparison results");
assert.equal(navigation.clearRoadmapSearch, true, "find action requests clearing hidden roadmap results");
assert.equal(navigation.revealAllLanes, true);

const duplicate = product("a", "Exact duplicate", "NEW123");
state.categories[0].board.products.push(duplicate);
const idIssue = integrity.scan(state).find((issue) => issue.kind === "product-id");
assert.equal(idIssue.members.length, 2);
assert.ok(idIssue.guidance.includes("source package"), "ID correction guidance cannot imply a nonexistent ID editor");
const secondLocation = idIssue.members[1];
assert.equal(integrity.resolveLocator(state, secondLocation.locator).product, duplicate, "duplicate IDs must retain their exact record location");
state.categories[0].board.products.reverse();
assert.equal(integrity.resolveLocator(state, secondLocation.locator).product, duplicate, "reordered duplicates resolve by the scanned record reference");
state.categories[0].board.products = state.categories[0].board.products.filter((item) => item !== duplicate);
assert.equal(integrity.resolveLocator(state, secondLocation.locator), null, "removing the duplicate cannot fall through to its same-ID sibling");
assert.equal(integrity.navigationFor(state, secondLocation), null, "unavailable records have no edit action target");

const clone = JSON.parse(JSON.stringify(state));
const persistedLocation = { ...skuIssue.members[1].locator };
assert.equal(integrity.resolveLocator(clone, persistedLocation).product.name, other.name, "serialized location can resolve unchanged imported data");
clone.categories[1].board.products.push({ ...clone.categories[1].board.products[0] });
delete persistedLocation.productIndex;
assert.equal(integrity.resolveLocator(clone, persistedLocation), null, "an incomplete locator cannot guess between duplicates");

first.partSkus.push({ id: "extra-hp", code: "ABC123" });
let intra = integrity.scan({ categories: [category("pc", "PC Audio", [first])] }).find((issue) => issue.kind === "hp-sku");
assert.equal(intra.severity, "error", "two HP rows on one product match the master save validation");
assert.deepEqual(intra.members.map((location) => location.focus.rowIndex), [0, 1], "the review exposes both editor row locations");
first.variantGroups.push({ id: "other-colors", type: "color", items: [{ id: "other-black", code: " bk " }] });
first.variantGroups.push({ id: "layouts", type: "layout", items: [{ id: "layout-bk", code: "BK" }] });
const variant = integrity.scan({ categories: [category("pc", "PC Audio", [first])] }).find((issue) => issue.kind === "variant-sku");
assert.equal(variant.members.length, 2, "duplicates span same-type groups but not a different variant type");
assert.equal(variant.members[1].focus.groupIndex, 1);
assert.equal(variant.members[1].focus.rowId, "other-black");

const plan = { items: [{ action: "ambiguous", group: { displayName: "ASCM Cloud" }, match: { status: "ambiguous", candidates: [
  { categoryId: "pc", productId: "a", productName: first.name }, { categoryId: "console", productId: "b", productName: other.name },
  { categoryId: "console", productId: "b", productName: other.name } ] } },
  { action: "ambiguous", group: { displayName: "Unmapped" }, match: { candidates: [] } },
  { action: "ambiguous", matchedProductId: "c", matchedCategoryId: "pc", group: { displayName: "Another source group" }, match: { candidates: [] } }] };
const ascm = integrity.buildAscmIssues(plan, state);
assert.equal(ascm.length, 2, "only ambiguous report groups with existing products offer locate actions");
assert.equal(ascm[0].members.length, 2, "candidate repetitions do not repeat the same product action");
assert.equal(ascm[0].ascmIndex, 0, "report row actions can focus the correct review group");
assert.equal(ascm[1].members[0].productName, third.name, "multiple report groups matching one existing product remain locatable");

const harmful = { categories: [category("<category>", '<img src=x onerror="boom">', [
  product("<id>", '<svg onload="boom">', "<SKU>"), product("<id>", '<svg onload="boom">', "<SKU>")])] };
const markup = integrity.renderIssues(integrity.scan(harmful));
assert.ok(markup.includes("&lt;svg"));
assert.ok(markup.includes("&lt;SKU&gt;"));
assert.ok(!markup.includes("<svg") && !markup.includes("<img"), "names, IDs, SKU codes, category names, and accessible labels are escaped");
assert.ok(!markup.includes('aria-label="Open <'), "accessible button labels cannot inject markup");

const publications = [], resolutions = [], changes = [];
let current = { categories: [category("pc", "PC Audio", [first])] };
const controller = integrity.createController({ document: null, adapter: { getPortfolio: () => current }, notifications: {
  publish: (notification) => publications.push(notification), resolve: (id) => resolutions.push(id), }, onChange: (value) => changes.push(value) });
assert.equal(publications.at(-1).id, "product-duplicates");
assert.equal(publications.at(-1).toast, false, "editing never creates duplicate alert toasts on each keystroke");
assert.equal(publications.at(-1).dismissible, false, "unresolved product issues stay discoverable");
assert.equal(publications.at(-1).actions[0].label, "Review products");
const notifiedCount = publications.length;
controller.refresh();
assert.equal(publications.length, notifiedCount, "unchanged scans do not announce the same issue repeatedly");
first.partSkus.pop(); first.variantGroups.pop(); first.variantGroups.pop();
controller.refresh();
assert.equal(controller.getState().count, 0);
assert.equal(resolutions.at(-1), "product-duplicates", "correcting the assignments resolves the persistent notification");
controller.setAscmPlan(plan);
assert.ok(controller.getState().issues.some((issue) => issue.kind === "ascm-match"), "skipped import groups stay available after the preview closes");
controller.clearAscmIssues();
assert.equal(controller.getState().count, 0);
controller.destroy();
current = harmful;
assert.equal(controller.refresh().count, 0, "destroyed controller does not publish additional messages");

let editedPortfolio = state;
let rebuiltPlan = plan;
let rebuildCount = 0;
const refreshedMatches = integrity.createController({ document: null, adapter: {
  getPortfolio: () => editedPortfolio,
  rebuildAscmPlan: (sourcePlan) => { assert.equal(sourcePlan, plan); rebuildCount += 1; return rebuiltPlan; },
} });
refreshedMatches.setAscmPlan(plan);
assert.equal(rebuildCount, 1);
const priorCandidate = refreshedMatches.getState().issues.find((issue) => issue.kind === "ascm-match").members[0];
assert.equal(integrity.resolveLocator(editedPortfolio, priorCandidate.locator).product, first);
const replacement = { ...first, codename: "Updated immutable record" };
editedPortfolio = { ...state, categories: state.categories.map((item) => ({ ...item, board: { ...item.board, products: item.board.products.map((record) => record === first ? replacement : record) } })) };
refreshedMatches.refresh();
const freshCandidate = refreshedMatches.getState().issues.find((issue) => issue.kind === "ascm-match").members[0];
assert.equal(integrity.resolveLocator(editedPortfolio, freshCandidate.locator).product, replacement, "retained report issues rebuild location references after immutable app edits");
rebuiltPlan = { items: [] };
refreshedMatches.refresh();
assert.ok(!refreshedMatches.getState().issues.some((issue) => issue.kind === "ascm-match"), "corrected report matches disappear when the rebuilt import plan resolves ambiguity");
refreshedMatches.destroy();

// A small native-dialog boundary stub exercises keyboard ownership independently
// from the app's window shortcuts; it does not duplicate product issue logic.
let mountedDialog;
let focusRestored = 0;
const fields = new Map();
const doc = { activeElement: { isConnected: true, focus() { focusRestored += 1; } },
  body: { appendChild(element) { mountedDialog = element; } },
  createElement() {
    const listeners = new Map();
    return { open: false, addEventListener(type, callback) { listeners.set(type, callback); }, listeners,
      querySelector(selector) { if (!fields.has(selector)) fields.set(selector, { textContent: "", innerHTML: "", scrollTop: 0, hidden: false }); return fields.get(selector); },
      setAttribute() {}, removeAttribute() {}, showModal() { this.open = true; }, close() { this.open = false; }, remove() {} };
  },
};
const keyboard = integrity.createController({ document: doc, adapter: { getPortfolio: () => state } });
keyboard.reviewDuplicateIssues();
assert.equal(mountedDialog.open, true);
let prevented = false, stopped = false;
mountedDialog.listeners.get("keydown")({ key: "ArrowRight", stopPropagation() { stopped = true; }, preventDefault() { prevented = true; } });
assert.equal(stopped, true, "review keyboard events cannot move the underlying canvas selection");
assert.equal(prevented, false, "ordinary review keys keep their native behavior");
assert.equal(mountedDialog.open, true);
prevented = false; stopped = false;
mountedDialog.listeners.get("keydown")({ key: "Escape", stopPropagation() { stopped = true; }, preventDefault() { prevented = true; } });
assert.equal(stopped, true, "Escape cannot reach and close the app's underlying import preview");
assert.equal(prevented, true);
assert.equal(mountedDialog.open, false, "Escape closes only the product review");
assert.equal(focusRestored, 1);
keyboard.reviewDuplicateIssues(); prevented = false; stopped = false;
mountedDialog.listeners.get("cancel")({ stopPropagation() { stopped = true; }, preventDefault() { prevented = true; } });
assert.equal(prevented && stopped, true, "native cancellation also owns its event boundary");
assert.equal(mountedDialog.open, false);
keyboard.destroy();

console.log("Product issue checks passed: cross-category HP SKUs, nonblocking names, legitimate color variants, exact duplicate-ID locators, hidden-filter navigation, stale-record protection, refreshed ASCM candidate locations, escaped review markup, persistent notification resolution, and modal keyboard isolation.");
