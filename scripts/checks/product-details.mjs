import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

await import("../../public/js/portfolio-model.js");
const modelRules = globalThis.PortfolioModel;
const timers = new Map();
const canceledTimers = [];
let nextTimerId = 0;
let prefersReducedMotion = false;
const sandbox = {
  setTimeout(callback, delay) { const id = ++nextTimerId; timers.set(id, { callback, delay }); return id; },
  clearTimeout(id) { if (timers.delete(id)) canceledTimers.push(id); },
  matchMedia: () => ({ matches: prefersReducedMotion }),
};
function runTimer(id) {
  const timer = timers.get(id);
  assert.ok(timer, "feedback reset must retain a scheduled timer");
  timers.delete(id);
  timer.callback();
}
function runAllTimers() { for (const id of [...timers.keys()]) runTimer(id); }
vm.createContext(sandbox);
new vm.Script(await readFile(new URL("../../public/js/product-details.js", import.meta.url), "utf8")).runInContext(sandbox);
const details = sandbox.PortfolioDetails;
assert.ok(details, "details rendering must load without a browser document");

const dateLabels = ["General availability", "End of manufacturing", "FFS", "Global announcement", "Web readiness", "Final assets"];
const dateKeys = ["general-availability", "end-manufacturing", "ffs", "global-announcement", "web-readiness", "final-assets"];
const lifecycleKeys = ["launch", "lifecycle-end", "stage", "confidence"];
const longModel = {
  id: "long-product",
  dates: dateLabels.map((label, index) => ({ key: dateKeys[index], label, value: `Jan ${index + 1}, 2026`, empty: false })),
  lifecycle: [{ key: "stage", label: "Stage", value: "In development" }],
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
assert.deepEqual([...overviewPanel[1].matchAll(/data-date-kind="([^"]+)"/g)].map((match) => match[1]), dateKeys, "each date must expose its semantic styling hook independently of the displayed label");
assert.ok(overviewPanel[1].includes("In development"), "Overview must include the lifecycle summary with dates and specifications");
assert.match(initialHtml, /role="tab"[^>]*id="product-detail-split-overview-tab"[^>]*aria-controls="product-detail-split-overview"[^>]*aria-selected="true"[^>]*tabindex="0"[^>]*>Overview<\/button>/);
assert.match(overviewPanel[0], /role="tabpanel"[^>]*aria-labelledby="product-detail-split-overview-tab"/);
assert.ok(!initialHtml.includes('data-detail-tab="specs"'), "specifications must not have a separate tab");
assert.ok(!initialHtml.includes('data-detail-page-group="specs"'), "specifications must not be paginated");
assert.ok(!initialHtml.includes('aria-label="Previous specs"') && !initialHtml.includes('aria-label="Next specs"'), "specifications must not require Previous/Next controls");
assert.ok(!overviewPanel[1].includes("data-detail-page-index") && ![...overviewPanel[1].matchAll(/\bclass="([^"]*)"/g)].some((match) => match[1].split(/\s+/).includes("hidden")), "complete Overview specifications must not be hidden behind pages");

const occurrences = (text, token) => text.split(token).length - 1;
for (const item of longModel.skus) assert.equal(occurrences(initialHtml, `<strong class="hp-sku-code">${item.code}</strong>`), 1, "every HP SKU must appear exactly once across pages");
assert.match(initialHtml, /<ul\b[^>]*class="hp-sku-grid"[^>]*aria-label="HP SKUs"/);
assert.equal(occurrences(initialHtml, '<li class="hp-sku-entry"'), longModel.skus.length, "compact SKU entries must retain all seventeen part numbers");
assert.ok(!initialHtml.includes('data-detail-more="variants"') && !initialHtml.includes('data-detail-more-panel="variants"'), "More must not repeat colors in a separate Variants tab");
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
    classList: { contains: (name) => classes.has(name), add(...names) { names.forEach((name) => classes.add(name)); }, remove(...names) { names.forEach((name) => classes.delete(name)); }, toggle(name, enabled) { if (enabled ?? !classes.has(name)) classes.add(name); else classes.delete(name); } },
    getAttribute(name) { return attributes.get(name) ?? null; },
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
  const rows = [...html.matchAll(/<li\b[^>]*\bclass="hp-sku-entry[^\"]*"[^>]*>/g)].map((match) => elementFromTag(match[0]));
  for (const [index, button] of copies.entries()) {
    button.label = elementFromTag("<small>");
    button.label.textContent = "Copy";
    button.querySelector = (selector) => selector === "small" ? button.label : null;
    button.row = rows[index];
    button.closest = (selector) => selector === ".hp-sku-entry" ? button.row : null;
    button.row.animations = [];
    button.row.animate = (keyframes, options) => {
      const animation = { keyframes, options, canceled: false, cancel() { this.canceled = true; } };
      button.row.animations.push(animation);
      return animation;
    };
  }
  const copyStatusTag = html.match(/<[^>]+\bdata-detail-copy-status(?:="[^"]*")?[^>]*>/)?.[0];
  const copyStatus = copyStatusTag ? elementFromTag(copyStatusTag) : null;
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
  workspace.querySelector = (selector) => selector === "[data-detail-copy-status]" ? copyStatus : null;
  const close = elementFromTag("<button>");
  const container = { querySelector: (selector) => selector === "[data-detail-surface]" ? workspace : selector === "[data-detail-close]" ? close : null };
  return { container, workspace, tabs, moreTabs, panels, morePanels, copies, rows, copyStatus, groups, close };
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
const expectedPageCounts = { SKUs: 3, options: 3, "source records": 4 };
assert.deepEqual(fixture.tabs.map((button) => button.dataset.detailTab), ["overview", "skus", "more"], "only Overview, HP SKUs and More should remain as primary tabs");
assert.deepEqual(fixture.moreTabs.map((button) => button.dataset.detailMore), ["identity", "source"], "More must retain identity and source without a redundant Variants tab");
assert.deepEqual(fixture.groups.map((group) => group.dataset.detailPageGroup), ["SKUs", "options", "source records"], "paging must retain SKUs, additional options and source records");
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
assert.ok(fixture.copies[16].row.classList.contains("is-copied"), "successful copying must highlight the entire SKU entry");
assert.ok(fixture.copies[16].classList.contains("is-copied"), "successful copying must also give the button its confirmation state");
assert.equal(fixture.copies[16].row.animations.length, 1, "successful copying must pulse the entry");
assert.equal(fixture.copies[16].row.animations[0].options.duration, 700);
assert.ok(fixture.copyStatus, "copy feedback must expose a shared live status outside the hidden detail panels");
assert.equal(fixture.copyStatus.attributes.get("aria-live"), "polite");
assert.equal(fixture.copyStatus.attributes.get("role"), "status");
assert.ok(initialHtml.indexOf("data-detail-copy-status") > initialHtml.lastIndexOf("</section>"), "copy status must remain outside panels whose visibility changes with tab selection");
assert.match(fixture.copyStatus.textContent, /HP-SKU-16/);
assert.match(fixture.copies[16].attributes.get("aria-label"), /Copied.*HP-SKU-16/);
assert.equal([...timers.values()][0].delay, 1100);
runAllTimers();
assert.equal(fixture.copies[16].label.textContent, "Copy");
assert.ok(!fixture.copies[16].row.classList.contains("is-copied") && !fixture.copies[16].classList.contains("is-copied"), "copy reset must remove both entry and button confirmation states");
assert.equal(fixture.copies[16].attributes.get("aria-label"), "Copy HP SKU HP-SKU-16");
await fixture.close.fire("click");
assert.ok(closed);

function copyFixture(productId, onCopy) {
  const html = details.render({ id: productId, skus: ["FIRST", "SECOND"].map((code) => ({ code, colors: [] })) }, { surface: "viewer" });
  const result = fixtureFor(html);
  details.bind(result.container, { onCopy });
  return result;
}
const failedCopy = copyFixture("failed-copy", async () => false);
await failedCopy.copies[0].fire("click");
assert.equal(failedCopy.copies[0].label.textContent, "Failed", "a denied clipboard operation must report failure");
assert.ok(!failedCopy.copies[0].row.classList.contains("is-copied"), "a failed copy must not imply that the SKU was copied");
assert.equal(failedCopy.copies[0].row.animations.length, 0, "failed copying must not pulse a success state");
assert.match(failedCopy.copyStatus.textContent, /FIRST/);
assert.match(failedCopy.copies[0].attributes.get("aria-label"), /FIRST/);
runAllTimers();
assert.equal(failedCopy.copies[0].label.textContent, "Copy");

const thrownCopy = copyFixture("thrown-copy", async () => { throw new Error("Clipboard unavailable"); });
await thrownCopy.copies[0].fire("click");
assert.equal(thrownCopy.copies[0].label.textContent, "Failed", "an exception from the clipboard callback must recover as visible failure");
assert.ok(!thrownCopy.copies[0].row.classList.contains("is-copied"));
assert.equal(thrownCopy.copies[0].row.animations.length, 0);
runAllTimers();

const repeatCopy = copyFixture("repeat-copy", async () => true);
await repeatCopy.copies[0].fire("click");
const firstResetId = [...timers.keys()][0];
await repeatCopy.copies[0].fire("click");
assert.ok(!timers.has(firstResetId) && canceledTimers.includes(firstResetId), "a repeat click must cancel the entry's older reset timer");
assert.equal(timers.size, 1, "repeat copying must retain a single current reset timer for the entry");
assert.equal(repeatCopy.copies[0].row.animations.length, 2, "a repeat click must pulse the entry again");
assert.ok(repeatCopy.copies[0].row.animations[0].canceled, "a repeat click must cancel the entry's older pulse before starting fresh feedback");
assert.equal(repeatCopy.copies[0].label.textContent, "Copied");
runAllTimers();

let successThenFailure = true;
const retryCopy = copyFixture("retry-copy", async () => successThenFailure);
await retryCopy.copies[0].fire("click");
successThenFailure = false;
await retryCopy.copies[0].fire("click");
assert.equal(retryCopy.copies[0].label.textContent, "Failed", "a new failed request must replace its earlier success feedback");
assert.ok(!retryCopy.copies[0].row.classList.contains("is-copied") && !retryCopy.copies[0].classList.contains("is-copied"));
assert.ok(retryCopy.copies[0].row.animations[0].canceled, "a failed retry must cancel the previous successful pulse");
runAllTimers();

const isolatedCopy = copyFixture("isolated-copy", async () => true);
await isolatedCopy.copies[0].fire("click");
const firstEntryReset = [...timers.keys()][0];
await isolatedCopy.copies[1].fire("click");
assert.equal(timers.size, 2, "separate entries must keep independent confirmation timers");
runTimer(firstEntryReset);
assert.equal(isolatedCopy.copies[0].label.textContent, "Copy");
assert.equal(isolatedCopy.copies[1].label.textContent, "Copied", "resetting one entry must not clear another entry's confirmation");
assert.ok(isolatedCopy.copies[1].row.classList.contains("is-copied"));
runAllTimers();

const pendingCopies = [];
const concurrentCopy = copyFixture("concurrent-copy", (value) => new Promise((resolve) => pendingCopies.push({ value, resolve })));
const olderCopy = concurrentCopy.copies[0].fire("click");
const latestCopy = concurrentCopy.copies[0].fire("click");
assert.deepEqual(pendingCopies.map((copy) => copy.value), ["FIRST", "FIRST"], "repeat asynchronous copying must preserve the exact requested SKU");
pendingCopies[1].resolve(true);
await latestCopy;
const currentResetId = [...timers.keys()][0];
pendingCopies[0].resolve(false);
await olderCopy;
assert.equal(concurrentCopy.copies[0].label.textContent, "Copied", "an older failed request must not overwrite the latest successful confirmation");
assert.ok(concurrentCopy.copies[0].row.classList.contains("is-copied"));
assert.equal(concurrentCopy.copies[0].row.animations.length, 1, "stale request results must not trigger extra feedback");
assert.deepEqual([...timers.keys()], [currentResetId], "stale completion must leave the current confirmation timer intact");
runAllTimers();

prefersReducedMotion = true;
const reducedMotionCopy = copyFixture("reduced-motion-copy", async () => true);
await reducedMotionCopy.copies[0].fire("click");
assert.equal(reducedMotionCopy.copies[0].row.animations.length, 0, "reduced-motion users must receive confirmation without an animated pulse");
assert.ok(reducedMotionCopy.copies[0].row.classList.contains("is-copied"), "reduced-motion preference must preserve static success feedback");
assert.equal(reducedMotionCopy.copies[0].label.textContent, "Copied");
runAllTimers();
prefersReducedMotion = false;

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
  dates: [{ key: 'end-manufacturing" onmouseover="attack()', label: hostile, value: hostile }],
  identity: [{ label: hostile, value: hostile }],
  lifecycle: [{ key: 'launch" onclick="attack()', label: hostile, value: hostile }],
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
assert.ok(!hostileHtml.includes("data-date-kind") && !hostileHtml.includes("data-lifecycle-kind"), "unknown or injected semantic keys must never create styling attributes");
const knownKindsHtml = details.render({
  id: "known-semantic-kinds",
  dates: dateKeys.map((key) => ({ key, label: "Custom label", value: "TBD", empty: true })),
  lifecycle: lifecycleKeys.map((key) => ({ key, label: "Custom lifecycle label", value: "Not set" })),
});
assert.deepEqual([...knownKindsHtml.matchAll(/data-date-kind="([^"]+)"/g)].map((match) => match[1]), dateKeys, "date styling must use known semantic keys even when labels are customized");
assert.deepEqual([...knownKindsHtml.matchAll(/data-lifecycle-kind="([^"]+)"/g)].map((match) => match[1]), lifecycleKeys, "lifecycle styling must expose only its four known semantic hooks");
const unknownKindsHtml = details.render({
  id: "unknown-semantic-kinds",
  dates: ["unknown", "GENERAL-AVAILABILITY", "ffs ", '__proto__', null, {}].map((key) => ({ key, label: "General availability", value: "TBD" })),
  lifecycle: ["unknown", "LAUNCH", "launch ", '__proto__', null, {}].map((key) => ({ key, label: "Launch", value: "Not set" })),
});
assert.ok(!unknownKindsHtml.includes("data-date-kind") && !unknownKindsHtml.includes("data-lifecycle-kind"), "display labels and arbitrary keys must not grant a semantic styling hook");

const dualProduct = {
  variantGroups: [{ type: "color", items: [{ id: "dual", code: "WHT-PNK", colorName: "White", colorName2: "Pink", colorHex: "#eeeeee", colorHex2: "#ff5599" }] }],
  ascm: { records: [{ basePartNumber: "MANUAL", colorCode: "BK" }] },
};
// Verify the actual application adapter supplies all six dates and the manual
// mapping before handing its model to the shared renderer.
const appSource = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
const appHtml = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
assert.ok(!appHtml.includes('id="fullSingleLaneSpecs"'), "display settings must not offer the obsolete full-specification checkbox");
assert.ok(!appSource.includes('$("#fullSingleLaneSpecs")'), "removed full-specification controls must have no synchronization or event bindings");
const clipboardSource = appSource.match(/^async function copyTextToClipboard\([^]*?^\}/m)?.[0];
assert.ok(clipboardSource, "copy checks must exercise the actual application clipboard helper");
function clipboardFixture({ nativeFailure = false, nativeAvailable = true, fallbackResult = true, fallbackThrows = false } = {}) {
  const events = [];
  const nativeValues = [];
  const textareas = [];
  const previousFocus = { focus: (options) => events.push(["restore focus", options.preventScroll]) };
  const document = {
    activeElement: previousFocus,
    body: { appendChild(textarea) { textarea.isConnected = true; events.push(["append"]); } },
    createElement(tag) {
      assert.equal(tag, "textarea", "clipboard fallback must use a temporary selection field");
      const textarea = {
        style: {}, attributes: new Map(), isConnected: false,
        setAttribute(name, value) { this.attributes.set(name, value); },
        focus: (options) => events.push(["temporary focus", options.preventScroll]),
        select: () => events.push(["select"]),
        remove() { this.isConnected = false; events.push(["remove"]); },
      };
      textareas.push(textarea);
      return textarea;
    },
    execCommand(command) {
      assert.equal(command, "copy");
      events.push(["copy"]);
      if (fallbackThrows) throw new Error("Legacy copy unavailable");
      return fallbackResult;
    },
  };
  const navigator = nativeAvailable ? { clipboard: { async writeText(value) { nativeValues.push(value); if (nativeFailure) throw new Error("Clipboard denied"); } } } : {};
  const clipboardSandbox = { document, navigator };
  vm.createContext(clipboardSandbox);
  new vm.Script(clipboardSource).runInContext(clipboardSandbox);
  return { copy: clipboardSandbox.copyTextToClipboard, events, nativeValues, textareas };
}
const nativeClipboard = clipboardFixture();
assert.equal(await nativeClipboard.copy("  HP-SKU-EXACT  "), true);
assert.deepEqual(nativeClipboard.nativeValues, ["HP-SKU-EXACT"], "clipboard writes must retain the exact trimmed SKU");
assert.equal(nativeClipboard.textareas.length, 0, "successful native copying must not insert a fallback field that can affect scrolling");
assert.equal(await nativeClipboard.copy("  "), false);
assert.equal(nativeClipboard.nativeValues.length, 1, "blank values must not write or trigger a fallback");

for (const configuration of [
  { nativeFailure: true, fallbackResult: true },
  { nativeFailure: true, fallbackResult: false },
  { nativeFailure: true, fallbackThrows: true },
  { nativeAvailable: false, fallbackResult: true },
]) {
  const clipboard = clipboardFixture(configuration);
  assert.equal(await clipboard.copy("  FALLBACK-SKU  "), !configuration.fallbackThrows && configuration.fallbackResult !== false, "fallback success or failure must return a usable boolean");
  assert.equal(clipboard.textareas.length, 1);
  const textarea = clipboard.textareas[0];
  assert.equal(textarea.value, "FALLBACK-SKU");
  assert.deepEqual(textarea.style, { position: "fixed", top: "0", left: "0", width: "1px", height: "1px", minHeight: "0", padding: "0", border: "0", opacity: "0" }, "the selection field must remain within a one-pixel anchored area, preventing inherited full-width textarea overflow");
  assert.equal(textarea.tabIndex, -1);
  assert.ok(textarea.attributes.has("readonly"));
  assert.ok(!textarea.isConnected, "temporary selection fields must be removed after both successful and failed copying");
  assert.deepEqual(clipboard.events, [["append"], ["temporary focus", true], ["select"], ["copy"], ["remove"], ["restore focus", true]], "fallback copying must prevent focus scrolling and restore the previous control even after failure");
}
const inspectorSource = appSource.match(/^function renderInspector\([^]*?^\}/m)?.[0];
assert.ok(inspectorSource, "date-entry coverage requires the actual inspector renderer");
for (const id of ["fieldGeneralAvailabilityDate", "fieldEndManufacturingDate"]) {
  assert.equal([...inspectorSource.matchAll(new RegExp(`\\bid="${id}"`, "g"))].length, 1, "each canonical date must have exactly one rendered input, without counting handler references");
}
assert.ok(!/\bid="fieldRoadmap(?:Start|End)"/.test(inspectorSource), "Timeline must not create duplicate editable launch/end month controls");
assert.match(inspectorSource, /<button\b[^>]*id="editProductDates"[^>]*type="button"[^>]*>Edit dates in Details<\/button>/, "Timeline must provide a clear shortcut to the canonical date controls");
const dateShortcutHandler = inspectorSource.match(/\$\("#editProductDates"\)\.onclick = \(\) => \{[^]*?\n  \};/)?.[0];
assert.ok(dateShortcutHandler, "the Timeline date shortcut must be wired");
const dateShortcutEvents = [];
const dateShortcutButton = {};
const canonicalDateField = {
  scrollIntoView(options) { dateShortcutEvents.push(["scroll", options.block]); },
  focus(options) { dateShortcutEvents.push(["focus", options.preventScroll]); },
};
const dateShortcutSandbox = {
  $(selector) {
    if (selector === "#editProductDates") return dateShortcutButton;
    assert.equal(selector, "#fieldGeneralAvailabilityDate", "the shortcut must target the canonical GA date control");
    return canonicalDateField;
  },
  inspector: {
    querySelector(selector) {
      assert.equal(selector, '[data-editor-tab="details"]', "the shortcut must open Details before focusing its date field");
      return { click: () => dateShortcutEvents.push(["tab", "details"]) };
    },
  },
};
vm.createContext(dateShortcutSandbox);
new vm.Script(dateShortcutHandler).runInContext(dateShortcutSandbox);
dateShortcutButton.onclick();
assert.deepEqual(dateShortcutEvents, [["tab", "details"], ["scroll", "center"], ["focus", true]], "Timeline's date shortcut must open Details, reveal GA, and focus it in order");
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
  roadmap: { startMonth: "2026-01", launchMonth: "2026-01", endMonth: "2026-01", status: "in-development", confidence: "high" },
  specs: [],
};
const actualDetailModel = appModelSandbox.productDetailsModel(actualProduct);
assert.deepEqual(JSON.parse(JSON.stringify(actualDetailModel.dates.map((item) => item.label))), dateLabels, "the actual app adapter must include all six date fields in order");
assert.deepEqual(JSON.parse(JSON.stringify(actualDetailModel.dates.map((item) => item.key))), dateKeys, "the application must identify all six milestone fields without relying on their label text");
assert.deepEqual(JSON.parse(JSON.stringify(actualDetailModel.lifecycle.map((item) => item.key))), ["stage", "confidence"], "matching launch/end months must not duplicate GA/EM dates in Overview");
assert.deepEqual(JSON.parse(JSON.stringify(actualDetailModel.dates.map((item) => item.value))), ["Jan 1, 2026", "Jan 2, 2026", "Jan 3, 2026", "Jan 4, 2026", "Jan 5, 2026", "Jan 6, 2026"]);
const actualDatesHtml = details.render(actualDetailModel, { surface: "viewer" });
const actualDatesPanel = actualDatesHtml.match(/<section\b[^>]*data-detail-panel="overview"[^>]*>([\s\S]*?)<\/section>/);
assert.ok(!actualDatesPanel[0].split(">")[0].includes("hidden"));
for (const date of actualDetailModel.dates) assert.ok(actualDatesPanel[1].includes(`<span>${date.label}</span>`) && actualDatesPanel[1].includes(date.value), "actual product dates must remain visible in the primary information panel");
assert.deepEqual([...actualDatesPanel[1].matchAll(/data-date-kind="([^"]+)"/g)].map((match) => match[1]), dateKeys, "actual milestone keys must survive the application-to-renderer boundary");
assert.deepEqual([...actualDatesPanel[1].matchAll(/data-lifecycle-kind="([^"]+)"/g)].map((match) => match[1]), ["stage", "confidence"], "matching date months must render only Stage/Confidence in the lifecycle summary");
assert.ok(!actualDatesPanel[1].includes("Planned launch") && !actualDatesPanel[1].includes("Planned end"), "matching exact dates must display once without redundant month rows");
const savedPlanProduct = { ...actualProduct, roadmap: { ...actualProduct.roadmap, startMonth: "2026-02", launchMonth: "2026-02", endMonth: "2026-03" } };
const originalSavedPlan = structuredClone(savedPlanProduct);
const savedPlanModel = appModelSandbox.productDetailsModel(savedPlanProduct);
assert.deepEqual(JSON.parse(JSON.stringify(savedPlanModel.lifecycle)), [
  { key: "launch", label: "Planned launch", value: "Feb 2026" },
  { key: "lifecycle-end", label: "Planned end", value: "Mar 2026" },
  { key: "stage", label: "Stage", value: "In development" },
  { key: "confidence", label: "Confidence", value: "high" },
], "independently saved month plans must remain visible under clear planned-date labels");
assert.deepEqual(savedPlanProduct, originalSavedPlan, "deduplicating Overview must not rewrite exact dates or legacy roadmap plans");
const savedPlanHtml = details.render(savedPlanModel, { surface: "viewer" });
assert.deepEqual([...savedPlanHtml.matchAll(/data-lifecycle-kind="([^"]+)"/g)].map((match) => match[1]), lifecycleKeys, "planned fallback dates must retain their teal/red semantic hooks through rendering");
for (const [field, expectedKeys, expectedLabel] of [
  ["generalAvailabilityDate", ["launch", "stage", "confidence"], "Planned launch"],
  ["endManufacturingDate", ["lifecycle-end", "stage", "confidence"], "Planned end"],
]) {
  const fallbackModel = appModelSandbox.productDetailsModel({ ...actualProduct, [field]: "" });
  assert.deepEqual(JSON.parse(JSON.stringify(fallbackModel.lifecycle.map((item) => item.key))), expectedKeys, "only the missing exact date should expose its saved month fallback");
  assert.equal(fallbackModel.lifecycle[0].label, expectedLabel);
  assert.equal(fallbackModel.lifecycle[0].value, "Jan 2026");
}
const missingPlanModel = appModelSandbox.productDetailsModel({ ...actualProduct, generalAvailabilityDate: "", endManufacturingDate: "", roadmap: { status: "in-development", confidence: "high" } });
assert.deepEqual(JSON.parse(JSON.stringify(missingPlanModel.lifecycle.map((item) => item.key))), ["stage", "confidence"], "missing dates and absent roadmap months must not invent planned dates");
const invalidPlanModel = appModelSandbox.productDetailsModel({ ...actualProduct, roadmap: { ...actualProduct.roadmap, startMonth: "invalid", endMonth: "2026-13" } });
assert.deepEqual(JSON.parse(JSON.stringify(invalidPlanModel.lifecycle.map((item) => item.key))), ["stage", "confidence"], "invalid saved months must not appear as planned fallback rows");
const legacyLaunchModel = appModelSandbox.productDetailsModel({ ...actualProduct, generalAvailabilityDate: "", roadmap: { ...actualProduct.roadmap, startMonth: "", launchMonth: "2025-12" } });
assert.equal(legacyLaunchModel.lifecycle[0].value, "Dec 2025", "a legacy launchMonth remains visible when startMonth is absent");
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

const mappedBlack = { id: "black-color", code: "BK", label: "Black", colorHex: "#111111" };
const mappedGray = { code: "GRY", label: "Gray", colorHex: "#777777", colorHex2: "" };
const unmatchedGreen = { id: "green-color", code: "GRN", label: "Green", colorHex: "#00aa55" };
const mappedColorsModel = {
  id: "consolidated-options",
  skus: [{ code: "HP-BLACK", colors: [mappedBlack] }, { code: "HP-GRAY", colors: [mappedGray] }],
  variants: [
    { group: "Colors", code: "BK", colors: [{ ...mappedBlack }] },
    { group: "Colors", code: "GRY", colors: [{ ...mappedGray }] },
    { group: "Colors", code: "GRN", colors: [unmatchedGreen] },
    { group: "Layouts", code: "US", label: "United States", colors: [] },
  ],
};
const mappedOptionsOriginal = structuredClone(mappedColorsModel);
const mappedOptionsHtml = details.render(mappedColorsModel, { surface: "viewer" });
const consolidatedSkuPanel = mappedOptionsHtml.match(/<section\b[^>]*data-detail-panel="skus"[^>]*>([\s\S]*?)<\/section>/)?.[1];
assert.ok(consolidatedSkuPanel, "consolidated information must remain in the HP SKUs panel");
assert.ok(!mappedOptionsHtml.includes('<strong>BK</strong>') && !mappedOptionsHtml.includes('<strong>GRY</strong>'), "mapped colors must not repeat as supplementary variants after matching by id or color identity");
assert.equal(occurrences(consolidatedSkuPanel, '<span>Black</span>'), 1);
assert.equal(occurrences(consolidatedSkuPanel, '<span>Gray</span>'), 1);
assert.ok(consolidatedSkuPanel.includes('<strong>GRN</strong>') && consolidatedSkuPanel.includes('<span>Green</span>'), "an unmapped color must remain accessible as an additional option");
assert.ok(consolidatedSkuPanel.includes('<strong>US</strong>') && consolidatedSkuPanel.includes('United States'), "layout codes and names must remain accessible under HP SKUs");
assert.match(consolidatedSkuPanel, /class="product-detail-options"/);
assert.ok(!mappedOptionsHtml.includes('data-detail-more="variants"'), "consolidation must remove the duplicate More subtab");
assert.deepEqual(mappedColorsModel, mappedOptionsOriginal, "color consolidation must not rewrite product or SKU relationships");

const allMappedHtml = details.render({ ...mappedColorsModel, id: "all-colors-mapped", variants: mappedColorsModel.variants.slice(0, 2) });
assert.ok(!allMappedHtml.includes('data-detail-page-group="options"'), "fully mapped colors must not leave a redundant empty additional-options section");
const sameNameDifferentSwatchHtml = details.render({
  id: "distinct-color-options",
  skus: [{ code: "HP-MAPPED", colors: [mappedGray] }],
  variants: [{ group: "Colors", code: "GRY", colors: [{ ...mappedGray, colorHex: "#444444" }] }],
});
assert.ok(sameNameDifferentSwatchHtml.includes('<strong>GRY</strong>'), "matching names and codes alone must not hide a distinct unmapped colorway");
const idMappedHtml = details.render({
  id: "id-mapped-color-options",
  skus: [{ code: "HP-MAPPED", colors: [mappedBlack] }],
  variants: [{ group: "Colors", code: "BK", colors: [{ ...mappedBlack, label: "Custom black label" }] }],
});
assert.ok(!idMappedHtml.includes('<strong>BK</strong>'), "an established variant id must deduplicate the color even when its displayed label changes");

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
  categoryDefinition: () => ({ fullSpecCards: false }),
  variantFooterLayout: () => ({ height: 0 }),
  activeView: "products", zoom: 1, PRODUCT_MIN_ZOOM: .2,
  dragState: null, productCardMotion: null,
  productCardMotionValid: () => false,
  viewerInfoProductId: null, viewerInfoProgress: 0, viewerInfoOpen: false,
  viewerInfo: viewerPane, viewerInfoOutline: viewerOutline, renderedCards: [],
  selectedProduct: () => null,
  productDetailsModel: (product) => ({ ...longModel, id: product.id, specs: product.specs }),
  productDateHistoryOptions: () => ({}),
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
  { name: "bounded long compatibility values", specs: [{ label: "Compatibility", value: "Supported operating systems and devices ".repeat(8) }], full: false },
  { name: "full specifications", specs: Array.from({ length: 24 }, (_, index) => ({ label: `Compatibility ${index}`, value: "Detailed specification content ".repeat(9) })), full: true },
];
for (const scenario of paneScenarios) {
  paneSandbox.categoryDefinition = () => ({ fullSpecCards: scenario.full });
  paneSandbox.board.products = paneLanes.map((lane) => ({ id: `pane-${lane.id}`, name: "Product details", laneId: lane.id, specs: scenario.specs }));
  // A populated first lane makes the horizontal reserve observable beyond the
  // board's minimum canvas width, even at the smallest supported zoom.
  paneSandbox.board.products.push(...Array.from({ length: 6 }, (_, index) => ({ id: `following-${index}`, laneId: "first", specs: scenario.specs })));
  const layout = paneSandbox.productCardLayout();
  assert.equal(layout.detailed, scenario.full, "pane scenarios must retain automatic supported-category and compact multi-lane parent geometry");
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
      const expectedWidth = 720;
      closeEnough(paneSandbox.viewerInfoVisualHeight(), parentHeight, "fallback height exactly follows the parent's rendered height");
      assert.equal(paneSandbox.viewerInfoVisualWidth(), expectedWidth, "all parent heights receive horizontal room for compact date rows and readable specifications");
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
        assert.equal(viewerPane.dataset.detailColumns, "1", "specifications retain a readable single column beside the wider dates at every zoom");
        assert.equal(viewerPane.style.pointerEvents, progress > .96 ? "auto" : "none", "controls become interactive when the pane finishes opening");
        const exported = paneSandbox.getCanvasDimensions({ includeViewer: false });
        assert.equal(exported.width, closedDimensions.width, "exports omit the temporary horizontal detail reserve");
        assert.equal(exported.height, closedDimensions.height);
      }
    }
  }
}

// Compact date rows keep consistent horizontal room across height boundaries.
// Short and long specification values retain one readable column, and high
// specification counts do not further inflate the pane width.
const positionedProductId = paneSandbox.viewerInfoProductId;
paneSandbox.viewerInfoProductId = "pane-first";
const boundaryProduct = paneSandbox.board.products.find((item) => item.id === "pane-first");
for (const [height, expectedWidth] of [[180, 720], [180.01, 720], [280, 720], [280.01, 720], [1000, 720]]) {
  assert.equal(paneSandbox.viewerInfoVisualWidth(height), expectedWidth, "date rows retain horizontal room across compact parent-height boundaries");
}
for (const [value, height, expectedColumns] of [
  ["a".repeat(80), 180, "1"],
  [`  ${"a".repeat(40)}\n\t${"b".repeat(39)}  `, 280, "1"],
  ["a".repeat(81), 180, "1"],
  ["short", 280.01, "1"],
]) {
  boundaryProduct.specs = [{ label: "Compatibility", value }];
  paneSandbox.setViewerInfoSize(paneSandbox.viewerInfoVisualWidth(height), height);
  assert.equal(viewerPane.dataset.detailColumns, expectedColumns, "the dates layout must not squeeze short or long specifications into narrow columns");
}
boundaryProduct.specs = Array.from({ length: 100 }, (_, index) => ({ label: `Specification ${index}`, value: "Short" }));
assert.equal(paneSandbox.viewerInfoVisualWidth(500), 720, "many short specifications must not inflate the normal pane width");
paneSandbox.viewerInfoProductId = positionedProductId;

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

console.log("Product detail checks passed: compact SKU grids and consolidated options, copy feedback and asynchronous retries, clipboard fallback cleanup, complete information and accessible controls, escaped markup, exact parent-height panes, stable lanes, horizontal reserves, and preserved clearing structure.");
