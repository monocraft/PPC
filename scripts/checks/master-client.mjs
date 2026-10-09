import assert from "node:assert/strict";
import "../../public/js/master-model.js";
import "../../public/js/master-client.js";

const model = globalThis.PortfolioMasterModel;
const client = globalThis.PortfolioMasterClient;
const endpoint = "https://master.example.org/api/master";
const clone = (value) => JSON.parse(JSON.stringify(value));
const fixture = {
  id: "product-1", name: "Team headset", price: 99, codename: "One",
  generalAvailabilityDate: "2026-10-15", ffsDate: "2026-09-20", endManufacturingDate: "2029-12-31",
  globalAnnouncementDate: "2026-10-10", webReadinessDate: "2026-10-12", finalAssetsDate: "2026-10-09",
  roadmap: { startMonth: "2026-10", launchMonth: "2026-10", endMonth: "2029-12", family: "Core", status: "in-development" },
  specs: [{ id: "spec-a", label: "Battery", value: "40 hours" }, { id: "spec-b", label: "Connectivity", value: "Wireless" }],
  partSkus: [{ id: "sku-a", code: "SKU-A", colorVariantId: "black" }],
  variantGroups: [{ id: "colors", type: "color", label: "Color", items: [{ id: "black", code: "BK", colorName: "Black", colorHex: "#000000" }] }],
};
const manifestOf = (product) => ({ version: 4, categories: [{ id: "headsets", name: "Headsets", board: { products: [product] } }] });
const initial = () => ({ ...model.snapshot(manifestOf(fixture)), revision: "initial", canWrite: true });
const key = "private-master-key";

function harness({ local = fixture, master = initial() } = {}) {
  let products = [clone(local)], baseline = clone(initial().products), remote = clone(master), sequence = 0;
  const calls = [];
  const adapter = {
    getProducts: () => products,
    getBaselineProducts: () => baseline,
    setBaselineProducts: (value) => { baseline = clone(value); },
    applyProductValues: (changes) => {
      products = products.map((product) => {
        const change = changes.find((item) => item.productId === product.id);
        return change ? model.applyProductValues(product, change.values) : product;
      });
    },
  };
  let beforeSave = null;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options: clone({ ...options, signal: undefined }) });
    assert.equal(url.includes(key), false);
    assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "error"); assert.equal(options.cache, "no-store");
    const body = JSON.parse(options.body);
    assert.equal(body.key, key);
    if (url.endsWith("/latest")) return Response.json({ snapshot: remote });
    await beforeSave?.(body);
    const plans = [], conflicts = [];
    for (const change of body.changes) {
      const target = remote.products.find((product) => product.productId === change.productId);
      const plan = model.planMerge(change.base, { ...change.base, ...change.patch }, target.values, change.baseRevisions, target.revisions);
      plans.push({ target, plan });
      conflicts.push(...plan.conflicts.map((conflict) => ({ ...conflict, productId: target.productId, productName: target.productName })));
    }
    if (conflicts.length) return Response.json({ code: "MASTER_CONFLICT", conflicts, snapshot: remote }, { status: 409 });
    for (const { target, plan } of plans) {
      for (const operation of model.diffOperations(target.values, plan.values)) target.revisions[operation.path] = ++sequence;
      target.values = clone(plan.values);
    }
    remote.revision = `master-${++sequence}`;
    return Response.json({ snapshot: remote, savedFields: plans.length });
  };
  const session = client.createSession({ endpoint, adapter, fetchImpl });
  return { session, adapter, calls,
    get products() { return products; }, get baseline() { return baseline; }, get remote() { return remote; },
    edit(patch) { products = products.map((product) => model.applyProductValues(product, { ...model.productValues(product), ...patch })); },
    remoteEdit(patch) {
      const target = remote.products[0], next = { ...target.values, ...clone(patch) };
      for (const operation of model.diffOperations(target.values, next)) target.revisions[operation.path] = ++sequence;
      target.values = next; remote.revision = `master-${++sequence}`;
    },
    onSave(callback) { beforeSave = callback; },
  };
}

assert.equal(client.normalizeEndpoint(endpoint + "/latest"), endpoint);
assert.equal(client.normalizeEndpoint("http://127.0.0.1:4173/api/master"), "http://127.0.0.1:4173/api/master");
assert.equal(client.normalizeEndpoint("https://master.example.org/api/package/latest"), endpoint);
for (const address of ["", "http://master.example.org/api/master", endpoint + "?key=secret", "https://secret:password@master.example.org/api/master", "javascript:alert(1)", endpoint + "#secret", "https://master.example.org/anything"]) assert.throws(() => client.normalizeEndpoint(address));

{
  const h = harness();
  h.edit({ generalAvailabilityDate: "2026-11-17", startMonth: "2026-11" });
  h.remoteEdit({ ffsDate: "2026-10-01" });
  await h.session.connect({ key });
  assert.equal(h.products[0].generalAvailabilityDate, "2026-11-17", "connecting preserves a stale browser draft");
  assert.equal(h.products[0].ffsDate, "2026-10-01", "connecting overlays unrelated accepted changes");
  assert.equal(h.session.track().length, 1);
  assert.equal(Object.hasOwn(h.session.track()[0].patch, "ffsDate"), false, "remote updates are never republished as local edits");
  await h.session.save({ reason: "Factory revision" });
  assert.equal(h.remote.products[0].values.generalAvailabilityDate, "2026-11-17");
  assert.equal(h.session.track().length, 0);
  const save = JSON.parse(h.calls.find((call) => call.url.endsWith("/save")).options.body);
  assert.equal(save.reason, "Factory revision");
  assert.equal(Object.hasOwn(save, "manifest"), false, "save sends narrow product changes only");
}

{
  const h = harness();
  h.edit({ generalAvailabilityDate: "2026-11-17", startMonth: "2026-11" });
  h.remoteEdit({ generalAvailabilityDate: "2026-12-15", startMonth: "2026-12" });
  await h.session.connect({ key });
  const before = clone(h.products), base = clone(h.baseline);
  let asked = 0;
  const result = await h.session.save({ resolveConflicts: async (conflicts) => { asked += 1; assert.ok(conflicts.length); return null; } });
  assert.equal(result.cancelled, true); assert.equal(asked, 1);
  assert.deepEqual(h.products, before, "cancelling retains local values");
  assert.deepEqual(h.baseline, base, "cancelling retains original conflict baseline");
  const reload = client.createSession({ endpoint, adapter: h.adapter, fetchImpl: async () => Response.json({ snapshot: h.remote }) });
  assert.equal(reload.track()[0].base.generalAvailabilityDate, "2026-10-15", "a reload retains the original comparison value");
}

{
  const h = harness();
  h.edit({ generalAvailabilityDate: "2026-11-17", startMonth: "2026-11" });
  h.remoteEdit({ generalAvailabilityDate: "2026-12-15", startMonth: "2026-12" });
  await h.session.connect({ key });
  let asked = 0;
  await h.session.save({ resolveConflicts: async (conflicts) => {
    asked += 1;
    if (asked === 1) h.remoteEdit({ generalAvailabilityDate: "2027-01-05", startMonth: "2027-01" });
    return Object.fromEntries(conflicts.map((conflict) => [conflict.key, "mine"]));
  } });
  assert.equal(asked, 2, "a new edit after the first choice requires a fresh decision");
  assert.equal(h.remote.products[0].values.generalAvailabilityDate, "2026-11-17");
  assert.equal(h.session.track().length, 0);
}

{
  const h = harness();
  h.edit({ generalAvailabilityDate: "2026-11-17", startMonth: "2026-11", ffsDate: "2026-10-01" });
  h.remoteEdit({ generalAvailabilityDate: "2026-12-15", startMonth: "2026-12" });
  await h.session.connect({ key });
  await h.session.save({ resolveConflicts: async (conflicts) => Object.fromEntries(conflicts.map((conflict) => [conflict.key, "master"])) });
  assert.equal(h.products[0].generalAvailabilityDate, "2026-12-15");
  assert.equal(h.products[0].ffsDate, "2026-10-01", "keeping a master conflict also saves unrelated local edits");
  assert.equal(h.session.track().length, 0);
}

for (const finalMasterDate of ["2027-01-05", fixture.generalAvailabilityDate]) {
  const h = harness();
  h.edit({ generalAvailabilityDate: "2026-11-17", startMonth: "2026-11" });
  h.remoteEdit({ generalAvailabilityDate: "2026-12-15", startMonth: "2026-12" });
  await h.session.connect({ key });
  let asked = 0;
  await h.session.save({ resolveConflicts: async (conflicts) => {
    asked += 1;
    if (asked === 1) h.remoteEdit({ generalAvailabilityDate: finalMasterDate, startMonth: finalMasterDate.slice(0, 7) });
    return Object.fromEntries(conflicts.map((conflict) => [conflict.key, "master"]));
  } });
  assert.equal(asked, 2, "all Keep master choices are rechecked if a team changes that date while the dialog is open");
  assert.equal(h.products[0].generalAvailabilityDate, finalMasterDate);
  assert.equal(h.remote.products[0].values.generalAvailabilityDate, finalMasterDate, "checking a master reversion never writes the old local proposal without another explicit decision");
  assert.equal(h.session.track().length, 0);
}

{
  const h = harness();
  const mine = model.productValues(fixture).specs.map((spec) => spec.id === "spec-a" ? { ...spec, value: "50 hours" } : spec);
  h.edit({ specs: mine });
  h.remoteEdit({ specs: model.productValues(fixture).specs.map((spec) => spec.id === "spec-b" ? { ...spec, value: "Wired + wireless" } : spec) });
  await h.session.connect({ key });
  assert.equal(h.products[0].specs.find((spec) => spec.id === "spec-a").value, "50 hours");
  assert.equal(h.products[0].specs.find((spec) => spec.id === "spec-b").value, "Wired + wireless");
  const described = model.describeChanges(h.session.track()[0].base, h.session.track()[0].mine);
  assert.equal(described.length, 1, "unrelated remote specification updates are excluded from the review");
  await h.session.save();
  assert.equal(h.remote.products[0].values.specs.find((spec) => spec.id === "spec-b").value, "Wired + wireless");
}

