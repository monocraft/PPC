import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
function source(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `App must implement ${name}.`);
  return app.slice(app.slice(start - 6, start) === 'async ' ? start - 6 : start, app.indexOf('\n}', start) + 2);
}

const route = { ffs: false, isFfsRoadmap: () => route.ffs };
vm.createContext(route);
vm.runInContext(source('pptxUsesRoadmapTemplate'), route);
assert.equal(route.pptxUsesRoadmapTemplate('roadmap'), true);
for (const scope of ['products', 'both']) assert.equal(route.pptxUsesRoadmapTemplate(scope), false);
route.ffs = true;
assert.equal(route.pptxUsesRoadmapTemplate('roadmap'), false);
console.log('Roadmap template UI routing passed without changing products, combined or Hashout exports.');

const openingScopes = ['products', 'roadmap', 'both'].map(value => ({ value, checked: value === 'both', focus() {} }));
const opening = { activeView: 'products', pptxExportForm: { querySelectorAll: () => openingScopes, querySelector: selector => selector.includes(':checked') ? openingScopes.find(input => input.checked) : { value: '2026-01' } },
  pptxExportDialog: { classList: { remove() {} } }, document: { activeElement: null, querySelector: () => ({}) }, $: () => ({}),
  stopProductCardDrag() {}, closePopupMenus() {}, resetPptxRoadmapLimit() {}, hasDedicatedHashoutView: () => false,
  restorePptxExportPreferences() {}, ensurePptxCurrentViewAction() {}, renderPptxExportCategories() {}, syncPptxExportSummary() {},
  requestAnimationFrame: fn => fn(), isFfsRoadmap: () => false, PPCSavedViews: { readExportPreferences: () => ({}) },
};
vm.createContext(opening); vm.runInContext(source('openPptxExportDialog'), opening);
opening.openPptxExportDialog();
assert.equal(openingScopes.find(input => input.checked).value, 'both', 'Opening from Products retains its standard first-open default');
opening.activeView = 'roadmap'; opening.openPptxExportDialog();
assert.equal(openingScopes.find(input => input.checked).value, 'roadmap', 'First opening from lifecycle Roadmap selects the reference template');
openingScopes.forEach(input => { input.checked = input.value === 'products'; });
opening.PPCSavedViews.readExportPreferences = () => ({ scope: 'products' }); opening.openPptxExportDialog();
assert.equal(openingScopes.find(input => input.checked).value, 'products', 'An explicit saved scope survives a lifecycle opening');

const model = {};
vm.createContext(model);
vm.runInContext(fs.readFileSync(path.join(root, 'public/js/pptx-roadmap-model.js'), 'utf8'), model);
const product = { id: 'visible', name: 'Visible', roadmap: { family: 'Input', startMonth: '2025-01', endMonth: '2025-12' }, ffsDate: '2025-02-31' };
const hidden = { id: 'hidden', name: 'Hidden', roadmap: { family: 'Input' } };
const categories = [{ id: 'category', name: 'Category', board: { products: [hidden, product], settings: { roadmap: { categoryLabel: 'Display label' } } } }];
const before = JSON.stringify(categories);
const snapshot = {
  PPTXRoadmapModel: model.PPTXRoadmapModel, portfolio: { settings: { showRoadmapMsrp: true } },
  PortfolioModel: { catalogProducts: products => products.filter(p => p.id !== 'hidden'), isDiscontinued: () => false, productLabelColor: (_, fallback) => fallback },
  PortfolioDatePrecision: { currentPeriod: () => null }, categoryDefinition: () => ({}),
  roadmapGroupsForProducts: products => [{ family: 'Input', products }], effectiveRoadmap: p => p.roadmap,
  roadmapStatusColor: () => '#123456', contrastTextColor: () => '#FFFFFF', standardizedStatus: () => ({ label: 'Available' }),
  splitRoadmapStatusLabel: () => '', productPriceText: () => '$99',
};
vm.createContext(snapshot); vm.runInContext(source('buildRoadmapTemplateData'), snapshot);
const data = snapshot.buildRoadmapTemplateData(categories, { startMonth: '2026-02', endMonth: '2026-08' });
assert.deepEqual([...data.categories[0].products.map(p => p.id)], ['visible']);
assert.equal(data.categories[0].products[0].lifecycleCoverage, 'outsideRange');
assert.equal(data.categories[0].products[0].dates.ffsDate.raw, '2025-02-31');
assert.equal(data.categories[0].products[0].dates.ffsDate.validDate, null);
assert.equal(data.categories[0].products[0].dates.generalAvailabilityDate.raw, null);
assert.equal(data.categories[0].products[0].nativeLifecycleProduct.priceLabel, '$99');
assert.equal(JSON.stringify(categories), before, 'Projection must not add startup date defaults or mutate source records');
const incomplete = structuredClone(categories);
delete incomplete[0].board.products[1].roadmap.startMonth;
incomplete[0].board.products[1].roadmap.launchMonth = '2025-01';
const incompleteBefore = JSON.stringify(incomplete);
const incompleteData = snapshot.buildRoadmapTemplateData(incomplete, { startMonth: '2026-02', endMonth: '2026-08' });
assert.equal(incompleteData.categories[0].products[0].lifecycleCoverage, 'tbd', 'A saved launch month cannot substitute for a missing lifecycle start');
assert.equal(incompleteData.categories[0].products[0].nativeLifecycleProduct.startMonth, '');
assert.equal(JSON.stringify(incomplete), incompleteBefore);

