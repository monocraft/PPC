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
const crossPortfolioIssues = integrity.scan(state);
assert.equal(JSON.stringify(state), before, "finding duplicates must not rewrite or delete content");
assert.equal(crossPortfolioIssues.length, 0, "the same name and HP SKU in PC and Console portfolios are legitimate listings, not duplicate alerts");
const withinPc = product("d", " cloud   iii ", "abc123");
state.categories[0].board.products.push(withinPc);
const issues = integrity.scan(state);
assert.equal(issues.filter((issue) => issue.kind === "hp-sku").length, 1, "HP codes are case insensitive and trim surrounding whitespace within a portfolio");
assert.equal(issues.filter((issue) => issue.kind === "variant-sku").length, 0, "BK variants on different products are valid");
const possible = issues.find((issue) => issue.kind === "possible-name");
assert.equal(possible.severity, "info", "matching names remain a nonblocking possible match");
assert.equal(possible.members.length, 2, "different portfolios and wireless suffixes are excluded from the name match");
assert.equal(possible.members[1].categoryName, "PC Audio");
assert.equal(possible.members[0].laneName, "Wireless");
assert.ok(possible.guidance.includes("do not block saving"));
assert.ok(possible.description.includes("in PC Audio"), "the name review identifies its portfolio scope");
const skuIssue = issues.find((issue) => issue.kind === "hp-sku");
assert.ok(skuIssue.description.includes("in PC Audio"), "the SKU review identifies its portfolio scope");
assert.ok(skuIssue.guidance.includes("different product portfolios are allowed"));
assert.ok(issues.every((issue) => issue.members.every((location) => location.categoryName === "PC Audio")), "genuine PC duplicates do not include valid Console copies");
assert.deepEqual(integrity.scan({ categories: [...state.categories].reverse() }).map((issue) => issue.id).sort(), issues.map((issue) => issue.id).sort(), "portfolio issue IDs remain stable when categories are reordered");

const twoPortfolios = { categories: [category("pc", "PC Audio", [product("p1", "Same", "SKU"), product("p2", " same ", "sku")]),
  category("console", "Console Audio", [product("c1", "Same", "SKU"), product("c2", "same", "sku")])] };
const separateIssues = integrity.scan(twoPortfolios);
assert.equal(separateIssues.length, 4, "identical codes and names with local duplicates yield two independent checks in each portfolio");
assert.equal(new Set(separateIssues.map((issue) => issue.id)).size, 4, "scoped duplicate issues cannot overwrite another portfolio's review");
assert.ok(separateIssues.every((issue) => new Set(issue.members.map((location) => location.locator.categoryId)).size === 1), "each issue contains assignments from only its own portfolio");
const unnamedCategories = JSON.parse(JSON.stringify(twoPortfolios));
unnamedCategories.categories.forEach((item) => { delete item.id; });
assert.equal(new Set(integrity.scan(unnamedCategories).map((issue) => issue.id)).size, 4, "categories without IDs still have independent review IDs");
const warningMessages = [];
const withinController = integrity.createController({ document: null, adapter: { getPortfolio: () => state }, notifications: {
  publish: (notification) => warningMessages.push(notification), resolve() {},
} });
assert.equal(warningMessages.at(-1).severity, "warning", "same-portfolio HP assignments are warnings even without a blocking local error");
withinController.destroy();
const nameMessages = [];
const nameOnly = integrity.createController({ document: null, adapter: { getPortfolio: () => ({ categories: [category("pc", "PC Audio", [product("n1", "Same"), product("n2", " same ")])] }) }, notifications: {
  publish: (notification) => nameMessages.push(notification), resolve() {},
} });
assert.equal(nameMessages.at(-1).severity, "info", "possible names alone stay informational");
nameOnly.destroy();
assert.equal(skuIssue.members[0].focus.section, "partSkus");
assert.equal(skuIssue.members[0].focus.rowIndex, 0);
assert.equal(skuIssue.members[1].locator.categoryIndex, 0);
const navigation = integrity.navigationFor(state, skuIssue.members[1]);
assert.equal(navigation.product, withinPc, "navigation points to the exact duplicate assignment in the same portfolio");
assert.equal(navigation.clearSearch, true, "find action requests clearing hidden comparison results");
assert.equal(navigation.clearRoadmapSearch, true, "find action requests clearing hidden roadmap results");
assert.equal(navigation.revealAllLanes, true);