{
  const h = harness();
  h.edit({ ffsDate: "2026-10-01" }); await h.session.connect({ key });
  h.onSave(() => h.edit({ ffsDate: "2026-10-02" }));
  await h.session.save();
  assert.equal(h.remote.products[0].values.ffsDate, "2026-10-01");
  assert.equal(h.products[0].ffsDate, "2026-10-02", "an edit made while saving remains a draft");
  assert.equal(h.session.track().length, 1);
}

{
  const h = harness(), apply = h.adapter.applyProductValues;
  h.remoteEdit({ ffsDate: "2026-10-03" });
  h.adapter.applyProductValues = () => { throw new Error("Package loading is in progress"); };
  assert.throws(() => h.session.applySnapshot(h.remote), /Package loading/);
  assert.equal(h.session.getState().snapshot, null, "a blocked adapter cannot commit a master snapshot");
  assert.equal(h.session.track().length, 0, "a blocked adapter cannot advance internal baselines and invent local edits");
  h.adapter.applyProductValues = apply;
  h.session.applySnapshot(h.remote);
  assert.equal(h.products[0].ffsDate, "2026-10-03");
  assert.equal(h.session.track().length, 0);
}

{
  const h = harness();
  h.edit({ ffsDate: "2026-10-01" }); await h.session.connect({ key });
  h.onSave(() => h.session.markImported(h.baseline));
  await assert.rejects(h.session.save(), /workspace changed/);
  assert.equal(h.products[0].ffsDate, "2026-10-01", "an in-flight old save cannot overwrite a replacement workspace");
  assert.equal(h.session.getState().hasKey, false);
}

{
  const h = harness();
  h.edit({ ffsDate: "2026-10-01" }); await h.session.connect({ key });
  h.remoteEdit({ ffsDate: "2026-10-02" }); h.remoteEdit({ ffsDate: fixture.ffsDate });
  let asked = false;
  await h.session.save({ resolveConflicts: async (conflicts) => { asked = true; return Object.fromEntries(conflicts.map((conflict) => [conflict.key, "master"])); } });
  assert.equal(asked, true, "a master value changed and restored still requires an explicit choice");
  assert.equal(h.products[0].ffsDate, fixture.ffsDate);
}

{
  const h = harness();
  h.edit({ specs: model.productValues(fixture).specs.map((spec) => spec.id === "spec-a" ? { ...spec, value: "50 hours" } : spec) });
  h.remoteEdit({ specs: model.productValues(fixture).specs.map((spec) => spec.id === "spec-a" ? { ...spec, value: "60 hours" } : spec) });
  await h.session.connect({ key });
  let conflictLabel = "";
  await h.session.save({ resolveConflicts: async (conflicts) => { conflictLabel = conflicts[0].label; return Object.fromEntries(conflicts.map((conflict) => [conflict.key, "master"])); } });
  assert.match(conflictLabel, /Battery|spec/i);
  assert.equal(h.products[0].specs.find((spec) => spec.id === "spec-a").value, "60 hours");
}

{
  const h = harness();
  const baseline = model.productValues(fixture).partSkus;
  h.edit({ partSkus: [...baseline, { id: "sku-local", code: "SKU-NEW", variantId: "black", colorCode: "" }] });
  h.remoteEdit({ partSkus: [...baseline, { id: "sku-remote", code: "SKU-REMOTE", variantId: "black", colorCode: "" }] });
  await h.session.connect({ key });
  await h.session.save();
  assert.equal(h.remote.products[0].values.partSkus.length, 3, "independent added SKU rows both survive");
}

{
  const h = harness(); h.edit({ ffsDate: "2026-10-01" }); await h.session.connect({ key });
  h.remoteEdit({ ffsDate: "2026-10-02" });
  await assert.rejects(h.session.save({ resolveConflicts: async () => ({}) }), /Choose a final value/);
  assert.equal(h.session.track().length, 1, "an incomplete conflict decision never discards drafts");
  h.session.disconnect(); assert.equal(h.session.getState().hasKey, false);
}

for (const [status, body, code] of [[401, { error: "private key details" }, "INVALID_KEY"], [403, { code: "EDITOR_KEY_REQUIRED" }, "EDITOR_KEY_REQUIRED"], [403, { code: "WRITES_DISABLED" }, "WRITES_DISABLED"], [500, { error: "private upstream" }, "UNAVAILABLE"]]) {
  await assert.rejects(client.request({ endpoint, operation: "save", key, fetchImpl: async () => Response.json(body, { status }) }), (error) => error.code === code && !error.message.includes("private"));
}

{
  const priorGitHub = globalThis.PortfolioMasterGitHub;
  let local = clone(fixture), baseline = initial().products, remote = manifestOf(clone(fixture)), factories = [], operations = [], heldProfiles = [];
  const snapshot = () => ({ ...model.snapshot(remote), source: "github", recentEditors: remote.masterSync ? [{ login: "alex", name: "Alex Smith", at: "2026-10-07T20:00:00Z" }] : [] });
  globalThis.PortfolioMasterGitHub = { createTransport: ({ token, config }) => {
    factories.push({ token, config });
    return {
      disconnect() {},
      async getIdentity() { if (token === "delayed-token") return new Promise((resolve, reject) => heldProfiles.push({ resolve, reject })); if (token !== "memory-github-token") { const error = new Error("Token rejected"); error.code = "INVALID_GITHUB_TOKEN"; throw error; } return { login: "alex", name: "Alex Smith" }; },
      async request(payload) {
        operations.push(payload.operation);
        if (payload.operation === "latest") return { snapshot: snapshot() };
        if (!token) { const error = new Error("Your GitHub token is required"); error.code = "GITHUB_TOKEN_REQUIRED"; throw error; }
        const merged = model.mergeChanges(remote, payload.changes, { actor: "alex", reason: payload.reason, requestId: payload.requestId });
        if (merged.conflicts.length) return { code: "MASTER_CONFLICT", conflicts: merged.conflicts, snapshot: snapshot() };
        remote = merged.manifest; return { snapshot: snapshot(), savedProducts: merged.savedProducts };
      },
    };
  } };
  const adapter = { getProducts: () => [local], getBaselineProducts: () => baseline, setBaselineProducts: (products) => { baseline = clone(products); }, applyPatches: (changes) => { for (const change of changes) local = model.applyProductValues(local, change.values); } };
  const source = { mode: "github", owner: "sample", repo: "PPC", branch: "main", path: "public/data/master_ppc.pkg" };
  try {
    const session = client.createSession({ source, adapter });
    session.markImported(baseline, key);
    await session.refresh();
    assert.equal(factories[0].token, "", "public GitHub refresh needs no access token");
    assert.equal(session.getState().mode, "github"); assert.equal(session.getState().configured, true);
    local = model.applyProductValues(local, { ...model.productValues(local), ffsDate: "2026-10-01" });
    await assert.rejects(session.save(), { code: "GITHUB_TOKEN_REQUIRED" });
    await session.setGitHubToken("memory-github-token");
    assert.deepEqual(session.getState().identity, { login: "alex", name: "Alex Smith" });
    const other = model.mergeChanges(remote, [{ productId: fixture.id, base: model.productValues(fixture), patch: { ffsDate: "2026-10-02" } }], { actor: "sam" }); remote = other.manifest;
    let asked = false;
    await session.save({ resolveConflicts: async (conflicts) => { asked = true; return Object.fromEntries(conflicts.map((conflict) => [conflict.key, "mine"])); } });
    assert.equal(asked, true, "GitHub storage uses the same explicit conflict flow");
    assert.equal(local.ffsDate, "2026-10-01"); assert.equal(session.track().length, 0);
    assert.equal(JSON.stringify({ baseline, state: session.getState() }).includes("memory-github-token"), false, "the GitHub token is never persisted or exposed by state");
    session.markImported(baseline, key); assert.equal(session.getState().hasGitHubToken, true, "a pull with the same package key keeps the memory token");
    session.markImported(baseline, "different-package-key"); assert.equal(session.getState().hasGitHubToken, false, "a different imported master clears GitHub access");
    await assert.rejects(session.setGitHubToken("rejected-token"), { code: "INVALID_GITHUB_TOKEN" }); assert.equal(session.getState().hasGitHubToken, false);
    await session.setGitHubToken("memory-github-token"); session.disconnect(); assert.equal(session.getState().hasGitHubToken, false);
    const disconnectedProfile = session.setGitHubToken("delayed-token");
    session.disconnect(); heldProfiles[0].resolve({ login: "stale", name: "Disconnected profile" });
    await assert.rejects(disconnectedProfile, { code: "GITHUB_CONNECTION_CHANGED" });
    assert.equal(session.getState().hasGitHubToken, false); assert.equal(session.getState().identity, null, "a held profile response cannot restore identity after disconnect");
    session.markImported(baseline, key);
    const importedProfile = session.setGitHubToken("delayed-token");
    session.markImported(baseline, "replacement-package-key");
    await session.setGitHubToken("memory-github-token");
    heldProfiles[1].reject(new Error("Previous account failed"));
    await assert.rejects(importedProfile, /Previous account failed/);
    assert.equal(session.getState().hasGitHubToken, true); assert.equal(session.getState().identity.login, "alex", "an old profile failure cannot clear a replacement account's verified access");
    assert.equal(operations.includes("presence"), false, "GitHub storage never writes heartbeat data");
  } finally { globalThis.PortfolioMasterGitHub = priorGitHub; }
}
await assert.rejects(client.request({ endpoint, operation: "latest", key, fetchImpl: async () => { throw new Error("secret credentials"); } }), (error) => !error.message.includes("secret"));
await assert.rejects(client.request({ endpoint, operation: "latest", key, fetchImpl: async () => new Response("<html>Sign in</html>") }), /could not be read/);
await assert.rejects(client.request({ endpoint, operation: "latest", key, fetchImpl: async () => new Response("{}", { headers: { "Content-Length": String(13 * 1024 * 1024) } }) }), /could not be read/);
await assert.rejects(client.request({ endpoint, operation: "latest", key, fetchImpl: async () => Response.json({ snapshot: { products: [{ productId: "bad", values: { generalAvailabilityDate: "2026-02-31" } }] } }) }), /invalid product details/);

