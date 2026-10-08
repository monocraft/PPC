import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
await import("../../public/js/portfolio-search.js");
await import("../../public/js/portfolio-search-ui.js");

function createDocument() {
  const doc = { activeElement: null, defaultView: { innerHeight: 800 } };
  class Node {
    constructor(tag) {
      this.tagName = tag.toLowerCase(); this.children = []; this.parentNode = null; this.attributes = new Map(); this.events = new Map();
      this.className = ""; this.hidden = false; this.value = ""; this._text = ""; this.scrollTop = 0;
      this.style = { values: new Map(), setProperty(name, value) { this.values.set(name, value); } };
    }
    get textContent() { return this._text + this.children.map((node) => node.textContent).join(""); }
    set textContent(value) { this._text = String(value); this.replaceChildren(); }
    set innerHTML(_) { throw new Error("Search must use textContent for user-provided content."); }
    get isConnected() { return this === doc.body || Boolean(this.parentNode?.isConnected); }
    get classList() { return { contains: (value) => this.className.split(/\s+/).includes(value) }; }
    append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
    insertBefore(node, reference) { node.remove(); const index = this.children.indexOf(reference); assert.ok(index >= 0); node.parentNode = this; this.children.splice(index, 0, node); }
    replaceChildren(...nodes) { for (const node of this.children) node.parentNode = null; this.children = []; this.append(...nodes); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((node) => node !== this); this.parentNode = null; }
    contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    addEventListener(type, callback) { const listeners = this.events.get(type) || []; listeners.push(callback); this.events.set(type, listeners); }
    removeEventListener(type, callback) { this.events.set(type, (this.events.get(type) || []).filter((listener) => listener !== callback)); }
    fire(type, payload = {}) {
      const event = { target: this, key: "", bubbles: true, defaultPrevented: false, propagationStopped: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; }, ...payload };
      for (let node = this; node; node = event.bubbles && !event.propagationStopped ? node.parentNode : null) {
        event.currentTarget = node;
        node[`on${type}`]?.(event);
        for (const listener of [...(node.events.get(type) || [])]) listener(event);
      }
      return event;
    }
    focus() {
      if (doc.activeElement === this) return;
      const previous = doc.activeElement; doc.activeElement = this;
      previous?.fire("focusout", { relatedTarget: this });
      this.fire("focus", { bubbles: false });
    }
    getBoundingClientRect() { return { left: 12, bottom: 140 }; }
    scrollIntoView(options) { this.lastScroll = options; }
    querySelectorAll(selector) {
      const nodes = this.children.flatMap((node) => [node, ...node.querySelectorAll("*")]);
      return nodes.filter((node) => selector === "*" || selector.startsWith(".") && node.classList.contains(selector.slice(1)) || node.tagName === selector);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  const emitter = new Node("document");
  doc.createElement = (tag) => new Node(tag); doc.body = new Node("body"); doc.body.parentNode = emitter;
  doc.activeElement = doc.body;
  doc.getElementById = (id) => [doc.body, ...doc.body.querySelectorAll("*")].find((node) => node.id === id) || null;
  doc.addEventListener = emitter.addEventListener.bind(emitter); doc.removeEventListener = emitter.removeEventListener.bind(emitter); doc.fire = emitter.fire.bind(emitter); doc.events = emitter.events;
  return doc;
}
const product = (id, name, sku = "", extra = {}) => ({ id, name, laneId: "wireless", partSkus: sku ? [{ id: `${id}-sku`, code: sku }] : [], variantGroups: [], ...extra });
const category = (id, name, products) => ({ id, name, board: { products, lanes: [{ id: "wireless", name: "Wireless" }] } });
function fixture(products = null) {
  const document = createDocument(), controls = document.createElement("section"), roadmapControls = document.createElement("section");
  controls.id = "productControls"; roadmapControls.id = "roadmapControls"; roadmapControls.className = "hidden";
  const inputs = ["searchInput", "roadmapSearch"].map((id, index) => {
    const label = document.createElement("label"), input = document.createElement("input");
    label.className = "search-shell"; input.id = id; input.type = "search"; input.setAttribute("aria-label", index ? "Search roadmap" : "Search products");
    label.append(input); [controls, roadmapControls][index].append(label); return input;
  });
  const outside = document.createElement("button"); document.body.append(controls, roadmapControls, outside);
  let portfolio = { categories: products || [
    category("pc", "PC Gaming Audio", [product("prefix", "Cloud prefix", "HP001-extra"), product("current", "Cloud Team", "HP002")]),
    category("console", "Console Gaming Audio", [product("exact", "Cloud exact", "HP001"), product("variant", "Cloud Color", "HP003", { variantGroups: [{ type: "color", items: [{ id: "black", code: "BK" }] }] })]),
  ] };
  let activeCategory = "pc", view = "products", localFilter = "";
  const calls = [], localListener = (event) => { localFilter = event.target.value; };
  inputs[0].oninput = localListener;
  const adapter = { getPortfolio: () => portfolio, getActiveCategoryId: () => activeCategory, getActiveView: () => view,
    openResult(result) { calls.push(result); outside.focus(); }, saveChanges() { throw new Error("Search must not save."); } };
  const controller = globalThis.PortfolioSearchUI.createController({ adapter, document, eventTarget: document });
  const panel = (index = 0) => inputs[index].parentNode.parentNode.querySelector(".portfolio-search-panel");
  const options = (index = 0) => panel(index).querySelectorAll("li");
  const type = (query, index = 0) => { inputs[index].value = query; inputs[index].fire("input"); };
  const setView = (next) => { view = next; controls.className = next === "products" ? "" : "hidden"; roadmapControls.className = next === "products" ? "hidden" : ""; document.fire("portfolio:render"); };
  return { document, adapter, controller, inputs, outside, calls, panel, options, type, setView, localFilter: () => localFilter, localListener,
    getPortfolio: () => portfolio, setPortfolio(next) { portfolio = next; }, setCategory(id) { activeCategory = id; document.fire("portfolio:render"); } };
}

const basic = fixture(), input = basic.inputs[0];
assert.equal(input.oninput, basic.localListener, "The existing local filter listener is preserved.");
assert.equal(input.type, "search"); assert.equal(input.getAttribute("role"), "combobox");
assert.equal(input.getAttribute("aria-label"), "Search products");
assert.equal(input.getAttribute("aria-autocomplete"), "list"); assert.equal(input.getAttribute("aria-haspopup"), "listbox");
assert.equal(basic.panel().hidden, true);
input.focus(); assert.equal(basic.panel().hidden, true, "An empty search never opens suggestions.");
basic.type("HP001");
assert.equal(basic.localFilter(), "HP001"); assert.equal(input.getAttribute("aria-expanded"), "true");
assert.equal(basic.controller.getState("searchInput").results[0].productId, "exact", "An exact SKU in another category outranks a prefix in the current category.");
assert.match(basic.options()[0].textContent, /Cloud exact.*Exact SKU.*HP001.*Console Gaming Audio.*Wireless/);
assert.doesNotMatch(basic.options()[0].textContent, /Current category/);
assert.match(basic.options()[1].textContent, /Current category/);
assert.equal(basic.document.getElementById(input.getAttribute("aria-controls")).getAttribute("role"), "listbox");
assert.match(basic.panel().textContent, /All categories · 2 products/);
assert.equal(input.getAttribute("aria-activedescendant"), null);
let event = input.fire("keydown", { key: "ArrowDown" });
assert.equal(event.defaultPrevented, true); assert.equal(basic.controller.getState("searchInput").activeIndex, 0);
assert.equal(input.getAttribute("aria-activedescendant"), basic.options()[0].id); assert.equal(basic.options()[0].getAttribute("aria-selected"), "true");
input.fire("keydown", { key: "ArrowUp" }); assert.equal(basic.controller.getState("searchInput").activeIndex, 1);
input.fire("keydown", { key: "ArrowDown" }); assert.equal(basic.controller.getState("searchInput").activeIndex, 0);
input.fire("keydown", { key: "Enter" }); assert.equal(basic.calls.length, 1); assert.equal(basic.calls[0].productId, "exact");
assert.equal(basic.panel().hidden, true); assert.equal(basic.document.activeElement, basic.outside, "Navigation controls the destination focus.");
input.fire("keydown", { key: "Enter" }); assert.equal(basic.calls.length, 1, "A hidden dropdown cannot navigate twice.");
basic.type("Cloud"); input.focus(); const saved = input.value;
event = input.fire("keydown", { key: "Escape" });
assert.equal(event.defaultPrevented, true); assert.equal(input.value, saved); assert.equal(basic.localFilter(), saved); assert.equal(basic.panel().hidden, true);
basic.document.fire("portfolio:render"); assert.equal(basic.panel().hidden, true, "A render does not reopen cancelled results.");
input.fire("keydown", { key: "ArrowDown" }); assert.equal(basic.panel().hidden, false);
basic.type(""); assert.equal(basic.panel().hidden, true); assert.equal(input.getAttribute("aria-expanded"), "false");
basic.type("not a product"); assert.match(basic.panel().textContent, /All categories · 0 products.*No products found/);
basic.type("BK"); assert.match(basic.panel().textContent, /Variant · BK/); assert.doesNotMatch(basic.panel().textContent, /Exact SKU|HP SKU/);
basic.type("Cloud"); basic.outside.fire("pointerdown"); assert.equal(basic.panel().hidden, true);
basic.type("Cloud"); basic.outside.fire("click"); assert.equal(basic.panel().hidden, true);
basic.type("Cloud"); basic.outside.focus(); assert.equal(basic.panel().hidden, true, "Moving focus outside closes suggestions.");
basic.type("Cloud"); basic.setView("roadmap"); assert.equal(basic.panel().hidden, true);
basic.inputs[0].fire("keydown", { key: "ArrowDown" }); assert.equal(basic.panel().hidden, true, "The hidden view cannot reopen search.");
basic.type("HP001", 1); assert.equal(basic.panel(1).hidden, false); basic.inputs[1].fire("keydown", { key: "Enter" });
assert.equal(basic.calls.length, 2); assert.equal(basic.calls[1].productId, "exact", "Roadmap search also finds other categories.");
basic.type("Cloud", 1); basic.setView("split"); assert.equal(basic.panel(1).hidden, false, "Roadmap and its details view share the visible input.");

const paging = fixture([category("pc", "PC", Array.from({ length: 19 }, (_, index) => product(`item-${index}`, `Many ${String(index).padStart(3, "0")}`)))]);
paging.type("Many"); paging.inputs[0].focus();
assert.equal(paging.options().length, 8); assert.match(paging.panel().textContent, /All categories · 19 products.*8 shown/);
let more = paging.panel().querySelector(".portfolio-search-more"); more.focus();
assert.equal(paging.panel().hidden, false, "Moving focus into the dropdown keeps it available.");
more.fire("click"); assert.equal(paging.options().length, 16); assert.match(paging.panel().textContent, /16 shown/);
assert.equal(paging.document.activeElement, more);
more.fire("click"); assert.equal(paging.options().length, 19); assert.equal(more.hidden, true); assert.equal(paging.document.activeElement, paging.inputs[0]);
assert.equal(paging.controller.getState("searchInput").activeIndex, 16);
paging.type("Many"); more = paging.panel().querySelector(".portfolio-search-more"); more.focus(); more.fire("keydown", { key: "Escape" });
assert.equal(paging.panel().hidden, true); assert.equal(paging.document.activeElement, paging.inputs[0]); assert.equal(paging.inputs[0].value, "Many");
const large = fixture([category("pc", "PC", Array.from({ length: 507 }, (_, index) => product(`large-${index}`, `Large ${String(index).padStart(3, "0")}`)))]);
large.type("Large");
for (let index = 0; index < 70; index++) large.panel().querySelector(".portfolio-search-more").fire("click");
assert.equal(large.options().length, 500); assert.match(large.panel().textContent, /507 products.*first 500 products.*Refine your search/);
assert.equal(large.panel().querySelector(".portfolio-search-more").hidden, true);

const escaped = fixture([category("pc", "<img src=x onerror=alert(1)>", [product("escaped", "<script>Cloud & Sound</script>", "SKU<bold>")])]);
escaped.type("Cloud"); assert.match(escaped.panel().textContent, /<script>Cloud & Sound<\/script>/);
assert.match(escaped.panel().textContent, /<img src=x onerror=alert\(1\)>/); assert.equal(escaped.panel().querySelectorAll("script").length, 0);
escaped.type("SKU"); assert.match(escaped.panel().textContent, /SKU<bold>/);

const stale = fixture(); stale.type("HP001");
const staleOption = stale.options()[0]; stale.getPortfolio().categories[1].board.products = [];
staleOption.fire("click"); assert.equal(stale.calls.length, 0); assert.equal(stale.options().length, 1);
assert.match(stale.panel().textContent, /results changed.*Choose a product again/);
stale.type("Cloud"); stale.inputs[0].fire("keydown", { key: "ArrowDown" });
const selectedId = stale.controller.getState("searchInput").results[0].productId;
stale.getPortfolio().categories[0].board.products.reverse(); stale.document.fire("portfolio:render");
assert.equal(stale.controller.getState("searchInput").results[stale.controller.getState("searchInput").activeIndex].productId, selectedId);
const refreshedOption = stale.options()[0]; stale.getPortfolio().categories[0].board.products.find((item) => item.id === "current").name = "Cloud Team renamed";
refreshedOption.fire("click"); assert.equal(stale.calls.length, 1); assert.equal(stale.calls[0].productName, "Cloud Team renamed", "Selection passes the latest product information.");
const moved = fixture(); moved.type("HP001"); const movedOption = moved.options()[0];
const movedProduct = moved.getPortfolio().categories[1].board.products.shift(); moved.getPortfolio().categories[0].board.products.push(movedProduct);
movedOption.fire("click"); assert.equal(moved.calls.length, 0, "A product moved to another category requires choosing its new result.");
const replacement = fixture(); replacement.type("HP001");
replacement.setPortfolio({ categories: [category("new", "New Category", [product("new", "New HP product", "HP001")])] }); replacement.document.fire("portfolio:render");
assert.equal(replacement.options().length, 1); assert.match(replacement.options()[0].textContent, /New HP product.*New Category/);
replacement.type("Cloud"); replacement.inputs[0].value = ""; replacement.document.fire("portfolio:render"); assert.equal(replacement.panel().hidden, true, "Programmatic filter clears are reflected on render.");

const clean = fixture(); clean.type("Cloud");
const detachedRow = clean.options()[0], originalLabel = clean.inputs[0].parentNode;
assert.equal(clean.controller.destroy(), true); assert.equal(clean.controller.destroy(), false);
assert.equal(clean.document.body.querySelectorAll(".portfolio-search-shell").length, 0);
assert.equal(clean.inputs[0].parentNode, originalLabel); assert.equal(originalLabel.parentNode.id, "productControls");
assert.equal(clean.inputs[0].getAttribute("role"), null); assert.equal(clean.inputs[0].getAttribute("aria-controls"), null);
assert.equal(clean.inputs[0].oninput, clean.localListener);
assert.ok([...clean.inputs[0].events.values()].every((listeners) => listeners.length === 0));
assert.ok([...clean.document.events.values()].every((listeners) => listeners.length === 0));
clean.type("HP001"); assert.equal(clean.localFilter(), "HP001"); clean.document.fire("portfolio:render"); detachedRow.fire("click");
assert.equal(clean.calls.length, 0); assert.equal(clean.controller.getState().destroyed, true);

const css = await readFile(new URL("../../public/css/portfolio-search.css", import.meta.url), "utf8");
const source = await readFile(new URL("../../public/js/portfolio-search-ui.js", import.meta.url), "utf8");
assert.match(css, /portfolio-search-panel\s*\{[^}]*position:\s*absolute[^}]*max-width:\s*calc\(100vw - 40px\)[^}]*max-height:\s*min\(320px[^}]*overflow:\s*auto/s);
assert.match(css, /@media \(max-width: 700px\)/); assert.match(css, /width:\s*calc\(100vw - 24px\)/);
assert.doesNotMatch(source, /\.innerHTML\s*=|\bfetch\s*\(|localStorage|saveChanges\s*\(/);
console.log("Portfolio search UI checks passed: cross-category name/SKU lookup, additive local filters, accessible keyboard selection, cancellation, current result validation, literal text rendering, counts and bounded paging, outside/focus dismissal, view switching, and full listener cleanup.");
