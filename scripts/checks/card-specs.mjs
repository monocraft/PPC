import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
await import("../../public/js/reference-theme.js");
await import("../../public/js/card-specs.js");
await import("../../public/js/launch-records.js");
const api = globalThis.PortfolioCardSpecs;
const s = (label, value, id = label) => ({ id, label, value });
const product = (name, specs, extra = {}) => ({ id: name, name, specs, ...extra });
const select = (categoryId, name, specs, extra) => api.select(product(name, specs, extra), { categoryId });
const row = (rows, role) => rows.find(item => item.role === role);

const microphone = product("USB Studio Mic", [
  s("Warranty", "2 years"), s("Platform", "PC / Mac"), s("Box contents", "Cable, stand"),
  ...Array.from({ length: 24 }, (_, index) => s(`Noise measurement ${index}`, "100 dB")),
  s("Connection", "USB-C"), s("Record quality", "24-bit, 16-bit / 96kHz, 48kHz, 44.1kHz"),
  s("Capsule type", "One 14mm electret condenser capsule"), s("Polar pattern", "Cardioid"),
  s("Monitor", "No"), s("Controls", "On-Board Controls"), s("Tap-to-mute", "Yes"),
  s("Lighting", "RGB"), s("Connection type", "USB Type-C®", "duplicate-connection"),
], { imageAssetId: "hero", laneId: "microphone", partSkus: [{ id: "sku", code: "ABC1234", variantId: "blue" }], variantGroups: [{ id: "color", items: [{ id: "blue", colorHex: "#0066cc" }] }] });
const before = structuredClone(microphone);
const chosen = api.select(microphone, { categoryId: "microphones" });
assert.equal(chosen.length, 5);
assert.deepEqual(chosen.map(item => item.role), ["connection", "recording", "capsule-pattern", "monitor", "controls"]);
assert.equal(row(chosen, "recording").value, "Depth up to 24-bit · Rate up to 96 kHz", "Independent supported maxima do not invent a bit-depth/rate pairing.");
assert.equal(row(chosen, "capsule-pattern").value, "One electret condenser capsule · Cardioid");
assert.equal(row(chosen, "monitor").label, "Headphone monitoring");
assert.equal(row(chosen, "monitor").value, "No");
assert.equal(row(chosen, "controls").value, "Tap-to-mute");
assert.deepEqual(row(chosen, "capsule-pattern").sourceSpecIds, ["Capsule type", "Polar pattern"]);
assert.deepEqual(api.select({ ...microphone, specs: [...microphone.specs].reverse() }, { categoryId: "microphones" }), chosen, "Ranked role and alias priority is independent of stored row order.");
assert.deepEqual(microphone, before, "Selection cannot edit source rows, images, SKU bindings or variant colors.");
assert.equal(select("microphones", "Missing", [s("Connection", "Add connection"), s("Monitor", "Yes / No"), s("Shock mount", "Internal / External"), s("Warranty", "2 years")]).length, 0);
assert.equal(select("custom-category", "Unknown", [s("Connection", "USB"), s("Material", "Steel")]).length, 0, "There is no arbitrary fallback for unknown categories.");
assert.equal(row(select("microphones", "Conditional", [s("Record quality", "24-bit / 96kHz (USB mode only)")]), "recording").value, "24-bit / 96kHz (USB mode only)", "Conditions cannot be discarded while compacting numeric lists.");
assert.equal(row(select("microphones", "Split recording", [s("Bit depth", "16-bit; 24-bit"), s("Sampling rates", "48kHz; 96kHz")]), "recording").value, "Depth up to 24-bit · Rate up to 96 kHz");