// These requests use the real model, rather than a field-only mock, so the
// client must submit genuine create/delete preconditions and process real
// lifecycle conflicts, placement, full-record versions, and tombstones.
function lifecycleHarness() {
  const baseProduct = { ...clone(fixture), laneId: "wireless", imageAssetId: "existing-product-image", customNote: "Preserve existing package metadata" };
  let remoteManifest = { version: 4, categories: [{ id: "pc-audio", board: { lanes: [{ id: "wireless" }], products: [clone(baseProduct)] } }, { id: "console-audio", board: { lanes: [{ id: "console-wireless" }], products: [] } }], imageAssets: [{ id: "existing-product-image", path: "images/product.webp" }] };
  let products = [{ ...clone(baseProduct), categoryId: "pc-audio" }], baseline = model.snapshot(remoteManifest).products, storedSnapshot = model.snapshot(remoteManifest), sequence = 0, beforeSave = null, latestOverride = null, loseSaveReply = false;
  const calls = [], receipts = new Map();
  const snapshot = () => ({ ...model.snapshot(remoteManifest), source: "service", connectionMode: "team", canWrite: true, revision: String(remoteManifest.masterSync?.revision || 0) });
  const adapter = {
    getProducts: () => products,
    getBaselineProducts: () => baseline,
    setBaselineProducts: (items) => { baseline = clone(items); },
    getMasterTombstones: () => storedSnapshot.tombstones || [],
    setMasterSnapshot: (incoming) => { storedSnapshot = clone(incoming); },
    applyProductValues: (changes) => {
      for (const change of changes) {
        const index = products.findIndex((item) => item.id === change.productId);
        if (change.kind === "delete") {
          if (index >= 0) products.splice(index, 1);
        } else if (change.kind === "create") {
          assert.ok(remoteManifest.categories.some((category) => category.id === change.categoryId && category.board.lanes.some((lane) => lane.id === change.laneId)), "remote creations need a usable portfolio and lane");
          if (index >= 0) throw new Error("The adapter cannot create a repeated product identity.");
          products.push({ ...model.applyProductValues({ id: change.productId, laneId: change.laneId }, change.values), categoryId: change.categoryId });
        } else {
          assert.ok(index >= 0, "field updates need an existing local product");
          products[index] = model.applyProductValues(products[index], change.values);
        }
      }
    },
  };
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.key, key);
    assert.equal(Object.hasOwn(body, "editorToken"), false, "team mode must not require a second editing credential");
    calls.push({ url, body: clone(body) });
    if (url.endsWith("/latest")) return Response.json({ snapshot: latestOverride || snapshot() });
    const receiptId = JSON.stringify([body.sessionId, body.requestId]);
    const receipt = receipts.get(receiptId);
    if (receipt) {
      assert.equal(receipt.intent, JSON.stringify(body), "a repeated receipt is valid only for the original complete save intent");
      return Response.json({ snapshot: snapshot(), savedFields: receipt.savedFields, savedProducts: receipt.savedProducts, alreadySaved: true, requestId: body.requestId });
    }
    await beforeSave?.(body);
    const merged = model.mergeChanges(remoteManifest, body.changes, { requestId: body.requestId, actor: body.displayName || "Team member", reason: body.reason });
    if (merged.conflicts.length) return Response.json({ code: "MASTER_CONFLICT", conflicts: merged.conflicts, snapshot: snapshot() }, { status: 409 });
    remoteManifest = merged.manifest;
    receipts.set(receiptId, { intent: JSON.stringify(body), savedFields: merged.savedFields, savedProducts: merged.savedProducts });
    if (loseSaveReply) { loseSaveReply = false; throw new TypeError("The accepted response was lost"); }
    return Response.json({ snapshot: snapshot(), savedFields: merged.savedFields, savedProducts: merged.savedProducts });
  };
  const source = { mode: "service", team: true };
  const session = client.createSession({ endpoint, source, adapter, fetchImpl });
  const remoteEntry = (id) => snapshot().products.find((entry) => entry.productId === id);
  const remoteChange = (changes) => {
    const merged = model.mergeChanges(remoteManifest, changes, { requestId: `other-team-${++sequence}`, actor: "Other team" });
    assert.equal(merged.conflicts.length, 0, "test setup's independent remote save must succeed");
    remoteManifest = merged.manifest;
  };
  return { session, adapter, calls,
    get products() { return products; }, get baseline() { return baseline; }, get remoteManifest() { return remoteManifest; }, get snapshot() { return snapshot(); },
    reload: () => client.createSession({ endpoint, source, adapter, fetchImpl }),
    add(id = "local-new", patch = {}, placement = {}) { products.push({ ...model.applyProductValues({ id, laneId: placement.laneId || "wireless" }, { ...model.productValues(fixture), name: "New product", ...patch }), categoryId: placement.categoryId || "pc-audio" }); },
    remove(id = fixture.id) { products = products.filter((item) => item.id !== id); },
    edit(patch, id = fixture.id) { products = products.map((item) => item.id === id ? model.applyProductValues(item, { ...model.productValues(item), ...patch }) : item); },
    remoteAdd(id = "remote-new", patch = {}, placement = {}) { remoteChange([{ kind: "create", productId: id, categoryId: placement.categoryId || "pc-audio", laneId: placement.laneId || "wireless", mine: { ...model.productValues(fixture), name: "Remote product", ...patch }, baseRevisions: snapshot().tombstones.find((item) => item.productId === id)?.revisions || {} }]); },
    remoteEdit(patch, id = fixture.id) { const entry = remoteEntry(id); remoteChange([{ productId: id, base: entry.values, baseRevisions: entry.revisions, patch }]); },
    remoteRemove(id = fixture.id) { const entry = remoteEntry(id); remoteChange([{ kind: "delete", productId: id, categoryId: entry.categoryId, laneId: entry.laneId, base: entry.values, baseRevisions: entry.revisions, baseProductVersion: entry.productVersion }]); },
    onSave(callback) { beforeSave = callback; },
    latestResponse(value) { latestOverride = value ? clone(value) : null; },
    loseNextSaveReply() { loseSaveReply = true; },
    get savedRequests() { return receipts.size; },
  };
}

// A bad server response must fail before the first adapter mutation, including
// lifecycle creations/removals and updates to unrelated accepted fields.
const previousPackageApi = globalThis.PortfolioPackage;
await import("../../public/js/package-codec.js");
const packageCodec = globalThis.PortfolioPackage;
const validatePackageInfo = globalThis.PortfolioPackage.normalizePackageInfo;
// Earlier transport fixtures intentionally use a simple non-package test key.
// Use the real metadata validator without changing that request-key fixture.
globalThis.PortfolioPackage = { normalizePackageInfo: validatePackageInfo };
for (const corrupt of [
  (value) => { value.tombstones = {}; },
  (value) => { value.tombstones = [{ productId: value.products[0].productId, revisions: {} }]; },
  (value) => { value.tombstones = [{ productId: "removed-fixture", revisions: { "@product": -1 } }]; },
  (value) => { value.products[0].productId = "__proto__"; },
  (value) => { value.products[0].revisions = []; },
  (value) => { value.products[0].productVersion = "invalid-record-version"; },
  (value) => { value.products[0].laneId = "constructor"; },
  (value) => { value.masterSync = []; },
  (value) => { value.publication = { status: "current", requestedRevision: 1, publishedRevision: 2 }; },
  (value) => { value.packageInfo = { version: 1, updatedAt: "not-a-date", comments: "" }; },
]) {
  const h = lifecycleHarness(); await h.session.connect({ key });
  h.edit({ ffsDate: "2026-10-01" }); h.remoteEdit({ codename: "Accepted independent team edit" }); h.remoteAdd("remote-arrival");
  const products = clone(h.products), baseline = clone(h.baseline), pending = clone(h.session.track()), previousSnapshot = clone(h.session.getState().snapshot);
  const invalid = clone(h.snapshot); corrupt(invalid); h.latestResponse(invalid);
  await assert.rejects(h.session.refresh(), /invalid|incomplete/i);
  assert.deepEqual(h.products, products, "malformed snapshot applies neither remote records nor field changes");
  assert.deepEqual(h.baseline, baseline, "malformed snapshot cannot advance the stored comparison baseline");
  assert.deepEqual(h.session.track(), pending, "malformed snapshot keeps the complete unsaved draft");
  assert.deepEqual(h.session.getState().snapshot, previousSnapshot, "the last accepted snapshot survives invalid metadata");
  h.latestResponse(null); await h.session.refresh();
  assert.equal(h.products.find((item) => item.id === fixture.id).ffsDate, "2026-10-01");
  assert.equal(h.products.find((item) => item.id === fixture.id).codename, "Accepted independent team edit");
  assert.ok(h.products.some((item) => item.id === "remote-arrival"), "a later valid response can recover normally");
}
globalThis.PortfolioPackage = previousPackageApi;

