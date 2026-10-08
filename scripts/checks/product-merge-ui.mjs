import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
await import("../../public/js/master-model.js");
await import("../../public/js/product-merge.js");
await import("../../public/js/product-merge-ui.js");
const ui = globalThis.PortfolioProductMergeUI;
const copy = (value) => structuredClone(value);
const product = (id, name, sku = "", fields = {}) => ({ id, name, laneId: "wired", order: 2, roadmap: {}, specs: [], partSkus: sku ? [{ id: `${id}-hp`, code: sku }] : [], variantGroups: [], ...fields });
const entry = (item, categoryId = "pc") => ({ product: item, categoryId, categoryName: categoryId === "pc" ? "PC Gaming Audio" : "Console Gaming Audio", laneName: "Wired" });

function fixture({ document = null, conflict = false } = {}) {
  let products = [entry(product("keeper", "Cloud Team", "HP001", { specs: [{ id: "weight", label: "Weight", value: conflict ? "300 g" : "" }], ...(conflict ? { imageAssetId: "hero-keep" } : {}) })),
    entry(product("source", "Cloud Team", "HP001", { specs: [{ id: "weight-source", label: "Weight", value: "310 g" }, { id: "battery", label: "Battery life", value: "80 h" }], ...(conflict ? { imageAssetId: "hero-other" } : {}) })),
    entry(product("name", "cloud team™", "OTHER")), entry(product("different", "Solo", "UNRELATED")), entry(product("locked", "Locked", "HP001")), entry(product("console", "Cloud Team", "HP001"), "console")];
  const messages = [], calls = [], notifications = { publish(message) { messages.push(message); }, resolve(id) { calls.push({ kind: "resolve", id }); } };
  let undo = null;
  const adapter = {
    getProducts: () => products, getSelectedProductId: () => "keeper", canMerge: (first, second) => [first, second].includes("locked") ? { allowed: false, message: "Finish the current product update first." } : { allowed: true },
    getImageSource: (asset) => `/images/${asset}.png`,
    applyMerge(payload) { calls.push({ kind: "apply", payload }); undo = copy(products); const target = products.find((item) => item.product.id === payload.productId); target.product = copy(payload.product); products = products.filter((item) => item.product.id !== payload.sourceProductId); return { undoId: "undo-one" }; },
    undoMerge(id) { calls.push({ kind: "undo", id }); if (!undo) return false; products = undo; undo = null; return true; },
    openProduct(id) { calls.push({ kind: "open", id }); }, saveChanges() { calls.push({ kind: "save" }); },
  };
  const controller = ui.createController({ adapter, notifications, document });
  return { controller, adapter, messages, calls, products: () => products };
}

const first = fixture(); const originals = copy(first.products());
assert.equal(first.controller.open(), true); assert.equal(first.controller.getState().phase, "pick");
const candidates = first.controller.getState().candidates;
assert.ok(!candidates.some((item) => item.productId === "console"), "Matching cross-category listings are never suggested for consolidation.");
assert.ok(!candidates.some((item) => item.productId === "keeper"));
assert.equal(candidates[0].match.score, 101); assert.equal(candidates.find((item) => item.productId === "name").match.score, 80);
assert.equal(candidates.find((item) => item.productId === "locked").allowed, false);
assert.equal(first.controller.selectSource("console"), false); assert.equal(first.controller.selectSource("locked"), false);
assert.equal(first.controller.search("310 g").length, 0); assert.equal(first.controller.search("UNRELATED")[0].productId, "different");
first.controller.search(""); assert.equal(first.controller.selectSource("source"), true);
assert.deepEqual(first.products(), originals, "Picking and previewing never edits either product.");
assert.equal(first.controller.getState().remaining, 0); assert.equal(first.controller.getState().planned.product.specs[0].value, "310 g");
assert.equal(first.controller.close(), true); assert.equal(await first.controller.apply(), false, "A cancelled review cannot be applied later.");
assert.deepEqual(first.products(), originals);
first.controller.open({ productId: "keeper", sourceProductId: "source" });
assert.equal(await first.controller.apply(), true);
assert.equal(first.products().length, 5); assert.ok(!first.products().some((item) => item.product.id === "source"));
assert.equal(first.products().find((item) => item.product.id === "keeper").product.specs.length, 2);
assert.equal(first.calls.filter((call) => call.kind === "apply").length, 1);
const payload = first.calls.find((call) => call.kind === "apply").payload;
assert.equal(payload.productId, "keeper"); assert.equal(payload.sourceProductId, "source"); assert.equal(payload.keeperOriginal.id, "keeper");
assert.equal(payload.keeperSignature, ui.signature(payload.keeperOriginal)); assert.equal(payload.sourceSignature, ui.signature(payload.sourceOriginal));
const notice = first.messages.find((message) => message.id === "product-merge-complete");
assert.ok(notice.actions.some((action) => action.label === "Review changes")); assert.ok(notice.actions.some((action) => action.label === "Undo merge"));
await notice.actions.find((action) => action.label === "Review changes").onClick(); assert.ok(first.calls.some((call) => call.kind === "save"));
await notice.actions.find((action) => action.label === "Undo merge").onClick(); assert.deepEqual(first.products(), originals, "Undo restores both original products and all their information.");