const scoped = value => select("microphones", "Scoped mic", [s("Connection", value)], { partSkus: [{ code: "ABC1234" }, { code: "DEF5678" }] });
assert.equal(row(scoped("ABC1234: USB-C; DEF5678: USB Type-C®"), "connection").value, "USB-C");
assert.equal(row(scoped("ABC1234: USB-C; DEF5678: XLR"), "connection").value, "ABC1234: USB-C; DEF5678: XLR");
assert.equal(row(scoped("ABC1234: USB-C, 3.5mm headphone output; DEF5678: USB-C"), "connection").value, "ABC1234: USB-C, 3.5mm headphone output; DEF5678: USB-C", "A different output role cannot be erased to manufacture equivalent branches.");
assert.equal(row(scoped("ABC1234: USB-C; XYZ9999: USB-C"), "connection").value, "ABC1234: USB-C; XYZ9999: USB-C", "Unknown SKU scopes cannot be promoted to common facts.");
const partial = select("microphones", "Partial scopes", [s("Connection", "ABC1234: USB-C; DEF5678: USB-C"), s("Polar pattern", "ABC1234: Cardioid; DEF5678: Cardioid")], { partSkus: [{ code: "ABC1234" }, { code: "DEF5678" }, { code: "GHI9012" }] });
assert.equal(row(partial, "connection").value, "ABC1234: USB-C; DEF5678: USB-C", "Every actual saved SKU must be represented before common claims are made.");
assert.equal(row(partial, "capsule-pattern").value, "ABC1234: Cardioid; DEF5678: Cardioid");
const signed = select("microphones", "Signed conditions", [s("Controls", "ABC1234: Gain -5 dB; DEF5678: Gain 5 dB")], { partSkus: [{ code: "ABC1234" }, { code: "DEF5678" }] });
assert.equal(row(signed, "controls").value, "ABC1234: Gain -5 dB; DEF5678: Gain 5 dB", "Value-sign differences are technical conditions, unlike cosmetic label hyphens.");
const pattern = select("microphones", "Patterns", [s("Polar pattern", "ABC1234: Cardioid, stereo; DEF5678: Stereo; Cardioid")], { partSkus: [{ code: "ABC1234" }, { code: "DEF5678" }] });
assert.equal(row(pattern, "capsule-pattern").value, "Cardioid, stereo");
assert.equal(select("console-gaming-audio", "Console headset", [s("Platform", "Xbox Series X|S"), s("Connection", "3.5mm")])[0].role, "fit");
assert(!select("pc-gaming-audio", "PC headset", [s("Platform", "Windows"), s("Connection", "3.5mm")]).some(item => item.role === "fit"));

const dock = select("controllers", "ChargePlay Test", [s("Connection", "Wired"), s("USB specification", "USB-C"), s("Controller charging capacity", "4 Joy-Con controllers (not included)"), s("Compatibility", "Nintendo Switch"), s("Charging time", "3.5 hours"), s("Charging indicator count", "4")]);
assert.equal(row(dock, "capacity").value, "4 Joy-Con controllers (not included)");
assert.equal(row(dock, "connection").value, "USB-C");
assert(!dock.some(item => item.label === "Power" && item.value === "Wired"));
const arcade = select("controllers", "Leverless arcade", [s("Form factor", "12-button Leverless Arcade Controller"), s("Switches", "Hall Effect"), s("Control switch feel", "Linear"), s("Connection", "Wired"), s("Compatibility", "PC · Xbox"), s("Actuation adjustment resolution", "0.25 mm steps")]);
assert(!arcade.some(item => item.role === "sticks" || item.value === "Hall Effect"));
assert.equal(row(arcade, "feel").value, "Linear");
const controller = select("controllers", "Gamepad", [s("Connection", "2.4GHz wireless"), s("Switches", "Hall Effect"), s("Compatibility", "PC · Xbox"), s("Feature", "Officially licensed for Xbox · Hall Effect sticks and triggers · Reprogrammable back paddles"), s("Battery", "30 hours with headset disconnected")]);
assert.equal(row(controller, "switch").label, "Switches", "A generic saved switch field is not relabeled as a stick sensor.");
assert.equal(row(controller, "controls").value, "Hall Effect sticks and triggers · Reprogrammable back paddles");
assert.equal(row(controller, "battery").value, "30 hours with headset disconnected");

