import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

await import("../../public/js/pptx-pagination.js");

const {
  MAX_PRODUCTS_PER_SLIDE,
  selectExportCategories,
  paginateRoadmapGroups,
} = globalThis.PPTXPagination;

assert.equal(MAX_PRODUCTS_PER_SLIDE, 22);

const expectedPageSizes = new Map([
  [0, [0]],
  [1, [1]],
  [22, [22]],
  [23, [22, 1]],
  [44, [22, 22]],
  [45, [22, 22, 1]],
]);

for (const [productCount, expected] of expectedPageSizes) {
  const products = Array.from({ length: productCount }, (_, index) => ({ id: `p-${index + 1}` }));
  const pages = paginateRoadmapGroups([{ family: "Boundary", products }]);
  const pageSizes = pages.map((page) => page.reduce((sum, group) => sum + group.products.length, 0));
  assert.deepEqual(pageSizes, expected, `Unexpected page sizes for ${productCount} products.`);
  assert.deepEqual(
    pages.flatMap((page) => page.flatMap((group) => group.products.map((product) => product.id))),
    products.map((product) => product.id),
  );
  assert.ok(pageSizes.every((size) => size <= MAX_PRODUCTS_PER_SLIDE));
}

const longFamilyProducts = Array.from({ length: 30 }, (_, index) => ({ id: `long-${index + 1}` }));
const secondFamilyProducts = Array.from({ length: 15 }, (_, index) => ({ id: `second-${index + 1}` }));
const sourceGroups = [
  { family: "Long Family", products: longFamilyProducts },
  { family: "Second Family", products: secondFamilyProducts },
];
const roadmapPages = paginateRoadmapGroups(sourceGroups);

assert.deepEqual(
  roadmapPages.map((page) => page.reduce((sum, group) => sum + group.products.length, 0)),
  [22, 8, 15],
);
assert.deepEqual(
  roadmapPages.map((page) => page.map((group) => `${group.family}:${group.continued}:${group.products.length}`)),
  [
    ["Long Family:false:22"],
    ["Long Family:true:8"],
    ["Second Family:false:15"],
  ],
);
assert.deepEqual(
  roadmapPages.flatMap((page) => page.flatMap((group) => group.products.map((product) => product.id))),
  [...longFamilyProducts, ...secondFamilyProducts].map((product) => product.id),
);
assert.equal(sourceGroups[0].continued, undefined);
assert.equal(sourceGroups[0].products.length, 30);
assert.deepEqual(paginateRoadmapGroups([]), [[]]);

const intactFamilies = paginateRoadmapGroups([
  { family: "First", products: Array.from({ length: 18 }, (_, index) => ({ id: `first-${index}` })) },
  { family: "Second", products: Array.from({ length: 10 }, (_, index) => ({ id: `second-${index}` })) },
]);
assert.deepEqual(
  intactFamilies.map((page) => page.map((group) => `${group.family}:${group.continued}:${group.products.length}`)),
  [["First:false:18"], ["Second:false:10"]],
);

const exportCategories = [
  { id: "alpha", name: "Audio 2", board: { products: [...longFamilyProducts.map((product) => ({ ...product, family: "Long Family" })), ...secondFamilyProducts.map((product) => ({ ...product, family: "Second Family" }))] } },
  { id: "beta", name: "Console <limited>", board: { products: [{ id: "console-1", family: "Cloud" }, { id: "console-2", family: "Cloud" }] } },
  { id: "empty", name: "Empty", board: { products: [] } },
  { id: "unavailable", name: "No board" },
];
const sourceCategoriesBefore = JSON.stringify(exportCategories);
assert.deepEqual(selectExportCategories(exportCategories).map((category) => category.id), ["alpha", "beta", "empty"], "the default includes all categories with a board");
assert.deepEqual(selectExportCategories(exportCategories, ["beta", "alpha", "stale", "alpha"]).map((category) => category.id), ["alpha", "beta"], "selection retains portfolio order without duplicate or stale categories");
assert.deepEqual(selectExportCategories(exportCategories, []), [], "clearing every checkbox selects no categories");
assert.deepEqual(selectExportCategories(exportCategories, ["unavailable"]), [], "a category without a board cannot be exported");
assert.deepEqual(selectExportCategories(undefined), []);
assert.equal(selectExportCategories(exportCategories, ["alpha"])[0], exportCategories[0], "selection does not replace category records");
assert.equal(JSON.stringify(exportCategories), sourceCategoriesBefore);

