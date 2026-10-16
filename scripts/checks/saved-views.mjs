import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
await import('../../public/js/date-precision.js');
await import('../../public/js/portfolio-model.js');

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
// Multicategory visibility is a narrow portfolio preference, never a product or
// category data envelope. Sanitation is deterministic and makes fresh objects.
const visibilityInput = [
  { categoryId:'audio',catalogGroup:'all',hideDiscontinued:true,products:[secret],privateKey:secret },
  { categoryId:'pc',catalogGroup:'unreleased' },
  { categoryId:'mics',hideDiscontinued:true },
  { categoryId:'controllers',hideDiscontinued:false },
  { categoryId:'undefined-option',catalogGroup:undefined,hideDiscontinued:true },
];
const visibilityBefore = JSON.stringify(visibilityInput);
const visibilityExpected = [
  {categoryId:'audio',catalogGroup:'all'}, {categoryId:'pc',catalogGroup:'unreleased'},
  {categoryId:'mics',hideDiscontinued:true}, {categoryId:'controllers',hideDiscontinued:false},
  {categoryId:'undefined-option',hideDiscontinued:true},
];
const visibility = api.sanitizePreferences('portfolio',{view:'roadmap',basis:'ffs',categoryVisibility:visibilityInput,display:{catalogGroup:'eol'}});
assert.deepEqual(json(visibility.categoryVisibility),visibilityExpected,'Explicit group wins over legacy flag, and boolean-only entries survive.');
assert.equal(visibility.display.catalogGroup,'eol','Existing active-category display preference remains backward compatible.');
assert.equal(JSON.stringify(visibilityInput),visibilityBefore,'Sanitizing category visibility never changes source input.');
assert.notEqual(visibility.categoryVisibility,visibilityInput); assert.notEqual(visibility.categoryVisibility[0],visibilityInput[0]);
assert.deepEqual(json(api.sanitizePreferences('portfolio',visibility)),json(visibility),'The normalized schema is idempotent.');
for(const catalogGroup of ['all','launched','unreleased','eol'])assert.deepEqual(json(api.sanitizePreferences('portfolio',{categoryVisibility:[{categoryId:'exact',catalogGroup}]}).categoryVisibility),[{categoryId:'exact',catalogGroup}]);
for(const categoryId of ['', '   ',null,false,123,'x'.repeat(241),'Audio\nInjection','Audio\u0000Injection','Audio\u007fInjection'])assert.deepEqual(json(api.sanitizePreferences('portfolio',{categoryVisibility:[{categoryId,catalogGroup:'all'}]}).categoryVisibility),[]);
assert.equal(api.sanitizePreferences('portfolio',{categoryVisibility:[{categoryId:'x'.repeat(240),catalogGroup:'launched'}]}).categoryVisibility[0].categoryId.length,240);
for(const malformed of [null,false,1,'audio',[],{}, {categoryId:'empty'}, {categoryId:'bad',catalogGroup:'ALL'}, {categoryId:'bad',catalogGroup:'unknown'}, {categoryId:'bad',catalogGroup:'constructor'}, {categoryId:'bad',catalogGroup:null}, {categoryId:'bad',hideDiscontinued:'true'}, {categoryId:'bad',hideDiscontinued:null}, {categoryId:'bad',catalogGroup:'all',hideDiscontinued:'false'}, Object.create({categoryId:'inherited',catalogGroup:'all'})])assert.deepEqual(json(api.sanitizePreferences('portfolio',{categoryVisibility:[malformed]}).categoryVisibility),[],'Malformed entries are rejected rather than retaining arbitrary blobs.');
for(const malformed of [null,false,'[]',{},1])assert.equal(api.sanitizePreferences('portfolio',{categoryVisibility:malformed}).categoryVisibility,undefined,'Nonarray visibility is omitted.');
assert.deepEqual(json(api.sanitizePreferences('portfolio',{categoryVisibility:[]}).categoryVisibility),[],'An explicit empty array remains distinct from an older absent preference.');
assert.deepEqual(json(api.sanitizePreferences('portfolio',{categoryVisibility:[
  {categoryId:'same',catalogGroup:'bad'}, {categoryId:'same',catalogGroup:'launched'}, {categoryId:'same',catalogGroup:'eol'},
  {categoryId:'legacy',hideDiscontinued:true}, {categoryId:'legacy',catalogGroup:'all'},
]}).categoryVisibility),[{categoryId:'same',catalogGroup:'launched'},{categoryId:'legacy',hideDiscontinued:true}],'First valid exact category identity wins; invalid earlier duplicates do not reserve it.');
const manyVisibility = Array.from({length:205},(_,index)=>({categoryId:`category-${index}`,catalogGroup:'all'}));
assert.equal(api.sanitizePreferences('portfolio',{categoryVisibility:manyVisibility}).categoryVisibility.length,200);
assert.equal(api.sanitizePreferences('portfolio',{categoryVisibility:manyVisibility}).categoryVisibility.at(-1).categoryId,'category-199','Only the first bounded input window is inspected.');
const dangerous = JSON.parse('{"categoryId":"safe","catalogGroup":"eol","__proto__":{"polluted":true},"constructor":{"privateKey":"'+secret+'"},"prototype":{"products":["'+secret+'"]}}');
assert.deepEqual(json(api.sanitizePreferences('portfolio',{categoryVisibility:[dangerous]}).categoryVisibility),[{categoryId:'safe',catalogGroup:'eol'}]);
assert.equal(Object.prototype.polluted,undefined); assert.equal(api.sanitizePreferences('retail',{categoryVisibility:visibilityInput}).categoryVisibility,undefined); assert.equal(api.sanitizePreferences('blueprint',{categoryVisibility:visibilityInput}).categoryVisibility,undefined);
const visibilityDevice = storage(), visibilityStore = api.createStore(visibilityDevice);
const visibilityRecord = visibilityStore.save('Cross-category FFS','portfolio',{view:'roadmap',basis:'ffs',categoryIds:['audio','pc'],categoryVisibility:visibilityInput,display:{catalogGroup:'all'}});
assert.deepEqual(json(api.createStore(visibilityDevice).list()[0].preferences.categoryVisibility),visibilityExpected,'New per-category preferences survive real local-store save and reload.');
assert.ok(!visibilityDevice.getItem(api.STORAGE_KEY).includes(secret),'No source facts or credentials leak through per-category entries.');
visibilityInput[0].catalogGroup='unreleased'; visibilityInput.push({categoryId:'later',catalogGroup:'all'});
assert.deepEqual(json(visibilityStore.list()[0].preferences.categoryVisibility),visibilityExpected,'Saved arrays do not alias later capture edits.');
visibilityStore.rename(visibilityRecord.id,'Retained cross-category FFS');
assert.deepEqual(json(visibilityStore.list()[0].preferences.categoryVisibility),visibilityExpected,'Renaming does not discard category visibility.');
const oldVisibilityDevice=storage();
oldVisibilityDevice.setItem(api.STORAGE_KEY,JSON.stringify({version:1,views:[{id:'legacy',name:'Legacy view',kind:'portfolio',preferences:{view:'products',display:{catalogGroup:'unreleased',hideDiscontinued:true}}}]}));
const oldVisibility=api.createStore(oldVisibilityDevice).list()[0].preferences;
assert.equal(oldVisibility.categoryVisibility,undefined); assert.equal(oldVisibility.display.catalogGroup,'unreleased'); assert.equal(oldVisibility.display.hideDiscontinued,true,'Older saved preferences remain exactly compatible.');
assert.deepEqual(json(api.sanitizePreferences('portfolio',{view:'roadmap',basis:'ffs'})),{view:'roadmap',basis:'ffs'},'Opening an old view does not manufacture a category-visibility override.');
// Multi-selection is a bounded preference array, not a product-data envelope.
const selectionInput = ['embargo','launched','in-development','launched'];
const multiInput = { view:'roadmap', categoryVisibility:[
  {categoryId:'audio',catalogGroups:selectionInput,catalogGroup:'eol',hideDiscontinued:true,products:[secret]},
  {categoryId:'none',catalogGroups:[]}, {categoryId:'reset',catalogGroups:['all']},
], display:{catalogGroups:selectionInput,catalogGroup:'unreleased',hideDiscontinued:true} };
const multiBefore = JSON.stringify(multiInput), multi = api.sanitizePreferences('portfolio',multiInput);
assert.deepEqual(json(multi.categoryVisibility), [
  {categoryId:'audio',catalogGroups:['launched','in-development','embargo']},
  {categoryId:'none',catalogGroups:[]}, {categoryId:'reset',catalogGroups:['all']},
], 'new arrays take precedence and canonicalize without retaining contradictory category flags');
assert.deepEqual(json(multi.display.catalogGroups),['launched','in-development','embargo']);
assert.equal(multi.display.catalogGroup,'unreleased','old display properties remain backward compatible alongside the authoritative new array');
assert.equal(multi.display.hideDiscontinued,true);
assert.equal(JSON.stringify(multiInput),multiBefore); assert.notEqual(multi.categoryVisibility[0].catalogGroups,selectionInput);
assert.deepEqual(json(api.sanitizePreferences('portfolio',multi)),json(multi),'multi-selection normalization is idempotent');
for(const group of globalThis.PortfolioModel.CATALOG_VISIBILITY_GROUPS) {
  assert.deepEqual(json(api.sanitizePreferences('portfolio',{categoryVisibility:[{categoryId:'one',catalogGroups:[group]}]}).categoryVisibility),[{categoryId:'one',catalogGroups:[group]}]);
}
for(const malformed of [null,false,{},'launched',['unknown'],['all','launched'],[undefined],Array(1),Array(33).fill('all')]) {
  assert.deepEqual(json(api.sanitizePreferences('portfolio',{categoryVisibility:[{categoryId:'one',catalogGroups:malformed,catalogGroup:'all'}]}).categoryVisibility),[], 'invalid supplied arrays reject the category entry rather than silently changing its meaning');
  assert.equal(api.sanitizePreferences('portfolio',{display:{catalogGroups:malformed}}).display.catalogGroups,undefined);
}
assert.deepEqual(json(api.sanitizePreferences('portfolio',{categoryVisibility:[
  {categoryId:'same',catalogGroups:['bad']},{categoryId:'same',catalogGroups:[]},{categoryId:'same',catalogGroups:['all']},
]}).categoryVisibility),[{categoryId:'same',catalogGroups:[]}], 'the first valid none selection reserves its exact category identity');
assert.deepEqual(json(api.sanitizePreferences('portfolio',{categoryVisibility:[{categoryId:'stale',catalogGroups:['launched'],catalogGroup:'bad',hideDiscontinued:'bad'}]}).categoryVisibility),[{categoryId:'stale',catalogGroups:['launched']}], 'valid new selection is independent of stale older fields');
const multiDevice=storage(),multiStore=api.createStore(multiDevice),multiRecord=multiStore.save('Released and development','portfolio',multiInput);
const multiSaved=json(multiRecord.preferences); selectionInput.push('eol'); multiInput.categoryVisibility[1].catalogGroups.push('eol');
assert.deepEqual(json(api.createStore(multiDevice).list()[0].preferences),multiSaved,'real local persistence preserves independent canonical multi-selection arrays');
assert.ok(!multiDevice.getItem(api.STORAGE_KEY).includes(secret));
const inverseInput = { categoryVisibility:[
  {categoryId:'all-except',catalogGroups:['all'],catalogExcludedGroups:['eol','embargo','eol'],source:[secret]},
  {categoryId:'inactive',catalogGroups:['launched'],catalogExcludedGroups:['eol']},
  {categoryId:'clear',catalogGroups:['all'],catalogExcludedGroups:[]},
], display:{catalogGroups:['all'],catalogExcludedGroups:['eol','embargo','eol']} };
const inverseBefore=JSON.stringify(inverseInput), inverse=api.sanitizePreferences('portfolio',inverseInput);
assert.deepEqual(json(inverse.categoryVisibility),[
  {categoryId:'all-except',catalogGroups:['all'],catalogExcludedGroups:['embargo','eol']},
  {categoryId:'inactive',catalogGroups:['launched'],catalogExcludedGroups:['eol']},
  {categoryId:'clear',catalogGroups:['all'],catalogExcludedGroups:[]},
],'inverse filters preserve their All base, canonical copied concrete exclusions and inactive preferences');
assert.deepEqual(json(inverse.display.catalogExcludedGroups),['embargo','eol']);
assert.equal(JSON.stringify(inverseInput),inverseBefore); assert.notEqual(inverse.categoryVisibility[0].catalogExcludedGroups,inverseInput.categoryVisibility[0].catalogExcludedGroups);
assert.deepEqual(json(api.sanitizePreferences('portfolio',inverse)),json(inverse),'inverse normalization is idempotent');
for(const group of ['launched','in-development','in-planning','embargo','unreleased','eol'])assert.deepEqual(json(api.sanitizePreferences('portfolio',{display:{catalogGroups:['all'],catalogExcludedGroups:[group]}}).display.catalogExcludedGroups),[group]);
for(const malformed of [null,false,'eol',{},['all'],['eol','all'],['unknown'],['constructor'],[undefined],Array(1),Array(33).fill('eol'),[{privateKey:secret}]]) {
  assert.deepEqual(json(api.sanitizePreferences('portfolio',{categoryVisibility:[{categoryId:'bad',catalogGroups:['all'],catalogExcludedGroups:malformed}]}).categoryVisibility),[],'invalid supplied inverse arrays reject a category preference');
  assert.equal(api.sanitizePreferences('portfolio',{display:{catalogGroups:['all'],catalogExcludedGroups:malformed}}).display.catalogExcludedGroups,undefined);
}
assert.deepEqual(json(api.sanitizePreferences('portfolio',{categoryVisibility:[{categoryId:'bare',catalogExcludedGroups:['eol']}]}).categoryVisibility),[],'an exclusion is not a standalone category visibility choice');
assert.equal(api.sanitizePreferences('portfolio',{display:{catalogGroup:'unreleased'}}).display.catalogExcludedGroups,undefined,'old saved views do not acquire exclusions');
const inverseDevice=storage(),inverseStore=api.createStore(inverseDevice),inverseSaved=json(inverseStore.save('All except EOL','portfolio',inverseInput).preferences);
inverseInput.categoryVisibility[0].catalogExcludedGroups.push('launched'); inverseInput.display.catalogExcludedGroups.length=0;
assert.deepEqual(json(api.createStore(inverseDevice).list()[0].preferences),inverseSaved,'inverse choices survive local save/reload and never alias mutable input');
assert.ok(!inverseDevice.getItem(api.STORAGE_KEY).includes(secret));
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
  PortfolioModel:globalThis.PortfolioModel,
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
console.log('Saved view checks passed: bounded multicategory visibility/first-valid identities/group precedence/legacy round trips, local schemas, save/rename/delete/recovery, privacy, Retail stale identities, retained Analytics source and successful-export-only reusable PPTX preferences with fresh cutoff decisions.');
