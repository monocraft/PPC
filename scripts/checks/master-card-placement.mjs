import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
await import("../../public/js/master-model.js");
await import("../../public/js/master-client.js");
const model = globalThis.PortfolioMasterModel, client = globalThis.PortfolioMasterClient;
const clone = value => JSON.parse(JSON.stringify(value));
const makeProduct = (id, laneId, order) => ({ id, name: id, laneId, order, imageAssetId: `image-${id}`,
  manualPosition: { x: 30, y: 40 }, customNote: "Keep this metadata", specs: [{ id: `spec-${id}`, label: "Sensor", value: "26K" }], partSkus: [], variantGroups: [], roadmap: {} });
const fixture = () => ({ version: 4, categories: [{ id: "mice", name: "Mice", board: {
  lanes: [{ id: "wired" }, { id: "wireless" }, { id: "aux" }],
  products: [makeProduct("a", "wired", 0), makeProduct("b", "wired", 1), makeProduct("c", "wired", 2), makeProduct("t", "wireless", 0), makeProduct("u", "wireless", 1), makeProduct("d", "aux", 0)],
} }], imageAssets: [{ id: "fixture-artwork", packagePath: "images/fixture.webp" }] });
const stored = (manifest, id) => manifest.categories[0].board.products.find(product => product.id === id);
const changeFor = (manifest, id, placement, patch = {}) => {
  const snapshot = model.snapshot(manifest), entry = snapshot.products.find(product => product.productId === id);
  const lanes = [...new Set([entry.values.cardPlacement.laneId, placement.laneId])];
  return { productId: id, categoryId: entry.categoryId, laneId: entry.laneId, base: entry.values, baseRevisions: entry.revisions,
    patch: { ...patch, cardPlacement: placement }, placementLaneVersions: lanes.map(laneId => ({ laneId, version: model.laneVersion(snapshot.products, entry.categoryId, laneId) })) };
};
const apply = (manifest, changes) => model.mergeChanges(manifest, changes, { requestId: randomUUID(), actor: "Fixture editor", now: "2026-10-13T12:00:00.000Z" });

assert.equal(model.validateValues({}).cardPlacement, null);
const original = makeProduct("preserve", "wired", 0);
assert.deepEqual(model.applyProductValues(original, { cardPlacement: null }).manualPosition, original.manualPosition);
assert.deepEqual(model.applyProductValues(original, { cardPlacement: { laneId: "wired", order: 0 } }).manualPosition, original.manualPosition);
assert.equal(model.applyProductValues(original, { cardPlacement: { laneId: "wireless", order: 1 } }).manualPosition, undefined);
for (const invalid of [{ laneId: "wired", order: -1 }, { laneId: "wired", order: .5 }, { laneId: "wired", order: Infinity }, { laneId: "wired", order: 30001 }, { laneId: "constructor", order: 0 }, { laneId: "wired", order: 0, x: 4 }]) assert.throws(() => model.validateValues({ cardPlacement: invalid }));
const values = model.productValues(original), mine = model.patchValues(values, { cardPlacement: { laneId: "wireless", order: 2 } });
assert.deepEqual(model.diffOperations(values, mine).map(operation => operation.path), ["cardPlacement"]);
const competing = model.patchValues(values, { cardPlacement: { laneId: "wired", order: 1 } });
const plan = model.planMerge(values, mine, competing);
assert.deepEqual(plan.conflicts.map(conflict => conflict.path), ["cardPlacement"]);
assert.deepEqual(model.resolveConflicts(plan, { cardPlacement: "mine" }).cardPlacement, mine.cardPlacement);
assert.deepEqual(model.resolveConflicts(plan, { cardPlacement: "master" }).cardPlacement, competing.cardPlacement);

