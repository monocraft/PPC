import assert from "node:assert/strict";

await import("../../public/js/package-codec.js");
const codec = globalThis.PortfolioPackage;
assert.equal(codec.MAX_PACKAGE_BYTES, 64 * 1024 * 1024);
const encode = (value) => new TextEncoder().encode(value);
const decode = (value) => new TextDecoder().decode(value);
const key = codec.generateKey();
assert.match(key, /^PPC-[A-Za-z0-9_-]{43}$/);
assert.equal(codec.normalizeKey(` \n${key}\t `), key, "copied outer whitespace may be removed without altering the key");
assert.notEqual(codec.generateKey(), key, "keys must use fresh secure random bytes");
const lastAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const noncanonical = `${key.slice(0, -1)}${lastAlphabet[lastAlphabet.indexOf(key.at(-1)) | 1]}`;
for (const invalid of ["", "password", key.slice(0, -1), `${key}=`, key.toLowerCase().replace(/^ppc-/, "ppc-"), noncanonical]) {
  assert.throws(() => codec.normalizeKey(invalid), /package key|complete key/i, "only a canonical 256-bit package key is accepted");
}

const entries = [
  { name: "portfolio.json", data: encode(JSON.stringify({ version: 4, categories: [{ id: "audio", board: { products: [{ id: "p1", roadmap: { startMonth: "2026-01" } }] } }] })) },
  { name: "images/product.webp", data: Uint8Array.of(0, 255, 3, 0, 8) },
  { name: "images/音声.webp", data: Uint8Array.of(7, 8, 9) },
  { name: "empty.bin", data: new Uint8Array() },
];
const originals = structuredClone(entries);
const zip = codec.createZip(entries);
const parsed = codec.readZip(zip);
assert.deepEqual([...parsed.keys()], entries.map((entry) => entry.name));
for (const entry of entries) assert.deepEqual(parsed.get(entry.name), entry.data, "ZIP round trips must preserve each manifest/image payload exactly");
assert.deepEqual(entries, originals, "the ZIP writer must not mutate its entries");
assert.equal(codec.readZip(codec.createZip([])).size, 0, "empty stored ZIP files remain valid at the codec level");
const offsetView = new Uint8Array(zip.length + 17);
offsetView.set(zip, 9);
assert.deepEqual(codec.readZip(offsetView.subarray(9, 9 + zip.length)), parsed, "the ZIP reader must honor typed-array byte offsets");
parsed.get("images/product.webp")[0] = 42;
assert.equal(codec.readZip(zip).get("images/product.webp")[0], 0, "read entries must not alias the original package buffer");

const encrypted = await codec.encrypt(zip, key);
assert.ok(codec.isEncrypted(encrypted));
assert.ok(!codec.isEncrypted(zip), "legacy stored ZIP packages must remain distinguishable from encrypted packages");
assert.equal(decode(encrypted.subarray(0, 8)), "PPCPKG01");
assert.equal(encrypted.length, zip.length + 8 + 12 + 16, "the envelope contains a 12-byte IV and full 128-bit GCM tag");
assert.deepEqual(await codec.decrypt(encrypted, key), zip);
assert.deepEqual([...codec.readZip(await codec.decrypt(encrypted, key)).keys()], entries.map((entry) => entry.name));
const secondEncryption = await codec.encrypt(zip, key);
assert.notDeepEqual(secondEncryption.subarray(8, 20), encrypted.subarray(8, 20), "each encryption must use a fresh IV even for identical input and key");
assert.notDeepEqual(secondEncryption, encrypted);
assert.deepEqual(await codec.decrypt(secondEncryption, key), zip);
await assert.rejects(codec.decrypt(encrypted, codec.generateKey()), /key is incorrect|changed/i);
for (const offset of [0, 8, 19, 20, encrypted.length - 1]) {
  const damaged = encrypted.slice();
  damaged[offset] ^= 1;
  await assert.rejects(codec.decrypt(damaged, key), /not an encrypted|unsupported|incorrect|changed/i, "magic, IV, ciphertext and tag tampering must all fail before ZIP parsing");
}
const unsupported = encrypted.slice();
unsupported[7] = "2".charCodeAt(0);
assert.ok(codec.isEncrypted(unsupported), "future envelope versions must be detected as encrypted rather than treated as legacy ZIP");
await assert.rejects(codec.decrypt(unsupported, "invalid-key"), /version is unsupported/i, "an unknown version must fail before a key or payload is processed");
for (const length of [0, 5, 6, 8, 19, 20, 35, encrypted.length - 1]) {
  await assert.rejects(codec.decrypt(encrypted.slice(0, length), key), /not an encrypted|truncated|incorrect|changed/i);
}
await assert.rejects(codec.decrypt(encrypted.slice(0, 20), "invalid-key"), /truncated/i, "a truncated envelope must fail before key parsing");
assert.deepEqual(await codec.decrypt(await codec.encrypt(new Uint8Array(), key), key), new Uint8Array(), "authenticated empty plaintext is allowed independently of ZIP validation");

