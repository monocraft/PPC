import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import "../../public/js/package-codec.js";

const codec = globalThis.PortfolioPackage;
const key = codec.generateKey();
const wrongKey = codec.generateKey();
const encrypted = await codec.encrypt(new Uint8Array([1, 2, 3]), key);
const source = await readFile(new URL("../../public/js/package-ui.js", import.meta.url), "utf8");

function createUi(config = { mode: "static", packageUrl: "./data/master_ppc.pkg", endpoint: "" }) {
  const listeners = new Map();
  const elements = new Map();
  const calls = { downloads: [], imports: [], exports: [], generated: 0 };
  const document = { activeElement: null, getElementById: (id) => elements.get(id), querySelector: () => elements.get("app-shell") };
  const ids = ["app-shell", "packageDialog", "packageForm", "packageKey", "confirmPackage", "packageStatus", "packageError", "sharedPackageStatus", "packageKeySection", "packageShowKey", "packageEncrypt", "packageGenerateKey", "packageCopyKey", "packagePublisherHelp", "packageKeyHelp", "cancelPackage", "closePackage", "workspaceEmpty", "packageTitle", "packageDescription", "packageExportOptions", "packageFileName", "pullLatestData", "emptyPullLatestData", "settingsPullLatestData", "exportPackage", "restorePreviousPackage"];
  for (const id of ids) {
    const classes = new Set();
    elements.set(id, {
      id, value: "", textContent: "", disabled: false, checked: false, required: false, readOnly: false, isConnected: true, inert: false,
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        contains: (name) => classes.has(name),
        toggle: (name, force) => { const add = force ?? !classes.has(name); if (add) classes.add(name); else classes.delete(name); return add; },
      },
      focus() { document.activeElement = this; },
      closest: () => null,
      getClientRects: () => [1],
      contains: (element) => ids.includes(element?.id),
      addEventListener: (name, handler) => listeners.set(`${id}:${name}`, handler),
      querySelectorAll: () => ["packageKey", "confirmPackage", "packageShowKey", "packageEncrypt", "packageGenerateKey", "packageCopyKey"].map((control) => elements.get(control)),
    });
  }
  elements.get("packageDialog").classList.add("hidden");
  let download = async () => encrypted;
  const sandbox = {
    document,
    window: { addEventListener: (name, handler) => listeners.set(`window:${name}`, handler) },
    Blob, DOMException, AbortController, setTimeout, clearTimeout,
    PPC_PACKAGE_SOURCE: config,
    PortfolioPackage: { ...codec, generateKey: () => { calls.generated += 1; return codec.generateKey(); } },
    PortfolioPackageClient: {
      normalizePackageUrl(value = "./data/master_ppc.pkg") {
        const url = new URL(value, "https://monocraft.github.io/PPC/");
        if (url.origin !== "https://monocraft.github.io") throw new Error("Choose a package on this site.");
        return url.href;
      },
      normalizeEndpoint: (value) => { if (!value) throw new Error("A package endpoint is required."); return value; },
      downloadLatest: async (options) => { calls.downloads.push(options); return download(options); },
    },
    closePopupMenus: () => {},
    hasPreviousPackage: () => false,
    restorePreviousPackage: async () => ({ productCount: 198, categoryCount: 11 }),
    copyTextToClipboard: async () => true,
    importProjectPackage: async (file, options) => {
      calls.imports.push(options);
      await codec.decrypt(new Uint8Array(await file.arrayBuffer()), options.key);
      return { productCount: 198, categoryCount: 11 };
    },
    exportProjectPackage: async (value) => { calls.exports.push(value); },
  };
  vm.createContext(sandbox);
  new vm.Script(source).runInContext(sandbox);
  return { elements, calls, ui: sandbox.PortfolioPackageUI, document, setDownload: (handler) => { download = handler; }, submit: () => listeners.get("packageForm:submit")({ preventDefault() {} }) };
}