const cable = select("microphone-accessories", "XLR Cable", [s("Cable connectors", "Silver-plated XLR"), s("Cable jacket and insulation", "PVC, braided nylon; PE insulation"), s("Conductor wire gauge", "24 AWG"), s("Cable conductors", "2 plus shield; OFC"), s("Warranty", "2 years")]);
assert.deepEqual(cable.map(item => item.role), ["connectors", "construction", "gauge", "conductors"]);
const arm = select("microphone-accessories", "Caster Arm", [s("Compatibility", "PC. Microphones and Cameras 0.2kg to 1kg with 1/4in, 3/8in or 5/8in threaded mount."), s("Arm reach", "91.8cm"), s("Connection type", "Desk clamp")]);
assert.match(row(arm, "fit").value, /^Microphones and Cameras 0\.2kg to 1kg/);
const filter = select("microphone-accessories", "Shield Pop Filter", [s("Connection type", "Clamp"), s("Attachment", "Fits shock mount"), s("Filter screen dimensions", "147 × 76 mm"), s("Filter screen material", "Metal"), s("Gooseneck length", "350mm")]);
assert(filter.some(item => item.value === "147 × 76 mm") && filter.some(item => item.value === "Metal"));
const mixer = select("microphone-accessories", "Audio Mixer", [s("Microphone input ports", "Microphone input(s): 1x XLR / TRS combo, 1x 3.5mm; XLR input balanced mono"), s("Line and headphone ports", "Line input - Headphone output - Line output: 1x 3.5mm"), s("Connection type", "XLR + USB"), s("Features", "Hardware mixing and audio routing"), s("Bit depth", "24-bit, 16-bit"), s("Sampling rates", "96kHz, 48kHz")]);
assert.equal(row(mixer, "inputs").value, "1x XLR / TRS combo, 1x 3.5mm");
assert.equal(row(mixer, "recording").value, "Depth up to 24-bit · Rate up to 96 kHz");
const pbt = select("keyboards", "PBT Keyboard", [s("Keyboard form factor", "Full Size"), s("Switch model", "HyperX Switch"), s("Switch feel", "Linear, Tactile, Clicky"), s("Polling rate", "1000Hz"), s("Product material", "PBT"), s("Light effects", "Per-key RGB")]);
assert.equal(row(pbt, "switch").value, "Linear, Tactile, Clicky");
assert.equal(row(pbt, "keycaps").value, "PBT");
assert.equal(row(select("keyboards", "Linear Keyboard", [s("Switch feel", "Linear"), s("Switch model", "HyperX Linear Switch")]), "switch").value, "HyperX Linear Switch");
const fitValue = "Cloud Alpha, Cloud Alpha S, Cloud Alpha Wireless, Cloud II, Cloud II Wireless, Cloud III and Cloud III Wireless headsets.";
assert.equal(row(select("audio-accessories", "Headset Plates", [s("Compatibility", fitValue)]), "fit").value, "Cloud: Alpha, Alpha S, Alpha Wireless, II, II Wireless, III, III Wireless");
assert.equal(api.profileFor(product("Project name", [s("Feature", "Cloth surface and foam base"), s("Material", "Cloth")]), "accessories"), "mat");
const mat = select("accessories", "Cloth Mouse Pad", [s("Dimensions", "900 × 420 × 3 mm"), s("Surface material", "Cloth"), s("Product material", "Cloth, rubber"), s("Features", "Non-slip base · Stitched edges")]);
assert.equal(mat.filter(item => /Cloth/.test(item.value)).length, 1, "Surface and total material cannot repeat the same cloth fact.");
assert.equal(select("accessories", "3D Figurine", [s("Warranty", "1 year"), s("Box contents", "Figurine"), s("Product material", "Printed by HP Inc.")]).length, 0);
for (const [name, expected] of [["Wrist Rest", "wrist"], ["Linear Switch", "switch"], ["Mouse Skate", "skates"], ["Housing", "housing"], ["Top Plate", "plate"], ["Pudding Keycap", "keycap"], ["Vision S Webcam", "webcam"], ["Magnetic Badge", "decoration"]]) assert.equal(api.profileFor(product(name, []), "accessories"), expected);