{
  const h = lifecycleHarness(); await h.session.connect({ key });
  h.session.setEditorProfile({ sessionId: "lost-reply-browser-session", displayName: "Planning team" });
  h.add("created-before-disconnect", { specs: [{ id: "battery-new", label: "Battery", value: "50 h" }], partSkus: [{ id: "sku-new", code: "HP-NEW" }] });
  h.loseNextSaveReply();
  await assert.rejects(h.session.save({ reason: "Factory confirmation" }), { code: "UNAVAILABLE" });
  assert.ok(h.snapshot.products.some((item) => item.productId === "created-before-disconnect"), "the server accepted the creation before the response was lost");
  assert.equal(h.session.track()[0].kind, "create", "an unconfirmed creation remains a local draft");
  assert.equal(h.savedRequests, 1);
  h.remoteEdit({ codename: "Changed after the accepted creation" });
  const result = await h.session.save({ reason: "Factory confirmation", resolveConflicts: () => { assert.fail("An accepted creation replay must not ask for an identity conflict"); } });
  const requests = h.calls.filter((call) => call.url.endsWith("/save"));
  assert.equal(requests.length, 2); assert.equal(requests[0].body.requestId, requests[1].body.requestId, "retries reuse the save ID for the exact original intent");
  assert.deepEqual(requests[0].body, requests[1].body);
  assert.equal(result.alreadySaved, true); assert.equal(h.savedRequests, 1, "retrying a lost creation response creates exactly one receipt and one product");
  assert.equal(h.snapshot.products.filter((item) => item.productId === "created-before-disconnect").length, 1);
  assert.equal(h.products.find((item) => item.id === fixture.id).codename, "Changed after the accepted creation", "receipt recovery applies the latest snapshot, including later team edits");
  assert.equal(h.session.track().length, 0);
}

{
  const h = lifecycleHarness(); await h.session.connect({ key });
  h.session.setEditorToken("not-needed-for-team");
  h.session.setEditorProfile({ sessionId: "team-browser-session", displayName: "  Planning team  " });
  h.add("local-new", { ffsDate: "2026-10-01", specs: [{ id: "created-spec", label: "Driver", value: "50 mm" }], partSkus: [{ id: "created-sku", code: "SKU-CREATED" }] });
  assert.equal(h.session.track()[0].kind, "create");
  const result = await h.session.save({ requestId: "local-create-request" });
  assert.equal(result.saved, true); assert.equal(result.savedProducts, 1);
  const accepted = h.snapshot.products.find((entry) => entry.productId === "local-new");
  assert.equal(accepted.values.partSkus[0].code, "SKU-CREATED");
  assert.equal(accepted.categoryId, "pc-audio"); assert.equal(accepted.laneId, "wireless");
  assert.equal(h.products.find((item) => item.id === fixture.id).imageAssetId, "existing-product-image");
  assert.equal(h.session.track().length, 0);
  const request = h.calls.find((call) => call.url.endsWith("/save")).body;
  assert.equal(request.sessionId, "team-browser-session"); assert.equal(request.displayName, "Planning team");
  assert.equal(Object.hasOwn(request, "editorToken"), false);
  assert.equal(Object.hasOwn(request.changes[0].mine, "imageAssetId"), false);
}

{
  const h = lifecycleHarness(); await h.session.connect({ key }); h.remove();
  const pending = h.session.track()[0];
  assert.equal(pending.kind, "delete"); assert.equal(pending.baseProductVersion, h.snapshot.products[0].productVersion);
  await h.session.save();
  assert.equal(h.snapshot.products.length, 0); assert.equal(h.products.length, 0); assert.equal(h.session.track().length, 0);
  assert.equal(h.snapshot.tombstones[0].productId, fixture.id);
  assert.equal(h.remoteManifest.imageAssets[0].id, "existing-product-image");
}

{
  const h = lifecycleHarness(); await h.session.connect({ key });
  h.edit({ codename: "Unsaved planning note" });
  h.remoteAdd("remote-console", { name: fixture.name }, { categoryId: "console-audio", laneId: "console-wireless" });
  await h.session.refresh();
  const received = h.products.find((item) => item.id === "remote-console");
  assert.equal(received.categoryId, "console-audio"); assert.equal(received.laneId, "console-wireless");
  assert.equal(h.products.find((item) => item.id === fixture.id).codename, "Unsaved planning note");
  assert.equal(h.session.track().length, 1); assert.equal(h.session.track()[0].productId, fixture.id);
  assert.equal(h.session.track()[0].patch.codename, "Unsaved planning note");
  h.remoteRemove("remote-console"); await h.session.refresh();
  assert.equal(h.products.some((item) => item.id === "remote-console"), false);
  assert.equal(h.session.track().length, 1, "accepted remote creations/removals do not become local publication drafts");
}

{
  const h = lifecycleHarness(); await h.session.connect({ key }); h.remove();
  const originalVersion = h.session.track()[0].baseProductVersion;
  h.remoteEdit({ ffsDate: "2026-10-02" }); await h.session.refresh();
  assert.equal(h.products.length, 0, "refresh must preserve a local product deletion");
  assert.equal(h.session.track()[0].baseProductVersion, originalVersion, "refresh must retain the deletion's original concurrency guard");
  const baseline = clone(h.baseline); let asked = 0;
  const result = await h.session.save({ resolveConflicts: async (conflicts) => { asked += 1; assert.equal(conflicts[0].path, "@product"); assert.equal(conflicts[0].reason, "product-changed-before-delete"); return null; } });
  assert.equal(result.cancelled, true); assert.equal(asked, 1);
  assert.equal(h.products.length, 0); assert.deepEqual(h.baseline, baseline);
  assert.equal(h.snapshot.products[0].values.ffsDate, "2026-10-02");
  assert.equal(h.reload().track()[0].baseProductVersion, originalVersion, "a reload preserves a cancelled deletion's original baseline");
}

for (const choice of ["mine", "master"]) {
  const h = lifecycleHarness(); await h.session.connect({ key }); h.remove(); h.remoteEdit({ ffsDate: "2026-10-02" });
  let asked = 0;
  await h.session.save({ resolveConflicts: async (conflicts) => { asked += 1; return Object.fromEntries(conflicts.map((item) => [item.key, choice])); } });
  assert.equal(asked, 1);
  assert.equal(h.snapshot.products.length, choice === "mine" ? 0 : 1);
  assert.equal(h.products.length, choice === "mine" ? 0 : 1);
  if (choice === "master") assert.equal(h.products[0].ffsDate, "2026-10-02");
  assert.equal(h.session.track().length, 0);
}

for (const choice of ["mine", "master"]) {
  const h = lifecycleHarness(); await h.session.connect({ key }); h.edit({ name: "My retained draft" }); h.remoteRemove(); await h.session.refresh();
  assert.equal(h.products[0].name, "My retained draft", "a removed master record must not erase an unsaved local edit during refresh");
  assert.equal(h.session.track()[0].kind, undefined, "an edited removed record keeps its original edit baseline until the user chooses whether to restore it");
  let asked = 0;
  await h.session.save({ resolveConflicts: async (conflicts) => { asked += 1; assert.equal(conflicts[0].reason, "product-removed"); return Object.fromEntries(conflicts.map((item) => [item.key, choice])); } });
  assert.equal(asked, 1);
  assert.equal(h.snapshot.products.length, choice === "mine" ? 1 : 0);
  assert.equal(h.products.length, choice === "mine" ? 1 : 0);
  if (choice === "mine") assert.equal(h.snapshot.products[0].values.name, "My retained draft");
  assert.equal(h.session.track().length, 0);
}

for (const choice of ["mine", "master"]) {
  const h = lifecycleHarness(); await h.session.connect({ key }); h.add("colliding-id", { name: "My new product" });
  h.remoteAdd("colliding-id", { name: "Their new product", price: 199 }); await h.session.refresh();
  assert.equal(h.products.find((item) => item.id === "colliding-id").name, "My new product", "refresh cannot silently adopt a different team's colliding creation");
  assert.equal(h.session.track()[0].kind, "create");
  let asked = 0;
  await h.session.save({ resolveConflicts: async (conflicts) => { asked += 1; assert.equal(conflicts[0].reason, "product-id-exists"); return Object.fromEntries(conflicts.map((item) => [item.key, choice])); } });
  assert.equal(asked, 1);
  assert.equal(h.snapshot.products.find((item) => item.productId === "colliding-id").values.name, choice === "mine" ? "My new product" : "Their new product");
  assert.equal(h.products.find((item) => item.id === "colliding-id").name, choice === "mine" ? "My new product" : "Their new product");
  assert.equal(h.session.track().length, 0);
}

{
  const h = lifecycleHarness(); await h.session.connect({ key }); h.add("created-in-flight");
  h.onSave(() => h.edit({ name: "Edited while creating" }, "created-in-flight"));
  await h.session.save();
  assert.equal(h.snapshot.products.find((entry) => entry.productId === "created-in-flight").values.name, "New product");
  assert.equal(h.products.find((entry) => entry.id === "created-in-flight").name, "Edited while creating");
  assert.equal(h.session.track().length, 1); assert.equal(h.session.track()[0].patch.name, "Edited while creating");
}

{
  const h = lifecycleHarness(); await h.session.connect({ key }); h.add("created-then-removed");
  h.onSave(() => h.remove("created-then-removed"));
  await h.session.save();
  assert.equal(h.snapshot.products.some((entry) => entry.productId === "created-then-removed"), true);
  assert.equal(h.products.some((entry) => entry.id === "created-then-removed"), false, "a product removed locally while its creation was saving must remain a removal draft");
  assert.equal(h.session.track().length, 1); assert.equal(h.session.track()[0].kind, "delete");
}

{
  const h = lifecycleHarness(); await h.session.connect({ key }); h.edit({ name: "Accepted update" });
  h.onSave(() => h.remove());
  await h.session.save();
  assert.equal(h.snapshot.products[0].values.name, "Accepted update");
  assert.equal(h.products.length, 0, "a local deletion made while an existing product update was saving must remain a draft");
  assert.equal(h.session.track()[0].kind, "delete");
}

{
  const h = lifecycleHarness(); await h.session.connect({ key }); h.remove();
  h.onSave(() => h.add(fixture.id, model.productValues(fixture)));
  await h.session.save();
  assert.equal(h.snapshot.products.length, 0);
  assert.equal(h.products.length, 1, "a product explicitly re-added during deletion must survive even when it has the original values");
  assert.equal(h.session.track()[0].kind, "create");
  assert.deepEqual(h.session.track()[0].baseRevisions, clone(h.snapshot.tombstones[0].revisions));
}

