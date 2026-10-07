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
console.log("Master client checks passed: narrow authenticated updates, stale draft preservation, unrelated date/spec merging, explicit conflict choices, repeat conflicts, cancellation/reload safety, concurrent local edits, disconnect and sanitized errors.");
