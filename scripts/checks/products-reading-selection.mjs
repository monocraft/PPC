import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
await import("../../public/js/portfolio-model.js");
await import("../../public/js/portfolio-search.js");
await import("../../public/js/reference-theme.js");
await import("../../public/js/product-details.js");

const source = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../../public/css/styles.css", import.meta.url), "utf8");
const extract = name => {
  const definition = source.match(new RegExp(`^function ${name}\\([^]*?^\\}`, "m"));
  assert.ok(definition, `exercise the real ${name} implementation`);
  return definition[0];
};
const freeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
function node() {
  const classes = new Set();
  return { textContent: "", dataset: {}, attributes: {},
    style: { setProperty(name, value) { this[name] = value; } },
    classList: { toggle(name, active) { if (active) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) },
    setAttribute(name, value) { this.attributes[name] = String(value); },
  };
}

function selectionHarness({ open = false, selectedId = "cloud", viewerId = "cloud", catalogGroups = ["all"] } = {}) {
  const products = freeze([
    { id: "cloud", name: "Cloud III Wireless", laneId: "wireless", order: 7, price: 149.99, roadmap: { status: "launched" },
      generalAvailabilityDate: "2024-05-02", imageAssetId: "saved-cloud-image", partSkus: [{ id: "sku-cloud", code: "7P5J2AA" }], custom: { curated: "Keep local draft" } },
    { id: "pulsefire", name: "Pulsefire Haste 2", laneId: "wired", order: 16, price: 79.99, roadmap: { status: "launched" }, partSkus: [{ id: "sku-pulsefire", code: "6N0A7AA" }] },
    { id: "eol", name: "Cloud Orbit S", laneId: "wired", order: 16, statusType: "discontinued", roadmap: { status: "end-of-life" } },
  ]);
  const business = freeze({ board: { products, settings: { catalogGroups }, lanes: [{ id: "wireless", order: 2 }, { id: "wired", order: 9 }] },
    images: { "saved-cloud-image": { local: "retained" } }, masterLocalBaseline: { cloud: { name: "Accepted name" } },
    pending: { cloud: { custom: "Unsaved local draft" } }, categoryDraft: { label: "Unsaved category draft" } });
  const before = JSON.stringify(business);
  const contextNote = node();
  contextNote.classList.toggle("hidden", true);
  const field = { value: "2026-", selectionStart: 5, selectionEnd: 5, validationMessage: "Incomplete date" };
  const input = { value: "", focus() { events.push("search focus"); } };
  const edit = { disabled: false, focus() { events.push("edit focus"); } };
  const events = [];
  const frames = [];
  const inspector = { querySelector: selector => selector === "#editorSelectionContext" ? contextNote : null,
    contains: target => target === field, setAttribute() {}, className: "inspector is-open" };
  const state = { board: business.board, selectedId, viewerInfoProductId: viewerId, inspectorOpen: open, activeView: "products", searchQuery: "", inspector,
    PortfolioModel: globalThis.PortfolioModel, PortfolioSearch: globalThis.PortfolioSearch, document: { activeElement: field },
    editSelectedButton: edit, $: selector => selector === "#searchInput" ? input : selector === "#quickEditSelected" ? edit : null,
    renderInspector() { assert.equal(state.inspectorOpen, false, "search cannot rebuild any open editor or erase partial field input"); events.push("closed inspector render"); edit.disabled = !state.selectedProduct(); },
    closeViewerInfo(options) { assert.equal(options.render, false); state.viewerInfoProductId = null; events.push("viewer close"); },
    renderBoard() { state.syncProductEditorSelectionContext(); events.push("board render"); },
    updateDataEditIndicator() { events.push("edit indicator"); },
    requestAnimationFrame(callback) { frames.push(callback); },
    scheduleSave() { throw new Error("Search and selection cannot persist product changes"); },
    updateBoard() { throw new Error("Search and selection cannot mutate products"); },
  };
  vm.createContext(state);
  vm.runInContext(["visibleProducts", "selectedProduct", "syncProductEditorSelectionContext", "reconcileProductSearchSelection", "setProductSearchQuery", "applyInspectorState", "closeInspector"].map(extract).join("\n"), state);
  vm.runInContext(source.match(/^\$\("#searchInput"\)\.oninput = [^\n]+/m)[0], state);
  return { state, events, input, edit, field, contextNote, flushFrames() { while (frames.length) frames.shift()(); },
    assertUnchanged() { assert.equal(JSON.stringify(business), before, "browsing preserves dates, placement gaps/ties, assets, accepted baseline and all saved/unsaved draft facts"); } };
}