// The reader also accepts the exact stored-ZIP encoding exported by the older
// application, rather than merely round-tripping its own writer.
const legacyZip = new Uint8Array(Buffer.from("UEsDBBQAAAgAAAAAAAAvFtndHQAAAB0AAAAOAAAAcG9ydGZvbGlvLmpzb257InZlcnNpb24iOjQsImNhdGVnb3JpZXMiOltdfVBLAwQUAAAIAAAAAAAAHYC8VQMAAAADAAAADwAAAGltYWdlcy9vbGQud2VicAECA1BLAQIUABQAAAgAAAAAAAAvFtndHQAAAB0AAAAOAAAAAAAAAAAAAAAAAAAAAABwb3J0Zm9saW8uanNvblBLAQIUABQAAAgAAAAAAAAdgLxVAwAAAAMAAAAPAAAAAAAAAAAAAAAAAEkAAABpbWFnZXMvb2xkLndlYnBQSwUGAAAAAAIAAgB5AAAAeQAAAAAA", "base64"));
assert.equal(decode(codec.readZip(legacyZip).get("portfolio.json")), '{"version":4,"categories":[]}');
assert.deepEqual(codec.readZip(legacyZip).get("images/old.webp"), Uint8Array.of(1, 2, 3));

const sample = codec.createZip([{ name: "file.bin", data: Uint8Array.of(1, 2, 3) }]);
const endOffset = sample.length - 22;
const centralOffset = new DataView(sample.buffer).getUint32(endOffset + 16, true);
const dataOffset = 30 + encode("file.bin").length;
function altered(mutator) { const bytes = sample.slice(); mutator(new DataView(bytes.buffer), bytes); return bytes; }
assert.throws(() => codec.readZip(altered((_, bytes) => { bytes[dataOffset] ^= 1; })), /CRC integrity/i, "stored data changes must fail CRC validation");
assert.throws(() => codec.readZip(altered((view) => view.setUint32(14, 0, true))), /conflicts/i, "local and central checksums must agree before reading payloads");
assert.throws(() => codec.readZip(altered((view) => view.setUint32(centralOffset + 42, centralOffset, true))), /truncated|invalid offset/i, "local offsets must not enter the central directory");
assert.throws(() => codec.readZip(altered((view) => view.setUint32(centralOffset + 42, 0xffffffff, true))), /ZIP64/i);
assert.throws(() => codec.readZip(altered((view) => view.setUint32(endOffset + 16, 0xffffffff, true))), /ZIP64/i);
assert.throws(() => codec.readZip(altered((view) => view.setUint32(endOffset + 12, centralOffset + 100, true))), /directory.*invalid/i);
assert.throws(() => codec.readZip(altered((view) => { view.setUint16(endOffset + 8, 10001, true); view.setUint16(endOffset + 10, 10001, true); })), /10,000-entry/i);
assert.throws(() => codec.readZip(altered((view) => view.setUint16(endOffset + 4, 1, true))), /Multi-disk/i);
assert.throws(() => codec.readZip(altered((view) => view.setUint16(endOffset + 10, 0, true))), /Multi-disk/i);
assert.throws(() => codec.readZip(altered((view) => { view.setUint16(endOffset + 8, 0, true); view.setUint16(endOffset + 10, 0, true); })), /entry count/i);
assert.throws(() => codec.readZip(altered((view) => { view.setUint16(8, 8, true); view.setUint16(centralOffset + 10, 8, true); })), /unsupported ZIP compression/i);
assert.throws(() => codec.readZip(altered((view) => view.setUint16(centralOffset + 8, 0x0808, true))), /data descriptors|unsupported ZIP flags/i);
assert.throws(() => codec.readZip(altered((view) => view.setUint16(centralOffset + 8, 0x0801, true))), /Encrypted ZIP entries|unsupported ZIP flags/i);
assert.throws(() => codec.readZip(altered((view) => view.setUint32(centralOffset + 24, 5, true))), /inconsistent sizes/i);
assert.throws(() => codec.readZip(altered((view) => { view.setUint32(centralOffset + 20, codec.MAX_PACKAGE_BYTES + 1, true); view.setUint32(centralOffset + 24, codec.MAX_PACKAGE_BYTES + 1, true); })), /64 MiB/i, "declared uncompressed data must be bounded before allocation or entry reads");
assert.throws(() => codec.readZip(altered((view) => view.setUint16(26, 9, true))), /truncated|conflicts/i);
assert.throws(() => codec.readZip(altered((_, bytes) => { bytes[30] = "x".charCodeAt(0); })), /conflicts/i);
assert.throws(() => codec.readZip(altered((view) => view.setUint16(10, 1, true))), /conflicts/i, "local and central timestamps must agree");
for (const length of [0, 21, 35, centralOffset, sample.length - 1]) assert.throws(() => codec.readZip(sample.slice(0, length)), /supported PPC ZIP|truncated/i);
assert.throws(() => codec.readZip(new Uint8Array([...sample, 0])), /supported PPC ZIP|truncated/i, "trailing bytes must not bypass the directory bounds");
const asciiFlags = altered((view) => { view.setUint16(6, 0, true); view.setUint16(centralOffset + 8, 0, true); });
assert.deepEqual(codec.readZip(asciiFlags).get("file.bin"), Uint8Array.of(1, 2, 3), "older ASCII-only entries without a UTF-8 flag remain readable");
const zip64Extra = new Uint8Array(sample.length + 4);
zip64Extra.set(sample.subarray(0, endOffset));
zip64Extra.set(Uint8Array.of(1, 0, 0, 0), endOffset);
zip64Extra.set(sample.subarray(endOffset), endOffset + 4);
const zip64ExtraView = new DataView(zip64Extra.buffer);
zip64ExtraView.setUint16(centralOffset + 30, 4, true);
zip64ExtraView.setUint32(endOffset + 4 + 12, zip64ExtraView.getUint32(endOffset + 4 + 12, true) + 4, true);
assert.throws(() => codec.readZip(zip64Extra), /ZIP64/i, "ZIP64 extra fields must fail even when sentinel sizes are absent");