// Use the real application selection, summary, planning, and slide composer.
// The adapters replace DOM and file/image delivery, not export decisions.
const appSource = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
const sectionStart = appSource.indexOf("function addPptxPortfolioSlide(");
const sectionEnd = appSource.indexOf("function exportPng(", sectionStart);
assert.ok(sectionStart >= 0 && sectionEnd > sectionStart);
let selectedScope = "both";
const categoryInputs = exportCategories.filter((category) => category.board).map((category) => ({ value: category.id, checked: true }));
const exportControls = new Map(["pptxExportCategories", "pptxExportCategoryCount", "pptxExportSlideCount", "pptxSelectAllCategories", "pptxExportSelectionHint"].map((id) => [`#${id}`, { textContent: "", innerHTML: "" }]));
const hintClasses = new Set();
exportControls.get("#pptxExportSelectionHint").classList = { toggle(name, enabled) { if (enabled) hintClasses.add(name); else hintClasses.delete(name); } };
const decks = [];
const renderCalls = [];
class RecordingPptx {
  constructor() {
    this.slides = [];
    this.ShapeType = { line: "line" };
    decks.push(this);
  }
  addSlide() {
    const slide = { texts: [], shapes: [], images: [],
      addText(text, options) { this.texts.push({ text, options }); },
      addShape(type, options) { this.shapes.push({ type, options }); },
      addImage(options) { this.images.push(options); },
    };
    this.slides.push(slide);
    return slide;
  }
  async writeFile({ fileName }) { this.fileName = fileName; }
}
function recordImage(kind, category, groups = null) {
  renderCalls.push({ kind, categoryId: category.id, productIds: Array.from(groups ? groups.flatMap((group) => group.products) : category.board.products, (product) => product.id) });
  return kind === "products" ? { data: `${kind}:${category.id}`, width: 1200, height: 600 } : { data: `${kind}:${category.id}`, width: 800, height: 1600 };
}
const sandbox = {
  PPTXPagination: globalThis.PPTXPagination, paginateRoadmapGroupsForPptx: paginateRoadmapGroups,
  portfolio: { categories: exportCategories }, pptxSelectedCategoryIds: null, pptxExportInProgress: false,
  pptxExportDialog: { classList: { add() {}, remove() {} } }, confirmPptxExportButton: { disabled: false },
  pptxExportForm: {
    querySelector: () => ({ value: selectedScope }),
    querySelectorAll: (selector) => selector.includes(":checked") ? categoryInputs.filter((input) => input.checked) : categoryInputs,
  },
  $: (selector) => exportControls.get(selector),
  escapeHtml: (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]),
  categoryDefinition: (id) => ({ id }), ensureBoardSchema: (board) => board,
  roadmapGroupsForProducts: (products) => [...new Set(products.map((product) => product.family))].map((family) => ({ family, products: products.filter((product) => product.family === family) })),
  closePopupMenus() {}, renderActiveView() {}, PptxGenJS: RecordingPptx,
  renderCategoryImageForPptx: async (category) => recordImage("products", category),
  renderCategoryRoadmapImageForPptx: async (category, groups) => recordImage("roadmap", category, groups),
};
vm.createContext(sandbox);
vm.runInContext(appSource.slice(sectionStart, sectionEnd), sandbox);
sandbox.renderPptxExportCategories();
assert.ok(exportControls.get("#pptxExportCategories").innerHTML.includes("Console &lt;limited&gt;"), "category picker safely displays saved names");
assert.ok(!exportControls.get("#pptxExportCategories").innerHTML.includes('value="unavailable"'));
for (const [scope, expectedSlides] of [["products", 2], ["roadmap", 4], ["both", 6]]) {
  selectedScope = scope;
  sandbox.setPptxCategorySelection(["beta", "alpha", "stale"]);
  assert.equal(exportControls.get("#pptxExportCategoryCount").textContent, "2");
  assert.equal(exportControls.get("#pptxExportSlideCount").textContent, String(expectedSlides), "preview counts use selected categories and paginated scope");
  assert.equal(exportControls.get("#pptxExportSelectionHint").textContent, "2 of 3 categories selected");
  assert.equal(sandbox.confirmPptxExportButton.disabled, false);
  assert.deepEqual(Array.from(sandbox.pptxExportCategories(), (category) => category.id), ["alpha", "beta"]);
}
sandbox.renderPptxExportCategories();
assert.ok(exportControls.get("#pptxExportCategories").innerHTML.includes('value="alpha" checked'));
assert.ok(!exportControls.get("#pptxExportCategories").innerHTML.includes('value="empty" checked'), "reopening retains a partial category selection");
sandbox.setPptxCategorySelection(["alpha", "beta", "empty"]);
assert.equal(sandbox.pptxSelectedCategoryIds, null, "selecting every available category retains the default all selection");
assert.equal(exportControls.get("#pptxSelectAllCategories").textContent, "Clear selection");
sandbox.setPptxCategorySelection([]);
assert.equal(exportControls.get("#pptxExportCategoryCount").textContent, "0");
assert.equal(exportControls.get("#pptxExportSlideCount").textContent, "0");
assert.equal(sandbox.confirmPptxExportButton.disabled, true, "empty selection cannot be submitted");
assert.equal(exportControls.get("#pptxExportSelectionHint").textContent, "Select at least one category to export.");
assert.ok(hintClasses.has("is-empty"));
// An empty selection disables Export, while Cancel still closes the modal,
// releases its background, and returns keyboard focus to the invoking control.
const modalClasses = new Set(["hidden"]);
const appShell = { inert: false };
const emptyWorkspace = { inert: false };
let returnedFocus = 0;
let scopeFocus = 0;
const originalControl = { isConnected: true, focus: () => { returnedFocus += 1; } };
exportControls.set("#workspaceEmpty", emptyWorkspace);
sandbox.pptxExportDialog.classList = { add: (name) => modalClasses.add(name), remove: (name) => modalClasses.delete(name), contains: (name) => modalClasses.has(name) };
sandbox.document = { activeElement: originalControl, querySelector: (selector) => selector === ".app-shell" ? appShell : null };
sandbox.requestAnimationFrame = (callback) => callback();
sandbox.pptxReturnFocus = null;
sandbox.pptxExportForm.querySelector = () => ({ value: selectedScope, focus: () => { scopeFocus += 1; } });
sandbox.openPptxExportDialog();
assert.equal(sandbox.confirmPptxExportButton.disabled, true);
assert.equal(modalClasses.has("hidden"), false);
assert.equal(appShell.inert, true);
assert.equal(emptyWorkspace.inert, true);
assert.equal(scopeFocus, 1);
sandbox.closePptxExportDialog();
assert.equal(modalClasses.has("hidden"), true, "Cancel works even when no categories are selected");
assert.equal(appShell.inert, false);
assert.equal(emptyWorkspace.inert, false);
assert.equal(returnedFocus, 1);
sandbox.closePptxExportDialog();
assert.equal(returnedFocus, 1, "closing an already closed chooser does not steal focus again");
sandbox.openPptxExportDialog();
sandbox.pptxExportInProgress = true;
sandbox.closePptxExportDialog();
assert.equal(modalClasses.has("hidden"), false, "an active file export keeps its chooser open");
assert.equal(appShell.inert, true);
sandbox.pptxExportInProgress = false;
sandbox.closePptxExportDialog();
assert.equal(returnedFocus, 2);
assert.equal(appShell.inert, false);
sandbox.setPptxCategorySelection(["beta"]);
sandbox.pptxExportInProgress = true;
sandbox.syncPptxExportSummary();
assert.equal(sandbox.confirmPptxExportButton.disabled, true, "changing scope cannot reenable an export in progress");
assert.ok(!hintClasses.has("is-empty"), "export progress does not mark a valid category selection as empty");
sandbox.pptxExportInProgress = false;

