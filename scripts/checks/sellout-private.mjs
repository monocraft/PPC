import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
await import("../../public/js/package-codec.js");
await import("../../public/js/sellout-model.js");
await import("../../public/js/sellout-ppc.js");
await import("../../public/js/sellout-private.js");
const codec = globalThis.PortfolioPackage, api = globalThis.PPCSelloutPrivate;
const encoder = new TextEncoder();
const fixture = {
  snapshot: {
    schemaVersion: 1, title: "ANALYTICS FIXTURE SECRET 57914", sourceUrl: "", sheet: "Fixture", asOf: "2026-09-20", warnings: [],
    periods: ["2026-09-06", "2026-09-13", "2026-09-20"].map(date => ({ date, quarter: "FY26Q4", originalHeader: date, inferred: false })),
    rows: [
      { store: "North", sku: "FIX01AA", product: "Alpha", category: "Audio", lifetime: 3, values: [-4, 0, 7] },
      { store: "South", sku: "FIX02AA", product: "Beta", category: "Input", lifetime: null, values: [null, 0, null] },
    ],
    audit: { recordCount: 2, sourceSha256: "a".repeat(64), missingCellCount: 2 },
  },
  prices: { FIX01AA: { msrp: 0, source: "Synthetic zero price" }, FIX02AA: { msrp: null, source: "Not mapped" }, UNUSED: { msrp: 10, source: "Unrelated stale mapping" } },
  shortlist: [{ key: "synthetic-opportunity", title: "Review Alpha", text: "Fixture planning note", sku: "FIX01AA", owner: "Fixture owner", targetMonth: "2027-02", notes: "Fixture next step", period: { start: "2026-09-06", end: "2026-09-20", comparison: "none", coverage: "common", stores: ["North"], products: ["FIX01AA"], priceBand: "Under $50" } }],
  ppcProjection: { schemaVersion: 1, currency: "USD", authority: "current-local-ppc", prices: [{ sku: "FIX01AA", msrp: 0, currency: "USD", sourceProductId: "fixture-product", priceSource: "saved-product", matchedSku: "FIX01AA", match: "exact" }], conflicts: [], coverage: { requested: 1, matched: 1, priced: 1, missing: 0, conflicts: 0 } },
  pricingSource: { title: "PPC fixture", date: "2026-09-20", authority: "backup", note: "Synthetic backup, not live pricing." },
};
const before = structuredClone(fixture), key = codec.generateKey(), wrongKey = codec.generateKey();
assert.ok(Object.isFrozen(api));
const sanitized = api.sanitizeWorkspace(fixture);
assert.equal(Object.hasOwn(sanitized.prices, "UNUSED"), false, "Protect only price rows in the imported analytics scope.");
const encrypted = await api.encrypt(fixture, key), encryptedBefore = new Uint8Array(encrypted);
assert.ok(encrypted instanceof Uint8Array && codec.isEncrypted(encrypted));
assert.equal(Buffer.from(encrypted).includes(Buffer.from(fixture.snapshot.title)), false, "Published ciphertext must not contain the plaintext report title.");
assert.equal(Buffer.from(encrypted).includes(Buffer.from(key)), false, "The package key must never be included in its ciphertext envelope.");
const restored = await api.decrypt(encrypted, key);
assert.deepEqual(restored, sanitized);
assert.deepEqual(restored.snapshot.rows[0].values, [-4, 0, 7], "Negative adjustments and observed zeros remain exact.");
assert.deepEqual(restored.snapshot.rows[1].values, [null, 0, null], "Missing observations must stay separate from zero.");
assert.equal(restored.prices.FIX01AA.msrp, 0);
assert.equal(restored.prices.FIX02AA.msrp, null);
assert.equal(restored.pricingSource.note, fixture.pricingSource.note);
assert.equal(restored.shortlist[0].owner, fixture.shortlist[0].owner);
assert.equal(restored.shortlist[0].targetMonth, "2027-02");
assert.equal(restored.shortlist[0].notes, fixture.shortlist[0].notes);
assert.equal(restored.shortlist[0].period.priceBand, "Under $50");
assert.deepEqual(fixture, before, "Protecting data must not alter the current analytics workspace.");
assert.deepEqual(encrypted, encryptedBefore, "Unlocking must not change the supplied protected package bytes.");
restored.snapshot.rows[0].values[0] = 999;
assert.equal((await api.decrypt(encrypted, key)).snapshot.rows[0].values[0], -4, "Unlocked workspaces are independent data copies.");
assert.notDeepEqual(await api.encrypt(fixture, key), encrypted, "The existing codec uses a fresh nonce for every protection operation.");
await assert.rejects(api.decrypt(encrypted, wrongKey), /unlock|key/i);
const tampered = new Uint8Array(encrypted); tampered[tampered.length - 1] ^= 1;
await assert.rejects(api.decrypt(tampered, key), /unlock|changed/i);
await assert.rejects(api.encrypt(fixture, "not-a-key"), /key/i);
await assert.rejects(api.decrypt(new Uint8Array(codec.MAX_PACKAGE_BYTES + 1), key), /size limit/i);

