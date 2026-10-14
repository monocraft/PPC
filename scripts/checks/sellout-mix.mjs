import assert from "node:assert/strict";
await import("../../public/js/reference-theme.js");
const saved = { performance: globalThis.performance, request: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame };
let clock = 0, nextFrame = 0, cancelled = 0;
const frames = new Map();
globalThis.performance = { now: () => clock };
globalThis.requestAnimationFrame = callback => { const id = ++nextFrame; frames.set(id, callback); return id; };
globalThis.cancelAnimationFrame = id => { cancelled++; frames.delete(id); };
function advance(time) { clock = time; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(time)); }
await import("../../public/js/sellout-mix.js");
const mix = globalThis.PPCSelloutMix;
const sample = [{ key: "audio", name: "Audio", current: 64 }, { key: "input", name: "Input", current: 36 }, { key: "adjustments", name: "Adjustments", current: -2 }, { key: "zero", name: "Zero", current: 0 }, { key: "missing", name: "Missing", current: null }];
assert.equal(mix.layout(sample).total, 100);
assert.equal(mix.layout(sample).entries.length, 2);
assert.equal(mix.layout(sample).entries[0].share, .64);
assert.equal(mix.layout(sample).entries.at(-1).end - mix.layout(sample).entries[0].start, Math.PI * 2);
assert.equal(mix.layout([{ key: "a", name: "A", current: 4 }, { key: "a", name: "A", current: -2 }]).total, 2, "Duplicate category adjustments net before positive-share selection.");
assert.equal(mix.layout([{ key: "a", current: Number.MAX_VALUE }, { key: "b", current: Number.MAX_VALUE }]).entries.length, 0, "Overflow cannot produce NaN arc geometry.");
const many = Array.from({ length: 8 }, (_, index) => ({ key: `category-${index}`, name: `Category ${index}`, current: 8 - index }));
assert.equal(mix.layout(many).entries.length, 6);
assert.equal(mix.layout(many).entries.at(-1).current, 6);
assert.equal(mix.layout(many, true).entries.length, 8);
const allowed = new Set(globalThis.PortfolioTheme.chartSeries);
assert.ok(allowed.has(mix.color("audio")));
assert.equal(mix.color("audio"), mix.color("audio"), "Palette must remain stable by category identity.");
const completeTheme = globalThis.PortfolioTheme;
globalThis.PortfolioTheme = { colors: completeTheme.colors };
assert.ok(new Set(["text", "label", "controlBorder", "borderStrong", "input", "header"].map(key => completeTheme.colors[key])).has(mix.color("audio")), "Older theme consumers retain the existing grayscale fallback.");
globalThis.PortfolioTheme = completeTheme;
const whole = mix.arc(-Math.PI / 2, Math.PI * 1.5);
assert.equal((whole.match(/A/g) || []).length, 4, "A complete annulus must use real outer and inner semicircles.");
assert.equal(mix.arc(1, 1), "");
for (const sweep of [.00002, .01, Math.PI / 2, Math.PI * 1.75, Math.PI * 2]) {
  const path = mix.arc(-Math.PI / 2, -Math.PI / 2 + sweep);
  assert.ok(path.startsWith("M") && path.endsWith("Z"));
  assert.equal(/NaN|Infinity/.test(path), false);
  const coordinates = [...path.matchAll(/(?:M|L)(-?[\d.]+),(-?[\d.]+)/g)].map(match => [Number(match[1]), Number(match[2])]);
  assert.ok(coordinates.every(([x, y]) => x >= 14 && x <= 226 && y >= 14 && y <= 226), "Ring geometry leaves room for 10-unit radial hover motion and its focus border.");
}