for (const choice of ["mine", "master"]) {
  const h = lifecycleHarness(); await h.session.connect({ key }); h.remove(); h.remoteEdit({ ffsDate: "2026-10-02" });
  let asked = 0;
  await h.session.save({ resolveConflicts: async (conflicts) => {
    asked += 1;
    if (asked === 1) h.remoteEdit({ ffsDate: fixture.ffsDate });
    return Object.fromEntries(conflicts.map((item) => [item.key, choice]));
  } });
  assert.equal(asked, 2, "a changed deletion target requires a fresh decision, including an ABA return to the original field value");
  assert.equal(h.snapshot.products.length, choice === "mine" ? 0 : 1);
  assert.equal(h.products.length, choice === "mine" ? 0 : 1);
  if (choice === "master") assert.equal(h.products[0].ffsDate, fixture.ffsDate);
  assert.equal(h.session.track().length, 0);
}

for (const choice of ["mine", "master"]) {
  const h = lifecycleHarness(); await h.session.connect({ key }); h.edit({ name: "My restoration" }); h.remoteRemove();
  let asked = 0;
  await h.session.save({ resolveConflicts: async (conflicts) => {
    asked += 1;
    if (asked === 1) h.remoteAdd(fixture.id, { name: "Restored by another team" });
    return Object.fromEntries(conflicts.map((item) => [item.key, choice]));
  } });
  assert.equal(asked, 2, "another team's restoration while deciding must require a fresh existence/value decision");
  assert.equal(h.snapshot.products[0].values.name, choice === "mine" ? "My restoration" : "Restored by another team");
  assert.equal(h.products[0].name, choice === "mine" ? "My restoration" : "Restored by another team");
  assert.equal(h.session.track().length, 0);
}

{
  const h = lifecycleHarness();
  h.add("console-copy", model.productValues(fixture), { categoryId: "console-audio", laneId: "console-wireless" });
  await h.session.connect({ key });
  h.session.setEditorProfile({ sessionId: "anonymous-browser-session", displayName: "" });
  await h.session.save();
  assert.equal(h.snapshot.products.length, 2, "the same product name and business SKUs can be saved in PC and Console portfolios with separate internal identities");
  assert.equal(h.session.track().length, 0);
  const body = h.calls.find((call) => call.url.endsWith("/save")).body;
  assert.equal(body.sessionId, "anonymous-browser-session"); assert.equal(Object.hasOwn(body, "displayName"), false, "a team member can save without entering a name");
}

// Remember only a validated package unlock in this browser tab, for the exact
// configured team endpoint. Reconnection must not seed over the saved draft.
{
  const previousSessionStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const previousPackage = globalThis.PortfolioPackage;
  const accessKey = `PPC-${"A".repeat(43)}`, replacementKey = `PPC-${"B".repeat(42)}A`;
  const tabAccessName = `portfolio.sharedTeamAccess:${endpoint}`;
  const stored = new Map(), storageCalls = [];
  const storage = {
    getItem(name) { storageCalls.push(["get", name]); return stored.get(name) ?? null; },
    setItem(name, value) { storageCalls.push(["set", name]); stored.set(name, value); },
    removeItem(name) { storageCalls.push(["remove", name]); stored.delete(name); },
  };
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => "", setItem() { assert.fail("master access must never be written to localStorage"); } } });
  globalThis.PortfolioPackage = packageCodec;
  const teamSession = (h, options = {}) => client.createSession({ endpoint, source: { mode: "service", team: true }, adapter: h.adapter,
    fetchImpl: async (_url, request) => { assert.equal(JSON.parse(request.body).key, accessKey); return Response.json({ snapshot: h.remote }); }, ...options });
  try {
    const h = harness();
    const unlocked = teamSession(h);
    unlocked.markImported(h.baseline, ` ${accessKey} `);
    assert.equal(JSON.parse(stored.get(tabAccessName)).key, accessKey, "a decrypted imported package stores only the normalized unlock for this tab");
    assert.deepEqual(Object.keys(JSON.parse(stored.get(tabAccessName))).sort(), ["endpoint", "key", "version"], "saved access contains no GitHub token or backend credential");
    h.edit({ ffsDate: "2026-10-01" }); h.remoteEdit({ ffsDate: "2026-10-02", codename: "Accepted by another teammate" });
    const productsBeforeReload = clone(h.products), baselineBeforeReload = clone(h.baseline);
    const restored = teamSession(h);
    assert.equal(restored.getState().hasKey, true); assert.equal(restored.getState().connected, false);
    assert.equal(restored.getState().snapshot, null, "restoring tab access does not manufacture a master snapshot");
    assert.deepEqual(h.products, productsBeforeReload); assert.deepEqual(h.baseline, baselineBeforeReload, "restoring access never overwrites the draft comparison baseline");
    await restored.refresh();
    assert.equal(restored.getState().connected, true);
    assert.equal(h.products[0].ffsDate, "2026-10-01", "automatic reconnection retains the local conflicting date");
    assert.equal(h.products[0].codename, "Accepted by another teammate", "automatic reconnection collects unrelated accepted changes");
    assert.equal(restored.track()[0].base.ffsDate, fixture.ffsDate, "automatic reconnect retains the original conflict baseline");
    for (const options of [
      { endpoint: "https://another-master.example.org/api/master" },
      { source: { mode: "service", team: false } },
      { source: { mode: "github", team: true } },
      { endpoint: "http://insecure.example.org/api/master" },
    ]) assert.equal(teamSession(h, options).getState().hasKey, false, "tab access is isolated from another endpoint, transport, or non-team setup");
    restored.disconnect();
    assert.equal(stored.has(tabAccessName), false); assert.equal(teamSession(h).getState().hasKey, false, "disconnect prevents automatic reconnection on reload");

    const imported = teamSession(h);
    imported.markImported(h.baseline, accessKey);
    imported.markImported(h.baseline, replacementKey);
    assert.equal(JSON.parse(stored.get(tabAccessName)).key, replacementKey, "unlocking a replacement package switches the saved tab key");
    imported.markImported(h.baseline);
    assert.equal(imported.getState().hasKey, false); assert.equal(stored.has(tabAccessName), false, "importing without an unlock clears remembered access");
    imported.markImported(h.baseline, accessKey);
    imported.markImported(h.baseline, "invalid-package-key");
    assert.equal(imported.getState().hasKey, false); assert.equal(stored.has(tabAccessName), false, "invalid imported access cannot survive a reload");

    for (const invalid of ["invalid-json", " ".repeat(1025), JSON.stringify({ version: 1, endpoint, key: "invalid-package-key" }), JSON.stringify({ version: 1, endpoint: "https://other.example.org/api/master", key: accessKey }), JSON.stringify({ version: 1, endpoint, key: accessKey, githubToken: "should-never-be-restored" })]) {
      stored.set(tabAccessName, invalid);
      assert.equal(teamSession(h).getState().hasKey, false);
      assert.equal(stored.has(tabAccessName), false, "malformed saved tab access is removed safely");
    }

    const connected = teamSession(h);
    await connected.connect({ key: ` ${accessKey} `, editorToken: "unused-team-credential" });
    assert.equal(JSON.parse(stored.get(tabAccessName)).key, accessKey, "a successful direct team connection remembers its normalized unlock");
    const rejected = teamSession(h, { fetchImpl: async () => Response.json({}, { status: 401 }) });
    await assert.rejects(rejected.refresh(), { code: "INVALID_KEY" });
    assert.equal(rejected.getState().hasKey, false); assert.equal(stored.has(tabAccessName), false, "a rejected restored key is cleared instead of repeatedly reconnecting");
    connected.markImported(h.baseline, accessKey);
    const rejectedPresence = teamSession(h, { fetchImpl: async () => Response.json({}, { status: 401 }) });
    await assert.rejects(rejectedPresence.presence({ sessionId: "restored-browser-session" }), { code: "INVALID_KEY" });
    assert.equal(rejectedPresence.getState().hasKey, false); assert.equal(stored.has(tabAccessName), false, "a rejected heartbeat clears invalid restored access");

    let finishLatest;
    const held = teamSession(h, { fetchImpl: async () => new Promise((resolve) => { finishLatest = resolve; }) });
    held.markImported(h.baseline, accessKey);
    const loading = held.refresh(); held.disconnect();
    finishLatest(Response.json({ snapshot: h.remote }));
    await assert.rejects(loading, { code: "MASTER_CONNECTION_CHANGED" });
    assert.equal(held.getState().hasKey, false); assert.equal(held.getState().connected, false); assert.equal(stored.has(tabAccessName), false, "a late successful response cannot undo disconnect or remember its old key");

    const switched = teamSession(h, { fetchImpl: async () => new Promise((resolve) => { finishLatest = resolve; }) });
    switched.markImported(h.baseline, accessKey);
    const oldLoading = switched.refresh(); switched.markImported(h.baseline, replacementKey);
    finishLatest(Response.json({}, { status: 401 }));
    await assert.rejects(oldLoading, { code: "INVALID_KEY" });
    assert.equal(switched.getState().hasKey, true); assert.equal(JSON.parse(stored.get(tabAccessName)).key, replacementKey, "a stale rejection cannot clear a newly imported package unlock");

    let finishSave;
    const saving = teamSession(h, { fetchImpl: async (url) => url.endsWith("/latest") ? Response.json({ snapshot: h.remote }) : new Promise((resolve) => { finishSave = resolve; }) });
    saving.markImported(h.baseline, accessKey); await saving.refresh(); h.edit({ ffsDate: "2026-10-04" });
    const draftBeforeSave = clone(h.products), baselineBeforeSave = clone(h.baseline);
    const savingRequest = saving.save(); saving.disconnect();
    finishSave(Response.json({ snapshot: h.remote }));
    await assert.rejects(savingRequest, { code: "MASTER_CONNECTION_CHANGED" });
    assert.deepEqual(h.products, draftBeforeSave); assert.deepEqual(h.baseline, baselineBeforeSave, "a save returning after disconnect cannot alter the draft or comparison baseline");
    assert.equal(saving.getState().connected, false); assert.equal(stored.has(tabAccessName), false);

    for (const blockedStorage of [
      { get() { throw new Error("Browser storage disabled"); } },
      { value: { getItem() { throw new Error("Storage read blocked"); }, setItem() { throw new Error("Storage quota reached"); }, removeItem() { throw new Error("Storage removal blocked"); } } },
      { value: { getItem: () => null, setItem() { throw new Error("Storage quota reached"); }, removeItem() { throw new Error("Storage removal blocked"); } } },
    ]) {
      Object.defineProperty(globalThis, "sessionStorage", { configurable: true, ...blockedStorage });
      const inMemory = teamSession(h);
      assert.equal(inMemory.getState().hasKey, false);
      inMemory.markImported(h.baseline, accessKey); await inMemory.refresh();
      assert.equal(inMemory.getState().connected, true, "blocked tab storage does not prevent an unlocked in-memory connection");
      inMemory.disconnect(); assert.equal(inMemory.getState().hasKey, false);
    }
    assert.ok(storageCalls.some(([action]) => action === "set"));
  } finally {
    if (previousSessionStorage) Object.defineProperty(globalThis, "sessionStorage", previousSessionStorage); else delete globalThis.sessionStorage;
    if (previousLocalStorage) Object.defineProperty(globalThis, "localStorage", previousLocalStorage); else delete globalThis.localStorage;
    globalThis.PortfolioPackage = previousPackage;
  }
}

