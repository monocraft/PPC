import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
await import("../../public/js/master-model.js");
await import("../../public/js/product-merge.js");
const model = globalThis.PortfolioProductMerge;
const copy = (value) => structuredClone(value);
const choose = (planned, side = "keeper", overrides = {}) => Object.assign(Object.fromEntries(planned.conflicts.map((item) => [item.key, side])), overrides);
const product = (id, fields = {}) => ({ id, name: "Cloud Team", laneId: "wired", order: 3, price: null, specs: [], partSkus: [], variantGroups: [], roadmap: {}, ...fields });
const black = (id, fields = {}) => ({ id, code: "BK", colorKey: "black", colorName: "Black", colorHex: "#111111", ...fields });
const red = (id, fields = {}) => ({ id, code: "RD", colorKey: "red", colorName: "Red", colorHex: "#cc0000", ...fields });
const colors = (id, items, fields = {}) => ({ id, type: "color", label: "COLOR SKU", items, ...fields });

const keeper = product("p-keep", {
  price: 0, tier: "TBD", imageAssetId: "hero-keep", featuredVariantId: "black",
  specs: [{ id: "driver", label: "Driver", value: "53 mm", manual: "Keep custom note" }, { id: "battery", label: "Battery life", value: "" }],
  partSkus: [{ id: "hp-keep", code: "HP001", variantId: "black", notes: "Retail" }],
  variantGroups: [colors("color-keep", [black("black", { imageAssetId: "black-image", alternateViews: ["front"] })], { presentation: "swatches" })],
  roadmap: { startMonth: "2026-03", launchMonth: "2026-03", endMonth: "2028-12", family: "Cloud", predecessorId: "p-source", notes: "" },
  ascm: { key: "cloud", records: [{ basePartNumber: "HP001", generalAvailabilityDate: "2026-03-20", marketingName: "Cloud Team" }], basePartNumbers: ["HP001"] },
  manualMetadata: { approvals: { product: true, marketing: null }, contacts: ["Alex"] },
});
const source = product("p-source", {
  laneId: "donor", order: 100, tier: "Premium", codename: "Together", imageAssetId: "hero-source", featuredVariantId: "black-source",
  generalAvailabilityDate: "2026-03-20", endManufacturingDate: "2028-12-10", ffsDate: "2026-02-18",
  specs: [{ id: "driver-source", label: "Driver", value: "53 mm", imported: true }, { id: "battery-source", label: "Battery life", value: "80 hours" }, { id: "weight", label: "Weight", value: "300 g" }],
  partSkus: [{ id: "hp-source", code: "HP001", variantId: "black-source", colorCode: "BK" }, { id: "hp-new", code: "HP002", variantId: "red" }],
  variantGroups: [colors("color-source", [black("black-source", { imageAssetId: "black-image", alternateViews: ["side"] }), red("red", { imageAssetId: "red-image" })], { importer: "ASCM" })],
  roadmap: { startMonth: "2026-03", launchMonth: "2026-03", endMonth: "2028-12", successorId: "p-keep", notes: "Factory launch" },
  ascm: { key: "cloud", records: [{ basePartNumber: "hp001", firstFactoryShipDate: "2026-02-18" }, { basePartNumber: "HP002", colorCode: "RD" }], basePartNumbers: ["HP002"], sourceFile: "ASCM.xlsx" },
  manualMetadata: { approvals: { marketing: false }, contacts: ["Blair"], external: "Keep donor extras" },
});
const original = { keeper: copy(keeper), source: copy(source) };
const planned = model.plan(keeper, source);
assert.deepEqual({ keeper, source }, original, "Planning must never modify either original product.");
assert.equal(planned.product.id, "p-keep"); assert.equal(planned.product.laneId, "wired"); assert.equal(planned.product.order, 3);
assert.equal(planned.product.price, 0, "A zero price is meaningful and cannot be overwritten by a blank.");
assert.equal(planned.product.tier, "Premium"); assert.equal(planned.product.codename, "Together");
assert.equal(planned.product.specs.length, 3); assert.equal(planned.product.specs[0].id, "driver");
assert.equal(planned.product.specs[0].manual, "Keep custom note"); assert.equal(planned.product.specs[0].imported, true);
assert.equal(planned.product.specs[1].value, "80 hours");
assert.equal(planned.product.partSkus.length, 2); assert.equal(planned.product.partSkus[0].variantId, "black");
assert.equal(planned.product.partSkus[0].notes, "Retail"); assert.equal(planned.product.partSkus[0].colorCode, "BK");
assert.equal(planned.maps.variants["black-source"], "black");
assert.equal(planned.product.featuredVariantId, "black");
assert.deepEqual(planned.product.variantGroups[0].items[0].alternateViews, ["front", "side"]);
assert.equal(planned.product.variantGroups[0].items[1].imageAssetId, "red-image");
assert.equal(planned.product.generalAvailabilityDate, "2026-03-20"); assert.equal(planned.product.roadmap.startMonth, "2026-03");
assert.equal(planned.product.roadmap.predecessorId, ""); assert.ok(!planned.product.roadmap.successorId);
assert.equal(planned.product.ascm.records.length, 2); assert.equal(planned.product.ascm.records[0].firstFactoryShipDate, "2026-02-18");
assert.deepEqual(planned.product.ascm.basePartNumbers, ["HP001", "HP002"]);
assert.deepEqual(planned.product.manualMetadata.contacts, ["Alex", "Blair"]);
assert.equal(planned.product.manualMetadata.approvals.marketing, false);
assert.equal(planned.sourceMetadata.source.ascm.sourceFile, "ASCM.xlsx");
assert.equal(planned.summary.specsAdded, 1); assert.equal(planned.summary.skusAdded, 1); assert.equal(planned.summary.variantsAdded, 1);
assert.ok(planned.conflicts.some((item) => item.key === "imageAssetId"));
assert.throws(() => model.resolve(planned, {}), /Choose which value/);
const merged = model.resolve(planned, choose(planned, "keeper", { imageAssetId: "source" }));
assert.equal(merged.imageAssetId, "hero-source"); assert.equal(merged.specs[1].value, "80 hours");
assert.deepEqual({ keeper, source }, original, "Resolving must never modify either original product.");
assert.deepEqual(planned, model.plan(keeper, source), "The same originals produce the same plan and conflict keys.");