const start = { value: '1999-01' }, end = { value: '1999-02' }, inputs = [{ value: 'categories' }, { value: 'merged' }];
const period = { PPTXRoadmapModel: model.PPTXRoadmapModel, activeView: 'roadmap', roadmapScroll: { scrollLeft: 110, clientWidth: 570 }, splitRoadmapScroll: { scrollLeft: 250, clientWidth: 390 }, roadmapMonthWidth: 100, ROADMAP_LEFT_WIDTH: 190,
  roadmapRange: () => ({ start: 2026 * 12, end: 2027 * 12 - 1 }), pptxUsesRoadmapTemplate: () => true,
  pptxExportForm: { querySelector: selector => selector.endsWith('Start') ? start : end, querySelectorAll: () => inputs },
};
period.setView = view => { period.activeView = view; };
vm.createContext(period); vm.runInContext(source('pptxVisibleRoadmapPeriod') + '\n' + source('syncPptxTemplatePeriod'), period);
period.syncPptxTemplatePeriod();
assert.equal(start.value, '2026-02'); assert.equal(end.value, '2026-05'); assert.equal(start.readOnly, true);
period.roadmapScroll.scrollLeft = 300; period.syncPptxTemplatePeriod();
assert.equal(start.value, '2026-04'); assert.equal(end.value, '2026-07');
period.activeView = 'split'; period.syncPptxTemplatePeriod();
assert.equal(start.value, '2026-03'); assert.equal(end.value, '2026-05');
period.activeView = 'products'; period.syncPptxTemplatePeriod(); assert.equal(period.activeView, 'roadmap');
period.pptxUsesRoadmapTemplate = () => false; period.syncPptxTemplatePeriod(); assert.equal(start.readOnly, false);

let cleaned = 0, downloaded = 0, paints = 0;
const exporter = { PPTXRoadmapTemplate: { generate: async () => ({ blob: {}, fileName: 'fixture.pptx' }) }, syncPptxTemplatePeriod: () => ({}), buildRoadmapTemplateData: () => ({}),
  beginPptxTemplateProgress: () => ({ update() {}, close: () => cleaned++ }), requestAnimationFrame: callback => { paints++; callback(); }, downloadBlob: () => downloaded++ };
vm.createContext(exporter); vm.runInContext(source('exportRoadmapTemplate'), exporter);
await exporter.exportRoadmapTemplate([]); assert.equal(downloaded, 1); assert.equal(cleaned, 1); assert.equal(paints, 2);
exporter.PPTXRoadmapTemplate.generate = async () => { throw new Error('synthetic export failure'); };
await assert.rejects(exporter.exportRoadmapTemplate([]), /synthetic export failure/); assert.equal(cleaned, 2); assert.equal(downloaded, 1);
const entry = source('exportPptx');
assert.ok(entry.indexOf('exportRoadmapTemplate(categories)') < entry.indexOf('PortfolioTheme.fontsReady()'), 'Reference export must bypass installed-font and canvas export branches');
const submit = app.slice(app.indexOf('pptxExportForm.addEventListener("submit"'), app.indexOf('$("#closePptxExport").onclick'));
assert.ok(submit.indexOf('syncPptxTemplatePeriod()') < submit.indexOf('pptxReusablePreferences('), 'Persist the refreshed viewport, not stale saved dates');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
for (const module of ['pptx-roadmap-model', 'pptx-roadmap-template']) assert.ok(html.indexOf(`js/${module}.js`) < html.indexOf('js/app.js'));
assert.match(html, /id="pptxExportProgress"[^>]+hidden/);
const gitAttributes = fs.readFileSync(path.join(root, '.gitattributes'), 'utf8');
assert.match(gitAttributes, /^public\/assets\/pptx\/\*\.json text eol=lf\r?$/m, 'SHA-pinned numeric/template metadata must retain deterministic bytes on Windows checkouts');
assert.match(gitAttributes, /^public\/assets\/pptx\/\*\.pptx -text\r?$/m, 'The sanitized template is a binary asset');
console.log('Roadmap UI checks passed: catalog filtering, raw missing/invalid dates, source immutability, actual viewport refresh, legacy controls, font-free dispatch and success/failure progress cleanup.');