const duplicate = product("a", "Exact duplicate", "NEW123");
state.categories[1].board.products.push(duplicate);
const idIssue = integrity.scan(state).find((issue) => issue.kind === "product-id");
assert.equal(idIssue.members.length, 2, "internal IDs remain globally unique even for products in different portfolios");
assert.ok(idIssue.guidance.includes("source package"), "ID correction guidance cannot imply a nonexistent ID editor");
const secondLocation = idIssue.members[1];
assert.equal(integrity.resolveLocator(state, secondLocation.locator).product, duplicate, "duplicate IDs must retain their exact record location");
state.categories[1].board.products.reverse();
assert.equal(integrity.resolveLocator(state, secondLocation.locator).product, duplicate, "reordered duplicates resolve by the scanned record reference");
state.categories[1].board.products = state.categories[1].board.products.filter((item) => item !== duplicate);
assert.equal(integrity.resolveLocator(state, secondLocation.locator), null, "removing the duplicate cannot fall through to its same-ID sibling");
assert.equal(integrity.navigationFor(state, secondLocation), null, "unavailable records have no edit action target");

const clone = JSON.parse(JSON.stringify(state));
const persistedLocation = { ...skuIssue.members[1].locator };
assert.equal(integrity.resolveLocator(clone, persistedLocation).product.name, withinPc.name, "serialized location can resolve unchanged imported data");
clone.categories[0].board.products.push({ ...clone.categories[0].board.products.find((item) => item.id === withinPc.id) });
delete persistedLocation.productIndex;
assert.equal(integrity.resolveLocator(clone, persistedLocation), null, "an incomplete locator cannot guess between duplicates");

first.partSkus.push({ id: "extra-hp", code: "ABC123" });
const mixed = integrity.scan(state).find((issue) => issue.kind === "hp-sku");
assert.equal(mixed.members.length, 3, "the mixed assignment bucket includes rows on both products");
assert.equal(mixed.severity, "error", "within-product repetitions remain blocking even when another product also uses the HP SKU");
assert.ok(mixed.description.includes("in PC Audio"), "mixed assignment guidance describes the affected portfolio");
assert.ok(mixed.members.every((location) => location.categoryName === "PC Audio"), "a repeated row error does not draw in a valid Console copy");
const crossAndRepeated = integrity.scan({ categories: [category("pc", "PC Audio", [first]), category("console", "Console Audio", [other])] });
assert.equal(crossAndRepeated.length, 1, "a valid cross-portfolio listing does not add warnings beside a real repeated-row error");
assert.equal(crossAndRepeated[0].members.length, 2, "both repeated rows remain locatable without the other portfolio's row");
assert.equal(crossAndRepeated[0].severity, "error");
let intra = integrity.scan({ categories: [category("pc", "PC Audio", [first])] }).find((issue) => issue.kind === "hp-sku");
assert.equal(intra.severity, "error", "two HP rows on one product match the master save validation");
assert.deepEqual(intra.members.map((location) => location.focus.rowIndex), [0, 1], "the review exposes both editor row locations");
first.variantGroups.push({ id: "other-colors", type: "color", items: [{ id: "other-black", code: " bk " }] });
first.variantGroups.push({ id: "layouts", type: "layout", items: [{ id: "layout-bk", code: "BK" }] });
const variant = integrity.scan({ categories: [category("pc", "PC Audio", [first])] }).find((issue) => issue.kind === "variant-sku");
assert.equal(variant.members.length, 2, "duplicates span same-type groups but not a different variant type");
assert.equal(variant.members[1].focus.groupIndex, 1);
assert.equal(variant.members[1].focus.rowId, "other-black");