const conflicting = fixture({ conflict: true }); conflicting.controller.open({ sourceProductId: "source" });
assert.ok(conflicting.controller.getState().remaining >= 2); assert.deepEqual(conflicting.controller.getState().choices, {}, "Different known values have no preselected winner.");
assert.equal(await conflicting.controller.apply(), false); assert.equal(conflicting.calls.filter((call) => call.kind === "apply").length, 0);
assert.equal(conflicting.controller.choose("missing", "source"), false); assert.equal(conflicting.controller.choose("imageAssetId", "anything"), false);
for (const item of conflicting.controller.getState().planned.conflicts) conflicting.controller.choose(item.key, "source");
assert.equal(conflicting.controller.getState().remaining, 0); assert.equal(await conflicting.controller.apply(), true);
assert.equal(conflicting.products()[0].product.imageAssetId, "hero-other"); assert.equal(conflicting.products()[0].product.specs[0].value, "310 g");

const swap = fixture(); swap.controller.open({ sourceProductId: "source" }); assert.equal(swap.controller.swap(), true);
assert.equal(swap.controller.getState().productId, "source"); assert.equal(swap.controller.getState().sourceProductId, "keeper");
assert.equal(await swap.controller.apply(), true); assert.ok(swap.products().some((item) => item.product.id === "source")); assert.ok(!swap.products().some((item) => item.product.id === "keeper"));

const stale = fixture(); stale.controller.open({ sourceProductId: "source" }); stale.products()[1].product.specs[0].value = "320 g";
assert.equal(await stale.controller.apply(), false); assert.match(stale.controller.getState().error, /changed while/); assert.ok(!stale.calls.some((call) => call.kind === "apply"));
const failed = fixture(); failed.adapter.applyMerge = () => { const error = new Error("Private failed request details"); error.code = "TEMPORARY"; throw error; };
failed.controller.open({ sourceProductId: "source" }); assert.equal(await failed.controller.apply(), false); assert.equal(failed.controller.getState().open, true);
assert.match(failed.controller.getState().error, /original products are safe/); assert.doesNotMatch(failed.controller.getState().error, /Private|server|GitHub|master|storage/);
assert.equal(failed.controller.destroy(), true); assert.equal(failed.controller.open(), false);
assert.equal(ui.signature({ z: 3, a: { y: 2, x: 1 } }), ui.signature({ a: { x: 1, y: 2 }, z: 3 }), "Stale-review fingerprints do not depend on object property order.");

