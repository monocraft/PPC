import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../../public/js/category-navigation.js", import.meta.url), "utf8");
let checks = 0;
function fixture({ observer = true, reduce = false } = {}) {
  const document = { activeElement: null }, allNodes = [], observers = [], windowListeners = new Map();
  class Element {
    constructor(tag) {
      this.tagName = tag; this.ownerDocument = document; this.children = []; this.parentNode = null;
      this.className = ""; this.dataset = {}; this.attributes = new Map(); this.listeners = new Map(); this.captureListeners = new Map();
      this.hidden = false; this.disabled = false; this.tabIndex = -1; this._text = "";
      this.scrollWidth = 300; this.clientWidth = 300; this.scrollLeft = 0; this.scrolls = []; this.appends = 0;
      this.bounds = { left: 80, right: 120, top: 30, bottom: 70, width: 40, height: 40 };
      this.style = { setProperty(name, value) { this[name] = value; } }; allNodes.push(this);
    }
    get classList() { return { contains: name => this.className.split(/\s+/).includes(name), toggle: (name, on) => {
      const classes = new Set(this.className.split(/\s+/).filter(Boolean));
      if (on ?? !classes.has(name)) classes.add(name); else classes.delete(name); this.className = [...classes].join(" ");
    } }; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
    set textContent(value) { this._text = String(value); for (const child of this.children) child.parentNode = null; this.children = []; }
    set innerHTML(_) { throw new Error("Category names must never enter an HTML parser."); }
    get isConnected() { return this === document.body || Boolean(this.parentNode?.isConnected); }
    append(...nodes) { this.appends++; for (const child of nodes) { child.remove(); child.parentNode = this; this.children.push(child); } }
    remove() {
      if (this.parentNode) { if (this.contains(document.activeElement)) document.activeElement = document.body; this.parentNode.children = this.parentNode.children.filter(child => child !== this); }
      this.parentNode = null;
    }
    contains(element) { return element === this || this.children.some(child => child.contains(element)); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    addEventListener(type, callback, options) { const map = options === true || options?.capture ? this.captureListeners : this.listeners; const entries = map.get(type) || []; entries.push(callback); map.set(type, entries); }
    removeEventListener(type, callback, options) { const map = options === true || options?.capture ? this.captureListeners : this.listeners; map.set(type, (map.get(type) || []).filter(entry => entry !== callback)); }
    fire(type, data = {}) {
      const event = { target: this, key: "", defaultPrevented: false, propagationStopped: false, bubbles: true, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; }, ...data };
      const path = []; for(let current=this;current;current=current.parentNode)path.push(current);
      for(const current of path.slice().reverse()) {
        event.currentTarget = current; for(const listener of [...(current.captureListeners.get(type)||[])])listener(event);
        if(event.propagationStopped)return event;
      }
      for (let current = this; current; current = event.bubbles && !event.propagationStopped ? current.parentNode : null) {
        event.currentTarget = current; for (const listener of [...(current.listeners.get(type) || [])]) listener(event);
      }
      return event;
    }
    focus(options) {
      if (this.disabled || this.hidden || document.activeElement === this) return;
      const before = document.activeElement; document.activeElement = this; this.lastFocus = options;
      before?.fire("blur", { bubbles: false, relatedTarget: this }); this.fire("focus", { bubbles: false, relatedTarget: before });
    }
    click() { if (!this.disabled && !this.hidden) this.fire("click"); }
    getBoundingClientRect() { return this.bounds; }
    scrollBy(options) { this.scrolls.push(options); this.scrollLeft = Math.max(0, Math.min(this.scrollWidth - this.clientWidth, this.scrollLeft + options.left)); this.fire("scroll"); }
    querySelectorAll(selector) { return this.children.flatMap(child => [child, ...child.querySelectorAll("*")]).filter(child => selector === "*" || selector.startsWith(".") && child.classList.contains(selector.slice(1)) || child.tagName === selector); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  document.createElement = tag => new Element(tag); const documentEvents = new Element("document");
  document.addEventListener = documentEvents.addEventListener.bind(documentEvents); document.removeEventListener = documentEvents.removeEventListener.bind(documentEvents);
  document.body = new Element("body"); document.body.parentNode = documentEvents; document.activeElement = document.body;
  const window = { innerWidth: 600, innerHeight: 400, matchMedia: () => ({ matches: reduce }),
    addEventListener(type, callback) { windowListeners.set(type, callback); }, removeEventListener(type, callback) { if (windowListeners.get(type) === callback) windowListeners.delete(type); },
  };
  if (observer) window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.observed = []; this.disconnected = false; observers.push(this); }
    observe(element) { this.observed.push(element); } disconnect() { this.disconnected = true; }
  };
  document.defaultView = window;
  const host = new Element("section"), unrelated = new Element("div"); unrelated.textContent = "Keep existing host content";
  host.append(unrelated); document.body.append(host);
  const sandbox = { ...window }; vm.runInNewContext(source, sandbox);
  const chosen = [], controller = sandbox.PortfolioCategoryNavigation.create(host, { onChoose: id => chosen.push(id), onAll: () => chosen.push("*") });
  const dock = host.querySelector(".category-dock"), scroller = dock.querySelector(".category-dock-scroller"), items = dock.querySelector(".category-dock-items");
  const buttons = () => items.querySelectorAll("button"), button = id => buttons().find(node => node.dataset.categoryId === id);
  const previous = dock.querySelectorAll(".category-dock-step")[0], next = dock.querySelectorAll(".category-dock-step")[1];
  return { controller, host, dock, scroller, items, button, buttons, chosen, document, observers, windowListeners, allNodes, unrelated, previous, next, summary: dock.querySelector(".category-dock-summary"), tooltip: dock.querySelector(".category-choice-tooltip") };
}

const ids = ["pc-gaming-audio", "console-gaming-audio", "lifestyle-audio", "audio-accessories", "microphones", "microphone-accessories", "keyboards", "mice", "accessories", "controllers", "backpacks"];
const names = ["PC Gaming Audio", "Console Gaming Audio", "Lifestyle Audio", "Audio Accessories", "Microphones", "Microphone Accessories", "Keyboards", "Mice", "Gaming Accessories", "Controllers", "Backpacks"];
const categories = ids.map((id, index) => ({ id, name: names[index], count: index }));
const originalCategories = JSON.stringify(categories);
const f = fixture(); f.controller.update({ categories, mode: "single", selectedIds: [ids[0]] });
assert.equal(f.buttons().length, 12); assert.equal(f.button("*").hidden, true);
assert.equal(f.button(ids[0]).getAttribute("aria-pressed"), "true"); assert.equal(f.button(ids[1]).getAttribute("aria-pressed"), "false");
assert.equal(f.button(ids[0]).querySelector(".category-choice-name").hidden, false); assert.equal(f.button(ids[1]).querySelector(".category-choice-name").hidden, true);
assert.equal(f.summary.textContent, "11 categories · Select one"); assert.equal(f.button(ids[0]).tabIndex, 0);
assert.match(f.button(ids[0]).getAttribute("aria-label"), /Current category$/); assert.match(f.button(ids[1]).getAttribute("aria-label"), /Open category$/);
assert.equal(f.chosen.length, 0, "data updates never navigate or alter saved preferences"); checks += 8;
for (let index = 0; index < ids.length; index++) {
  const button = f.button(ids[index]); assert.match(button.getAttribute("aria-label"), new RegExp(names[index]));
  assert.equal(button.querySelector(".category-choice-count").textContent, String(index));
  const token = button.dataset.categoryIcon;
  assert.match(token, /^[a-z-]+$/); assert.equal(button.querySelector(".category-icon").style["--category-icon"],undefined,"stylesheet owns correctly relative local URLs; no ambiguous inline mask URL");
  const svg = await readFile(new URL(`../../public/assets/icons/category-${token}.svg`, import.meta.url), "utf8");
  assert.match(svg, /^<svg\b/); assert.doesNotMatch(svg, /<script\b|<image\b|\bon\w+=|\bhref=/i); checks++;
}
f.button(ids[1]).click(); assert.deepEqual(f.chosen, [ids[1]]); assert.equal(f.button(ids[0]).getAttribute("aria-pressed"), "true", "only caller updates change selection");
f.controller.update({ categories, mode: "single", selectedIds: [ids[1]] });
const stableButtons = f.buttons(), initialAppends = f.items.appends; f.button(ids[1]).focus();
f.controller.update({ categories: categories.map(category => ({ ...category, count: category.count + 2 })), mode: "single", selectedIds: [ids[1]] });
assert.deepEqual(f.buttons(), stableButtons); assert.equal(f.items.appends, initialAppends); assert.equal(f.document.activeElement, f.button(ids[1]));
assert.equal(f.button(ids[1]).querySelector(".category-choice-count").textContent, "3"); checks += 5;

const beforeKeys = f.chosen.length;
for (const [key, expected] of [["ArrowRight", ids[2]], ["ArrowLeft", ids[1]], ["Home", ids[0]], ["End", ids[10]], ["ArrowRight", ids[0]]]) {
  const event = f.document.activeElement.fire("keydown", { key }); assert.equal(event.defaultPrevented, true);
  assert.equal(f.document.activeElement, f.button(expected)); assert.equal(f.chosen.length, beforeKeys);
  assert.equal(f.buttons().filter(button => button.tabIndex === 0).length, 1); checks++;
}
for (const key of ["Enter", " "]) { const event = f.document.activeElement.fire("keydown", { key }); assert.equal(event.defaultPrevented, false, "native button activation is not intercepted"); f.document.activeElement.click(); }
assert.equal(f.chosen.length, beforeKeys + 2); checks++;

// Native scrolling dispatches its event after focus has revealed a distant
// category. Retain its name once visible; hand scrolling it away hides it.
const far = f.button(ids[10]), beforeScrollChoice = f.chosen.length;
f.scroller.bounds = { left:0,right:300,top:20,bottom:80,width:300,height:60 };
far.bounds = { left:600,right:640,top:30,bottom:70,width:40,height:40 };
far.focus(); far.bounds = { left:240,right:280,top:30,bottom:70,width:40,height:40 };
f.scroller.fire("scroll");
assert.equal(f.document.activeElement,far); assert.equal(f.tooltip.hidden,false); assert.match(f.tooltip.textContent,/Backpacks/);
assert.equal(f.chosen.length,beforeScrollChoice,"revealing a focused category never chooses it");
let appSelection = "selected-product";
const applicationEscape = event => { if(event.key === "Escape") appSelection = null; };
f.host.addEventListener("keydown",applicationEscape);
const escape = far.fire("keydown",{key:"Escape"});
assert.equal(escape.defaultPrevented,true); assert.equal(escape.propagationStopped,true,"tooltip Escape cannot bubble to the application's product-selection shortcut"); assert.equal(f.tooltip.hidden,true); assert.equal(f.document.activeElement,far); assert.equal(f.chosen.length,beforeScrollChoice);
assert.equal(appSelection,"selected-product","dismissing a visible tooltip preserves the application's selected product");
f.scroller.fire("scroll"); assert.equal(f.tooltip.hidden,true,"a late scroll event cannot undo explicit Escape dismissal");
const unhandledEscape = far.fire("keydown",{key:"Escape"});
assert.equal(unhandledEscape.defaultPrevented,false,"an already dismissed tooltip does not consume Escape"); assert.equal(unhandledEscape.propagationStopped,false,"the application's normal Escape action remains reachable without a visible tooltip");
assert.equal(appSelection,null,"a later Escape reaches the application's own selection shortcut"); f.host.removeEventListener("keydown",applicationEscape);
far.fire("pointerenter"); assert.equal(f.tooltip.hidden,false,"a subsequent deliberate hover restores the full name");
far.bounds = { left:400,right:440,top:30,bottom:70,width:40,height:40 }; f.scroller.fire("scroll");
assert.equal(f.tooltip.hidden,true,"hand scrolling the focused button offscreen hides its tooltip");
far.bounds = { left:240,right:280,top:30,bottom:70,width:40,height:40 }; f.scroller.fire("scroll");
assert.equal(f.tooltip.hidden,false,"returning the focused button fully into view restores its tooltip");
checks += 10;

// Pointer tooltips belong to the dock even when keyboard focus remains on the
// canvas or search. Capture Escape before the application's document shortcut.
const outsideFocus = f.document.createElement("input"); f.document.body.append(outsideFocus); outsideFocus.focus();
let outsideSelection = "selected-product", documentEscapes = 0;
const outsideEscape = event => { if(event.key === "Escape") { outsideSelection = null; documentEscapes++; } };
f.document.addEventListener("keydown",outsideEscape);
far.fire("pointerenter"); assert.equal(f.tooltip.hidden,false); assert.equal(f.document.activeElement,outsideFocus);
const hoverEscape=outsideFocus.fire("keydown",{key:"Escape"});
assert.equal(hoverEscape.defaultPrevented,true); assert.equal(hoverEscape.propagationStopped,true);
assert.equal(f.tooltip.hidden,true); assert.equal(f.document.activeElement,outsideFocus); assert.equal(outsideSelection,"selected-product"); assert.equal(documentEscapes,0);
const normalEscape=outsideFocus.fire("keydown",{key:"Escape"});
assert.equal(normalEscape.defaultPrevented,false); assert.equal(normalEscape.propagationStopped,false); assert.equal(outsideSelection,null); assert.equal(documentEscapes,1);
f.document.removeEventListener("keydown",outsideEscape); checks += 4;

f.controller.update({ categories, mode: "multiple", selectedIds: [ids[1], ids[3]] });
assert.equal(f.button("*").hidden, false); assert.equal(f.button("*").getAttribute("aria-pressed"), "mixed");
assert.match(f.items.getAttribute("aria-description"), /All toggles every category on or off/);
assert.match(f.button(ids[1]).getAttribute("aria-label"), /Hide category$/); assert.match(f.button(ids[0]).getAttribute("aria-label"), /Add category$/);
assert.match(f.button("*").getAttribute("aria-label"), /Show all categories$/);
assert.ok(f.buttons().filter(button => !button.hidden).every(button => button.querySelector(".category-choice-name").hidden));
assert.equal(f.summary.textContent, "2 of 11 categories selected"); f.button("*").click(); assert.equal(f.chosen.at(-1), "*");
f.controller.update({ categories, mode: "multiple", selectedIds: [], allSelected: true });
assert.ok(f.buttons().every(button => button.getAttribute("aria-pressed") === "true")); assert.equal(f.summary.textContent, "All 11 categories selected");
assert.match(f.button("*").getAttribute("aria-label"), /Clear every category$/);
f.button("*").click(); assert.equal(f.chosen.at(-1), "*", "All remains actionable when all categories are selected so the caller can choose none");
f.button("*").focus(); f.controller.update({categories,mode:"single",selectedIds:[ids[2]]});
assert.equal(f.document.activeElement,f.button(ids[2]),"a mode change never leaves keyboard focus on the now-hidden All control");
f.controller.update({ categories, mode: "multiple", selectedIds: [] }); assert.equal(f.summary.textContent, "No categories selected");
assert.ok(f.buttons().every(button => button.getAttribute("aria-pressed") === "false")); checks += 8;

const chosenBeforeDisabled = f.chosen.length;
f.controller.update({ categories, mode: "multiple", selectedIds: [ids[0]], disabled: true });
assert.ok(f.buttons().every(button => button.disabled && button.tabIndex === -1));
f.button(ids[0]).fire("click"); f.button("*").fire("click"); assert.equal(f.chosen.length, chosenBeforeDisabled);
f.button(ids[0]).fire("keydown", { key: "ArrowRight" }); assert.equal(f.chosen.length, chosenBeforeDisabled); checks += 3;
f.controller.update({ categories, mode: "multiple", selectedIds: [ids[0]] });
const retained = f.button(ids[0]); retained.focus();
f.controller.update({ categories: [...categories].reverse(), mode: "multiple", selectedIds: [ids[0]] });
assert.equal(f.button(ids[0]), retained); assert.equal(f.document.activeElement, retained, "reordering restores the same focused button after DOM moves");
f.controller.update({ categories: categories.slice(1), mode: "multiple", selectedIds: [ids[1]] });
assert.notEqual(f.document.activeElement, retained); assert.equal(f.document.activeElement.isConnected, true); checks += 2;

const evil = '<img src=x onerror="steal()">';
f.controller.update({ categories: [{ id: "unknown", name: evil, count: -3 }, { id: "unknown", name: "Duplicate", count: 99 }, { id: "constructor", name: "PC Gaming Audio", count: Infinity }, { id: "*", name: "Spoof All" }, { id: null }], selectedIds: ["unknown"], mode: "single" });
assert.equal(f.button("unknown").getAttribute("aria-label"), `${evil} · 0 visible products · Current category`);
assert.equal(f.button("unknown").dataset.categoryIcon, "grid"); assert.equal(f.button("constructor").dataset.categoryIcon, "pc-audio");
assert.equal(f.buttons().length, 3); assert.equal(f.button("unknown").querySelectorAll("img").length, 0);
f.button("unknown").fire("pointerenter"); assert.equal(f.tooltip.textContent, `${evil} · 0 visible products · Current category`);
assert.equal(f.tooltip.parentNode, f.dock, "tooltip portal escapes the horizontal clipping container");
assert.equal(f.tooltip.hidden, false); assert.ok(parseFloat(f.tooltip.style.left) >= 8); assert.ok(parseFloat(f.tooltip.style.top) >= 8);
const tooltipButton = f.button("unknown"), tooltipScrolls = f.scroller.scrolls.length;
f.controller.update({ categories:[{id:"unknown",name:evil,count:4},{id:"constructor",name:"PC Gaming Audio",count:0}], selectedIds:["unknown"], mode:"single" });
assert.equal(f.button("unknown"), tooltipButton); assert.match(f.tooltip.textContent, /4 visible products · Current category$/); assert.equal(f.scroller.scrolls.length, tooltipScrolls, "count-only updates refresh a visible tooltip without moving its scroll position");
tooltipButton.bounds={left:580,right:620,top:370,bottom:410,width:40,height:40};
f.tooltip.bounds={left:0,right:320,top:0,bottom:44,width:320,height:44}; tooltipButton.fire("pointerenter");
assert.ok(parseFloat(f.tooltip.style.left)+320<=592,"right-edge tooltip stays inside viewport margin");
assert.ok(parseFloat(f.tooltip.style.top)+44<370,"bottom-edge tooltip moves above its trigger");
f.scroller.fire("scroll"); assert.equal(f.tooltip.hidden, true); checks += 8;

f.scroller.scrollWidth = 900; f.scroller.clientWidth = 300; f.scroller.scrollLeft = 0;
f.observers[0].callback(); assert.equal(f.previous.hidden, false); assert.equal(f.previous.disabled, true); assert.equal(f.next.disabled, false);
f.next.click(); assert.equal(f.scroller.scrolls.at(-1).behavior, "smooth"); assert.equal(f.scroller.scrollLeft, 210); assert.equal(f.previous.disabled, false);
f.scroller.scrollLeft = 600; f.scroller.fire("scroll"); assert.equal(f.next.disabled, true);
f.scroller.scrollWidth = 300; f.observers[0].callback(); assert.equal(f.previous.hidden, true); assert.equal(f.next.hidden, true); checks += 5;
const reduced = fixture({ observer: false, reduce: true }); reduced.controller.update({ categories, mode: "multiple", allSelected: true });
reduced.scroller.scrollWidth = 900; reduced.windowListeners.get("resize")(); reduced.next.click();
assert.equal(reduced.scroller.scrolls.at(-1).behavior, "auto"); assert.equal(reduced.windowListeners.size, 1);
reduced.controller.destroy(); assert.equal(reduced.windowListeners.size, 0); checks += 3;

const empty = fixture(); empty.controller.update({categories:[],mode:"multiple",selectedIds:[],allSelected:true});
assert.equal(empty.button("*").disabled,true); assert.equal(empty.button("*").tabIndex,-1); assert.equal(empty.button("*").getAttribute("aria-pressed"),"false");
assert.equal(empty.summary.textContent,"No categories selected"); empty.controller.destroy(); checks += 7;

const detachedButton = f.button("unknown"), finalCalls = f.chosen.length;
f.controller.destroy(); assert.equal(f.observers[0].disconnected, true); assert.equal(f.dock.isConnected, false); assert.equal(f.unrelated.isConnected, true);
assert.ok(f.allNodes.every(node => [...node.listeners.values(),...node.captureListeners.values()].every(listeners => listeners.length === 0)), "every document-capture, dynamic, delegated and scroll listener is removed");
detachedButton.fire("click"); f.controller.update({ categories }); f.controller.destroy(); assert.equal(f.chosen.length, finalCalls); assert.equal(f.host.querySelector(".category-dock"), null); checks += 5;
assert.equal(JSON.stringify(categories),originalCategories,"navigation never changes caller category metadata");
for(const token of ["all","grid"])assert.match(await readFile(new URL(`../../public/assets/icons/category-${token}.svg`,import.meta.url),"utf8"),/^<svg\b/);
for(const [left,right] of [["lifestyle-audio","pc-audio"],["controller","console-audio"]])assert.notEqual(await readFile(new URL(`../../public/assets/icons/category-${left}.svg`,import.meta.url),"utf8"),await readFile(new URL(`../../public/assets/icons/category-${right}.svg`,import.meta.url),"utf8"),"neighboring categories retain distinct original Solar silhouettes");
assert.match(await readFile(new URL("../../public/assets/icons/CATEGORY-SOLAR-LICENSE.txt",import.meta.url),"utf8"),/Creative Commons Attribution 4\.0[\s\S]*Original vector paths|Creative Commons Attribution 4\.0[\s\S]*original vector paths/);
checks += 7;
console.log(`Category navigation checks passed: ${checks} actual DOM/event, single/multiple scope, safe labels/local icons, stable focus/identity, keyboard, tooltip, overflow, reduced-motion and cleanup cases.`);