const plcAt = "2026-10-09T16:00:00.000Z";
const plcEvidence = { version: 1, importedAt: plcAt, fields: { ffsDate: { value: "2026-11-05", observedAt: plcAt, changedAt: plcAt, populatedAt: plcAt } } };
const plcPatch = { ffsDate: "2026-11-05", plc: plcEvidence };
const scopedRequest = () => ({ reason: "Biweekly PLC import", patches: [{ productId: fixture.id, patch: clone(plcPatch) }] });

{
  const h = lifecycleHarness();
  h.edit(plcPatch);
  const before = clone(h.products);
  assert.equal((await h.session.saveScoped(scopedRequest())).status, "local", "unconnected imports remain local without asking for credentials");
  assert.equal(h.calls.length, 0); assert.deepEqual(h.products, before);
  await h.session.connect({ key });
  h.remoteAdd("other-product"); await h.session.refresh();
  h.edit({ name: "Unsaved manual product name", specs: [{ id: "spec-a", label: "Battery", value: "55 hours" }] });
  h.edit({ price: 149 }, "other-product");
  h.remoteEdit({ codename: "Accepted remote codename" });
  const saved = await h.session.saveScoped(scopedRequest());
  assert.equal(saved.status, "saved");
  const shared = h.snapshot.products.find((item) => item.productId === fixture.id);
  assert.equal(shared.values.ffsDate, plcPatch.ffsDate); assert.deepEqual(shared.values.plc, plcEvidence);
  assert.equal(shared.values.name, fixture.name); assert.equal(shared.values.specs[0].value, fixture.specs[0].value);
  assert.equal(shared.values.codename, "Accepted remote codename");
  assert.equal(h.snapshot.products.find((item) => item.productId === "other-product").values.price, fixture.price, "another product's manual draft is never shared by an import");
  assert.equal(h.products.find((item) => item.id === fixture.id).name, "Unsaved manual product name");
  assert.equal(h.products.find((item) => item.id === fixture.id).specs[0].value, "55 hours");
  assert.equal(h.products.find((item) => item.id === fixture.id).codename, "Accepted remote codename");
  assert.equal(h.session.track().length, 2, "manual drafts on imported and unrelated products still need their normal save");
  const submitted = h.calls.find((call) => call.url.endsWith("/save")).body;
  assert.equal(submitted.changes.length, 1); assert.deepEqual(Object.keys(submitted.changes[0].patch).sort(), ["ffsDate", "plc"]);
  const callsBefore = h.calls.length;
  assert.equal((await h.session.saveScoped(scopedRequest())).status, "saved");
  assert.equal(h.calls.length, callsBefore, "retrying already shared import values does not submit manual drafts");
  assert.deepEqual(model.dateEditsForProduct(h.remoteManifest, fixture.id).ffsDate.value, plcPatch.ffsDate, "accepted shared timestamp identifies the actual imported FFS value");
}

{
  const h = lifecycleHarness(); await h.session.connect({ key }); h.edit(plcPatch);
  const before = clone(h.products), baseBefore = clone(h.baseline), callsBefore = h.calls.length;
  const changed = await h.session.saveScoped({ patches: [{ productId: fixture.id, patch: { ...plcPatch, ffsDate: "2026-11-06" } }] });
  assert.equal(changed.status, "pending"); assert.equal(changed.code, "SCOPED_UPDATE_CHANGED");
  const invalid = await h.session.saveScoped({ patches: [{ productId: fixture.id, patch: { name: fixture.name } }] });
  assert.equal(invalid.status, "pending"); assert.equal(invalid.code, "INVALID_SCOPE");
  assert.equal(h.calls.length, callsBefore); assert.deepEqual(h.products, before); assert.deepEqual(h.baseline, baseBefore);
}

{
  const h = lifecycleHarness(); await h.session.connect({ key }); h.edit(plcPatch);
  h.remoteEdit({ ffsDate: "2026-12-01", plc: { version: 1, importedAt: "2026-10-10T16:00:00.000Z" } });
  const before = clone(h.products), baseBefore = clone(h.baseline);
  const pending = await h.session.saveScoped(scopedRequest());
  assert.equal(pending.status, "pending"); assert.equal(pending.code, "MASTER_CONFLICT"); assert.ok(pending.conflicts.length >= 2);
  assert.deepEqual(h.products, before); assert.deepEqual(h.baseline, baseBefore, "a conflict neither clears collection data nor advances its comparison baseline");
  assert.equal(h.snapshot.products[0].values.ffsDate, "2026-12-01");
  await h.session.save({ resolveConflicts: (items) => Object.fromEntries(items.map((item) => [item.key, "mine"])) });
  assert.equal(h.snapshot.products[0].values.ffsDate, plcPatch.ffsDate, "the ordinary review/save flow can resolve queued import conflicts");
}

{
  const h = lifecycleHarness(); await h.session.connect({ key }); h.edit(plcPatch);
  h.remoteEdit({ ffsDate: "2026-12-01" }); h.remoteEdit({ ffsDate: fixture.ffsDate });
  const pending = await h.session.saveScoped(scopedRequest());
  assert.equal(pending.status, "pending"); assert.equal(pending.code, "MASTER_CONFLICT", "scoped saves keep revision protection when a shared value changes and changes back");
}

{
  const h = lifecycleHarness(); await h.session.connect({ key }); h.edit({ ...plcPatch, name: "Manual draft must remain" });
  h.loseNextSaveReply();
  assert.equal((await h.session.saveScoped(scopedRequest())).status, "pending");
  const retried = await h.session.saveScoped(scopedRequest());
  assert.equal(retried.status, "saved"); assert.equal(retried.alreadySaved, true);
  const requests = h.calls.filter((call) => call.url.endsWith("/save")); assert.equal(requests[0].body.requestId, requests[1].body.requestId, "automatic retry reuses the original idempotent receipt");
  assert.equal(h.session.track()[0].patch.name, "Manual draft must remain");
  assert.equal(h.snapshot.products[0].values.name, fixture.name);
}

{
  const h = lifecycleHarness(); await h.session.connect({ key }); h.edit(plcPatch);
  h.onSave(() => h.edit({ name: "Name edited during automatic sharing", ffsDate: "2026-11-07" }));
  assert.equal((await h.session.saveScoped(scopedRequest())).status, "saved");
  assert.equal(h.products[0].ffsDate, "2026-11-07"); assert.equal(h.products[0].name, "Name edited during automatic sharing");
  assert.equal(h.snapshot.products[0].values.ffsDate, plcPatch.ffsDate);
  assert.equal(h.session.track()[0].patch.ffsDate, "2026-11-07", "edits made during an import save remain local and pending");
}

const whiteVariant = { id: "white", code: "WHT", colorName: "White", colorHex: "#ffffff" };
const colorGroups = (items = []) => [{ ...clone(fixture.variantGroups[0]), items: [...clone(fixture.variantGroups[0].items), ...clone(items)] }];
function variantProject(variantId, value, { sourceKey = `source-${variantId}`, created = false, groupId = "colors" } = {}) {
  const evidence = { version: 1, variantId, variantName: variantId, importedAt: plcAt, sourceFile: "Synthetic colorway PLC.xlsx", fingerprint: "synthetic-colorways", reportDate: "2026-10-09",
    fields: { ffsDate: { value, observedAt: plcAt, changedAt: plcAt, sourceType: "plc", reviewed: true }, generalAvailabilityDate: { value: "2028-07-01", changedAt: plcAt, sourceType: "plc" } },
    identities: [{ key: sourceKey, name: variantId, codename: variantId, confirmed: true }], rows: [{ key: sourceKey, importedAt: plcAt }],
    history: [{ at: plcAt, productId: fixture.id, variantId, field: "ffsDate", before: "", after: value }] };
  const row = variantId === "white" ? whiteVariant : fixture.variantGroups[0].items.find(item => item.id === variantId);
  if (row) evidence.colorway = Object.fromEntries(["code", "colorKey", "colorName", "colorHex", "colorKey2", "colorName2", "colorHex2"].map(field => [field, String(row[field] || "")]));
  if (created) evidence.createdFromSource = { key: sourceKey, productId: fixture.id, variantId, groupId, at: plcAt };
  return evidence;
}
function colorwayEvidence(projects) {
  return { version: 1, fields: { ffsDate: { value: fixture.ffsDate, changedAt: plcAt, sourceType: "plc" } },
    variantProjects: projects, identities: Object.entries(projects).flatMap(([variantId, project]) => project.identities.map(identity => ({ ...clone(identity), variantId }))),
    history: Object.values(projects).flatMap(project => clone(project.history)) };
}
const scopedVariant = (plc, extra = {}) => ({ patches: [{ productId: fixture.id, patch: { plc: clone(plc) }, plcFields: [], plcVariantFields: { white: ["ffsDate"] }, ...extra }] });

