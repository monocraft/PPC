import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../../public/js/saved-views.js', import.meta.url), 'utf8');
const retailSource = await readFile(new URL('../../public/js/sellout-dashboard.js', import.meta.url), 'utf8');
const hubSource = await readFile(new URL('../../public/js/analytics-workspace.js', import.meta.url), 'utf8');
const portfolioHtml = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
const toolbar = portfolioHtml.slice(portfolioHtml.indexOf('<div class="toolbar-actions">'), portfolioHtml.indexOf('</header>', portfolioHtml.indexOf('<div class="toolbar-actions">')));
const productViewTools = portfolioHtml.slice(portfolioHtml.indexOf('aria-label="Product view controls"'),portfolioHtml.indexOf('id="resetLayout"'));
const savedViewButton = productViewTools.match(/<button\b(?=[^>]*\bid="savedViewsButton")[^>]*>([^<]*)<\/button>/)?.[0];
assert.ok(savedViewButton, 'Portfolio exposes Saved views with its zoom controls.');
assert.match(savedViewButton, />Saved views<\/button>$/, 'Saved views retains its full visible accessible text.');
assert.ok(!/\b(?:hidden|aria-hidden="true")\b/.test(savedViewButton));
assert.equal((portfolioHtml.match(/\bid="savedViewsButton"/g)||[]).length, 1, 'The visible trigger is not duplicated.');
assert.ok(productViewTools.indexOf(savedViewButton)>productViewTools.indexOf('id="zoomReset"'), 'Saved views follows the zoom controls.');
assert.match(toolbar, /id="workspaceSettingsButton"/, 'Settings remains directly available in the main toolbar.');
assert.doesNotMatch(portfolioHtml, /id="workflowMore"|id="workflowSettingsSlot"/, 'Settings requires no More menu.');
const json = value => JSON.parse(JSON.stringify(value));
const storage = () => { const data = new Map(); return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }; };
const window = {};
vm.runInNewContext(source, { globalThis: window, console, Date, Math });
const api = window.PPCSavedViews;
const device = storage(), store = api.createStore(device);
const secret = 'SOURCE AND CREDENTIAL FIXTURE MUST NEVER BE SAVED';
const preferences = { view: 'roadmap', basis: 'ffs', categoryIds: ['audio','audio','removed'], activeCategoryId: 'audio', dateRange: { start: '2026-01', end: '2028-12' }, search: 'launch',
  display: { labelMode: 'off', showSeasonalWindows: true, detailsOpen: true, showPrices: false, showSkus: true, productZoom: 0.7, roadmapZoom: 1.1, privateKey: secret },
  products: [{ id: secret }], workbook: secret, sourceUrl: secret, accessToken: secret, privateKey: secret };
