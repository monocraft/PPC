import assert from "node:assert/strict";

await import("../ascm-import.js");

const importer = globalThis.ASCMImporter;
assert.ok(importer, "ASCM importer should register on globalThis");

const rows = [
  {
    sourceRow: 14,
    category: "Headset",
    basePn: "A1AAA",
    featureId: "F-1",
    localFlag: "N",
    description: "HyperX Cloud III BLK GAM HS",
    codeName: "Harvester BLK",
    ga: "2026-01-15",
    em: "2029-12-31",
  },
  {
    sourceRow: 15,
    category: "Headset",
    basePn: "A1AAB",
    featureId: "F-2",
    localFlag: "N",
    description: "HyperX Cloud III WHT-PNK GAM HS",
    codeName: "Harvester WHT",
    ga: "2026-02-01",
    em: "2030-03-31",
  },
  {
    sourceRow: 16,
    category: "Mouse",
    basePn: "B2AAA",
    featureId: "F-3",
    localFlag: "N",
    description: "HyperX PF Has 2 WD BK Gm Ms",
    codeName: "Pulse",
    ga: "2025-04-01",
    em: "2028-06-30",
  },
  {
    sourceRow: 17,
    category: "Mouse",
    basePn: "B2AAB",
    featureId: "F-4",
    localFlag: "N",
    description: "HyperX PF Has 2 WD WHT Gm Ms",
    codeName: "Pulse",
    ga: "2025-04-15",
    em: "2028-09-30",
  },
  {
    sourceRow: 18,
    category: "Headset",
    basePn: "C3AAA",
    featureId: "F-5",
    localFlag: "N",
    description: "HyperX Cloud Mini WL BLU GAM HS",
    codeName: "Mini",
    ga: "2026-05-01",
    em: "2029-05-31",
  },
];

const groups = importer.buildProductGroups({ rows });
assert.equal(groups.length, 3, "color SKUs should collapse into product families");

const cloud = groups.find((group) => group.normalizedName === "cloud iii");
assert.ok(cloud, "Cloud III group should be derived");
assert.deepEqual(cloud.basePns, ["A1AAA", "A1AAB"]);
assert.equal(cloud.gaDate, "2026-01-15");
assert.equal(cloud.emDate, "2030-03-31");
assert.deepEqual(cloud.colorVariants.map((item) => item.canonicalCode), ["BK", "WHT/PNK"]);

const haste = groups.find((group) => group.normalizedName === "pulsefire haste 2");
assert.ok(haste, "abbreviated ASCM names should normalize to a portfolio name");
assert.equal(haste.categoryId, "mice");
assert.deepEqual(haste.colorVariants.map((item) => item.canonicalCode), ["BK", "WHT"]);

const mini = groups.find((group) => group.normalizedName === "cloud mini wireless");
assert.ok(mini, "wireless abbreviation should be preserved as product identity");
assert.equal(mini.categoryId, "lifestyle-audio");
assert.equal(mini.laneId, "wireless");
assert.equal(importer.helpers.mapAscmCategory("Headset", "HyperX Cloud Stinger 3 PS"), "console-gaming-audio");

assert.equal(importer.helpers.inferColorVariant("HyperX wired mouse"), null, "wired must not be inferred as red");
assert.equal(importer.helpers.inferColorVariant("HyperX Mouse FRS")?.colorName, "Frost");
assert.equal(importer.helpers.normalizeColorCode("BLK/RED"), "BK/RED");
assert.equal(importer.helpers.normalizeColorCode("BLACK"), "BK");
assert.equal(importer.helpers.normalizeColorCode("FROST"), "FRS");
assert.equal(importer.helpers.normalizeColorCode("8-BIT"), "8-BIT", "non-color variants must remain distinct");

const portfolio = {
  categories: [
    {
      id: "pc-gaming-audio",
      board: {
        products: [{
          id: "cloud-iii",
          name: "Cloud III",
          ascm: { basePartNumbers: ["A1AAA"] },
        }],
      },
    },
  ],
};
const match = importer.matchProductGroup(cloud, portfolio);
assert.equal(match.status, "matched");
assert.equal(match.method, "base-pn");
assert.equal(match.product.id, "cloud-iii");

const nameOnlyMatch = importer.matchProductGroup(
  { ...cloud, basePns: [], ascmKey: "different-key" },
  portfolio,
);
assert.equal(nameOnlyMatch.status, "matched");
assert.equal(nameOnlyMatch.method, "normalized-name");

const consolePortfolio = {
  categories: [{
    id: "console-gaming-audio",
    board: {
      products: [
        { id: "ps-stinger", name: "Cloud Stinger 3", specs: [{ label: "Platform", value: "Playstation" }] },
        { id: "xbox-stinger", name: "CloudX Stinger 3", specs: [{ label: "Platform", value: "Xbox" }] },
        { id: "ps-core-wireless", name: "Cloud Stinger Core Wireless PS", specs: [{ label: "Platform", value: "Playstation" }] },
        { id: "xbox-core-wireless", name: "CloudX Stinger Core Wireless Xbox", specs: [{ label: "Platform", value: "Xbox" }] },
      ],
    },
  }],
};
const platformMatch = importer.matchProductGroup({
  categoryId: "console-gaming-audio",
  displayName: "HyperX Cloud Stinger 3 PS",
  normalizedName: importer.helpers.normalizeProductName("HyperX Cloud Stinger 3 PS"),
  basePns: ["C4AAA"],
  records: [{ description: "HyperX Cloud Stinger 3 PS BLK GAM HS" }],
}, consolePortfolio);
assert.equal(platformMatch.status, "matched");
assert.equal(platformMatch.method, "platform-name");
assert.equal(platformMatch.product.id, "ps-stinger");
assert.equal(importer.helpers.normalizeProductName("HX CLST 2 Core PS"), "cloud stinger 2 core ps");

const legacyPsMatch = importer.matchProductGroup({
  categoryId: "console-gaming-audio",
  displayName: "HyperX Stinger Core W PS5 - /G",
  normalizedName: importer.helpers.normalizeProductName("HyperX Stinger Core W PS5 - /G"),
  basePns: ["C4AAB"],
  records: [{ description: "HyperX Stinger Core W PS5 - /G" }],
}, consolePortfolio);
assert.equal(legacyPsMatch.status, "matched");
assert.equal(legacyPsMatch.product.id, "ps-core-wireless");

const legacyXboxMatch = importer.matchProductGroup({
  categoryId: "console-gaming-audio",
  displayName: "HyperX CloudX Stinger C W - /G",
  normalizedName: importer.helpers.normalizeProductName("HyperX CloudX Stinger C W - /G"),
  basePns: ["C4AAC"],
  records: [{ description: "HyperX CloudX Stinger C W - /G" }],
}, consolePortfolio);
assert.equal(legacyXboxMatch.status, "matched");
assert.equal(legacyXboxMatch.product.id, "xbox-core-wireless");

console.log("ASCM importer tests passed: grouping, colors, dates, categories, and stable matching.");