{
  const manifest = fixture(), before = JSON.stringify(manifest);
  const result = apply(manifest, [changeFor(manifest, "a", { laneId: "wireless", order: 2 })]);
  assert.equal(result.conflicts.length, 0);
  assert.equal(stored(result.manifest, "a").laneId, "wireless");
  assert.equal(stored(result.manifest, "b").order, 0);
  assert.equal(stored(result.manifest, "c").order, 1);
  for (const id of ["a", "b", "c"]) {
    const record = result.history.find(item => item.productId === id && item.path === "cardPlacement");
    assert.deepEqual(record.after, model.productValues(stored(result.manifest, id)).cardPlacement);
    assert.ok(model.snapshot(result.manifest).products.find(item => item.productId === id).revisions.cardPlacement > 0);
    assert.equal(stored(result.manifest, id).manualPosition, undefined);
    assert.deepEqual(stored(result.manifest, id).specs, stored(manifest, id).specs);
    assert.equal(stored(result.manifest, id).imageAssetId, stored(manifest, id).imageAssetId);
  }
  assert.equal(result.savedProducts, 3, "all renumbered neighbors are represented in the atomic receipt");
  const annotated = model.mergeChanges(manifest, [changeFor(manifest, "a", { laneId: "wireless", order: 2 })], { actorSource: "self-reported" });
  assert.equal(annotated.history.length, result.history.length);
  assert(annotated.history.every(record => record.actorSource === "self-reported"), "secondary lane renumbering receives attribution before history is bounded");
  assert.deepEqual(model.snapshot(annotated.manifest).products, model.snapshot(result.manifest).products, "attribution preserves placement values and field revisions");
  assert.deepEqual(result.manifest.imageAssets, manifest.imageAssets);
  assert.equal(JSON.stringify(manifest), before);
  assert.throws(() => apply(manifest, [changeFor(manifest, "a", { laneId: "missing", order: 0 })]), /lane/);
  assert.throws(() => apply(manifest, [{ ...changeFor(manifest, "a", { laneId: "wireless", order: 2 }), categoryId: "other" }]), /category/);
  assert.throws(() => apply(manifest, [{ ...changeFor(manifest, "a", { laneId: "wireless", order: 2 }), placementLaneVersions: [] }]), /versions/);
}
{
  const manifest = fixture();
  const result = apply(manifest, [changeFor(manifest, "a", { laneId: "wireless", order: 2 }), changeFor(manifest, "b", { laneId: "wireless", order: 3 }), changeFor(manifest, "c", { laneId: "wireless", order: 4 })]);
  assert.equal(result.conflicts.length, 0, "tail positions are checked against projected batch membership");
  assert.deepEqual(["t", "u", "a", "b", "c"].map(id => stored(result.manifest, id).order), [0, 1, 2, 3, 4]);
  assert.throws(() => apply(manifest, [changeFor(manifest, "a", { laneId: "wireless", order: 20 })]), /position/);
}
{
  const manifest = fixture(), stale = changeFor(manifest, "d", { laneId: "wireless", order: 2 });
  const first = apply(manifest, [changeFor(manifest, "a", { laneId: "wireless", order: 2 })]).manifest;
  const conflict = apply(first, [stale]);
  assert.equal(conflict.savedFields, 0);
  assert.equal(conflict.manifest, first);
  assert.equal(conflict.conflicts[0].path, "cardPlacement");
  assert.equal(conflict.conflicts[0].reason, "lane-order-changed", "another product entering the target lane is fenced even if this product itself did not change");
  const independent = apply(manifest, [{ productId: "a", base: model.productValues(stored(manifest, "a")), patch: { name: "New name" } }]).manifest;
  assert.equal(apply(independent, [changeFor(manifest, "a", { laneId: "wireless", order: 2 })]).conflicts.length, 0, "name/spec edits do not invalidate lane-only fingerprints");
  const oldBase = clone(model.productValues(stored(first, "a"))); delete oldBase.cardPlacement;
  const oldClient = apply(first, [{ productId: "a", base: oldBase, patch: { price: 149 } }]);
  assert.equal(stored(oldClient.manifest, "a").laneId, "wireless");
  assert.equal(stored(oldClient.manifest, "a").order, 2);
}