const blackRed = { id: "dual-bk", code: "BK", colorKey: "black", colorName: "Black", colorHex: "#111111", colorKey2: "red", colorName2: "Red", colorHex2: "#b72f3d" };
const blackOnly = { id: "single-bk", code: "BK", colorKey: "black", colorName: "Black", colorHex: "#111111" };
const redOnly = { id: "single-rd", code: "RD", colorKey: "red", colorName: "Red", colorHex: "#b72f3d" };
const redBlack = { id: "dual-reversed", code: "BK", colorKey: "red", colorName: "Red", colorHex: "#b72f3d", colorKey2: "black", colorName2: "Black", colorHex2: "#111111" };
const colorwayProduct = product("colorways", "Distinct headset colorways", "COLORWAY-HP", { variantGroups: [{ id: "colorway-group", type: "color", items: [blackRed, blackOnly, redOnly, redBlack, { ...blackRed, id: "explicit-code", code: "BK/RD" }] }] });
const colorwayPortfolio = { categories: [category("audio", "PC Audio", [colorwayProduct])] };
assert.equal(integrity.scan(colorwayPortfolio).length, 0, "BK Black/Red, BK Black, RD Red, reversed Red/Black and BK/RD rows are legitimate distinct colorways");
colorwayProduct.variantGroups[0].items.push({ ...blackRed, id: "real-duplicate", code: " bk ", colorName: "Renamed display label" });
const exactColorway = integrity.scan(colorwayPortfolio).find((issue) => issue.kind === "variant-sku");
assert.equal(exactColorway.severity, "error"); assert.equal(exactColorway.members.length, 2, "only rows with the same code and full color combination are flagged");
assert.deepEqual(exactColorway.members.map((location) => location.focus.rowIndex), [0, 5]);
assert.ok(exactColorway.description.includes("primary/secondary"));
assert.ok(exactColorway.guidance.includes("may share the same code"), "the warning explains valid repeated abbreviations instead of demanding unique color codes");
assert.match(exactColorway.members[0].detail, /Black \/ Red/, "duplicate reviews show both colors to help distinguish the actual affected rows");
colorwayProduct.variantGroups[0].items.pop();
colorwayProduct.variantGroups.push({ id: "custom-colors", type: "color", items: [
  { id: "custom-a", code: "CUSTOM", colorKey: "custom", colorName: "Special finish", colorHex: "#123456" },
  { id: "custom-b", code: "CUSTOM", colorKey: "custom", colorName: "Special finish", colorHex: "#654321" },
] });
assert.equal(integrity.scan(colorwayPortfolio).length, 0, "custom colorways with different actual colors remain distinct despite shared code and label");
colorwayProduct.variantGroups.push({ id: "layouts-one", type: "layout", items: [{ id: "us-one", code: "US", label: "United States" }] }, { id: "layouts-two", type: "layout", items: [{ id: "us-two", code: " us ", label: "Alternate label" }] });
const trueLayout = integrity.scan(colorwayPortfolio).find((issue) => issue.kind === "variant-sku");
assert.equal(trueLayout.members.length, 2, "layout codes remain unique across layout groups regardless of their labels");
assert.match(trueLayout.title, /layout code/);
colorwayProduct.variantGroups.pop(); colorwayProduct.variantGroups.pop();
const standaloneColorwayScan = integrity.scan(colorwayPortfolio);
await import("../../public/js/master-model.js");
assert.deepEqual(integrity.scan(colorwayPortfolio), standaloneColorwayScan, "the review's standalone colorway rules agree with the shared saving model");
assert.doesNotThrow(() => globalThis.PortfolioMasterModel.validateValues(globalThis.PortfolioMasterModel.values(colorwayProduct)), "valid colorway combinations must pass the same validation used when saving to master");

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

console.log("Product issue checks passed: legitimate PC/Console copies and distinct single/dual colorways, exact repeated colorway/layout protections consistent with master saving, portfolio-scoped SKU/name reviews, stable scoped issue IDs, repeated-row protections, global internal IDs, exact locators, hidden-filter navigation, stale-record protection, refreshed ASCM candidate locations, escaped review markup, persistent notification resolution, and modal keyboard isolation.");