const rawPortfolio = codec.createZip([{ name: "portfolio.json", data: encoder.encode('{"version":4,"categories":[]}') }]);
await assert.rejects(api.decrypt(rawPortfolio, key), /protected|plaintext/i);
await assert.rejects(api.decrypt(await codec.encrypt(rawPortfolio, key), key), /another module/i);
const makeEnvelope = async envelope => codec.encrypt(codec.createZip([{ name: "analytics.json", data: encoder.encode(JSON.stringify(envelope)) }]), key);
await assert.rejects(api.decrypt(await makeEnvelope({ kind: "portfolio", schemaVersion: 1, workspace: fixture }), key), /module|schema/i);
await assert.rejects(api.decrypt(await makeEnvelope({ kind: api.kind, schemaVersion: 2, workspace: fixture }), key), /module|schema/i);
const extraEntry = codec.createZip([{ name: "analytics.json", data: encoder.encode("{}") }, { name: "portfolio.json", data: encoder.encode("{}") }]);
await assert.rejects(api.decrypt(await codec.encrypt(extraEntry, key), key), /another module/i);
const invalidUtf8 = codec.createZip([{ name: "analytics.json", data: new Uint8Array([255]) }]);
await assert.rejects(api.decrypt(await codec.encrypt(invalidUtf8, key), key), /could not be read/i);

for (const msrp of [-1, "12", Infinity, NaN, {}, undefined]) {
  const invalid = structuredClone(fixture); invalid.prices.FIX01AA.msrp = msrp;
  await assert.rejects(api.encrypt(invalid, key), /MSRP|numeric|JSON/i);
}
const foreignCurrency = structuredClone(fixture); foreignCurrency.prices.FIX01AA.currency = "EUR";
assert.throws(() => api.sanitizeWorkspace(foreignCurrency), /USD/i);
const invalidText = structuredClone(fixture); invalidText.snapshot.rows[0].store = 1;
assert.throws(() => api.sanitizeWorkspace(invalidText), /snapshot is invalid/i);
const invalidShortlist = structuredClone(fixture); invalidShortlist.shortlist[0].period.end = "2026-02-30";
assert.throws(() => api.sanitizeWorkspace(invalidShortlist), /date/i);
const duplicateShortlist = structuredClone(fixture); duplicateShortlist.shortlist.push(duplicateShortlist.shortlist[0]);
assert.throws(() => api.sanitizeWorkspace(duplicateShortlist), /duplicate/i);
const invalidProjection = structuredClone(fixture); invalidProjection.ppcProjection.packageKey = "secret-fixture";
assert.throws(() => api.sanitizeWorkspace(invalidProjection), /projection is invalid/i);
const credentials = structuredClone(fixture); credentials.packageKey = key;
assert.throws(() => api.sanitizeWorkspace(credentials), /credentials|separate/i);
const unknownSnapshotField = structuredClone(fixture); unknownSnapshotField.snapshot.privateConnection = { token: "EXCLUDED FIXTURE" };
assert.equal(Object.hasOwn(api.sanitizeWorkspace(unknownSnapshotField).snapshot, "privateConnection"), false);
const unsafePriceKey = structuredClone(fixture); Object.defineProperty(unsafePriceKey.prices, "__proto__", { value: { msrp: 1, source: "Fixture" }, enumerable: true });
assert.throws(() => api.sanitizeWorkspace(unsafePriceKey), /unsafe/i);
const sparse = structuredClone(fixture); delete sparse.snapshot.rows[0].values[1];
assert.throws(() => api.sanitizeWorkspace(sparse), /explicit null/i);
const circular = structuredClone(fixture); circular.snapshot.audit.self = circular.snapshot.audit;
assert.throws(() => api.sanitizeWorkspace(circular), /circular/i);
const oversizedMetadata = structuredClone(fixture); oversizedMetadata.snapshot.audit.notes = Array(5000).fill("x".repeat(16384));
assert.throws(() => api.sanitizeWorkspace(oversizedMetadata), /size limit/i, "Oversized repeated metadata is bounded before building a large JSON string.");
let getterCalls = 0;
const computed = structuredClone(fixture); Object.defineProperty(computed.snapshot, "periods", { enumerable: true, get() { getterCalls++; return fixture.snapshot.periods; } });
assert.throws(() => api.sanitizeWorkspace(computed), /computed/i);
assert.equal(getterCalls, 0, "Protecting a backup cannot execute supplied getters.");

const helperSource = await readFile(new URL("../../public/js/sellout-private.js", import.meta.url), "utf8");
assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(|\b(?:localStorage|sessionStorage|indexedDB)\b|\bconsole\s*\./.test(helperSource), "The pure protection helper must not send, persist, or log private data.");
console.log("Private analytics checks passed: existing PPC authenticated encryption, zero/null/negative preservation, independent round trips, wrong-key/tamper rejection, module separation, safe scoped prices/provenance, bounded input and credential-free protection.");
