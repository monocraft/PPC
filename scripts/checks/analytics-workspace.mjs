import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { renderVersionedIndex } from "../configure-site-version.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publicRoot = path.join(root, "public");
const read = file => readFile(path.join(root, file), "utf8");
const html = await read("public/analytics.html");
const index = await read("public/index.html");
const hubSource = await read("public/js/analytics-workspace.js");
const blueprintHtml = await read("public/blueprint/index.html");
const unifiedSource = await read("public/blueprint/unified-workspace.js");
const dashboardSource = await read("public/blueprint/dashboard.js");
const analysisStyle = await read('public/blueprint/analysis-workspace.css');
const workflow = await read(".github/workflows/deploy.yml");
const versionSource = await read("scripts/configure-site-version.mjs");

function attributes(tag) {
  return new Map([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+))/g)]
    .map(match => [match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]]));
}
const tagById = (source, id) => [...source.matchAll(/<[a-z][^>]*>/gi)]
  .map(match => ({ tag: match[0], attrs: attributes(match[0]) })).find(item => item.attrs.get("id") === id);

// There is one destination in PPC. Module choices belong to the analysis workspace.
const analyticsLinks = [...index.matchAll(/<a\b[^>]*>/gi)].map(match => attributes(match[0]))
  .filter(attrs => attrs.get("href") === "analytics.html");
assert.ok(analyticsLinks.length > 0, "PPC retains its Analytics destination.");
for (const link of analyticsLinks) {
  assert.ok(!link.has("target") || link.get("target") === "_self", "Ordinary Analytics navigation reuses the current app tab.");
  assert.ok(!/new tab/i.test(link.get("aria-label") || ""), "Navigation labels describe the destination without promising another tab.");
}
const portfolioLinks = [...html.matchAll(/<a\b[^>]*>/gi)].map(match => attributes(match[0]))
  .filter(attrs => attrs.get("href") === "index.html");
