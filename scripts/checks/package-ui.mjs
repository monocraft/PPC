import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import "../../public/js/package-codec.js";

const codec = globalThis.PortfolioPackage;
const key = codec.generateKey();
const wrongKey = codec.generateKey();
const encrypted = await codec.encrypt(new Uint8Array([1, 2, 3]), key);
const source = await readFile(new URL("../../public/js/package-ui.js", import.meta.url), "utf8");
const loadedInfo = { version: 1, updatedAt: "2026-10-07T09:30:00.000Z", comments: "Previous package notes" };
const incomingInfo = { version: 1, updatedAt: "2026-10-08T01:15:00.000Z", comments: "Prices updated.\n<svg onload=alert(1)> stays plain text." };
const formatDate = (info) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(info.updatedAt));
const assertSimpleCopy = (ui) => {
  const generatedCopy = ["packageKeyHelp", "sharedPackageStatus", "packagePublisherHelp", "packageStatus", "packageTitle", "packageDescription"].map((id) => ui.elements.get(id).textContent).join("\n");
  assert.doesNotMatch(generatedCopy, /GitHub|Supabase|master(?:\s+(?:file|package|copy))?|public\/data|master_ppc\.pkg|https?:\/\//i, "normal package messages must not reveal providers or internal file locations");
};

function createUi(config = { mode: "static", packageUrl: "./data/master_ppc.pkg", endpoint: "" }, masterSource = null) {
  const listeners = new Map();
  const elements = new Map();
  const calls = { downloads: [], imports: [], exports: [], generated: 0 };
  const document = { activeElement: null, getElementById: (id) => elements.get(id), querySelector: () => elements.get("app-shell") };
  document.createElement = (tag) => {
    const eventHandlers = new Map();
    const element = { tagName: tag.toUpperCase(), textContent: "", children: [], isConnected: true, open: false,
      append(...children) { this.children.push(...children); },
      addEventListener: (name, handler) => eventHandlers.set(name, handler),
      dispatchEvent: (event) => eventHandlers.get(event.type)?.(event),
      focus() { document.activeElement = this; },
    };
    Object.defineProperty(element, "innerHTML", { set() { throw new Error("Footer package metadata must remain plain text."); } });
    return element;
  };
  const ids = ["app-shell", "packageDialog", "packageForm", "packageKey", "confirmPackage", "packageStatus", "packageError", "sharedPackageStatus", "packageKeySection", "packageShowKey", "packageEncrypt", "packageGenerateKey", "packageCopyKey", "packagePublisherHelp", "packageKeyHelp", "cancelPackage", "closePackage", "workspaceEmpty", "packageTitle", "packageDescription", "packageExportOptions", "packageFileName", "pullLatestData", "emptyPullLatestData", "settingsPullLatestData", "exportPackage", "restorePreviousPackage", "packageUpdateComments", "sharedPackageUpdated", "sharedPackageComments", "packageResultInfo", "packageResultUpdated", "packageResultComments", "statusbarPackage"];
  for (const id of ids) {
    const classes = new Set();
    elements.set(id, {
      id, value: "", textContent: "", disabled: false, checked: false, required: false, readOnly: false, isConnected: true, inert: false,
      children: [], replaceChildren(...children) { this.children = children; },
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
      querySelectorAll: (selector) => ["packageUpdateComments", "packageKey", "packageShowKey", "packageEncrypt", "packageGenerateKey", "packageCopyKey", "confirmPackage"].filter((control) => (selector.includes("textarea") || control !== "packageUpdateComments") && (!selector.includes(":not([disabled])") || !elements.get(control).disabled)).map((control) => elements.get(control)),
    });
    Object.defineProperty(elements.get(id), "innerHTML", { set() { throw new Error("Package metadata must never use innerHTML."); } });
  }
  elements.get("packageDialog").classList.add("hidden");
  let download = async () => encrypted;
  let currentInfo = loadedInfo;
  let importInfo = incomingInfo;
  let exportFailure = false;
  const sandbox = {
    document,
    window: { addEventListener: (name, handler) => listeners.set(`window:${name}`, handler) },
    Blob, DOMException, AbortController, setTimeout, clearTimeout,
    PPC_PACKAGE_SOURCE: config,
    PPC_MASTER_SOURCE: masterSource,
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
    getCurrentPackageInfo: () => currentInfo,
    restorePreviousPackage: async () => ({ productCount: 198, categoryCount: 11 }),
    copyTextToClipboard: async () => true,
    importProjectPackage: async (file, options) => {
      calls.imports.push(options);
      await codec.decrypt(new Uint8Array(await file.arrayBuffer()), options.key);
      currentInfo = importInfo;
      return { productCount: 198, categoryCount: 11, packageInfo: importInfo };
    },
    exportProjectPackage: async (value, options) => {
      calls.exports.push({ key: value, comments: options.comments });
      if (exportFailure) throw new Error("Package build failed.");
      return { version: 1, updatedAt: "2026-10-09T08:00:00.000Z", comments: options.comments };
    },
  };
  vm.createContext(sandbox);
  new vm.Script(source).runInContext(sandbox);
  return { elements, calls, ui: sandbox.PortfolioPackageUI, document, setDownload: (handler) => { download = handler; }, setImportInfo: (info) => { importInfo = info; }, setExportFailure: (value) => { exportFailure = value; }, keydown: (event) => listeners.get("packageDialog:keydown")({ stopPropagation() {}, ...event }), submit: () => listeners.get("packageForm:submit")({ preventDefault() {} }) };
}

const staticUi = createUi();
staticUi.ui.open("pull");
assert.equal(staticUi.elements.get("confirmPackage").disabled, false);
assert.match(staticUi.elements.get("packageKeyHelp").textContent, /access key supplied/);
assert.match(staticUi.elements.get("sharedPackageStatus").textContent, /Open your portfolio/);
assertSimpleCopy(staticUi);
assert.equal(staticUi.elements.get("sharedPackageUpdated").textContent, formatDate(loadedInfo));
assert.equal(staticUi.elements.get("sharedPackageUpdated").title, new Intl.DateTimeFormat(undefined, { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "long" }).format(new Date(loadedInfo.updatedAt)));
assert.equal(staticUi.elements.get("sharedPackageComments").textContent, loadedInfo.comments);
const footerDate = (ui) => ui.elements.get("statusbarPackage").children[0].children[0];
const footerComment = (ui) => ui.elements.get("statusbarPackage").children[1];
assert.equal(footerDate(staticUi).textContent, formatDate(loadedInfo));
assert.equal(footerDate(staticUi).dateTime, loadedInfo.updatedAt);
assert.equal(footerComment(staticUi).children[1].textContent, loadedInfo.comments);
assert.equal(footerComment(staticUi).children[1].tabIndex, 0, "long comment content must support keyboard scrolling");
const openedComment = footerComment(staticUi);
openedComment.open = true;
openedComment.dispatchEvent({ type: "toggle" });
staticUi.ui.refresh();
assert.equal(footerComment(staticUi).open, true, "refreshing the same package must preserve an expanded comment");
let commentEscapePrevented = false;
footerComment(staticUi).dispatchEvent({ type: "keydown", key: "Escape", preventDefault() { commentEscapePrevented = true; }, stopPropagation() {} });
assert.equal(commentEscapePrevented, true);
assert.equal(footerComment(staticUi).open, false);
assert.equal(staticUi.document.activeElement, footerComment(staticUi).children[0], "Escape must return focus to the comment disclosure");
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
assert.equal(staticUi.elements.get("sharedPackageComments").textContent, loadedInfo.comments, "a wrong key must not alter the loaded metadata");
assert.equal(staticUi.elements.get("packageResultInfo").classList.contains("hidden"), true, "update metadata is revealed only after unlocking");
staticUi.elements.get("packageKey").value = key;
await staticUi.submit();
assert.equal(staticUi.calls.downloads.length, 1, "wrong-key retry should reuse encrypted bytes for this dialog only");
assert.equal(staticUi.calls.imports.at(-1).requireEncrypted, true);
assert.match(staticUi.elements.get("packageStatus").textContent, /198 products across 11 categories/);
assertSimpleCopy(staticUi);
assert.equal(staticUi.elements.get("packageKey").value, "");
assert.equal(staticUi.elements.get("confirmPackage").textContent, "Done");
assert.equal(staticUi.elements.get("sharedPackageUpdated").textContent, formatDate(incomingInfo));
assert.equal(staticUi.elements.get("sharedPackageComments").textContent, incomingInfo.comments, "HTML-like updater comments must remain plain text with their line breaks");
assert.equal(staticUi.elements.get("packageResultComments").textContent, incomingInfo.comments);
assert.equal(staticUi.elements.get("packageResultUpdated").dateTime, incomingInfo.updatedAt);
assert.equal(staticUi.elements.get("packageResultInfo").classList.contains("hidden"), false);
assert.equal(footerDate(staticUi).dateTime, incomingInfo.updatedAt, "pulling a package must refresh its visible footer date");
assert.equal(footerComment(staticUi).children[1].textContent, incomingInfo.comments, "the full footer comment must preserve literal markup and line breaks");
assert.equal(footerComment(staticUi).children[0].children[0].textContent, `Comment: ${incomingInfo.comments.replace(/\s+/g, " ")}`);
assert.equal(footerComment(staticUi).open, false, "loading a different package must close the previous comment");
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
assertSimpleCopy(relayUi);
relayUi.elements.get("packageKey").value = key;
await relayUi.submit();
assert.equal(relayUi.calls.downloads[0].key, key, "the optional existing relay must retain its key authentication");
assert.equal(Object.hasOwn(relayUi.calls.downloads[0], "packageUrl"), false);

const teamUi = createUi(undefined, { mode: "service", team: true, endpoint: "https://private.example/api/master" });
teamUi.ui.open("pull");
assert.match(teamUi.elements.get("packageKeyHelp").textContent, /browser tab reconnects automatically/);
assertSimpleCopy(teamUi);
teamUi.ui.close();
teamUi.ui.open("import", { name: "Imported portfolio.pkg", encrypted: true, file: new Blob([encrypted]) });
assertSimpleCopy(teamUi);
teamUi.elements.get("packageKey").value = key; await teamUi.submit();
assert.equal(teamUi.calls.imports[0].key, key, "encrypted local imports retain their normal key protection");
assert.equal(teamUi.calls.downloads.length, 0, "a local import does not transmit the key or request a download");
assertSimpleCopy(teamUi);

const publisherUi = createUi();
publisherUi.ui.open("export");
assert.match(publisherUi.elements.get("packagePublisherHelp").textContent, /Keep your access key in a safe place/);
assertSimpleCopy(publisherUi);
publisherUi.elements.get("packageKey").value = key;
publisherUi.elements.get("packageUpdateComments").value = "Updated launch dates.\nNew headset specifications.";
await publisherUi.submit();
assert.equal(publisherUi.calls.exports[0].key, key, "building an update must reuse the entered key");
assert.equal(publisherUi.calls.exports[0].comments, "Updated launch dates.\nNew headset specifications.");
assert.equal(publisherUi.calls.generated, 0, "updates must not silently rotate the key");
assert.equal(publisherUi.elements.get("packageKey").value, key, "the publisher can copy the existing key before closing");
assert.match(publisherUi.elements.get("packageStatus").textContent, /portfolio export is ready/);
assertSimpleCopy(publisherUi);
assert.equal(publisherUi.elements.get("packageResultComments").textContent, publisherUi.calls.exports[0].comments);
assert.equal(publisherUi.elements.get("packageResultUpdated").dateTime, "2026-10-09T08:00:00.000Z");
assert.equal(publisherUi.elements.get("sharedPackageComments").textContent, loadedInfo.comments, "a new export must not replace the metadata of the loaded workspace");
assert.equal(footerComment(publisherUi).children[1].textContent, loadedInfo.comments, "the footer must keep the loaded package's comment after a new export");
await publisherUi.submit();
assert.equal(publisherUi.elements.get("packageKey").value, "");
publisherUi.ui.open("export");
assert.equal(publisherUi.elements.get("packageUpdateComments").value, "", "a fresh build must not carry forward previous comments");
publisherUi.elements.get("packageGenerateKey").onclick();
assert.equal(publisherUi.calls.generated, 1, "key rotation requires the explicit Create new key action");
assert.match(publisherUi.elements.get("packageKey").value, /^PPC-/);
publisherUi.ui.close();
assert.equal(publisherUi.elements.get("packageKey").value, "");

const legacyUi = createUi();
legacyUi.setImportInfo(null);
legacyUi.ui.open("pull");
legacyUi.elements.get("packageKey").value = key;
await legacyUi.submit();
assert.equal(legacyUi.elements.get("sharedPackageUpdated").textContent, "Date not supplied", "legacy imports must not invent an update or download time");
assert.equal(legacyUi.elements.get("packageResultUpdated").dateTime, "");
assert.equal(legacyUi.elements.get("packageResultComments").textContent, "No comments supplied.");
assert.equal(footerDate(legacyUi).dateTime, "", "legacy package dates must not invent a timestamp in the footer");
assert.equal(footerComment(legacyUi).textContent, "No comments supplied.");
legacyUi.ui.close();
legacyUi.setImportInfo({ ...incomingInfo, comments: " \n \t " });
legacyUi.ui.open("pull");
legacyUi.elements.get("packageKey").value = key;
await legacyUi.submit();
assert.equal(legacyUi.elements.get("packageResultComments").textContent, "No comments supplied.", "whitespace-only notes must use the empty-notes label");
assert.equal(footerComment(legacyUi).tagName, "SPAN", "empty comments must not show a disclosure control");
legacyUi.setImportInfo({ ...incomingInfo, comments: "Long package comment " + "detail ".repeat(300) });
legacyUi.ui.close();
legacyUi.ui.open("pull");
legacyUi.elements.get("packageKey").value = key;
await legacyUi.submit();
assert.equal(footerComment(legacyUi).children[1].textContent, "Long package comment " + "detail ".repeat(300), "long footer comments must remain fully available in the disclosure");

const failedBuildUi = createUi();
failedBuildUi.ui.open("export");
failedBuildUi.setExportFailure(true);
failedBuildUi.elements.get("packageKey").value = key;
failedBuildUi.elements.get("packageUpdateComments").value = "Keep these comments after a failed build.";
const failedBuild = failedBuildUi.submit();
assert.equal(failedBuildUi.elements.get("packageUpdateComments").disabled, true, "comments must be disabled while a package is being built");
await failedBuild;
assert.equal(failedBuildUi.elements.get("packageUpdateComments").disabled, false);
assert.equal(failedBuildUi.elements.get("packageUpdateComments").value, "Keep these comments after a failed build.");
assert.equal(failedBuildUi.elements.get("packageResultInfo").classList.contains("hidden"), true);
for (const element of failedBuildUi.elements.values()) element.getClientRects = () => [];
failedBuildUi.elements.get("packageUpdateComments").getClientRects = () => [1];
failedBuildUi.elements.get("confirmPackage").getClientRects = () => [1];
failedBuildUi.document.activeElement = failedBuildUi.elements.get("confirmPackage");
let prevented = false;
failedBuildUi.keydown({ key: "Tab", shiftKey: false, preventDefault() { prevented = true; } });
assert.equal(prevented, true);
assert.equal(failedBuildUi.document.activeElement, failedBuildUi.elements.get("packageUpdateComments"), "the dialog focus trap must include the comments textarea");

const html = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
assert.match(html, /<textarea[^>]*id="packageUpdateComments"[^>]*maxlength="2000"/);
assert.match(html, /<label for="packageUpdateComments">/);
assert.match(html, /update date is set automatically/);

console.log("Package UI checks passed: local-only static keys, wrong-key retry, fresh/cancelled pulls, protected export key reuse, simple private-friendly messages, automatic package dates and updater comments, safe footer disclosures, legacy metadata, failed-build preservation, and textarea focus and busy controls.");