function harness({ legacyBaseline = false, oldService = false } = {}) {
  let remote = fixture(), local = clone(remote.categories[0].board.products).map(product => ({ ...product, categoryId: "mice" }));
  let baseline = clone(model.snapshot(remote).products), hook = null, latestHook = null, failReply = false;
  if (legacyBaseline) for (const entry of baseline) delete entry.values.cardPlacement;
  const calls = [], receipts = new Map();
  const snapshot = () => {
    const value = model.snapshot(remote);
    if (oldService) { delete value.cardPlacementVersion; for (const entry of value.products) delete entry.values.cardPlacement; }
    return value;
  };
  const adapter = { getProducts: () => local, getBaselineProducts: () => baseline, setBaselineProducts: value => { baseline = clone(value); },
    applyProductValues: updates => { for (const update of updates) {
      const index = local.findIndex(product => product.id === update.productId);
      if (update.kind === "create") local.push({ ...model.applyProductValues({ id: update.productId, laneId: update.laneId }, update.values), categoryId: update.categoryId });
      else if (update.kind === "delete") local.splice(index, 1);
      else local[index] = model.applyProductValues(local[index], update.values);
    } } };
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body: clone(body) });
    if (url.endsWith("/latest")) {
      const beforeLatest = latestHook; latestHook = null;
      await beforeLatest?.();
      return Response.json({ snapshot: snapshot() });
    }
    if (receipts.has(body.requestId)) return Response.json({ ...receipts.get(body.requestId), snapshot: snapshot(), alreadySaved: true });
    if (oldService) for (const change of body.changes) assert.equal(Object.hasOwn(change.mine || {}, "cardPlacement"), false, "legacy creation requests cannot contain unsupported placement fields");
    await hook?.(); hook = null;
    const result = apply(remote, body.changes);
    if (result.conflicts.length) return Response.json({ code: "MASTER_CONFLICT", conflicts: result.conflicts, snapshot: snapshot() }, { status: 409 });
    remote = result.manifest;
    const response = { savedFields: result.savedFields, savedProducts: result.savedProducts }; receipts.set(body.requestId, response);
    if (failReply) { failReply = false; throw new Error("Synthetic lost reply"); }
    return Response.json({ ...response, snapshot: snapshot() });
  };
  const session = client.createSession({ endpoint: "https://fixture.invalid/api/master", source: { mode: "service", team: true }, adapter, fetchImpl });
  const move = (id, laneId, order) => {
    const product = local.find(item => item.id === id), oldLane = product.laneId;
    const target = local.filter(item => item.laneId === laneId && item.id !== id).sort((a, b) => a.order - b.order);
    target.splice(order, 0, product); product.laneId = laneId;
    target.forEach((item, index) => { item.order = index; });
    if (oldLane !== laneId) local.filter(item => item.laneId === oldLane).sort((a, b) => a.order - b.order).forEach((item, index) => { item.order = index; });
  };
  return { session, calls, move, get local() { return local; }, get remote() { return remote; },
    connect: () => session.connect({ key: "synthetic-key-for-tests" }),
    reload: () => client.createSession({ endpoint: "https://fixture.invalid/api/master", source: { mode: "service", team: true }, adapter, fetchImpl }),
    remoteMove: (id, laneId, order) => { remote = apply(remote, [changeFor(remote, id, { laneId, order })]).manifest; },
    beforeSave: value => { hook = value; }, beforeLatest: value => { latestHook = value; }, loseReply: () => { failReply = true; } };
}
{
  const h = harness({ legacyBaseline: true });
  assert.equal(h.session.track().length, 0, "legacy clean cards cannot become a mass placement draft");
  h.move("a", "wireless", 2); await h.connect();
  assert.equal(h.local.find(product => product.id === "a").laneId, "wireless");
  assert.ok(h.session.track().every(change => Object.keys(change.patch).join() === "cardPlacement"));
  await h.session.save();
  assert.equal(h.session.track().length, 0);
  assert.equal(stored(h.remote, "a").laneId, "wireless");
  const reopened = h.reload(); await reopened.connect({ key: "synthetic-key-for-tests" });
  assert.equal(reopened.track().length, 0);
}
for (const choice of ["mine", "master", "cancel"]) {
  const h = harness(); await h.connect(); h.move("d", "wireless", 2); h.remoteMove("a", "wireless", 2);
  let reviewed = 0;
  const result = await h.session.save({ resolveConflicts: conflicts => {
    reviewed++; assert.equal(conflicts[0].reason, "lane-order-changed");
    return choice === "cancel" ? null : Object.fromEntries(conflicts.map(conflict => [conflict.key, choice]));
  } });
  assert.equal(reviewed, 1);
  if (choice === "cancel") { assert.equal(result.cancelled, true); assert.equal(stored(h.remote, "d").laneId, "aux"); assert.ok(h.session.track().length); }
  else {
    assert.equal(h.session.track().length, 0);
    assert.equal(stored(h.remote, "d").laneId, choice === "mine" ? "wireless" : "aux");
    if (choice === "mine") { assert.equal(stored(h.remote, "d").order, 2); assert.equal(stored(h.remote, "a").order, 3); }
  }
}
{
  const manifest = fixture();
  manifest.masterSync = { revision: Number.MAX_SAFE_INTEGER - 700, products: {} };
  const changes = [changeFor(manifest, "a", { laneId: "wireless", order: 2 }), ...Array.from({ length: 499 }, (_, index) => ({
    kind: "create", productId: `new-${index}`, categoryId: "mice", laneId: "wireless", mine: model.productValues(makeProduct(`new-${index}`, "wireless", index + 3)),
  }))];
  const result = apply(manifest, changes);
  assert.ok(Number.isSafeInteger(result.manifest.masterSync.revision), "a mixed500-row placement/create transaction cannot exceed the revision integer ceiling");
  assert.ok(result.history.every(item => item.kind !== "create" || !result.history.some(other => other.productId === item.productId && other.path === "cardPlacement")), "newly created rows do not duplicate their complete creation placement in extra history");
}
{
  const h = harness({ legacyBaseline: true, oldService: true }); await h.connect(); h.move("a", "wireless", 2);
  await assert.rejects(h.session.save(), { code: "PLACEMENT_UNAVAILABLE" });
  assert.equal(h.calls.filter(call => call.url.endsWith("/save")).length, 0);
  assert.equal(h.local.find(product => product.id === "a").laneId, "wireless");
}
{
  const h = harness(); await h.connect(); h.session.adoptLocalBaseline(); h.move("a", "wireless", 2);
  assert.equal(h.session.getState().hasKey, true, "Choosing a local copy retains access rather than asking for the key again.");
  assert.equal(h.session.getState().snapshot, null, "A newly adopted local baseline has unknown service placement capability.");
  const localBefore = clone(h.local), latestBefore = h.calls.filter(call => call.url.endsWith("/latest")).length;
  const originalRemoteName = h.local.find(product => product.id === "b").name;
  stored(h.remote, "b").name = "Synthetic accepted remote name";
  h.beforeSave(() => assert.equal(h.local.find(product => product.id === "b").name, originalRemoteName, "The capability lookup does not apply remote values or silently replace the pending draft baseline before the reviewed save."));
  const result = await h.session.save();
  assert.equal(result.saved, true);
  assert.equal(h.calls.filter(call => call.url.endsWith("/latest")).length, latestBefore + 1, "An explicit Save resolves unknown capability with exactly one latest request.");
  assert.equal(h.calls.filter(call => call.url.endsWith("/save")).length, 1);
  assert.equal(h.session.track().length, 0, "A capable service accepts the retained local placement draft without a reconnect/discard loop.");
  assert.equal(stored(h.remote, "a").laneId, "wireless");
  assert.equal(h.local.find(product => product.id === "b").name, "Synthetic accepted remote name", "Normal acknowledgement still reconciles independently accepted remote facts.");
  assert.deepEqual(h.local.map(product => ({ id: product.id, specs: product.specs, imageAssetId: product.imageAssetId, customNote: product.customNote })), localBefore.map(product => ({ id: product.id, specs: product.specs, imageAssetId: product.imageAssetId, customNote: product.customNote })), "Capability discovery preserves local product facts and image references.");
}
{
  const h = harness(); await h.connect(); h.session.adoptLocalBaseline(); h.move("a", "wireless", 2);
  const draft = clone(h.session.track()), localBefore = clone(h.local), latestBefore = h.calls.filter(call => call.url.endsWith("/latest")).length;
  h.beforeLatest(() => { throw new Error("Synthetic capability lookup failure"); });
  await assert.rejects(h.session.save(), { code: "UNAVAILABLE" });
  assert.equal(h.calls.filter(call => call.url.endsWith("/latest")).length, latestBefore + 1);
  assert.equal(h.calls.filter(call => call.url.endsWith("/save")).length, 0, "Failed discovery cannot send an unverified placement write.");
  assert.deepEqual(h.local, localBefore); assert.deepEqual(h.session.track(), draft, "A failed lookup retains every pending placement and its comparison baseline.");
  assert.equal(h.session.getState().busy, false); assert.equal(h.session.getState().hasKey, true);
  await h.session.save(); assert.equal(h.session.track().length, 0, "Retry can discover capability and share the same draft after a lookup failure.");
}
{
  const h = harness({ legacyBaseline: true, oldService: true }); await h.connect(); h.session.adoptLocalBaseline(); h.move("a", "wireless", 2);
  const draft = clone(h.session.track()), localBefore = clone(h.local), latestBefore = h.calls.filter(call => call.url.endsWith("/latest")).length;
  await assert.rejects(h.session.save(), { code: "PLACEMENT_UNAVAILABLE" });
  assert.equal(h.calls.filter(call => call.url.endsWith("/latest")).length, latestBefore + 1, "A real old service is identified from a fresh response, not a missing local snapshot.");
  assert.equal(h.calls.filter(call => call.url.endsWith("/save")).length, 0);
  assert.deepEqual(h.local, localBefore); assert.deepEqual(h.session.track(), draft, "Known unsupported placement remains a reviewable local draft.");
  assert.equal(h.session.getState().busy, false);
}
{
  const h = harness(); await h.connect(); h.session.adoptLocalBaseline(); h.move("a", "wireless", 2);
  let release, reached;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { reached = resolve; });
  h.beforeLatest(async () => { reached(); await gate; });
  const first = h.session.save();
  await Promise.race([started, first.then(() => { throw new Error("Save completed before its controlled capability request."); })]);
  try {
    assert.equal(h.session.getState().busy, true, "Capability discovery is inside the save's busy guard.");
    await assert.rejects(h.session.save(), /already updating/i, "A second Save cannot race the capability lookup and publish duplicate changes.");
  } finally { release(); }
  await first;
  assert.equal(h.calls.filter(call => call.url.endsWith("/save")).length, 1);
  assert.equal(h.session.track().length, 0);
}
for (const interruptedBy of ["baseline", "access"]) {
  const h = harness(); await h.connect(); h.session.adoptLocalBaseline(); h.move("a", "wireless", 2);
  const draft = clone(h.session.track()), localBefore = clone(h.local);
  let release, reached;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { reached = resolve; });
  h.beforeLatest(async () => { reached(); await gate; });
  const first = h.session.save();
  await Promise.race([started, first.then(() => { throw new Error("Save completed before its controlled capability request."); })]);
  if (interruptedBy === "baseline") h.session.adoptLocalBaseline();
  else h.session.disconnect();
  release();
  await assert.rejects(first, interruptedBy === "baseline" ? /workspace changed/i : { code: "MASTER_CONNECTION_CHANGED" });
  assert.equal(h.calls.filter(call => call.url.endsWith("/save")).length, 0, "A stale capability response cannot publish after the baseline or connection changes.");
  assert.deepEqual(h.local, localBefore); assert.deepEqual(h.session.track(), draft);
  assert.equal(h.session.getState().busy, false);
}
{
  const h = harness(); await h.connect(); h.move("a", "wireless", 2); h.loseReply();
  await assert.rejects(h.session.save(), { code: "UNAVAILABLE" });
  const result = await h.session.save();
  assert.equal(result.alreadySaved, true);
  const saves = h.calls.filter(call => call.url.endsWith("/save"));
  assert.deepEqual(saves[0].body, saves[1].body);
  assert.equal(h.session.track().length, 0);
}
{
  const h = harness(); await h.connect(); h.move("a", "wireless", 2);
  h.beforeSave(() => h.move("a", "wireless", 0));
  await h.session.save();
  assert.equal(stored(h.remote, "a").order, 2);
  assert.equal(h.local.find(product => product.id === "a").order, 0);
  assert.ok(h.session.track().some(change => change.productId === "a" && change.patch.cardPlacement.order === 0), "a newer local reorder remains pending after an older save response");
}
console.log("Shared card placement checks passed: atomic lane/order conflicts, bounded existing-lane validation, projected batch tails, affected-lane fingerprints, revisioned renumbering, legacy migration/old-client preservation, explicit mine/master/cancel, reload, retained-access capability discovery with guarded retry/old-service preservation, lost replies and newer in-flight drafts.");
