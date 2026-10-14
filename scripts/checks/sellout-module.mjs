import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { renderVersionedIndex } from "../configure-site-version.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publicRoot = path.join(root, "public");
const moduleFiles = ["analytics.html", "css/sellout-dashboard.css", "css/sellout-months.css", "js/sellout-model.js", "js/sellout-mix.js", "js/sellout-flow.js", "js/sellout-motion.js", "js/sellout-spring.js", "js/sellout-ppc.js", "js/sellout-private.js", "js/sellout-sharepoint.js", "js/sellout-dashboard.js"];
const privateFormats = /\.(?:xlsx?|xlsm|csv|tsv|jsonl?|data)$/i;

function attributes(tag) {
  return new Map([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+))/g)]
    .map(match => [match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]]));
}

function resolveAsset(reference, owner) {
  const value = reference.trim();
  if (value.startsWith("data:")) return null;
  assert.ok(value && !/^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(value), `Dashboard assets must be local: ${reference}`);
  const decoded = decodeURIComponent(value.replace(/&amp;/g, "&").split(/[?#]/, 1)[0]);
  assert.ok(!decoded.includes("\\") && !decoded.includes("\0"), `Invalid asset reference: ${reference}`);
  const resolved = path.resolve(path.dirname(path.join(publicRoot, owner)), decoded);
  assert.ok(resolved.startsWith(`${publicRoot}${path.sep}`), `Asset escapes public root: ${reference}`);
  assert.ok(!privateFormats.test(resolved), `Private workbook/data must not be a public asset: ${reference}`);
  return path.relative(publicRoot, resolved).split(path.sep).join("/");
}

function pageAssets(html, owner = "analytics.html") {
  const result = new Set();
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = attributes(match[0].slice(0, match[0].indexOf(">") + 1));
    assert.ok(!match[1].trim(), "Dashboard must not embed executable code or private JSON rows in HTML.");
    if (attrs.has("src")) {
      assert.ok(!attrs.get("src").trim().startsWith("data:"), "Dashboard scripts must be separate local code assets.");
      result.add(resolveAsset(attrs.get("src"), owner));
    }
  }
  for (const match of html.matchAll(/<(?:link|img|source)\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const reference = attrs.get("href") ?? attrs.get("src");
    if (reference) result.add(resolveAsset(reference, owner));
  }
  result.delete(null);
  return result;
}

function stylesheetAssets(css, owner) {
  const references = [...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)]
    .map(match => match[1] ?? match[2] ?? match[3]);
  references.push(...[...css.matchAll(/@import\s+["']([^"']+)["']/gi)].map(match => match[1]));
  return new Set(references.map(reference => resolveAsset(reference, owner)).filter(Boolean));
}

function stagedSources(workflow) {
  const sources = new Set();
  for (const line of workflow.split(/\r?\n/).map(value => value.trim()).filter(value => value.startsWith("cp "))) {
    const tokens = line.match(/"[^"]*"|'[^']*'|\S+/g).map(token => token.replace(/^['"]|['"]$/g, ""));
    if (!tokens.at(-1).startsWith("_site")) continue;
    for (const token of tokens.slice(1, -1).filter(value => !value.startsWith("-"))) sources.add(token.replace(/\/$/, ""));
  }
  return sources;
}

function validatePrivateBoundary(source, name) {
  assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(|\bsendBeacon\s*\(/.test(source), `${name} must read user-selected files without sending private rows over the network.`);
  assert.ok(!/product-portfolio-canvas-v\d|product-portfolio-image-assets-v\d/.test(source), `${name} must not read or change the portfolio's saved workspace.`);
  assert.ok(!/["']?(?:records|rows|observations)["']?\s*:\s*\[\s*\{\s*["']?(?:store|product|sku|date)["']?\s*:/i.test(source), `${name} must not contain embedded workbook rows.`);
}

// Exercise real boundary failures as well as valid references.
assert.equal(resolveAsset("../assets/fonts/Jost-Variable.ttf", "css/fonts.css"), "assets/fonts/Jost-Variable.ttf");
assert.equal(resolveAsset("js/sellout-model.js?v=release#ready", "analytics.html"), "js/sellout-model.js");
for (const unsafe of ["../private.csv", "data/weekly.json", "https://example.test/rows.js", "/js/model.js", "../../../secret.js", "js%5Csecret.js"]) {
  assert.throws(() => resolveAsset(unsafe, "analytics.html"));
}
assert.throws(() => pageAssets('<script type="application/json">{"rows":[{"store":"private"}]}</script>'));
assert.throws(() => pageAssets('<script src="data:text/javascript,void(0)"></script>'));
assert.throws(() => pageAssets('<script src="js/sellout-model.js">{"rows":[{"store":"private"}]}</script>'));
assert.throws(() => validatePrivateBoundary('fetch("https://example.test/rows")', "fixture"));
assert.throws(() => validatePrivateBoundary('localStorage.getItem("product-portfolio-canvas-v4")', "fixture"));
assert.throws(() => validatePrivateBoundary('const data = {rows: [{store: "private", units: 3}]}', "fixture"));

const html = await readFile(path.join(publicRoot, "analytics.html"), "utf8");
const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, "Dashboard element identities must be unique.");
const closure = pageAssets(html);
for (const file of moduleFiles.slice(1)) assert.ok(closure.has(file), `Dashboard does not load ${file}.`);
assert.ok(closure.has("js/package-codec.js"), "Protected analytics must use the existing PPC package codec.");
const scriptOrder = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(match => resolveAsset(match[1], "analytics.html"));
for (const before of ["js/package-codec.js", "js/sellout-model.js", "js/sellout-ppc.js"]) assert.ok(scriptOrder.indexOf(before) < scriptOrder.indexOf("js/sellout-private.js"), `${before} must load before private analytics.`);
assert.ok(scriptOrder.indexOf("js/sellout-private.js") < scriptOrder.indexOf("js/sellout-dashboard.js"), "Private analytics tools must load before the dashboard.");
for (const helper of ["js/sellout-mix.js", "js/sellout-flow.js", "js/sellout-motion.js", "js/sellout-spring.js", "js/sellout-sharepoint.js"]) assert.ok(scriptOrder.indexOf(helper) < scriptOrder.indexOf("js/sellout-dashboard.js"), `${helper} must load before the dashboard.`);
assert.ok(![...closure].some(file => /\/(?:app|master-[\w-]+|workspace-store|package-client)\.js$/.test(file)), "Analytics must open independently from portfolio editing and master storage.");
for (const file of closure) {
  if (file.endsWith(".css")) {
    const css = await readFile(path.join(publicRoot, file), "utf8");
    for (const asset of stylesheetAssets(css, file)) closure.add(asset);
  }
}
for (const file of [...moduleFiles, ...closure]) assert.ok((await stat(path.join(publicRoot, file))).isFile(), `Missing dashboard asset: ${file}`);

const workflow = await readFile(path.join(root, ".github/workflows/deploy.yml"), "utf8");
const staged = stagedSources(workflow);
for (const file of [...moduleFiles, ...closure]) {
  const source = `public/${file}`;
  assert.ok([...staged].some(entry => source === entry || source.startsWith(`${entry}/`)), `Deployment omits dashboard asset: ${source}`);
}

for (const file of moduleFiles.filter(file => file.endsWith(".js"))) {
  const source = await readFile(path.join(publicRoot, file), "utf8");
  validatePrivateBoundary(source, file);
  const result = spawnSync(process.execPath, ["--check", path.join(publicRoot, file)], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || `Invalid JavaScript: ${file}`);
}

async function scanPublic(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await scanPublic(fullPath);
    else {
      const relative = path.relative(publicRoot, fullPath).split(path.sep).join("/");
      assert.ok(!privateFormats.test(entry.name), `Raw workbook/data must stay outside public: ${relative}`);
      assert.ok(!/\.pkg$/i.test(entry.name) || relative === "data/master_ppc.pkg", `Analytics packages need a separately reviewed hosting plan: ${relative}`);
    }
  }
}
await scanPublic(publicRoot);

const versioned = renderVersionedIndex(html, "analytics-check");
assert.deepEqual([...pageAssets(versioned)], [...pageAssets(html)], "Versioning must preserve the dashboard's local asset closure.");
assert.equal(renderVersionedIndex(versioned, "analytics-check"), versioned, "Dashboard versioning must be idempotent.");
for (const match of versioned.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
  const attrs = attributes(match[0]);
  const reference = attrs.get("src") ?? (attrs.get("rel")?.split(/\s+/).includes("stylesheet") ? attrs.get("href") : null);
  if (reference) assert.equal(new URL(reference, "https://example.test/").searchParams.get("v"), "analytics-check");
}

const index = await readFile(path.join(publicRoot, "index.html"), "utf8");
const link = [...index.matchAll(/<a\b[^>]*>/gi)].map(match => attributes(match[0])).find(attrs => attrs.get("href") === "analytics.html");
assert.ok(link, "Portfolio must provide a visible Analytics link.");
assert.equal(link.get("target"), "_blank", "Analytics must preserve the user's open portfolio editor.");
assert.ok(link.get("rel")?.split(/\s+/).includes("noopener"), "Analytics must not retain access to its opener.");
assert.ok(!link.has("data-view"), "Analytics is a separate module, not a portfolio canvas view.");

const privateKey = [...html.matchAll(/<input\b[^>]*>/gi)].map(match => attributes(match[0])).find(attrs => attrs.get("id") === "privateKey");
assert.ok(privateKey, "Protected analytics must provide a dedicated package key input.");
assert.equal(privateKey.get("type"), "password", "Package access must stay concealed in the native input.");
assert.equal(privateKey.get("autocomplete"), "off", "The key input must not invite automatic credential persistence.");
const uiSource = await readFile(path.join(publicRoot, "js/sellout-dashboard.js"), "utf8");
assert.ok(!/\b(?:localStorage|sessionStorage)\b|portfolio\.sharedTeamAccess/.test(uiSource), "Analytics must not harvest PPC tab credentials.");
const workspaceExpression = /const\s+workspace\s*=\s*\(\s*\)\s*=>\s*(\(\{[\s\S]*?\}\))\s*;/.exec(uiSource)?.[1];
assert.ok(workspaceExpression, "Native analytics must expose an explicit workspace projection for backups.");
const fakeState = {
  snapshot: { schemaVersion: 1, periods: [{ date: "2026-09-20", quarter: "FY26Q4" }], rows: [{ store: "Fixture", sku: "FIX01AA", product: "Alpha", category: "Audio", lifetime: 0, values: [0] }] },
  prices: { FIX01AA: { msrp: 0, source: "Fixture" } }, shortlist: [], ppcProjection: null, pricingSource: null,
  packageKey: "EXCLUDED KEY FIXTURE", portfolio: { privateFacts: "EXCLUDED PORTFOLIO FIXTURE" }, internalConnection: { token: "EXCLUDED TOKEN FIXTURE" },
};
const nativeWorkspace = vm.runInNewContext(workspaceExpression, { state: fakeState, structuredClone });
assert.deepEqual(Object.keys(nativeWorkspace).sort(), ["snapshot", "prices", "shortlist", "ppcProjection", "pricingSource"].sort(), "Native exports must contain only the analytics schema.");
assert.ok(!JSON.stringify(nativeWorkspace).includes("EXCLUDED"), "Native exports must exclude access credentials, full portfolio state and connection configuration.");
await import("../../public/js/package-codec.js");
await import("../../public/js/sellout-model.js");
await import("../../public/js/sellout-ppc.js");
await import("../../public/js/sellout-private.js");
const safeWorkspace = globalThis.PPCSelloutPrivate.sanitizeWorkspace(JSON.parse(JSON.stringify(nativeWorkspace)));
assert.equal(safeWorkspace.snapshot.rows[0].values[0], 0, "The native exported schema must remain valid without converting zero units.");
assert.equal(safeWorkspace.prices.FIX01AA.msrp, 0, "The native exported schema must preserve a zero USD MSRP.");

// Exercise the actual picker functions and native checkbox callbacks against
// a small source fixture. Empty arrays mean All; explicit None must stay empty.
const filterFixture = {
  snapshot: { schemaVersion: 1, periods: ["2026-01-04", "2026-01-11", "2026-01-18"].map(date => ({ date, quarter: "FY26Q1" })), rows: [
    { store: "Retailer A", sku: "SKU-A", product: "Alpha", category: "Audio", lifetime: 60, values: [10, 20, 30] },
    { store: "Retailer A", sku: "SKU-B", product: "Beta", category: "Audio", lifetime: 6, values: [2, 2, 2] },
    { store: "Retailer B", sku: "SKU-A", product: "Alpha", category: "Audio", lifetime: 15, values: [5, 5, 5] },
    { store: "Retailer B", sku: "SKU-B", product: "Beta", category: "Audio", lifetime: 0, values: [0, null, 0] },
  ] }, stores: [], products: [], storesNone: false, productsNone: false, hiddenSeries: new Set(),
};
const filterSourceBefore = JSON.stringify(filterFixture.snapshot);
const filterElements = new Map(["storeOptions", "productOptions", "storeLabel", "productLabel", "storeAll", "productAll", "productSearch", "categoryFilter", "marketStore", "bandFilter", "startDate", "endDate", "comparison", "coverage", "trendMode"].map(id => [id, { value: "", innerHTML: "", textContent: "", checked: false, indeterminate: false }]));
filterElements.get("startDate").value = "2026-01-04"; filterElements.get("endDate").value = "2026-01-18";
filterElements.get("comparison").value = "none"; filterElements.get("coverage").value = "common";
const filterSandbox = { state: filterFixture, M: globalThis.PPCSelloutModel, Set,
  $: id => filterElements.get(id), esc: value => String(value), niceName: value => value,
  bandOf: () => "$50–99", stopTimeline() {}, update() {},
};
vm.createContext(filterSandbox);
const pickerDefinition = name => {
  const definition = uiSource.match(new RegExp(`^  function ${name}\\([^]*?^  \\}`, "m"))?.[0];
  assert.ok(definition, `Missing actual picker function ${name}`); return definition;
};
vm.runInContext(["controls", "renderProductOptions", "filters", "setFilterSelection", "setAllFilters"].map(pickerDefinition).join("\n"), filterSandbox);
vm.runInContext(uiSource.match(/^  function productSelectionChanged[^\n]+/m)[0], filterSandbox);
for (const id of ["storeOptions", "productOptions", "storeAll", "productAll"]) {
  const callback = uiSource.match(new RegExp(`^  \\$\\("${id}"\\)\\.onchange = [^\\n]+`, "m"))?.[0];
  assert.ok(callback, `Missing actual native checkbox callback ${id}`); vm.runInContext(callback, filterSandbox);
}
const pickedAnalysis = () => globalThis.PPCSelloutModel.analyze(filterFixture.snapshot, filterSandbox.filters());
const checkedOptionCount = id => [...filterElements.get(id).innerHTML.matchAll(/<input\b[^>]*\bchecked\b[^>]*>/g)].length;
filterSandbox.controls();
assert.equal(checkedOptionCount("storeOptions"), 2, "implicit All shows all retailer checkboxes checked");
assert.equal(checkedOptionCount("productOptions"), 2, "implicit All shows all SKU checkboxes checked");
assert.ok(filterElements.get("storeAll").checked && filterElements.get("productAll").checked);
filterElements.get("storeOptions").onchange({ target: { dataset: { store: "Retailer A" }, checked: false } });
assert.deepEqual([...filterFixture.stores], ["Retailer B"], "unchecking one retailer from All materializes the remaining selection");
assert.ok(filterElements.get("storeAll").indeterminate && !filterElements.get("storeAll").checked);
assert.equal(pickedAnalysis().stores.length, 1);
filterElements.get("storeOptions").onchange({ target: { dataset: { store: "Retailer B" }, checked: false } });
assert.equal(filterFixture.storesNone, true);
assert.equal(filterElements.get("storeLabel").textContent, "No retailers");
assert.equal(pickedAnalysis().rows.length, 0, "unchecking the last retailer must never restore all source rows");
filterElements.get("storeAll").onchange({ target: { checked: true } });
assert.equal(filterFixture.storesNone, false); assert.equal(checkedOptionCount("storeOptions"), 2);
filterElements.get("storeAll").onchange({ target: { checked: false } });
assert.equal(pickedAnalysis().rows.length, 0, "unchecking the native All control selects no retailers");
filterElements.get("storeAll").onchange({ target: { checked: true } });

filterElements.get("productOptions").onchange({ target: { dataset: { product: "SKU-A" }, checked: false } });
assert.deepEqual([...filterFixture.products], ["SKU-B"]);
assert.equal(filterElements.get("trendMode").value, "products");
assert.ok(filterElements.get("productAll").indeterminate);
filterElements.get("productOptions").onchange({ target: { dataset: { product: "SKU-B" }, checked: false } });
assert.equal(filterElements.get("productLabel").textContent, "No SKUs");
assert.equal(filterFixture.productsNone, true); assert.equal(pickedAnalysis().rows.length, 0);
filterElements.get("bandFilter").value = "$50–99";
assert.equal(pickedAnalysis().rows.length, 0, "a price-band filter cannot turn None back into All SKUs");
filterElements.get("productOptions").onchange({ target: { dataset: { product: "SKU-A" }, checked: true } });
filterElements.get("productOptions").onchange({ target: { dataset: { product: "SKU-B" }, checked: true } });
assert.equal(filterFixture.productsNone, false); assert.equal(filterFixture.products.length, 0, "selecting the final SKU canonicalizes the All state");
assert.equal(filterElements.get("trendMode").value, "stores"); assert.ok(filterElements.get("productAll").checked);
filterElements.get("productAll").onchange({ target: { checked: false } });
assert.equal(pickedAnalysis().rows.length, 0);
filterElements.get("productAll").onchange({ target: { checked: true } });
assert.equal(pickedAnalysis().rows.length, 4);
filterElements.get("productSearch").value = "Alpha"; filterSandbox.renderProductOptions();
assert.equal(checkedOptionCount("productOptions"), 1, "search narrows displayed options without changing global All");
assert.ok(filterElements.get("productAll").checked);
filterElements.get("productOptions").onchange({ target: { dataset: { product: "SKU-A" }, checked: false } });
assert.deepEqual([...filterFixture.products], ["SKU-B"], "unchecking a searched SKU retains selected SKUs outside the visible search results");
filterSandbox.setAllFilters("products"); filterSandbox.controls();
assert.equal(filterFixture.productsNone, false); assert.equal(filterFixture.products.length, 0);
assert.equal(JSON.stringify(filterFixture.snapshot), filterSourceBefore, "picker changes never rewrite imported source facts");
for (const id of ["storeAll", "productAll"]) {
  const input = [...html.matchAll(/<input\b[^>]*>/gi)].map(match => attributes(match[0])).find(attrs => attrs.get("id") === id);
  assert.equal(input?.get("type"), "checkbox", "All uses a native checkbox master control");
}

// Exercise the actual shaded Reporting table and native cell interactions.
const reportSnapshot = { schemaVersion: 1, periods: ["2026-09-20", "2026-09-27", "2026-10-04", "2026-10-11", "2026-10-18"].map(date => ({ date, quarter: "FY26Q4" })), rows: [
  { store: "Retailer A", sku: "REPORT-A", product: "Alpha", category: "Audio", lifetime: 125, values: [100, 25, null, null, null] },
  { store: "Retailer B", sku: "REPORT-B", product: "Beta", category: "Audio", lifetime: 21, values: [25, null, -4, null, null] },
  { store: "Retailer C", sku: "REPORT-C", product: "Gamma", category: "Audio", lifetime: 0, values: [0, 0, null, null, null] },
  { store: "Retailer D", sku: "REPORT-D", product: "Delta", category: "Audio", lifetime: 120, values: [4, 16, 100, null, null] },
] };
const reportingModel = globalThis.PPCSelloutModel, reportInputBefore = JSON.stringify(reportSnapshot);
const reportEsc = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const reportDecode = value => String(value).replace(/&(amp|lt|gt|quot|#39);/g, entity => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" })[entity]);
const reportTooltip = { hidden: true }, reportFocusCalls = [], reportStopCalls = [];
let reportEmpty, lastReportTip, reportActiveCell;
const reportTable = {
  cells: [],
  set innerHTML(value) {
    this.markup = value;
    this.headers = [...value.matchAll(/<th scope="row">([^<]*)<\/th>/g)].map(match => reportDecode(match[1]));
    this.cells = [...value.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(match => {
      const attrs = attributes(`<button ${match[1]}>`), events = new Map(), classes = new Set();
      const cell = {
        attrs, content: match[2], dataset: { reportDate: attrs.get("data-report-date"), reportRow: attrs.get("data-report-row"), reportIndex: attrs.get("data-report-index"), value: attrs.get("data-value"), zero: attrs.get("data-zero"), missing: attrs.get("data-missing") },
        classList: { toggle(name, active) { if (active) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) },
        addEventListener(name, callback) { if (!events.has(name)) events.set(name, []); events.get(name).push(callback); },
        emit(name, event = {}) { events.get(name)?.forEach(callback => callback(event)); },
        getAttribute: name => reportDecode(attrs.get(name)), getBoundingClientRect: () => ({ left: 20, top: 10, width: 32, height: 40 }),
        focus(options) { reportActiveCell?.emit("blur"); reportActiveCell = cell; reportFocusCalls.push({ cell, options }); cell.emit("focus"); },
        scrollIntoView(options) { this.lastScroll = options; },
      };
      return cell;
    });
  },
  querySelectorAll: function () { return this.cells; },
  querySelector: function (selector) {
    const row = selector.match(/data-report-row="(\d+)"/)?.[1], index = selector.match(/data-report-index="(\d+)"/)?.[1];
    return this.cells.find(cell => cell.dataset.reportRow === row && cell.dataset.reportIndex === index);
  },
};
const reportState = { analysis: reportingModel.analyze(reportSnapshot, { coverage: "available", comparison: "none" }), view: "overview" };
const reportSandbox = { state: reportState, Date, Intl, Math, Number,
  $: id => id === "heatChart" ? reportTable : reportTooltip,
  esc: reportEsc, fmt: value => Number.isFinite(value) ? String(value) : "—", short: value => Number.isFinite(value) ? String(value) : "—",
  day: (value, full = false) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", ...(full ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)),
  noChart: (_id, text) => { reportEmpty = text; reportTable.innerHTML = ""; }, showTip: text => { lastReportTip = text; reportTooltip.hidden = false; },
  stopTimeline: options => reportStopCalls.push(options), showView: view => { reportState.view = view; },
};
vm.createContext(reportSandbox);
vm.runInContext(["matrixCellAppearance", "attachTips", "renderHeat"].map(pickerDefinition).join("\n"), reportSandbox);
const appearance = reportSandbox.matrixCellAppearance, shadePercent = shade => Number(shade.background.match(/ ([\d.]+)%,transparent\)$/)[1]);
assert.ok(Math.abs(shadePercent(appearance(100, 100)) - 78) < 1e-9);
assert.ok(shadePercent(appearance(25, 100)) < shadePercent(appearance(100, 100)), "larger positive quantities are lighter on the shared scale");
assert.ok(Math.abs(shadePercent(appearance(0, 0)) - 3.5) < 1e-9, "reported zero retains a quiet finite shade");
assert.equal(appearance(-4, 100).color, "var(--so-negative)");
assert.equal(shadePercent(appearance(-4, 100)), 18, "negative adjustments retain their distinct alert shade");
reportSandbox.renderHeat();
assert.deepEqual(reportTable.headers, ["Retailer A", "Retailer B", "Retailer C", "Retailer D"], "retailer headers remain fixed and consistently ordered");
assert.equal(reportTable.cells.length, 20, "every retailer has one native cell for each source week, including missing tails");
assert.match(reportTable.markup, /<table\b/); assert.ok(!/<svg\b|<circle\b|animation-delay/.test(reportTable.markup), "Reporting uses a fixed matrix without animated dot geometry");
const reportCell = (row, index) => reportTable.querySelector(`[data-report-row="${row}"][data-report-index="${index}"]`);
assert.equal(reportCell(0, 1).attrs.get("style"), reportCell(1, 0).attrs.get("style"), "equal quantities on different retailers share the same shade");
for (const cell of reportTable.cells) {
  const row = Number(cell.dataset.reportRow), index = Number(cell.dataset.reportIndex), value = reportSnapshot.rows[row].values[index];
  assert.equal(cell.dataset.reportDate, reportSnapshot.periods[index].date);
  assert.equal(cell.dataset.value, value === null ? "" : String(value), "typed source value maps to explicit cell evidence without filling nulls");
  assert.equal(cell.dataset.zero, String(value === 0)); assert.equal(cell.dataset.missing, String(value === null));
  assert.equal(cell.attrs.get("type"), "button", "reporting cells retain native keyboard activation");
  assert.ok(cell.getAttribute("aria-label").includes(value === null ? "Missing report" : `${value} net units`));
  if (value === null) assert.ok(cell.attrs.get("style").startsWith("background:transparent;") && !cell.content.includes("so-cell-value"), "missing cells show a dash without a numeric quantity");
  else assert.ok(cell.content.includes("so-cell-value"));
}
assert.ok(reportCell(2, 0).content.includes(">0</span>"));
assert.ok(reportCell(1, 2).attrs.get("style").includes("var(--so-negative)") && reportCell(1, 2).content.includes(">-4</span>"));
assert.equal(reportingModel.analyze(reportSnapshot, { coverage: "common", comparison: "none" }).selection.end, "2026-09-27", "shared coverage clips to the earliest selected retailer cutoff");
const staticMarkup = reportTable.markup, staticValues = reportTable.cells.map(cell => cell.dataset.value);
reportCell(0, 1).emit("pointerenter"); reportCell(0, 1).emit("pointermove", { clientX: 20, clientY: 10 });
assert.equal(reportTable.cells.filter(cell => cell.classList.contains("is-active-week")).length, 4, "pointer emphasis highlights the source week across all retailer rows");
assert.ok(lastReportTip.includes("Sep 27, 2026") && lastReportTip.includes("Missing") && lastReportTip.includes(">0</b>"), "a week tooltip includes exact dated readings, zero and missing evidence");
assert.equal(reportTable.markup, staticMarkup); assert.deepEqual(reportTable.cells.map(cell => cell.dataset.value), staticValues, "hover changes no row headers, cell geometry or source quantities");
reportCell(0, 1).emit("pointerleave");
assert.ok(reportTable.cells.every(cell => !cell.classList.contains("is-active-week")) && reportTooltip.hidden);
reportCell(0, 1).focus({ preventScroll: true });
assert.equal(reportTable.cells.filter(cell => cell.classList.contains("is-active-week")).length, 4);
reportCell(0, 1).onkeydown({ key: "ArrowDown", preventDefault() {} });
assert.equal(reportActiveCell, reportCell(1, 1), "vertical arrows retain the selected week while changing retailer rows");
assert.equal(reportActiveCell.lastScroll.inline, "nearest");
reportActiveCell.onkeydown({ key: "End", preventDefault() {} }); assert.equal(reportActiveCell, reportCell(1, 4));
reportActiveCell.onkeydown({ key: "ArrowRight", preventDefault() {} }); assert.equal(reportActiveCell, reportCell(1, 4), "keyboard movement clamps at the last source week");
reportActiveCell.onkeydown({ key: "Home", preventDefault() {} }); assert.equal(reportActiveCell, reportCell(1, 0));
reportActiveCell.onkeydown({ key: "ArrowLeft", preventDefault() {} }); assert.equal(reportActiveCell, reportCell(1, 0));
reportActiveCell.onkeydown({ key: "ArrowRight", preventDefault() {} }); assert.equal(reportActiveCell, reportCell(1, 1));
reportActiveCell.onkeydown({ key: "ArrowUp", preventDefault() {} }); assert.equal(reportActiveCell, reportCell(0, 1));
let preventedEnter = false;
reportActiveCell.onkeydown({ key: "Enter", preventDefault() { preventedEnter = true; } });
assert.equal(preventedEnter, false, "Enter retains the native button click behavior");
reportActiveCell.onclick();
assert.equal(reportState.markerDate, "2026-09-27"); assert.equal(reportStopCalls.at(-1).refit, false);
reportCell(3, 2).onclick(); assert.equal(reportState.markerDate, "2026-10-04", "pointer clicks pin the exact weekly date");
assert.equal(reportTable.markup, staticMarkup, "pinning retains Reporting table geometry");
assert.equal(JSON.stringify(reportSnapshot), reportInputBefore, "cell interaction never rewrites source observations");
reportState.analysis = reportingModel.analyze(reportSnapshot, { stores: ["Retailer C"], start: "2026-09-20", end: "2026-09-20", coverage: "available", comparison: "none" });
reportSandbox.renderHeat(); assert.equal(reportTable.cells.length, 1); assert.equal(reportCell(0, 0).dataset.zero, "true", "singleton zero weeks remain explicitly reported");
const densePeriods = Array.from({ length: 104 }, (_, index) => ({ date: new Date(Date.UTC(2024, 9, 27 + index * 7)).toISOString().slice(0, 10), quarter: `FY${25 + Math.floor(index / 52)}Q${1 + Math.floor(index % 52 / 13)}` }));
const denseSnapshot = { schemaVersion: 1, periods: densePeriods, rows: [
  { store: "Retailer A", sku: "DENSE-A", product: "Alpha", category: "Audio", lifetime: 10400, values: densePeriods.map(() => 100) },
  { store: "Retailer C", sku: "DENSE-C", product: "Gamma", category: "Audio", lifetime: 0, values: densePeriods.map(() => 0) },
] };
reportState.analysis = reportingModel.analyze(denseSnapshot, { coverage: "available", comparison: "none" });
reportSandbox.renderHeat(); assert.equal(reportTable.cells.length, 208);
reportCell(1, 103).focus(); reportCell(1, 103).onkeydown({ key: "Home", preventDefault() {} }); assert.equal(reportActiveCell, reportCell(1, 0));
assert.equal(reportCell(1, 103).dataset.reportDate, densePeriods[103].date, "long histories retain every original weekly index");
reportState.analysis = reportingModel.analyze(reportSnapshot, { products: ["NO-MATCH"], coverage: "common", comparison: "none" });
reportSandbox.renderHeat(); assert.equal(reportTable.cells.length, 0); assert.equal(reportEmpty, "No reporting periods selected.");
const reportingRenderer = pickerDefinition("renderHeat");
assert.ok(!/PPCSelloutMotion|requestAnimationFrame|reportingObserver|reportingPulseStarted/.test(reportingRenderer), "Reporting has no animation loop or visibility observer");

console.log(`Sellout module checks passed: ${closure.size} local assets, deployment closure, syntax, private-data boundaries, native All/partial/None filters, shaded Reporting cell semantics and versioned resources.`);