const pair = codec.createZip([{ name: "a.bin", data: Uint8Array.of(1) }, { name: "b.bin", data: Uint8Array.of(2) }]);
const pairEnd = pair.length - 22;
const pairView = new DataView(pair.buffer);
const pairCentral = pairView.getUint32(pairEnd + 16, true);
const secondCentral = pairCentral + 46 + 5;
const secondLocal = pairView.getUint32(secondCentral + 42, true);
const duplicate = pair.slice();
duplicate[secondCentral + 46] = "a".charCodeAt(0);
duplicate[secondLocal + 30] = "a".charCodeAt(0);
assert.throws(() => codec.readZip(duplicate), /duplicate entry/i, "duplicate names in different local entries must be rejected");
const overlapped = pair.slice();
new DataView(overlapped.buffer).setUint32(secondCentral + 42, 0, true);
assert.throws(() => codec.readZip(overlapped), /conflicts|overlap/i, "two directory entries must not share local data");
for (const name of ["../file.bin", "/file.bin", "a/../file.bin", "a/./file.bin", "a//file.bin", "a\\file.bin", "C:file.bin", "bad\0name", "images/"]) {
  assert.throws(() => codec.createZip([{ name, data: new Uint8Array() }]), /unsafe/i);
}
assert.throws(() => codec.createZip([{ name: "a", data: new Uint8Array() }, { name: "a", data: new Uint8Array() }]), /duplicate/i);
assert.throws(() => codec.createZip([{ name: "\ud800", data: new Uint8Array() }]), /Unicode/i);
assert.throws(() => codec.createZip([{ name: "a".repeat(65536), data: new Uint8Array() }]), /name is too long/i);
assert.throws(() => codec.createZip(Array.from({ length: 10001 }, (_, index) => ({ name: `f${index}`, data: new Uint8Array() }))), /10,000-entry/i);
const unsafeRead = sample.slice();
unsafeRead.set(encode("../e.bin"), 30);
unsafeRead.set(encode("../e.bin"), centralOffset + 46);
assert.throws(() => codec.readZip(unsafeRead), /unsafe traversal/i, "unsafe paths from a downloaded ZIP must fail as well as writer input");
const invalidUtf8 = sample.slice();
invalidUtf8[30] = 255;
invalidUtf8[centralOffset + 46] = 255;
assert.throws(() => codec.readZip(invalidUtf8), /UTF-8/i);

const overLimit = new Uint8Array(codec.MAX_PACKAGE_BYTES + 1);
assert.throws(() => codec.readZip(overLimit), /64 MiB/i);
assert.throws(() => codec.createZip([{ name: "large", data: overLimit }]), /64 MiB/i);
await assert.rejects(codec.decrypt(overLimit, key), /64 MiB/i);
await assert.rejects(codec.encrypt(overLimit.subarray(0, codec.MAX_PACKAGE_BYTES), key), /64 MiB/i, "ciphertext/tag/header must fit the same total package limit");
console.log("Package codec checks passed: 256-bit keys, authenticated envelopes, legacy stored ZIP, CRC/local-directory integrity, traversal/duplicate/offset/encoding restrictions, and size/entry limits.");