for (const [scope, expectedKinds, expectedFilename] of [
  ["products", ["products:alpha", "products:beta"], "product-portfolio.pptx"],
  ["roadmap", ["roadmap:alpha", "roadmap:alpha", "roadmap:alpha", "roadmap:beta"], "product-roadmaps.pptx"],
  ["both", ["products:alpha", "roadmap:alpha", "roadmap:alpha", "roadmap:alpha", "products:beta", "roadmap:beta"], "product-portfolio-and-roadmaps.pptx"],
]) {
  renderCalls.length = 0;
  await sandbox.exportPptx(scope, ["beta", "alpha", "stale", "alpha"]);
  const deck = decks.at(-1);
  assert.deepEqual(renderCalls.map((call) => `${call.kind}:${call.categoryId}`), expectedKinds, "the actual export renders only chosen categories in portfolio order");
  assert.equal(deck.slides.length, expectedKinds.length);
  assert.equal(deck.fileName, expectedFilename);
  for (const category of exportCategories.slice(0, 2)) {
    for (const kind of ["products", "roadmap"].filter((kind) => scope === "both" || scope === kind)) {
      assert.deepEqual(renderCalls.filter((call) => call.categoryId === category.id && call.kind === kind).flatMap((call) => call.productIds), category.board.products.map((product) => product.id), "pagination/export preserves every selected product exactly once per view");
    }
  }
  deck.slides.forEach((slide, index) => {
    const call = renderCalls[index];
    const category = exportCategories.find((item) => item.id === call.categoryId);
    const previousSameRoadmap = call.kind === "roadmap" && renderCalls.slice(0, index).some((earlier) => earlier.kind === call.kind && earlier.categoryId === call.categoryId);
    assert.equal(slide.texts.length, 1, "slide chrome has one title and no page counter");
    assert.equal(slide.texts[0].text, `${category.name} — ${call.kind === "products" ? "Product Portfolio" : "Roadmap"}${previousSameRoadmap ? " (continued)" : ""}`, "continuation titles retain user content without numeric pagination");
    assert.equal(slide.background.color, "171717");
    assert.equal(slide.shapes.length, 1);
    assert.deepEqual(structuredClone(slide.shapes[0].options.line), { color: "2B2E2B", width: .4, transparency: 25 }, "slide divider remains faint");
    assert.equal(slide.images.length, 1);
    const image = slide.images[0];
    assert.equal(image.data, `${call.kind}:${call.categoryId}`);
    assert.ok(image.x >= .38 && image.y >= .74 && image.x + image.w <= 12.93 + 1e-8 && image.y + image.h <= 7.07 + 1e-8, "wide/tall exported images fit within the slide content area");
    assert.ok(Math.abs(image.w / image.h - (call.kind === "products" ? 2 : .5)) < 1e-8, "slide composition preserves image proportions");
  });
}
const deckCountBeforeEmpty = decks.length;
renderCalls.length = 0;
await assert.rejects(sandbox.exportPptx("both", []), /Select at least one category/);
await assert.rejects(sandbox.exportPptx("products", ["stale"]), /Select at least one category/);
assert.equal(decks.length, deckCountBeforeEmpty, "empty or stale selections never create a PowerPoint file");
assert.deepEqual(renderCalls, []);
await sandbox.exportPptx("products");
assert.deepEqual(renderCalls.map((call) => call.categoryId), ["alpha", "beta", "empty"], "the API's default still exports all available categories");
assert.equal(JSON.stringify(exportCategories), sourceCategoriesBefore, "selection/planning never deletes or reorders saved category data");

