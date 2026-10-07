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
const baseUrl = "https://monocraft.github.io/PPC/";
const staticUrl = baseUrl + "data/master_ppc.pkg";
assert.equal(client.normalizePackageUrl(undefined, baseUrl), staticUrl);
assert.equal(client.normalizePackageUrl("  ", baseUrl), staticUrl);
assert.equal(client.normalizePackageUrl("./data/master_ppc.pkg", baseUrl + "?view=products#details"), staticUrl);
assert.equal(client.normalizePackageUrl(staticUrl, baseUrl), staticUrl);
assert.equal(client.normalizePackageUrl("./data/master_ppc.pkg", "http://127.0.0.1:4173/"), "http://127.0.0.1:4173/data/master_ppc.pkg");
for (const value of ["https://other.example.org/master.pkg", "https://monocraft.github.io:444/PPC/master.pkg", "http://monocraft.github.io/PPC/master.pkg", "https://key:secret@monocraft.github.io/PPC/master.pkg", "javascript:alert(1)", "./data/master.pkg?key=secret", "./data/master.pkg#secret", "./data/master.pkg?", "./data/master.pkg#", "./data/master.json", "./data/master.pkg/"]) {
  assert.throws(() => client.normalizePackageUrl(value, baseUrl), Error);
}
assert.throws(() => client.normalizePackageUrl("./data/master.pkg", "http://insecure.example.org/"), Error);
assert.throws(() => client.normalizePackageUrl("./data/master.pkg", "https://key:secret@monocraft.github.io/PPC/"), Error);
const staticRequests = [];
const staticProgress = [];
for (let attempt = 0; attempt < 2; attempt += 1) {
  const bytes = await client.downloadLatest({ packageUrl: "./data/master_ppc.pkg", baseUrl, key: "private-key-must-not-be-transmitted", onProgress: (...value) => staticProgress.push(value), fetchImpl: async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, new URL(baseUrl).origin);
    assert.equal(parsed.pathname, "/PPC/data/master_ppc.pkg");
    assert.deepEqual([...parsed.searchParams.keys()], ["_ppc"]);
    assert.equal(options.method, "GET");
    assert.equal(options.credentials, "omit");
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    assert.equal(options.referrerPolicy, "no-referrer");
    assert.equal(Object.hasOwn(options, "body"), false);
    assert.equal(Object.hasOwn(options, "headers"), false, "static retrieval requires no authentication or key headers");
    assert.equal(JSON.stringify({ url, options }).includes("private-key"), false);
    staticRequests.push(url);
    return new Response(packageBytes, { headers: { "Content-Length": String(packageBytes.length) } });
  } });
  assert.deepEqual(bytes, packageBytes);
}
assert.notEqual(staticRequests[0], staticRequests[1], "each pull must request a fresh cache URL");
assert.equal(staticProgress.at(-1)[0], packageBytes.length);
const defaultBytes = await client.downloadLatest({ baseUrl, fetchImpl: async url => {
  assert.equal(new URL(url).pathname, "/PPC/data/master_ppc.pkg");
  return new Response(packageBytes);
} });
assert.deepEqual(defaultBytes, packageBytes, "an unconfigured endpoint defaults to the encrypted site master");
let rejectedFetches = 0;
await assert.rejects(client.downloadLatest({ packageUrl: "https://untrusted.example.org/master.pkg", baseUrl, fetchImpl: () => { rejectedFetches += 1; } }));
assert.equal(rejectedFetches, 0, "invalid static sources must fail before network access");
await assert.rejects(client.downloadLatest({ packageUrl: "./data/master_ppc.pkg", baseUrl, fetchImpl: async () => new Response("private source path", { status: 404 }) }), /not been published yet/);
for (const status of [401, 403, 429, 500, 503]) {
  await assert.rejects(client.downloadLatest({ packageUrl: "./data/master_ppc.pkg", baseUrl, fetchImpl: async () => new Response("private upstream data", { status }) }), error => !error.message.includes("private upstream"));
}
for (const bytes of [new TextEncoder().encode("<html>Sign in</html>"), codec.createZip([{ name: "portfolio.json", data: new Uint8Array([1]) }]), packageBytes.subarray(0, 16)]) {
  await assert.rejects(client.downloadLatest({ packageUrl: "./data/master_ppc.pkg", baseUrl, fetchImpl: async () => new Response(bytes) }), /encrypted unified package/);
}
for (const length of [packageBytes.length - 1, packageBytes.length + 1]) {
  await assert.rejects(client.downloadLatest({ packageUrl: "./data/master_ppc.pkg", baseUrl, fetchImpl: async () => new Response(packageBytes, { headers: { "Content-Length": String(length) } }) }), /incomplete/);
}
await assert.rejects(client.downloadLatest({ packageUrl: "./data/master_ppc.pkg", baseUrl, fetchImpl: async () => { throw new Error("secret token and remote path"); } }), error => !error.message.includes("secret"));
await assert.rejects(client.downloadLatest({ packageUrl: "./data/master_ppc.pkg", baseUrl, fetchImpl: async () => new Response(new ReadableStream({ start(stream) { stream.error(new Error("secret stream authentication data")); } })) }), error => !error.message.includes("secret"));
const compressedBytes = await client.downloadLatest({ packageUrl: "./data/master_ppc.pkg", baseUrl, fetchImpl: async () => new Response(packageBytes, { headers: { "Content-Length": "2", "Content-Encoding": "gzip" } }) });
assert.deepEqual(compressedBytes, packageBytes, "decoded browser bytes must not be compared to compressed transport length");
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
for (const length of ["-1", "1.5", "NaN"]) {
  await assert.rejects(client.readLimitedResponse(new Response(packageBytes, { headers: { "Content-Length": length } })), /supported size/);
}
let oversizedCancelled = false;
await assert.rejects(client.readLimitedResponse(new Response(new ReadableStream({ start(stream) { stream.enqueue(new Uint8Array(codec.MAX_PACKAGE_BYTES + 1)); }, cancel() { oversizedCancelled = true; } }))), /supported size/);
assert.equal(oversizedCancelled, true, "an oversized unadvertised stream must stop downloading");
const controller = new AbortController();
controller.abort();
await assert.rejects(client.downloadLatest({ endpoint, key, signal: controller.signal, fetchImpl: async (_url, options) => { options.signal.throwIfAborted(); } }), { name: "AbortError" });
let preAbortedFetches = 0;
await assert.rejects(client.downloadLatest({ baseUrl, signal: controller.signal, fetchImpl: () => { preAbortedFetches += 1; } }), { name: "AbortError" });
assert.equal(preAbortedFetches, 0);
const readingController = new AbortController();
let waitingCancelled = false;
const waitingStream = new ReadableStream({ start(stream) { stream.enqueue(packageBytes.subarray(0, 36)); }, cancel() { waitingCancelled = true; } });
const waiting = client.downloadLatest({ baseUrl, signal: readingController.signal, onProgress: () => readingController.abort(), fetchImpl: async () => new Response(waitingStream) });
await assert.rejects(waiting, { name: "AbortError" });
assert.equal(waitingCancelled, true, "cancellation must stop a transfer while its stream is being read");
const context = vm.createContext({});
new vm.Script(renderPackageSource(endpoint)).runInContext(context);
assert.equal(context.PPC_PACKAGE_SOURCE.endpoint, endpoint);
assert.equal(context.PPC_PACKAGE_SOURCE.label, "Shared portfolio");
assert.ok(Object.isFrozen(context.PPC_PACKAGE_SOURCE));
assert.equal(renderPackageSource().includes('"endpoint":""'), true);
assert.throws(() => renderPackageSource("https://example.org/api/package/latest?key=secret"));
console.log("Package client checks passed: same-origin key-free static GETs, unique cache URLs, safe source configuration, encrypted-only and complete bounded streams, cancellation/progress, sanitized errors, and relay POST compatibility.");
