import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = (name) => readFile(new URL(`../../public/${name}`, import.meta.url), "utf8");
const [themeSource, css, fontCss, appSource, html] = await Promise.all([
  read("js/reference-theme.js"), read("css/styles.css"), read("css/fonts.css"), read("js/app.js"), read("index.html"),
]);
const applied = new Map();
const sampleWorkspace = { categories: [{ board: { products: [{ id: "mic", color: "#80958f", specs: [{ id: "source", label: "Warranty", value: "2 years" }], imageAssetId: "hero" }] } }], masterLocalBaseline: [{ source: "retained" }], plcSharePending: { patches: [{ productId: "mic" }] } };
const snapshot = JSON.stringify(sampleWorkspace);
const sandbox = { console, setTimeout, clearTimeout, setImmediate, clearImmediate, Buffer, Blob, URL, TextEncoder, TextDecoder,
  portfolio: sampleWorkspace, document: { documentElement: { style: { setProperty(name, value) { applied.set(name, value); } } } } };
vm.createContext(sandbox);
vm.runInContext(themeSource, sandbox);
const theme = sandbox.PortfolioTheme;
assert.ok(Object.isFrozen(theme) && Object.isFrozen(theme.colors));
assert.deepEqual({ ...theme.colors }, {
  page: "#1A1B1C", surface: "#242527", header: "#333538", input: "#4D5054",
  label: "#BBBCC0", text: "#F2F4F8", placeholder: "#D5D7DC", border: "#333538", borderStrong: "#676A70", controlBorder: "#83858B",
  alert: "#FF2525", alertSurface: "#331D1D", alertText: "#FF8A8A",
}, "the user's reference tones are the semantic foundation");
assert.equal(theme.fontFace, "Jost");
assert.equal(theme.cssFontFamily, '"Jost", Arial, sans-serif');
assert.deepEqual(Object.fromEntries(applied), { ...theme.cssVariables });
theme.apply();
assert.equal(JSON.stringify(sampleWorkspace), snapshot, "theme application must not change saved products, specs, images, history or pending changes");

const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1];
assert.ok(rootBlock);
const fallback = new Map([...rootBlock.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
for (const [name, value] of Object.entries(theme.cssVariables)) {
  if (fallback.has(name)) assert.equal(fallback.get(name).toUpperCase(), value.toUpperCase(), `${name} has the same CSS fallback and runtime value`);
}
const luminance = (color) => {
  const channels = color.slice(1).match(/../g).map((channel) => parseInt(channel, 16) / 255)
    .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
};
const contrast = (foreground, background) => (Math.max(luminance(foreground), luminance(background)) + .05) / (Math.min(luminance(foreground), luminance(background)) + .05);
for (const surface of [theme.colors.page, theme.colors.surface, theme.colors.header]) {
  assert.ok(contrast(theme.colors.label, surface) >= 4.5, "necessary small labels retain readable contrast");
  assert.ok(contrast(theme.colors.text, surface) >= 4.5, "values retain readable contrast");
}
assert.ok(contrast(theme.colors.text, theme.colors.input) >= 4.5);
assert.ok(contrast(theme.colors.alertText, theme.colors.alertSurface) >= 4.5);
assert.ok(contrast(theme.colors.text, theme.colors.input) >= 3, "focus outline remains visible against inputs");
assert.ok(contrast(fallback.get("--color-placeholder"), theme.colors.input) >= 4.5, "placeholder text remains readable on the lighter input surface");
assert.ok(contrast(fallback.get("--color-control-border"), theme.colors.header) >= 3, "control boundaries remain distinct on section headers");
assert.ok(/input::placeholder[^{}]*\{[^}]*var\(--color-placeholder\)/.test(css), "necessary placeholder text uses the readable placeholder tone");
assert.match(css, /:focus-visible[^}]*outline:\s*2px solid var\(--color-accent\)/);
assert.equal(fallback.get("--corner-panel"), "2px");
assert.equal(fallback.get("--corner-control"), "2px");
assert.ok(!/<aside\b[^>]*class="[^"]*sidebar/i.test(html), "the reference sidebar is not introduced");
assert.ok(html.indexOf("js/reference-theme.js") < html.indexOf("js/portfolio-model.js"));
assert.match(html, /name="theme-color" content="#1A1B1C"/);
assert.match(fontCss, /font-family:\s*"Jost"/);
for (const filename of ["Jost-Variable.ttf", "Jost-Italic-Variable.ttf"]) {
  assert.match(fontCss, new RegExp(filename.replaceAll(".", "\\.")));
  const font = await readFile(new URL(`../../public/assets/fonts/${filename}`, import.meta.url));
  assert.ok(font.length > 50000 && font.readUInt32BE(0) === 0x00010000, "each font is a shipped TrueType asset, available offline");
}
assert.match(await read("assets/fonts/Jost-OFL.txt"), /SIL OPEN FONT LICENSE Version 1\.1/);

