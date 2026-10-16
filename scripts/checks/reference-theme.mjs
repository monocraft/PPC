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
  label: "#BBBCC0", text: "#D5D7DC", placeholder: "#D5D7DC", border: "#333538", borderStrong: "#676A70", controlBorder: "#83858B",
  alert: "#FF2525", alertSurface: "#331D1D", alertText: "#FF8A8A",
}, "the user's reference tones are the semantic foundation");
assert.equal(theme.fontFace, "Jost");
assert.equal(theme.cssFontFamily, '"Jost", Arial, sans-serif');
assert.deepEqual(Object.fromEntries(applied), { ...theme.cssVariables });

const expectedChartPalette = {
  purple: { 20: "#D5C9FA", 40: "#AA8DF9", 80: "#6338E0", 100: "#433276" },
  indigo: { 20: "#C4CEF9", 40: "#879DF1", 80: "#4362D4", 100: "#313E9C" },
  blue: { 20: "#A3E0FC", 40: "#63C0F9", 80: "#3C8AEC", 100: "#2B5AAC" },
  teal: { 20: "#B9F4F2", 40: "#82EBF1", 80: "#0391A9", 100: "#005D6F" },
  green: { 20: "#B9F8DD", 40: "#85F0B8", 80: "#5BC794", 100: "#508D7B" },
  yellow: { 20: "#FFEAB5", 40: "#FFD569", 80: "#FFB420", 100: "#CE8C4F" },
};
const expectedChartSeries = ["#895EF6", "#6984ED", "#4DA1F7", "#20CBDD", "#7AE3A9", "#FFC63B"];
assert.deepEqual(JSON.parse(JSON.stringify(theme.chartPalette)), expectedChartPalette, "the secondary chart tones preserve the supplied image samples");
assert.deepEqual([...theme.chartSeries], expectedChartSeries, "the six bright reference cards retain stable series order");
assert.ok(Object.isFrozen(theme.chartPalette) && Object.isFrozen(theme.chartSeries));
for (const [name, tones] of Object.entries(expectedChartPalette)) {
  assert.ok(Object.isFrozen(theme.chartPalette[name]), `${name} tones cannot be rewritten by a chart`);
  for (const [tone, value] of Object.entries(tones)) {
    assert.equal(theme.cssVariables[`--chart-${name}-${tone}`], value);
    assert.equal(applied.get(`--chart-${name}-${tone}`), value, "the runtime applies each secondary tone token");
  }
}
expectedChartSeries.forEach((value, index) => {
  assert.equal(theme.cssVariables[`--chart-series-${index + 1}`], value);
  assert.equal(applied.get(`--chart-series-${index + 1}`), value, "the runtime applies each ordered chart series token");
});
for (const mutation of [
  'PortfolioTheme.chartPalette.purple[80] = "#000000";',
  'PortfolioTheme.chartPalette.blue = {};',
  'PortfolioTheme.chartSeries[0] = "#000000";',
  'PortfolioTheme.chartSeries.push("#000000");',
]) assert.throws(() => vm.runInContext(`"use strict"; ${mutation}`, sandbox), (error) => error.name === "TypeError", "chart consumers cannot change the shared palette");
const preservedCssVariables = {
  "--color-page": "#1A1B1C", "--color-shell": "#242527", "--color-surface": "#242527",
  "--color-surface-raised": "#333538", "--color-header": "#333538", "--color-input": "#4D5054",
  "--color-surface-hover": "#333538", "--color-border": "#333538", "--color-border-strong": "#676A70",
  "--color-control-border": "#83858B", "--color-placeholder": "#D5D7DC",
  "--color-text": "#D5D7DC", "--color-text-secondary": "#BBBCC0", "--color-text-muted": "#BBBCC0",
  "--color-accent": "#D5D7DC", "--color-on-accent": "#1A1B1C", "--color-emphasis": "#BBBCC0",
  "--color-emphasis-deep": "#676A70", "--color-selection": "#D5D7DC",
  "--color-new-product": "#BBBCC0", "--color-embargo": "#FF2525",
  "--color-danger": "#FF2525", "--color-danger-surface": "#331D1D",
  "--color-danger-border": "#FF2525", "--color-danger-text": "#FF8A8A",
  "--color-planning": "#BBBCC0", "--workspace-surface": "#1A1B1C",
  "--color-stage-launched": "#4D5054", "--color-stage-development": "#56595E",
  "--color-stage-planning": "#333538", "--color-status-sunsetting": "#4D5054",
  "--font-ui": '"Jost", Arial, sans-serif',
};
assert.deepEqual(Object.fromEntries(Object.entries(theme.cssVariables).filter(([name]) => !name.startsWith("--chart-"))), preservedCssVariables, "adding chart tokens preserves every existing UI and presentation token");
assert.deepEqual({ ...theme.uiPalette }, {
  trueBlack: "#1A1B1C", inkBlack: "#1A1B1C", carbon: "#242527", jetBlack: "#333538",
  gunmetal: "#4D5054", greyOlive: "#BBBCC0", silver: "#BBBCC0", whiteSmoke: "#D5D7DC",
  amaranth: "#FF2525", charcoal900: "#1A1B1C", charcoal800: "#1A1B1C",
  charcoal700: "#333538", charcoal600: "#333538", charcoal500: "#4D5054",
  indigoDark: "#242527", indigo: "#333538", steelTeal: "#676A70",
  steelTealLight: "#BBBCC0", midGrey: "#BBBCC0", foggyDark: "#333538",
  foggy: "#BBBCC0", starDust: "#D5D7DC", selection: "#D5D7DC",
}, "the secondary chart palette never redefines legacy UI palette names");
assert.deepEqual({ ...theme.stageColors }, { launched: "#4D5054", "in-development": "#56595E", "in-planning": "#333538" });
assert.deepEqual({ ...theme.accents }, { newProduct: "#BBBCC0", embargo: "#FF2525", inDevelopment: "#56595E", sunsetting: "#4D5054" });
assert.deepEqual({ ...theme.lifecycleTones }, { launched: "#4D5054", "in-development": "#56595E", "in-planning": "#333538", embargo: "#FF2525", "end-of-life": "#242527" });
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
for (const series of theme.chartSeries) assert.ok(contrast(series, theme.colors.page) >= 3 && contrast(series, theme.colors.surface) >= 3, "the main reference colors remain distinguishable on dark chart surfaces");
assert.ok(Object.isFrozen(theme.productCardStyles));
for (const [stage, accent] of [["in-planning", "#FFC63B"], ["in-development", "#4DA1F7"]]) {
  const style = theme.productCardStyles[stage];
  assert.ok(Object.isFrozen(style)); assert.equal(style.accent, accent);
  for (const surface of [style.surface, style.footer]) {
    assert.ok(contrast(theme.colors.text, surface) >= 4.5, "stage card text stays readable across body and footer shades");
    assert.ok(contrast(style.muted, surface) >= 4.5, "stage card accents stay readable");
  }
  assert.ok(contrast(theme.colors.page, accent) >= 4.5, "bright stage banners support dark labels");
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
  assert.equal(fallbackSandbox.PortfolioTheme.fontFace, "Arial", "the website can fall back without changing the independent PowerPoint font policy");
  assert.equal(fallbackCss.get("--font-ui"), "Arial, sans-serif");
  fallbackSandbox.PortfolioTheme.apply(document);
  assert.equal(fallbackCss.get("--font-ui"), "Arial, sans-serif", "reapplying the theme preserves the available fallback font");
}