const record = store.save('Quarterly launch review', 'portfolio', preferences);
assert.equal(record.preferences.display.labelMode, 'off');
assert.equal(record.preferences.display.productZoom, .7);
assert.deepEqual(json(record.preferences.categoryIds), ['audio','removed']);
assert.ok(!device.getItem(api.STORAGE_KEY).includes(secret), 'Named views never retain product facts, workbooks, source URLs, or credentials.');
preferences.search = 'mutated';
assert.equal(store.list()[0].preferences.search, 'launch', 'Saved state is independent of subsequent edits.');
assert.throws(() => store.save(' QUARTERLY LAUNCH REVIEW ', 'retail', {}), /already uses this name/);
assert.throws(() => store.rename(record.id, '\ninvalid'), /view name/);
store.rename(record.id, 'Launch review');
assert.equal(store.list()[0].name, 'Launch review');
assert.throws(() => store.save('x'.repeat(61), 'portfolio', {}), /view name/);
assert.throws(() => store.save('Unknown', 'untrusted', {}), /cannot be saved/);
const blueprint = store.save('Plan sensitivity', 'blueprint', { view: 'scenarios', year: '2027', category: 'Headsets', revenue: '8', margin: -2.5, spend: 200, scale: 'values', groupId: 'local-group', projectId: 'project-42', skuId: 'sku-1', compare: '["one","two","one"]', source: secret });
assert.equal(blueprint.preferences.revenue, 8);
assert.equal(blueprint.preferences.spend, 30);
assert.equal(blueprint.preferences.compare, '["one","two"]');
assert.equal(blueprint.preferences.projectId, 'project-42', 'Reviewed scope identities are supported as local preferences.');
const multipleCategories = Array.from({length:12}, (_, i) => `Peripheral category ${i}`).join(',');
assert.ok(multipleCategories.length > 80);
assert.equal(api.sanitizePreferences('blueprint', { category:multipleCategories }).category,multipleCategories,'Multiple Blueprint categories survive the child-supported CSV bound.');
assert.equal(api.sanitizePreferences('blueprint', { category:'x'.repeat(1201) }).category,undefined);
assert.equal(api.sanitizePreferences('blueprint', { category:'Audio\nInjection' }).category,undefined);
assert.ok(!device.getItem(api.STORAGE_KEY).includes(secret));
assert.equal(api.sanitizePreferences('blueprint', { compare: '{broken' }).compare, undefined);
const retail = api.sanitizePreferences('retail', { products: Array.from({length:700}, (_, i) => `sku-${i}`), storesNone: true, start: '2026-02-30', end: '2026-02-28', coverage: 'common', priceRows: secret });
assert.equal(retail.products.length, 500);
assert.equal(retail.start, undefined, 'Impossible calendar dates are discarded.');
assert.equal(retail.end, '2026-02-28');
assert.equal(retail.priceRows, undefined);
for (let i = store.list().length; i < api.MAX_VIEWS; i++) store.save(`View ${i}`, 'portfolio', {});
assert.equal(store.list().length, 25);
assert.throws(() => store.save('Overflow', 'portfolio', {}), /25 saved views/);
store.remove(record.id);
assert.equal(store.list().length, 24);
const malformed = storage(); malformed.setItem(api.STORAGE_KEY, '{broken'); malformed.setItem('portfolio-user-work', secret);
const recovering = api.createStore(malformed);
assert.equal(recovering.list().length, 0); assert.match(recovering.problem, /could not be read/);
assert.throws(() => recovering.save('Recovered', 'portfolio', {}), /Reset damaged/);
assert.equal(malformed.getItem(api.STORAGE_KEY), '{broken', 'Invalid storage is never silently overwritten.');
recovering.reset(); recovering.save('Recovered', 'portfolio', {});
assert.equal(malformed.getItem('portfolio-user-work'), secret, 'Explicit recovery removes only named-view preferences.');
malformed.setItem(api.STORAGE_KEY, 'x'.repeat(262145)); assert.equal(recovering.list().length, 0); assert.ok(recovering.problem);
const blocked = api.createStore({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } });
assert.equal(blocked.list().length, 0); assert.ok(blocked.problem);
const noWrites = api.createStore({ getItem() { return null; }, setItem() { throw new Error('quota'); } });
assert.throws(() => noWrites.save('Quota check', 'portfolio', {}), /could not save/);
const exportsDevice = storage();
assert.equal(api.saveExportPreferences({ scope: 'roadmap', categoryIds: ['audio','audio'], range: {start:'2026-01',end:'2027-12'}, mode:'merged', limitToFit:true, consent:true, truncationAcknowledged:true, privateKey:secret, products:secret }, exportsDevice), true);
assert.deepEqual(json(api.readExportPreferences(exportsDevice)), { scope:'roadmap',categoryIds:['audio'],range:{start:'2026-01',end:'2027-12'},mode:'merged' });
assert.ok(!exportsDevice.getItem(api.EXPORT_KEY).includes('limitToFit'));
assert.ok(!exportsDevice.getItem(api.EXPORT_KEY).includes('consent'));
assert.ok(!exportsDevice.getItem(api.EXPORT_KEY).includes(secret));
exportsDevice.setItem(api.EXPORT_KEY, '{broken'); assert.deepEqual(json(api.readExportPreferences(exportsDevice)), {});

// Execute the real Retail preference functions against a changing source identity set.
const nodes = new Map();
for (const id of ['categoryFilter','bandFilter','comparison','coverage','trendMode','periodPreset','startDate','endDate']) nodes.set(id, { value: '' });
const retailState = { snapshot:{id:'RETAIN CURRENT SOURCE'},stores:[],products:[],storesNone:false,productsNone:false,view:'overview',hiddenSeries:new Set(),markerDate:'old',hoverDate:'old' };
let updates = 0, stops = 0;
const retailWindow = { PPCSavedViews:api };
const retailFunctions = retailSource.slice(retailSource.lastIndexOf('  function captureView()'), retailSource.indexOf('  root.PPCSelloutDashboard.ready ='));
vm.runInNewContext(retailFunctions, { root:retailWindow,state:retailState,$:id=>nodes.get(id),M:{options:()=>({stores:['Amazon'],products:[{sku:'sku-current'}],categories:['Audio'],start:'2026-01-04',end:'2026-10-04'})},
  stopTimeline(){stops++;},controls(){},update(){updates++;},showView(view){retailState.view=view;},applySnapshot(){},readImport(){},workspace(){},setActive(){},console });