class Node {
  constructor(doc, name, namespaceURI = null) { this.ownerDocument = doc; this.name = name; this.namespaceURI = namespaceURI; this.children = []; this.parentNode = null; this.attributes = new Map(); this.style = {}; this.listeners = new Map(); this.isConnected = true; this.textContent = ""; }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  removeAttribute(key) { this.attributes.delete(key); }
  append(...children) { for (const child of children) { child.remove(); child.parentNode = this; child.isConnected = true; this.children.push(child); } }
  replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.append(...children); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; this.isConnected = false; }
  addEventListener(name, callback) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(callback); }
  emit(name, event = {}) { for (const callback of this.listeners.get(name) || []) callback({ ...event, target: this, preventDefault() { event.prevented = true; } }); }
  focus() { this.emit("focus"); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 250, height: 250 }; }
}
const doc = { createElement: name => new Node(doc, name), createElementNS: (ns, name) => new Node(doc, name, ns) };
const chart = new Node(doc, "div"), legend = new Node(doc, "div");
let selected = "", tip = "", hidden = 0;
const options = { categories: sample, onSelect: key => { selected = key; }, showTip: html => { tip = html; }, hideTip: () => { hidden++; }, reducedMotion: false };
let controller = mix.render(chart, legend, options);
const svg = chart.children[0], ring = svg.children[1], audioPath = ring.children[0];
assert.match(svg.getAttribute("aria-label"), /100 positive category units across 2 categories/);
assert.equal(audioPath.getAttribute("role"), "button");
assert.equal(audioPath.getAttribute("tabindex"), "0");
assert.equal(audioPath.getAttribute("stroke"), "none");
assert.equal(audioPath.getAttribute("stroke-width"), "0", "Default slices must have no visual border.");
assert.ok(frames.size > 0);
advance(600); assert.equal(frames.size, 0, "Animation must settle with no permanent frame loop.");
const settled = audioPath.getAttribute("d");
audioPath.emit("pointerenter", { clientX: 50, clientY: 60 });
assert.match(tip, /64 units/); assert.match(tip, /64\.0%/);
assert.equal(svg.children[2].textContent, "64.0%");
assert.equal(svg.children[3].textContent, "Audio");
assert.equal(svg.children[4].textContent, "64 units", "Hover center shows the category's actual unit count.");
advance(900); assert.notEqual(audioPath.getAttribute("transform"), "translate(0.000 0.000)");
audioPath.emit("pointerleave"); advance(1200); assert.equal(audioPath.getAttribute("transform"), "translate(0.000 0.000)"); assert.ok(hidden > 0);
assert.equal(svg.children[2].textContent, "100"); assert.equal(svg.children[3].textContent, "positive units"); assert.equal(svg.children[4].textContent, "");
audioPath.emit("focus"); advance(1500); assert.equal(audioPath.getAttribute("stroke-width"), "2");
assert.equal(svg.children[3].textContent, "Audio"); assert.equal(svg.children[4].textContent, "64 units", "Keyboard focus exposes the same category evidence as hover.");
audioPath.emit("keydown", { key: "Enter" }); assert.equal(selected, "audio");
audioPath.emit("blur"); advance(1800); assert.equal(audioPath.getAttribute("transform"), "translate(0.000 0.000)");
assert.equal(audioPath.getAttribute("stroke"), "none");
audioPath.matches = () => false; audioPath.emit("focus");
assert.equal(audioPath.getAttribute("stroke-width"), "0", "Pointer focus does not add a category edge border.");
audioPath.emit("blur"); audioPath.matches = () => true; audioPath.emit("focus");
assert.equal(audioPath.getAttribute("stroke-width"), "2", "Keyboard focus retains an accessible visible indicator.");
audioPath.emit("blur");

controller = mix.render(chart, legend, { ...options, categories: [{ key: "audio", name: "Audio", current: 20 }, { key: "input", name: "Input", current: 80 }] });
assert.equal(chart.children[0], svg); assert.equal(ring.children[0], audioPath, "Retargeting must update existing keyed SVG path nodes.");
advance(2000); const halfway = audioPath.getAttribute("d");
assert.notEqual(halfway, settled);
mix.render(chart, legend, { ...options, categories: [{ key: "audio", name: "Audio", current: 30 }, { key: "input", name: "Input", current: 70 }] });
assert.ok(cancelled > 0, "A new filter render must cancel the prior animation before retargeting.");
assert.equal(audioPath.getAttribute("d"), halfway, "An interrupted transition resumes from displayed geometry without jumping.");
advance(2600); assert.equal(frames.size, 0);
mix.render(chart, legend, { ...options, categories: [{ key: "input", name: "Input", current: 100 }] });
assert.equal(audioPath.getAttribute("tabindex"), "-1", "Exiting data cannot remain an actionable hidden category.");
advance(3200); assert.equal(ring.children.includes(audioPath), false); assert.equal(ring.children.length, 1);
assert.equal((ring.children[0].getAttribute("d").match(/A/g) || []).length, 4);