for (const file of ["js/portfolio-model.js", "js/card-specs.js", "js/pptx-editable.js"]) vm.runInContext(await read(file), sandbox);
const pptxFont = "HP Forma DJR Office";
assert.equal(sandbox.PPTXEditable.FONT_FACE, pptxFont, "all PowerPoint exports use the supplied HP family");
assert.equal(theme.fontFace, "Jost", "the PowerPoint-only font change preserves the website font");
const hpFontLoads = [];
sandbox.document.fonts = { load(font) { hpFontLoads.push(font); return Promise.resolve([font]); }, check(font) { return font === `400 16px "${pptxFont}"`; } };
assert.equal(await sandbox.PPTXEditable.fontsReady(), true);
assert.deepEqual(hpFontLoads.sort(), [400, 500, 700].map(weight => `${weight} 16px "${pptxFont}"`).sort(), "native export measurements wait for the installed HP faces");
assert.equal(theme.fontFace, "Jost");
const missingHpSandbox = { document: { fonts: { load: () => Promise.reject(new Error("HP face is not installed")), check: () => false } }, PortfolioTheme: theme };
vm.createContext(missingHpSandbox); vm.runInContext(await read("js/pptx-editable.js"), missingHpSandbox);
assert.equal(await missingHpSandbox.PPTXEditable.fontsReady(), false, "a missing HP font is reported as unavailable instead of claiming exact HP metrics");
assert.equal(missingHpSandbox.PPTXEditable.FONT_FACE, pptxFont, "PowerPoint never switches its declared font to the website fallback");
assert.equal(theme.fontFace, "Jost", "HP availability checking leaves normal product browsing unchanged");
for (const filename of ["HPFormaDJROffice-Regular", "HPFormaDJROffice-Bold", "HPFormaDJROffice-Italic", "HPFormaDJROffice-BoldItalic", "HPFormaDJROffice-Medium", "HPFormaDJROffice-MediumItalic"]) {
  assert.ok(fontCss.includes(`local("${filename}")`), "the user's installed HP Office faces are referenced locally");
}
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
assert.ok(texts.every((element) => element.fontFace === theme.fontFace), "ordinary website recording retains Jost; native export applies its separate HP policy");
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

