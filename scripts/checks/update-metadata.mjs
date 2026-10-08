import assert from "node:assert/strict";
await import("../../public/js/master-model.js");
await import("../../public/js/package-codec.js");

const model = globalThis.PortfolioMasterModel, codec = globalThis.PortfolioPackage;
const clone = (value) => structuredClone(value);
const seed = { version: 4, packageInfo: { version: 1, updatedAt: "2026-01-01T00:00:00.000Z", comments: "Initial package notes" },
  categories: [{ id: "pc", board: { lanes: [{ id: "wired" }], products: [
    { id: "one", laneId: "wired", name: "Headset", specs: [], partSkus: [], variantGroups: [] },
    { id: "two", laneId: "wired", name: "Microphone", specs: [], partSkus: [], variantGroups: [] },
  ] } }] };
const change = (manifest, productId, patch) => {
  const entry = model.snapshot(manifest).products.find((item) => item.productId === productId);
  return { productId, base: entry.values, baseRevisions: entry.revisions, patch };
};
const before = clone(seed), note = "Launch plan checked.\n<svg onload=alert(1)> stays plain text.";
const first = model.mergeChanges(seed, [change(seed, "one", { codename: "Accepted" })],
  { requestId: "save-first", reason: note, now: "2026-10-08T01:00:00Z" });
assert.equal(first.savedProducts, 1);
assert.deepEqual(first.manifest.packageInfo, { version: 1, updatedAt: "2026-10-08T01:00:00.000Z", comments: note });
assert.deepEqual(codec.normalizePackageInfo(first.manifest.packageInfo), first.manifest.packageInfo);
assert.deepEqual(model.snapshot(first.manifest).packageInfo, first.manifest.packageInfo, "a peer snapshot includes the accepted save date and literal note");
assert.deepEqual(seed, before, "neither save nor metadata derivation mutates the initial manifest");

const second = model.mergeChanges(first.manifest, [change(seed, "two", { codename: "Independent stale-base edit" })],
  { requestId: "save-second", reason: "Updated microphone availability.", now: "2026-10-08T01:01:00.000Z" });
assert.equal(second.savedProducts, 1);
assert.equal(second.manifest.packageInfo.comments, "Updated microphone availability.", "the later accepted independent update owns the footer note");
assert.equal(second.manifest.packageInfo.updatedAt, "2026-10-08T01:01:00.000Z");

const noOp = model.mergeChanges(second.manifest, [change(second.manifest, "one", { codename: "Accepted" })],
  { requestId: "save-noop", reason: "No-op must not replace the note.", now: "2026-10-08T02:00:00.000Z" });
assert.equal(noOp.savedFields, 0); assert.equal(noOp.manifest, second.manifest);
assert.deepEqual(noOp.manifest.packageInfo, second.manifest.packageInfo);
const rejected = model.mergeChanges(second.manifest, [change(seed, "one", { codename: "Rejected stale edit" })],
  { requestId: "save-rejected", reason: "Rejected note", now: "2026-10-08T02:00:00.000Z" });
assert.equal(rejected.conflicts.length, 1); assert.equal(rejected.manifest, second.manifest);
assert.deepEqual(rejected.manifest.packageInfo, second.manifest.packageInfo);

const many = model.mergeChanges(second.manifest, [change(second.manifest, "one", { codename: "Two changes", name: "Renamed headset" }), change(second.manifest, "two", { codename: "Third change" })],
  { requestId: "save-many", now: "2026-10-08T01:02:00.000Z", reason: " \n " });
