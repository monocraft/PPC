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

// Mouse normalization is separate from headset framing and only accepts
// reviewed side-source identities. Held/top-down sources keep ordinary contain.
const mouseName = "side-0bcad882a144e151b997.png", mouseBox = { x: 18, y: 34, width: 210, height: 112 };
assert.equal(api.usesMouseFraming("mice", mouseName), true);
for (const categoryId of ["keyboards", "controllers", "pc-gaming-audio", "lifestyle-audio"]) assert.equal(api.usesMouseFraming(categoryId, mouseName), false);
assert.equal(api.usesMouseFraming("mice", "held-top-down.png"), false);
assert.equal(api.usesMouseFraming("mice", "e4.png"), false, "A retained generic filename cannot enable mouse cropping.");
const rejectedMouseCalls = [];
assert.equal(api.drawMouse({ drawImage: (...args) => rejectedMouseCalls.push(args) }, image, mouseBox, { assetName: "unknown-ffffffffffffffffffff.png" }), false);
assert.equal(api.drawMouse({ drawImage: (...args) => rejectedMouseCalls.push(args) }, { naturalWidth: 400, naturalHeight: 300 }, mouseBox, { assetName: mouseName }), false);
assert.equal(rejectedMouseCalls.length, 0, "Unknown hashes and mismatched dimensions cannot crop or enlarge artwork.");
const heldDraws = [];
sandbox.drawContainedImage({ drawImage: (...args) => heldDraws.push(args) }, image, 18, 34, 210, 112, { categoryId: "mice", assetName: "held-top-down.png" });
assert.equal(heldDraws[0].length, 5, "An unapproved held mouse retains ordinary contain rendering.");
const previousDocument = globalThis.document;
let sampled = 0;
globalThis.document = { createElement: () => {
  const canvas = { width: 0, height: 0 };
  canvas.getContext = () => ({ drawImage(source) { canvas.wideSubject = source.wideSubject; }, getImageData() {
    sampled += 1;
    const data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
    const rect = canvas.wideSubject ? { left: 55, right: 455, top: 130, bottom: 254 } : { left: 125, right: 387, top: 152, bottom: 233 };
    for (let y = rect.top; y < rect.bottom; y++) for (let x = rect.left; x < rect.right; x++) data[(y * canvas.width + x) * 4 + 3] = 255;
    return { data };
  } });
  return canvas;
} };
const mouseImage = { naturalWidth: 800, naturalHeight: 600 }, mouseCalls = [];
try {
  assert.equal(api.drawMouse({ drawImage: (...args) => mouseCalls.push(args) }, mouseImage, mouseBox, { assetName: mouseName }), true);
  api.drawMouse({ drawImage: (...args) => mouseCalls.push(args) }, mouseImage, mouseBox, { assetName: mouseName });
  api.drawMouse({ drawImage: (...args) => mouseCalls.push(args) }, { naturalWidth: 800, naturalHeight: 600, wideSubject: true }, mouseBox, { assetName: "side-a8fac4586682179db478.png" });
} finally {
  if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
}
assert.equal(sampled, 2, "Approved mouse alpha is measured once per decoded image, including a cached repeat.");
const mouseDraw = mouseCalls[0];
assert.equal(mouseDraw.length, 9, "Mouse rendering preserves the shared Canvas/PPTX source-rectangle path.");
assert(Math.abs(mouseDraw[7] - 205.8) < 1e-9, "Reviewed side art fills98percent of the ordinary210px image width.");
assert(Math.abs(mouseDraw[7] - mouseCalls[2][7]) < 1e-9, "Different transparent padding keeps the same approved side-body frame width.");
assert(Math.abs(mouseDraw[7] / mouseDraw[8] - mouseDraw[3] / mouseDraw[4]) < 1e-9, "Side silhouettes retain their natural aspect ratio.");
assert(Math.abs(mouseDraw[5] + mouseDraw[7] / 2 - 123) < 1e-9 && Math.abs(mouseDraw[6] + mouseDraw[8] / 2 - 90) < 1e-9, "Mouse bodies are centered within the ordinary112px region.");
assert(mouseDraw[5] >= 18 && mouseDraw[6] >= 34 && mouseDraw[5] + mouseDraw[7] <= 228 && mouseDraw[6] + mouseDraw[8] <= 146, "A side silhouette cannot cross its image region.");
const wiredMouseCalls = [];
api.drawMouse({ drawImage: (...args) => wiredMouseCalls.push(args) }, image, mouseBox, { assetName: "side-6541bd9b2ea10a8ae89e.png" });
assert.deepEqual(wiredMouseCalls[0].slice(1, 5), [204, 233, 419, 135], "Only the reviewed wired side original trims excess cable in presentation.");
api.drawMouse({ drawImage: (...args) => wiredMouseCalls.push(args) }, image, mouseBox, { assetName: "side-92a0a4f0192a336e0ccd.png" });
api.drawMouse({ drawImage: (...args) => wiredMouseCalls.push(args) }, image, mouseBox, { assetName: "side-201a720e9b6c2411017d.png" });
assert.deepEqual(wiredMouseCalls[1].slice(1, 5), [188, 233, 425, 135], "The other reviewed wired model keeps its distinct complete body frame.");
assert.deepEqual(wiredMouseCalls[2].slice(1, 5), [215, 238, 410, 148], "The reviewed taller body trims only its cable-only extension.");
// Flat keyboards keep their reviewed body height at every layout size. The
// source crop intentionally removes the left overflow, never the right edge.
const keyImage = { naturalWidth: 800, naturalHeight: 600 };
const keyBox = { x: 18, y: 34, width: 210, height: 112 };
const keyBounds = { x: 180, y: 220, width: 440, height: 150 };
const keyFrame = api.keyboardPlacement(keyImage, keyBox, keyBounds);
assert.equal(keyFrame.height, 112);
assert.equal(keyFrame.x, 0, "An oversized keyface is clipped exactly at the card's left edge.");
assert.equal(keyFrame.x + keyFrame.width, 228, "Every reviewed keyboard retains the same right inset.");
assert.equal(keyFrame.source.x + keyFrame.source.width, keyBounds.x + keyBounds.width, "Left cropping cannot remove the physical right edge.");
assert(keyFrame.source.x > keyBounds.x, "Full-size artwork is enlarged and cropped rather than squeezed into a contain box.");
assert(Math.abs(keyFrame.width / keyFrame.height - keyFrame.source.width / keyFrame.source.height) < 1e-10, "Keyboard cropping never stretches the keycaps.");
const detailedKeyFrame = api.keyboardPlacement(keyImage, { ...keyBox, height: 210 }, keyBounds);
assert.equal(detailedKeyFrame.height, 112, "Detailed cards use the same body/keycap scale as simple cards.");
assert.equal(detailedKeyFrame.y, 83, "The keyboard remains vertically centered in the existing detailed image region.");
const compactFrame = api.keyboardPlacement(keyImage, keyBox, { x: 200, y: 200, width: 200, height: 120 });
assert(compactFrame.x >= 0 && compactFrame.source.width === 200, "A compact keyboard that fits retains its entire source body.");
for (const malformed of [{ x: -1, y: 0, width: 40, height: 40 }, { x: 790, y: 0, width: 40, height: 40 }, { x: 0, y: 0, width: 0, height: 40 }, { x: 0, y: Infinity, width: 40, height: 40 }]) assert.equal(api.keyboardPlacement(keyImage, keyBox, malformed), null);
assert.equal(api.keyboardPlacement(keyImage, { ...keyBox, x: NaN }, keyBounds), null);
assert.equal(api.keyboardPlacement({ naturalWidth: 0, naturalHeight: 0 }, keyBox, keyBounds), null);
const heldKeyDraws = [];
assert.equal(api.usesKeyboardFraming("keyboards", "held-angled.png"), false);
assert.equal(api.drawKeyboard({ drawImage: (...args) => heldKeyDraws.push(args) }, keyImage, keyBox, { assetName: "held-angled.png" }), false);
assert.equal(heldKeyDraws.length, 0, "Unreviewed keyboard artwork never inherits intentional cropping.");
const keyName = "front-f44cfd84f8d86580f401.png";
assert.equal(api.usesKeyboardFraming("keyboards", keyName), true);
for (const id of ["mice", "controllers", "pc-gaming-audio", "lifestyle-audio", ""]) assert.equal(api.usesKeyboardFraming(id, keyName), false);
assert.equal(api.usesKeyboardFraming("keyboards", keyName + ".backup"), false);
assert.equal(api.usesKeyboardFraming("keyboards", "e4.png"), false);
assert.equal(api.drawKeyboard({ drawImage: (...args) => heldKeyDraws.push(args) }, { naturalWidth: 400, naturalHeight: 300 }, keyBox, { assetName: keyName }), false);
assert.equal(heldKeyDraws.length, 0, "A filename match with the wrong decoded dimensions must retain ordinary contain.");
const approvedKeyDraws = [];
assert.equal(api.drawKeyboard({ drawImage: (...args) => approvedKeyDraws.push(args) }, keyImage, keyBox, { assetName: keyName }), true);
const approvedKey = approvedKeyDraws[0];
assert.equal(approvedKey.length, 9, "The keyboard crop uses the existing Canvas/PPTX source-rectangle path.");
assert.equal(approvedKey[2], 232);
assert.equal(approvedKey[4], 137);
assert.equal(approvedKey[1] + approvedKey[3], 587, "The reviewed physical right edge remains visible after left cropping.");
assert(Math.abs(approvedKey[5]) < 1e-9 && approvedKey[6] === 34 && approvedKey[8] === 112);
const appKeyDraws = [];
sandbox.drawContainedImage({ drawImage: (...args) => appKeyDraws.push(args) }, keyImage, 18, 34, 210, 210, { categoryId: "keyboards", assetName: keyName });
sandbox.drawContainedImage({ drawImage: (...args) => appKeyDraws.push(args) }, keyImage, 18, 34, 210, 210, { categoryId: "keyboards", assetName: "held-quarter.png" });
assert.equal(appKeyDraws[0].length, 9, "The actual app hook applies the approved keyboard crop.");
assert.equal(appKeyDraws[0][8], 112, "The app's larger detailed slot cannot enlarge the keyboard body.");
assert.equal(appKeyDraws[1].length, 5, "Held quarter views retain their original ordinary rendering.");
const keyProduct = { id: "keyboard", name: "Reviewed keyboard", assetName: keyName, specs: [{ label: "Connection", value: "USB" }] };
const keyboardBoard = { products: [keyProduct], lanes: [{ id: "wired", order: 0 }], settings: { showSkus: false, showPrices: false } };
sandbox.board = keyboardBoard;
const detailKeyboardLayout = sandbox.productCardLayout(keyboardBoard, { id: "keyboards", fullSpecCards: true }, { includeControls: false });
const detailKeyboard = drawActualCard(keyProduct, detailKeyboardLayout);
assert.equal(detailKeyboardLayout.imageSlotHeight, 210);
assert.equal(detailKeyboardLayout.titleBlockTop, 252, "Native detailed keyboard title and facts stay in their established positions.");
assert.equal(detailKeyboard[8], 112);
assert.equal(detailKeyboard[6], 83);
const simpleKeyboardBoard = { ...keyboardBoard, lanes: [{ id: "wired", order: 0 }, { id: "wireless", order: 1 }] };
sandbox.board = simpleKeyboardBoard;
const simpleKeyboardLayout = sandbox.productCardLayout(simpleKeyboardBoard, { id: "keyboards" }, { includeControls: false });
const simpleKeyboard = drawActualCard(keyProduct, simpleKeyboardLayout);
assert.equal(simpleKeyboardLayout.imageSlotHeight, 112);
assert.equal(simpleKeyboardLayout.titleBlockTop, 152, "Native simple keyboard title and facts stay in their established positions.");
assert.equal(simpleKeyboard[8], detailKeyboard[8], "The actual drawCard path keeps the same keyboard scale in both layouts.");
assert.equal(simpleKeyboard[6], 34);
assert(simpleKeyboard[6] + simpleKeyboard[8] < simpleKeyboardLayout.titleBlockTop);
assert(detailKeyboard[6] + detailKeyboard[8] < detailKeyboardLayout.titleBlockTop);
console.log("Product image framing checks passed: unchanged headset/mouse fitting, flat keyboard body scale and deliberate left-only crop, source/dimension guards, export parity and immutable pixels/data.");