{
  const h = lifecycleHarness(), accepted = colorwayEvidence({ black: variantProject("black", "2027-01-01"), white: variantProject("white", "2027-02-01") });
  h.remoteEdit({ variantGroups: colorGroups([whiteVariant]), plc: accepted }); await h.session.connect({ key });
  const draft = clone(h.products[0].plc);
  draft.variantProjects.black.fields.ffsDate = { value: "2029-01-01", sourceType: "local", changedAt: "2026-10-10T01:00:00.000Z" };
  draft.variantProjects.black.variantName = "Manual Black name";
  draft.variantProjects.black.identities.push({ key: "unreviewed-black-source", confirmed: true });
  draft.identities.push({ key: "unreviewed-black-source", variantId: "black", confirmed: true });
  draft.variantProjects.white.fields.ffsDate = { value: "2028-04-15", sourceType: "plc", reviewed: true, changedAt: "2026-10-10T02:00:00.000Z" };
  draft.variantProjects.white.fields.generalAvailabilityDate = { value: "2029-07-01", sourceType: "local", changedAt: "2026-10-10T02:00:00.000Z" };
  const whiteEvent = { at: "2026-10-10T02:00:00.000Z", productId: fixture.id, variantId: "white", field: "ffsDate", before: "2027-02-01", after: "2028-04-15" };
  const blackDraftEvent = { ...whiteEvent, variantId: "black", after: "2029-01-01" }, whiteGaDraft = { ...whiteEvent, field: "generalAvailabilityDate", after: "2029-07-01" };
  draft.variantProjects.white.history.push(whiteEvent, whiteGaDraft); draft.history.push(whiteEvent, blackDraftEvent, whiteGaDraft);
  h.edit({ plc: draft, name: "Manual product name", partSkus: [{ id: "sku-a", code: "MANUAL-SKU", variantId: "black" }],
    variantGroups: colorGroups([whiteVariant]).map(group => ({ ...group, label: "Manual group label", items: group.items.map(item => item.id === "black" ? { ...item, colorName: "Manual Black" } : item) })) });
  assert.equal((await h.session.saveScoped(scopedVariant(draft))).status, "saved");
  const shared = h.snapshot.products[0].values;
  assert.deepEqual(shared.plc.variantProjects.black, accepted.variantProjects.black, "Sharing White FFS cannot share Black draft evidence or names.");
  assert.equal(shared.plc.variantProjects.white.fields.ffsDate.value, "2028-04-15");
  assert.deepEqual(shared.plc.variantProjects.white.fields.generalAvailabilityDate, accepted.variantProjects.white.fields.generalAvailabilityDate, "Unselected dates on the selected colorway retain remote values and clocks.");
  assert.ok(shared.plc.variantProjects.white.history.some(event => event.after === "2028-04-15"));
  assert.ok(!shared.plc.history.some(event => event.after === "2029-01-01" || event.after === "2029-07-01"));
  assert.ok(!shared.plc.identities.some(identity => identity.key === "unreviewed-black-source"));
  assert.equal(shared.variantGroups[0].label, fixture.variantGroups[0].label); assert.equal(shared.variantGroups[0].items[0].colorName, "Black");
  assert.equal(shared.partSkus[0].code, fixture.partSkus[0].code); assert.equal(shared.name, fixture.name); assert.equal(shared.ffsDate, fixture.ffsDate);
  assert.equal(h.products[0].plc.variantProjects.black.fields.ffsDate.value, "2029-01-01"); assert.equal(h.products[0].variantGroups[0].items[0].colorName, "Manual Black");
  assert.equal(h.products[0].partSkus[0].code, "MANUAL-SKU"); assert.equal(h.session.track().length, 1, "Other manual fields and colorway changes remain pending.");
  const writes = h.calls.filter(call => call.url.endsWith("/save")).length;
  assert.equal((await h.session.saveScoped(scopedVariant(draft))).status, "saved");
  assert.equal(h.calls.filter(call => call.url.endsWith("/save")).length, writes, "An accepted colorway date retry cannot submit retained manual drafts.");
}

{
  const h = lifecycleHarness(); await h.session.connect({ key });
  const project = variantProject("white", "2028-04-01", { created: true }), draft = colorwayEvidence({ white: project });
  const unreviewed = { id: "pink", code: "PNK", colorName: "Pink", colorHex: "#ff88aa" };
  h.edit({ plc: draft, partSkus: [{ id: "sku-a", code: "MANUAL-SKU" }], variantGroups: colorGroups([whiteVariant, unreviewed]) });
  const request = scopedVariant(draft, { variantAdds: [{ variantId: "white", groupId: "colors", variant: clone(whiteVariant), sourceKey: "source-white" }] });
  h.loseNextSaveReply(); assert.equal((await h.session.saveScoped(request)).status, "pending");
  assert.equal((await h.session.saveScoped(request)).status, "saved");
  const saves = h.calls.filter(call => call.url.endsWith("/save")); assert.equal(saves[0].body.requestId, saves[1].body.requestId); assert.equal(h.savedRequests, 1);
  const shared = h.snapshot.products[0].values;
  assert.deepEqual(shared.variantGroups[0].items.map(item => item.id), ["black", "white"], "Only the reviewed White row is added; an unrelated Pink draft stays local.");
  assert.equal(shared.partSkus[0].code, fixture.partSkus[0].code); assert.equal(shared.plc.variantProjects.white.fields.ffsDate.value, "2028-04-01");
  assert.equal(shared.plc.variantProjects.white.createdFromSource.key, "source-white"); assert.equal(shared.plc.identities[0].variantId, "white");
  assert.ok(h.products[0].variantGroups[0].items.some(item => item.id === "pink"));
  assert.equal(shared.variantGroups[0].items.filter(item => item.id === "white").length, 1, "Lost reply retry never duplicates an approved addition.");
}

{
  const h = lifecycleHarness(); await h.session.connect({ key });
  const project = variantProject("white", "2028-04-01", { created: true, groupId: "new-colors" }), draft = colorwayEvidence({ white: project });
  h.edit({ plc: draft, variantGroups: [...colorGroups(), { id: "new-colors", type: "color", label: "Reviewed colors", items: [whiteVariant] }] });
  const request = scopedVariant(draft, { plcVariantFields: { white: [] }, variantAdds: [{ variantId: "white", groupId: "new-colors", variant: whiteVariant, sourceKey: "source-white", group: { id: "new-colors", type: "color", label: "Reviewed colors" } }] });
  assert.equal((await h.session.saveScoped(request)).status, "saved");
  const shared = h.snapshot.products[0].values; assert.equal(shared.variantGroups[1].label, "Reviewed colors");
  assert.deepEqual(shared.plc.variantProjects.white.fields, {}, "Creation with no selected dates shares source binding without invented date acceptance.");
  assert.equal(shared.plc.variantProjects.white.createdFromSource.variantId, "white");
}

for (const invalid of ["missing-target", "wrong-source", "changed-reviewed-row", "missing-group-review", "unsupported-field", "unapproved-identity"]) {
  const h = lifecycleHarness(); await h.session.connect({ key });
  const groupId = invalid === "missing-group-review" ? "new-colors" : "colors", project = variantProject("white", "2028-04-01", { created: true, groupId }), draft = colorwayEvidence({ white: project });
  h.edit({ plc: draft, variantGroups: invalid === "missing-target" ? colorGroups() : groupId === "colors" ? colorGroups([whiteVariant]) : [...colorGroups(), { id: groupId, type: "color", label: "New colors", items: [whiteVariant] }] });
  const request = scopedVariant(draft, { variantAdds: invalid === "missing-target" ? [] : [{ variantId: "white", groupId, variant: { ...whiteVariant, ...(invalid === "changed-reviewed-row" ? { colorName: "Changed reviewed name" } : {}) }, sourceKey: invalid === "wrong-source" ? "another-source" : "source-white" }] });
  if (invalid === "unsupported-field") request.patches[0].plcVariantFields.white = ["name"];
  if (invalid === "unapproved-identity") { request.patches[0].patch.plc.identities[0].confirmed = false; h.edit({ plc: request.patches[0].patch.plc }); }
  const before = clone(h.products), count = h.calls.length, baseline = clone(h.baseline), result = await h.session.saveScoped(request);
  assert.equal(result.status, "pending", `${invalid} requires review rather than silent creation or evidence sharing.`);
  assert.ok(["INVALID_SCOPE", "SCOPED_UPDATE_CHANGED", "SCOPED_PRODUCT_REVIEW"].includes(result.code));
  assert.equal(h.calls.length, count); assert.deepEqual(h.products, before); assert.deepEqual(h.baseline, baseline);
}

{
  const h = lifecycleHarness(), accepted = colorwayEvidence({ white: variantProject("white", "2027-02-01") });
  h.remoteEdit({ variantGroups: colorGroups([whiteVariant]), plc: accepted }); await h.session.connect({ key });
  const draft = clone(accepted); draft.variantProjects.white.fields.ffsDate.value = "2028-04-01"; h.edit({ plc: draft });
  h.remoteEdit({ variantGroups: colorGroups() });
  const result = await h.session.saveScoped(scopedVariant(draft));
  // A deletion discovered in the master needs a new match review, without
  // silently publishing evidence against a missing colorway row.
  assert.equal(result.status, "pending"); assert.equal(result.code, "SCOPED_PRODUCT_REVIEW");
  assert.ok(!h.snapshot.products[0].values.variantGroups[0].items.some(item => item.id === "white"));
}

