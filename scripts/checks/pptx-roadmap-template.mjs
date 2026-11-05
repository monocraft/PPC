import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import path from "node:path";

const moduleUrl = new URL("../../public/js/pptx-roadmap-template.js", import.meta.url);
assert.ok(existsSync(moduleUrl), "The browser native roadmap template renderer must exist.");
const sandbox = { console, setTimeout, clearTimeout, setImmediate, clearImmediate, Buffer, Blob, URL, ArrayBuffer, Uint8Array, Uint16Array, Uint32Array, TextEncoder, TextDecoder, structuredClone };
vm.createContext(sandbox);
vm.runInContext(await readFile(new URL("../../public/vendor/pptxgen.bundle.js", import.meta.url), "utf8"), sandbox);
vm.runInContext(await readFile(new URL("../../public/js/pptx-roadmap-model.js", import.meta.url), "utf8"), sandbox);
vm.runInContext(await readFile(moduleUrl, "utf8"), sandbox);
const renderer = sandbox.PPTXRoadmapTemplate;
assert.equal(typeof renderer?.buildContent, "function");
assert.equal(typeof renderer?.mergeTemplate, "function");
assert.equal(typeof renderer?.generate, "function");

const product = (id, coverage, startMonth, endMonth) => ({
  id, name: `Native & <${id}>`, family: "FAMILY", lifecycleCoverage: coverage,
  nativeLifecycleProduct: { startMonth, endMonth, fill: "#546678", priceLabel: "$12", statusLabel: "Planned" },
  dates: { ffsDate: { validDate: "2026-02-01", raw: "2026-02-01" } },
});
const data = {
  selectedTimeline: { startMonth: "2026-01", endMonth: "2026-12", showRoadmapMsrp: true },
  categories: [{ id: "synthetic", name: "Synthetic", products: [
    product("current", "inRange", "2025-12", "2026-03"),
    product("past", "outsideRange", "2023-02", "2024-04"),
    product("future", "outsideRange", "2028-07", "2029-05"),
    product("undated", "tbd", null, null),
  ] }],
};
const before = JSON.stringify(data);
const characters = Array.from({ length: 95 }, (_, index) => String.fromCharCode(index + 32)).join("");
const face = { advances: Object.fromEntries([...characters].map(character => [character, 512])), kerning: {} };
const metrics = { schemaVersion: 1, fontFamily: "Arial Narrow", unitsPerEm: 1024, characters, faces: { regular: face, bold: face } };
let yields = 0;
sandbox.requestAnimationFrame = callback => { yields += 1; setTimeout(callback, 0); };
const progress = [];
const built = await renderer.buildContent(data, metrics, value => progress.push(value));
assert.equal(JSON.stringify(data), before, "Rendering must preserve every raw source date and source object.");
assert.equal(built.manifest.coverage.represented, 4);
assert.equal(built.manifest.slides.length, 4);
assert.ok(yields >= 4, "Native slide batches must yield browser paint opportunities.");
assert.ok(progress.some(value => value.phase === "render" && value.completed === 4 && value.total === 4));
const zip = await sandbox.JSZip.loadAsync(built.bytes, { checkCRC32: true });
const presentation = await zip.file("ppt/presentation.xml").async("string");
assert.match(presentation, /<p:sldSz\b[^>]*cx="24384000"[^>]*cy="13716000"/);
for (const entry of built.manifest.slides) {
  const xml = await zip.file(`ppt/slides/slide${entry.index + 1}.xml`).async("string");
  assert.equal((xml.match(/<p:pic\b/g) || []).length, 0, "All roadmap evidence remains native editable objects.");
  assert.ok(xml.includes("Native &amp; &lt;"), "Native labels must retain XML-sensitive characters.");
  assert.ok(xml.includes('typeface="HP Forma DJR Office"'));
  if (entry.section === "dates-tbd") {
    assert.equal((xml.match(/<a:tbl>/g) || []).length, 1);
    assert.equal((xml.match(/<a:tr\b/g) || []).length, 2);
    assert.match(xml, /<a:tr h="685800"/);
    assert.match(xml, /<a:tr h="590550"/);
    assert.ok(xml.includes("Feb 2026") && xml.includes("TBD"));
  } else {
    assert.equal((xml.match(/<a:tbl>/g) || []).length, 0);
    assert.match(xml, /name="Lifecycle bar: /);
    assert.match(xml, /typeface="Arial Narrow"/);
    assert.match(xml, /\bsz="1800"/);
  }
}
const current = built.manifest.slides.find(entry => entry.productIds.includes("current")).productRows[0];
assert.equal(current.sourceStartMonth, "2025-12");
assert.equal(current.visibleStartMonth, "2026-01");
assert.equal(current.bar.left, sandbox.PPTXRoadmapModel.G.plotX);
assert.ok(Math.abs(current.bar.width - sandbox.PPTXRoadmapModel.G.plotWidth * 3 / 12) < .000001);
const outside = built.manifest.slides.filter(entry => entry.section === "outside-range");
assert.equal(outside.length, 2);
assert.deepEqual(JSON.parse(JSON.stringify(outside.map(entry => entry.timeline))), [
  { startMonth: "2023-01", endMonth: "2024-12", showRoadmapMsrp: true },
  { startMonth: "2028-01", endMonth: "2029-12", showRoadmapMsrp: true },
]);

// Calendar text must fit its actual visible quarter/year frames. Checking the
// emitted native OOXML catches collisions that renderer-call assertions miss.
for (const [startMonth, endMonth, referenceCaption] of [
  ["2024-01", "2026-12", false], ["2023-01", "2026-12", false],
  ["2026-12", "2028-01", false], ["2026-02", "2029-01", false],
  ["2026-01", "2026-12", true], ["2026-01", "2026-09", true],
]) {
  const calendarInput = { selectedTimeline: { startMonth, endMonth, showRoadmapMsrp: false },
    categories: [{ id: "calendar", name: "Calendar fixture", products: [product("calendar", "inRange", startMonth, endMonth)] }] };
  const calendarBuilt = await renderer.buildContent(calendarInput, metrics);
  const calendarZip = await sandbox.JSZip.loadAsync(calendarBuilt.bytes);
  const xml = await calendarZip.file("ppt/slides/slide1.xml").async("string");
  const frames = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map(match => {
    const name = /<p:cNvPr\b[^>]*name="([^"]*)"/.exec(match[0])?.[1];
    const off = /<a:off x="(-?\d+)" y="(-?\d+)"/.exec(match[0]);
    const ext = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(match[0]);
    return { name, text: /<a:t>/.test(match[0]), x: Number(off?.[1]), y: Number(off?.[2]), w: Number(ext?.[1]), h: Number(ext?.[2]) };
  }).filter(frame => frame.text && frame.name?.startsWith("Calendar "));
  for (let left = 0; left < frames.length; left += 1) {
    for (let right = left + 1; right < frames.length; right += 1) {
      const a = frames[left], b = frames[right];
      const width = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const height = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      assert.ok(width <= 1 || height <= 1, `${startMonth}–${endMonth}: native calendar text frames collide: ${a.name} / ${b.name}`);
    }
  }
  assert.equal(frames.some(frame => frame.name.startsWith("Calendar year caption ")), referenceCaption, "Reference captions remain on ordinary nine/twelve-month headers, with compact headers used when quarters cannot fit them.");
  const bar = calendarBuilt.manifest.slides[0].productRows[0].bar;
  assert.equal(bar.left, 249.06); assert.equal(bar.width, 2221.33, "Calendar compaction never changes saved interval geometry.");
}