const loads = [], fontReadyEvents = [];
let release;
const ready = new Promise((resolve) => { release = resolve; });
const loading = theme.fontsReady({ fonts: { load(font) { loads.push(font); return Promise.resolve([font]); }, ready } }).then(() => fontReadyEvents.push("complete"));
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(loads.sort(), [400, 500, 600, 700, 800].map((weight) => `${weight} 16px Jost`).sort());
assert.deepEqual(fontReadyEvents, [], "rendering waits for the font readiness gate");
release(); await loading;
assert.deepEqual(fontReadyEvents, ["complete"]);
await theme.fontsReady({});
for (const failure of [() => { throw new Error("font unavailable"); }, () => Promise.reject(new Error("network unavailable")), () => Promise.resolve([])]) {
  const fallbackCss = new Map(), fallbackSandbox = {};
  vm.createContext(fallbackSandbox); vm.runInContext(themeSource, fallbackSandbox);
  const document = { fonts: { load: failure, ready: Promise.resolve() }, documentElement: { style: { setProperty(name, value) { fallbackCss.set(name, value); } } } };
  assert.equal(await fallbackSandbox.PortfolioTheme.fontsReady(document), false, "unavailable font cannot block access to a valid saved portfolio");
  assert.equal(fallbackSandbox.PortfolioTheme.fontFace, "Arial", "canvas and PowerPoint receive the same available fallback");
  assert.equal(fallbackCss.get("--font-ui"), "Arial, sans-serif");
  fallbackSandbox.PortfolioTheme.apply(document);
  assert.equal(fallbackCss.get("--font-ui"), "Arial, sans-serif", "reapplying the theme preserves the available fallback font");
}

for (const file of ["js/portfolio-model.js", "js/card-specs.js", "js/pptx-editable.js"]) vm.runInContext(await read(file), sandbox);
for (const [statusType, accent] of [["new", "newProduct"], ["embargo", "embargo"], ["in-development", "inDevelopment"], ["sunsetting", "sunsetting"]]) {
  const product = { statusType };
  assert.equal(sandbox.PortfolioModel.productTone(product), theme.accents[accent]);
  const fill = theme.accents[accent], label = sandbox.PortfolioModel.productLabelColor(product, contrast(theme.colors.page, fill) >= contrast(theme.colors.text, fill) ? theme.colors.page : theme.colors.text);
  assert.ok(contrast(label, fill) >= 4.5, `${statusType} uses legible text on its actual banner fill`);
}