mix.render(chart, legend, { ...options, categories: many, reducedMotion: true });
assert.equal(frames.size, 0, "Reduced-motion rendering must skip animation frames.");
assert.equal(ring.children.length, 6); assert.equal(legend.children.length, 6);
legend.children.at(-1).emit("click"); assert.equal(ring.children.length, 8); assert.equal(legend.children.length, 9);
assert.equal(legend.children.at(-1).textContent, "Show less");
legend.children.at(-1).emit("click"); assert.equal(ring.children.length, 6); assert.equal(legend.children.length, 6);
mix.render(chart, legend, { ...options, categories: [{ key: "safe", name: "<script>unsafe</script>", current: 1 }], reducedMotion: true });
ring.children[0].emit("pointerenter", { clientX: 0, clientY: 0 });
assert.equal(tip.includes("<script>"), false); assert.equal(tip.includes("&lt;script&gt;"), true, "Tooltip category text must be escaped.");
assert.equal(legend.children[0].children[1].textContent, "<script>unsafe</script>");
mix.render(chart, legend, { ...options, categories: [], reducedMotion: true });
assert.equal(ring.children.length, 0); assert.equal(legend.children.length, 0); assert.match(svg.getAttribute("aria-label"), /0 positive category units/);
controller.destroy(); assert.equal(chart.children.length, 0); assert.equal(legend.children.length, 0); assert.equal(frames.size, 0);