const unchangedSource = retailState.snapshot;
let result = retailWindow.PPCSelloutDashboard.applyView({view:'records',stores:['gone-store'],products:['gone-sku'],category:'gone-category',preset:'custom',start:'2025-01-01',end:'2027-01-01',coverage:'available',comparison:'none',trend:'products'});
assert.equal(retailState.snapshot, unchangedSource);
assert.equal(retailState.storesNone,true); assert.equal(retailState.productsNone,true);
assert.equal(nodes.get('categoryFilter').value,'');
assert.equal(nodes.get('startDate').value,'2026-01-04'); assert.equal(nodes.get('endDate').value,'2026-10-04');
assert.equal(retailState.view,'records'); assert.match(result.message,/3 unavailable/);
result = retailWindow.PPCSelloutDashboard.applyView({stores:['Amazon','gone-store'],products:['sku-current'],category:'Audio',preset:'13'});
assert.deepEqual(json(retailState.stores),['Amazon']); assert.deepEqual(json(retailState.products),['sku-current']);
assert.equal(retailState.storesNone,false); assert.equal(retailState.productsNone,false); assert.equal(updates,2); assert.equal(stops,2);
const capturedRetail = retailWindow.PPCSelloutDashboard.captureView(); assert.equal(capturedRetail.category,'Audio'); assert.ok(!JSON.stringify(capturedRetail).includes('RETAIN CURRENT SOURCE'));
retailState.snapshot = null;
assert.throws(()=>retailWindow.PPCSelloutDashboard.captureView(),/Load a Retail workbook/);
assert.throws(()=>retailWindow.PPCSelloutDashboard.applyView({}),/Load a Retail workbook/);

// Run the actual shell to verify saved Blueprint preferences reuse its retained frame.
function node(dataset = {}) { const attrs = new Map(), events = new Map(); return {dataset,hidden:false,style:{},setAttribute(k,v){attrs.set(k,String(v));},getAttribute(k){return attrs.get(k)??null;},removeAttribute(k){attrs.delete(k);},addEventListener(k,f){events.set(k,f);},emit(k,e={}){events.get(k)?.(e);},focus(){}}; }
const frame = node({src:'blueprint/index.html?embedded=1'}), posts = []; let loads = 0;
frame.contentWindow = { postMessage(value,origin){posts.push({value:json(value),origin});} };
Object.defineProperty(frame,'src',{get(){return frame.getAttribute('src');},set(value){loads++;frame.setAttribute('src',value);}});
const tabNodes = [node({analysisModule:'retail'}),node({analysisModule:'blueprint'})];
const lookup = new Map([['selloutApp',node()],['blueprintPane',node()],['blueprintFrame',frame],['blueprintLoading',node()],['blueprintSource',node()],['blueprintImport',node()]]);
const doc = { getElementById:id=>lookup.get(id),querySelectorAll:selector=>selector==='[data-analysis-module]'?tabNodes:[],currentScript:{src:'https://example.test/js/analytics-workspace.js'} };
const hub = {PPCSavedViews:api,PPCSelloutDashboard:{ready:Promise.resolve(),setActive(){},captureView:()=>({view:'overview'}),applyView:()=>({message:'retail applied'})},location:new URL('https://example.test/analytics.html'),addEventListener(){},history:{pushState(_a,_b,url){hub.location=new URL(url);},replaceState(_a,_b,url){hub.location=new URL(url);}}};
vm.runInNewContext(hubSource,{globalThis:hub,document:doc,URL,URLSearchParams,console});
assert.equal(hub.PPCAnalyticsWorkspace.getKind(),'retail');
hub.PPCAnalyticsWorkspace.switchModule('blueprint'); frame.emit('load');
const frameUrl = frame.src;
await hub.PPCAnalyticsWorkspace.applyView({view:'scenarios',year:'2027',category:multipleCategories,scale:'values',revenue:8,margin:-2,spend:5,groupId:'group',projectId:'project',skuId:'sku',compare:'["one"]',sourceRows:secret},'blueprint');
assert.equal(loads,1); assert.equal(frame.src,frameUrl,'Applying a saved view never reloads the current source.');
const command = posts.at(-1).value;
assert.equal(command.view,'scenarios'); assert.equal(command.preferences.projectId,'project'); assert.equal(command.preferences.revenue,8);
assert.equal(command.preferences.category,multipleCategories); assert.equal(hub.location.searchParams.get('category'),multipleCategories);
assert.equal(command.preferences.sourceRows,undefined); assert.ok(!JSON.stringify(posts).includes(secret));
assert.equal(hub.PPCAnalyticsWorkspace.captureView().view,'scenarios');
await hub.PPCAnalyticsWorkspace.applyView({},'retail'); assert.equal(hub.PPCAnalyticsWorkspace.currentModule,'retail');
await assert.rejects(hub.PPCAnalyticsWorkspace.applyView({},'portfolio'),/another workspace/);

assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(|sendBeacon\s*\(/.test(source),'Saved preferences never create network calls.');

// Exercise the actual PPTX dialog helpers and submit callback with isolated controls.
const appSource = await readFile(new URL('../../public/js/app.js', import.meta.url), 'utf8');
const paginationSource = await readFile(new URL('../../public/js/pptx-pagination.js', import.meta.url), 'utf8');
const exportStorage = storage(), exportEvents = new Map(), shortcutButtons = [], exportControls = new Map();
const control = (value = '') => ({value,checked:false,disabled:false,textContent:'',classList:{toggle(){},add(){},remove(){},contains(){return false;}},focus(){},addEventListener(name,fn){this[name]=fn;}});
const scopes = ['products','roadmap','both'].map(value=>({...control(value),checked:value==='both'}));
const layouts = ['categories','merged'].map(value=>({...control(value),checked:value==='categories'}));
for (const id of ['pptxRoadmapStart','pptxRoadmapEnd','pptxRoadmapLimit','pptxExportCategoryCount','pptxExportSlideCount','pptxSelectAllCategories','pptxExportSelectionHint']) exportControls.set('#'+id,control());
const shortcuts = {append(button){shortcutButtons.push(button);}};
let categoryControls = [];
const categoryContainer = {};
Object.defineProperty(categoryContainer,'innerHTML',{set(html){categoryControls=[...html.matchAll(/name="pptxExportCategory" value="([^"]+)"( checked)?/g)].map(match=>({...control(match[1]),checked:Boolean(match[2])}));}});
exportControls.set('#pptxExportCategories',categoryContainer);
exportControls.set('.pptx-category-shortcuts',shortcuts);
const exportForm = {
  querySelector(selector) {
    if (selector==='input[name="pptxExportScope"]:checked') return scopes.find(input=>input.checked);
    if (selector==='input[name="pptxRoadmapLayout"]:checked') return layouts.find(input=>input.checked);
    if (selector==='#pptxUseCurrentView') return shortcutButtons.find(button=>button.id==='pptxUseCurrentView');
    return exportControls.get(selector)||null;
  },
  querySelectorAll(selector) {
    if (selector==='input[name="pptxExportScope"]') return scopes;
    if (selector==='input[name="pptxRoadmapLayout"]') return layouts;
    if (selector==='input[name="pptxExportCategory"]') return categoryControls;
    if (selector==='input[name="pptxExportCategory"]:checked') return categoryControls.filter(input=>input.checked);
    if (selector==='input, button') return [...scopes,...layouts,...categoryControls,...shortcutButtons,...exportControls.values()].filter(input=>'disabled'in input);
    return [];
  },
  addEventListener(name,callback){exportEvents.set(name,callback);},
};
let hidden = true, failExport = false, completedExports = 0, saveCalls = 0, hashoutScope = ['audio'], dedicated = false;
const isolatedExport = {
  console:{error(){}}, document:{activeElement:null,querySelector:()=>({inert:false}),createElement:()=>control()},
  pptxExportForm:exportForm,pptxExportDialog:{classList:{add(){hidden=true;},remove(){hidden=false;},contains(){return hidden;}}},
  confirmPptxExportButton:control(),pptxExportInProgress:false,pptxSelectedCategoryIds:null,pptxReturnFocus:null,
  portfolio:{categories:[{id:'audio',name:'Audio',board:{products:[]}},{id:'video',name:'Video',board:{products:[]}}]},
  board:{settings:{roadmap:{startMonth:'2026-01',endMonth:'2027-12'}}},activeCategoryId:'audio',activeView:'products',
  $:selector=>selector==='#workspaceEmpty'?{inert:false}:exportControls.get(selector), escapeHtml:value=>value,
  stopProductCardDrag(){},closePopupMenus(){},hasDedicatedHashoutView:()=>dedicated,hashoutCategoryScope:()=>hashoutScope,requestAnimationFrame:fn=>fn(),
  buildPptxExportPlan(_scope,categories,options){const plan=categories.map(category=>category.id);plan.roadmapPlan={requiresDecision:false};return plan;},
  PortfolioWorkflowAdapter:{captureView:()=>({dateRange:{start:'2027-02',end:'2028-04'}})},
  PortfolioDialogs:{alert(){}},
  async exportPptx(){if(failExport)throw new Error('delivery failed');completedExports++;},
  PPCSavedViews:{readExportPreferences:()=>api.readExportPreferences(exportStorage),saveExportPreferences:value=>{saveCalls++;return api.saveExportPreferences(value,exportStorage);}},
  PPTXExportPlanner:{readOptions:form=>({mode:form.querySelector('input[name="pptxRoadmapLayout"]:checked')?.value||'categories',startMonth:form.querySelector('#pptxRoadmapStart').value,endMonth:form.querySelector('#pptxRoadmapEnd').value,limitToFit:form.querySelector('#pptxRoadmapLimit').checked}),syncDialog(){}},
};
isolatedExport.globalThis=isolatedExport;
vm.createContext(isolatedExport); vm.runInContext(paginationSource,isolatedExport);
vm.runInContext(appSource.slice(appSource.indexOf('function pptxExportScope()'),appSource.indexOf('function pptxExportFilename(')),isolatedExport);
const submitStart=appSource.indexOf('pptxExportForm.addEventListener("submit", async (event) => {');
vm.runInContext(appSource.slice(submitStart,appSource.indexOf('$("#closePptxExport").onclick',submitStart)),isolatedExport);
exportControls.get('#pptxRoadmapLimit').checked=true;
isolatedExport.openPptxExportDialog();
assert.equal(exportControls.get('#pptxRoadmapLimit').checked,false,'Every open resets partial-export consent.');
assert.deepEqual(json(isolatedExport.pptxExportCategories().map(category=>category.id)),['audio','video'],'No saved preferences preserves the original all-category default.');
assert.equal(shortcutButtons.length,1); assert.equal(shortcutButtons[0].textContent,'Use this view');
isolatedExport.closePptxExportDialog();
api.saveExportPreferences({scope:'roadmap',categoryIds:['gone-category'],range:{start:'2027-01',end:'2028-12'},mode:'merged'},exportStorage);
isolatedExport.openPptxExportDialog();
assert.equal(isolatedExport.pptxExportCategories().length,0,'A removed saved category never expands to all categories.');
assert.equal(isolatedExport.confirmPptxExportButton.disabled,true);
assert.equal(isolatedExport.pptxExportScope(),'roadmap'); assert.equal(layouts.find(input=>input.checked).value,'merged');
assert.equal(exportControls.get('#pptxRoadmapStart').value,'2027-01'); assert.equal(shortcutButtons.length,1,'Repeated opens do not duplicate the shortcut.');
exportControls.get('#pptxRoadmapLimit').checked=true;
isolatedExport.useCurrentViewForPptx();
assert.equal(isolatedExport.pptxExportScope(),'products'); assert.deepEqual(json(isolatedExport.pptxExportCategories().map(category=>category.id)),['audio']);
assert.equal(exportControls.get('#pptxRoadmapStart').value,'2027-02'); assert.equal(exportControls.get('#pptxRoadmapEnd').value,'2028-04');
assert.equal(exportControls.get('#pptxRoadmapLimit').checked,false,'Use this view clears earlier cutoff decisions.');
dedicated=true;isolatedExport.activeView='roadmap';hashoutScope=[];
isolatedExport.useCurrentViewForPptx(); assert.equal(isolatedExport.pptxExportCategories().length,0,'An explicitly empty Hashout scope stays empty.');
hashoutScope=null; isolatedExport.useCurrentViewForPptx(); assert.equal(isolatedExport.pptxExportCategories().length,2,'Null Hashout scope means all current categories.');
exportControls.get('#pptxRoadmapLimit').checked=true;
await exportEvents.get('submit')({preventDefault(){}});
assert.equal(completedExports,1); assert.equal(saveCalls,1);
assert.equal(api.readExportPreferences(exportStorage).scope,'roadmap'); assert.equal(api.readExportPreferences(exportStorage).categoryIds,null);
assert.ok(!exportStorage.getItem(api.EXPORT_KEY).includes('limitToFit'),'Successful partial export still does not remember cutoff consent.');
isolatedExport.openPptxExportDialog(); assert.equal(exportControls.get('#pptxRoadmapLimit').checked,false);
failExport=true; await exportEvents.get('submit')({preventDefault(){}}); assert.equal(saveCalls,1,'Failed export never overwrites reusable preferences.');
console.log('Saved view checks passed: bounded local schemas, save/rename/delete/recovery, privacy, Retail stale identities, retained Analytics source and successful-export-only reusable PPTX preferences with fresh cutoff decisions.');