const definition = (name) => {
  const source = appSource.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, "m"))?.[0];
  assert.ok(source, `Actual application function missing: ${name}`); return source;
};
const canvas = () => {
  const result = { width: 246, height: 552 };
  const stack = [];
  const context = { canvas: result, fillStyle: "#000000", strokeStyle: "#000000", font: "10px Arial", textAlign: "left", textBaseline: "alphabetic", globalAlpha: 1, lineWidth: 1,
    save() { stack.push({ font: this.font, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, textAlign: this.textAlign, textBaseline: this.textBaseline }); }, restore() { Object.assign(this, stack.pop()); },
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }, setTransform() {},
    beginPath() {}, roundRect() {}, rect() {}, moveTo() {}, lineTo() {}, closePath() {}, arc() {}, fill() {}, stroke() {}, fillRect() {}, fillText() {}, drawImage() {},
    measureText(text) { return { width: String(text).length * 5 }; } };
  result.getContext = () => context; result.toDataURL = () => "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
  return result;
};
const microphone = { id: "mic", name: "Reference microphone", imageAssetId: "hero", color: "#526564", price: 129.99, laneId: "original-lane", partSkus: [{ id: "sku", code: "TEST123" }], specs: [
  { id: "connection", label: "Connection", value: "USB-C" }, { id: "quality", label: "Record quality", value: "24-bit / 96kHz (USB mode only)" },
  { id: "capsule", label: "Capsule type", value: "Condenser capsule" }, { id: "pattern", label: "Polar pattern", value: "Cardioid" },
  { id: "monitor", label: "Monitor", value: "Yes" }, { id: "mute", label: "Tap-to-mute", value: "Yes" },
  { id: "warranty", label: "Warranty", value: "2 years" }, { id: "platform", label: "Platform", value: "PC / Mac" },
] };
const productBefore = JSON.stringify(microphone);
Object.assign(sandbox, { UI_PALETTE: theme.uiPalette, UI_FONT_FACE: theme.fontFace,
  CARD_WIDTH: 246, STATUS_BANNER_HEIGHT: 24, INFO_BUTTON_WIDTH: 54, activeCategoryId: "microphones", board: { settings: { showPrices: true, showSkus: true } },
  productPresentation: () => ({ primaryLabel: "", secondaryLabel: "" }), productImageSource: (product) => product.imageAssetId,
  loadImage: () => ({ ready: true, image: { width: 100, height: 100 } }), drawContainedImage: (context, image, x, y, width, height) => context.drawImage(image, x, y, width, height),
  drawSpecIcon() {}, drawProductInfoButton() {}, variantFooterLayout: () => ({ height: 32 }), drawVariantFooter(context, product, x, y) { context.font = `700 9px ${theme.fontFace}`; context.fillStyle = theme.colors.label; context.fillText(product.partSkus[0].code, x + 20, y + 18); },
});
sandbox.document.createElement = (tag) => { assert.equal(tag, "canvas"); return canvas(); };
vm.runInContext(["roundRect", "wrapText", "productCardTitle", "cardSpecifications", "productPriceText", "normalizedSpecLabel", "detailedValueLineCount", "isDetailedMatrixSpec", "isDetailedPairCandidate", "detailedSpecRows", "detailedSpecRowHeight", "detailedValueColor", "drawDetailedSpecLabel", "drawDetailedSpecs", "drawDetailedFamilyHeaders", "drawCard", "recordCardElementsForPptx", "containRect", "addPptxPortfolioSlide"].map(definition).join("\n"), sandbox);
const familyLabels = [], familyContext = canvas().getContext("2d");
familyContext.fillText = (text) => familyLabels.push({ text, color: familyContext.fillStyle });
sandbox.cardXForDisplayIndex = (_products, index) => 20 + index * 264;
sandbox.inferFamily = () => "Studio";
sandbox.drawDetailedFamilyHeaders(familyContext, [{ name: "Microphone", roadmap: { family: "Studio" } }], 34);
assert.deepEqual(familyLabels, [{ text: "STUDIO", color: theme.colors.label }], "product family labels remain readable beside the preserved lane separation");
assert.ok(contrast(familyLabels[0].color, theme.colors.page) >= 4.5);
const layout = { cardHeight: 552, imageSlotTop: 34, imageSlotHeight: 112, titleBlockTop: 152, priceBaselineOffset: 53, detailsTopOffset: 66, detailed: false, categoryId: "microphones" };
const rows = sandbox.cardSpecifications(microphone, "microphones");
assert.equal(rows.length, 5);
assert.ok(!rows.some((row) => /warranty|platform/i.test(row.label)));
const elements = sandbox.recordCardElementsForPptx(canvas(), microphone, layout);
const texts = elements.filter((element) => element.kind === "text");
assert.ok(texts.every((element) => element.fontFace === theme.fontFace));
assert.ok(texts.some((element) => element.text === "Reference microphone" && element.color === theme.colors.text));
assert.ok(texts.some((element) => element.text === "USB-C" && element.color === theme.colors.text), "front values use the bright reference value tone");
assert.ok(texts.some((element) => element.text.includes("USB mode only")), "technical conditions remain visible");
assert.ok(texts.some((element) => element.text === "TEST123"));
assert.ok(elements.some((element) => element.kind === "image"), "product artwork remains a separate export object");
assert.ok(elements.some((element) => element.kind === "shape" && element.fill === theme.colors.surface));
const cardPanels = elements.filter((element) => element.kind === "shape" && element.width === 246 && element.height === 552);
assert.equal(cardPanels.length, 1, "the unselected card is one filled panel rather than repeated frames");
assert.ok(!elements.some((element) => element.kind === "shape" && (element.lineWidth > 0 || element.shape === "line")), "unselected cards and specification rows have no decorative strokes");
for (const detailed of [false, true]) {
  const context = canvas().getContext("2d"), strokes = [];
  context.stroke = () => strokes.push({ color: context.strokeStyle, width: context.lineWidth });
  sandbox.drawCard(context, microphone, 0, 0, false, { ...layout, detailed }, false);
  assert.deepEqual(strokes, [], "compact and detailed unselected cards use spacing without row rules or outer frames");
  sandbox.drawCard(context, microphone, 0, 0, true, { ...layout, detailed }, false);
  assert.deepEqual(strokes, [{ color: theme.colors.text, width: 1.25 }], "the selected product retains one clear outline in both layouts");
}
assert.equal(JSON.stringify(microphone), productBefore, "rendering never rewrites full specifications, lane, product color, image or SKU bindings");