// Node has no XML DOM. This fixture-only adapter supplies the same tree API as
// the browser; the renderer itself always uses the native browser parser.
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const encode = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const decode = value => String(value).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
class FixtureNode {
  constructor(name, namespaceURI = "", nodeType = 1, value = "") {
    Object.assign(this, { nodeName: name, namespaceURI, nodeType, value, childNodes: [], parentNode: null, attributeMap: new Map() });
  }
  get localName() { return this.nodeName.split(":").at(-1); }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get attributes() { return [...this.attributeMap.values()]; }
  get textContent() { return this.nodeType === 3 ? this.value : this.childNodes.map(node => node.textContent).join(""); }
  set textContent(value) { this.childNodes = []; if (String(value)) this.appendChild(new FixtureNode("#text", "", 3, String(value))); }
  appendChild(node) { if (node.parentNode) node.parentNode.removeChild(node); node.parentNode = this; this.childNodes.push(node); return node; }
  removeChild(node) { this.childNodes.splice(this.childNodes.indexOf(node), 1); node.parentNode = null; return node; }
  replaceChild(next, previous) { const index = this.childNodes.indexOf(previous); this.removeChild(previous); this.childNodes.splice(index, 0, next); next.parentNode = this; return previous; }
  insertBefore(node, sibling) { const index = this.childNodes.indexOf(sibling); if (index < 0) return this.appendChild(node); this.childNodes.splice(index, 0, node); node.parentNode = this; return node; }
  getAttribute(name) { return this.attributeMap.get(name)?.value || ""; }
  getAttributeNS(namespaceURI, localName) { return this.attributes.find(attribute => attribute.namespaceURI === namespaceURI && attribute.localName === localName)?.value || ""; }
  setAttribute(name, value) { this.setAttributeNS("", name, value); }
  setAttributeNS(namespaceURI, name, value) { this.attributeMap.set(name, { name, namespaceURI, localName: name.split(":").at(-1), value: String(value) }); }
  removeAttribute(name) { this.attributeMap.delete(name); }
  getElementsByTagNameNS(namespaceURI, localName) { return this.children.flatMap(node => [
    ...((namespaceURI === "*" || node.namespaceURI === namespaceURI) && (localName === "*" || node.localName === localName) ? [node] : []),
    ...node.getElementsByTagNameNS(namespaceURI, localName),
  ]); }
  cloneNode(deep) { const copy = new FixtureNode(this.nodeName, this.namespaceURI, this.nodeType, this.value); this.attributes.forEach(attribute => copy.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value)); if (deep) this.childNodes.forEach(node => copy.appendChild(node.cloneNode(true))); return copy; }
}
class FixtureDocument extends FixtureNode {
  constructor() { super("#document", "", 9); }
  get documentElement() { return this.children[0]; }
  createElementNS(namespaceURI, name) { return new FixtureNode(name, namespaceURI); }
  importNode(node, deep) { return node.cloneNode(deep); }
}
class FixtureDOMParser {
  parseFromString(xml) {
    const doc = new FixtureDocument();
    const stack = [{ node: doc, namespaces: {} }];
    for (const token of xml.match(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) || []) {
      if (token.startsWith("<?") || token.startsWith("<!--")) continue;
      if (token.startsWith("</")) { const closing = token.slice(2, -1); if (stack.pop()?.node.nodeName !== closing) throw new Error("Fixture XML closing mismatch"); continue; }
      const current = stack.at(-1);
      if (!token.startsWith("<")) { current.node.appendChild(new FixtureNode("#text", "", 3, decode(token))); continue; }
      const name = /^<([^\s/>]+)/.exec(token)[1];
      const attrs = [...token.matchAll(/([^\s=<>]+)="([^"]*)"/g)].map(match => [match[1], decode(match[2])]);
      const namespaces = { ...current.namespaces };
      attrs.forEach(([key, value]) => { if (key === "xmlns") namespaces[""] = value; else if (key.startsWith("xmlns:")) namespaces[key.slice(6)] = value; });
      const node = new FixtureNode(name, namespaces[name.includes(":") ? name.split(":")[0] : ""] || "");
      attrs.forEach(([key, value]) => node.setAttributeNS(key.includes(":") ? namespaces[key.split(":")[0]] || "" : "", key, value));
      current.node.appendChild(node);
      if (!token.endsWith("/>")) stack.push({ node, namespaces });
    }
    assert.equal(stack.length, 1, "Fixture XML must be balanced.");
    return doc;
  }
}
class FixtureXMLSerializer {
  serializeToString(node) { if (node.nodeType === 9) return node.childNodes.map(child => this.serializeToString(child)).join(""); if (node.nodeType === 3) return encode(node.value); return `<${node.nodeName}${node.attributes.map(attribute => ` ${attribute.name}="${encode(attribute.value)}"`).join("")}>${node.childNodes.map(child => this.serializeToString(child)).join("")}</${node.nodeName}>`; }
}
sandbox.DOMParser = FixtureDOMParser;
sandbox.XMLSerializer = FixtureXMLSerializer;
const shellDeck = new sandbox.PptxGenJS();
shellDeck.defineLayout({ name: "REFERENCE", width: 2560 / 96, height: 1440 / 96 });
shellDeck.layout = "REFERENCE";
shellDeck.addSlide().addText("LAST UPDATED: \t", { objectName: "PPC template export date", x: 1, y: 1, w: 5, h: 1, fontFace: "HP Forma DJR Office" });
const changeSlide = shellDeck.addSlide();
changeSlide.addTable([["Date", "Changes Made"], ...Array.from({ length: 9 }, () => [" ", " "])], { x: 1, y: 1, w: 20, colW: [3, 17], rowH: .3, autoPage: false, color: "FFFFFF", fontFace: "HP Forma DJR Office" });
shellDeck.addSlide().addText("Category Roadmap", { objectName: "PPC template category title", x: 1, y: 1, w: 15, h: 1, fontFace: "HP Forma DJR Office Medium" });
shellDeck.addSlide();
const shellZip = await sandbox.JSZip.loadAsync(await shellDeck.write({ outputType: "arraybuffer" }));
let coverXml = await shellZip.file("ppt/slides/slide1.xml").async("string");
coverXml = coverXml.replace('id="2" name="PPC template export date"', 'id="1664" name="PPC template export date"').replace("<a:t>LAST UPDATED: \t</a:t>", "<a:t>LAST UPDATED: </a:t></a:r><a:r><a:rPr/><a:t>\t</a:t></a:r><a:r><a:rPr/><a:t></a:t>");
shellZip.file("ppt/slides/slide1.xml", coverXml);
shellZip.file("ppt/slides/slide2.xml", (await shellZip.file("ppt/slides/slide2.xml").async("string")).replace(/id="\d+" name="Table \d+"/, 'id="2" name="Table 0"'));
shellZip.file("ppt/slides/slide3.xml", (await shellZip.file("ppt/slides/slide3.xml").async("string")).replace(/id="\d+" name="PPC template category title"/, 'id="2" name="PPC template category title"'));
const shellBytes = await shellZip.generateAsync({ type: "arraybuffer" });
const merged = await renderer.mergeTemplate(shellBytes, built.bytes, built.manifest, { exportDate: "2030-04-09", onProgress: value => progress.push(value) });
assert.equal(merged.manifest.slides.length, 7, "Intro, changelog, one divider and each native content slide appear once.");
assert.equal(merged.manifest.nativeContentSlides, 4);
assert.equal(merged.manifest.products, 4);
const finalZip = await sandbox.JSZip.loadAsync(merged.bytes, { checkCRC32: true });
const finalSlides = Object.keys(finalZip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name));
assert.equal(finalSlides.length, 7);
assert.ok((await finalZip.file("ppt/slides/slide1.xml").async("string")).includes("04-09-2030"));
const finalChanges = await finalZip.file("ppt/slides/slide2.xml").async("string");
assert.ok(finalChanges.includes("4/9/30") && finalChanges.includes("4 products"));
assert.equal((finalChanges.match(/<a:tr\b/g) || []).length, 10, "Current update replaces a blank history row without growing the template.");
assert.ok((await finalZip.file("ppt/slides/slide3.xml").async("string")).includes("Synthetic Roadmap"));
const finalPresentation = await finalZip.file("ppt/presentation.xml").async("string");
assert.equal((finalPresentation.match(/<p:sldId\b/g) || []).length, 7);
const finalPresentationRels = await finalZip.file("ppt/_rels/presentation.xml.rels").async("string");
assert.equal((finalPresentationRels.match(/relationships\/slide"/g) || []).length, 7);
const finalTypes = await finalZip.file("[Content_Types].xml").async("string");
assert.equal((finalTypes.match(/presentationml\.slide\+xml/g) || []).length, 7);
for (let index = 4; index <= 7; index += 1) {
  const rels = await finalZip.file(`ppt/slides/_rels/slide${index}.xml.rels`).async("string");
  assert.equal((rels.match(/<Relationship\b/g) || []).length, 1, "Each native body retains exactly its layout ownership.");
  assert.ok(rels.includes("/slideLayout"));
}
assert.ok(progress.some(value => value.phase === "compress" && value.completed > 0 && value.completed < value.total), "Compression reports the archive's real progress.");
await assert.rejects(() => renderer.mergeTemplate(shellBytes, built.bytes, { ...built.manifest, slides: [built.manifest.slides[0], ...built.manifest.slides] }, { exportDate: "2030-04-09" }), /manifest|index|coverage|once/i);
const pictured = await sandbox.JSZip.loadAsync(built.bytes);
pictured.file("ppt/slides/slide1.xml", (await pictured.file("ppt/slides/slide1.xml").async("string")).replace("</p:spTree>", "<p:pic/></p:spTree>"));
await assert.rejects(async () => renderer.mergeTemplate(shellBytes, await pictured.generateAsync({ type: "arraybuffer" }), built.manifest, { exportDate: "2030-04-09" }), /native|picture|flatten/i);
const generated = await renderer.generate(data, { templateBytes: shellBytes, metrics, exportDate: "2030-04-09", onProgress: value => progress.push(value) });
assert.equal(generated.blob.type, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
assert.ok(generated.blob.size > 0);
assert.equal(generated.fileName, "Portfolio-Roadmap-2030-04-09.pptx");
assert.ok(progress.every(value => Number.isFinite(value.percent) && value.percent >= 0 && value.percent <= 100), "Every progress event includes an accessible bounded percentage.");
assert.equal(progress.at(-1).percent, 100);
assert.ok(!Object.keys(finalZip.files).some(name => /(?:notesSlides|notesMasters|customXml|\/tags\/)/.test(name)), "Source notes and add-in ownership must not enter the final package.");
const oversizedTbd = structuredClone(data);
oversizedTbd.categories[0].products = [product("too-wide", "tbd", null, null)];
oversizedTbd.categories[0].products[0].name = "L".repeat(1000);
await assert.rejects(() => renderer.buildContent(oversizedTbd, metrics), /table|label|frame/i, "An unsupported TBD label must fail cleanly instead of overflowing a native cell.");
const assetBytes = {
  "roadmap-template.pptx": new Uint8Array(await readFile(new URL("../../public/assets/pptx/roadmap-template.pptx", import.meta.url))).buffer,
  "arial-narrow-metrics.json": new Uint8Array(await readFile(new URL("../../public/assets/pptx/arial-narrow-metrics.json", import.meta.url))).buffer,
};
const requests = [];
let templateAttempt = 0;
const assetSandbox = { ...sandbox, crypto: webcrypto,
  document: { currentScript: { src: "https://ppc.test/public/js/pptx-roadmap-template.js?v=synthetic-build" }, baseURI: "https://ppc.test/" },
  fetch: async (url, options) => {
    requests.push({ url, options });
    const name = new URL(url).pathname.split("/").at(-1);
    if (name === "roadmap-template.pptx") {
      templateAttempt += 1;
      if (templateAttempt === 1) return { ok: false, status: 503 };
      if (templateAttempt === 2) {
        const wrong = assetBytes[name].slice(0); new Uint8Array(wrong)[0] ^= 1;
        return { ok: true, arrayBuffer: async () => wrong };
      }
    }
    assert.ok(assetBytes[name], "Runtime may fetch only the two static reference assets.");
    return { ok: true, arrayBuffer: async () => assetBytes[name] };
  },
};
vm.createContext(assetSandbox);
vm.runInContext(await readFile(moduleUrl, "utf8"), assetSandbox);
await assert.rejects(() => assetSandbox.PPTXRoadmapTemplate.generate(data), /503/);
await assert.rejects(() => assetSandbox.PPTXRoadmapTemplate.generate(data), /identity/i);
const assetGenerated = await assetSandbox.PPTXRoadmapTemplate.generate(data, { exportDate: "2030-04-09" });
assert.ok(assetGenerated.blob.size > 1000000, "The native export retains the approved branding shell.");
assert.equal(templateAttempt, 3, "Failed static loads clear their cached promises so a later export can retry.");
assert.equal(requests.filter(request => request.url.includes("arial-narrow-metrics.json")).length, 1, "Verified static assets are reused within the loaded code version.");
assert.ok(requests.every(request => new URL(request.url).origin === "https://ppc.test" && new URL(request.url).search === "?v=synthetic-build"));
assert.ok(requests.every(request => request.options.mode === "same-origin" && request.options.redirect === "error"), "Static asset requests cannot follow a redirect to an external service.");
assert.ok(requests.every(request => request.options.cache === "no-cache"), "A retry must revalidate a browser-cached stale asset after an identity failure.");
const loadedShell = await sandbox.JSZip.loadAsync(assetBytes["roadmap-template.pptx"]);
const assetResult = await sandbox.JSZip.loadAsync(await assetGenerated.blob.arrayBuffer());
// The real shell owns logo images in its intro. A synthetic text-only shell
// cannot catch accidentally dropping those relationship owners during merge.
for (const name of Object.keys(assetResult.files).filter(name => name.endsWith(".xml"))) {
  const doc = new FixtureDOMParser().parseFromString(await assetResult.file(name).async("string"));
  const ownerRelsPath = path.posix.join(path.posix.dirname(name), "_rels", path.posix.basename(name) + ".rels");
  const ownerRels = new Map();
  if (assetResult.file(ownerRelsPath)) {
    const relDoc = new FixtureDOMParser().parseFromString(await assetResult.file(ownerRelsPath).async("string"));
    for (const rel of relDoc.getElementsByTagNameNS("http://schemas.openxmlformats.org/package/2006/relationships", "Relationship")) {
      assert.notEqual(rel.getAttribute("TargetMode"), "External", "The sanitized reference has no external relationship dependencies.");
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), rel.getAttribute("Target")));
      assert.ok(assetResult.file(target), `Merged relationship ${ownerRelsPath} resolves to ${target}.`);
      ownerRels.set(rel.getAttribute("Id"), rel);
    }
  }
  for (const element of [doc.documentElement, ...doc.getElementsByTagNameNS("*", "*")]) {
    for (const attribute of element.attributes) {
      if (attribute.namespaceURI === "http://schemas.openxmlformats.org/officeDocument/2006/relationships" && ["id", "embed", "link"].includes(attribute.localName)) {
        assert.ok(ownerRels.has(attribute.value), `Final merged part ${name} references absent relationship ${attribute.value}.`);
      }
    }
  }
}
for (const entry of assetGenerated.manifest.slides.filter(entry => Number.isInteger(entry.contentIndex))) {
  const bodyRels = await assetResult.file(`ppt/slides/_rels/slide${entry.finalSlide}.xml.rels`).async("string");
  assert.equal((bodyRels.match(/<Relationship\b/g) || []).length, 1, "Real native bodies retain only their own layout relationship.");
  assert.ok(bodyRels.includes("slideLayout25.xml"));
}
for (const name of Object.keys(loadedShell.files).filter(name => /ppt\/(?:media|slideMasters|slideLayouts|theme)\//.test(name))) {
  assert.deepEqual(await assetResult.file(name).async("uint8array"), await loadedShell.file(name).async("uint8array"), `Reference branding and typography must remain byte-identical in ${name}.`);
}
let hungLoads = true;
const timeoutSignals = [];
const timeoutSandbox = { ...sandbox, crypto: webcrypto, AbortController,
  document: assetSandbox.document,
  setTimeout: (callback, delay) => setTimeout(callback, delay === 20000 ? 0 : delay),
  fetch: async (url, { signal }) => {
    timeoutSignals.push(signal);
    if (hungLoads) return new Promise(() => {});
    return { ok: true, arrayBuffer: async () => assetBytes[new URL(url).pathname.split("/").at(-1)] };
  },
};
vm.createContext(timeoutSandbox);
vm.runInContext(await readFile(moduleUrl, "utf8"), timeoutSandbox);
await assert.rejects(() => timeoutSandbox.PPTXRoadmapTemplate.generate(data, { templateBytes: shellBytes }), /timed out/i);
assert.ok(timeoutSignals[0].aborted, "The bounded timeout also cancels its static request.");
hungLoads = false;
const afterTimeout = await timeoutSandbox.PPTXRoadmapTemplate.generate(data, { templateBytes: shellBytes });
assert.equal(afterTimeout.manifest.products, 4, "An export can retry after the static loading timeout.");
console.log("Native roadmap template renderer checks passed.");
