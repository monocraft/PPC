import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
const source = await readFile(new URL("../../public/js/workspace-ui.js", import.meta.url), "utf8");
const css = await readFile(new URL("../../public/css/workspace-settings.css", import.meta.url), "utf8");
const settings = html.slice(html.indexOf('<div id="workspaceSettingsDialog"'), html.indexOf('<input id="importFile"'));
const data = settings.slice(settings.indexOf('<section id="settingsDataPanel"'));

// These are the existing workflow entry points: redesigning their placement
// cannot remove one, duplicate a destructive action, or hide required imports.
for (const id of ["showPrices", "showSkus", "hideDiscontinued", "roadmapShowMsrp", "roadmapStart", "roadmapEnd", "roadmapSnap", "addProduct", "editSelected", "categorySettings", "settingsPullLatestData", "loadDataButton", "settingsPlcUpdates", "settingsLocalCopies", "importAscm", "importPlcReport", "importPackage", "importJson", "importNameUpdates", "exportPackage", "exportJson", "copyJson", "exportPng", "restoreSample", "sharedPackageUpdated", "sharedPackageComments"]) {
  assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, `${id} retains one production workflow owner`);
}
assert.match(settings, /role="tablist"[^>]*aria-orientation="horizontal"/);
assert.ok(data.indexOf('id="dataWorkspaceTitle"') < data.indexOf('id="dataImportTitle"'));
assert.ok(data.indexOf('id="dataImportTitle"') < data.indexOf('id="dataExportTitle"'));
assert.ok(data.indexOf('id="settingsPullLatestData"') < data.indexOf('id="dataWorkspaceTitle"'));
assert.ok(data.indexOf('id="restoreSample"') > data.indexOf('id="sharedPackageComments"'));
assert.ok(!data.includes("<details"), "Package information and specific imports are always discoverable");
assert.match(settings, /<div hidden aria-hidden="true"><button id="editSelected"/);
// Explicit grid ownership prevents older two-column export/detail rules in
// styles.css from squeezing the new nested layout into unrelated tracks.
assert.match(css, /#workspaceSettingsDialog \.settings-data-column\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
assert.match(css, /#workspaceSettingsDialog \.settings-package-details dl\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
for (const token of ["--color-stage-launched", "--color-stage-development", "--color-stage-planning", "--color-embargo", "--color-new-product"]) {
  assert.ok(css.includes(`background: var(${token})`), `Timeline legend uses the production ${token}`);
}

const nodes = new Map();
const get = (id) => {
  if (!nodes.has(id)) nodes.set(id, { value: "", checked: false, hidden: false, textContent: "", attrs: {}, classList: { toggle() {} }, setAttribute(key, value) { this.attrs[key] = value; } });
  return nodes.get(id);
};
const presets = [3, 5, 10].map(years => ({ dataset: { roadmapYears: String(years) }, attrs: {}, classList: { toggle() {} }, setAttribute(key, value) { this.attrs[key] = value; } }));
const context = vm.createContext({ get, document: { querySelectorAll: () => presets }, snapshot: null, categoryDraftDirty: false, activeTab: "display",
  setText: (id, value) => { get(id).textContent = value; } });
const definition = name => source.match(new RegExp(`^  function ${name}\\([^]*?^  }`, "m"))?.[0] || assert.fail(`Missing shipped ${name}`);
vm.runInContext(["refreshDisplayPreviews", "updateTimelineSummary", "refreshSettingsFooter", "setCategoryDraftState"].map(definition).join("\n"), context);

context.snapshot = { settingsPreview: { name: "Actual fixture product", price: "$0.00", sku: "SKU-42", timing: "GA Sep 2026" } };
get("showPrices").checked = true;
get("showSkus").checked = false;
get("roadmapShowMsrp").checked = false;
context.refreshDisplayPreviews();
assert.equal(get("settingsCardPreviewName").textContent, "Actual fixture product");
assert.equal(get("settingsCardPreviewPrice").textContent, "$0.00");
assert.equal(get("settingsCardPreviewPrice").hidden, false, "A saved zero price remains valid");
assert.equal(get("settingsCardPreviewSku").hidden, true);
assert.equal(get("settingsRoadmapPreviewPrice").hidden, true);
get("showPrices").checked = false; get("showSkus").checked = true; get("roadmapShowMsrp").checked = true;
context.refreshDisplayPreviews();
assert.equal(get("settingsCardPreviewPrice").hidden, true);
assert.equal(get("settingsCardPreviewSku").hidden, false);
assert.equal(get("settingsRoadmapPreviewPrice").hidden, false);
assert.equal(get("settingsRoadmapPreviewTiming").textContent, "GA Sep 2026");
assert.equal(get("settingsCardPreviewSku").textContent, "SKU-42");
context.snapshot = { settingsPreview: { name: "Product without price" } };
context.refreshDisplayPreviews();
assert.equal(get("settingsCardPreviewPrice").hidden, true);
assert.equal(get("settingsCardPreviewSku").hidden, true);
assert.equal(get("settingsRoadmapPreviewPrice").hidden, true);
assert.equal(get("settingsRoadmapPreviewVisibility").textContent, "No saved MSRP");
context.snapshot = null; context.refreshDisplayPreviews();
assert.equal(get("settingsCardPreviewName").textContent, "No products in this category");

get("roadmapStart").value = "2026-03"; get("roadmapEnd").value = "2029-02";
context.updateTimelineSummary();
assert.equal(get("settingsRangeLength").textContent, "3 years");
assert.equal(presets[0].attrs["aria-pressed"], "true");
assert.equal(presets[1].attrs["aria-pressed"], "false");
get("roadmapEnd").value = "2026-09"; context.updateTimelineSummary();
assert.equal(get("settingsRangeLength").textContent, "7 months");
assert.ok(presets.every(button => button.attrs["aria-pressed"] === "false"));
get("roadmapEnd").value = "2025-01"; context.updateTimelineSummary();
assert.equal(get("settingsRangeLength").textContent, "Choose a valid range");

context.activeTab = "data"; context.refreshSettingsFooter();
assert.equal(get("workspaceSettingsFootnote").textContent, "File operations open their own review.");
context.setCategoryDraftState(true);
assert.match(get("workspaceSettingsFootnote").textContent, /draft retained/);
assert.equal(get("workspaceSettingsDone").textContent, "Close · keep draft");
context.setCategoryDraftState(false); context.activeTab = "category"; context.refreshSettingsFooter();
assert.equal(get("workspaceSettingsDone").textContent, "Done");
assert.match(get("workspaceSettingsFootnote").textContent, /Save layout/);
console.log("Workspace settings checks passed: production action ownership, Workspace/Import/Export order, visible package/import details, native stage tokens, actual-data preview toggles, missing/zero prices, month-accurate ranges and honest draft footers.");