{
  const h = lifecycleHarness(), accepted = colorwayEvidence({ white: variantProject("white", "2027-02-01") });
  h.remoteEdit({ variantGroups: colorGroups([whiteVariant]), plc: accepted }); await h.session.connect({ key });
  const draft = clone(accepted); draft.variantProjects.white.fields.ffsDate.value = "2028-04-01"; h.edit({ plc: draft });
  const before = clone(h.products), baseline = clone(h.baseline);
  h.onSave(() => h.remoteEdit({ variantGroups: colorGroups() }));
  const result = await h.session.saveScoped(scopedVariant(draft));
  assert.equal(result.status, "pending"); assert.equal(result.code, "MASTER_CONFLICT");
  assert.ok(result.conflicts.some(conflict => conflict.path === "plc" && conflict.reason === "removed-colorway"), "Deleting a target during submission is stopped by the shared server model, after the latest-target preflight.");
  assert.deepEqual(h.products, before); assert.deepEqual(h.baseline, baseline);
  assert.equal(h.snapshot.products[0].values.plc.variantProjects.white.fields.ffsDate.value, "2027-02-01", "A late target deletion cannot publish the new variant date.");
}

{
  const h = lifecycleHarness(), acceptedRow = { ...whiteVariant, colorName: "Accepted White name", colorHex: "#eeeeee" };
  h.remoteEdit({ variantGroups: colorGroups([acceptedRow]) }); await h.session.connect({ key });
  const project = variantProject("white", "2028-04-01", { created: true }), draft = colorwayEvidence({ white: project });
  h.edit({ plc: draft, variantGroups: colorGroups([whiteVariant]) });
  const result = await h.session.saveScoped(scopedVariant(draft, { variantAdds: [{ variantId: "white", groupId: "colors", variant: whiteVariant, sourceKey: "source-white" }] }));
  assert.equal(result.status, "saved");
  const row = h.snapshot.products[0].values.variantGroups[0].items.find(item => item.id === "white");
  assert.equal(row.colorName, acceptedRow.colorName); assert.equal(row.colorHex, acceptedRow.colorHex, "An already accepted variant definition cannot be overwritten by the reviewed addition's local draft.");
  assert.equal(h.products[0].variantGroups[0].items.find(item => item.id === "white").colorName, whiteVariant.colorName, "Its separate manual row edit remains pending locally.");
}

for (const race of ["before-preflight", "during-save"]) {
  const h = lifecycleHarness(), accepted = colorwayEvidence({ white: variantProject("white", "2027-02-01") });
  h.remoteEdit({ variantGroups: colorGroups([whiteVariant]), plc: accepted }); await h.session.connect({ key });
  const draft = clone(accepted); draft.variantProjects.white.fields.ffsDate.value = "2028-04-01"; h.edit({ plc: draft });
  const before = clone(h.products), baseline = clone(h.baseline), writes = h.calls.filter(call => call.url.endsWith("/save")).length;
  const changeTarget = () => h.remoteEdit({ variantGroups: colorGroups([{ ...whiteVariant, colorKey2: "pink", colorName2: "Pink", colorHex2: "#ff88aa" }]) });
  if (race === "before-preflight") changeTarget(); else h.onSave(changeTarget);
  const result = await h.session.saveScoped(scopedVariant(draft));
  assert.equal(result.status, "pending", `${race}: retaining a row ID is insufficient after White becomes White/Pink.`);
  assert.equal(result.code, race === "before-preflight" ? "SCOPED_PRODUCT_REVIEW" : "MASTER_CONFLICT");
  if (race === "before-preflight") assert.equal(h.calls.filter(call => call.url.endsWith("/save")).length, writes, "Preflight stops a semantic mismatch before submitting any writes.");
  else assert.ok(result.conflicts.some(conflict => conflict.path === "plc" && conflict.reason === "changed-colorway"), "The shared server model fences a semantic mismatch introduced after the latest preflight.");
  assert.deepEqual(h.products, before); assert.deepEqual(h.baseline, baseline);
  const shared = h.snapshot.products[0].values;
  assert.equal(shared.variantGroups[0].items.find(item => item.id === "white").colorName2, "Pink");
  assert.equal(shared.plc.variantProjects.white.fields.ffsDate.value, "2027-02-01", "White-only evidence cannot be published to a newly dual-color White/Pink row.");
}

for (const race of ["before-preflight", "during-save"]) {
  const h = lifecycleHarness(), accepted = colorwayEvidence({ white: variantProject("white", "2027-02-01") });
  h.remoteEdit({ variantGroups: colorGroups([whiteVariant]), plc: accepted }); await h.session.connect({ key });
  const draft = clone(accepted); draft.variantProjects.white.fields.ffsDate.value = "2028-04-01"; h.edit({ plc: draft });
  const acceptedRow = { ...whiteVariant, colorName: "Accepted White finish", colorHex: "#eeeeee" };
  let canonicalAcceptedRow;
  const refineTarget = () => { h.remoteEdit({ variantGroups: colorGroups([acceptedRow]) }); canonicalAcceptedRow = clone(h.snapshot.products[0].values.variantGroups[0].items.find(item => item.id === "white")); };
  if (race === "before-preflight") refineTarget(); else h.onSave(refineTarget);
  const result = await h.session.saveScoped(scopedVariant(draft));
  assert.equal(result.status, "saved", `${race}: known color identity permits cosmetic labels and swatch refinements.`);
  const shared = h.snapshot.products[0].values, row = shared.variantGroups[0].items.find(item => item.id === "white");
  assert.deepEqual(row, canonicalAcceptedRow, "Sharing a reviewed date preserves remote accepted color definitions.");
  assert.equal(shared.plc.variantProjects.white.fields.ffsDate.value, "2028-04-01");
}

for (const reason of ["removed-colorway", "changed-colorway"]) for (const choice of ["mine", "master"]) {
  const h = lifecycleHarness(), accepted = colorwayEvidence({ white: variantProject("white", "2027-02-01") });
  h.remoteEdit({ variantGroups: colorGroups([whiteVariant]), plc: accepted }); await h.session.connect({ key });
  const draft = clone(accepted); draft.variantProjects.white.fields.ffsDate.value = "2028-04-01"; h.edit({ plc: draft });
  h.remoteEdit({ variantGroups: reason === "removed-colorway" ? colorGroups() : colorGroups([{ ...whiteVariant, colorName2: "Pink", colorHex2: "#ff88aa" }]) });
  const before = clone(h.products), baseline = clone(h.baseline);
  let reviews = 0;
  const resolveConflicts = conflicts => { reviews += 1; assert.ok(conflicts.some(conflict => conflict.path === "plc" && conflict.reason === reason)); return Object.fromEntries(conflicts.map(conflict => [conflict.key, choice])); };
  if (choice === "mine") {
    await assert.rejects(h.session.save({ resolveConflicts }), /review the source match/, "A generic keep-my-value action cannot override a source mismatch.");
    assert.deepEqual(h.products, before); assert.deepEqual(h.baseline, baseline);
  } else {
    assert.equal((await h.session.save({ resolveConflicts })).keptMaster, true);
    assert.equal(h.session.track().length, 0, "Keeping master resolves a stale source-match draft safely.");
    assert.deepEqual(model.productValues(h.products[0]), h.snapshot.products[0].values);
  }
  assert.equal(reviews, 1); assert.equal(h.snapshot.products[0].values.plc.variantProjects.white.fields.ffsDate.value, "2027-02-01");
}

for (const legacy of [false, true]) {
  const h = lifecycleHarness(), accepted = colorwayEvidence({ white: variantProject("white", "2027-02-01") });
  if (legacy) delete accepted.variantProjects.white.colorway;
  h.remoteEdit({ variantGroups: colorGroups([whiteVariant]), plc: accepted }); await h.session.connect({ key });
  const draft = clone(accepted); draft.variantProjects.white.fields.ffsDate.value = "2028-04-01"; h.edit({ plc: draft });
  h.remoteEdit({ variantGroups: colorGroups([{ ...whiteVariant, colorName2: "Pink", colorKey2: "pink", colorHex2: "#ff88aa" }]) });
  const writes = h.calls.filter(call => call.url.endsWith("/save")).length;
  await h.session.refresh();
  assert.equal(h.session.getState().connected, true, "A source mismatch preserves the connection while refreshing a read-only draft preview.");
  assert.equal(h.products[0].plc.variantProjects.white.fields.ffsDate.value, "2028-04-01");
  assert.equal(h.products[0].plc.variantProjects.white.colorway.colorName, "White");
  assert.equal(h.products[0].plc.variantProjects.white.colorway.colorName2, "", "Refresh retains or seals the original approved White identity.");
  assert.equal(h.products[0].variantGroups[0].items.find(item => item.id === "white").colorName2, "Pink");
  assert.equal(h.baseline[0].values.variantGroups[0].items.find(item => item.id === "white").colorName2, "Pink");
  const result = await h.session.saveScoped(scopedVariant(h.products[0].plc));
  assert.equal(result.status, "pending"); assert.equal(result.code, "SCOPED_PRODUCT_REVIEW", "A refreshed row/baseline cannot make stale White-only evidence eligible to share.");
  assert.equal(h.calls.filter(call => call.url.endsWith("/save")).length, writes);
  assert.equal(h.snapshot.products[0].values.plc.variantProjects.white.fields.ffsDate.value, "2027-02-01");
  await h.session.refresh();
  assert.equal(h.session.getState().connected, true); assert.equal(h.products[0].plc.variantProjects.white.colorway.colorName2, "", "Repeated refresh keeps the immutable source identity.");
}

console.log("Master client checks passed: narrow authenticated updates, real-model lifecycle conflicts, malformed-response safety, lost reply recovery, stale draft preservation, independent merges, reload/access safety, scoped parent and colorway PLC sharing without manual drafts, reviewed additions and group metadata, per-variant field/provenance scopes, invalid or changed targets before and during submission, cosmetic refinements, idempotent retries, and conflict fences.");