// Use the actual layout and drawing functions, including category selection
// used by PPTX, while replacing only unrelated canvas/image/price effects.
const app = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
const functions = ["cardSpecifications", "productCardTitle", "normalizedSpecLabel", "detailedValueLineCount", "isDetailedMatrixSpec", "isDetailedPairCandidate", "detailedSpecRows", "detailedSpecRowHeight", "detailedSpecsHeight", "productCardLayout", "drawDetailedSpecLabel", "drawDetailedSpecs", "drawCard"];
const drawText = [], images = [], footers = [];
const board = { lanes: [{ id: "microphone" }], products: [microphone], settings: { showPrices: true, showSkus: true } };
const sandbox = {
  activeCategoryId: "microphones", board, PortfolioCardSpecs: api, PortfolioLaunchRecords: globalThis.PortfolioLaunchRecords,
  sortedLanes: () => board.lanes, categoryDefinition: () => ({ id: "microphones" }), variantFooterLayout: () => ({ height: 44, groups: [] }),
  UI_PALETTE: {}, productPresentation: () => ({}), roundRect() {}, loadImage: () => ({ ready: true, image: "hero-image" }), productImageSource: () => "hero",
  drawContainedImage: (...args) => images.push(args.slice(1)), productPriceText: () => "$79.99", drawSpecIcon() {}, detailedValueColor: () => "#999999",
  wrapText: (context, value) => context.fillText(value), drawVariantFooter: (_context, saved) => footers.push(saved.partSkus), drawProductInfoButton() {},
};
Object.assign(sandbox, { PortfolioTheme: globalThis.PortfolioTheme, UI_FONT_FACE: globalThis.PortfolioTheme.fontFace });
vm.createContext(sandbox);
vm.runInContext(app.slice(app.indexOf("const CARD_WIDTH"), app.indexOf("const PLACEHOLDER_IMAGE")) + app.slice(app.indexOf("const FULL_SPEC_MIN_CARD_HEIGHT"), app.indexOf("// Canvas colors"))
  + functions.map(name => app.match(new RegExp(`^function ${name}\\([^]*?^\\}`, "m"))[0]).join("\n"), sandbox);
const context = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText: value => drawText.push(value) };
const layout = sandbox.productCardLayout();
sandbox.drawCard(context, microphone, 0, 0, false, layout, false);
for (const selected of chosen) assert(drawText.includes(selected.value));
assert(!drawText.some(value => /warranty|pc \/ mac|box contents|\+\d+ specification/i.test(value)));
assert(images.length === 1 && images[0][4] === 210, "The original detailed hero image size is retained.");
assert.deepEqual(footers[0], microphone.partSkus, "SKU/color footer bindings survive unchanged.");
const geometry = JSON.stringify(layout);
board.products[0] = { ...microphone, specs: [...microphone.specs, ...Array.from({ length: 100 }, (_, index) => s(`Sensitivity ${index}`, "30 dB"))] };
assert.equal(JSON.stringify(sandbox.productCardLayout()), geometry, "Complete Details fields cannot inflate front cards.");
sandbox.activeCategoryId = "mice";
const exportLayout = sandbox.productCardLayout(board, { id: "microphones" });
assert.equal(exportLayout.categoryId, "microphones", "PPTX sizing must use the exported category, independent of the current tab.");
assert.deepEqual(JSON.parse(JSON.stringify(exportLayout)), JSON.parse(geometry));
drawText.length = 0;
sandbox.drawCard(context, microphone, 0, 0, false, exportLayout, false);
for (const selected of chosen) assert(drawText.includes(selected.value), "PPTX's same drawCard path draws the exact same selected facts.");
assert.match(app.slice(app.indexOf("function recordCardElementsForPptx("), app.indexOf("function productPagesForPptx(")), /drawCard\(recorder, product, 0, 0, false, layout, false\)/);
const html = await readFile(new URL("../../public/index.html", import.meta.url), "utf8"), deployment = await readFile(new URL("../../.github/workflows/deploy.yml", import.meta.url), "utf8");
assert(html.indexOf('src="js/card-specs.js"') < html.indexOf('src="js/app.js"'));
assert.match(deployment, /cp public\/js\/card-specs\.js _site\/js\//);
assert.match(deployment, /test -f _site\/js\/card-specs\.js/);
console.log("Card summaries: ranked purchase facts, subtype roles, bounded rows, scoped equivalence, complete Details preservation, hero/SKU retention and shared PPTX drawing passed.");