const staticUi = createUi();
staticUi.ui.open("pull");
assert.equal(staticUi.elements.get("confirmPackage").disabled, false);
assert.match(staticUi.elements.get("packageKeyHelp").textContent, /never sent to GitHub/);
assert.match(staticUi.elements.get("sharedPackageStatus").textContent, /latest master/);
staticUi.elements.get("packageKey").value = "incomplete-key";
await staticUi.submit();
assert.equal(staticUi.calls.downloads.length, 0, "invalid keys must fail before a download");
staticUi.elements.get("packageKey").value = wrongKey;
await staticUi.submit();
assert.equal(staticUi.calls.downloads.length, 1);
assert.equal(Object.hasOwn(staticUi.calls.downloads[0], "key"), false, "the UI must not send the package key to the static downloader");
assert.equal(Object.hasOwn(staticUi.calls.downloads[0], "endpoint"), false);
assert.equal(staticUi.calls.downloads[0].packageUrl, "https://monocraft.github.io/PPC/data/master_ppc.pkg");
assert.match(staticUi.elements.get("packageError").textContent, /Unable to unlock/);
assert.equal(staticUi.elements.get("packageKey").value, "");
assert.match(staticUi.elements.get("packageStatus").textContent, /without downloading it again/);
staticUi.elements.get("packageKey").value = key;
await staticUi.submit();
assert.equal(staticUi.calls.downloads.length, 1, "wrong-key retry should reuse encrypted bytes for this dialog only");
assert.equal(staticUi.calls.imports.at(-1).requireEncrypted, true);
assert.match(staticUi.elements.get("packageStatus").textContent, /198 products across 11 categories/);
assert.equal(staticUi.elements.get("packageKey").value, "");
assert.equal(staticUi.elements.get("confirmPackage").textContent, "Done");
await staticUi.submit();
assert.equal(staticUi.elements.get("packageDialog").classList.contains("hidden"), true);
assert.equal(staticUi.elements.get("app-shell").inert, false);
staticUi.ui.open("pull");
staticUi.elements.get("packageKey").value = key;
await staticUi.submit();
assert.equal(staticUi.calls.downloads.length, 2, "a new pull must fetch current data rather than reuse the preceding package");

const cancelledUi = createUi();
let finishDownload;
cancelledUi.setDownload(() => new Promise((resolve) => { finishDownload = resolve; }));
cancelledUi.ui.open("pull");
cancelledUi.elements.get("packageKey").value = key;
const pending = cancelledUi.submit();
assert.equal(cancelledUi.elements.get("cancelPackage").disabled, false);
cancelledUi.ui.close();
assert.equal(cancelledUi.calls.downloads[0].signal.aborted, true);
finishDownload(encrypted);
await pending;
assert.equal(cancelledUi.calls.imports.length, 0, "cancellation must prevent workspace import even if the download ignores abort");
assert.equal(cancelledUi.elements.get("packageDialog").classList.contains("hidden"), true);
assert.equal(cancelledUi.elements.get("packageKey").value, "");
cancelledUi.setDownload(async () => encrypted);
cancelledUi.ui.open("pull");
cancelledUi.elements.get("packageKey").value = key;
await cancelledUi.submit();
assert.equal(cancelledUi.calls.downloads.length, 2, "cancelled download bytes must not be retained after closing");

const invalidSource = createUi({ mode: "static", packageUrl: "https://other.example/master.pkg", endpoint: "" });
invalidSource.ui.open("pull");
assert.equal(invalidSource.elements.get("confirmPackage").disabled, true);
assert.equal(invalidSource.elements.get("packageKeySection").classList.contains("hidden"), true);
assert.match(invalidSource.elements.get("packageError").textContent, /this site/);

const relayUi = createUi({ mode: "relay", endpoint: "https://package.example/api/package/latest", packageUrl: "" });
relayUi.ui.open("pull");
relayUi.elements.get("packageKey").value = key;
await relayUi.submit();
assert.equal(relayUi.calls.downloads[0].key, key, "the optional existing relay must retain its key authentication");
assert.equal(Object.hasOwn(relayUi.calls.downloads[0], "packageUrl"), false);

const publisherUi = createUi();
publisherUi.ui.open("export");
assert.match(publisherUi.elements.get("packagePublisherHelp").textContent, /Reuse the current package key/);
assert.match(publisherUi.elements.get("packagePublisherHelp").textContent, /public\/data\/master_ppc\.pkg/);
publisherUi.elements.get("packageKey").value = key;
await publisherUi.submit();
assert.equal(publisherUi.calls.exports[0], key, "building an update must reuse the entered key");
assert.equal(publisherUi.calls.generated, 0, "updates must not silently rotate the key");
assert.equal(publisherUi.elements.get("packageKey").value, key, "the publisher can copy the existing key before closing");
assert.match(publisherUi.elements.get("packageStatus").textContent, /GitHub on the main branch/);
await publisherUi.submit();
assert.equal(publisherUi.elements.get("packageKey").value, "");
publisherUi.ui.open("export");
publisherUi.elements.get("packageGenerateKey").onclick();
assert.equal(publisherUi.calls.generated, 1, "key rotation requires the explicit Create new key action");
assert.match(publisherUi.elements.get("packageKey").value, /^PPC-/);
publisherUi.ui.close();
assert.equal(publisherUi.elements.get("packageKey").value, "");

console.log("Package UI checks passed: local-only static keys, wrong-key retry without another download, fresh pulls, cancellation before import, invalid-source handling, relay compatibility, and explicit publisher key reuse and rotation.");
