import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
await import("../../public/js/product-image-framing.js");
const api = globalThis.PortfolioImageFraming;
for (const id of ["pc-gaming-audio", "console-gaming-audio", "lifestyle-audio"]) assert.equal(api.usesAudioFraming(id), true);
for (const id of ["mice", "controllers", "microphones", "keyboards", "audio-accessories", "", null]) assert.equal(api.usesAudioFraming(id), false);
for (const name of ["HyperX Cloud Earbuds II", "HyperX MIX Buds 2", "HyperX Cirro Buds Pro"]) assert.equal(api.usesAudioFraming("lifestyle-audio", { name }), false, "Earbuds are outside the headset-only pass.");
for (const name of ["HyperX Cloud Mini", "HyperX Cloud Mini Wireless", "HyperX Cloud MIX 2"]) assert.equal(api.usesAudioFraming("lifestyle-audio", { name }), true);
const pixels = new Uint8ClampedArray(100 * 100 * 4);
for (let y = 10; y < 90; y++) for (let x = 25; x < 75; x++) pixels[(y * 100 + x) * 4 + 3] = 255;
const original = pixels.slice(), bounds = api.boundsFromPixels(pixels, 100, 100);
assert.deepEqual(bounds, { x: 23, y: 8, width: 54, height: 84 });
assert.deepEqual(pixels, original, "Measurement never edits original pixels.");
assert.equal(api.boundsFromPixels(new Uint8ClampedArray(16), 2, 2), null, "Empty artwork has no invented subject.");
assert.equal(api.boundsFromPixels(pixels, 10, 10), null, "Malformed buffers are rejected.");
const opaque = new Uint8ClampedArray(4 * 6 * 4).fill(255);
assert.deepEqual(api.boundsFromPixels(opaque, 4, 6), { x: 0, y: 0, width: 4, height: 6 }, "Opaque backgrounds are not removed by color guessing.");
const box = { x: 18, y: 34, width: 210, height: 210 };
const small = api.placement({ width: 800, height: 600 }, box, { x: 330, y: 200, width: 140, height: 180 });
const large = api.placement({ width: 800, height: 600 }, box, { x: 190, y: 30, width: 420, height: 540 });
assert(Math.abs(small.height - large.height) < 1e-10);
assert(Math.abs(small.width - large.width) < 1e-10, "Different transparent padding produces the same visible scale.");
assert(Math.abs(small.width / small.height - 140 / 180) < 1e-10, "Framing cannot stretch a model.");
assert.equal(small.x + small.width / 2, box.x + box.width / 2);
assert.equal(small.y + small.height / 2, box.y + box.height / 2);
for (const [width, height] of [[600, 800], [800, 600], [4000, 4000], [1, 1000]]) {
  const f = api.placement({ width, height }, box, { x: 0, y: 0, width, height });
  assert(f.x >= box.x && f.y >= box.y && f.x + f.width <= box.x + box.width && f.y + f.height <= box.y + box.height, "The complete subject stays inside its own image slot.");
}
assert.equal(api.placement({ width: 800, height: 600 }, box, { x: 799, y: 0, width: 5, height: 10 }), null);
assert.equal(api.placement({ width: 0, height: 0 }, box), null);
const calls = [], image = { naturalWidth: 800, naturalHeight: 600 };
assert.equal(api.draw({ drawImage: (...args) => calls.push(args) }, image, box), true);
assert.equal(calls[0].length, 9, "Canvas and the existing PPTX recorder use the same source rectangle.");
assert.equal(calls[0][0], image);
assert(Math.abs(calls[0][3] / calls[0][4] - 800 / 600) < 1e-10, "A non-readable remote image falls back without distortion.");
const miniCalls = [];
api.draw({ drawImage: (...args) => miniCalls.push(args) }, image, box, { assetName: "7G8F4AA-6fc2e505dc1337f78f61.png" });
assert.deepEqual(miniCalls[0].slice(1, 5), [234, 116, 331, 367], "Only the exact reviewed wired Mini gets its body frame.");
api.draw({ drawImage: (...args) => miniCalls.push(args) }, image, box, { assetName: "unreviewed-photo.png" });
assert.deepEqual(miniCalls[1].slice(1, 5), [0, 0, 800, 600], "Unknown files never inherit a model-specific crop.");
api.draw({ drawImage: (...args) => miniCalls.push(args) }, { naturalWidth: 160, naturalHeight: 160 }, box, { assetName: "7G8F4AA-6fc2e505dc1337f78f61.png" });
assert.deepEqual(miniCalls[2].slice(1, 5), [0, 0, 160, 160], "An image loading placeholder cannot use the original's frame.");
const largerMiniCalls = [];
api.draw({ drawImage: (...args) => largerMiniCalls.push(args) }, image, { x: 39.7, y: 34, width: 166.6, height: 182 }, { assetName: "7G8F4AA-6fc2e505dc1337f78f61.png" });
const largerMini = largerMiniCalls[0];
const visibleMiniBodyHeight = 359 * largerMini[8] / largerMini[4];
assert(Math.abs(visibleMiniBodyHeight - 249.24577656675748 * .7) < 1e-9, "The chosen Mini body is exactly30percent smaller than the approved larger preview.");
assert(visibleMiniBodyHeight >= 173 && visibleMiniBodyHeight <= 177, "The selected thirty-percent option preserves its reviewed visible size.");
assert(largerMini[5] >= 39.7 && largerMini[6] >= 34 && largerMini[5] + largerMini[7] <= 206.3 && largerMini[6] + largerMini[8] <= 216, "The selected headset remains inside its own card image region.");
const reviewedOwnerCalls = [];
api.draw({ drawImage: (...args) => reviewedOwnerCalls.push(args) }, { naturalWidth: 480, naturalHeight: 480 }, box, { assetName: "front-1beda1eadb7cc9501325.png" });
assert.deepEqual(reviewedOwnerCalls[0].slice(1, 5), [75, 70, 330, 336], "The reviewed owner original uses its matching intrinsic size and content prefix.");
api.draw({ drawImage: (...args) => reviewedOwnerCalls.push(args) }, image, box, { assetName: "front-1beda1eadb7cc9501325.png" });
assert.deepEqual(reviewedOwnerCalls[1].slice(1, 5), [0, 0, 800, 600], "Matching content-prefix text with different dimensions never inherits a frame.");
api.draw({ drawImage: (...args) => reviewedOwnerCalls.push(args) }, image, box, { assetName: "front-6fc2e505dc1337f78f61.png.backup" });
assert.deepEqual(reviewedOwnerCalls[2].slice(1, 5), [0, 0, 800, 600], "Only the exact native PNG filename format enables a reviewed frame.");