vm.runInContext(await read("vendor/pptxgen.bundle.js"), sandbox, { timeout: 5000 });
const deck = new sandbox.PptxGenJS(); deck.layout = "LAYOUT_WIDE";
assert.ok(/pptx\.theme = \{ headFontFace: UI_FONT_FACE, bodyFontFace: UI_FONT_FACE, lang: "en-US" \}/.test(appSource), "new PowerPoint text inherits the same resolved presentation font");
deck.theme = { headFontFace: theme.fontFace, bodyFontFace: theme.fontFace, lang: "en-US" };
sandbox.addPptxPortfolioSlide(deck, "Microphones", { data: canvas().toDataURL(), width: 700, height: 800, products: [{ kind: "card", id: microphone.id, name: microphone.name, x: 10, y: 10, width: 246, height: 552, elements }] });
const bytes = await sandbox.PPTXEditable.serialize(deck);
const archive = await sandbox.JSZip.loadAsync(bytes, { checkCRC32: true });
const slide = await archive.file("ppt/slides/slide1.xml").async("string");
assert.match(slide, /<p:grpSp>/, "a product remains an editable group");
const nativeCardGroup = slide.match(/<p:grpSp>[\s\S]*?<\/p:grpSp>/)?.[0];
const nativeCardLines = [...nativeCardGroup.matchAll(/<a:ln\b[^>]*>[\s\S]*?<\/a:ln>/g)].map((match) => match[0]);
assert.ok(nativeCardLines.every((line) => /^<a:ln>\s*<\/a:ln>$/.test(line) || /<a:noFill\s*\/?>|<a:alpha\b[^>]*\bval="0"/.test(line)), `the delivered editable card group has no visible decorative perimeter or row rules: ${nativeCardLines.join(" | ")}`);
assert.ok(slide.includes('<a:latin typeface="Jost"'), "actual PPTX native text retains the shared font");
assert.ok(slide.includes('<a:srgbClr val="1A1B1C"') && slide.includes('<a:srgbClr val="242527"') && slide.includes('<a:srgbClr val="F2F4F8"'));
assert.ok(slide.includes("<a:t>USB-C</a:t>") && slide.includes("<a:t>TEST123</a:t>") && slide.includes("<p:pic>"));
const declarations = [...(await archive.file("[Content_Types].xml").async("string")).matchAll(/PartName="([^"]+)"/g)].map((match) => match[1].slice(1));
assert.ok(declarations.every((part) => archive.file(part)), "the actual serializer emits no missing declared presentation parts");
const exportedTheme = await archive.file("ppt/theme/theme1.xml").async("string");
assert.ok(exportedTheme.includes('<a:majorFont><a:latin typeface="Jost"') && exportedTheme.includes('<a:minorFont><a:latin typeface="Jost"'), "new native text and existing cards share Jost in the delivered theme");
assert.equal(JSON.stringify(microphone), productBefore);
console.log("Reference theme checks passed: shared reference tones, readable labels/values/controls, local licensed Jost, font readiness and failure fallback, immutable data, five relevant microphone features, retained images, and actual grouped editable PowerPoint font/color parity.");