const differing = model.plan(product("a", { price: 0, name: "Existing", generalAvailabilityDate: "2026-03-20", endManufacturingDate: "2027-12-20", roadmap: { startMonth: "2026-03", endMonth: "2027-12" }, specs: [{ id: "driver", label: "Driver", value: "53 mm" }], custom: { nested: { value: "Kept" } } }), product("b", { price: 99, name: "Imported", generalAvailabilityDate: "2026-04-20", endManufacturingDate: "2028-12-20", roadmap: { startMonth: "2026-04", endMonth: "2028-12" }, specs: [{ id: "different-driver", label: "Driver", value: "55 mm" }], custom: { nested: { value: "Other" } } }));
assert.ok(differing.conflicts.some((item) => item.key === "@launch")); assert.ok(differing.conflicts.some((item) => item.key === "@end"));
assert.ok(differing.conflicts.some((item) => item.key === "specs/driver/value")); assert.ok(differing.conflicts.some((item) => item.key === "custom/nested/value"));
const picked = model.resolve(differing, choose(differing, "source"));
assert.equal(picked.price, 99); assert.equal(picked.specs[0].value, "55 mm"); assert.equal(picked.generalAvailabilityDate, "2026-04-20");
assert.equal(picked.roadmap.startMonth, "2026-04"); assert.equal(picked.roadmap.launchMonth, "2026-04");
assert.throws(() => model.resolve(differing, choose(differing, "keeper", { price: "anything" })), /Choose which value/);

const monthly = model.plan(product("month-a", { roadmap: { startMonth: "2026-03" } }), product("month-b", { generalAvailabilityDate: "2026-04-12" }));
assert.equal(monthly.conflicts[0].key, "@launch");
const keepMonth = model.resolve(monthly, { "@launch": "keeper" }); assert.equal(keepMonth.generalAvailabilityDate, ""); assert.equal(keepMonth.roadmap.startMonth, "2026-03");
const takeDay = model.resolve(monthly, { "@launch": "source" }); assert.equal(takeDay.generalAvailabilityDate, "2026-04-12"); assert.equal(takeDay.roadmap.startMonth, "2026-04");
assert.throws(() => model.plan(product("bad-pair", { generalAvailabilityDate: "2026-04-20", roadmap: { startMonth: "2026-03" } }), product("other")), /disagree/);

const collision = model.plan(product("collision-a", { specs: [{ id: "same-id", label: "Driver", value: "53 mm" }], variantGroups: [colors("same-group", [black("same-row")])], partSkus: [{ id: "same-sku", code: "HP1", variantId: "same-row" }], featuredVariantId: "same-row" }), product("collision-b", { specs: [{ id: "same-id", label: "Battery", value: "80 h" }], variantGroups: [colors("same-group", [red("same-row", { imageAssetId: "donor-red" })])], partSkus: [{ id: "same-sku", code: "HP2", variantId: "same-row" }], featuredVariantId: "same-row" }));
const collided = model.resolve(collision, choose(collision, "source"));
assert.equal(new Set(collided.specs.map((row) => row.id)).size, 2);
assert.equal(new Set(collided.partSkus.map((row) => row.id)).size, 2);
assert.equal(new Set(collided.variantGroups[0].items.map((row) => row.id)).size, 2);
const mappedRed = collision.maps.variants["same-row"];
assert.notEqual(mappedRed, "same-row"); assert.equal(collided.partSkus[1].variantId, mappedRed); assert.equal(collided.featuredVariantId, mappedRed);
assert.equal(collided.variantGroups[0].items[1].imageAssetId, "donor-red");
assert.equal(model.plan(original.keeper, original.source).maps.variants["black-source"], "black");