function createDocument() {
  const doc = { activeElement: null };
  class Node {
    constructor(tag) { this.tagName = tag.toLowerCase(); this.children = []; this.parentNode = null; this.attributes = new Map(); this.dataset = {}; this.events = new Map(); this.className = ""; this.open = false; this.disabled = false; this.hidden = false; this._text = ""; }
    get textContent() { return this._text + this.children.map((node) => node.textContent).join(""); }
    set textContent(value) { this._text = String(value); this.replaceChildren(); }
    get lastElementChild() { return this.children.at(-1) || null; }
    get isConnected() { return this === doc.body || Boolean(this.parentNode?.isConnected); }
    get classList() { return { contains: (value) => this.className.split(/\s+/).includes(value), toggle: (value, force) => { const values = new Set(this.className.split(/\s+/).filter(Boolean)); const add = force === undefined ? !values.has(value) : force; if (add) values.add(value); else values.delete(value); this.className = [...values].join(" "); } }; }
    append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
    replaceChildren(...nodes) { for (const node of this.children) node.parentNode = null; this.children = []; this.append(...nodes); }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    addEventListener(name, callback) { const listeners = this.events.get(name) || []; listeners.push(callback); this.events.set(name, listeners); }
    async fire(name, event = {}) { const payload = { target: this, preventDefault() {}, ...event }; for (const listener of this.events.get(name) || []) await listener(payload); }
    focus() { doc.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((node) => node !== this); this.parentNode = null; }
    getBoundingClientRect() { return { left: 10, top: 10, right: 800, bottom: 700 }; }
    querySelectorAll(selector) {
      const nodes = this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
      return nodes.filter((node) => selector.split(",").some((part) => {
        const test = part.trim(); if (test === "*") return true;
        if (test === "[data-merge-conflict]") return node.dataset.mergeConflict !== undefined;
        if (test === "details[open]") return node.tagName === "details" && node.open;
        return node.tagName === test;
      }));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  doc.createElement = (tag) => new Node(tag); doc.body = new Node("body"); doc.activeElement = doc.body;
  doc.getElementById = (id) => [doc.body, ...doc.body.querySelectorAll("*")].find((node) => node.id === id) || null;
  return doc;
}
const document = createDocument(), trigger = document.createElement("button"); document.body.append(trigger); trigger.focus();
const dom = fixture({ document, conflict: true }); dom.controller.open();
const dialog = document.getElementById("productMergeDialog"); assert.equal(dialog.open, true); assert.equal(dialog.getAttribute("aria-labelledby"), "productMergeTitle");
assert.equal(document.activeElement.tagName, "input");
const lockedButton = dialog.querySelectorAll("button").find((node) => node.getAttribute("aria-label") === "Compare Locked"); assert.equal(lockedButton.disabled, true, "Refreshes must not re-enable an ineligible product.");
dom.controller.selectSource("source");
const apply = dialog.querySelectorAll("button").find((node) => node.textContent === "Merge products"); assert.equal(apply.disabled, true);
const images = dialog.querySelectorAll("img"); assert.equal(images.length, 2); assert.ok(images.every((node) => node.alt.includes("image")));
assert.doesNotMatch(dialog.textContent, /hero-keep|hero-other/, "Image decisions show images without exposing internal asset identifiers.");
for (const item of dom.controller.getState().planned.conflicts) dom.controller.choose(item.key, "keeper");
assert.equal(apply.disabled, false); assert.ok(dialog.querySelectorAll("[data-merge-conflict]").every((node) => node.classList.contains("is-resolved")));
const previews = dialog.querySelectorAll("details").filter((node) => node.dataset.previewSection);
assert.equal(previews.length, 5); assert.ok(previews.every((node) => !node.open), "Full product sections start collapsed so the review stays manageable.");
previews[0].open = true; dom.controller.choose("imageAssetId", "source"); assert.equal(dialog.querySelectorAll("details").find((node) => node.dataset.previewSection === "details").open, true, "Choosing a value preserves expanded preview sections.");
await dialog.fire("cancel"); assert.equal(dialog.open, false); assert.equal(document.activeElement, trigger); assert.equal(dom.calls.filter((call) => call.kind === "apply").length, 0);
dom.controller.open({ sourceProductId: "source" }); await dialog.fire("click", { clientX: 0, clientY: 0 }); assert.equal(dialog.open, false); assert.equal(document.activeElement, trigger);
const css = await readFile(new URL("../../public/css/product-merge.css", import.meta.url), "utf8");
assert.match(css, /product-merge-body[^}]*overflow:\s*auto/); assert.match(css, /product-merge-footer[^}]*flex:\s*0 0 auto/); assert.match(css, /@media \(max-width: 600px\)/);
console.log("Product merge UI checks passed: scoped suggestions, explicit final choices, cancellation, direction swap, stale-edit guard, draft merge and undo, simple feedback, accessible image choices, collapsed previews, and mobile layout.");