assert.ok(portfolioLinks.length > 0, "Analytics retains its Portfolio destination.");
for (const link of portfolioLinks) {
  assert.ok(!link.has("target") || link.get("target") === "_self", "Returning to Portfolio does not create another copy of the workspace.");
  assert.ok(!/new tab/i.test(link.get("aria-label") || ""));
}
const mainHeader = index.match(/<header\b[\s\S]*?<\/header>/i)?.[0] || "";
assert.ok(!/\b(?:href|data-view)\s*=\s*["'][^"']*blueprint/i.test(mainHeader), "Blueprint adds no independent main-toolbar destination.");

for (const [id, module, panel] of [["analysis-retail-tab", "retail", "selloutApp"], ["analysis-blueprint-tab", "blueprint", "blueprintPane"]]) {
  const tab = tagById(html, id)?.attrs;
  assert.ok(tab, `Missing module tab ${id}.`);
  assert.equal(tab.get("role"), "tab");
  assert.equal(tab.get("data-analysis-module"), module);
  assert.equal(tab.get("aria-controls"), panel);
  assert.equal(tagById(html, panel)?.attrs.get("role"), "tabpanel");
}
const frame = tagById(html, "blueprintFrame")?.attrs;
assert.ok(frame, "Portfolio plan has one retained frame.");
assert.equal(frame.get("data-src"), "blueprint/index.html?embedded=1");
assert.ok(!frame.has("src") || ["", "about:blank"].includes(frame.get("src")), "Blueprint loads only when requested.");
assert.ok(frame.get("title"), "The embedded analysis has an accessible title.");
assert.ok(tagById(html, "blueprintViews"), "Blueprint views remain contextual within Analytics.");
const exposedViews = [...html.matchAll(/<button\b[^>]*data-blueprint-view\s*=\s*["']([^"']+)["'][^>]*>/gi)].map(match => match[1]);
assert.deepEqual(exposedViews, ['performance', 'source'], 'The shell exposes one analysis canvas and its data utility, without six competing analysis pages.');
const standaloneViews = [...blueprintHtml.matchAll(/<button\b[^>]*data-view\s*=\s*["']([^"']+)["'][^>]*>/gi)].map(match => match[1]);
assert.deepEqual(standaloneViews, ['performance', 'source'], 'Standalone and embedded navigation expose the same small workspace.');
assert.equal([...blueprintHtml.matchAll(/id="analysis-chart"/g)].length, 1, 'One main graph owns the analysis pane.');
assert.ok(blueprintHtml.indexOf('id="scope-breadcrumb"') < blueprintHtml.indexOf('id="analysis-chart"'));
assert.ok(blueprintHtml.indexOf('id="analysis-summary"') < blueprintHtml.indexOf('id="analysis-chart"'), 'Selected-year financial values stay above the graph.');
const controlStrip = blueprintHtml.slice(blueprintHtml.indexOf('class="analysis-control-strip"'), blueprintHtml.indexOf('id="analysis-summary"'));
assert.ok(controlStrip.includes('id="analysis-toolbar"') && controlStrip.includes('id="analysis-connectivity"'), 'Measures and connectivity share one compact control region.');
assert.ok(blueprintHtml.indexOf('id="analysis-chart"') < blueprintHtml.indexOf('id="scope-explorer"'), 'Product choices remain below the shared graph.');
const visibleTools = [...blueprintHtml.matchAll(/<button\b[^>]*>/gi)].map(match => attributes(match[0])).filter(attrs => attrs.has('data-analysis-tool'));
assert.deepEqual(visibleTools.map(attrs => attrs.get('data-analysis-tool')), ['insights', 'scenarios', 'evidence'], 'The workspace exposes Insights, Scenario and Evidence without a separate Decisions destination.');
assert.match(blueprintHtml, /<button\b[^>]*data-analysis-tool="insights"[^>]*>Insights<\/button>/, 'The visible analytical tool is named Insights.');
for (const tool of ['insights', 'scenarios', 'evidence']) {
  const button = [...blueprintHtml.matchAll(/<button\b[^>]*>/gi)].map(match => attributes(match[0])).find(attrs => attrs.get('data-analysis-tool') === tool);
  assert.equal(button?.get('aria-controls'), 'analysis-overlay', `${tool} uses the same analysis overlay rather than a new page.`);
}
const chartDock = tagById(blueprintHtml, 'analysis-overlay');
assert.ok(chartDock?.attrs.get('aria-labelledby'), 'Inline chart tools retain an accessible heading.');
assert.ok(/^<aside\b/.test(chartDock.tag), 'Contextual tools are an inline chart dock rather than a dialog.');
assert.match(chartDock.tag, /\bhidden(?:\s|>|=)/, 'The inline dock begins closed without an empty panel.');
const graphShell = blueprintHtml.slice(blueprintHtml.indexOf('id="analysis-graph-shell"'), blueprintHtml.indexOf('id="planning-timeline"'));
assert.ok(graphShell.includes('id="analysis-chart"') && graphShell.includes('id="analysis-overlay"'), 'The contextual tools belong to the same graph shell.');
assert.ok(graphShell.indexOf('id="analysis-chart"') < graphShell.indexOf('id="analysis-overlay"'), 'The tool pane follows the complete chart, including its year rail.');
assert.ok(graphShell.indexOf('id="analysis-chart"') < graphShell.indexOf('id="analysis-tool-strip"') && graphShell.indexOf('id="analysis-tool-strip"') < graphShell.indexOf('id="analysis-overlay"'), 'Insights, Scenario and Evidence sit below the chart rather than above it');
const toolStrip = graphShell.slice(graphShell.indexOf('id="analysis-tool-strip"'), graphShell.indexOf('id="analysis-overlay"'));
assert.equal((toolStrip.match(/data-analysis-tool=/g) || []).length, 3, 'The below-chart strip contains the three existing analysis tools exactly once');
assert.ok(tagById(blueprintHtml, 'analysis-chart-controls') && toolStrip.includes('id="analysis-chart-controls"'), 'Pan and zoom controls have one shared mount beside the analysis tools');
assert.doesNotMatch(blueprintHtml.slice(0, blueprintHtml.indexOf('id="analysis-chart"')), /data-analysis-tool=/, 'The top heading does not repeat the below-chart tool navigation');
assert.ok(blueprintHtml.indexOf('id="analysis-overlay"') < blueprintHtml.indexOf('id="scope-explorer"'), 'All contextual tools open before the product choices in the same workspace flow.');
assert.doesNotMatch(blueprintHtml, /<dialog\b[^>]*id="analysis-overlay"/, 'Analysis tools cannot revert to a floating modal workspace.');
assert.match(blueprintHtml, /<button[^>]*id="analysis-overlay-close"[^>]*>Close<\/button>/, 'The attached analysis tools use a plain, readable close action.');
const layoutRules = [...analysisStyle.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({
  selectors: selectors.split(',').map(selector => selector.trim()),
  properties: new Map([...body.matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)/g)].map(([, name, value]) => [name, value.trim()]))
}));
const shellRules = layoutRules.filter(rule => rule.selectors.some(selector => /^\.unified-analysis \.analysis-graph-shell(?:\.has-analysis-dock)?$/.test(selector)));
assert.ok(shellRules.some(rule => rule.properties.get('position') === 'relative'), 'The graph and tools share one workspace container.');
const closedShellRules = shellRules.filter(rule => rule.selectors.includes('.unified-analysis .analysis-graph-shell'));
const openShellRules = shellRules.filter(rule => rule.selectors.includes('.unified-analysis .analysis-graph-shell.has-analysis-dock'));
assert.ok(closedShellRules.some(rule => ['minmax(0,1fr)', '1fr'].includes((rule.properties.get('grid-template-columns') || '').replace(/\s+/g, ''))), 'The closed workspace keeps a single full-width graph.');
assert.ok(openShellRules.some(rule => ['minmax(0,1fr)', '1fr'].includes((rule.properties.get('grid-template-columns') || '').replace(/\s+/g, ''))), 'Opening a tool keeps the full-width graph above a full-width bottom pane.');
for (const rule of shellRules) {
  const columns = rule.properties.get('grid-template-columns');
  if (columns) assert.ok(['minmax(0,1fr)', '1fr'].includes(columns.replace(/\s+/g, '')), 'Desktop, tablet and mobile tools cannot narrow the graph with a second grid column.');
}
const mobileStart = analysisStyle.search(/@media\s*\(max-width:\s*720px\)/);
assert.ok(mobileStart >= 0);
const nextMedia = analysisStyle.indexOf('@media', mobileStart + 7), mobileStyle = analysisStyle.slice(mobileStart, nextMedia < 0 ? undefined : nextMedia);
assert.match(mobileStyle, /\.analysis-graph-shell\.has-analysis-dock\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/, 'Small widths preserve the same full-width bottom tool arrangement.');
assert.match(mobileStyle, /#analysis-overlay\s*\{[^}]*grid-column:\s*1\s*;/, 'The mobile tool cannot create an implicit second grid column.');
const overlayRules = layoutRules.filter(rule => rule.selectors.includes('.unified-analysis #analysis-overlay'));
assert.ok(overlayRules.some(rule => rule.properties.get('position') === 'relative'), 'Contextual tools expand in the workspace flow rather than floating over the graph.');
assert.ok(overlayRules.every(rule => !rule.properties.has('position') || rule.properties.get('position') === 'relative'), 'Responsive tools stay attached and cannot become a popup.');
assert.ok(overlayRules.some(rule => rule.properties.get('grid-column') === '1' && rule.properties.get('width') === '100%'), 'The bottom pane occupies the complete graph column.');
assert.ok(overlayRules.some(rule => rule.properties.get('height') === 'auto' && rule.properties.get('max-height') === 'none'), 'The bottom pane grows for its tool content rather than clipping to plot height.');
for (const rule of overlayRules) for (const [name, value] of rule.properties) {
  assert.doesNotMatch(value, /--analysis-plot-(?:top|height)/, `${name} cannot retain a side-panel plot offset or height constraint.`);
}
assert.doesNotMatch(unifiedSource, /class="analysis-overlay-tabs"/, 'The three top tools are not duplicated by a second tool navigation inside the bottom pane.');
assert.doesNotMatch(unifiedSource, /analysis-decision-(?:question|owner|notes)|data-analysis-export-brief|function exportBrief\(/, 'Insights does not retain the removed decision form or its export control.');
const mediumInsights = /\.unified-analysis \.analysis-insights-decisions\s*\{([^}]+)\}/.exec(analysisStyle)?.[1] || '';
assert.equal((mediumInsights.match(/minmax\(/g) || []).length, 2, 'Medium-width Insights gives contributors and economics two columns');
assert.match(mediumInsights, /grid-template-areas:\s*"contributors movement"\s*"economics movement"/, 'At medium widths contributors lead, movement occupies the right column, and economics sits below contributors');
assert.match(analysisStyle, /@media\s*\(min-width:\s*800px\)\s*\{[\s\S]*?\.analysis-insights-decisions\s*\{[^}]*grid-template-areas:\s*"contributors movement economics"/, 'The three full Insights sections appear in the requested order across a wide pane');
for (const rule of layoutRules.filter(rule => rule.selectors.includes('.unified-analysis .analysis-movement-grid'))) if (rule.properties.has('grid-template-columns')) assert.equal(rule.properties.get('grid-template-columns').replace(/\s+/g, ''), 'minmax(0,1fr)', 'All four movement items stay in a single vertical list at every width');
assert.match(analysisStyle, /\.analysis-movement-grid\s*\{[^}]*gap:\s*0\s*;/, 'Compact movement rows share one ledger without card-sized gaps');
assert.match(analysisStyle, /\.analysis-movement-periods\s*\{[^}]*display:\s*contents\s*;/, 'Prior and current values align with the shared ledger columns');
assert.match(analysisStyle, /@container movement\s*\(min-width:\s*520px\)\s*\{[\s\S]*?\.analysis-movement-header,\.unified-analysis \.analysis-movement-item\s*\{[^}]*grid-template-columns:\s*minmax\(76px,\.8fr\) repeat\(3,minmax\(0,1fr\)\)/, 'A wide movement ledger aligns its metric, prior, current and change columns');
assert.match(analysisStyle, /\.analysis-movement-change > span\s*\{[^}]*display:\s*none\s*;/, 'The repeated Change word stays out of each compact row while accessible direction remains in the markup');
assert.match(mobileStyle, /\.analysis-insights-decisions\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/, 'Mobile Insights stacks all three analysis sections in one column');
assert.match(mobileStyle, /\.analysis-insights-decisions\s*\{[^}]*grid-template-areas:\s*"contributors"\s*"movement"\s*"economics"/, 'Mobile preserves the same contributors, movement, economics reading order');
assert.match(analysisStyle, /\.analysis-movement-change\.is-positive strong\s*\{[^}]*color:\s*#84d6a4/, 'Positive raw changes use the calm green direction color');
assert.match(analysisStyle, /\.analysis-movement-change\.is-negative strong\s*\{[^}]*color:\s*#f08b8d/, 'Negative raw changes use the red direction color');
assert.match(analysisStyle, /\.analysis-movement-change strong\s*\{[^}]*color:\s*#d0d8e3/, 'Zero and unavailable changes retain a neutral value color');
const sharedValueSize = Number(/--analysis-value-size:\s*([\d.]+)px/.exec(analysisStyle)?.[1]);
assert.equal(sharedValueSize, 15, 'Secondary financial figures share one consistent 15px type scale');
for (const selector of ['.analysis-controls .hx-category-tile-value', '.analysis-controls .hx-category-tile-share', '.analysis-overlay-body .detail-field strong', '.analysis-overlay-body [data-inline-point-value]', '.analysis-overlay-body .drill-economic strong', '.analysis-overlay-body input.analysis-exact-input', '.analysis-overlay-body .scenario-comparison strong', '.analysis-evidence-table td', '.analysis-economics-column .scenario-comparison strong', '.analysis-movement-value', '.analysis-movement-change strong', '.analysis-unavailable', '.drill-metric-value', '.drill-metric-value.is-unavailable']) {
  const font = layoutRules.filter(rule => rule.selectors.includes('.unified-analysis ' + selector) && rule.properties.has('font-size')).at(-1)?.properties.get('font-size');
  assert.equal(font, 'var(--analysis-value-size)', `${selector} uses the shared secondary value size rather than a competing numerical hierarchy.`);
}
const mainTotalSizes = layoutRules.filter(rule => rule.selectors.includes('.unified-analysis .analysis-summary-value') && rule.properties.has('font-size')).map(rule => Number.parseFloat(rule.properties.get('font-size')));
assert.ok(mainTotalSizes.length > 0 && mainTotalSizes.every(size => size > sharedValueSize), 'Only the selected main totals retain a larger numerical size at every responsive breakpoint');
assert.ok(layoutRules.some(rule => rule.selectors.includes('.unified-analysis .analysis-controls .hx-category-tile-metrics') && rule.properties.get('flex-wrap') === 'wrap'), 'Category values and contribution percentages can wrap rather than overlap on narrow screens');
assert.match(analysisStyle, /\.analysis-contributor-list \.scenario-comparison\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\) max-content;[^}]*gap:\s*14px;/, 'Contributor values reserve their exact width while names remain close beside them');
assert.match(analysisStyle, /\.analysis-contributor-list \.scenario-comparison > span\s*\{[^}]*text-align:\s*right;/, 'Contributor names align toward their values rather than the outside edge');
assert.match(analysisStyle, /\.analysis-contributor-list \.scenario-comparison strong\s*\{[^}]*justify-self:\s*start;/, 'Contributor amounts align beside names at the center gap');
assert.match(analysisStyle, /\.analysis-contributor-list \.scenario-comparison strong\s*\{[^}]*color:\s*var\(--contributor-ink/, 'Contributor value brightness follows its source-revenue shade');
assert.match(dashboardSource, /state\.overlay=\(\{products:'(?:decisions|insights)',investment:'(?:decisions|insights)',scenarios:'scenarios',source:'source'\}\)\[view\]/, 'Existing links retain compatible routes into the contextual tools.');
assert.match(unifiedSource, /HX_ANALYSIS_CANVAS\.create\(\$\('#analysis-chart'\)/, 'The workspace sends all selected metrics into one chart instance.');

// Retail remains the same independent workspace, with its current encryption controls.
for (const id of ["workbookFile", "importDialog", "applyImport", "sourceDialog", "privateDialog", "privateKey", "timelineTrack", "timelinePlay", "categoryFilter", "detailTable"]) {
  assert.ok(tagById(html, id), `Retail retains ${id}.`);
}
const retailSource = await read("public/js/sellout-dashboard.js");
assert.ok(retailSource.includes('"ppc-retail-analytics-v1"'), "Existing saved Retail work retains its database identity.");
const publisherSource = await read("public/js/sellout-ppc.js");
assert.ok(publisherSource.includes('new URL("analytics.html"'), "PPC pricing links continue to target the existing Analytics route.");

// Follow every local script and stylesheet through both entry pages; reject data payloads.
const closure = new Set(["analytics.html", "blueprint/index.html"]);
function localReference(reference, owner) {
  const value = reference.replace(/&amp;/g, "&").split(/[?#]/, 1)[0];
  if (value.startsWith("data:")) return null;
  assert.ok(value && !/^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(value), `Analysis assets must be local: ${reference}`);
  const absolute = path.resolve(publicRoot, path.dirname(owner), decodeURIComponent(value));
  assert.ok(absolute.startsWith(publicRoot + path.sep), `Asset escapes the published tree: ${reference}`);
  assert.ok(!/\.(?:xlsx?|xlsm|csv|tsv|jsonl?|data|pkg)$/i.test(absolute), `Private source cannot be an analysis asset: ${reference}`);
  return path.relative(publicRoot, absolute).split(path.sep).join("/");
}
function addReferences(source, owner) {
  if (owner.endsWith(".html")) {
    for (const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
      const attrs = attributes(match[0].slice(0, match[0].indexOf(">") + 1));
      assert.ok(!match[1].trim(), "Public analysis pages do not embed executable or private source payloads.");
      if (attrs.has("src")) closure.add(localReference(attrs.get("src"), owner));
    }
    for (const match of source.matchAll(/<link\b[^>]*>/gi)) {
      const attrs = attributes(match[0]);
      if (attrs.has("href")) closure.add(localReference(attrs.get("href"), owner));
    }
  } else if (owner.endsWith(".css")) {
    for (const match of source.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) closure.add(localReference(match[1] ?? match[2] ?? match[3], owner));
  }
  closure.delete(null);
}
for (const file of closure) {
  const absolute = path.join(publicRoot, file);
  assert.ok((await stat(absolute)).isFile(), `Missing analysis asset: ${file}`);
  if (/\.(?:html|css)$/.test(file)) addReferences(await readFile(absolute, "utf8"), file);
}
for (const asset of ["css/analytics-workspace.css", "js/analytics-workspace.js"]) assert.ok(closure.has(asset), `Shared workspace loads ${asset}.`);
assert.ok(![...closure].some(file => /(?:^|\/)data\.js$/i.test(file)), "The populated HX snapshot is excluded from published assets.");

const staged = new Set();
for (const line of workflow.split(/\r?\n/).map(value => value.trim()).filter(value => value.startsWith("cp "))) {
  const tokens = line.match(/"[^"]*"|'[^']*'|\S+/g).map(token => token.replace(/^['"]|['"]$/g, ""));
  if (!tokens.at(-1).startsWith("_site")) continue;
  for (const token of tokens.slice(1, -1).filter(value => !value.startsWith("-"))) staged.add(token.replace(/\/$/, ""));
}
for (const file of closure) assert.ok([...staged].some(entry => `public/${file}` === entry || `public/${file}`.startsWith(entry + "/")), `Deployment omits ${file}.`);
assert.ok(versionSource.includes('"blueprint/index.html"'), "The nested Blueprint page participates in deployment versioning.");
for (const [source, owner] of [[html, "analytics.html"], [blueprintHtml, "blueprint/index.html"]]) {
  const versioned = renderVersionedIndex(source, "workspace-check");
  assert.equal(renderVersionedIndex(versioned, "workspace-check"), versioned, `${owner} versioning remains idempotent.`);
  for (const match of versioned.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const ref = attrs.get("src") ?? (attrs.get("rel")?.split(/\s+/).includes("stylesheet") ? attrs.get("href") : null);
    if (ref) assert.equal(new URL(ref.replace(/&amp;/g, "&"), "https://example.test/").searchParams.get("v"), "workspace-check");
  }
}

const blueprintFiles = [];
async function scanBlueprint(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await scanBlueprint(full);
    else blueprintFiles.push(full);
  }
}
await scanBlueprint(path.join(publicRoot, "blueprint"));
for (const file of blueprintFiles) {
  assert.ok(!/\.(?:xlsx?|xlsm|csv|tsv|jsonl?|data|pkg)$/i.test(file), `Raw Blueprint source remains private: ${path.basename(file)}`);
  assert.notEqual(path.basename(file).toLowerCase(), "data.js");
  if (!/\.(?:html|js|css)$/.test(file)) continue;
  const source = await readFile(file, "utf8");
  assert.ok(!/\bHX_DATA\s*=\s*\{\s*["'](?:source|sheets|products)["']/.test(source), `${path.basename(file)} must not bundle a populated source.`);
  assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(|\bsendBeacon\s*\(/.test(source), `${path.basename(file)} must not send private workbook data over the network.`);
  assert.ok(!/product-portfolio-canvas-v\d|product-portfolio-image-assets-v\d|ppc-retail-analytics-v1/.test(source), `${path.basename(file)} must not open another module's saved database.`);
}
for (const file of [path.join(publicRoot, "js/analytics-workspace.js"), ...blueprintFiles.filter(file => file.endsWith(".js"))]) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || `Invalid JavaScript: ${file}`);
}

// The actual workspace controller's isolated behavior fixtures follow below.
function workspaceFixture(url = "https://example.test/PPC/analytics.html") {
  function element(dataset = {}) {
    const attrs = new Map(), listeners = new Map();
    return {
      dataset, attrs, listeners, hidden: false, style: {}, textContent: "", title: "", tabIndex: 0,
      setAttribute(name, value) { attrs.set(name, String(value)); },
      removeAttribute(name) { attrs.delete(name); },
      getAttribute(name) { return attrs.get(name) ?? null; },
      addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); },
      emit(name, event = {}) { for (const callback of listeners.get(name) || []) callback(event); },
      focus() { this.focused = true; },
    };
  }
  const retail = element(), blueprint = element(), frame = element({ src: "blueprint/index.html?embedded=1" });
  const loading = element(), source = element(), importButton = element();
  const tabs = [element({ analysisModule: "retail" }), element({ analysisModule: "blueprint" })];
  const views = exposedViews.map(view => element({ blueprintView: view }));
  const posts = [], lifecycle = [], history = [], listeners = new Map();
  let loads = 0;
  frame.contentWindow = { postMessage(message, origin) { posts.push({ message: structuredClone(message), origin }); } };
  Object.defineProperty(frame, "src", { get() { return frame.attrs.get("src") || ""; }, set(value) { loads++; frame.attrs.set("src", String(value)); } });
  const nodes = new Map([["selloutApp", retail], ["blueprintPane", blueprint], ["blueprintFrame", frame], ["blueprintLoading", loading], ["blueprintSource", source], ["blueprintImport", importButton]]);
  const document = {
    getElementById: id => nodes.get(id), currentScript: { src: "https://example.test/PPC/js/analytics-workspace.js?v=fixture-release" },
    querySelectorAll: selector => selector === "[data-analysis-module]" ? tabs : selector === "[data-blueprint-view]" ? views : [],
  };
  const window = {
    location: new URL(url),
    PPCSelloutDashboard: { setActive(active) { lifecycle.push(active); } },
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); },
    history: {
      pushState(_state, _title, target) { window.location = new URL(target, window.location); history.push({ mode: "push", url: window.location.href }); },
      replaceState(_state, _title, target) { window.location = new URL(target, window.location); history.push({ mode: "replace", url: window.location.href }); },
    },
  };
  vm.runInNewContext(hubSource, { document, globalThis: window, URL, URLSearchParams, console }, { filename: "analytics-workspace.js" });
  return { window, retail, blueprint, frame, loading, source, importButton, tabs, views, posts, lifecycle, history, get loads() { return loads; },
    emit(name, event) { for (const callback of listeners.get(name) || []) callback(event); },
    message(data, { origin = window.location.origin, sender = frame.contentWindow } = {}) { this.emit("message", { origin, source: sender, data }); },
  };
}
const workspace = workspaceFixture();
const defaultScaleWorkspace = workspaceFixture('https://example.test/PPC/analytics.html#blueprint/performance');
assert.equal(new URL(defaultScaleWorkspace.frame.src).searchParams.get('scale'), 'values', 'A newly opened Portfolio plan starts with Values in the retained frame');
assert.equal(defaultScaleWorkspace.window.PPCAnalyticsWorkspace.captureView().scale, 'values');
const explicitTrendWorkspace = workspaceFixture('https://example.test/PPC/analytics.html?scale=trend#blueprint/performance');
assert.equal(new URL(explicitTrendWorkspace.frame.src).searchParams.get('scale'), 'trend', 'An explicitly requested trend URL remains indexed');
explicitTrendWorkspace.frame.emit('load');
explicitTrendWorkspace.window.PPCSavedViews = { sanitizePreferences(kind, value) { assert.equal(kind, 'blueprint'); return structuredClone(value); } };
await explicitTrendWorkspace.window.PPCAnalyticsWorkspace.applyView({ view: 'performance', scale: 'trend', year: '2027' }, 'blueprint');
assert.equal(explicitTrendWorkspace.posts.at(-1).message.preferences.scale, 'trend', 'A saved view retains its explicit Indexed trend preference');
assert.equal(explicitTrendWorkspace.window.PPCAnalyticsWorkspace.captureView().scale, 'trend');
await explicitTrendWorkspace.window.PPCAnalyticsWorkspace.applyView({ view: 'performance', year: '2026' }, 'blueprint');
assert.equal(explicitTrendWorkspace.posts.at(-1).message.preferences.scale, 'values', 'A saved view without a scale uses Values instead of inheriting the previous view’s trend');
assert.equal(explicitTrendWorkspace.window.PPCAnalyticsWorkspace.captureView().scale, 'values');
assert.equal(workspace.window.PPCAnalyticsWorkspace.currentModule, "retail");
assert.equal(workspace.loads, 0, "Starting Retail does not instantiate another source workspace.");
assert.equal(workspace.retail.hidden, false); assert.equal(workspace.blueprint.hidden, true);
assert.deepEqual(workspace.lifecycle, [true]);
workspace.tabs[1].emit("click");
assert.equal(workspace.window.PPCAnalyticsWorkspace.currentModule, "blueprint");
assert.equal(workspace.retail.hidden, true); assert.equal(workspace.blueprint.hidden, false);
assert.equal(workspace.tabs[1].getAttribute("aria-selected"), "true");
assert.equal(workspace.tabs[0].tabIndex, -1);
assert.equal(workspace.lifecycle.at(-1), false, "Deactivation reaches Retail's lifecycle hook so playback can stop.");
assert.equal(workspace.loads, 1);
const retainedFrameSource = workspace.frame.src;
assert.equal(new URL(retainedFrameSource).origin, workspace.window.location.origin);
assert.equal(new URL(retainedFrameSource).searchParams.get("v"), "fixture-release", "The lazy page follows the shell release version.");
workspace.frame.emit("load");
workspace.views.find(view => view.dataset.blueprintView === "performance").emit("click");
assert.equal(workspace.window.location.hash, '#blueprint/performance');
assert.equal(workspace.views.find(view => view.dataset.blueprintView === 'performance').getAttribute('aria-current'), 'page');
// Historical links stay accepted while the child maps them to an overlay.
workspace.window.PPCAnalyticsWorkspace.showBlueprintView('scenarios');
assert.equal(workspace.window.location.hash, "#blueprint/scenarios");
assert.equal(workspace.posts.at(-1).message.view, "scenarios");
workspace.message({ type: "ppc:blueprint:state", state: { view: "scenarios", year: 2023, category: "Headsets", revenue: -1.5, margin: 0, spend: 0, rows: [{ secret: "EXCLUDED SOURCE FIXTURE" }], privateKey: "EXCLUDED KEY FIXTURE" }, sourceLabel: "Synthetic source" });
assert.equal(workspace.window.location.searchParams.get("year"), "2023");
assert.equal(workspace.window.location.searchParams.get("category"), "Headsets");
assert.equal(workspace.window.location.searchParams.get("revenue"), "-1.5");
assert.equal(workspace.window.location.searchParams.get("margin"), "0");
assert.equal(workspace.source.textContent, "Synthetic source");
assert.ok(!workspace.window.location.href.includes("EXCLUDED"), "Routes exclude source rows and credentials even if a message includes them.");
workspace.tabs[0].emit("click");
assert.equal(workspace.posts.at(-1).message.type, "ppc:blueprint:suspend", "Hiding Portfolio plan stops its playback through the suspend command.");
workspace.tabs[1].emit("click");
assert.equal(workspace.loads, 1, "Switching modules retains the same imported frame.");
assert.equal(workspace.frame.src, retainedFrameSource);
assert.equal(workspace.posts.at(-1).message.view, "scenarios");
assert.equal(workspace.window.location.searchParams.get("revenue"), "-1.5", "Module changes preserve scenario assumptions.");
workspace.importButton.emit("click");
assert.equal(workspace.posts.at(-1).message.type, "ppc:blueprint:import");
assert.ok(workspace.posts.every(post => post.origin === workspace.window.location.origin), "Commands always name the expected origin; wildcard delivery is forbidden.");
assert.ok(workspace.posts.every(post => Object.keys(post.message).every(key => ["type", "view", "preferences"].includes(key))), "Parent commands contain only navigation preferences, with no source payload or pricing capability.");
assert.ok(workspace.posts.every(post => Object.keys(post.message.preferences || {}).every(key => ['year','category','revenue','margin','spend','scale','groupId','projectId','skuId','compare','workspace'].includes(key))));

const validMaliciousState = { type: "ppc:blueprint:state", state: { view: "investment", year: 2029, category: "Other", revenue: 30, margin: 10, spend: 30 }, sourceLabel: "Spoofed source" };
const trustedState = { url: workspace.window.location.href, source: workspace.source.textContent, height: workspace.frame.style.height };
for (const identity of [{ origin: "https://other.test" }, { sender: {} }]) {
  workspace.message(validMaliciousState, identity);
  workspace.message({ type: "ppc:blueprint:height", height: 12345 }, identity);
}
for (const data of [null, "unrelated", { type: "unknown", ...validMaliciousState, state: { view: "unknown" } }, { type: "ppc:blueprint:state", state: { view: "javascript:malicious" }, sourceLabel: "Spoofed source" }]) workspace.message(data);
assert.deepEqual({ url: workspace.window.location.href, source: workspace.source.textContent, height: workspace.frame.style.height }, trustedState, "Wrong windows, foreign origins and unsupported views cannot change analysis state.");
workspace.message({ type: "ppc:blueprint:state", state: { view: "scenarios", year: "invalid", category: "x".repeat(1201), revenue: Infinity, margin: 11, spend: -31 } });
assert.equal(workspace.window.location.searchParams.get("year"), "2023");
assert.equal(workspace.window.location.searchParams.get("category"), "Headsets");
assert.equal(workspace.window.location.searchParams.get("revenue"), "-1.5");
assert.equal(workspace.window.location.searchParams.get("margin"), "0");
for (const height of [NaN, Infinity, -1, 0, 99, 50001, "400"]) workspace.message({ type: "ppc:blueprint:height", height });
assert.equal(workspace.frame.style.height, trustedState.height, "Invalid frame sizes are rejected.");
workspace.message({ type: "ppc:blueprint:height", height: 1000.3 });
assert.equal(workspace.frame.style.height, "1001px");
const historyBeforeInvalid = workspace.history.length, postsBeforeInvalid = workspace.posts.length;
workspace.window.PPCAnalyticsWorkspace.switchModule("unknown"); workspace.window.PPCAnalyticsWorkspace.showBlueprintView("unknown");
assert.equal(workspace.history.length, historyBeforeInvalid); assert.equal(workspace.posts.length, postsBeforeInvalid);
let prevented = false;
workspace.tabs[1].emit("keydown", { key: "ArrowRight", preventDefault() { prevented = true; } });
assert.ok(prevented && workspace.tabs[0].focused, "Native tab keyboard navigation transfers focus.");
assert.equal(workspace.window.PPCAnalyticsWorkspace.currentModule, "retail");

const deepLink = workspaceFixture("https://example.test/PPC/analytics.html?analysis=blueprint&year=2028&category=Mice&revenue=99&margin=-99&spend=12#blueprint/performance");
assert.equal(deepLink.window.PPCAnalyticsWorkspace.currentModule, "blueprint");
const deepSource = new URL(deepLink.frame.src);
assert.equal(deepSource.hash, "#performance"); assert.equal(deepSource.searchParams.get("year"), "2028");
assert.equal(deepSource.searchParams.get("revenue"), "30"); assert.equal(deepSource.searchParams.get("margin"), "-10");
assert.equal(deepSource.searchParams.get("spend"), "12");
deepLink.window.location = new URL("https://example.test/PPC/analytics.html?analysis=retail"); deepLink.emit("popstate");
assert.equal(deepLink.window.PPCAnalyticsWorkspace.currentModule, "retail", "Browser history activates the intended module without rebuilding its frame.");
assert.equal(deepLink.loads, 1);
const scopedLink = workspaceFixture('https://example.test/PPC/analytics.html?analysis=blueprint&year=2026&category=Headsets&groupId=product-12&projectId=PROJECT%20A&skuId=SKU%2F001#blueprint/performance');
const scopedSource = new URL(scopedLink.frame.src);
const scopeParams = url => new URLSearchParams(url.hash.split('?')[1] || '');
assert.equal(scopeParams(scopedSource).get('groupId'), 'product-12');
assert.equal(scopeParams(scopedSource).get('projectId'), 'PROJECT A');
assert.equal(scopeParams(scopedSource).get('skuId'), 'SKU/001', 'Exact part-number punctuation survives the shared fragment.');
for (const url of [scopedSource, scopedLink.window.location]) {
  assert.ok(!['groupId','projectId','skuId'].some(key => url.searchParams.has(key)), 'Private project and SKU identifiers are excluded from HTTP query parameters.');
}
scopedLink.message({type:'ppc:blueprint:state',state:{view:'performance',groupId:'product-12',projectId:'PROJECT B',skuId:''}});
assert.equal(scopeParams(scopedLink.window.location).get('projectId'), 'PROJECT B');
assert.equal(scopeParams(scopedLink.window.location).has('skuId'), false, 'Going up a level removes the old child from shared links.');
scopedLink.message({type:'ppc:blueprint:state',state:{view:'performance',groupId:'x'.repeat(241),projectId:'PROJECT\u0000C',skuId:{secret:'not a filter'}}});
assert.equal(scopeParams(scopedLink.window.location).get('groupId'), 'product-12');
assert.equal(scopeParams(scopedLink.window.location).get('projectId'), 'PROJECT B', 'Malformed scope identifiers cannot replace valid selections.');
scopedLink.message({type:'ppc:blueprint:state',state:{view:'performance',groupId:'',projectId:'',skuId:''}});
assert.ok(!['groupId','projectId','skuId'].some(key=>scopeParams(scopedLink.window.location).has(key)), 'Returning to categories clears the entire child path.');
scopedLink.frame.emit('load');
scopedLink.window.location = new URL('https://example.test/PPC/analytics.html?analysis=blueprint&year=2025&category=Headsets#blueprint/performance?groupId=product-20&projectId=PROJECT%20Z&skuId=SKU-9');
scopedLink.emit('popstate');
assert.equal(scopedLink.posts.at(-1).message.preferences.skuId, 'SKU-9', 'History changes reach the retained frame rather than loading a second source.');
scopedLink.window.location = new URL('https://example.test/PPC/analytics.html?analysis=blueprint&category=Headsets#blueprint/performance');
scopedLink.emit('popstate');
assert.equal(scopedLink.posts.at(-1).message.preferences.projectId, '');
assert.equal(scopedLink.posts.at(-1).message.preferences.skuId, '', 'A category-level history route clears stale child selections.');
assert.equal(scopedLink.loads, 1);
const selectedProducts = JSON.stringify(['product-12','product-14']);
const comparisonLink = workspaceFixture('https://example.test/PPC/analytics.html?analysis=blueprint&year=2026&category=Headsets#blueprint/performance?compare=' + encodeURIComponent(selectedProducts));
assert.equal(scopeParams(new URL(comparisonLink.frame.src)).get('compare'), selectedProducts);
assert.equal(comparisonLink.window.location.searchParams.has('compare'), false, 'Product selections stay outside HTTP query parameters.');
comparisonLink.message({type:'ppc:blueprint:state',state:{view:'performance',compare:JSON.stringify(['SKU/001','SKU#002','SKU/001'])}});
assert.equal(scopeParams(comparisonLink.window.location).get('compare'), JSON.stringify(['SKU/001','SKU#002']), 'Product comparison identifiers retain punctuation and are deduplicated.');
for (const invalid of ['not JSON', JSON.stringify({rows:['secret']}), JSON.stringify(['x\u0000y']), JSON.stringify(Array.from({length:51},(_,i)=>String(i))), JSON.stringify(['x'.repeat(241)])]) {
  comparisonLink.message({type:'ppc:blueprint:state',state:{view:'performance',compare:invalid}});
  assert.equal(scopeParams(comparisonLink.window.location).get('compare'), JSON.stringify(['SKU/001','SKU#002']), 'Malformed comparisons cannot replace valid selections.');
}
comparisonLink.frame.emit('load');
comparisonLink.window.location = new URL('https://example.test/PPC/analytics.html?analysis=blueprint#blueprint/performance'); comparisonLink.emit('popstate');
assert.equal(comparisonLink.posts.at(-1).message.preferences.compare, '[]', 'History clears a comparison when the route returns to an unselected scope.');
assert.equal(scopeParams(comparisonLink.window.location).has('compare'), false);
const workspaceSelection = { metrics: ['revenue', 'units', 'grossProfit', 'budget'], connectivity: ['wired', 'wireless'], overlay: 'scenarios', productSort: 'grossProfit', sortDirection: 'desc', scenarioEnabled: true, scenarioStart: '2026', rows: [{ secret: 'EXCLUDED FINANCIAL ROW' }], privateKey: 'EXCLUDED PRIVATE KEY' };
comparisonLink.message({ type: 'ppc:blueprint:state', state: { view: 'performance', workspace: JSON.stringify(workspaceSelection) } });
assert.equal(comparisonLink.window.location.searchParams.has('workspace'), false, 'Workspace and connection selections stay outside request-visible query parameters.');
const routedWorkspace = JSON.parse(scopeParams(comparisonLink.window.location).get('workspace'));
assert.deepEqual(routedWorkspace.metrics, workspaceSelection.metrics); assert.deepEqual(routedWorkspace.connectivity, ['wired', 'wireless']); assert.equal(routedWorkspace.overlay, 'scenarios');
assert.ok(!JSON.stringify(routedWorkspace).includes('EXCLUDED'), 'The host accepts only explicit workspace preferences, without financial rows or credentials.');
const capability = "a".repeat(64), pricingLink = workspaceFixture(`https://example.test/PPC/analytics.html#ppc-link=${capability}`);
assert.equal(pricingLink.window.location.hash, `#ppc-link=${capability}`, "The existing pricing bridge consumes its own temporary capability.");
pricingLink.tabs[1].emit("click");
assert.ok(!pricingLink.frame.src.includes(capability), "Portfolio plan never receives the Retail pricing capability.");

// Exercise the actual source store against an isolated IndexedDB fixture. These
// records are synthetic and never enter a live browser or the published tree.
const storedRecords = new Map(), openedDatabases = [];
let sourceWrites = 0;
const fakeDatabase = {
  createObjectStore() {}, close() {},
  transaction(store, mode) {
    assert.equal(store, "source");
    const transaction = {
      objectStore() {
        return {
          get(key) {
            const request = {};
            queueMicrotask(() => { request.result = structuredClone(storedRecords.get(key)); transaction.oncomplete?.(); });
            return request;
          },
          put(value, key) {
            assert.equal(mode, "readwrite"); sourceWrites++;
            const request = {};
            queueMicrotask(() => { storedRecords.set(key, structuredClone(value)); request.result = key; transaction.oncomplete?.(); });
            return request;
          },
        };
      },
    };
    return transaction;
  },
};
const sourceWindow = {
  indexedDB: {
    open(name, version) {
      openedDatabases.push({ name, version });
      const request = {};
      queueMicrotask(() => { request.result = fakeDatabase; request.onupgradeneeded?.(); request.onsuccess?.(); });
      return request;
    },
  },
};
vm.runInNewContext(await read("public/blueprint/source-store.js"), { window: sourceWindow, console }, { filename: "blueprint/source-store.js" });
assert.equal((await sourceWindow.HX_SOURCE_READY).snapshot, null, "An empty source database starts without invented data.");
const syntheticSource = {
  source: { name: "Synthetic Blueprint fixture.xlsm" }, sheets: [], categories: ["Audio"], periods: [2026], investments: [],
  products: [{ name: "Synthetic item", category: "Audio", revenueByYear: { 2026: 0 }, gmByYear: { 2026: null }, unitsByYear: { 2026: -2 } }],
};
const syntheticBefore = JSON.stringify(syntheticSource);
await sourceWindow.HX_SOURCE_STORE.save(syntheticSource);
assert.equal(JSON.stringify(await sourceWindow.HX_SOURCE_STORE.restore()), syntheticBefore, "Stored source preserves zero, missing and signed figures.");
assert.equal(JSON.stringify(syntheticSource), syntheticBefore, "Saving leaves source facts unchanged.");
for (const bad of [null, {}, { ...syntheticSource, products: [] }, { ...syntheticSource, periods: [9999] }, { ...syntheticSource, products: [{ revenueByYear: {} }] }]) {
  await assert.rejects(sourceWindow.HX_SOURCE_STORE.save(bad), /supported|incomplete/);
}
assert.equal(sourceWrites, 1, "Rejected imports never replace an existing source.");
assert.equal(JSON.stringify(await sourceWindow.HX_SOURCE_STORE.restore()), syntheticBefore);
assert.deepEqual(openedDatabases, [{ name: "ppc-blueprint-analytics-v1", version: 1 }], "Blueprint opens only its own independent source database.");

console.log(`Analytics workspace checks passed: ${closure.size} local assets, single PPC destination, retained module routing, trusted messages, scenario preservation, playback lifecycle and isolated source storage.`);