{
  const h = selectionHarness();
  h.input.oninput({ target: { value: "Pulsefire" } });
  assert.equal(h.state.searchQuery, "Pulsefire");
  assert.equal(h.state.selectedId, null, "a hidden closed-editor selection cannot remain the Edit target");
  assert.equal(h.edit.disabled, true);
  assert.equal(h.state.viewerInfoProductId, null, "search closes a stale read panel independently of editing");
  assert.deepEqual(Array.from(h.state.visibleProducts(), product => product.id), ["pulsefire"]);
  h.input.oninput({ target: { value: "" } });
  assert.equal(h.state.selectedId, null, "clearing search must not select or edit an arbitrary visible product");
  h.assertUnchanged();
}
{
  const h = selectionHarness({ open: true });
  const originalField = h.field, fieldBytes = JSON.stringify(h.field);
  h.input.oninput({ target: { value: "6N0A7AA" } });
  assert.equal(h.state.selectedId, "cloud", "an open editor retains its intentional product target");
  assert.equal(h.state.inspectorOpen, true);
  assert.equal(h.state.viewerInfoProductId, null);
  assert.equal(h.contextNote.textContent, "Editing Cloud III Wireless — outside current results");
  assert.equal(h.contextNote.classList.contains("hidden"), false);
  assert.equal(h.field, originalField); assert.equal(JSON.stringify(h.field), fieldBytes, "partial uncommitted input and caret survive search");
  assert.ok(!h.events.includes("closed inspector render"));
  h.input.oninput({ target: { value: "Cloud" } });
  assert.equal(h.contextNote.textContent, ""); assert.equal(h.contextNote.classList.contains("hidden"), true, "matching the edit target removes stale context");
  h.input.oninput({ target: { value: "No matching product" } });
  h.state.closeInspector();
  h.flushFrames();
  assert.equal(h.state.selectedId, null, "closing a preserved hidden editor clears the invisible selection");
  assert.equal(h.edit.disabled, true); assert.equal(h.events.at(-1), "search focus", "focus returns to usable search instead of a disabled Edit button");
  h.assertUnchanged();
}
{
  const h = selectionHarness({ selectedId: "pulsefire", viewerId: "cloud" });
  h.input.oninput({ target: { value: "Pulsefire" } });
  assert.equal(h.state.selectedId, "pulsefire", "still-visible selection remains intentional");
  assert.equal(h.state.viewerInfoProductId, null, "a hidden read panel closes even when selection is visible");
  h.assertUnchanged();
}
{
  const h = selectionHarness({ selectedId: "eol", viewerId: "eol", catalogGroups: ["launched"] });
  h.input.oninput({ target: { value: "Cloud" } });
  assert.equal(h.state.selectedId, null, "search uses the actual shared lifecycle-filtered product set");
  assert.deepEqual(Array.from(h.state.visibleProducts(), product => product.id), ["cloud"]);
  h.assertUnchanged();
}

// Measure the real reading-pane positioning path across every detail tab and
// geometry. The presentation still reports Discontinued; only the opened
// reading pane and its integrated selection boundary are opaque.
const product = freeze({ id: "retired", name: "Cloud Orbit S", statusType: "discontinued", laneId: "wired", order: 23,
  generalAvailabilityDate: "2022-06-03", endManufacturingDate: "2025-03-11", imageAssetId: "retired-image", roadmap: { status: "end-of-life" } });
const productBytes = JSON.stringify(product);
const model = { id: product.id, name: product.name, specs: [{ label: "Connection", value: "USB" }], dates: [{ key: "general-availability", label: "General availability", value: "Jun 3, 2022" }],
  skus: [{ code: "4P5M0AA", colors: [] }], identity: [{ label: "Category", value: "PC Gaming Audio" }], lifecycle: [{ key: "stage", label: "Stage", value: "End of life" }], variants: [] };
const pane = node(), outline = node();
const paneState = { viewerInfo: pane, viewerInfoOutline: outline, viewerInfoProductId: product.id, viewerInfoProgress: 1,
  activeView: "products", zoom: 1, CARD_WIDTH: 246, STATUS_BANNER_HEIGHT: 24, UI_PALETTE: globalThis.PortfolioTheme.uiPalette,
  PortfolioModel: globalThis.PortfolioModel, PortfolioTheme: globalThis.PortfolioTheme,
  standardizedStatus: () => ({ label: "DISCONTINUED" }), infoProduct: () => product,
  viewerInfoStacked: () => false, viewerInfoVisualWidth: () => 500, viewerInfoVisualHeight: () => 600,
  setViewerInfoSize() {}, renderedCards: [] };
vm.createContext(paneState);
vm.runInContext(["productPresentation", "positionViewerInfo"].map(extract).join("\n"), paneState);
for (const tab of ["overview", "dates", "skus", "more"]) {
  assert.equal(globalThis.PortfolioDetails.openTab(model, { surface: "viewer", tab }), true);
  assert.match(globalThis.PortfolioDetails.render(model, { surface: "viewer" }), new RegExp(`data-detail-tab="${tab}"[^>]*aria-selected="true"`));
  for (const stacked of [false, true]) for (const zoom of [.2, 1, 2]) for (const progress of [.1, .5, 1]) {
    paneState.zoom = zoom; paneState.viewerInfoProgress = progress;
    paneState.renderedCards = [{ productId: product.id, x: 30, y: 34, width: 246, height: 552, viewerStacked: stacked, integrationX: 30, integrationWidth: 746 }];
    assert.ok(paneState.positionViewerInfo());
    assert.equal(pane.style.opacity, "1", `${tab} text and controls stay fully opaque at every supported card scale and reveal step`);
    assert.equal(outline.style.opacity, "1", "the active reading boundary is distinguishable");
    assert.equal(paneState.productPresentation(product).discontinued, true, "reading cannot change the lifecycle projection");
  }
}
assert.equal(JSON.stringify(product), productBytes);
assert.match(extract("drawCard"), /presentation\.discontinued[\s\S]*?\.4/, "the accepted subdued board card treatment stays intact");
assert.match(extract("renderInspector"), /id="editorSelectionContext"[^>]*role="status"[^>]*aria-atomic="true"/, "editor context is a semantic status in the visible sticky heading");
assert.match(css, /\.editor-selection-context\s*\{[^}]*color:\s*var\(--color-text\)[^}]*font-size:\s*12px[^}]*overflow-wrap:\s*anywhere/, "the edit context reuses readable theme text and wraps on narrow screens");
console.log("Products reading and selection checks passed: full-opacity discontinued details across four tabs, scales, reveal states and stacked layouts; real search/model selection, stale-panel cleanup, preserved open editor and partial input, usable close focus, immutable placement/assets/drafts.");