const palettes = model.plan(product("palette-a", { variantGroups: [colors("colors-a", [black("bk", {}), black("bk-rd", { colorKey2: "red", colorName2: "Red", colorHex2: "#cc0000" })])] }), product("palette-b", { variantGroups: [colors("colors-b", [red("rd"), red("rd-bk", { code: "BK", colorKey2: "black", colorName2: "Black", colorHex2: "#111111" }), black("bk-slash-rd", { code: "BK/RD", colorKey2: "red", colorName2: "Red", colorHex2: "#cc0000" })])] }));
assert.equal(model.resolve(palettes, choose(palettes)).variantGroups[0].items.length, 5, "Single and ordered two-tone colorways are separate variants.");
const duplicateVariants = model.plan(product("dup-a", { variantGroups: [colors("colors-a", [black("bk", { imageAssetId: "first" })])] }), product("dup-b", { variantGroups: [colors("colors-b", [black("bk-donor", { imageAssetId: "second", detail: "Donor metadata" })])] }));
assert.equal(duplicateVariants.product.variantGroups[0].items.length, 1);
assert.ok(duplicateVariants.conflicts.some((item) => item.key.endsWith("/imageAssetId")));
assert.equal(model.resolve(duplicateVariants, choose(duplicateVariants, "source")).variantGroups[0].items[0].imageAssetId, "second");
const layouts = model.plan(product("layout-a", { variantGroups: [{ id: "layouts-a", type: "layout", label: "LAYOUT", items: [{ id: "us", code: "US", imageAssetId: "us-image" }] }] }), product("layout-b", { variantGroups: [{ id: "layouts-b", type: "layout", label: "LAYOUT", items: [{ id: "us-source", code: "US", locale: "English" }, { id: "uk", code: "UK" }] }] }));
assert.equal(model.resolve(layouts, choose(layouts)).variantGroups[0].items.length, 2);
assert.equal(layouts.maps.variants["us-source"], "us");

const knownDuplicate = model.plan(product("duplicate-keeper", { variantGroups: [colors("colors-a", [black("bk-one"), black("bk-two")])], partSkus: [{ id: "hp", code: "HP1", variantId: "bk-two" }], featuredVariantId: "bk-two" }), product("duplicate-other"));
const knownDeduplicated = model.resolve(knownDuplicate, choose(knownDuplicate));
assert.equal(knownDeduplicated.variantGroups[0].items.length, 1); assert.equal(knownDeduplicated.partSkus[0].variantId, "bk-one"); assert.equal(knownDeduplicated.featuredVariantId, "bk-one");

const badOrder = model.plan(product("order-a", { generalAvailabilityDate: "2027-04-01" }), product("order-b", { endManufacturingDate: "2026-12-01" }));
assert.throws(() => model.resolve(badOrder, choose(badOrder)), /on or after launch/);
assert.throws(() => model.resolve(model.plan(product("invalid-date", { ffsDate: "2026-02-30" }), product("other")), {}), /valid calendar/);
assert.throws(() => model.resolve(model.plan(product("dangling", { partSkus: [{ id: "hp", code: "HP1", variantId: "missing" }] }), product("other")), {}), /points to a colorway/);
assert.throws(() => model.plan(product("same"), product("same")), /different products/);
assert.throws(() => model.plan(product("dup-id", { specs: [{ id: "row", label: "First" }, { id: "row", label: "Second" }] }), product("other")), /repeated row IDs/);
assert.throws(() => model.plan(product("large", { specs: Array.from({ length: 2001 }, (_, index) => ({ id: `row-${index}`, label: `${index}` })) }), product("other")), /at most 2000/);
assert.throws(() => model.plan(JSON.parse('{"id":"bad","__proto__":{"polluted":true}}'), product("other")), /unsupported property/);
assert.throws(() => model.plan(product("bad", { custom: { constructor: "danger" } }), product("other")), /unsupported property/);
assert.throws(() => model.plan(product("bad", { price: Infinity }), product("other")), /finite/);
let invoked = false; const getter = product("getter"); Object.defineProperty(getter, "surprise", { enumerable: true, get() { invoked = true; return "secret"; } });
assert.throws(() => model.plan(getter, product("other")), /executable/); assert.equal(invoked, false);
const nested = product("depth"); let cursor = nested; for (let index = 0; index < 35; index++) cursor = cursor.next = {};
assert.throws(() => model.plan(nested, product("other")), /nested/);

const standalone = vm.createContext({});
vm.runInContext(await readFile(new URL("../../public/js/product-merge.js", import.meta.url), "utf8"), standalone);
vm.runInContext(`const p = PortfolioProductMerge.plan({id:'a', name:'A', specs:[],partSkus:[],variantGroups:[],roadmap:{}}, {id:'b', name:'A', specs:[{id:'s',label:'Weight',value:'300 g'}],partSkus:[],variantGroups:[],roadmap:{}}); if (PortfolioProductMerge.resolve(p,{}).specs[0].value !== '300 g') throw new Error('Standalone merge failed');`, standalone);
console.log("Product merge checks passed: complementary facts, explicit choices, paired dates, deterministic row identities, complete palettes, image assignments, source records, custom metadata, and safe standalone execution.");
