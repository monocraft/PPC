import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createMasterServer } from "../../server/master-service.mjs";
import "../../public/js/master-client.js";

const codec = globalThis.PortfolioPackage;
const model = globalThis.PortfolioMasterModel;
const client = globalThis.PortfolioMasterClient;
const clone = (value) => JSON.parse(JSON.stringify(value));
const directory = await mkdtemp(join(tmpdir(), "ppc-master-roundtrip-"));
const filename = join(directory, "master_ppc.pkg");
const key = codec.generateKey();
const editorToken = "synthetic-editor-token-for-roundtrip-checks";
const origin = "https://monocraft.github.io";
const initialProduct = {
  id: "roundtrip-product", name: "Synthetic shared product", price: 89,
  laneId: "wired", order: 0, imageAssetId: "fixture-image",
  generalAvailabilityDate: "2027-03-15", ffsDate: "2027-02-10", endManufacturingDate: "2029-12-31",
  roadmap: { family: "Fixture", startMonth: "2027-03", launchMonth: "2027-03", endMonth: "2029-12", status: "in-development", confidence: "medium" },
  specs: [{ id: "battery", label: "Battery life", value: "40 hours" }, { id: "connection", label: "Connection", value: "Wireless" }],
  partSkus: [{ id: "part-1", code: "FIXTURE-001" }], variantGroups: [],
};
const image = new Uint8Array([1, 2, 3, 4, 5]);
const manifest = { version: 4, categories: [{ id: "pc-gaming-audio", name: "PC Gaming Audio", board: { lanes: [{ id: "wired", label: "Wired" }], products: [initialProduct] } }], imageAssets: [{ id: "fixture-image", sourceType: "local", packagePath: "images/fixture-image.png" }], packageInfo: codec.createPackageInfo({ comments: "Synthetic fixture" }) };
let server;
try {
  const zip = codec.createZip([{ name: "portfolio.json", data: new TextEncoder().encode(JSON.stringify(manifest)) }, { name: "images/fixture-image.png", data: image }]);
  await writeFile(filename, await codec.encrypt(zip, key));
  server = createMasterServer({ packageFile: filename, editorToken, allowedOrigins: [origin], rateLimit: 1000 });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const endpoint = `http://127.0.0.1:${server.address().port}/api/master`;
  function workspace() {
    let products = [clone(initialProduct)], baseline = model.snapshot(clone(manifest)).products, packageInfo = clone(manifest.packageInfo);
    const adapter = {
      getProducts: () => products,
      getBaselineProducts: () => baseline,
      setBaselineProducts: (next) => { baseline = clone(next); },
      setPackageInfo: (info) => { packageInfo = clone(info); },
      applyPatches: (changes) => {
        products = products.map((product) => {
          const change = changes.find((item) => item.productId === product.id);
          return change ? model.applyProductValues(product, change.values) : product;
        });
      },
    };
    const session = client.createSession({ endpoint, adapter, fetchImpl: (url, options) => fetch(url, { ...options, headers: { ...options.headers, Origin: origin } }) });
    return { session, get product() { return products[0]; }, get packageInfo() { return packageInfo; }, edit(patch) { products[0] = model.applyProductValues(products[0], { ...model.values(products[0]), ...patch }); }, reload() { return client.createSession({ endpoint, adapter, fetchImpl: (url, options) => fetch(url, { ...options, headers: { ...options.headers, Origin: origin } }) }); } };
  }
  const a = workspace(), b = workspace();
  await Promise.all([a.session.connect({ key, editorToken }), b.session.connect({ key, editorToken })]);
  a.edit({ generalAvailabilityDate: "2027-04-03", startMonth: "2027-04" });
  b.edit({ ffsDate: "2027-02-22" });
  await Promise.all([a.session.save(), b.session.save()]);
  await Promise.all([a.session.refresh(), b.session.refresh()]);
  assert.equal(a.product.generalAvailabilityDate, "2027-04-03");
  assert.equal(a.product.ffsDate, "2027-02-22");
  assert.equal(b.product.generalAvailabilityDate, "2027-04-03");
  assert.equal(a.product.roadmap.startMonth, "2027-04");
  assert.deepEqual(a.packageInfo, b.packageInfo, "two refreshed workspaces receive the same accepted footer information");
  assert.equal(a.packageInfo.comments, "1 product updated:\n- Synthetic shared product");

  a.edit({ specs: a.product.specs.map((item) => item.id === "battery" ? { ...item, value: "50 hours" } : item) });
  b.edit({ specs: b.product.specs.map((item) => item.id === "connection" ? { ...item, value: "USB + wireless" } : item) });
  await Promise.all([a.session.save(), b.session.save()]);
  await Promise.all([a.session.refresh(), b.session.refresh()]);
  assert.equal(a.product.specs.find((item) => item.id === "battery").value, "50 hours");
  assert.equal(a.product.specs.find((item) => item.id === "connection").value, "USB + wireless");

  a.edit({ specs: a.product.specs.map((item) => item.id === "battery" ? { ...item, value: "60 hours" } : item) });
  b.edit({ specs: b.product.specs.map((item) => item.id === "battery" ? { ...item, value: "70 hours" } : item) });
  await a.session.save({ reason: "Updated battery duration.\nChecked with the team." });
  await a.session.refresh();
  assert.equal(a.packageInfo.comments, "Updated battery duration.\nChecked with the team.");
  let conflictsSeen = 0;
  await b.session.save({ reason: "Approved final battery duration.", resolveConflicts: (conflicts) => {
    conflictsSeen += conflicts.length;
    return Object.fromEntries(conflicts.map((item) => [item.key, "mine"]));
  } });
  assert.ok(conflictsSeen > 0);
  assert.equal(b.product.specs.find((item) => item.id === "battery").value, "70 hours");
  assert.equal(b.session.getState().pending.length, 0, "an accepted resolution clears the Save to master state");
  assert.equal(b.packageInfo.comments, "Approved final battery duration.");

  await a.session.refresh();
  a.edit({ ffsDate: "2027-02-24" });
  b.edit({ ffsDate: "2027-02-25" });
  await a.session.save();
  const acceptedInfo = clone(a.packageInfo);
  const beforeCancelledInfo = clone(b.packageInfo);
  const cancelled = await b.session.save({ reason: "Cancelled note must not be published.", resolveConflicts: () => null });
  assert.equal(cancelled.cancelled, true);
  assert.equal(b.product.ffsDate, "2027-02-25");
  assert.deepEqual(b.packageInfo, beforeCancelledInfo, "cancelling a conflict leaves the workspace's accepted metadata intact");
  const reloaded = b.reload();
  await reloaded.connect({ key, editorToken });
  assert.deepEqual(b.packageInfo, acceptedInfo, "reconnecting receives the latest accepted note without publishing the cancelled note");
  assert.equal(b.product.ffsDate, "2027-02-25", "refresh and reload preserve an unsent draft");
  await reloaded.save({ resolveConflicts: (conflicts) => Object.fromEntries(conflicts.map((item) => [item.key, "master"])) });
  assert.equal(b.product.ffsDate, "2027-02-24");
  assert.equal(reloaded.getState().pending.length, 0);

  await a.session.refresh();
  a.edit({ partSkus: [...a.product.partSkus, { id: "part-a", code: "FIXTURE-A" }] });
  b.edit({ partSkus: [...b.product.partSkus, { id: "part-b", code: "FIXTURE-B" }] });
  await Promise.all([a.session.save(), reloaded.save()]);
  await a.session.refresh();
  assert.deepEqual(a.product.partSkus.map((item) => item.code).sort(), ["FIXTURE-001", "FIXTURE-A", "FIXTURE-B"]);
  const entries = codec.readZip(await codec.decrypt(new Uint8Array(await readFile(filename)), key));
  assert.deepEqual(entries.get("images/fixture-image.png"), image);
  const saved = JSON.parse(new TextDecoder().decode(entries.get("portfolio.json")));
  assert.equal(saved.categories[0].board.products[0].imageAssetId, "fixture-image");
  assert.equal(saved.categories[0].board.products[0].laneId, "wired");
  console.log("Master roundtrip passed: simultaneous date/spec/SKU edits, explicit mine/master choices, cancelled/reloaded drafts, and preserved images/layout.");
} finally {
  if (server) await new Promise((done) => { server.closeAllConnections(); server.close(done); });
  await rm(directory, { recursive: true, force: true });
}
