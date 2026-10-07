import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

await import("../portfolio-model.js");
const modelRules = globalThis.PortfolioModel;
const timers = [];
const sandbox = { setTimeout: (callback) => timers.push(callback) };
vm.createContext(sandbox);
new vm.Script(await readFile(new URL("../product-details.js", import.meta.url), "utf8")).runInContext(sandbox);
const details = sandbox.PortfolioDetails;
assert.ok(details, "details rendering must load without a browser document");

const dateLabels = ["General availability", "End of manufacturing", "FFS", "Global announcement", "Web readiness", "Final assets"];
const longModel = {
  id: "long-product",
  dates: dateLabels.map((label, index) => ({ label, value: `Jan ${index + 1}, 2026`, empty: false })),
  lifecycle: [{ label: "Stage", value: "In development" }],
  identity: [{ label: "Category", value: "PC Gaming Audio" }],
  skus: Array.from({ length: 17 }, (_, index) => ({ code: `HP-SKU-${index}`, colors: [{ label: "Black", colorHex: "#111111" }] })),
  specs: Array.from({ length: 11 }, (_, index) => ({ label: `Spec label ${index}`, value: `Spec value ${index}` })),
  variants: Array.from({ length: 19 }, (_, index) => ({ group: "Layouts", code: `VAR-${index}`, label: `Layout ${index}`, colors: [] })),
  source: {
    category: "Headset",
    imported: "Oct 6, 2026",
    records: Array.from({ length: 7 }, (_, index) => ({ code: `SOURCE-${index}`, description: `Source description ${index} ${"long descriptive text ".repeat(18)}`, ga: "Jan 1, 2026", em: "Dec 31, 2030" })),
  },
};
const originalModel = structuredClone(longModel);
const initialHtml = details.render(longModel, { surface: "split" });
const overviewPanel = initialHtml.match(/<section\b[^>]*data-detail-panel="overview"[^>]*>([\s\S]*?)<\/section>/);
assert.ok(overviewPanel, "key dates and specifications must share an accessible Overview panel");
assert.ok(!overviewPanel[0].split(">")[0].includes("hidden"), "Overview must be visible on initial render");
for (const label of dateLabels) assert.ok(overviewPanel[1].includes(`<span>${label}</span>`), `${label} must appear in Overview`);
assert.ok(overviewPanel[1].includes("In development"), "Overview must include the lifecycle summary with dates and specifications");
assert.match(initialHtml, /role="tab"[^>]*id="product-detail-split-overview-tab"[^>]*aria-controls="product-detail-split-overview"[^>]*aria-selected="true"[^>]*tabindex="0"[^>]*>Overview<\/button>/);
assert.match(overviewPanel[0], /role="tabpanel"[^>]*aria-labelledby="product-detail-split-overview-tab"/);
assert.ok(!initialHtml.includes('data-detail-tab="specs"'), "specifications must not have a separate tab");
assert.ok(!initialHtml.includes('data-detail-page-group="specs"'), "specifications must not be paginated");
assert.ok(!initialHtml.includes('aria-label="Previous specs"') && !initialHtml.includes('aria-label="Next specs"'), "specifications must not require Previous/Next controls");
assert.ok(!overviewPanel[1].includes("data-detail-page-index") && ![...overviewPanel[1].matchAll(/\bclass="([^"]*)"/g)].some((match) => match[1].split(/\s+/).includes("hidden")), "complete Overview specifications must not be hidden behind pages");

const occurrences = (text, token) => text.split(token).length - 1;
for (const item of longModel.skus) assert.equal(occurrences(initialHtml, `<td class="hp-sku-code">${item.code}</td>`), 1, "every HP SKU must appear exactly once across pages");
for (const item of longModel.specs) {
  assert.equal(occurrences(initialHtml, `<dt>${item.label}</dt>`), 1);
  assert.equal(occurrences(initialHtml, `<dd>${item.value}</dd>`), 1);
  assert.ok(overviewPanel[1].includes(`<dt>${item.label}</dt>`) && overviewPanel[1].includes(`<dd>${item.value}</dd>`), "every specification must be visible together in Overview");
}
assert.equal(occurrences(overviewPanel[1], "<dt>"), longModel.specs.length, "Overview must contain all eleven specifications in one complete list");
for (const item of longModel.variants) assert.equal(occurrences(initialHtml, `<strong>${item.code}</strong>`), 1);
for (const item of longModel.source.records) {
  assert.equal(occurrences(initialHtml, `<strong>${item.code}</strong>`), 1);
  assert.ok(initialHtml.includes(item.description), "long source descriptions must remain intact across pagination");
}
assert.deepEqual(longModel, originalModel, "rendering must not modify product information");

// The adapter models only the controls used by bind(); the rendered markup is
// the source of tab, panel and pagination attributes rather than a DOM library.
const decode = (value) => String(value).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
function elementFromTag(tag) {
  const attributes = new Map([...tag.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((match) => [match[1], decode(match[2] || "")]));
  const classes = new Set((attributes.get("class") || "").split(/\s+/).filter(Boolean));
  const listeners = new Map();
  const element = {
    attributes,
    dataset: Object.fromEntries([...attributes].filter(([key]) => key.startsWith("data-")).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value])),
    disabled: attributes.has("disabled"),
    tabIndex: Number(attributes.get("tabindex") || 0),
    textContent: "",
    isConnected: true,
    classList: { contains: (name) => classes.has(name), toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } },
    setAttribute(name, value) { attributes.set(name, value); },
    addEventListener(type, callback) { const handlers = listeners.get(type) || []; handlers.push(callback); listeners.set(type, handlers); },
    async fire(type, event = {}) { const emitted = { preventDefault() { this.defaultPrevented = true; }, ...event }; await Promise.all((listeners.get(type) || []).map((handler) => handler(emitted))); return emitted; },
    focus() { this.focused = true; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  return element;
}
function fixtureFor(html) {
  const tagElements = (tag, attribute) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*\\b${attribute}="[^"]*"[^>]*>`, "g"))].map((match) => elementFromTag(match[0]));
  const workspace = elementFromTag(html.match(/<div\b[^>]*data-detail-surface="[^"]*"[^>]*>/)[0]);
  const tabs = tagElements("button", "data-detail-tab");
  const moreTabs = tagElements("button", "data-detail-more");
  const panels = tagElements("section", "data-detail-panel");
  const morePanels = tagElements("div", "data-detail-more-panel");
  const copies = tagElements("button", "data-detail-copy");
  for (const button of copies) { button.label = elementFromTag("<small>"); button.label.textContent = "Copy"; button.querySelector = () => button.label; }
  const groupStarts = [...html.matchAll(/<div\b[^>]*data-detail-page-group="[^"]*"[^>]*>/g)];
  const groups = groupStarts.map((match, index) => {
    const group = elementFromTag(match[0]);
    const markup = html.slice(match.index, groupStarts[index + 1]?.index || html.length);
    group.entries = [...markup.matchAll(/<div\b[^>]*data-detail-page-index="[^"]*"[^>]*>/g)].map((entry) => elementFromTag(entry[0]));
    group.buttons = [...markup.matchAll(/<button\b[^>]*data-detail-page-step="[^"]*"[^>]*>/g)].map((button) => elementFromTag(button[0]));
    group.label = elementFromTag("<span>");
    group.label.textContent = markup.match(/data-detail-page-label[^>]*>([^<]*)/)?.[1] || "";
    group.querySelectorAll = (selector) => selector === "[data-detail-page-index]" ? group.entries : selector === "[data-detail-page-step]" ? group.buttons : [];
    group.querySelector = (selector) => selector === "[data-detail-page-label]" ? group.label : group.buttons.find((button) => selector.includes(`="${button.dataset.detailPageStep}"`));
    return group;
  });
  workspace.querySelectorAll = (selector) => ({ "[data-detail-tab]": tabs, "[data-detail-more]": moreTabs, "[data-detail-panel]": panels, "[data-detail-more-panel]": morePanels, "[data-detail-page-group]": groups, "[data-detail-copy]": copies })[selector] || [];
  const close = elementFromTag("<button>");
  const container = { querySelector: (selector) => selector === "[data-detail-surface]" ? workspace : selector === "[data-detail-close]" ? close : null };
  return { container, workspace, tabs, moreTabs, panels, morePanels, copies, groups, close };
}
const fixture = fixtureFor(initialHtml);
function assertKeyboardScrollAccess(html, surface) {
  const panels = fixtureFor(html).panels;
  for (const panel of panels) {
    assert.equal(panel.tabIndex, 0, `${surface} ${panel.dataset.detailPanel} must be keyboard-focusable for internal scrolling`);
    assert.ok(panel.attributes.get("aria-labelledby"), "scrollable tab panels must retain their accessible tab name");
  }
  const regions = [...html.matchAll(/<div\b[^>]*\bclass="product-detail-(?:calendar|spec-scroll)"[^>]*>/g)]
    .map((match) => elementFromTag(match[0]));
  assert.equal(regions.length, 2, "Overview must retain separate calendar and complete-specification scroll regions");
  assert.deepEqual(regions.map((region) => region.attributes.get("aria-label")), ["Key dates and lifecycle", "All product specifications"], "internal scroll regions must describe the information they contain");
  for (const region of regions) {
    assert.equal(region.tabIndex, 0, "keyboard users must be able to focus each independently scrolling Overview column");
    assert.equal(region.attributes.get("role"), "group", "named scroll regions must use a role that exposes their accessible label");
  }
  for (const page of [...html.matchAll(/<div\b[^>]*\bdata-detail-page-index="[^"]*"[^>]*>/g)].map((match) => elementFromTag(match[0]))) {
    assert.equal(page.tabIndex, 0, "long secondary-list pages must support keyboard scrolling independently of pagination");
    assert.equal(page.attributes.get("role"), "group");
    assert.ok(page.attributes.get("aria-label"), "each focusable secondary page must have an accessible name");
  }
  const calendarStart = html.indexOf('class="product-detail-calendar"');
  const specificationsStart = html.indexOf('class="product-detail-all-specs"');
  const calendarContents = html.slice(calendarStart, specificationsStart);
  for (const date of longModel.dates) assert.ok(calendarContents.includes(date.label) && calendarContents.includes(date.value), "all six dates must remain inside the accessible calendar region");
  assert.ok(calendarContents.includes("In development"), "lifecycle data must remain in the same accessible calendar region");
  const specificationsContents = html.match(/<div\b[^>]*class="product-detail-spec-scroll"[^>]*>(<dl\b[\s\S]*?<\/dl>)/)?.[1];
  assert.ok(specificationsContents, "the complete specification list must remain inside its accessible scroll region");
  for (const specification of longModel.specs) assert.ok(specificationsContents.includes(`<dt>${specification.label}</dt>`) && specificationsContents.includes(`<dd>${specification.value}</dd>`), "internal overflow must retain every complete specification");
}
assertKeyboardScrollAccess(initialHtml, "split");
let copiedSku = "";
let closed = false;
details.bind(fixture.container, { onCopy: async (value) => { copiedSku = value; return true; }, onClose: () => { closed = true; } });
const expectedPageCounts = { SKUs: 4, variants: 3, "source records": 4 };
assert.deepEqual(fixture.tabs.map((button) => button.dataset.detailTab), ["overview", "skus", "more"], "only Overview, HP SKUs and More should remain as primary tabs");
assert.deepEqual(fixture.groups.map((group) => group.dataset.detailPageGroup), ["SKUs", "variants", "source records"], "paging must apply only to SKUs, variants and source records");
for (const group of fixture.groups) {
  const count = expectedPageCounts[group.dataset.detailPageGroup];
  assert.equal(group.entries.length, count, "long lists must retain the full number of pages");
  const previous = group.buttons.find((button) => button.dataset.detailPageStep === "-1");
  const next = group.buttons.find((button) => button.dataset.detailPageStep === "1");
  assert.ok(previous.disabled, "first page must disable Previous");
  for (let page = 0; page < count; page += 1) {
    assert.deepEqual(group.entries.map((entry, index) => entry.classList.contains("hidden") ? null : index).filter((index) => index !== null), [page], "exactly one page must be visible");
    if (page < count - 1) await next.fire("click");
  }
  assert.ok(next.disabled, "last page must disable Next");
  assert.match(group.label.textContent, new RegExp(`^${count} / ${count} ·`));
  await next.fire("click");
  assert.ok(!group.entries[count - 1].classList.contains("hidden"), "programmatic next clicks must not move past the last page");
  for (let page = count - 1; page > 0; page -= 1) await previous.fire("click");
  assert.ok(previous.disabled);
}
await fixture.copies[16].fire("click");
assert.equal(copiedSku, "HP-SKU-16", "copy controls on later pages must retain the exact SKU value");
assert.equal(fixture.copies[16].label.textContent, "Copied");
timers.shift()();
assert.equal(fixture.copies[16].label.textContent, "Copy");
await fixture.close.fire("click");
assert.ok(closed);

const skuTab = fixture.tabs.find((button) => button.dataset.detailTab === "skus");
await skuTab.fire("click");
assert.ok(fixture.panels.find((panel) => panel.dataset.detailPanel === "overview").classList.contains("hidden"));
assert.equal(skuTab.attributes.get("aria-selected"), "true");
const keyEvent = await skuTab.fire("keydown", { key: "ArrowRight" });
assert.ok(keyEvent.defaultPrevented, "tab arrow navigation must prevent page scrolling");
const mainMoreTab = fixture.tabs.find((button) => button.dataset.detailTab === "more");
assert.ok(mainMoreTab.focused);
assert.equal(mainMoreTab.tabIndex, 0);
assert.equal(skuTab.tabIndex, -1);
await mainMoreTab.fire("keydown", { key: "End" });
assert.equal(fixture.tabs.at(-1).attributes.get("aria-selected"), "true");
await fixture.tabs.at(-1).fire("keydown", { key: "Home" });
assert.equal(fixture.tabs[0].attributes.get("aria-selected"), "true");
await mainMoreTab.fire("click");
await fixture.moreTabs.find((button) => button.dataset.detailMore === "source").fire("click");
await skuTab.fire("click");
const remembered = details.render(longModel, { surface: "split" });
assert.match(remembered, /data-detail-tab="skus"[^>]*aria-selected="true"/);
assert.match(remembered, /data-detail-more="source"[^>]*aria-selected="true"/);
const viewerHtml = details.render(longModel, { surface: "viewer" });
assert.match(viewerHtml, /data-detail-tab="overview"[^>]*aria-selected="true"/, "viewer state must remain independent of split view");
assertKeyboardScrollAccess(viewerHtml, "viewer");
const combinedIds = [...`${remembered}${viewerHtml}`.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(combinedIds).size, combinedIds.length, "shared renderer surfaces must not introduce duplicate DOM IDs");

const lastPageFixture = fixtureFor(remembered);
details.bind(lastPageFixture.container);
const skuGroup = lastPageFixture.groups.find((group) => group.dataset.detailPageGroup === "SKUs");
for (let index = 1; index < skuGroup.entries.length; index += 1) await skuGroup.buttons.find((button) => button.dataset.detailPageStep === "1").fire("click");
const reducedModel = { ...longModel, skus: longModel.skus.slice(0, 1) };
const reduced = fixtureFor(details.render(reducedModel, { surface: "split" }));
assert.ok(!reduced.groups.find((group) => group.dataset.detailPageGroup === "SKUs").entries[0].classList.contains("hidden"), "shrinking a list must clamp its saved page to valid content");
const another = fixtureFor(details.render({ ...longModel, id: "different-product" }, { surface: "split" }));
assert.ok(!another.groups.find((group) => group.dataset.detailPageGroup === "SKUs").entries[0].classList.contains("hidden"), "switching products must reset pagination");

const hostile = `<img src=x onerror="alert('attack')"> & <script>attack()</script>`;
const hostileModel = {
  id: hostile,
  dates: [{ label: hostile, value: hostile }],
  identity: [{ label: hostile, value: hostile }],
  lifecycle: [{ label: hostile, value: hostile }],
  skus: [{ code: hostile, colors: [{ label: hostile, colorHex: 'red;" onmouseover="attack()', colorHex2: "url(javascript:attack())" }] }],
  specs: [{ label: hostile, value: hostile }],
  variants: [{ group: hostile, code: hostile, label: hostile, colors: [] }],
  source: { category: hostile, imported: hostile, records: [{ code: hostile, description: hostile, ga: hostile, em: hostile }] },
};
const hostileHtml = details.render(hostileModel, { surface: `viewer" onclick="attack()` });
assert.ok(!hostileHtml.includes("<img") && !hostileHtml.includes("<script>"), "hostile product strings must render as text rather than elements");
assert.ok(!hostileHtml.includes('onclick="attack()'), "renderer surface options must not inject HTML attributes");
assert.ok(hostileHtml.includes("&lt;img") && hostileHtml.includes("&amp;") && hostileHtml.includes("&quot;") && hostileHtml.includes("&#39;"));
assert.ok(!hostileHtml.includes("url(javascript:") && !hostileHtml.includes("--sku-primary:red"), "swatch styles must reject arbitrary CSS and URL values");
assert.match(hostileHtml, /data-detail-surface="split"/, "unrecognized surface options must use a valid state and ID namespace");

const dualProduct = {
  variantGroups: [{ type: "color", items: [{ id: "dual", code: "WHT-PNK", colorName: "White", colorName2: "Pink", colorHex: "#eeeeee", colorHex2: "#ff5599" }] }],
  ascm: { records: [{ basePartNumber: "MANUAL", colorCode: "BK" }] },
};
// Verify the actual application adapter supplies all six dates and the manual
// mapping before handing its model to the shared renderer.
const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const appModelSandbox = {
  PortfolioModel: modelRules,
  PRODUCT_TIER_OPTIONS: ["", "Core", "Core+", "Hero", "Star", "Star+"],
  board: { lanes: [{ id: "wired", label: "Wired" }] },
  activeCategoryRecord: () => ({ name: "PC Gaming Audio" }),
  categoryDefinition: () => ({ name: "PC Gaming Audio" }),
};
vm.createContext(appModelSandbox);
const adapterFunctions = ["productDetailsModel", "normalizeAscmProductMetadata", "normalizeAscmRecord", "normalizeProductInfoDate", "formatProductInfoDate", "normalizePartSku", "productPartSkus", "productVariantGroups", "productTier", "monthIndex", "roadmapLabel", "splitRoadmapStatusLabel"];
for (const name of adapterFunctions) {
  const definition = appSource.match(new RegExp(`^function ${name}\\([^]*?^\\}`, "m"));
  assert.ok(definition, `date/mapping integration requires the actual ${name} adapter`);
  new vm.Script(definition[0]).runInContext(appModelSandbox);
}
const actualProduct = {
  ...dualProduct,
  id: "dual-product",
  laneId: "wired",
  partSkus: [{ id: "manual-part", code: "MANUAL", variantId: "dual" }],
  generalAvailabilityDate: "2026-01-01",
  endManufacturingDate: "2026-01-02",
  ffsDate: "2026-01-03",
  globalAnnouncementDate: "2026-01-04",
  webReadinessDate: "2026-01-05",
  finalAssetsDate: "2026-01-06",
  specs: [],
};
const actualDetailModel = appModelSandbox.productDetailsModel(actualProduct);
assert.deepEqual(JSON.parse(JSON.stringify(actualDetailModel.dates.map((item) => item.label))), dateLabels, "the actual app adapter must include all six date fields in order");
assert.deepEqual(JSON.parse(JSON.stringify(actualDetailModel.dates.map((item) => item.value))), ["Jan 1, 2026", "Jan 2, 2026", "Jan 3, 2026", "Jan 4, 2026", "Jan 5, 2026", "Jan 6, 2026"]);
const actualDatesHtml = details.render(actualDetailModel, { surface: "viewer" });
const actualDatesPanel = actualDatesHtml.match(/<section\b[^>]*data-detail-panel="overview"[^>]*>([\s\S]*?)<\/section>/);
assert.ok(!actualDatesPanel[0].split(">")[0].includes("hidden"));
for (const date of actualDetailModel.dates) assert.ok(actualDatesPanel[1].includes(`<span>${date.label}</span>`) && actualDatesPanel[1].includes(date.value), "actual product dates must remain visible in the primary information panel");
const missingDateModel = appModelSandbox.productDetailsModel({ ...actualProduct, ffsDate: "" });
assert.equal(missingDateModel.dates[2].value, "TBD", "missing dates must remain visible as TBD rather than disappearing");
assert.equal(missingDateModel.dates[2].empty, true);
const dualHtml = details.render(actualDetailModel);
assert.ok(dualHtml.includes("White / Pink") && dualHtml.includes("is-dual"));
assert.ok(dualHtml.includes("--sku-primary:#eeeeee;--sku-secondary:#ff5599"), "manual two-tone SKU assignment must retain both mapped colors");
const layoutOnlyHtml = details.render({ id: "layout-only", variants: [{ group: "Layouts", code: "US", label: "United States", colors: [] }] });
assert.ok(!layoutOnlyHtml.includes("Not assigned"), "layout-only variants must not display an unrelated missing-color warning");
const missingColorHtml = details.render({ id: "unassigned", skus: [{ code: "UNKNOWN", colors: [] }] });
assert.ok(missingColorHtml.includes("Not assigned"), "HP SKUs without established color links must remain explicitly unassigned");

const clearable = {
  version: 4,
  activeCategoryId: "audio",
  settings: { timeline: { startMonth: "2026-01", endMonth: "2030-12" }, custom: true },
  ascmSnapshot: { basePartNumbers: ["OLD"] },
  imageAssets: [{ id: "local-image" }, { id: "url-image" }],
  categories: [
    { id: "audio", name: "Audio", templates: ["keep-template"], board: { title: "My audio", lanes: [{ id: "wired", label: "Wired" }], settings: { showSkus: false }, products: [{ id: "audio-product", specs: [{ label: "Driver", value: "53 mm" }], imageAssetId: "local-image" }] } },
    { id: "mice", name: "Mice", board: { title: "My mice", lanes: [{ id: "wireless", label: "Wireless" }], settings: { showPrices: true }, products: [{ id: "mouse-product", imageAssetId: "url-image" }] } },
  ],
};
const retainedStructure = structuredClone(clearable);
const clearResult = modelRules.clearAllProducts(clearable);
assert.equal(clearResult, clearable, "clearing should update the active portfolio rather than replacing its identity");
assert.ok(clearable.categories.every((category) => category.board.products.length === 0), "clearing must remove products from every category");
assert.deepEqual(clearable.imageAssets, [], "clearing all products must remove their image metadata");
assert.ok(!Object.hasOwn(clearable, "ascmSnapshot"), "clearing must remove stale ASCM snapshot links");
assert.equal(clearable.activeCategoryId, retainedStructure.activeCategoryId);
assert.deepEqual(clearable.settings, retainedStructure.settings);
for (const [index, category] of clearable.categories.entries()) {
  const expected = structuredClone(retainedStructure.categories[index]);
  expected.board.products = [];
  assert.deepEqual(category, expected, "clearing must retain category names, lanes, settings, templates and board titles");
}
assert.deepEqual(modelRules.clearAllProducts(clearable), clearable, "repeated clearing must be safe");

// Execute the actual card and inline-pane geometry together. The pane has no
// content-measurement adapter: any attempt to derive its height from the DOM
// fails, including when Overview contains more information than the card fits.
const paneLanes = ["first", "middle", "last"].map((id) => ({ id }));
const bindCalls = [];
function paneElement() {
  const attributes = new Map();
  const classes = new Set();
  const properties = new Map();
  return {
    dataset: {}, innerHTML: "", attributes,
    style: { setProperty: (name, value) => properties.set(name, value), getPropertyValue: (name) => properties.get(name) || "" },
    classList: {
      contains: (name) => classes.has(name),
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      remove: (name) => classes.delete(name),
    },
    setAttribute: (name, value) => attributes.set(name, value),
    querySelector() { throw new Error("Product-pane sizing must not measure natural content or change the active tab"); },
  };
}
const viewerPane = paneElement();
const viewerOutline = paneElement();
const paneSandbox = {
  PortfolioModel: modelRules,
  PortfolioDetails: { render: details.render, bind: (container, callbacks) => bindCalls.push({ container, callbacks }) },
  board: { products: [], settings: { showSkus: false, fullSingleLaneSpecs: false } },
  sortedLanes: () => paneLanes,
  categoryDefinition: () => ({ fullSpecCards: true }),
  variantFooterLayout: () => ({ height: 0 }),
  activeView: "products", zoom: 1, PRODUCT_MIN_ZOOM: .2,
  viewerInfoProductId: null, viewerInfoProgress: 0, viewerInfoOpen: false,
  viewerInfo: viewerPane, viewerInfoOutline: viewerOutline, renderedCards: [],
  selectedProduct: () => null,
  productDetailsModel: (product) => ({ ...longModel, id: product.id, specs: product.specs }),
  escapeHtml: decode,
  inspectorOpen: false, inspector: { offsetWidth: 0 },
  canvasScroll: { clientWidth: 360, clientHeight: 76 },
  copyTextToClipboard() {}, closeViewerInfo() {},
};
paneSandbox.visibleProducts = () => paneSandbox.board.products;
Object.defineProperty(paneSandbox, "viewerInfoContentHeight", {
  get() { throw new Error("Content length must never determine the inline pane's height"); },
  set() { throw new Error("Content length must never determine the inline pane's height"); },
});
vm.createContext(paneSandbox);
const paneFunctions = [
  "normalizedSpecLabel", "detailedValueLineCount", "isDetailedMatrixSpec", "isDetailedPairCandidate", "detailedSpecRows", "detailedSpecRowHeight", "detailedSpecsHeight", "productCardLayout",
  "infoProduct", "viewerInfoVisualWidth", "viewerInfoVisualHeight", "setViewerInfoSize", "viewerInfoReserveLogical", "viewerInfoGapIndex", "cardXForDisplayIndex", "productLaneGeometry", "getCanvasDimensions", "renderViewerInfo", "positionViewerInfo",
];
const paneDefinitions = paneFunctions.map((name) => {
  const definition = appSource.match(new RegExp(`^function ${name}\\([^]*?^\\}`, "m"));
  assert.ok(definition, `pane integration requires the actual ${name} implementation`);
  return definition[0];
});
vm.runInContext(
  appSource.slice(appSource.indexOf("const CARD_WIDTH"), appSource.indexOf("const PLACEHOLDER_IMAGE")) +
  appSource.slice(appSource.indexOf("const FULL_SPEC_MIN_CARD_HEIGHT"), appSource.indexOf("// Canvas colors")) +
  paneDefinitions.join("\n"),
  paneSandbox,
);
const closeEnough = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} versus ${expected}`);
const laneSnapshot = (dimensions) => JSON.parse(JSON.stringify(dimensions.laneRows));
const paneScenarios = [
  { name: "empty compact card", specs: [], full: false },
  { name: "bounded compact card", specs: longModel.specs, full: false },
  { name: "full specifications", specs: Array.from({ length: 24 }, (_, index) => ({ label: `Compatibility ${index}`, value: "Detailed specification content ".repeat(9) })), full: true },
];
for (const scenario of paneScenarios) {
  paneSandbox.board.settings.fullSingleLaneSpecs = scenario.full;
  paneSandbox.board.products = paneLanes.map((lane) => ({ id: `pane-${lane.id}`, name: "Product details", laneId: lane.id, specs: scenario.specs }));
  // A populated first lane makes the horizontal reserve observable beyond the
  // board's minimum canvas width, even at the smallest supported zoom.
  paneSandbox.board.products.push(...Array.from({ length: 6 }, (_, index) => ({ id: `following-${index}`, laneId: "first", specs: scenario.specs })));
  const layout = paneSandbox.productCardLayout();
  if (scenario.full) assert.ok(layout.detailed && layout.cardHeight > 552, "full-spec parent geometry must be exercised above the compact maximum");
  for (const drawZoom of [.2, .5, .65, 1, 1.5]) {
    paneSandbox.zoom = drawZoom;
    paneSandbox.viewerInfoProgress = 0;
    const closedDimensions = paneSandbox.getCanvasDimensions();
    for (const lane of paneLanes) {
      paneSandbox.viewerInfoProductId = `pane-${lane.id}`;
      paneSandbox.viewerInfoOpen = true;
      const row = closedDimensions.laneRows.find((item) => item.lane.id === lane.id);
      const card = { productId: `pane-${lane.id}`, x: 18, y: row.top, width: 246, height: layout.cardHeight };
      paneSandbox.renderedCards = [card];
      const parentHeight = card.height * drawZoom;
      const expectedWidth = parentHeight <= 180 || scenario.specs.length > 14 ? 840 : parentHeight <= 280 ? 760 : 620;
      closeEnough(paneSandbox.viewerInfoVisualHeight(), parentHeight, "fallback height exactly follows the parent's rendered height");
      assert.equal(paneSandbox.viewerInfoVisualWidth(), expectedWidth, "short or information-heavy cards gain horizontal space");
      paneSandbox.renderViewerInfo();
      assert.ok(viewerPane.innerHTML.includes('data-detail-surface="viewer"'), "the app must mount the shared detail controls on the viewer surface");
      assert.equal(bindCalls.at(-1).container, viewerPane);
      assert.equal(bindCalls.at(-1).callbacks.onCopy, paneSandbox.copyTextToClipboard);
      assert.equal(bindCalls.at(-1).callbacks.onClose, paneSandbox.closeViewerInfo);
      for (const progress of [.01, .25, .5, 1]) {
        paneSandbox.viewerInfoProgress = progress;
        const dimensions = paneSandbox.getCanvasDimensions();
        assert.equal(dimensions.height, closedDimensions.height, "opening any pane must leave total board height unchanged");
        assert.deepEqual(laneSnapshot(dimensions), laneSnapshot(closedDimensions), "all lane positions and heights must remain stable throughout opening");
        const reserve = (expectedWidth + 10) / drawZoom * progress;
        closeEnough(dimensions.width - closedDimensions.width, reserve, "opening increases only horizontal canvas space");
        closeEnough(paneSandbox.viewerInfoReserveLogical(), reserve, "horizontal animation reserve matches the visible pane width plus its gap");
        const placement = paneSandbox.positionViewerInfo();
        closeEnough(Number.parseFloat(viewerPane.style.getPropertyValue("--viewer-info-height")), parentHeight, "pane height equals its actual rendered parent at every zoom and animation step");
        closeEnough(Number.parseFloat(viewerOutline.style.height), parentHeight, "the surrounding outline has the same parent height");
        closeEnough(placement.paneBottom, (card.y + card.height) * drawZoom, "pane bottom aligns exactly with the product bottom");
        closeEnough(Number.parseFloat(viewerPane.style.top), card.y * drawZoom, "pane top aligns exactly with the product top");
        closeEnough(placement.paneLeft, (card.x + card.width) * drawZoom + 10, "pane remains beside its own product");
        closeEnough(placement.paneRight - placement.paneLeft, expectedWidth * progress, "opening reveals the pane horizontally");
        assert.equal(viewerPane.dataset.compactHeight, String(parentHeight <= 180));
        assert.equal(viewerPane.dataset.detailColumns, String(parentHeight <= 280 || scenario.specs.length > 14 ? 2 : 1));
        assert.equal(viewerPane.style.pointerEvents, progress > .96 ? "auto" : "none", "controls become interactive when the pane finishes opening");
        const exported = paneSandbox.getCanvasDimensions({ includeViewer: false });
        assert.equal(exported.width, closedDimensions.width, "exports omit the temporary horizontal detail reserve");
        assert.equal(exported.height, closedDimensions.height);
      }
    }
  }
}

// Use a deliberately different rendered height to catch accidental dependence
// on category/card estimates when positioning the live pane.
paneSandbox.zoom = .65;
paneSandbox.renderedCards[0].height = 317;
paneSandbox.positionViewerInfo();
closeEnough(Number.parseFloat(viewerPane.style.getPropertyValue("--viewer-info-height")), 317 * .65, "live positioning always uses the actual rendered parent rectangle");
paneSandbox.renderedCards = [];
assert.equal(paneSandbox.positionViewerInfo(), null, "a filtered-out or stale parent must have no positioned detail pane");
assert.equal(viewerPane.attributes.get("aria-hidden"), "true");
assert.ok(!viewerPane.classList.contains("is-open"));
paneSandbox.viewerInfoProductId = null;
paneSandbox.viewerInfoOpen = false;
paneSandbox.viewerInfoProgress = 0;
paneSandbox.renderViewerInfo();
assert.equal(viewerPane.innerHTML, "", "closing must clear the pane's obsolete content");

console.log("Product detail tests passed: complete information and tab/copy controls, escaped markup, exact parent-height panes across compact/full-spec zoom and animation, stable lanes, horizontal reserves, and preserved clearing structure.");
