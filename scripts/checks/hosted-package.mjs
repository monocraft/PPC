import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, mkdtemp, rm, rmdir, open } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { inspectHostedData, validateEncryptedEnvelope, validateDecryptedPackage, publishMasterPackage } from "../publish-master-package.mjs";

const argumentsSet = new Set(process.argv.slice(2));
if ([...argumentsSet].some((argument) => !["--required", "--deployment-only"].includes(argument))) throw new Error("Use only --required or --deployment-only.");
const hosted = await inspectHostedData(undefined, { required: argumentsSet.has("--required") });
if (!argumentsSet.has("--deployment-only")) {
  const codec = globalThis.PortfolioPackage;
  const encode = (value) => new TextEncoder().encode(value);
  const manifest = {
    version: 4,
    categories: [{ id: "pc-gaming-audio", board: { lanes: [{ id: "wired" }], products: [{ id: "p1", name: "Synthetic fixture", imageAssetId: "image1", variantGroups: [{ items: [{ imageAssetId: "image1" }] }] }] } }],
    imageAssets: [{ id: "image1", sourceType: "local", mimeType: "image/webp", packagePath: "images/image1.webp" }],
  };
  const zip = codec.createZip([{ name: "portfolio.json", data: encode(JSON.stringify(manifest)) }, { name: "images/image1.webp", data: Uint8Array.of(1, 2, 3) }]);
  const key = codec.generateKey();
  const encrypted = await codec.encrypt(zip, key);
  assert.deepEqual(validateEncryptedEnvelope(encrypted), encrypted);
  assert.deepEqual(validateDecryptedPackage(zip), { categoryCount: 1, productCount: 1, entryCount: 2 });
  assert.throws(() => validateEncryptedEnvelope(zip), /encrypted PPCPKG01/i, "a plaintext builder export must never be published as the master");
  for (const length of [0, 8, 20, 35, 36, 57]) assert.throws(() => validateEncryptedEnvelope(encrypted.subarray(0, length)), /truncated|no package content/i);
  const version = encrypted.slice(); version[7] = 50;
  assert.throws(() => validateEncryptedEnvelope(version), /encrypted PPCPKG01/i);
  assert.throws(() => validateEncryptedEnvelope(new Uint8Array(codec.MAX_PACKAGE_BYTES + 1)), /64 MiB/i);
  const noImage = codec.createZip([{ name: "portfolio.json", data: encode(JSON.stringify(manifest)) }]);
  assert.throws(() => validateDecryptedPackage(noImage), /missing a saved product image/i);
  const dangling = structuredClone(manifest); dangling.categories[0].board.products[0].imageAssetId = "absent";
  assert.throws(() => validateDecryptedPackage(codec.createZip([{ name: "portfolio.json", data: encode(JSON.stringify(dangling)) }, { name: "images/image1.webp", data: Uint8Array.of(1) }])), /missing from its image library/i);
  assert.throws(() => validateDecryptedPackage(codec.createZip([{ name: "portfolio.json", data: encode("{broken-json") }])), /damaged/i);
  assert.throws(() => validateDecryptedPackage(codec.createZip([{ name: "portfolio.json", data: encode(JSON.stringify({ version: 99, categories: [] })) }])), /unsupported/i);

  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ppc-hosted-package-"));
  try {
    const publicDirectory = path.join(fixtureRoot, "public");
    const dataDirectory = path.join(publicDirectory, "data");
    await mkdir(dataDirectory, { recursive: true });
    await assert.rejects(inspectHostedData(dataDirectory, { required: true }), /missing/i);
    assert.deepEqual(await inspectHostedData(dataDirectory), { present: false });
    const input = path.join(fixtureRoot, "input.pkg");
    const keyFile = path.join(fixtureRoot, "private-key.txt");
    const master = path.join(dataDirectory, "master_ppc.pkg");
    await writeFile(input, encrypted); await writeFile(keyFile, key);
    const published = await publishMasterPackage({ input, keyFile, projectRoot: fixtureRoot });
    assert.equal(published.authenticated, true);
    assert.deepEqual(await readFile(master), Buffer.from(encrypted), "the helper must publish only the original encrypted bytes");
    assert.deepEqual(await inspectHostedData(dataDirectory, { required: true }), { present: true });
    await writeFile(keyFile, codec.generateKey());
    await assert.rejects(publishMasterPackage({ input, keyFile, projectRoot: fixtureRoot }), /key is incorrect|changed/i);
    assert.deepEqual(await readFile(master), Buffer.from(encrypted), "wrong-key failures must preserve the published master");
    await writeFile(input, zip);
    await assert.rejects(publishMasterPackage({ input, projectRoot: fixtureRoot }), /encrypted PPCPKG01/i);
    assert.deepEqual(await readFile(master), Buffer.from(encrypted), "unencrypted input must not replace the master");
    await writeFile(input, encrypted);
    const publicKey = path.join(publicDirectory, "private-key.txt"); await writeFile(publicKey, key);
    await assert.rejects(publishMasterPackage({ input, keyFile: publicKey, projectRoot: fixtureRoot }), /outside public/i);
    await rm(publicKey);
    const disguisedZip = path.join(dataDirectory, "notes.txt"); await writeFile(disguisedZip, zip);
    await assert.rejects(inspectHostedData(dataDirectory), /unencrypted ZIP/i, "ZIP detection must examine contents even when the name hides its type");
    await rm(disguisedZip);
    const second = path.join(dataDirectory, "another.pkg"); await writeFile(second, encrypted);
    await assert.rejects(inspectHostedData(dataDirectory), /only one .pkg/i);
    await rm(second);
    for (const [filename, content] of [["PACKAGE-KEY.txt", key], ["portfolio.json", JSON.stringify(manifest)], ["product.webp", "image"], ["notes.txt", "other data"]]) {
      const accidentalFile = path.join(dataDirectory, filename);
      await writeFile(accidentalFile, content);
      await assert.rejects(inspectHostedData(dataDirectory), /only the master_ppc.pkg/i, "the hosted data allowlist must reject keys, plaintext data, images, and unrelated files");
      await assert.rejects(publishMasterPackage({ input, projectRoot: fixtureRoot }), /only the master_ppc.pkg/i, "the publishing helper must refuse a destination folder containing accidental public files");
      await rm(accidentalFile);
    }
    const accidentalFolder = path.join(dataDirectory, "images");
    await mkdir(accidentalFolder);
    await assert.rejects(inspectHostedData(dataDirectory), /no other files or folders/i);
    await rmdir(accidentalFolder);
    await writeFile(master, zip);
    await assert.rejects(inspectHostedData(dataDirectory, { required: true }), /encrypted PPCPKG01/i);
    await writeFile(master, encrypted);
    const large = path.join(fixtureRoot, "oversized.pkg");
    const handle = await open(large, "w");
    try { await handle.truncate(codec.MAX_PACKAGE_BYTES + 1); } finally { await handle.close(); }
    await assert.rejects(publishMasterPackage({ input: large, projectRoot: fixtureRoot }), /64 MiB/i);
    assert.deepEqual(await readFile(master), Buffer.from(encrypted));
  } finally {
    // The target comes directly from mkdtemp in the operating system temp folder.
    const expectedParent = path.resolve(os.tmpdir());
    assert.equal(path.dirname(path.resolve(fixtureRoot)), expectedParent);
    assert.match(path.basename(fixtureRoot), /^ppc-hosted-package-/);
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}
console.log(`Hosted package checks passed: ${hosted.present ? "encrypted master present" : "master is optional and currently absent"}; encrypted-only publication, bounded files, fixed atomic destination, and authenticated content verification.`);