assert.equal(many.savedProducts, 2); assert.equal(many.savedFields, 3);
assert.equal(many.manifest.packageInfo.comments, "2 products updated.", "an empty note describes distinct changed products, not field count");
const legacy = clone(many.manifest); legacy.packageInfo = clone(seed.packageInfo);
const legacyBefore = clone(legacy);
assert.deepEqual(model.latestPackageInfo(legacy), many.manifest.packageInfo, "accepted legacy history corrects stale seed information before another save");
assert.deepEqual(legacy, legacyBefore, "reading legacy metadata never rewrites the manifest");
const legacyWithNote = clone(second.manifest); legacyWithNote.packageInfo = clone(seed.packageInfo);
assert.deepEqual(model.latestPackageInfo(legacyWithNote), second.manifest.packageInfo);
for (const milliseconds of [0, 1, 500, 1000]) {
  const legacySaveStamp = clone(legacyWithNote);
  legacySaveStamp.packageInfo.updatedAt = new Date(Date.parse(second.manifest.packageInfo.updatedAt) + milliseconds).toISOString();
  assert.deepEqual(model.latestPackageInfo(legacySaveStamp), second.manifest.packageInfo, "the old automatic save stamp cannot preserve stale initial comments within its one-second window");
  assert.equal(legacySaveStamp.packageInfo.comments, seed.packageInfo.comments, "the legacy repair changes only the returned information");
}
const explicitExport = clone(legacyWithNote);
explicitExport.packageInfo = { version: 1, updatedAt: "2026-10-09T00:00:00.000Z", comments: "Reviewed export notes." };
assert.deepEqual(model.latestPackageInfo(explicitExport), explicitExport.packageInfo, "a genuinely newer explicit export retains its date and note");
explicitExport.packageInfo.updatedAt = "2026-10-08T01:01:01.001Z";
assert.deepEqual(model.latestPackageInfo(explicitExport), explicitExport.packageInfo, "an explicit export beyond the conservative legacy save window remains authoritative");

const noisy = clone(legacyWithNote), accepted = clone(noisy.masterSync.history.at(-1));
noisy.masterSync.revision = 100;
for (const invalid of [
  null, [], "not a record", { ...accepted, revision: -1 }, { ...accepted, revision: 101 },
  { ...accepted, productId: "__proto__" }, { ...accepted, at: "2026-02-30T00:00:00.000Z" },
  { ...accepted, at: "not a date" }, { ...accepted, path: "", field: "" },
  { ...accepted, revision: 99, status: "rejected" }, { ...accepted, revision: 99, kind: "retry" },
  { ...accepted, revision: 99, kind: "cancel" }, { ...accepted, revision: 99, kind: "noop" },
  { ...accepted, revision: 99, accepted: false }, { ...accepted, revision: 99, changed: false },
  { ...accepted, revision: 99, before: "same", after: "same", beforeExists: true, afterExists: true },
]) noisy.masterSync.history.push(invalid);
assert.deepEqual(model.latestPackageInfo(noisy), second.manifest.packageInfo, "malformed, rejected, cancelled, retried, and no-op records cannot advance the footer");

const longNote = `  ${"x".repeat(2100)}\nTrailing text`;
const bounded = model.mergeChanges(seed, [change(seed, "one", { name: "Long note" })],
  { requestId: "save-bounded", now: "2026-10-08T03:00:00.000Z", reason: longNote });
assert.equal(bounded.manifest.packageInfo.comments, longNote.slice(0, 2000));
const malformedReason = clone(bounded.manifest); malformedReason.packageInfo = null; malformedReason.masterSync.history[0].reason = { privatePath: "do not display" };
assert.equal(model.latestPackageInfo(malformedReason).comments, "1 product updated.");
assert.equal(model.latestPackageInfo({ packageInfo: { version: 2, updatedAt: "bad", comments: "bad" }, masterSync: [] }), null);
assert.equal(model.latestPackageInfo({ masterSync: { history: [null] } }), null);
const detached = model.latestPackageInfo(first.manifest);
assert.notEqual(detached, first.manifest.packageInfo); assert.ok(Object.isFrozen(detached));

const key = codec.generateKey(), encoder = new TextEncoder(), decoder = new TextDecoder();
const bytes = await codec.encrypt(codec.createZip([{ name: "portfolio.json", data: encoder.encode(JSON.stringify(second.manifest)) }]), key);
assert.ok(!Buffer.from(bytes).includes(Buffer.from(second.manifest.packageInfo.comments)), "accepted update comments stay encrypted inside a published package");
const restored = JSON.parse(decoder.decode(codec.readZip(await codec.decrypt(bytes, key)).get("portfolio.json")));
assert.deepEqual(model.latestPackageInfo(restored), second.manifest.packageInfo, "the accepted update date and note survive encryption and package reloading");
console.log("Update metadata checks passed: accepted save notes and dates, distinct product summaries, peer snapshots, legacy history, newer exports, rejected/no-op stability, malformed records, bounded notes, immutable reads, and encrypted package round trips.");