// Exercise actual app layout and drawing rather than a second geometry model.
const app = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
const functionSource = name => app.match(new RegExp(`^function ${name}\\([^]*?^\\}`, "m"))[0];
const board = { products: [], lanes: [{ id: "wired", order: 0 }, { id: "wireless", order: 1 }], settings: { showSkus: false } };
const sandbox = { board, activeCategoryId: "mice", categoryDefinition: () => ({ id: "mice" }), sortedLanes: () => board.lanes,
  PortfolioImageFraming: api, detailedSpecsHeight: () => 0, cardSpecifications: () => [], variantFooterLayout: () => ({ height: 0 }) };
vm.createContext(sandbox);
vm.runInContext(app.slice(app.indexOf("const CARD_WIDTH"), app.indexOf("const PLACEHOLDER_IMAGE")) + app.slice(app.indexOf("const FULL_SPEC_MIN_CARD_HEIGHT"), app.indexOf("// Canvas colors")) + functionSource("productCardLayout") + functionSource("drawContainedImage"), sandbox);
const before = JSON.stringify(board);
for (const id of ["pc-gaming-audio", "console-gaming-audio", "lifestyle-audio"]) {
  const layout = sandbox.productCardLayout(board, { id }, { includeControls: false });
  assert.equal(layout.imageSlotHeight, 182, "Every audio category reserves the selected thirty-percent image region.");
  assert(layout.titleBlockTop >= layout.imageSlotTop + layout.imageSlotHeight, "The enlarged image cannot overlap the product title.");
}
assert.equal(sandbox.productCardLayout(board, { id: "mice" }).imageSlotHeight, 112, "Other categories retain their original layout.");
assert.equal(JSON.stringify(board), before, "Layout never rewrites saved data.");
const normalDraws = [], audioDraws = [];
sandbox.drawContainedImage({ drawImage: (...args) => normalDraws.push(args) }, image, 0, 0, 210, 210, { categoryId: "mice" });
sandbox.drawContainedImage({ drawImage: (...args) => audioDraws.push(args) }, image, 0, 0, 210, 210, { categoryId: "pc-gaming-audio" });
assert.equal(normalDraws[0].length, 5, "Other categories retain ordinary contain rendering.");
assert.equal(audioDraws[0].length, 9);
sandbox.drawContainedImage({ drawImage: (...args) => audioDraws.push(args) }, image, 0, 0, 210, 112, { categoryId: "lifestyle-audio", product: { name: "HyperX Cloud Earbuds II" } });
assert.equal(audioDraws[1].length, 5, "A natural earbud pair never gets headset cropping.");

