import assert from "node:assert/strict";
import vm from "node:vm";
import "../../public/js/package-codec.js";
import "../../public/js/package-client.js";
import { renderPackageSource } from "../configure-package-source.mjs";

const codec = globalThis.PortfolioPackage;
const client = globalThis.PortfolioPackageClient;
const key = codec.generateKey();
const endpoint = "https://package.example.org/api/package/latest";
assert.equal(client.normalizeEndpoint(endpoint), endpoint);
assert.equal(client.normalizeEndpoint("http://127.0.0.1:8787/api/package/latest"), "http://127.0.0.1:8787/api/package/latest");
for (const value of ["", "javascript:alert(1)", "http://package.example.org/api/package/latest", "https://key:secret@package.example.org/api/package/latest", endpoint + "?key=secret", endpoint + "#secret", "https://example.org/sharepoint-view"]) {
  assert.throws(() => client.normalizeEndpoint(value), Error);
}
let fetched = 0;
await assert.rejects(client.downloadLatest({ endpoint, key: "invalid", fetchImpl: () => { fetched += 1; } }));
assert.equal(fetched, 0, "a malformed key must fail before any request");
const packageBytes = await codec.encrypt(codec.createZip([{ name: "portfolio.json", data: new TextEncoder().encode('{"version":4}') }]), key);
const progress = [];
const result = await client.downloadLatest({ endpoint, key, onProgress: (...value) => progress.push(value), fetchImpl: async (url, options) => {
  assert.equal(url, endpoint, "the key must never be put in a URL");
  assert.equal(options.method, "POST");
  assert.deepEqual(JSON.parse(options.body), { key });
  assert.equal(options.credentials, "omit");
  assert.equal(options.cache, "no-store");
  assert.equal(options.redirect, "error");
  assert.equal(options.referrerPolicy, "no-referrer");
  assert.equal(Object.keys(options.headers).some(value => /authorization|cookie/i.test(value)), false);
  return new Response(packageBytes, { headers: { "Content-Length": String(packageBytes.length) } });
} });
assert.deepEqual(result, packageBytes);
assert.ok(progress.length && progress.at(-1)[0] === packageBytes.length);
for (const status of [401, 429, 500, 503]) {
  await assert.rejects(client.downloadLatest({ endpoint, key, fetchImpl: async () => new Response("private upstream information", { status }) }), error => !error.message.includes("private upstream"));
}
await assert.rejects(client.downloadLatest({ endpoint, key, fetchImpl: async () => new Response("<html>SharePoint sign-in</html>") }), /encrypted unified package/);
await assert.rejects(client.downloadLatest({ endpoint, key, fetchImpl: async () => new Response(codec.createZip([{ name: "portfolio.json", data: new Uint8Array([1]) }])) }), /encrypted unified package/);
let cancelled = false;
const body = new ReadableStream({ start(stream) { stream.enqueue(packageBytes); }, cancel() { cancelled = true; } });
await assert.rejects(client.readLimitedResponse(new Response(body, { headers: { "Content-Length": String(codec.MAX_PACKAGE_BYTES + 1) } })), /supported size/);
assert.equal(cancelled, true, "an oversized advertised response must stop downloading");
const controller = new AbortController();
controller.abort();
await assert.rejects(client.downloadLatest({ endpoint, key, signal: controller.signal, fetchImpl: async (_url, options) => { options.signal.throwIfAborted(); } }), { name: "AbortError" });
const context = vm.createContext({});
new vm.Script(renderPackageSource(endpoint)).runInContext(context);
assert.equal(context.PPC_PACKAGE_SOURCE.endpoint, endpoint);
assert.equal(context.PPC_PACKAGE_SOURCE.label, "Shared portfolio");
assert.ok(Object.isFrozen(context.PPC_PACKAGE_SOURCE));
assert.equal(renderPackageSource().includes('"endpoint":""'), true);
assert.throws(() => renderPackageSource("https://example.org/api/package/latest?key=secret"));
console.log("Package client checks passed: key-only POST, safe endpoint configuration, encrypted-only source, bounded/cancelled transfers, generic errors, cancellation and progress.");