// Serialize a real slide through the shipped library, then inspect its actual
// OOXML and image payload with the same bundle's ZIP reader.
const librarySandbox = { console, setTimeout, clearTimeout, setImmediate, clearImmediate, Buffer, Blob, URL, TextEncoder, TextDecoder };
vm.createContext(librarySandbox);
vm.runInContext(await readFile(new URL("../../public/vendor/pptxgen.bundle.js", import.meta.url), "utf8"), librarySandbox, { timeout: 5000 });
assert.equal(typeof librarySandbox.PptxGenJS, "function");
assert.equal(typeof librarySandbox.JSZip.loadAsync, "function");
const realPptx = new librarySandbox.PptxGenJS();
realPptx.layout = "LAYOUT_WIDE";
// A valid 1x1 PNG, including correct checksums for every PNG chunk.
const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
const realTitle = "Audio 2 — Product Portfolio";
sandbox.addPptxPortfolioSlide(realPptx, realTitle, { data: `image/png;base64,${tinyPng}`, width: 1, height: 1 });
const serializedPptx = await realPptx.write({ outputType: "arraybuffer" });
assert.ok(serializedPptx.byteLength > 10000, "the shipped library emits a complete PowerPoint archive");
const realArchive = await librarySandbox.JSZip.loadAsync(serializedPptx, { checkCRC32: true });
const slideXml = await realArchive.file("ppt/slides/slide1.xml").async("string");
const slideRelationships = await realArchive.file("ppt/slides/_rels/slide1.xml.rels").async("string");
const savedTexts = [...slideXml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((match) => match[1]);
assert.deepEqual(savedTexts, [realTitle], "the saved slide contains its real title and no numeric footer");
assert.ok(!/<p:ph\b[^>]*\btype="(?:sldNum|ftr|dt)"/i.test(slideXml), "the saved slide has no number/footer/date placeholders");
const dividerXml = slideXml.match(/<a:ln\b[^>]*\bw="5080"[^>]*>([\s\S]*?)<\/a:ln>/);
assert.ok(dividerXml, "the saved divider is exactly 0.4pt (5080 EMU)");
assert.match(dividerXml[1], /<a:srgbClr\b[^>]*\bval="2B2E2B"/);
assert.match(dividerXml[1], /<a:alpha\b[^>]*\bval="75000"/, "the saved divider retains 25% transparency");
const pictureXml = [...slideXml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)];
assert.equal(pictureXml.length, 1, "the saved slide contains one exported image");
const imageRelationId = pictureXml[0][0].match(/<a:blip\b[^>]*\br:embed="([^"]+)"/)?.[1];
assert.ok(imageRelationId, "the slide picture refers to an embedded image relationship");
const imageRelation = [...slideRelationships.matchAll(/<Relationship\b[^>]*\/>/g)].map((match) => match[0]).find((relationship) => relationship.includes(`Id="${imageRelationId}"`));
assert.ok(imageRelation);
assert.match(imageRelation, /Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/image"/);
const imageTarget = imageRelation.match(/Target="([^"]+)"/)?.[1];
assert.match(imageTarget, /^\.\.\/media\/.+\.png$/);
const imagePayload = await realArchive.file(`ppt/${imageTarget.slice(3)}`).async("uint8array");
assert.deepEqual(Buffer.from(imagePayload), Buffer.from(tinyPng, "base64"), "the image relationship resolves to the intact real PNG payload");
assert.match(await realArchive.file("[Content_Types].xml").async("string"), /Extension="png"\s+ContentType="image\/png"/);
console.log(`PPTX checks passed: pagination, category selection, actual preview/export coverage, numberless slide chrome, and real bundled-library OOXML (${serializedPptx.byteLength} bytes).`);