// Exercise the actual mixed detailed layout and drawCard path. An opaque square
// earbud can fill its entire legacy210px box, so it exposes overlap that a small
// transparent natural pair might hide in a screenshot.
const mixedProducts = [
  { id: "mini", name: "HyperX Cloud Mini", specs: [{ label: "Connection", value: "Wired" }], assetName: "front-6fc2e505dc1337f78f61.png" },
  { id: "earbuds", name: "HyperX Cloud Earbuds II", specs: [{ label: "Connection", value: "Wired" }] },
];
const mixedBoard = { products: mixedProducts, lanes: [{ id: "wired", order: 0 }], settings: { showSkus: false, showPrices: false } };
Object.assign(sandbox, {
  board: mixedBoard, UI_PALETTE: { silver: "#bbb", carbon: "#222", whiteSmoke: "#ddd", greyOlive: "#aaa" }, UI_FONT_FACE: "Arial",
  productPresentation: () => ({ primaryLabel: "", secondaryLabel: "" }), roundRect() {}, wrapText() {},
  productCardTitle: product => product.name, productImageSource: product => product,
  productImageAssetName: product => product.assetName || "", drawDetailedSpecs() {},
  loadImage: product => ({ ready: true, image: product.id === "earbuds" ? { naturalWidth: 800, naturalHeight: 800 } : image }),
});
vm.runInContext(functionSource("drawCard"), sandbox);
const mixedLayout = sandbox.productCardLayout(mixedBoard, { id: "lifestyle-audio", fullSpecCards: true }, { includeControls: false });
assert.equal(mixedLayout.detailed, true);
assert.equal(mixedLayout.imageSlotHeight, 210, "Mixed detailed cards retain room for the legacy full-height earbud drawing.");
const drawActualCard = (product, layout = mixedLayout) => {
  const calls = [], context = { save() {}, restore() {}, drawImage: (...args) => calls.push(args) };
  sandbox.drawCard(context, product, 0, 0, false, layout, false);
  return calls[0];
};
const opaqueEarbud = drawActualCard(mixedProducts[1]);
assert.equal(opaqueEarbud.length, 5, "Opaque earbuds still use ordinary contain rendering.");
assert.equal(opaqueEarbud[4], 210, "Detailed earbud size remains unchanged.");
assert(opaqueEarbud[2] >= 24 && opaqueEarbud[2] + opaqueEarbud[4] <= mixedLayout.titleBlockTop, "A full-height opaque earbud cannot cross the status banner or product title.");
const mixedHeadset = drawActualCard(mixedProducts[0]);
assert.equal(mixedHeadset.length, 9);
assert(Math.abs(359 * mixedHeadset[8] / mixedHeadset[4] - visibleMiniBodyHeight) < 1e-9, "A larger shared mixed region cannot enlarge the chosen70percent headset body.");
assert(mixedHeadset[6] >= 24 && mixedHeadset[6] + mixedHeadset[8] <= mixedLayout.titleBlockTop, "The smaller headset remains centered between the status banner and title.");
const simpleMixedBoard = { ...mixedBoard, lanes: [{ id: "wired", order: 0 }, { id: "wireless", order: 1 }] };
const simpleMixedLayout = sandbox.productCardLayout(simpleMixedBoard, { id: "lifestyle-audio" }, { includeControls: false });
const simpleEarbud = drawActualCard(mixedProducts[1], simpleMixedLayout);
assert.equal(simpleMixedLayout.detailed, false);
assert.equal(simpleEarbud.length, 5);
assert(Math.abs(simpleEarbud[4] - 112) < 1e-9, "Simple earbud drawCard rendering keeps its original112px height.");
assert(simpleEarbud[2] >= 24 && simpleEarbud[2] + simpleEarbud[4] <= simpleMixedLayout.titleBlockTop, "A natural earbud stays inside the simple mixed image region.");
console.log("Product image framing checks passed: visible-size consistency, aspect ratio, whole-subject bounds, safe fallbacks, audio-only geometry, export parity and immutable pixels/data.");