const neutralPresentation = sandbox.productPresentation;
for (const [stage, cardStyle] of Object.entries(theme.productCardStyles)) {
  sandbox.productPresentation = () => ({ primaryLabel: stage, primaryColor: cardStyle.accent, secondaryLabel: "", cardStyle });
  sandbox.contrastTextColor = () => theme.colors.page;
  const recorded = sandbox.recordCardElementsForPptx(canvas(), microphone, layout);
  assert.ok(recorded.some(element => element.kind === "shape" && element.fill?.toUpperCase() === cardStyle.surface), "editable card recording includes the opaque stage surface");
  assert.ok(recorded.some(element => element.kind === "shape" && element.fill?.toUpperCase() === cardStyle.accent), "editable card recording includes the stage banner");
  assert.ok(recorded.some(element => element.kind === "text" && element.text === "Reference microphone"), "colored cards retain editable product names");
  assert.ok(recorded.some(element => element.kind === "image"), "colored cards retain separate product artwork");
}
sandbox.productPresentation = neutralPresentation;

vm.runInContext(await read("vendor/pptxgen.bundle.js"), sandbox, { timeout: 5000 });
const deck = new sandbox.PptxGenJS(); deck.layout = "LAYOUT_WIDE";
assert.ok(/pptx\.theme = \{ headFontFace: UI_FONT_FACE, bodyFontFace: UI_FONT_FACE, lang: "en-US" \}/.test(appSource), "new PowerPoint text inherits the same resolved presentation font");
assert.ok(appSource.includes("UI_FONT_FACE = PPTXEditable.FONT_FACE;") && appSource.includes("UI_FONT_FACE = previousUiFontFace;"), "PowerPoint planning/recording uses HP and restores the previous website font");
deck.theme = { headFontFace: pptxFont, bodyFontFace: pptxFont, lang: "en-US" };
const nativeSlide = sandbox.addPptxPortfolioSlide(deck, "Microphones", { data: canvas().toDataURL(), width: 700, height: 800, products: [{ kind: "card", id: microphone.id, name: microphone.name, x: 10, y: 10, width: 246, height: 552, elements }] });
nativeSlide.addNotes("PowerPoint-only font verification");
const bytes = await sandbox.PPTXEditable.serialize(deck);
const archive = await sandbox.JSZip.loadAsync(bytes, { checkCRC32: true });
const slide = await archive.file("ppt/slides/slide1.xml").async("string");
assert.match(slide, /<p:grpSp>/, "a product remains an editable group");
const nativeCardGroup = slide.match(/<p:grpSp>[\s\S]*?<\/p:grpSp>/)?.[0];
const nativeCardLines = [...nativeCardGroup.matchAll(/<a:ln\b[^>]*>[\s\S]*?<\/a:ln>/g)].map((match) => match[0]);
assert.ok(nativeCardLines.every((line) => /^<a:ln>\s*<\/a:ln>$/.test(line) || /<a:noFill\s*\/?>|<a:alpha\b[^>]*\bval="0"/.test(line)), `the delivered editable card group has no visible decorative perimeter or row rules: ${nativeCardLines.join(" | ")}`);
assert.ok(slide.includes(`<a:latin typeface="${pptxFont}"`), "actual PPTX native text uses HP while website font remains Jost");
assert.ok(slide.includes('<a:srgbClr val="1A1B1C"') && slide.includes('<a:srgbClr val="242527"') && slide.includes('<a:srgbClr val="D5D7DC"'));
assert.ok(slide.includes("<a:t>USB-C</a:t>") && slide.includes("<a:t>TEST123</a:t>") && slide.includes("<p:pic>"));
const declarations = [...(await archive.file("[Content_Types].xml").async("string")).matchAll(/PartName="([^"]+)"/g)].map((match) => match[1].slice(1));
assert.ok(declarations.every((part) => archive.file(part)), "the actual serializer emits no missing declared presentation parts");
const exportedTheme = await archive.file("ppt/theme/theme1.xml").async("string");
assert.ok(exportedTheme.includes(`<a:majorFont><a:latin typeface="${pptxFont}"`) && exportedTheme.includes(`<a:minorFont><a:latin typeface="${pptxFont}"`), "new native text inherits HP in the delivered theme");
const allowedPptxFonts = new Set([pptxFont, `${pptxFont} Medium`]);
for (const filename of Object.keys(archive.files).filter(name => name.startsWith("ppt/") && name.endsWith(".xml"))) {
  const xml = await archive.file(filename).async("string");
  const faces = [...xml.matchAll(/<a:(?:latin|ea|cs|font|sym|buFont)\b[^>]*\btypeface="([^"]*)"/g)].map(match => match[1]);
  assert.ok(faces.every(face => allowedPptxFonts.has(face)), `${filename} has only HP fonts, including master bullets, notes and unused defaults`);
}
assert.equal(theme.fontFace, "Jost");
assert.equal(sandbox.UI_FONT_FACE, "Jost", "native serialization does not alter the website's font state");
assert.equal(JSON.stringify(microphone), productBefore);
console.log("Reference theme checks passed: readable reference tones, website Jost/readiness/fallback, independent installed HP PowerPoint font readiness and every native slide/theme/master/notes font, immutable data, five relevant microphone features, retained images and grouped editable export color parity.");
