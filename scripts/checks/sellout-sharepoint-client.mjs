import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const [validatorSource, clientSource] = await Promise.all(["sellout-sharepoint.js", "sellout-sharepoint-client.js"].map(name => readFile(new URL(`../../public/js/${name}`, import.meta.url), "utf8")));
const config = { clientId: "11111111-2222-4333-8444-555555555555", tenantId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", sharepointHosts: ["northwind.sharepoint.com", "northwind-my.sharepoint.com"] };
const account = { tenantId: config.tenantId, homeAccountId: "fixture-account" };
const token = { accessToken: "PRIVATE_ACCESS_TOKEN", account, tenantId: config.tenantId, idTokenClaims: { tid: config.tenantId } };
const link = "https://northwind.sharepoint.com/:x:/g/EXAMPLEopaqueToken_123-ABC?e=fixture&CID=fixture-id";
const downloadUrl = "https://northwind-my.sharepoint.com/sites/Reports/_layouts/15/download.aspx?tempauth=PRIVATE_DOWNLOAD_SIGNATURE";
const data = new Uint8Array([80, 75, 3, 4]);
const metadata = overrides => ({ id: "fixture-item", name: "Fixture.xlsx", size: data.length, file: {}, "@microsoft.graph.downloadUrl": downloadUrl, ...overrides });
const jsonResponse = item => new Response(JSON.stringify(item), { headers: { "content-type": "application/json" } });
const downloadResponse = (bytes = data, headers = {}) => new Response(bytes, { headers: { "content-length": String(bytes.length), "content-type": "application/octet-stream", ...headers } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(behavior = {}) {
  const calls = [], auth = [], constructors = [], files = [], timers = new Map(); let nextTimer = 0, activeAccount = behavior.activeAccount || null;
  const forbidden = () => { throw new Error("Fixture accessed ambient cache, credentials, or logs."); };
  class InteractionRequiredAuthError extends Error { constructor(code = "interaction_required") { super("PRIVATE_TOKEN_AND_URL"); this.errorCode = code; } }
  class PublicClientApplication {
    constructor(settings) { constructors.push(settings); if (behavior.constructorError) throw behavior.constructorError; }
    initialize() { auth.push({ method: "initialize" }); return behavior.initialize ? behavior.initialize() : Promise.resolve(); }
    getActiveAccount() { return activeAccount; }
    getAllAccounts() { return behavior.accounts || (activeAccount ? [activeAccount] : []); }
    setActiveAccount(value) { auth.push({ method: "setActiveAccount", value }); activeAccount = value; }
    acquireTokenPopup(request) { auth.push({ method: "popup", request }); return behavior.popup ? behavior.popup(request, auth.filter(call => call.method === "popup").length) : Promise.resolve(token); }
    acquireTokenSilent(request) { auth.push({ method: "silent", request }); return behavior.silent ? behavior.silent(request) : Promise.resolve(token); }
  }
  class FixtureFile extends File { constructor(...args) { super(...args); files.push(this); } }
  const sandbox = {
    URL, TextEncoder, TextDecoder, Uint8Array, AbortController, File: FixtureFile,
    location: behavior.location || { href: "https://analytics.example.test/portfolio/analytics.html?v=fixture#overview" },
    console: { log: forbidden, warn: forbidden, error: forbidden },
    setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; }, clearTimeout: id => timers.delete(id),
  };
  Object.defineProperties(sandbox, { localStorage: { get: forbidden }, sessionStorage: { get: forbidden }, navigator: { get: forbidden } });
  const context = vm.createContext(sandbox); vm.runInContext(validatorSource, context); vm.runInContext(clientSource, context);
  const fetcher = (url, options) => {
    calls.push({ url, options });
    if (behavior.fetch) return behavior.fetch(url, options, calls.length);
    return Promise.resolve(url.startsWith("https://graph.microsoft.com/") ? jsonResponse(metadata(behavior.metadata)) : downloadResponse());
  };
  const options = { config: Object.hasOwn(behavior, "config") ? behavior.config : config, msal: behavior.msal || { PublicClientApplication, InteractionRequiredAuthError }, fetch: fetcher, location: sandbox.location };
  const client = sandbox.PPCSelloutSharePointClient.create(options);
  return { client, calls, auth, constructors, files, timers, context, InteractionRequiredAuthError };
}
const privateMessage = cause => {
  assert.equal(cause.name, "SharePointClientError"); assert.ok(typeof cause.code === "string");
  assert.ok(cause.message.length < 180 && !/PRIVATE|EXAMPLEopaque|northwind|fixture-account|tempauth|https:\/\//i.test(cause.message), "Errors must not expose tokens, source links, temporary URLs, or response bodies.");
  assert.equal(Object.hasOwn(cause, "cause"), false); return true;
};
const rejects = async (promise, code) => assert.rejects(promise, cause => { privateMessage(cause); assert.equal(cause.code, code); return true; });

// Incomplete/unsafe configuration must be truthful and cannot initialize auth.
for (const invalid of [undefined, {}, { clientId: "", tenantId: "", sharepointHosts: [] }]) {
  const test = harness({ config: invalid }); assert.equal(test.client.ready, false); assert.ok(test.client.reason);
  await rejects(test.client.initialize(), "CONFIG_REQUIRED"); assert.equal(test.constructors.length, 0); assert.equal(test.calls.length, 0);
}
for (const change of [
  { clientId: "not-a-guid" }, { tenantId: "common" }, { tenantId: "00000000-0000-0000-0000-000000000000" },
  { sharepointHosts: [] }, { sharepointHosts: ["evil.example"] }, { sharepointHosts: ["northwind.sharepoint.com.evil.example"] },
  { sharepointHosts: ["https://northwind.sharepoint.com"] }, { sharepointHosts: ["northwind.sharepoint.com:443"] },
  { sharepointHosts: [null] }, { sharepointHosts: new Array(1) }, { sharepointHosts: Array(21).fill("northwind.sharepoint.com") },
  { authority: "https://evil.example" }, { scopes: ["Files.ReadWrite.All"] }, { redirectUri: "https://evil.example" }, { clientSecret: "PRIVATE_CONFIG_SECRET" },
]) {
  const test = harness({ config: { ...config, ...change } }); assert.equal(test.client.ready, false); await rejects(test.client.initialize(), "CONFIG_INVALID"); assert.equal(test.auth.length, 0);
}
const unsafeLocation = harness({ location: { href: "http://analytics.example.test/analytics.html" } }); assert.equal(unsafeLocation.client.ready, false);
const missingSdk = harness({ msal: {} }); assert.equal(missingSdk.client.ready, false); await rejects(missingSdk.client.initialize(), "SIGN_IN_UNAVAILABLE");
const constructorFailure = harness({ constructorError: new Error("PRIVATE_CONSTRUCTOR_RESPONSE") }); await rejects(constructorFailure.client.initialize(), "SIGN_IN_UNAVAILABLE"); assert.equal(constructorFailure.client.ready, false);
const initGate = deferred(), initializing = harness({ initialize: () => initGate.promise }); const firstInit = initializing.client.initialize(); assert.equal(firstInit, initializing.client.initialize());
await rejects(initializing.client.load(link), "NOT_INITIALIZED"); assert.equal(initializing.auth.filter(call => call.method === "popup").length, 0); initGate.resolve(); await firstInit; assert.equal(initializing.client.initialized, true);

// Validate before auth; no cached account/token is touched for an unsafe link.
const badLinks = ["javascript:alert(1)", "https://other.sharepoint.com/:x:/g/EXAMPLEopaque", `${link}&access_token=PRIVATE_TOKEN`, "https://northwind.sharepoint.com/:f:/g/EXAMPLEfolder"];
const linkTest = harness(); await linkTest.client.initialize();
for (const bad of badLinks) await assert.rejects(linkTest.client.load(bad), cause => privateMessage(cause));
assert.equal(linkTest.auth.length, 1); assert.equal(linkTest.calls.length, 0); assert.equal(linkTest.timers.size, 0);

// Popup is invoked synchronously on the initialized click path. The exact
// token is sent only to Graph; the temporary download gets no auth headers.
const happy = harness(), progress = []; assert.equal(happy.client.ready, true); assert.equal(happy.client.reason, ""); await happy.client.initialize();
const msalConfig = happy.constructors[0];
assert.equal(msalConfig.auth.authority, `https://login.microsoftonline.com/${config.tenantId}`);
assert.equal(msalConfig.auth.redirectUri, "https://analytics.example.test/portfolio/analytics-auth.html");
assert.equal(msalConfig.cache.cacheLocation, "memoryStorage"); assert.equal(msalConfig.cache.temporaryCacheLocation, "memoryStorage"); assert.equal(msalConfig.cache.storeAuthStateInCookie, false);
assert.equal(msalConfig.system.loggerOptions.piiLoggingEnabled, false); msalConfig.system.loggerOptions.loggerCallback(0, "PRIVATE_LOG_PAYLOAD", true);
assert.equal(msalConfig.system.asyncPopups, false); assert.equal(msalConfig.system.allowPlatformBroker, false);
const happyLoad = happy.client.load(link, { onProgress: event => progress.push(event) });
assert.equal(happy.auth.filter(call => call.method === "popup").length, 1, "Popup acquisition must begin before load returns its promise, without a preparatory await.");
const file = await happyLoad; assert.equal(file.name, "Fixture.xlsx"); assert.equal(file.size, 4); assert.deepEqual(new Uint8Array(await file.arrayBuffer()), data);
assert.equal(happy.calls.length, 2); const [graph, download] = happy.calls;
assert.match(graph.url, /^https:\/\/graph\.microsoft\.com\/v1\.0\/shares\/u![a-z0-9_-]+\/driveItem\?\$select=id,name,size,file,@microsoft\.graph\.downloadUrl$/i);
const encoded = graph.url.match(/\/shares\/u!([^/]+)\//)[1]; assert.equal(Buffer.from(encoded, "base64url").toString("utf8"), new URL(link).href);
assert.equal(graph.options.headers.Authorization, `Bearer ${token.accessToken}`); assert.equal(download.url, downloadUrl); assert.equal(download.options.headers, undefined);
for (const request of happy.calls) { assert.equal(request.options.method, "GET"); assert.equal(request.options.credentials, "omit"); assert.equal(request.options.cache, "no-store"); assert.equal(request.options.referrerPolicy, "no-referrer"); assert.equal(request.options.redirect, "error"); assert.ok(request.options.signal); assert.equal(Object.hasOwn(request.options, "body"), false); }
assert.deepEqual(progress.map(event => event.phase), ["sign-in", "metadata", "download", "download", "complete"]); assert.equal(progress.at(-1).loaded, 4); assert.equal(progress.at(-1).total, 4);
assert.ok(progress.every(event => Object.isFrozen(event) && Object.keys(event).sort().join(",") === "loaded,phase,total")); assert.equal(happy.timers.size, 0);
assert.equal(file.sourceUrl, undefined); assert.equal(file.accessToken, undefined); assert.equal(file.downloadUrl, undefined);
await happy.client.load(link); assert.equal(happy.auth.filter(call => call.method === "silent").length, 1, "An account established in memory uses silent token acquisition on the next load.");
const unicode = harness(); await unicode.client.initialize(); await unicode.client.load("https://northwind.sharepoint.com/sites/Planning/Résumé.xlsx?e=fixture");
assert.equal(Buffer.from(unicode.calls[0].url.match(/\/shares\/u!([^/]+)\//)[1], "base64url").toString("utf8"), new URL("https://northwind.sharepoint.com/sites/Planning/Résumé.xlsx?e=fixture").href);

// Sign-in failures and token/account injection never reach Graph or leak bodies.
for (const [errorCode, expected] of [["popup_window_error", "POPUP_BLOCKED"], ["user_cancelled", "SIGN_IN_CANCELLED"], ["admin_consent_required", "CONSENT_REQUIRED"], ["access_denied", "ACCESS_DENIED"], ["interaction_in_progress", "SIGN_IN_BUSY"], ["unknown", "SIGN_IN_FAILED"]]) {
  const test = harness({ popup: () => Promise.reject({ errorCode, message: "PRIVATE_ACCESS_TOKEN https://PRIVATE_DOWNLOAD_URL" }) }); await test.client.initialize(); await rejects(test.client.load(link), expected); assert.equal(test.calls.length, 0); assert.equal(test.timers.size, 0);
}
for (const response of [{ ...token, accessToken: "PRIVATE\r\nAuthorization: injected" }, { ...token, account: { tenantId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff" } }, { ...token, idTokenClaims: { tid: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff" } }, { accessToken: "PRIVATE", tenantId: config.tenantId }]) {
  const test = harness({ popup: () => Promise.resolve(response) }); await test.client.initialize(); await rejects(test.client.load(link), response.accessToken.includes("\r") ? "SIGN_IN_FAILED" : "ACCESS_DENIED"); assert.equal(test.calls.length, 0);
}
const fallback = harness({ activeAccount: account, silent: () => Promise.reject({ errorCode: "interaction_required", message: "PRIVATE_SILENT_ERROR" }) }); await fallback.client.initialize(); await fallback.client.load(link); assert.equal(fallback.auth.filter(call => call.method === "popup").length, 1);
const retryPopup = harness({ activeAccount: account, silent: () => Promise.reject({ errorCode: "interaction_required" }), popup: (_request, call) => call === 1 ? Promise.reject({ errorCode: "popup_window_error", message: "PRIVATE_POPUP_ERROR" }) : Promise.resolve(token) });
await retryPopup.client.initialize(); await rejects(retryPopup.client.load(link), "POPUP_BLOCKED"); const retryLoad = retryPopup.client.load(link);
assert.equal(retryPopup.auth.filter(call => call.method === "popup").length, 2, "Retry after a blocked silent-fallback popup launches directly from the new click before any await.");
assert.equal(retryPopup.auth.filter(call => call.method === "silent").length, 1); await retryLoad;
const noFallback = harness({ activeAccount: account, silent: () => Promise.reject({ errorCode: "unexpected", message: "PRIVATE_SILENT_ERROR" }) }); await noFallback.client.initialize(); await rejects(noFallback.client.load(link), "SIGN_IN_FAILED"); assert.equal(noFallback.auth.filter(call => call.method === "popup").length, 0);

// Strict metadata schema and exact ephemeral-host checks precede file download.
for (const override of [
  { name: "Fixture.csv" }, { name: "Fixture.xlsm" }, { name: "../Fixture.xlsx" }, { name: "Fixture\n.xlsx" }, { name: "" },
  { id: null }, { size: undefined }, { size: "4" }, { size: 0 }, { size: -1 }, { size: 1.5 }, { file: null }, { file: [] }, { folder: {} },
]) { const test = harness({ metadata: override }); await test.client.initialize(); await rejects(test.client.load(link), "INVALID_WORKBOOK"); assert.equal(test.calls.length, 1); }
const oversized = harness({ metadata: { size: 40 * 1024 * 1024 + 1 } }); await oversized.client.initialize(); await rejects(oversized.client.load(link), "FILE_TOO_LARGE"); assert.equal(oversized.calls.length, 1);
for (const unsafe of [undefined, "https://evil.example/PRIVATE_FILE", "https://northwind-my.sharepoint.com.evil.example/PRIVATE_FILE", "http://northwind-my.sharepoint.com/PRIVATE_FILE", "https://member:PRIVATE@northwind-my.sharepoint.com/PRIVATE_FILE", "https://northwind-my.sharepoint.com:443/PRIVATE_FILE", `${downloadUrl}#PRIVATE`, `${downloadUrl}&x=%0d%0aPRIVATE`, "https://northwind-my.sharepoint.com\\@evil.example/PRIVATE_FILE"]) {
  const test = harness({ metadata: { "@microsoft.graph.downloadUrl": unsafe } }); await test.client.initialize(); await rejects(test.client.load(link), "DOWNLOAD_FAILED"); assert.equal(test.calls.length, 1);
}
for (const [status, expected] of [[401, "ACCESS_DENIED"], [403, "ACCESS_DENIED"], [404, "WORKBOOK_NOT_FOUND"], [500, "METADATA_FAILED"]]) {
  let readBody = false; const test = harness({ fetch: () => ({ ok: false, status, get body() { readBody = true; throw new Error("PRIVATE_SERVER_BODY"); } }) }); await test.client.initialize(); await rejects(test.client.load(link), expected); assert.equal(readBody, false);
}
const hugeMetadata = harness({ fetch: () => new Response("x".repeat(65537)) }); await hugeMetadata.client.initialize(); await rejects(hugeMetadata.client.load(link), "METADATA_FAILED");
const badMetadata = harness({ fetch: () => new Response("PRIVATE_NON_JSON_RESPONSE") }); await badMetadata.client.initialize(); await rejects(badMetadata.client.load(link), "METADATA_FAILED");

// Content is streamed with a hard byte bound and must match metadata; redirects,
// sign-in HTML, missing streaming support, and unsafe size headers fail closed.
for (const response of [
  { ok: true, status: 200, redirected: true }, { ok: false, status: 403 }, { ok: true, status: 206 },
  new Response("PRIVATE_LOGIN_PAGE", { headers: { "content-type": "text/html" } }),
  downloadResponse(data, { "content-length": "not-a-size" }), downloadResponse(new Uint8Array([1, 2])),
  { ok: true, status: 200, body: null, headers: new Headers() },
]) {
  const test = harness({ fetch: (_url, _options, call) => call === 1 ? jsonResponse(metadata()) : response }); await test.client.initialize(); await rejects(test.client.load(link), "DOWNLOAD_FAILED"); assert.equal(test.files.length, 0);
  assert.equal(test.calls.at(-1).options.signal.aborted, true, "A rejected download response stops the request rather than leaving its body active.");
}
const headerOverflow = harness({ fetch: (_url, _options, call) => call === 1 ? jsonResponse(metadata()) : downloadResponse(data, { "content-length": String(40 * 1024 * 1024 + 1) }) }); await headerOverflow.client.initialize(); await rejects(headerOverflow.client.load(link), "FILE_TOO_LARGE");
let overflowCancelled = 0, overflowReads = 0; const megabyte = new Uint8Array(1024 * 1024);
const streamOverflow = harness({ fetch: (_url, _options, call) => call === 1 ? jsonResponse(metadata({ size: 40 * 1024 * 1024 })) : { ok: true, status: 200, headers: new Headers(), body: { getReader: () => ({ read: async () => { overflowReads++; return { value: megabyte, done: false }; }, cancel: () => { overflowCancelled++; return Promise.resolve(); }, releaseLock() {} }) } } });
await streamOverflow.client.initialize(); await rejects(streamOverflow.client.load(link), "FILE_TOO_LARGE"); assert.equal(overflowReads, 41); assert.equal(overflowCancelled, 1); assert.equal(streamOverflow.files.length, 0);

// Abort cannot close a Microsoft popup, but it prevents every later fetch.
const preAbort = harness(), before = new AbortController(); before.abort(); await preAbort.client.initialize(); await rejects(preAbort.client.load(link, { signal: before.signal }), "CANCELLED"); assert.equal(preAbort.auth.filter(call => call.method === "popup").length, 0);
const popupGate = deferred(), abortPopup = harness({ popup: () => popupGate.promise }), popupSignal = new AbortController(); await abortPopup.client.initialize();
const popupLoad = abortPopup.client.load(link, { signal: popupSignal.signal }); popupSignal.abort(); await rejects(popupLoad, "CANCELLED"); popupGate.resolve(token); await flush(); assert.equal(abortPopup.calls.length, 0); assert.equal(abortPopup.timers.size, 0);
const beforeGraph = harness(), metadataSignal = new AbortController(); await beforeGraph.client.initialize(); await rejects(beforeGraph.client.load(link, { signal: metadataSignal.signal, onProgress: event => { if (event.phase === "metadata") metadataSignal.abort(); } }), "CANCELLED"); assert.equal(beforeGraph.calls.length, 0);
const beforeDownload = harness(), downloadSignal = new AbortController(); await beforeDownload.client.initialize(); await rejects(beforeDownload.client.load(link, { signal: downloadSignal.signal, onProgress: event => { if (event.phase === "download") downloadSignal.abort(); } }), "CANCELLED"); assert.equal(beforeDownload.calls.length, 1);
let readerCancelled = 0; const streamGate = deferred(), streamingSignal = new AbortController();
const abortStream = harness({ fetch: (_url, _options, call) => call === 1 ? jsonResponse(metadata()) : { ok: true, status: 200, headers: new Headers(), body: { getReader: () => ({ read: () => streamGate.promise, cancel: () => { readerCancelled++; return new Promise(() => {}); }, releaseLock() {} }) } } });
await abortStream.client.initialize(); const streamLoad = abortStream.client.load(link, { signal: streamingSignal.signal }); await flush(); streamingSignal.abort(); await rejects(streamLoad, "CANCELLED"); assert.equal(readerCancelled, 1, "An unresponsive reader cancellation cannot hold the UI pending."); assert.equal(abortStream.files.length, 0);

// New loads supersede old popup/fetch results; the latest alone returns a File.
const oldPopup = deferred(), race = harness({ popup: (_request, call) => call === 1 ? oldPopup.promise : Promise.resolve(token) }); await race.client.initialize();
const oldLoad = race.client.load(link); const oldRejected = rejects(oldLoad, "SUPERSEDED"); const latestFile = await race.client.load(link); await oldRejected;
oldPopup.resolve(token); await flush(); assert.equal(latestFile.name, "Fixture.xlsx"); assert.equal(race.calls.length, 2); assert.equal(race.files.length, 1);
const oldFetch = deferred(); let graphCalls = 0;
const fetchRace = harness({ fetch: url => url.startsWith("https://graph.microsoft.com/") ? ++graphCalls === 1 ? oldFetch.promise : jsonResponse(metadata()) : downloadResponse() }); await fetchRace.client.initialize();
const oldFetchLoad = fetchRace.client.load(link); await flush(); const staleFetchRejected = rejects(oldFetchLoad, "SUPERSEDED");
await fetchRace.client.load(link); await staleFetchRejected; oldFetch.resolve(jsonResponse(metadata())); await flush();
assert.equal(fetchRace.calls.length, 3); assert.equal(fetchRace.calls[0].options.signal.aborted, true); assert.equal(fetchRace.files.length, 1, "An old Graph response cannot start a download or return a second File.");
const timeoutGate = deferred(), timeout = harness({ popup: () => timeoutGate.promise }); await timeout.client.initialize(); const timedLoad = timeout.client.load(link);
assert.equal([...timeout.timers.values()][0].delay, 90000); [...timeout.timers.values()][0].callback(); await rejects(timedLoad, "TIMEOUT"); timeoutGate.resolve(token); await flush(); assert.equal(timeout.calls.length, 0); assert.equal(timeout.timers.size, 0);
const progressFailure = harness(); await progressFailure.client.initialize(); await progressFailure.client.load(link, { onProgress() { throw new Error("PRIVATE_CALLBACK_ERROR"); } }); assert.equal(progressFailure.files.length, 1);
console.log("Authenticated SharePoint client: config/tenant/link restrictions, eager init and synchronous popup, memory-only auth, Graph-only token, bounded metadata/workbook streams, exact download hosts, generic errors, abort/timeout/stale cleanup, and native File output passed with mocked MSAL/fetch and no live backend.");