const collisionFixture = ["Microphones", "Headsets – Console", "Mice", "Keyboards", "Headsets – PC", "Accessories", "Controllers"].map((key, index) => ({ key, name: key, current: 70 - index * 10 }));
const collisionChart = new Node(doc, "div"), collisionLegend = new Node(doc, "div");
const collisionController = mix.render(collisionChart, collisionLegend, { ...options, categories: collisionFixture, reducedMotion: true });
const collisionRing = collisionChart.children[0].children[1];
const fills = ringNode => new Map(ringNode.children.map(path => [path.getAttribute("aria-label").split(":")[0], path.getAttribute("fill")]));
const firstColors = fills(collisionRing);
assert.equal(new Set(firstColors.values()).size, 6, "The leading five categories and Other must use six unique master colors despite stable-hash collisions.");
assert.equal(firstColors.get("Other"), globalThis.PortfolioTheme.chartSeries.at(-1), "Other reserves the master's final series color.");
assert.ok([...firstColors.values()].every(fill => allowed.has(fill)));
for (const button of collisionLegend.children) {
  const name = button.children[1].textContent, track = button.children[3], fill = track.children[0], contribution = mix.layout(collisionFixture).entries.find(entry => entry.name === name);
  assert.equal(button.children[0].style.background, firstColors.get(name), "Each legend swatch must exactly match its slice color.");
  assert.equal(track.className, "so-mix-share-track"); assert.equal(track.getAttribute("aria-hidden"), "true");
  assert.equal(fill.className, "so-mix-share-fill"); assert.equal(fill.style.width, `${contribution.share * 100}%`, "Legend bars show the actual positive-category share without an invented minimum width.");
  assert.equal(fill.style.background, firstColors.get(name), "Contribution bars use their category's chart palette assignment.");
}
const reordered = collisionFixture.map(category => ({ ...category, current: { Microphones: 65, "Headsets – Console": 55, Mice: 75, Keyboards: 35, "Headsets – PC": 45 }[category.key] ?? category.current }));
mix.render(collisionChart, collisionLegend, { ...options, categories: reordered, reducedMotion: true });
const rankedColors = fills(collisionRing);
for (const [key, fill] of firstColors) assert.equal(rankedColors.get(key), fill, "Retained categories keep their assigned colors when their ranking changes.");
assert.equal(new Set(rankedColors.values()).size, 6);
collisionLegend.children.at(-1).emit("click");
const expandedColors = fills(collisionRing), expandedOrder = mix.layout(reordered, true).entries.map(entry => entry.name);
for (let index = 0; index < expandedOrder.length; index++) assert.notEqual(expandedColors.get(expandedOrder[index]), expandedColors.get(expandedOrder[(index + 1) % expandedOrder.length]), "New expanded categories avoid adjacent duplicate colors, including the ring seam.");
for (const [key, fill] of firstColors) if (key !== "Other") assert.equal(expandedColors.get(key), fill, "Expanding Other preserves the visible category colors.");
collisionLegend.children.at(-1).emit("click");
assert.deepEqual(fills(collisionRing), firstColors);
const deterministicChart = new Node(doc, "div"), deterministicLegend = new Node(doc, "div");
const deterministicController = mix.render(deterministicChart, deterministicLegend, { ...options, categories: [...collisionFixture].reverse(), reducedMotion: true });
assert.deepEqual(fills(deterministicChart.children[0].children[1]), firstColors, "Initial color allocation is deterministic regardless of source input order.");
const subdued = Array.from({ length: 6 }, (_, index) => `var(--so-chart-${index + 1})`);
mix.render(collisionChart, collisionLegend, { ...options, categories: reordered, palette: subdued, reducedMotion: true });
const overridden = fills(collisionRing);
for (const [key, masterColor] of firstColors) assert.equal(overridden.get(key), subdued[globalThis.PortfolioTheme.chartSeries.indexOf(masterColor)], "Palette overrides retain the category's assigned master index rather than its old color string.");
for (const button of collisionLegend.children) { const fill = overridden.get(button.children[1].textContent); assert.equal(button.children[0].style.background, fill, "An overridden palette must match all slice and legend colors."); assert.equal(button.children[3].children[0].style.background, fill, "The contribution bar follows palette overrides too."); }
const furtherSubdued = Array.from({ length: 6 }, (_, index) => `var(--soft-chart-${index + 1})`);
mix.render(collisionChart, collisionLegend, { ...options, categories: collisionFixture, palette: furtherSubdued, reducedMotion: true });
const refreshed = fills(collisionRing);
for (const [key, oldColor] of overridden) assert.equal(refreshed.get(key), furtherSubdued[subdued.indexOf(oldColor)], "Existing keys preserve assigned series indices across palette and ranking changes.");
assert.equal(new Set(refreshed.values()).size, 6);
mix.render(collisionChart, collisionLegend, { ...options, categories: collisionFixture, reducedMotion: true });
assert.deepEqual(fills(collisionRing), firstColors, "Removing an override restores exact master colors at retained category indices.");
for (const palette of [[], ["red"], Array(6).fill(""), ["red", "blue", "green", "yellow", "purple", null]]) assert.throws(() => mix.render(collisionChart, collisionLegend, { ...options, palette }), /six nonempty color strings/);
collisionController.destroy(); deterministicController.destroy();
const exactChart = new Node(doc, "div"), exactLegend = new Node(doc, "div");
const exactController = mix.render(exactChart, exactLegend, { ...options, categories: [{ key: "precise", name: "A long category name", current: 1234567 }, { key: "second", name: "Second", current: 456789 }], reducedMotion: true });
const exactSvg = exactChart.children[0], precise = exactSvg.children[1].children[0];
precise.emit("pointerenter"); assert.equal(exactSvg.children[4].textContent, "1,234,567 units", "Large hovered unit counts remain exact rather than compacted or inferred."); assert.ok(exactSvg.children[3].textContent.length <= 17);
precise.emit("pointerleave"); assert.equal(exactSvg.children[3].textContent, "positive units"); assert.equal(exactSvg.children[4].textContent, "");
precise.matches = () => true; precise.emit("focus"); assert.equal(exactSvg.children[4].textContent, "1,234,567 units");
precise.emit("blur"); assert.equal(exactSvg.children[3].textContent, "positive units");
exactController.destroy();
const tinyChart = new Node(doc, "div"), tinyLegend = new Node(doc, "div");
const tinyController = mix.render(tinyChart, tinyLegend, { ...options, categories: [{ key: "large", name: "Large", current: 9999999 }, { key: "tiny", name: "Tiny", current: 1 }], reducedMotion: true });
const tinyButton = tinyLegend.children[1];
assert.equal(tinyButton.children[2].textContent, "<0.1%", "A positive contribution cannot be reported as zero after display rounding.");
assert.ok(Math.abs(parseFloat(tinyButton.children[3].children[0].style.width) - .00001) < 1e-12, "The small-share label does not invent a minimum bar width.");
assert.match(tinyButton.getAttribute("aria-label"), /1 units, less than 0\.1 percent/);
tinyButton.emit("pointerenter"); assert.equal(tinyChart.children[0].children[2].textContent, "<0.1%"); assert.equal(tinyChart.children[0].children[4].textContent, "1 units"); assert.match(tip, /&lt;0\.1%/);
tinyButton.emit("pointerleave"); assert.equal(tinyChart.children[0].children[3].textContent, "positive units");
tinyController.destroy();
globalThis.performance = saved.performance; globalThis.requestAnimationFrame = saved.request; globalThis.cancelAnimationFrame = saved.cancel;
console.log("Category mix: positive-share math, true annulus geometry, unique stable palette, contribution bars, exact hover/focus counts, small positive shares, borderless slices, keyed animation, Other expansion, reduced motion, escaping, and finite cleanup passed.");
