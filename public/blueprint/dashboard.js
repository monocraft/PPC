(function () {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const colors = ['#895EF6', '#6984ED', '#4DA1F7', '#20CBDD', '#7AE3A9', '#FFC63B'];
  const state = { view: 'overview', period: null, category: ['all'], groupId: null, projectId: null, skuId: null, compareIds: [], drillQuery: '', metric: 'revenue', query: '', sheetQuery: '', sort: 'revenue', revenueGrowth: 0, marginChange: 0, budgetChange: 0, forecast: false, decisionAction:'all' };
  let timelineControl, categoryControl, workspaceControl, sourceWasLoaded = false, startupComplete = false, importBusy = false, pendingImport = false, activeDrill = null, comparisonModels = new Map();
  Object.assign(state, {metrics:['revenue'],connectivity:['all'],productSort:'revenue',sortDirection:'desc',overlay:null,scenarioEnabled:false,scenarioStart:null});
  function applyWorkspace(value) {
    try {
      const next=typeof value==='string'?JSON.parse(value):value;if(!next||typeof next!=='object')return;
      if(Array.isArray(next.metrics)&&next.metrics.length&&next.metrics.every(key=>['revenue','units','grossProfit','budget'].includes(key)))state.metrics=[...new Set(next.metrics)];
      if(Array.isArray(next.connectivity)&&next.connectivity.length&&next.connectivity.every(key=>['all','wired','wireless','both','unclassified'].includes(key)))state.connectivity=[...new Set(next.connectivity)];
      if(['name','connectivity','revenue','grossProfit','grossMargin','units','budget'].includes(next.productSort))state.productSort=next.productSort;
      if(['asc','desc'].includes(next.sortDirection))state.sortDirection=next.sortDirection;
      if([null,'insights','decisions','scenarios','evidence','source'].includes(next.overlay))state.overlay=next.overlay;
      if(typeof next.scenarioEnabled==='boolean')state.scenarioEnabled=next.scenarioEnabled;
      if(/^\d{4}$/.test(String(next.scenarioStart)))state.scenarioStart=String(next.scenarioStart);
    }catch(_){}
  }
  const workspacePreference=()=>JSON.stringify({metrics:state.metrics,connectivity:state.connectivity,productSort:state.productSort,sortDirection:state.sortDirection,overlay:state.overlay,scenarioEnabled:state.scenarioEnabled,scenarioStart:state.scenarioStart});
  function locationPreferences() {
    const preferences = new URLSearchParams(location.search), fragment = new URLSearchParams(location.hash.split('?').slice(1).join('?'));
    for (const key of ['groupId', 'projectId', 'skuId', 'compare','workspace']) { if (fragment.has(key)) preferences.set(key, fragment.get(key)); else if (!preferences.has(key)) preferences.set(key, ''); }
    return preferences;
  }
  const fragmentView = () => location.hash.slice(1).split('?')[0];
  const initialPreferences = locationPreferences();
  applyWorkspace(initialPreferences.get('workspace'));
  state.comparisonScale = initialPreferences.get('scale') === 'trend' ? 'trend' : 'values';
  const embedded = initialPreferences.get('embedded') === '1';
  state.period = initialPreferences.get('year') || null;
  state.category = (initialPreferences.get('category') || 'all').split(',').map(value => value.trim()).filter(Boolean);
  const scopeId = value => typeof value === 'string' && value.length <= 240 && !/[\u0000-\u001f\u007f]/.test(value) ? value || null : null;
  function parseCompare(value) { try { const ids = typeof value === 'string' ? value ? JSON.parse(value) : [] : value; return Array.isArray(ids) && ids.length <= 50 && ids.every(id => scopeId(id)) ? [...new Set(ids)] : []; } catch (_) { return []; } }
  for (const key of ['groupId', 'projectId', 'skuId']) state[key] = scopeId(initialPreferences.get(key));
  state.compareIds = parseCompare(initialPreferences.get('compare'));
  function scopeFragment(view = state.view) { const scope = new URLSearchParams(); for (const key of ['groupId', 'projectId', 'skuId']) if (state[key]) scope.set(key, state[key]); if (state.compareIds?.length) scope.set('compare', JSON.stringify(state.compareIds)); scope.set('workspace',workspacePreference()); return `${view}${scope.size ? '?' + scope : ''}`; }
  for (const [parameter, key, min, max] of [['revenue', 'revenueGrowth', -30, 30], ['margin', 'marginChange', -10, 10], ['spend', 'budgetChange', -30, 30]]) {
    const raw = initialPreferences.get(parameter), value = Number(raw);
    if (raw !== null && Number.isFinite(value)) state[key] = Math.max(min, Math.min(max, value));
  }
  const hasSource = () => Boolean(window.HX_DATA?.products?.length && window.HX_DATA?.periods?.length);
  function notifyParent() {
    const query = new URLSearchParams(location.search);
    for (const key of ['groupId', 'projectId', 'skuId', 'compare','workspace']) query.delete(key);
    for (const [key, value] of Object.entries({ year: state.period, category: state.category.join(','), scale: state.comparisonScale, revenue: state.revenueGrowth, margin: state.marginChange, spend: state.budgetChange })) {
      if (value === null) query.delete(key); else query.set(key, String(value));
    }
    history.replaceState(null, '', `${location.pathname}?${query}#${scopeFragment()}`);
    if (embedded && window.parent !== window) window.parent.postMessage({ type: 'ppc:blueprint:state', state: { view: state.view, year: state.period, category: state.category.join(','), scale: state.comparisonScale, groupId: state.groupId || '', projectId: state.projectId || '', skuId: state.skuId || '', compare: JSON.stringify(state.compareIds || []),workspace:workspacePreference(), revenue: state.revenueGrowth, margin: state.marginChange, spend: state.budgetChange }, sourceLabel: window.HX_DATA?.source?.name || 'No workbook loaded' }, location.origin);
  }
  function requestImport() {
    if (!startupComplete) { pendingImport = true; return; }
    if (!importBusy) $('#import-file').click();
  }
  const views = {
    overview: ['BUSINESS AT A GLANCE', 'Portfolio overview', 'A clear view of performance, opportunity, and what comes next.'],
    performance: ['UNDERSTAND THE DRIVERS', 'Performance & growth', 'Follow the workbook plan, compare targets, and inspect the evidence.'],
    products: ['FROM PIPELINE TO IMPACT', 'Products & NPI', 'See the products behind the numbers and where new ideas add value.'],
    investment: ['PUT RESOURCES IN CONTEXT', 'Investment & allocation', 'Connect product investment to the opportunity it is intended to create.'],
    scenarios: ['EXPLORE THE POSSIBILITIES', 'Growth scenarios', 'Adjust a few clear drivers and see how they change the selected baseline.'],
    source: ['TRANSPARENT BY DESIGN', 'Source & data quality', 'Every tab has a purpose. Every figure should have a traceable source.'
    ]
  };
  const paths = {
    overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    performance: '<path d="M3 18V6M3 18h18M6 14l5-5 4 3 6-7"/><path d="M17 5h4v4"/>',
    products: '<path d="m12 3 9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v8M7 5.8l9 5"/>',
    investment: '<path d="M3 20h18M6 20V10h4v10M14 20V5h4v15M3 5l4-2 3 2M7 3v4"/>',
    scenarios: '<path d="M4 7h16M4 17h16M8 4v6M16 14v6"/><circle cx="8" cy="7" r="2" fill="currentColor" stroke="none"/><circle cx="16" cy="17" r="2" fill="currentColor" stroke="none"/>',
    source: '<path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h6"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
    upload: '<path d="M12 16V3M7 8l5-5 5 5M4 15v6h16v-6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.2"/>',
    arrow: '<path d="M4 16 16 4M7 4h9v9"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/>',
    warning: '<path d="m12 3 10 18H2zM12 9v5M12 17v.2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>'
  };
  function icon(key) { return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[key] || paths.info}</svg>`; }
  function escape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function num(value) { if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
  function finite(value) { return num(value) !== null; }
  function sum(values) { const valid = values.map(num).filter(v => v !== null); return valid.length ? valid.reduce((a, b) => a + b, 0) : null; }
  function fmt(value, unit = 'currency', precise = false) {
    const n = num(value); if (n === null) return '—';
    if (unit === 'percent' || unit === '%') return `${(n * 100).toFixed(precise ? 2 : 1)}%`;
    if (n !== 0 && Math.abs(n) < 1) {
      const numeric = unit === 'number' || unit === 'count' || unit === 'units';
      const shown = new Intl.NumberFormat('en-US', { maximumSignificantDigits: precise ? 8 : 3, notation: Math.abs(n) < 1e-6 ? 'scientific' : 'standard' }).format(numeric ? n : Math.abs(n));
      return numeric ? shown : `${n < 0 ? '−' : ''}$${shown}`;
    }
    if (unit === 'number' || unit === 'count' || unit === 'units') return new Intl.NumberFormat('en-US', { maximumFractionDigits: precise ? 2 : 0 }).format(n);
    if (precise) return `${n < 0 ? '−' : ''}$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Math.abs(n))}`;
    const a = Math.abs(n), prefix = n < 0 ? '−$' : '$';
    if (a >= 1e9) return `${prefix}${(a / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${prefix}${(a / 1e6).toFixed(1)}M`;
    if (a >= 1e3) return `${prefix}${(a / 1e3).toFixed(1)}K`;
    return `${prefix}${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(a)}`;
  }
  const percentPoints = value => `${num(value) >= 0 ? '+' : ''}${Number(value).toFixed(1)} pp`;
  const periodLabel = period => /^FY/.test(String(period)) ? String(period) : `FY${String(period).slice(-2)}`;
  const data = () => window.HX_DATA || {};
  const engine = () => window.HX_ANALYTICS || {};
  const allCategoriesSelected = () => state.category.includes('all') || !state.category.length;
  const selectedCategories = () => allCategoriesSelected() ? [] : state.category;
  const hasDrill = () => Boolean(state.groupId || state.projectId || state.skuId);
  const isProductComparison = () => Array.isArray(state.compareIds) && state.compareIds.length > 0;
  const isComparison = () => isProductComparison() || (!hasDrill() && selectedCategories().length > 1);
  const inCategoryScope = category => allCategoriesSelected() || selectedCategories().includes(category);
  const scopeLabel = () => isProductComparison() ? `${state.compareIds.length} selected ${activeDrill?.scope?.level === 'group' ? state.compareIds.length === 1 ? 'project' : 'projects' : activeDrill?.scope?.level === 'project' ? state.compareIds.length === 1 ? 'SKU' : 'SKUs' : state.compareIds.length === 1 ? 'product group' : 'product groups'}` : hasDrill() && activeDrill?.scope?.title ? activeDrill.scope.title : allCategoriesSelected() ? 'All categories' : selectedCategories().join(' + ');
  const categoryColor = category => window.HX_WORKSPACE_MODEL?.categoryColor?.(category) || colors[({Controllers:0,Headsets:1,Keyboards:2,Mice:3,Others:4,'Standalone Mics':5})[category] ?? 0] || colors[0];
  function opts() { return { period: state.period, category: allCategoriesSelected() ? 'All' : selectedCategories(), groupId: state.groupId, projectId: state.projectId, skuId: state.skuId }; }
  function productComparison(metric = 'revenue', period = state.period, mode = state.comparisonScale) {
    if (!isProductComparison()) return null;
    const key = `${metric}|${mode}|${period}`;
    if (!comparisonModels.has(key)) comparisonModels.set(key, engine().compareDrillSeries?.(metric, { ...opts(), period, compareIds: state.compareIds, mode }) || null);
    return comparisonModels.get(key);
  }
  function comparisonColors() {
    const palette = [...colors, '#E59BA6', '#B5A0D3', '#8FC8C0', '#E0A860', '#9FB2FF', '#DF99DB'], assigned = new Map(), used = new Set();
    const ids = (activeDrill?.children || []).filter(child => state.compareIds?.includes(child.id)).map(child => child.id);
    for (const id of ids) {
      let hash = 0; for (const character of id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
      let color;
      for (let offset = 0; offset < palette.length; offset++) { const candidate = palette[(hash + offset) % palette.length]; if (!used.has(candidate)) { color = candidate; break; } }
      if (!color) { let hue = hash % 360; do { color = `hsl(${hue} 64% 70%)`; hue = (hue + 17) % 360; } while (used.has(color)); }
      used.add(color); assigned.set(id, color);
    }
    return assigned;
  }
  function toggleCompare(id) {
    if (!(activeDrill?.children || []).some(child => child.id === id)) return;
    if(id==='source-unmapped')return toast('Unmapped tracker records have a separate source population. Use Explore details to inspect their projects.');
    if((id==='source-unmapped'&&state.compareIds.length&&!state.compareIds.includes(id))||(id!=='source-unmapped'&&state.compareIds.includes('source-unmapped')))return toast('Unmapped tracker records have a different population. Clear this selection before comparing product-group finance.');
    const scrollTop = $('#drill-results')?.scrollTop || 0;
    const selected = Array.isArray(state.compareIds) ? state.compareIds : [];
    if (!selected.includes(id) && selected.length >= 50) { toast('Compare up to 50 products at once. Clear a selection before adding another.'); return; }
    timelineControl?.stop(); state.compareIds = selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id];
    state.view = 'performance'; state.metric = ['revenue', 'grossProfit', 'grossMargin', 'budget', 'units'].includes(state.metric) ? state.metric : 'revenue';
    draw();
    const list = $('#drill-results'); if (list) list.scrollTop = scrollTop;
    const index = (activeDrill?.children || []).findIndex(child => child.id === id); $(`[data-drill-compare="${index}"]`)?.focus?.({ preventScroll: true });
  }
  function clearComparison() { timelineControl?.stop(); state.compareIds = []; draw(); }
  function refreshDrillScope(validate = false) {
    activeDrill = null;
    comparisonModels = new Map();
    if (!hasSource() || typeof engine().drilldown !== 'function') return;
    try { activeDrill = engine().drilldown(opts()); } catch (error) { console.warn('Scope details unavailable:', error.message); }
    if (validate && activeDrill?.coverage?.invalidScope) {
      resetDrill(); state.drillNotice = 'The saved detail selection is unavailable in this workbook. Showing its category instead.';
      activeDrill = engine().drilldown(opts()); return;
    }
    if (validate && hasDrill() && activeDrill?.scope) {
      for (const key of ['groupId', 'projectId', 'skuId']) state[key] = scopeId(activeDrill.scope[key]);
      const category = activeDrill.scope.category;
      if (hasDrill() && typeof category === 'string' && getCategories().includes(category)) state.category = [category];
    }
    if (validate && isProductComparison()) { const children = new Set((activeDrill?.children || []).map(child => child.id)); state.compareIds = window.HX_WORKSPACE_MODEL ? parseCompare(state.compareIds) : parseCompare(state.compareIds).filter(id => children.has(id)); }
  }
  function resetDrill() { state.groupId = null; state.projectId = null; state.skuId = null; state.compareIds = []; state.drillQuery = ''; state.drillNotice = ''; }
  function selectDrillScope(scope) {
    if (!scope) return;
    timelineControl?.stop();
    for (const key of ['groupId', 'projectId', 'skuId']) state[key] = scopeId(scope[key]);
    if (typeof scope.category === 'string' && getCategories().includes(scope.category)) state.category = [scope.category];
    else if (!hasDrill()) state.category = ['all'];
    state.connectivity=['all'];
    state.compareIds = []; state.drillQuery = ''; state.drillNotice = ''; state.metric = 'revenue'; state.view = 'performance'; location.hash = scopeFragment('performance');
    draw();
    $('#analysis-chart')?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }
  function scopeAttributes(scope = state) { return `data-chart-group="${escape(scope.groupId || '')}" data-chart-project="${escape(scope.projectId || '')}" data-chart-sku="${escape(scope.skuId || '')}"`; }
  function pointBasis(point) {
    return typeof point?.basis === 'string' ? point.basis : ({ actual: 'Source-labelled actual', projection: 'Workbook estimate', estimate: 'Source estimate', history: 'Source history', unclassified: 'Tracker reported · actual/plan unclassified', 'source-investment': 'Source PD investment · actual/plan timing unclassified' })[point?.kind] || (hasDrill() ? 'Source basis unclassified' : 'Source snapshot');
  }
  function drillResults() {
    const children = activeDrill?.children || [], query = state.drillQuery.trim().toLowerCase();
    const catalog=workspaceControl?.model?.catalog||children, filtered=window.HX_CONNECTIVITY?.filter(catalog,state.connectivity,data())||catalog;
    const sorted=window.HX_CONNECTIVITY?.sorting(filtered,{metric:state.productSort,direction:state.sortDirection,period:state.period},data())||filtered;
    return sorted.map(child=>({child,index:children.findIndex(record=>record.id===child.id)})).filter(({child})=>!query||[child.name,child.id,child.category,child.projectId,child.skuId].filter(Boolean).join(' ').toLowerCase().includes(query));
  }
  function renderDrillResults() {
    const list = $('#drill-results'), count = $('#drill-result-count'); if (!list || !count) return;
    const results = drillResults(), selected = state.compareIds || [], palette = new Map(results.map(({child})=>[child.id,window.HX_WORKSPACE_MODEL?.selectionColor(workspaceControl?.model,{entityId:child.id})||'#969eac'])); count.textContent = `${results.length} of ${activeDrill?.children?.length || 0} ${activeDrill?.scope?.level === 'group' ? 'projects' : activeDrill?.scope?.level === 'project' ? 'SKUs' : 'product groups'} · ${selected.length} selected`;
    const nameKey = child => String(child.name || child.id || '').replace(/\u00a0/g, ' ').trim().toLowerCase(), nameCounts = new Map();
    for (const child of workspaceControl?.model?.catalog || activeDrill?.children || []) { const key = nameKey(child); nameCounts.set(key, (nameCounts.get(key) || 0) + 1); }
    const fullIdentity = child => [...new Set([child.name || child.id, child.category, child.skuId || child.projectId || child.id].filter(Boolean))].join(' · ');
    const exactCurrency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 20 }), exactUnits = new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 });
    const cardMetrics = child => [['revenue', 'Revenue', 'currency'], ['units', 'Units', 'units'], ['grossProfit', 'Gross profit', 'currency'], ['budget', 'PD investment', 'currency']].map(([metric, label, unit]) => {
      const value = child[metric], available = typeof value === 'number' && Number.isFinite(value), exact = available ? (unit === 'units' ? exactUnits : exactCurrency).format(value) : 'Unavailable';
      return `<span class="drill-choice-metric" data-product-metric="${metric}" data-product-value="${available ? escape(String(value)) : ''}" title="${escape(label + ': ' + exact)}"><small class="drill-metric-label">${label}</small><strong class="drill-metric-value${available ? '' : ' is-unavailable'}">${available ? fmt(value, unit) : 'Unavailable'}</strong></span>`;
    }).join('');
    list.innerHTML = results.length ? results.map(({ child, index }) => `<li class="drill-card${selected.includes(child.id) ? ' is-selected' : ''}" style="--product-color:${palette.get(child.id) || '#969eac'}"><button type="button" class="drill-choice" data-drill-compare="${index}" aria-pressed="${selected.includes(child.id)}" title="${escape(fullIdentity(child))}" aria-label="${escape(fullIdentity(child))} · ${selected.includes(child.id) ? 'Remove from comparison' : 'Add to comparison'}"><span class="drill-choice-name">${escape(child.name || child.id)}${nameCounts.get(nameKey(child)) > 1 ? `<small class="drill-choice-identity">${escape(child.skuId || child.projectId || child.id)}</small>` : ''}</span><span class="drill-choice-metrics">${cardMetrics(child)}</span><small class="drill-choice-meta">${escape((window.HX_CONNECTIVITY?.profile(data(),child)?.label||'Unclassified')+' · '+periodLabel(state.period))}</small></button></li>`).join('') : '<li class="drill-empty">No matching records. Try a product name, project key, or part number.</li>';
  }
  function renderDrillExplorer() {
    const element = $('#scope-explorer'), breadcrumb = $('#scope-breadcrumb'); if (!element) return;
    if (!activeDrill) { element.hidden = true; if (breadcrumb) breadcrumb.hidden = true; return; }
    element.hidden = false;
    const crumbs = activeDrill.breadcrumbs || [], children = activeDrill.children || [], level = activeDrill.scope?.level || 'category';
    const nextLabel = level === 'group' ? 'Compare projects' : level === 'project' ? 'Compare SKUs' : 'Compare product groups';
    const crumbText = crumb => `<span>${escape(crumb.label)}</span><small>${escape(crumb.skuId ? `SKU · ${crumb.skuId}` : crumb.projectId ? `Project · ${crumb.projectId}` : crumb.groupId ? 'Product group' : 'Category scope')}</small>`;
    if (breadcrumb) { breadcrumb.hidden = false; breadcrumb.innerHTML = `${crumbs.map((crumb, index) => `${index ? '<span aria-hidden="true">›</span>' : ''}${index === crumbs.length - 1 ? `<strong aria-current="location">${crumbText(crumb)}</strong>` : `<button type="button" data-drill-crumb="${index}">${crumbText(crumb)}</button>`}`).join('')}`; }
    element.innerHTML = `${state.drillNotice ? `<p class="drill-leaf" role="status">${escape(state.drillNotice)}</p>` : ''}${activeDrill.coverage?.needsReimport ? '<div class="drill-reimport">This saved source predates project and SKU detail. Reimport the workbook to restore the original part-number records.<button type="button" class="text-link" data-import-workbook>Reimport workbook →</button></div>' : ''}${children.length ? `<div class="drill-toolbar"><label for="drill-search">${nextLabel}</label><input id="drill-search" type="search" class="search-input" value="${escape(state.drillQuery)}" placeholder="Search names or source IDs…" aria-controls="drill-results" autocomplete="off"><span id="drill-result-count" role="status" aria-live="polite"></span><button type="button" id="drill-clear-compare" class="text-link" ${state.compareIds?.length ? '' : 'disabled'}>Clear selection</button></div><ul id="drill-results" class="drill-results" aria-label="${nextLabel}"></ul>` : `<p class="drill-leaf">${level === 'sku' ? 'SKU detail selected. Use the breadcrumb to return to its project or product group.' : 'No further linked source records in this scope.'}</p>`}`;
    const toolbar=$('.drill-toolbar',element);
    if(toolbar){const sort=document.createElement('label');sort.className='analysis-sort-label';sort.innerHTML=`Sort by <select id="drill-sort" aria-label="Sort products">${[['revenue','Revenue'],['units','Units'],['grossProfit','Gross profit'],['grossMargin','Gross margin'],['budget','PD investment'],['name','Name'],['connectivity','Connectivity']].map(([key,label])=>`<option value="${key}" ${state.productSort===key?'selected':''}>${label}</option>`).join('')}</select>`;toolbar.appendChild(sort);const direction=document.createElement('button');direction.type='button';direction.id='drill-sort-direction';direction.className='button button-quiet';direction.textContent=state.productSort==='name'||state.productSort==='connectivity'?(state.sortDirection==='asc'?'A → Z':'Z → A'):(state.sortDirection==='desc'?'High → low':'Low → high');toolbar.appendChild(direction);toolbar.classList.add('analysis-product-toolbar');}
    renderDrillResults();
  }
  function drillEconomics() {
    if (isProductComparison()) {
      const model = productComparison('revenue'), coverage = model?.coverage || {}, missing = Object.entries(coverage.completeByMetric || {}).filter(([, complete]) => complete === false).map(([metric]) => ({revenue:'revenue',grossProfit:'gross profit',units:'units',budget:'investment'})[metric] || metric);
      return `<section class="drill-economics"><div class="drill-economics-heading"><div><h3>Selected product evidence</h3><p>${escape(scopeLabel())} · current sibling selection</p></div></div><p class="drill-economics-note">Summary totals require a source value for every selected product. Margins use combined gross profit divided by combined revenue.${missing.length ? ` Incomplete selected totals: ${escape(missing.join(', '))}.` : ''} Parent project investment, ROI cases, and 12-month plans are not assigned to the comparison.</p>${model?.reason || model?.notice ? `<p class="drill-economics-note">${escape(model.reason || model.notice)}</p>` : ''}</section>`;
    }
    if (!hasDrill() || !activeDrill) return '';
    const economics = activeDrill.economics || {}, coverage = activeDrill.coverage || {}, plan = economics.plan12M, reported = economics.reported || {}, sku = activeDrill.scope?.level === 'sku';
    const card = (label, value, note, unit = 'currency') => `<div class="drill-economic"><span>${escape(label)}</span><strong>${unit === 'multiple' ? finite(value) ? Number(value).toFixed(2) + '×' : '—' : fmt(value, unit)}</strong><small>${escape(note)}</small></div>`;
    const through = reported.throughPeriod ? ` through ${periodLabel(reported.throughPeriod)}` : '';
    const cards = [card('Source PD investment', economics.sourceInvestment, sku ? 'Unavailable at SKU level · no cost allocation' : 'All available source years · linked projects'), card('Tracker reported revenue', economics.reportedRevenue, `Cumulative available records${through} · actual/plan unclassified`), card('Tracker reported gross profit', economics.reportedGrossProfit, `Cumulative available records${through} · actual/plan unclassified`)];
    if (sku && finite(economics.parentProjectInvestment)) cards.push(card('Parent project PD investment', economics.parentProjectInvestment, 'Project context only · not a SKU cost'));
    if (finite(economics.sourceReturnMultiple)) cards.push(card('Saved source 12-month GP / PD multiple', economics.sourceReturnMultiple, economics.returnBasis || 'Saved source case · actuals status unverified', 'multiple'));
    if (plan) { cards.push(card('Current 12-month planned revenue', plan.revenue, plan.basis || 'Current source plan · separate 12-month horizon')); cards.push(card('Current 12-month planned gross profit', plan.grossProfit, 'Source estimate · not earned revenue')); }
    const reason = economics.availability?.reason || 'Original forecast and observed outcomes need aligned scope and timing before measuring plan accuracy.';
    const notice = Array.isArray(activeDrill.notice) ? activeDrill.notice.join(' ') : activeDrill.notice || '';
    const explanation = [...new Set([reason, notice].map(text => String(text).trim().replace(/\s+/g, ' ')).filter(Boolean))].join(' ');
    const countLabel = (value, singular, plural = singular + 's') => `${fmt(value, 'number')} ${Number(value) === 1 ? singular : plural}`;
    const coverageText = [countLabel(coverage.sourceRows, 'source tracker row'), countLabel(coverage.reportedRowCount, 'numeric period record'), countLabel(coverage.skuCount, 'linked SKU'), countLabel(coverage.missingPeriodRows, 'row without an assigned period', 'rows without assigned periods'), ...(coverage.unmappedProjectCount ? [countLabel(coverage.unmappedProjectCount, 'unmapped project')] : []), ...(coverage.ambiguousProjectCount ? [countLabel(coverage.ambiguousProjectCount, 'ambiguous project link')] : [])].join(' · ');
    return `<section class="drill-economics" aria-label="Investment review evidence"><div class="drill-economics-heading"><div><h3>Investment review evidence</h3><p>Revenue, estimates, and investment retain their own source horizon.</p></div><span class="tag tag-yellow">SOURCE EVIDENCE</span></div><div class="drill-economic-grid">${cards.join('')}</div><p class="drill-coverage">${escape(coverageText)}</p><p class="drill-economics-note">${escape(explanation)}</p>${plan?.source?.length ? '<button type="button" class="text-link" data-drill-plan-source>Inspect current 12-month plan sources →</button>' : ''}</section>`;
  }
  function scopedOverview() {
    const s = summary();
    return `<div class="display-grid">${kpi('revenue', 'Selected-period source revenue', valueOf('revenue', s), colors[0], `<span class="kpi-change neutral">${escape(sourceKind(state.period))}</span>`)}${kpi('grossProfit', 'Selected-period gross profit', valueOf('grossProfit', s), colors[3], '<span class="kpi-change neutral">Same selected source scope</span>')}${kpi('units', 'Selected-period units', valueOf('units', s), colors[4], '<span class="kpi-change neutral">Missing values remain unavailable</span>', 'units')}</div><section class="panel"><div class="panel-head"><div><h2>Revenue through time</h2><p>${escape(scopeLabel())} · annual source values</p></div><button type="button" class="text-link" data-go="performance">Explore performance →</button></div><div class="chart-wrap">${lineChart('revenue')}</div>${drillEconomics()}</section>`;
  }
  function scopedInvestment() {
    const s = summary(), sku = activeDrill?.scope?.level === 'sku';
    return `<section class="panel"><div class="panel-head"><div><h2>Source PD investment through time</h2><p>${escape(scopeLabel())} · recorded fiscal-year spend</p></div></div><div class="performance-summary"><div><div class="eyebrow">${escape(periodLabel(state.period))} · ${sku ? 'SKU investment not allocated' : 'Selected scope'}</div><div class="large-value">${fmt(valueOf('budget', s))}</div></div></div><div class="chart-wrap">${lineChart('budget', { color: colors[1] })}</div><div class="chart-note">${icon('info')}${sku ? 'The source records investment at project level. Parent project spend is context and is never assigned to this SKU.' : 'Only source investment linked to this scope is shown. Missing years are not zero.'}</div>${drillEconomics()}</section>`;
  }
  function scopeProjectIds() {
    if (state.projectId) return new Set([String(state.projectId).trim().toLowerCase()]);
    return new Set((activeDrill?.children || []).filter(child => child.projectId).map(child => String(child.projectId).trim().toLowerCase()));
  }
  function inCaseScope(record) {
    if (!hasDrill()) return inCategoryScope(record.category);
    const id = record.details?.Bud_Key || record.details?.Budget_Key || record.projectId || record.id;
    return scopeProjectIds().has(String(id || '').trim().toLowerCase());
  }
  function getPeriods() {
    const d = data(), base = (d.periods || d.years || []).map(period => typeof period === 'object' ? period.period ?? period.year ?? period.id : period);
    if ((!hasDrill() && !isProductComparison()) || !activeDrill) return base;
    const comparison = isProductComparison() ? productComparison('revenue') : null;
    const scoped = [...(activeDrill.series || []), ...(activeDrill.estimateSeries || []), ...Object.values(activeDrill.metricSeries || {}).flat(), ...Object.values(comparison?.selectionMetricSeries || {}).flat(), ...(comparison?.traces || []).flatMap(trace => [...trace.series, ...(trace.estimateSeries || [])])].map(point => point.period).filter(period => period !== null && period !== undefined);
    return [...new Map([...base, ...scoped].map(period => [String(period), period])).values()].sort((a, b) => Number(a) - Number(b));
  }
  function categoryBasis(period) { const point = engine().series?.('revenue', { category: 'All' })?.find(record => String(record.period) === String(period)); return ({actual:'Source-labelled actual',projection:'Workbook projection',history:'Source history'})[point?.kind] || 'Source category snapshot'; }
  function getCategories() { return (data().categories || []).map(c => typeof c === 'object' ? c.id ?? c.name ?? c.category : c); }
  function rows() {
    let result;
    try { result = engine().productRows?.(opts()); } catch (_) {}
    if (Array.isArray(result)) return result;
    return (data().products || []).filter(p => inCategoryScope(p.category));
  }
  function allSeries(metric, filter = {}) {
    if (isProductComparison() && !Object.keys(filter).length) return productComparison('revenue')?.selectionMetricSeries?.[metric] || productComparison(metric)?.selectionSeries || [];
    let result = hasDrill() && !Object.keys(filter).length ? activeDrill?.metricSeries?.[metric] : null;
    try { if (!result) result = engine().series?.(metric, { ...opts(), ...filter }); } catch (_) {}
    if (!result) result = data().metrics?.[metric]?.values || data().metrics?.[metric]?.series;
    if (!result) return [];
    if (!Array.isArray(result)) result = Object.entries(result).map(([period, value]) => ({ period, value }));
    return result.map((p, i) => typeof p === 'object' ? { ...p, period: p.period ?? p.year ?? getPeriods()[i], value: num(p.value ?? p.total ?? p.amount) } : { period: getPeriods()[i], value: num(p) }).filter(p => p.period !== undefined);
  }
  function summary() {
    if (isProductComparison()) return productComparison('revenue')?.selectionSummary || { revenue:null,grossProfit:null,grossMargin:null,units:null,budget:null,source:{},basis:'Selected product data unavailable' };
    let result; try { result = engine().summarize?.(opts()); } catch (error) { console.warn('Summary not available:', error.message); }
    if (result && typeof result === 'object') return result;
    const resultFallback = {}; ['revenue', 'revenueTarget', 'grossMargin', 'rawMargin', 'tam', 'npi', 'budget', 'tooling', 'rnd', 'units'].forEach(key => { resultFallback[key] = allSeries(key).find(v => String(v.period) === String(state.period))?.value ?? null; });
    resultFallback.productCount = rows().length; return resultFallback;
  }
  function valueOf(key, s = summary()) { const aliases = { grossMargin: ['grossMargin', 'margin', 'publishedMargin', 'gm'], revenueTarget: ['revenueTarget', 'targetRevenue', 'target'], rawMargin: ['rawMargin', 'rawGrossMargin'], npi: ['npi', 'npiRevenue', 'npiValue'], rnd: ['rnd', 'rAndD', 'rd'], budget: ['budget', 'investment', 'opex'] }; for (const k of aliases[key] || [key]) { const value = s[k]; if (finite(value)) return num(value); if (value && finite(value.value)) return num(value.value); } return null; }
  function yoy(metric) { const series = allSeries(metric); const index = series.findIndex(p => String(p.period) === String(state.period)); if (index < 1 || !finite(series[index].value) || !finite(series[index - 1].value) || series[index - 1].value === 0) return null; return (series[index].value / series[index - 1].value - 1) * 100; }
  function sourceKind(period) { const point = allSeries('revenue').find(p => String(p.period) === String(period)); if (hasDrill() || isProductComparison()) return pointBasis(point); const record = (data().periodDefinitions || data().periodMetadata || []).find?.(p => String(p.period ?? p.year) === String(period)); if (record?.label || record?.kind) return record.label || record.kind; const kind = point?.kind || point?.type; if (kind) return ({actual:'Source-labelled actual',projection:'Workbook projection',history:'Source history'})[kind] || kind; const n = Number(String(period).replace(/[^\d]/g, '')); const year = n < 100 ? n + 2000 : n; return year === 2025 ? 'Source-labelled actual' : year > 2025 ? 'Workbook projection' : 'Source history'; }
  function marginLabel(s = summary()) { if (isProductComparison()) return s.marginBasis || 'Weighted source gross margin · selected products'; if (hasDrill()) return s.marginBasis || 'Source gross margin · selected scope'; return finite(s.publishedMargin) ? (isComparison() ? 'Weighted published GM · adjusted' : 'Published GM · adjusted') : 'Product gross margin · raw'; }
  function isProjection(period) { const point = allSeries('revenue').find(record => String(record.period) === String(period)); if (point?.kind) return /^(projection|estimate|plan|forecast)$/i.test(point.kind); return hasDrill() ? false : /proj|plan|forecast|fcst/i.test(sourceKind(period)); }
  function deltaText(metric, change = yoy(metric)) { return finite(change) ? `<span class="kpi-change ${change < 0 ? 'negative' : ''}">${change >= 0 ? '↗' : '↘'} ${Math.abs(change).toFixed(1)}% <span style="color:var(--muted)">vs prior year</span></span>` : '<span class="kpi-change neutral">Prior year comparison unavailable</span>'; }
  function empty(title, text) { return `<div class="empty-state">${icon('database')}<h3>${escape(title)}</h3><p>${escape(text)}</p></div>`; }
  function sourceRefs(metric, period = state.period, category = null, scope = {}) {
    if (isProductComparison() && !Object.keys(scope).length && !category) { const model = productComparison(metric, period), point = model?.selectionSeries?.find(record => String(record.period) === String(period)); return point?.source || model?.selectionSummary?.source?.[metric] || []; }
    const filter = { ...opts(), ...scope, period, ...(category ? { category } : {}) };
    const scoped = engine().drilldown?.(filter), point = (scoped?.metricSeries?.[metric] || engine().series?.(metric, filter) || []).find(p => String(p.period) === String(period)), s = engine().summarize(filter);
    const refs = point?.source || point?.sources || s.source?.[metric] || s.sources?.[metric] || data().metrics?.[metric]?.source || [];
    return Array.isArray(refs) ? refs : refs ? [refs] : [];
  }
  function metricUnit(key) { if (['grossMargin', 'rawMargin', 'marketShare'].includes(key)) return 'percent'; if (['productCount', 'npiCount', 'units'].includes(key)) return 'number'; return data().metrics?.[key]?.unit || 'currency'; }
  function sparkline(key, color) { const vals = allSeries(key).map(p => p.value).filter(finite); if (vals.length < 2) return ''; const lo = Math.min(...vals), hi = Math.max(...vals), range = hi - lo || 1; const pts = vals.map((v, i) => `${4 + i / (vals.length - 1) * 76},${25 - (v - lo) / range * 20}`).join(' '); return `<svg class="sparkline" viewBox="0 0 85 29" aria-hidden="true"><polyline fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" points="${pts}"/></svg>`; }
  function kpi(key, label, value, color, bottom, unit) { return `<button class="kpi" data-metric-detail="${key}" style="--series-color:${color}"><div class="kpi-top"><span class="kpi-label">${label}</span><span class="kpi-arrow">↗</span></div><div class="kpi-value">${fmt(value, unit || metricUnit(key))}</div><div class="kpi-bottom">${bottom ?? deltaText(key)}${sparkline(key, color)}</div></button>`; }
  function comparisonChart(metric, settings = {}) {
    const products = isProductComparison(), periods = getPeriods(), unit = metricUnit(metric), model = products ? productComparison(metric) : engine().compareSeries(metric, { ...opts(), mode: state.comparisonScale });
    if (!model || model.active === false || !model.traces?.length) return empty('Comparison unavailable', model?.reason || 'Choose supported sibling records to compare their source values.');
    const indexed = model.indexed, palette = products ? comparisonColors() : null;
    const traces = model.traces.map(trace => ({ ...trace, key: products ? trace.id : trace.category, label: trace.label || trace.category, color: products ? palette.get(trace.id) || colors[0] : categoryColor(trace.category), targets: !products && settings.target && !indexed ? allSeries('revenueTarget', { category: trace.category }) : [], estimates: products && metric === 'revenue' && !indexed ? trace.estimateSeries || [] : [] }));
    const values = traces.flatMap(trace => [...trace.series, ...trace.targets, ...trace.estimates].map(point => point.value)).filter(finite);
    if (!values.length) return empty('Comparison unavailable', model.reason || 'No source values are available for the selected records and measure. Missing data stays unavailable.');
    const mobile = window.innerWidth < 700, w = mobile ? Math.max(280, window.innerWidth - 60) : 670, h = 340, left = 68, right = 22, top = 26, bottom = 38, innerW = w - left - right, innerH = h - top - bottom;
    let min = indexed ? Math.min(100, ...values) : Math.min(0, ...values), max = indexed ? Math.max(100, ...values) : Math.max(0, ...values);
    const span = max - min || Math.max(Math.abs(max) * .1, 1); min -= indexed ? span * .12 : min < 0 ? span * .07 : 0; max += span * .12;
    const x = index => left + index * innerW / Math.max(periods.length - 1, 1), y = value => top + innerH * (1 - (value - min) / (max - min));
    let svg = '';
    for (let index = 0; index <= 4; index++) { const value = min + (max - min) * index / 4, yy = y(value); svg += `<line class="chart-grid" x1="${left}" x2="${w-right}" y1="${yy}" y2="${yy}"/><text class="chart-axis" x="${left-10}" y="${yy+3}" text-anchor="end">${escape(indexed ? value.toFixed(0) : fmt(value, unit))}</text>`; }
    periods.forEach((period, index) => { if (!mobile || index % 2 === 0 || index === periods.length - 1) svg += `<text class="chart-axis" x="${x(index)}" y="${h-12}" text-anchor="middle">${escape(periodLabel(period))}</text>`; });
    const projectionIndex = !products ? periods.findIndex(isProjection) : -1;
    if (projectionIndex > 0) { const xx = (x(projectionIndex) + x(projectionIndex-1)) / 2; svg += `<rect x="${xx}" y="${top-6}" width="${w-right-xx}" height="${innerH+6}" fill="#895EF6" opacity=".035"/><text class="chart-axis" x="${xx+8}" y="${top-10}">WORKBOOK PLAN</text>`; }
    const selectedIndex = periods.findIndex(period => String(period) === String(state.period));
    if (indexed) svg += `<line class="comparison-baseline" data-index-baseline="100" x1="${left}" x2="${w-right}" y1="${y(100)}" y2="${y(100)}" stroke="#92959c" stroke-width="1" stroke-dasharray="3 5" opacity=".55"/>`;
    if (selectedIndex >= 0) svg += `<line x1="${x(selectedIndex)}" x2="${x(selectedIndex)}" y1="${top}" y2="${h-bottom}" stroke="#92959c" opacity=".35" stroke-dasharray="2 4"/>`;
    const basisKind = point => /unclassified|unknown|source-investment/i.test(point?.kind || '') ? 'unclassified' : /proj|plan|forecast|estimate/i.test(point?.kind || '') ? 'plan' : 'history';
    function pathSegments(trace, points, type) {
      let segment = [], previous = null, previousKind = null, segmentIndex = 0;
      const flush = () => { if (segment.length > 1) svg += `<polyline class="chart-path" data-chart-series="${escape(metric+':'+trace.key+':'+type+':'+segmentIndex++)}" data-comparison-category="${escape(trace.category || '')}" data-comparison-id="${escape(trace.key)}" ${products ? scopeAttributes(trace.scope || {}) : ''} points="${segment.join(' ')}" fill="none" stroke="${trace.color}" stroke-width="${type === 'target' ? 1.5 : 2.5}" ${type === 'target' ? 'stroke-dasharray="1 5" opacity=".6"' : previousKind === 'unclassified' ? 'stroke-dasharray="2 5"' : previousKind === 'plan' ? 'stroke-dasharray="6 4"' : ''} stroke-linejoin="round" stroke-linecap="round"/>`; segment = []; };
      periods.forEach((period, index) => { const point = points.find(record => String(record.period) === String(period)); if (!finite(point?.value)) { flush(); previous = null; previousKind = null; return; } const coordinate = `${x(index)},${y(point.value)}`, kind = type === 'estimate' || type === 'target' ? 'plan' : basisKind(point); if (previousKind && previousKind !== kind) { flush(); if (previous) segment.push(previous); } segment.push(coordinate); previous = coordinate; previousKind = kind; }); flush();
    }
    for (const trace of traces) {
      pathSegments(trace, trace.series, 'value'); if (trace.targets.length) pathSegments(trace, trace.targets, 'target'); if (trace.estimates.length) pathSegments(trace, trace.estimates, 'estimate');
      for (const [type, points] of [['value', trace.series], ['target', trace.targets], ['estimate', trace.estimates]]) periods.forEach((period, index) => {
        const point = points.find(record => String(record.period) === String(period)); if (!finite(point?.value)) return;
        const rawValue = Object.hasOwn(point, 'rawValue') ? point.rawValue : point.value, selected = String(period) === String(state.period), label = `${trace.label} · ${periodLabel(period)}${type === 'target' ? ' target' : type === 'estimate' ? ' current annual plan' : ''}: ${fmt(rawValue, unit, true)}${indexed ? ' · trend index ' + point.value.toFixed(1) : ''}`;
        svg += `<circle class="chart-point" tabindex="0" role="button" aria-label="${escape(label)}. Open source." data-chart-metric="${type === 'estimate' ? 'revenueEstimate' : type === 'target' ? 'revenueTarget' : metric}" data-chart-category="${escape(trace.scope?.category || trace.category || '')}" ${products ? scopeAttributes(trace.scope || {}) : ''} data-comparison-id="${escape(trace.key)}" data-period="${escape(period)}" cx="${x(index)}" cy="${y(point.value)}" r="${type === 'target' ? 2 : selected ? 4.8 : 3}" fill="${selected && type === 'value' && basisKind(point) !== 'unclassified' ? trace.color : '#242527'}" stroke="${trace.color}" stroke-width="${type === 'target' ? 1 : 1.6}" ${type === 'target' ? 'opacity=".6"' : ''}><title>${escape(label)} · ${escape(products ? pointBasis(point) : sourceKind(period))}</title></circle>`;
      });
    }
    const legend = traces.map(trace => { const point = trace.series.find(record => String(record.period) === String(state.period)), rawValue = point && Object.hasOwn(point, 'rawValue') ? point.rawValue : point?.value; const plans = trace.estimates.filter(record => finite(record.value)); return `<div class="comparison-legend-item" data-comparison-id="${escape(trace.key)}"><i style="background:${trace.color}"></i><span>${escape(trace.label)}</span><strong>${fmt(rawValue, unit)}</strong>${indexed && finite(point?.value) ? `<small>Index ${point.value.toFixed(1)}</small>` : ''}${plans.length ? `<small>Current annual plan · ${plans.map(record => `${escape(periodLabel(record.period))} ${fmt(Object.hasOwn(record, 'rawValue') ? record.rawValue : record.value)}`).join(' · ')}</small>` : ''}</div>`; }).join('');
    return `<div class="category-comparison" data-comparison-metric="${metric}" data-comparison-kind="${products ? 'products' : 'categories'}" data-comparison-scale="${indexed ? 'trend' : 'values'}"><div class="comparison-legend" aria-label="Selected ${products ? 'product' : 'category'} values for ${escape(periodLabel(state.period))}">${legend}</div><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escape(metric)} comparison: ${escape(traces.map(trace => trace.label).join(', '))}; ${indexed ? 'trend index, ' + periodLabel(model.basePeriod) + ' equals 100' : 'shared value scale'}; gaps for unavailable values">${svg}</svg><p class="comparison-chart-basis">${indexed ? `Trend index · ${escape(periodLabel(model.basePeriod))} = 100 for every ${products ? 'product' : 'category'} · source ${unit === 'percent' ? 'percentages' : 'values'} in legend` : `${escape(periodLabel(state.period))} values · shared ${unit === 'percent' ? 'percentage' : 'absolute-value'} scale`} · solid source history / actual · dashed plan · dotted unclassified${settings.target && !indexed && !products ? ' · dotted category target' : ''}${metric === 'grossMargin' && !products ? ' · category GM retains its available published or raw source basis; inspect points for definitions' : ''}${model.reason ? ' · ' + escape(model.reason) : ''}</p></div>`;
  }
  function lineChart(metric, settings = {}) {
    if (isComparison()) return comparisonChart(metric, settings);
    const series = allSeries(metric), unit = metricUnit(metric), estimate = metric === 'revenue' && hasDrill() ? activeDrill?.estimateSeries || activeDrill?.metricSeries?.revenueEstimate || [] : [];
    const target = settings.target && !hasDrill() ? allSeries('revenueTarget') : [];
    const valid = [...series, ...estimate, ...target].filter(point => finite(point.value));
    if (!valid.length) return empty('No supported values in this scope', 'No source values are available for this measure and selection. Missing values remain gaps; product-group revenue and project costs are not allocated to SKUs.');
    const mobile = window.innerWidth < 700, w = mobile ? Math.max(260, window.innerWidth - 60) : 670, h = mobile ? 300 : 330, left = mobile ? 66 : 56, right = mobile ? 15 : 24, top = 22, bottom = 38, innerW = w - left - right, innerH = h - top - bottom;
    const periods = getPeriods(), vals = valid.map(point => point.value);
    let min = Math.min(0, ...vals), max = Math.max(0, ...vals), span = max - min || 1; min -= min < 0 ? span * .08 : 0; max += span * .12;
    const x = index => left + index * innerW / Math.max(periods.length - 1, 1), y = value => top + innerH * (1 - (value - min) / (max - min));
    let svg = '';
    for (let index = 0; index <= 4; index++) { const value = min + (max - min) * index / 4, yy = y(value); svg += `<line class="chart-grid" x1="${left}" x2="${w-right}" y1="${yy}" y2="${yy}"/><text class="chart-axis" x="${left-10}" y="${yy+3}" text-anchor="end">${escape(fmt(value, unit))}</text>`; }
    periods.forEach((period, index) => { if (!mobile || index % 2 === 0 || index === periods.length - 1) svg += `<text class="chart-axis" x="${x(index)}" y="${h-12}" text-anchor="middle">${escape(periodLabel(period))}</text>`; });
    const color = selectedCategories().length === 1 ? categoryColor(selectedCategories()[0]) : settings.color || colors[0];
    const kindStyle = point => /unclassified|unknown|source-investment/i.test(point?.kind || '') ? 'unclassified' : /proj|plan|estimate|forecast/i.test(point?.kind || '') ? 'estimate' : 'history';
    const trace = (records, key, traceColor, forcedKind = null) => {
      let previous = null, previousStyle = null, segment = [], segmentIndex = 0;
      const flush = () => { if (segment.length > 1) svg += `<polyline class="chart-path" data-chart-series="${escape(metric+':'+key+':'+segmentIndex++)}" ${scopeAttributes()} data-source-basis="${previousStyle}" points="${segment.join(' ')}" fill="none" stroke="${traceColor}" stroke-width="${key === 'target' ? 1.5 : 2.4}" ${previousStyle === 'unclassified' ? 'stroke-dasharray="2 5"' : previousStyle === 'estimate' || key === 'target' ? 'stroke-dasharray="6 4"' : ''} stroke-linejoin="round" stroke-linecap="round"/>`; segment = []; };
      periods.forEach((period, index) => {
        const point = records.find(record => String(record.period) === String(period));
        if (!finite(point?.value)) { flush(); previous = null; previousStyle = null; return; }
        const coordinate = `${x(index)},${y(point.value)}`, style = forcedKind || kindStyle(point);
        if (previousStyle && style !== previousStyle) { flush(); if (previous) segment.push(previous); }
        segment.push(coordinate); previous = coordinate; previousStyle = style;
      }); flush();
      periods.forEach((period, index) => {
        const point = records.find(record => String(record.period) === String(period)); if (!finite(point?.value)) return;
        const selected = String(period) === String(state.period), style = forcedKind || kindStyle(point), basis = key === 'estimate' ? point.basis || 'Current launch-year source plan; no locked estimate vintage' : pointBasis(point);
        const label = `${scopeLabel()} · ${periodLabel(period)} · ${fmt(point.value, unit, true)} · ${basis}`;
        svg += `<circle class="chart-point" tabindex="0" role="button" aria-label="${escape(label)}. Open source." data-chart-metric="${key === 'estimate' ? 'revenueEstimate' : key === 'target' ? 'revenueTarget' : metric}" data-chart-category="${escape(selectedCategories().length === 1 ? selectedCategories()[0] : '')}" ${scopeAttributes()} data-source-basis="${style}" data-period="${escape(period)}" cx="${x(index)}" cy="${y(point.value)}" r="${selected ? 4.8 : 3.2}" fill="${style === 'unclassified' || key !== 'value' ? '#242527' : selected ? traceColor : '#242527'}" stroke="${traceColor}" stroke-width="1.7"><title>${escape(label)}</title></circle>`;
      });
    };
    trace(series, 'value', color); if (estimate.length) trace(estimate, 'estimate', colors[5], 'estimate'); if (target.length) trace(target, 'target', colors[3], 'estimate');
    const metricName = ({ revenue: 'revenue', grossProfit: 'gross profit', grossMargin: 'gross margin', budget: 'PD investment', units: 'units' })[metric] || metric;
    const unclassified = series.some(point => kindStyle(point) === 'unclassified');
    const sourceLabel = metric === 'budget' ? 'Source PD investment · basis unclassified' : unclassified ? `Tracker reported ${metricName} · unclassified` : `Source ${metricName}`;
    const estimateLabel = estimate.filter(point => finite(point.value)).map(point => `${periodLabel(point.period)} ${fmt(point.value)}`).join(' · ');
    const legend = hasDrill() ? `<div class="drill-chart-legend"><span><i style="border-color:${color};border-top-style:${unclassified ? 'dotted' : 'solid'}"></i>${escape(sourceLabel)}</span>${estimateLabel ? `<span><i style="border-color:${colors[5]};border-top-style:dashed"></i>Current launch-year plan · ${escape(estimateLabel)}</span>` : ''}</div>` : '';
    return `${legend}<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escape(metric)} · ${escape(scopeLabel())} · annual source values; solid source history/actual, dashed estimates, dotted unclassified tracker records; missing values remain gaps">${svg}</svg>`;
  }
  function barsChart(metric) {
    if (isComparison()) return comparisonChart(metric);
    const series = allSeries(metric); if (!series.some(p => finite(p.value))) return empty('Comparison unavailable', 'No values are available in the selected scope.');
    const mobile = window.innerWidth < 700; const w = mobile ? Math.max(260, window.innerWidth - 60) : 600, h = 220, left = mobile ? 66 : 50, right = 15, top = 16, bottom = 34, innerH = h - top - bottom; const max = Math.max(...series.map(p => p.value ?? 0), 1) * 1.15; const col = (w - left - right) / series.length;
    let svg = ''; for (let i = 0; i < 4; i++) { const yy = top + innerH * i / 3; svg += `<line class="chart-grid" x1="${left}" x2="${w - right}" y1="${yy}" y2="${yy}"/><text class="chart-axis" x="${left - 8}" y="${yy + 3}" text-anchor="end">${fmt(max * (1 - i / 3), metricUnit(metric))}</text>`; }
    series.forEach((p, i) => { const xx = left + col * i + col * .24, barW = col * .52; const barH = finite(p.value) ? p.value / max * innerH : 0; const selected = String(p.period) === String(state.period); svg += `<rect x="${xx}" y="${top + innerH - barH}" width="${barW}" height="${Math.max(0, barH)}" rx="4" fill="${selected ? colors[2] : colors[1]}" opacity="${selected ? 1 : .5}"><title>${escape(periodLabel(p.period))}: ${escape(fmt(p.value, metricUnit(metric), true))}</title></rect>${!mobile || i % 2 === 0 || i === series.length - 1 ? `<text class="chart-axis" x="${xx + barW / 2}" y="${h - 12}" text-anchor="middle">${escape(periodLabel(p.period))}</text>` : ''}`; });
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escape(metric)} by year">${svg}</svg>`;
  }
  function productValue(p, metric, period = state.period) { if (metric === 'grossMargin' && p.gmByYear && p.revenueByYear) { const revenue = num(p.revenueByYear[period]), profit = num(p.gmByYear[period]); return revenue !== null && revenue !== 0 && profit !== null ? profit / revenue : null; } const keys = { revenue: ['revenueByYear', 'revenue'], grossMargin: ['grossMarginByYear', 'grossMargin', 'gm'], tam: ['tamByYear', 'tam'], npi: ['npiRevenue', 'npi'], tooling: ['toolingByYear', 'tooling'], rnd: ['rndByYear', 'rnd', 'rAndD'], budget: ['budgetByYear', 'budget'], units: ['unitsByYear', 'units'] }; for (const k of keys[metric] || [metric]) { const v = p[k]; if (finite(v)) return num(v); if (v && typeof v === 'object') { const found = v[period] ?? v[String(period)] ?? v[periodLabel(period)]; if (finite(found)) return num(found); } } const record = p.years?.[period] || p.metrics?.[period] || p.values?.find?.(v => String(v.period) === String(period)); return num(record?.[metric]); }
  function categoryBreakdown(metric = 'revenue') {
    const result = (allCategoriesSelected() ? getCategories() : selectedCategories()).map(category => { const filtered = (data().products || []).filter(p => p.category === category); let value = sum(filtered.map(p => productValue(p, metric))); try { const s = engine().summarize?.({ period: state.period, category }); if (s) value = valueOf(metric, s); } catch (_) {} return { category, value }; }).filter(r => finite(r.value)); return result.sort((a, b) => b.value - a.value);
  }
  function breakdown(metric = 'revenue', limit = 6) { const entries = categoryBreakdown(metric).slice(0, limit); const total = sum(entries.map(r => r.value)); if (!entries.length) return empty('Category breakdown unavailable', 'The workbook source has not supplied values for this measure by category.'); return `<div class="breakdown-list">${entries.map((r, i) => `<div class="breakdown-row"><div class="breakdown-top"><span class="breakdown-name"><i class="legend-dot" style="background:${categoryColor(r.category)}"></i>${escape(r.category)}</span><span class="breakdown-value">${fmt(r.value, metricUnit(metric))}</span></div><div class="bar-track"><div class="bar-fill" style="background:${categoryColor(r.category)};width:${Math.max(0, total ? r.value / total * 100 : 0)}%"></div></div></div>`).join('')}</div>`; }
  function insights() {
    const s = summary(), rev = valueOf('revenue', s), target = valueOf('revenueTarget', s), gm = valueOf('grossMargin', s), raw = valueOf('rawMargin', s), change = yoy('revenue'), byCat = categoryBreakdown(); const rows = [];
    if (finite(rev) && finite(target) && target !== 0) { const gap = rev - target; rows.push({ icon: 'target', tone: gap >= 0 ? 'green' : 'yellow', title: gap >= 0 ? 'Plan ahead of target' : 'Revenue target gap', text: `<strong>${fmt(Math.abs(gap))}</strong> ${gap >= 0 ? 'above' : 'below'} the workbook target in ${periodLabel(state.period)}. Attainment is <strong>${(rev / target * 100).toFixed(1)}%</strong>.` }); }
    if (finite(change)) rows.push({ icon: 'performance', tone: 'teal', title: isProjection(state.period) ? 'Planned growth' : 'Year-over-year movement', text: `${periodLabel(state.period)} revenue ${change >= 0 ? 'rises' : 'falls'} <strong>${Math.abs(change).toFixed(1)}%</strong> from the previous source year. ${isProjection(state.period) ? 'This is a workbook projection.' : 'Source periods may use different reporting bases.'}` });
    if (finite(gm) && finite(raw) && Math.abs(gm - raw) > .0001) rows.push({ icon: 'shield', tone: 'yellow', title: 'Margin has two definitions', text: `Published adjusted GM is <strong>${fmt(gm, 'percent')}</strong>; unadjusted product GM is <strong>${fmt(raw, 'percent')}</strong>. Review the adjustment before comparing margins.` });
    if (rows.length < 3 && byCat.length && finite(rev) && rev !== 0) rows.push({ icon: 'products', tone: '', title: 'Largest revenue category', text: `<strong>${escape(byCat[0].category)}</strong> contributes ${fmt(byCat[0].value)} in the selected year. Concentration is ${(byCat[0].value / rev * 100).toFixed(1)}% of the current scope.` });
    if (!rows.length) rows.push({ icon: 'info', tone: '', title: 'Data is ready to inspect', text: 'Open Source & quality to understand the workbook definitions and availability before making a decision.' });
    return rows.slice(0, 3).map(r => `<div class="insight"><div class="insight-icon ${r.tone}">${icon(r.icon)}</div><div><h3>${r.title}</h3><p>${r.text}</p></div></div>`).join('');
  }
  function pipelineDonut() {
    const products = rows(); const counts = new Map(); products.forEach(p => { const key = p.status || p.stage || p.lifecycle || 'Unspecified'; counts.set(key, (counts.get(key) || 0) + 1); }); const entries = [...counts.entries()]; const total = products.length;
    if (!total) return empty('Product stages unavailable', 'Product stage labels were not available in this source scope.');
    let offset = 0; const radius = 49, circumference = 2 * Math.PI * radius;
    const rings = entries.map(([label, count], i) => { const len = count / total * circumference; const path = `<circle cx="70" cy="70" r="${radius}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="13" stroke-dasharray="${len - .5} ${circumference}" stroke-dashoffset="${-offset}" transform="rotate(-90 70 70)"><title>${escape(label)}: ${count}</title></circle>`; offset += len; return path; }).join('');
    return `<div class="donut-layout"><svg class="donut-chart" viewBox="0 0 140 140" role="img" aria-label="Product stage distribution">${rings}<text x="70" y="69" text-anchor="middle" fill="#D5D7DC" font-size="27" font-family="Jost,Arial">${total}</text><text x="70" y="88" text-anchor="middle" fill="#9B9EA5" font-size="9" font-family="Jost,Arial">PRODUCTS</text></svg><div class="donut-legend">${entries.map(([label, count], i) => `<div><span><i class="legend-dot" style="background:${colors[i % colors.length]}"></i>${escape(label)}</span><strong>${count}</strong></div>`).join('')}</div></div>`;
  }
  function overview() {
    if (hasDrill() || isProductComparison()) return scopedOverview();
    const s = summary(), revenue = valueOf('revenue', s), gm = valueOf('grossMargin', s), tam = valueOf('tam', s), npi = valueOf('npi', s); const prodCount = finite(s.productCount) ? s.productCount : rows().length;
    return `<div class="kpi-grid">${kpi('revenue', isProjection(state.period) ? 'Projected revenue' : 'Source revenue', revenue, colors[0])}${kpi('grossMargin', marginLabel(s), gm, colors[1], '<span class="kpi-change neutral">Workbook calculation</span>', 'percent')}${kpi('tam', 'Market opportunity · COY TAM', tam, colors[3], '<span class="kpi-change neutral">Source market estimate</span>')}${kpi('npi', 'NPI cohort · source revenue', npi, colors[4], '<span class="kpi-change neutral">Actual / plan status unresolved</span>')}</div>
      <div class="grid-main"><section class="panel"><div class="panel-head"><div><h2>The revenue outlook</h2><p>Source history and the retained workbook plan</p></div>${isComparison()?'':`<div class="chart-legend"><span><i class="legend-dot" style="background:${selectedCategories().length===1?categoryColor(selectedCategories()[0]):colors[0]}"></i>Revenue</span><span><i class="legend-dash"></i>Target</span></div>`}</div><div class="chart-wrap">${lineChart('revenue', { target: true })}</div><div class="chart-note">${icon('info')}Shaded years are workbook projections. Select a point to inspect its source.</div></section><section class="panel"><div class="panel-head"><div><h2>What the numbers say</h2><p>Focused insights for ${escape(periodLabel(state.period))}</p></div>${icon('spark')}</div><div class="insight-list">${insights()}</div><div class="panel-foot"><span>Derived from the selected source scope</span><button class="text-link" data-go="performance">Explore performance →</button></div></section></div>
      <div class="grid-equal"><section class="panel"><div class="panel-head"><div><h2>Where revenue comes from</h2><p>Category contribution · ${escape(periodLabel(state.period))}</p></div><button class="text-link" data-go="products">View products →</button></div>${breakdown('revenue')}<div class="small-stat-row"><div class="small-stat"><div class="label">Products in scope</div><div class="value">${fmt(prodCount, 'number')}</div></div><div class="small-stat"><div class="label">Revenue target</div><div class="value">${fmt(valueOf('revenueTarget', s))}</div></div><div class="small-stat"><div class="label">Target attainment</div><div class="value">${revenue !== null && valueOf('revenueTarget', s) ? (revenue / valueOf('revenueTarget', s) * 100).toFixed(1) + '<span>%</span>' : '—'}</div></div></div></section><section class="panel"><div class="panel-head"><div><h2>Portfolio composition</h2><p>Source product lifecycle labels</p></div><button class="text-link" data-go="products">Explore pipeline →</button></div>${pipelineDonut()}<div class="risk-bar">${icon('info')}<span><strong>Read the source definitions.</strong> Lifecycle stages and NPI flags are distinct workbook concepts.</span></div></section></div>`;
  }
  function performance() {
    const labels = hasDrill() || isProductComparison() ? { revenue: 'Revenue', grossProfit: 'Gross profit', grossMargin: 'Gross margin', budget: 'PD investment', units: 'Units' } : { revenue: 'Revenue', grossMargin: 'Gross margin', tam: 'Market opportunity', npi: 'NPI revenue' };
    if (!Object.hasOwn(labels, state.metric)) state.metric = 'revenue';
    const s = summary(), current = valueOf(state.metric, s), change = yoy(state.metric), series = allSeries(state.metric);
    const annualPlans = state.metric === 'revenue' && !isProductComparison() && activeDrill?.scope?.level === 'project' ? activeDrill.estimateSeries || activeDrill.metricSeries?.revenueEstimate || [] : [];
    const showAnnualPlan = annualPlans.some(point => finite(point.value));
    const basis = hasDrill() || isProductComparison() ? pointBasis(series.find(point => String(point.period) === String(state.period))) : sourceKind(state.period);
    const chartNote = hasDrill() || isProductComparison() ? 'Source amounts stay at their recorded scope. Dotted tracker records have no actual/plan classification. Dashed launch-year estimates use an explicit source fiscal year; 12-month plans stay outside the annual graph. Empty years remain unavailable.' : 'A workbook projection is not a statistical prediction. Inspect each point for its source values and calculation.';
    return `<section class="panel" data-performance-scope="${escape(isProductComparison() ? 'product-comparison' : activeDrill?.scope?.level || 'category')}"><div class="panel-head wide"><div><h2>${escape(labels[state.metric])} through time</h2><p>${escape(scopeLabel())} · annual fiscal source values</p></div><div class="metric-tabs">${Object.entries(labels).map(([key, label]) => `<button class="metric-tab ${state.metric === key ? 'active' : ''}" data-select-metric="${key}">${label}</button>`).join('')}</div></div><div class="performance-summary"><div><div class="eyebrow">${escape(periodLabel(state.period))} · ${escape(basis)}</div><div class="large-value">${fmt(current, metricUnit(state.metric))}</div></div>${finite(change) ? `<div class="delta ${change < 0 ? 'negative' : ''}">${change >= 0 ? '+' : ''}${change.toFixed(1)}% vs prior source year</div>` : ''}</div><div class="chart-wrap">${lineChart(state.metric, { target: state.metric === 'revenue', color: colors[0] })}</div><div class="forecast-callout">${icon('info')}<div>${escape(chartNote)}</div></div>${hasDrill() || isProductComparison() ? drillEconomics() : ''}</section><section class="panel view-section"><div class="panel-head"><div><h2>Year-by-year evidence</h2><p>Exact values and source basis for ${escape(scopeLabel())}</p></div></div><div class="table-scroll" style="margin-top:17px"><table><thead><tr><th>Year / basis</th><th class="number">${escape(labels[state.metric])}</th>${showAnnualPlan ? '<th class="number">Current annual plan</th>' : ''}<th class="number">YoY</th><th>Source</th></tr></thead><tbody>${series.map((point, index, entries) => { const planPoint = annualPlans.find(record => String(record.period) === String(point.period)), previous = entries[index - 1], change = previous && finite(point.value) && finite(previous.value) && previous.value !== 0 ? (point.value / previous.value - 1) * 100 : null; return `<tr class="data-row" tabindex="0" data-chart-metric="${state.metric}" ${isProductComparison() ? 'data-chart-selection="true"' : scopeAttributes()} data-period="${escape(point.period)}"><td><span class="product-name">${escape(periodLabel(point.period))}</span><span class="subtext">${escape(hasDrill() || isProductComparison() ? pointBasis(point) : sourceKind(point.period))}</span></td><td class="number">${fmt(point.value, metricUnit(state.metric), true)}</td>${showAnnualPlan ? `<td class="number" data-annual-plan-period="${escape(point.period)}">${fmt(planPoint?.value, 'currency', true)}${finite(planPoint?.value) ? `<button type="button" class="text-link subtext" data-chart-metric="revenueEstimate" ${scopeAttributes()} data-period="${escape(point.period)}" aria-label="Inspect ${escape(periodLabel(point.period))} current annual plan source">Inspect plan source ↗</button>` : ''}</td>` : ''}<td class="number">${finite(change) ? `${change >= 0 ? '+' : ''}${change.toFixed(1)}%` : '—'}</td><td><span class="${finite(point.value) ? 'text-link' : 'subtext'}">${finite(point.value) ? 'Inspect source ↗' : 'No reported value'}</span></td></tr>`; }).join('')}</tbody></table></div></section>`;
  }
  function productTable(list, compact = false) {
    if (!list.length) return empty('No products match this view', 'Try a different category or product name.');
    return `<div class="table-scroll"><table><thead><tr><th>Product</th><th>Category / stage</th><th>Launch / NPI</th><th class="number"><button class="sort-button" data-sort="revenue">Revenue ↓</button></th><th class="number">Product GM</th>${compact ? '' : '<th class="number">Units</th>'}<th></th></tr></thead><tbody>${list.map((p, i) => { const index = (data().products || []).indexOf(p), id = p.id ?? p.productId ?? p.name ?? i; const status = p.status || p.stage || p.lifecycle || 'Unspecified'; const launch = p.launchYear ?? p.launchDate ?? p.launch ?? '—'; const npi = p.isNpi ?? p.isNPI ?? p.npiFlag ?? /npi|new/i.test(status); return `<tr class="data-row" tabindex="0" data-product-detail="${escape(id)}"><td><span class="product-name">${escape(p.name || p.product || p.description || id)}</span><span class="subtext">${escape(p.sku || p.model || p.id || '')}</span></td><td>${escape(p.category || 'Unspecified')}<span class="subtext">${escape(status)}</span></td><td>${escape(launch)}${npi ? '<span class="subtext"><span class="tag tag-purple">NPI</span></span>' : ''}</td><td class="number">${fmt(productValue(p, 'revenue'))}</td><td class="number">${fmt(productValue(p, 'grossMargin'), 'percent')}</td>${compact ? '' : `<td class="number">${fmt(productValue(p, 'units'),'number')}</td>`}<td class="product-actions"><button type="button" class="text-link" data-drill-product="${escape(id)}">Explore →</button><button type="button" class="text-link" data-product-detail="${escape(id)}">Source detail</button></td></tr>`; }).join('')}</tbody></table></div>`;
  }
  function filteredProducts() { const query = state.query.trim().toLowerCase(); return rows().filter(p => !query || [p.name, p.product, p.description, p.id, p.sku, p.category, p.status, p.stage].filter(Boolean).join(' ').toLowerCase().includes(query)).sort((a, b) => (productValue(b, state.sort) ?? -Infinity) - (productValue(a, state.sort) ?? -Infinity)); }
  function decisionPanel() {
    const scope = (data().decisions || []).filter(inCaseScope);
    const actions = [...new Set(scope.map(r => r.action))];
    const records = scope.filter(r => state.decisionAction === 'all' || r.action === state.decisionAction);
    return `<section class="panel view-section"><div class="panel-head"><div><h2>${state.skuId ? 'Parent project decisions · context' : 'Workbook decision playbook'}</h2><p>${state.skuId ? 'Project evidence is not allocated to this SKU' : hasDrill() ? 'Saved recommendations · selected linked projects · source-defined horizon' : 'Saved recommendations · category scope · source-defined horizon'}</p></div><span class="tag tag-yellow">SOURCE RECOMMENDATIONS</span></div><div style="padding:0 23px"><div class="segment-control"><button data-decision-action="all" class="${state.decisionAction === 'all' ? 'active' : ''}">All actions · ${scope.length}</button>${actions.map(action => `<button data-decision-action="${escape(action)}" class="${state.decisionAction === action ? 'active' : ''}">${escape(action)} · ${scope.filter(r => r.action === action).length}</button>`).join('')}</div></div>${records.length ? `<div class="table-scroll"><table><thead><tr><th>Project / case</th><th>Category</th><th>Suggested action</th><th>Source assessment</th><th></th></tr></thead><tbody>${records.map(r => `<tr class="data-row" tabindex="0" data-decision-detail="${escape(r.id)}"><td><span class="product-name">${escape(r.name)}</span><span class="subtext">${escape(r.details?.Bud_Key || '')}</span></td><td>${escape(r.category)}</td><td><span class="tag ${/Recovery|exit/i.test(r.action) ? 'tag-yellow' : 'tag-purple'}">${escape(r.action)}</span></td><td>${escape(r.details?.Assesstment || r.details?.Assessment || r.details?.Assesment || r.details?.['Tracking Signal'] || r.details?.['ROI Band'] || 'Review source')}</td><td>${icon('chevron')}</td></tr>`).join('')}</tbody></table></div>` : empty('No saved decisions in this scope', 'Choose another action or category to see the workbook recommendations.')}<div class="risk-bar">${icon('info')}<span>These are saved workbook decisions. Source ROI, status, lookup alignment, and actuals cutoff findings must be reviewed before acting.</span></div></section>`;
  }
  function npiCasesPanel() {
    const records = (data().npiValues || []).filter(inCaseScope);
    if (!records.length) return '';
    return `<section class="panel view-section"><div class="panel-head"><div><h2>${state.skuId ? 'Parent project NPI cases · context' : 'NPI case performance'}</h2><p>${state.skuId ? 'Parent project evidence only · not SKU ROI or investment' : 'Latest saved source cases · period basis varies by case'}</p></div><span class="tag tag-yellow">SOURCE STATUS UNVERIFIED</span></div><details class="case-explorer" style="margin:18px 0 0"><summary style="padding:0 23px 18px;font-size:11px;color:var(--secondary);cursor:pointer">Explore all ${records.length} project-specific cases</summary><div class="table-scroll"><table><thead><tr><th>Project / variant</th><th>Source data status</th><th class="number">12M revenue</th><th class="number">Source ROI</th><th>Band / signal</th><th></th></tr></thead><tbody>${records.map(r => `<tr class="data-row" tabindex="0" data-npi-detail="${escape(r.id)}"><td><span class="product-name">${escape(r.name)}</span><span class="subtext">${escape(r.id)}</span></td><td><span class="tag ${r.dataStatus === 'Projection' ? 'tag-purple' : 'tag-yellow'}">${escape(r.dataStatus || 'Unspecified')}</span></td><td class="number">${fmt(r.revenue)}</td><td class="number">${finite(r.roi) ? Number(r.roi).toFixed(2) + '×' : '—'}</td><td>${escape(r.roiBand || '—')}<span class="subtext">${escape(r.signal || '')}</span></td><td>${icon('chevron')}</td></tr>`).join('')}</tbody></table></div></details><div class="metric-notes">Each row is a distinct source project or variant. Source ROI is a saved gross-profit / PD-spend ratio, not a group-level return or annual growth rate. Source “Actuals” labels are unverified because the quarterly import has no actual / plan flag.</div></section>`;
  }
  function riskDiagnosticPanel() {
    const q = data().quality?.postPorDiagnostic; if (!q) return '';
    return `<section class="panel view-section"><div class="panel-head"><div><h2>Capital at risk · audit diagnostic</h2><p>All-portfolio post-POR source cases · not year/category filtered</p></div><span class="tag tag-yellow">DIAGNOSTIC RECOMPUTATION</span></div><div class="investment-highlight"><div class="metric"><div class="label">Aligned capital-at-risk ratio</div><div class="value">${fmt(q.alignedCapitalAtRiskPct, 'percent')}</div></div><div class="metric"><div class="label">Aligned spend at risk</div><div class="value">${fmt(q.alignedCapitalAtRisk)}</div></div><div class="metric"><div class="label">Workbook cached ratio</div><div class="value">${fmt(q.workbookCapitalAtRiskPctCache, 'percent')}</div></div></div><div class="metric-notes">The audit aligns PD spend, source status, ROI band, and tracking signal by the same project row. The original cached ratio is retained for comparison. Source “Actuals” still means matched source quarters; it does not confirm the stated actuals cutoff. This diagnostic requires review before use as an investment decision.</div><div class="panel-foot"><span>${fmt(q.records, 'number')} project cases · ${fmt(q.sourceActualStatusRecords, 'number')} source “Actuals” · ${fmt(q.projectionRecords, 'number')} projections</span><button class="text-link" data-risk-detail="true">Review diagnostic →</button></div></section>`;
  }
  function products() { if (isProductComparison()) return scopedOverview(); if (hasDrill()) return scopedOverview() + npiCasesPanel() + decisionPanel(); const s = summary(), all = rows(), npiProducts = all.filter(p => p.isNpi ?? p.isNPI ?? p.npiFlag ?? /npi|new/i.test(p.status || p.stage || '')); return `<div class="display-grid">${kpi('productCount', 'Products in selected scope', finite(s.productCount) ? s.productCount : all.length, colors[0], '<span class="kpi-change neutral">Source product records</span>', 'number')}${kpi('npi', 'NPI cohort source revenue', valueOf('npi', s), colors[3], '<span class="kpi-change neutral">Workbook NPI definition</span>')}${kpi('npiCount', 'NPI products in source year', finite(s.npiCount) ? s.npiCount : npiProducts.length, colors[4], '<span class="kpi-change neutral">Imported product-quarter cohort</span>', 'number')}</div><div class="grid-equal"><section class="panel"><div class="panel-head"><div><h2>New product impact</h2><p>Imported NPI cohort revenue · fiscal year</p></div><span class="tag tag-yellow">STATUS UNRESOLVED</span></div><div class="chart-wrap">${barsChart('npi')}</div><div class="chart-note">${icon('info')}Tracker cohort includes launches from FY24 onward. Actual / plan status is unresolved; future missing values remain unavailable.</div></section><section class="panel"><div class="panel-head"><div><h2>Lifecycle mix</h2><p>Products in the selected category scope</p></div></div>${pipelineDonut()}</section></div><section class="panel"><div class="panel-head"><div><h2>Product explorer</h2><p>Select a product to inspect its values and supporting cells.</p></div></div><div class="table-toolbar"><input id="product-search" class="search-input" placeholder="Search products, category, or stage…" value="${escape(state.query)}" aria-label="Search products"><span class="table-meta" id="product-count">${filteredProducts().length} products · sorted by revenue</span></div><div id="product-table">${productTable(filteredProducts())}</div></section>${npiCasesPanel()}${decisionPanel()}`; }
  function investment() { if (hasDrill() || isProductComparison()) return scopedInvestment(); const s = summary(); const investments = data().investments || []; const selected = investments.filter(r => (inCategoryScope(r.category)) && (!r.period || String(r.period) === String(state.period))); const rnd = valueOf('rnd', s), tooling = valueOf('tooling', s), budget = valueOf('budget', s); return `<div class="display-grid">${kpi('budget', 'Source PD spend', budget, colors[0], '<span class="kpi-change neutral">Fiscal source spend records</span>')}${kpi('rnd', 'Other PD spend · NRE / IUR', rnd, colors[2], '<span class="kpi-change neutral">Excludes tooling / compliance</span>')}${kpi('tooling', 'Tooling investment', tooling, colors[5], '<span class="kpi-change neutral">Source tooling records</span>')}</div><div class="grid-equal"><section class="panel"><div class="panel-head"><div><h2>PD spend through time</h2><p>Source spend records by fiscal year</p></div></div><div class="chart-wrap">${lineChart('budget', { color: colors[1] })}</div><div class="chart-note">${icon('info')}Blank investment values are unavailable, not zero.</div></section><section class="panel"><div class="panel-head"><div><h2>Investment and opportunity</h2><p>Selected ${escape(periodLabel(state.period))} source scope</p></div></div><div class="investment-highlight"><div class="metric"><div class="label">Market opportunity · TAM</div><div class="value">${fmt(valueOf('tam', s))}</div></div><div class="metric"><div class="label">Period alignment</div><div class="value" style="font-size:17px">FY revenue / COY TAM</div></div></div><div class="metric-notes">TAM is recorded by calendar year (COY). Revenue uses a November fiscal year. The two bases must align before calculating market share. Source R&D, NRE, IUR, tooling, and compliance definitions also require separate mapping.</div><div class="risk-bar">${icon('warning')}<span>Return on investment requires aligned spend timing and incremental profit. Those inputs must be verified before an ROI score is shown.</span></div></section></div><section class="panel"><div class="panel-head"><div><h2>Investment source detail</h2><p>Traceable budget and investment records</p></div><button class="text-link" data-go="source">Inspect source tabs →</button></div>${selected.length ? `<div class="table-scroll" style="margin-top:19px"><table><thead><tr><th>Record</th><th>Category</th><th>Type</th><th class="number">Amount</th><th>Source</th></tr></thead><tbody>${selected.slice(0, 100).map(r => `<tr><td>${escape(r.name || r.product || r.description || 'Source record')}</td><td>${escape(r.category || '—')}</td><td>${escape(r.type || r.kind || 'Budget')}</td><td class="number">${fmt(r.amount ?? r.value, 'currency', true)}</td><td>${escape(r.sheet || r.source?.sheet || 'Workbook')}</td></tr>`).join('')}</tbody></table></div>` : empty('Investment detail requires definition mapping', 'Budget, R&D, tooling, and archived operating expenses use different source structures. Unverified spend has been kept out of derived ROI and growth calculations.')}<div class="panel-foot"><span>Preserve timing and accounting scope</span><button class="text-link" data-go="scenarios">Explore a spend scenario →</button></div></section>${riskDiagnosticPanel()}`; }
  function scenarioResults() { const s = summary(), revenue = valueOf('revenue', s), margin = valueOf('grossMargin', s), budget = valueOf('budget', s), normalizedMargin = margin; const out = { revenue: revenue === null ? null : revenue * (1 + state.revenueGrowth / 100), grossMargin: normalizedMargin === null ? null : normalizedMargin + state.marginChange / 100, budget: budget === null ? null : budget * (1 + state.budgetChange / 100) }; out.grossProfit = out.revenue !== null && out.grossMargin !== null ? out.revenue * out.grossMargin : null; out.baselineGrossProfit = revenue !== null && normalizedMargin !== null ? revenue * normalizedMargin : null; return { ...out, baselineRevenue: revenue, baselineMargin: normalizedMargin, baselineBudget: budget }; }
  function scenarioOutput() { const s = scenarioResults(); return `<div class="kpi-grid">${kpi('revenue', 'Scenario revenue', s.revenue, colors[0], `<span class="kpi-change neutral">${state.revenueGrowth >= 0 ? '+' : ''}${state.revenueGrowth.toFixed(1)}% assumption</span>`)}${kpi('grossMargin', 'Scenario GM · selected basis', s.grossMargin, colors[3], `<span class="kpi-change neutral">${percentPoints(state.marginChange)} assumption</span>`, 'percent')}</div><div class="scenario-comparison"><span>Revenue</span><div class="value"><span>${fmt(s.baselineRevenue)}</span><span>→</span><strong>${fmt(s.revenue)}</strong></div></div><div class="scenario-comparison"><span>Modeled profit · selected GM</span><div class="value"><span>${fmt(s.baselineGrossProfit)}</span><span>→</span><strong>${fmt(s.grossProfit)}</strong></div></div><div class="scenario-comparison"><span>Source PD spend</span><div class="value"><span>${fmt(s.baselineBudget)}</span><span>→</span><strong>${fmt(s.budget)}</strong></div></div><div class="model-notice"><strong>Illustrative driver simulation · ${escape(periodLabel(state.period))}</strong><br>Margin basis: ${escape(summary().marginBasis || 'Selected source definition')}.<br>Revenue = source revenue × (1 + revenue assumption). GM = source selected-basis GM + margin percentage points. Source ratios and modeled outcomes are not silently capped. Modeled profit = scenario revenue × scenario selected-basis GM. This differs from raw product gross profit. PD spend changes do not automatically create revenue growth. Assumptions stay local and are retained in this view’s URL.</div>`; }
  function scenarios() { return `<div class="scenario-grid"><section class="panel scenario-controls"><h2>Choose your assumptions</h2><div class="slider-control"><div class="slider-label"><label for="revenue-slider">Revenue change</label><output id="revenue-output">${state.revenueGrowth >= 0 ? '+' : ''}${state.revenueGrowth.toFixed(1)}%</output></div><input id="revenue-slider" data-slider="revenueGrowth" type="range" min="-30" max="30" step=".5" value="${state.revenueGrowth}"><div class="slider-range"><span>−30%</span><span>Source baseline</span><span>+30%</span></div></div><div class="slider-control"><div class="slider-label"><label for="margin-slider">Margin change</label><output id="margin-output">${percentPoints(state.marginChange)}</output></div><input id="margin-slider" data-slider="marginChange" type="range" min="-10" max="10" step=".1" value="${state.marginChange}"><div class="slider-range"><span>−10 pp</span><span>Selected GM basis</span><span>+10 pp</span></div></div><div class="slider-control"><div class="slider-label"><label for="budget-slider">PD spend change</label><output id="budget-output">${state.budgetChange >= 0 ? '+' : ''}${state.budgetChange.toFixed(1)}%</output></div><input id="budget-slider" data-slider="budgetChange" type="range" min="-30" max="30" step=".5" value="${state.budgetChange}"><div class="slider-range"><span>−30%</span><span>Source PD spend</span><span>+30%</span></div></div><button class="button" id="reset-scenario">Reset to source baseline</button><p>The selected year and explorer scope define the baseline. Missing revenue, margin, or SKU investment stays unavailable. The controls show sensitivity to assumptions. They do not change the imported workbook or constitute a fitted prediction.</p></section><section class="panel scenario-result"><div class="panel-head" style="padding:0"><div><h2>Your scenario, made clear</h2><p>${isComparison()?'Combined selection · ':''}${escape(scopeLabel())} · Baseline → simulated outcome · ${escape(periodLabel(state.period))}</p></div><span class="forecast-pill">SIMULATION</span></div><div id="scenario-output">${scenarioOutput()}</div></section></div><section class="panel view-section"><div class="panel-head"><div><h2>From projections to reliable prediction</h2><p>Additional analytical capabilities the source can support when inputs are complete</p></div></div><div class="insight-list"><div class="insight"><div class="insight-icon teal">${icon('performance')}</div><div><h3>Compare growth drivers</h3><p>Separate units, realized price, product mix, launch timing, and margin adjustments. The migration should retain the workbook's calculations before introducing new statistical models.</p></div></div><div class="insight"><div class="insight-icon green">${icon('target')}</div><div><h3>Measure forecast reliability</h3><p>Add comparable monthly actuals, locked forecast vintages, and observed outcomes. Use backtesting and error ranges to quantify how much confidence a projection deserves.</p></div></div><div class="insight"><div class="insight-icon yellow">${icon('shield')}</div><div><h3>Make uncertainty visible</h3><p>Use explicit assumptions and validated ranges for demand, price, launch delay, and spend. Unconfirmed inputs should remain missing until mapped and reviewed.</p></div></div></div></section>`; }
  function issues() { const q = data().quality || {}; return Array.isArray(q) ? q : q.issues || data().issues || []; }
  function sheetList() { const q = state.sheetQuery.toLowerCase(); return (data().sheets || []).filter(s => !q || [s.name, s.purpose, s.role, s.state].filter(Boolean).join(' ').toLowerCase().includes(q)); }
  function sheetCards() { return sheetList().map((sheet, i) => `<button class="sheet-card" data-sheet-detail="${escape(sheet.name)}"><div class="sheet-card-head"><h3>${escape(sheet.name)}</h3><span class="tag ${sheet.state === 'hidden' || sheet.hidden ? '' : 'tag-purple'}">${escape(sheet.state || (sheet.hidden ? 'hidden' : 'visible'))}</span></div><p>${escape(sheet.purpose || sheet.role || 'Workbook tab; purpose mapping is pending.')}</p><div class="sheet-stats"><span>${fmt(sheet.formulas ?? sheet.formulaCount ?? sheet.stats?.formulas, 'number')} formulas</span><span>${fmt(sheet.cells ?? sheet.contentCells, 'number')} source cells</span>${finite(sheet.errorCount) && sheet.errorCount > 0 ? `<span style="color:#ffb3b3">${sheet.errorCount} errors</span>` : ''}</div></button>`).join('') || empty('No tabs match', 'Search for a tab name, purpose, or visibility state.'); }
  function source() {
    const d = data(), source = d.source || {}, sheets = d.sheets || [], q = d.quality || {}, list = issues(); const formulas = q.formulaCount ?? q.totalFormulas ?? d.formulaCount ?? d.audit?.formulaCount ?? sum(sheets.map(s => s.formulas ?? s.formulaCount)); const errors = q.errorCount ?? q.totalErrors ?? sum(sheets.map(s => s.errorCount)); const hidden = sheets.filter(s => /hidden/i.test(s.state) || s.hidden).length;
    return `<div class="source-summary"><div class="source-stat"><label>Workbook tabs</label><strong>${sheets.length || '—'}</strong><small>${hidden} hidden tabs included</small></div><div class="source-stat"><label>Formula cells</label><strong>${fmt(formulas, 'number')}</strong><small>Cached source values retained</small></div><div class="source-stat"><label>Source cell errors</label><strong>${fmt(errors, 'number')}</strong><small>Workbook error values</small></div><div class="source-stat"><label>Review findings</label><strong>${list.length}</strong><small>Definitions, consistency, and readiness</small></div></div><section class="panel"><div class="quality-summary"><div class="quality-icon">${icon(list.length ? 'warning' : 'shield')}</div><div><h3>${list.length ? 'Understand the source before predicting' : 'Source quality findings'}</h3><p>${escape(source.name || source.filename || source.fileName || 'HX GBU Blueprint V2.xlsm')} · imported snapshot</p></div><div class="quality-count">${list.length}<small>review findings</small></div></div><div class="issue-list">${list.length ? list.map((issue, i) => `<div class="issue-row"><span class="tag ${/critical|high|error|block/i.test(issue.severity || '') ? 'tag-red' : 'tag-yellow'}">${escape(issue.severity || 'Review')}</span><div><h3>${escape(issue.title || issue.name || 'Source finding')}</h3><p>${escape(issue.detail || issue.description || issue.message || '')}</p>${issue.sheet || issue.cell ? `<button class="text-link" data-issue-detail="${i}">${escape(issue.sheet || 'Source')} ${escape(issue.cell || '')} ↗</button>` : ''}</div></div>`).join('') : '<div class="issue-row"><p>Source quality conclusions have not yet been supplied. An absence of findings here does not certify the workbook.</p></div>'}</div><div class="panel-foot"><span>Cached formulas are read; macros are not executed</span><button class="text-link" id="source-info-button">Import and provenance details →</button></div></section><div class="inventory-heading"><div><h2>The complete workbook</h2><p>All visible and hidden tabs, with their purpose and formula footprint.</p></div><input class="search-input" id="sheet-search" value="${escape(state.sheetQuery)}" placeholder="Search tabs or purpose…" aria-label="Search workbook tabs"></div><div class="inventory-grid" id="sheet-cards">${sheetCards()}</div>`;
  }
  function draw() {
    if (hasSource()) refreshDrillScope(true);
    document.body.classList.toggle('unified-analysis',hasSource());
    if(hasSource()&&window.HX_UNIFIED_WORKSPACE&&window.HX_ANALYSIS_CANVAS){
      const legacy=state.view;
      if(legacy!=='performance'&&legacy!=='overview')state.overlay=({products:'decisions',investment:'decisions',scenarios:'scenarios',source:'source'})[legacy]||state.overlay;
      state.view='performance';
      $('#portfolio-explorer').hidden=false;$('#page-title').textContent='Portfolio Blueprint';$('#page-description').textContent='Compare performance, test assumptions, and inspect the evidence in one canvas.';$('#breadcrumb-view').textContent='Portfolio Blueprint';
      if(!workspaceControl)workspaceControl=window.HX_UNIFIED_WORKSPACE.create({state,data,engine,drill:()=>activeDrill,format:fmt,scopeLabel,renderProducts:renderDrillExplorer,renderCategories:syncExplorerControls,selectPeriod,selectScope:selectDrillScope,redraw:draw,notify:notifyParent,openDialog,evidence,economics:drillEconomics,sourceContent:source,toast,dialogState:open=>{if(embedded&&window.parent!==window)window.parent.postMessage({type:'ppc:blueprint:dialog',open},location.origin);}});
      workspaceControl.update();
      $('#context-strip').innerHTML=`<span>${escape(sourceKind(state.period))} · ${escape(activeDrill?.summary?.basis||'Source snapshot')}</span><span class="spacer"></span><button type="button" class="text-link" data-analysis-tool="source">${issues().length} source findings</button>`;
      $('#footer-source').textContent=data().source?.name||'Workbook source';$('#source-badge').textContent='Local workbook snapshot';
      fillIcons();notifyParent();return;
    }
    const previousComparisonScale=$('.category-comparison')?.dataset.comparisonScale;
    const previousPaths = new Map($$('[data-chart-series]').map(path => [path.dataset.chartSeries,path.getAttribute('points')]));
    const [eyebrow, title, description] = views[state.view] || views.overview;
    $('#breadcrumb-view').textContent = state.view === 'products' ? 'Products & NPI' : state.view === 'source' ? 'Source & quality' : title.replace('Portfolio ', '');
    $('#page-eyebrow').textContent = eyebrow; $('#page-title').textContent = title; $('#page-description').textContent = description;
    $$('.nav-item').forEach(btn => { const active = btn.dataset.view === state.view; btn.classList.toggle('active', active); if (active) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current'); });
    $('#portfolio-explorer').hidden = !hasSource();
    if (!hasSource()) {
      $('#source-badge').textContent = 'No workbook loaded';
      $('#footer-source').textContent = 'No source imported';
      $('#view-content').innerHTML = `<section class="blueprint-empty"><div class="blueprint-empty-symbol" aria-hidden="true">↗</div><h2>Your portfolio plan, made clear.</h2><p>Import your HX Blueprint workbook to explore performance, products, investment, and growth scenarios together. Your source is saved only in this browser. Saved formula results are retained; macros are not run.</p><button type="button" class="button button-primary" data-import-workbook>Import Blueprint workbook</button></section>`;
      fillIcons(); notifyParent(); return;
    }
    syncExplorerControls();
    const scope = scopeLabel(), kind = sourceKind(state.period), findings = issues();
    $('#context-strip').innerHTML = `${icon('info')}<span><strong>${escape(periodLabel(state.period))} · ${escape(kind)}</strong> &nbsp; / &nbsp; ${escape(scope)} &nbsp; / &nbsp; Source snapshot</span><span class="spacer"></span><button class="text-link" data-go="source">${findings.length ? findings.length + ' source findings' : 'Inspect source'} →</button>`;
    $('#view-content').innerHTML = (isComparison()&&state.view!=='source'?`<p class="comparison-scope-note"><strong>${isProductComparison() ? 'Comparing ' + escape(scopeLabel()) : 'Comparing ' + selectedCategories().length + ' categories'}.</strong> Chart colors identify each ${isProductComparison() ? 'selected product' : 'category'}. ${isProductComparison() ? 'Summary figures require a value for every selected product; missing inputs keep the combined total unavailable.' : 'Summary figures and scenarios use the combined selection.'}</p>`:'') + ({ overview, performance, products, investment, scenarios, source }[state.view] || overview)();
    $('#footer-source').textContent = data().source?.name || data().source?.filename || data().source?.fileName || 'HX GBU Blueprint V2.xlsm';
    $('#source-badge').textContent = 'Workbook snapshot';
    fillIcons();
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && (!previousComparisonScale || previousComparisonScale === $('.category-comparison')?.dataset.comparisonScale)) {
      $$('[data-chart-series]').forEach(path => { const before=previousPaths.get(path.dataset.chartSeries), after=path.getAttribute('points'); if (!before || before===after || before.split(' ').length!==after.split(' ').length) return; const animation=document.createElementNS('http://www.w3.org/2000/svg','animate'); animation.setAttribute('attributeName','points'); animation.setAttribute('from',before); animation.setAttribute('to',after); animation.setAttribute('dur','.45s'); animation.setAttribute('calcMode','spline'); animation.setAttribute('keyTimes','0;1'); animation.setAttribute('keySplines','.22 .61 .36 1'); path.appendChild(animation); animation.beginElement(); });
    }
    notifyParent();
  }
  function fillIcons() { $$('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
  function setView(view, { replaceHistory = false } = {}) { if (!views[view]) return; timelineControl?.stop();if(workspaceControl){state.view='performance';state.overlay=({products:'decisions',investment:'decisions',scenarios:'scenarios',source:'source'})[view]||null;if(view==='scenarios')state.scenarioEnabled=true;workspaceControl.update();notifyParent();return;} state.view = view; $('#navigation').closest('.sidebar').classList.remove('open'); $('#menu-button').setAttribute('aria-expanded', 'false'); if (replaceHistory) history.replaceState(null, '', `#${scopeFragment(view)}`); else location.hash = scopeFragment(view); draw(); window.scrollTo({ top: 0, behavior: 'auto' }); }
  function evidence(refs) { if (!refs.length) return '<p class="formula-note">Cell-level source references were not supplied for this measure. Review the workbook inventory and mapping before treating this value as verified.</p>'; return refs.slice(0, 100).map(ref => { if (typeof ref === 'string') return `<div class="source-evidence">${escape(ref)}</div>`; return `<div class="source-evidence"><div class="source-ref"><strong>${escape(ref.sheet || ref.sheetName || 'Workbook')}!${escape(ref.cell || ref.address || ref.range || '')}</strong><span>${escape(ref.label || ref.role || '')}</span></div>${ref.formula ? `<pre class="source-formula">${escape(ref.formula)}</pre>` : ''}<p>Saved value: <strong>${escape(ref.value ?? ref.cached ?? ref.cachedValue ?? ref.result ?? 'Unavailable')}</strong></p>${ref.note ? `<p>${escape(ref.note)}</p>` : ''}</div>`; }).join(''); }
  function openDialog(title, content, eyebrow = 'SOURCE DETAIL') { if(workspaceControl&&document.body.classList.contains('unified-analysis')){workspaceControl.showDetail(title,content,eyebrow);fillIcons();return;} $('#dialog-title').textContent = title; $('#dialog-eyebrow').textContent = eyebrow; $('#dialog-content').innerHTML = content; fillIcons(); const dialog = $('#detail-dialog'); if (dialog.open) return; if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', ''); if(embedded&&window.parent!==window)window.parent.postMessage({type:'ppc:blueprint:dialog',open:true},location.origin); }
  function metricDetail(key, period = state.period, category = null, scope = {}) {
    const labels = { revenueEstimate: 'Current launch-year source plan', grossProfit: 'Source gross profit', units: 'Source units', revenue: 'Revenue', grossMargin: 'Published GM · adjusted', rawMargin: 'Raw product gross margin', revenueTarget: 'Revenue target', tam: 'Market opportunity · TAM', npi: 'NPI cohort · imported source revenue', budget: 'Source PD spend', rnd: 'Other PD spend · NRE / IUR', tooling: 'Tooling investment', productCount: 'Product count', npiCount: 'Products marked NPI' };
    const aggregate = isProductComparison() && !Object.keys(scope).length && !category, model = aggregate ? productComparison(key, period) : null;
    const filter = {...opts(), ...scope, period, ...(category ? {category} : {})}, drill = aggregate ? null : engine().drilldown?.(filter), s = aggregate ? model?.selectionSummary || {} : engine().summarize(filter), point = (aggregate ? model?.selectionSeries || [] : drill?.metricSeries?.[key] || engine().series(key, filter)).find(record => String(record.period) === String(period));
    const value = aggregate ? point?.value ?? null : valueOf(key,s) ?? point?.value, meta = data().metrics?.[key] || {};
    openDialog(key==='grossMargin'?(s.marginBasis || 'Source gross margin'):labels[key] || meta.label || key, `<div class="detail-grid"><div class="detail-field"><label>Reporting period</label><strong>${escape(periodLabel(period))}</strong></div><div class="detail-field"><label>Reporting basis</label><strong>${escape(point ? pointBasis(point) : sourceKind(period))}</strong></div><div class="detail-field"><label>Source value · precise</label><strong>${fmt(value, metricUnit(key), true)}</strong></div><div class="detail-field"><label>Selected scope</label><strong>${escape(aggregate ? scopeLabel() : drill?.scope?.title || category || scopeLabel())}</strong></div></div>${key==='grossMargin'?`<p class="formula-note"><strong>Displayed basis:</strong> ${escape(s.marginBasis)}</p>`:''}<p class="formula-note">${escape(meta.definition || meta.description || (key === 'revenueEstimate' ? 'Current launch-year source plan with an explicit source fiscal year. No locked original forecast vintage was supplied.' : key === 'grossMargin' && hasDrill() ? 'Gross profit divided by revenue within the same selected source scope. Tracker actual/plan classification remains unresolved.' : key === 'grossMargin' ? 'Published workbook gross margin includes adjustment logic. The unadjusted product gross profit / revenue definition is shown separately.' : 'This value is derived from the imported source snapshot. Projected periods retain the source planning assumptions.'))}</p>${key === 'grossMargin' ? `<div class="detail-field"><label>${hasDrill() ? 'Same-scope source gross margin' : 'Raw product GM · selected scope'}</label><strong>${fmt(valueOf('rawMargin', s), 'percent', true)}</strong></div>` : ''}${aggregate && !finite(value) ? '<p class="model-notice">The selected total is unavailable because every selected record must have a source value. Available source cells are retained for review; the parent scope is not substituted.</p>' : ''}<div class="detail-section"><h3>Supporting source cells</h3>${evidence(sourceRefs(key, period, category, scope))}</div>`);
  }
  function productCases(p) {
    const cases = p.npiCases || (data().npiValues || []).filter(c => c.name === p.name);
    if (!cases.length) return '';
    return `<div class="detail-section"><h3>Project-specific ROI cases · ${cases.length}</h3><p class="formula-note">Every matching project or variant is retained. A product group does not inherit an arbitrary first-match ROI or tracking signal. Source status labels remain subject to the actuals cutoff findings.</p><div class="table-scroll"><table><thead><tr><th>Project key</th><th class="number">Source ROI</th><th>Band / signal</th><th>Status</th></tr></thead><tbody>${cases.map(c=>`<tr class="data-row" tabindex="0" data-npi-detail="${escape(c.id)}"><td><span class="product-name">${escape(c.id)}</span><span class="subtext">${escape(c.name)}</span></td><td class="number">${finite(c.roi) ? c.roi.toFixed(4)+'×' : '—'}</td><td>${escape(c.roiBand || '—')}<span class="subtext">${escape(c.signal || '')}</span></td><td>${escape(c.dataStatus || 'Unspecified')}</td></tr>`).join('')}</tbody></table></div></div>`;
  }
  function productDetail(id) {
    const p = rows().find((r, i) => String(r.id ?? r.productId ?? r.name ?? i) === String(id)) || (data().products || []).find((r, i) => String(r.id ?? r.productId ?? r.name ?? i) === String(id)); if (!p) return;
    openDialog(p.name || p.product || p.description || id, `<div class="detail-grid">${[['Category', p.category], ['Stage / lifecycle', p.status || p.stage || p.lifecycle], ['Launch timing', p.launchYear ?? p.launchDate ?? p.launch], ['Source ID', p.id || p.sku || p.model]].map(([label, value]) => `<div class="detail-field"><label>${label}</label><strong>${escape(value ?? 'Unavailable')}</strong></div>`).join('')}</div><div class="table-scroll"><table><thead><tr><th>Year</th><th class="number">Revenue</th><th class="number">GM</th><th class="number">Units</th></tr></thead><tbody>${getPeriods().map(period => `<tr><td>${escape(periodLabel(period))}</td><td class="number">${fmt(productValue(p, 'revenue', period), 'currency', true)}</td><td class="number">${fmt(productValue(p, 'grossMargin', period), 'percent', true)}</td><td class="number">${fmt(productValue(p, 'units', period), 'number')}</td></tr>`).join('')}</tbody></table></div>${productCases(p)}<div class="detail-section"><h3>Supporting source</h3>${evidence(Array.isArray(p.source || p.sources) ? p.source || p.sources : p.source || p.sources ? [p.source || p.sources] : [])}</div>`, 'PRODUCT DETAIL');
  }
  function sheetDetail(name) {
    const s = (data().sheets || []).find(s => s.name === name); if (!s) return;
    const analysis = s.formulaAnalysis || {}, dimension = s.dimension || s.range || '', bounds = dimension.match(/([A-Z]+)(\d+):([A-Z]+)(\d+)/);
    const columnNumber = letters => [...letters].reduce((value,letter)=>value*26+letter.charCodeAt(0)-64,0);
    const rowCount = s.rows ?? s.rowCount ?? (bounds ? Number(bounds[4]) : null), columnCount = s.columns ?? s.columnCount ?? (bounds ? columnNumber(bounds[3]) : null);
    let samples = s.formulaExamples || s.samples || s.sampleFormulas || [];
    if (!Array.isArray(samples)) samples = Object.entries(samples).map(([cell, formula]) => ({ sheet:s.name, cell, formula }));
    const refs = samples.map(r => typeof r === 'string' ? r : {sheet:s.name,...r});
    const families = analysis.formulaFamilies || [];
    const deps = s.dependencies || Object.keys(analysis.sourceSheets || {});
    openDialog(s.name, `<p class="under-construction-note">${escape(s.purpose || s.role || 'Purpose mapping pending.')}</p><div class="detail-grid">${[['Visibility',s.state || (s.hidden ? 'hidden' : 'visible')],['Used-range rows',fmt(rowCount,'number')],['Used-range columns',fmt(columnCount,'number')],['Formula-bearing cells',fmt(s.formulas ?? s.formulaCount ?? analysis.formulaCells,'number')],['Cached error cells',fmt(s.errorCount,'number')],['Used range',dimension || 'Unavailable']].map(([label,value])=>`<div class="detail-field"><label>${label}</label><strong>${escape(value)}</strong></div>`).join('')}</div>${s.role ? `<div class="detail-field"><label>Current tab purpose</label><strong>${escape(s.role)}</strong></div>` : ''}${s.tables?.length ? `<div class="detail-section"><h3>Structured source tables</h3>${s.tables.map(t=>`<div class="source-evidence"><div class="source-ref"><strong>${escape(t.name)}</strong><span>${escape(t.ref)}</span></div><p>${escape((t.columns || []).join(' · '))}</p></div>`).join('')}</div>` : ''}${deps.length ? `<div class="detail-section"><h3>Source dependencies</h3><p>${escape(deps.join(', '))}</p></div>` : ''}${Object.keys(analysis.functions || {}).length ? `<div class="detail-section"><h3>Formula function footprint</h3><div class="segment-control">${Object.entries(analysis.functions).slice(0,24).map(([name,count])=>`<span class="tag">${escape(name)} · ${count}</span>`).join('')}</div></div>` : ''}${families.length ? `<div class="detail-section"><h3>Major formula families</h3><p class="formula-note">These are normalized patterns grouped for analysis. Row positions are represented by {r}; the patterns are not executable formulas.</p>${families.slice(0,12).map(f=>`<div class="source-evidence"><div class="source-ref"><strong>${f.count} cells in family</strong></div><pre class="source-formula">${escape(f.pattern)}</pre></div>`).join('')}</div>` : ''}${refs.length ? `<div class="detail-section"><h3>Source formula examples</h3>${evidence(refs)}</div>` : ''}${s.comments?.length ? `<div class="detail-section"><h3>Saved source annotations</h3>${s.comments.map(c=>`<div class="source-evidence"><div class="source-ref"><strong>${escape(c.cell)}</strong><span>${escape(c.author)}</span></div><p>${escape(c.text)}</p></div>`).join('')}</div>` : ''}`, 'WORKBOOK TAB');
  }
  function sourceInfo() { const s = data().source || {}; openDialog('Import & provenance', `<div class="detail-grid">${[['Source file', s.name || s.filename || s.fileName || 'HX Blueprint workbook'], ['Source timestamp', s.modifiedAt || s.modified || 'Not supplied'], ['Loaded at', s.loadedAt || s.importedAt || s.generatedAt || 'Not supplied'], ['Currency / unit', s.currency || s.unit || 'Source dollar values']].map(([label, value]) => `<div class="detail-field"><label>${label}</label><strong>${escape(value)}</strong></div>`).join('')}</div><div class="detail-section"><h3>How values reach this dashboard</h3><p>The imported workbook provides saved cell results and source formulas. The dashboard uses a mapped data model to keep category filters, product drilldowns, and reporting definitions consistent. It does not open Excel or execute VBA macros.</p><p>Formula results are the workbook's saved cache. A browser import does not recalculate Excel formulas. Formula changes require a validated calculation engine before the result can be accepted as a fresh calculated forecast.</p></div><div class="detail-section"><h3>Local processing</h3><p>Imports are processed locally and saved in this browser, separately from your retail and portfolio workspaces. Source validation and local saving must finish before a new source replaces the current one. A failed import keeps the previous source.</p></div>`, 'SOURCE PROVENANCE'); }
  let toastTimer; function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6500); }
  function loadFilters(preserve = false) {
    const categories = getCategories(), requested = Array.isArray(state.category) ? state.category : ['all'];
    const valid = [...new Set(requested.filter(category => categories.includes(category)))];
    state.category = requested.includes('all') || !valid.length ? ['all'] : categories.filter(category => valid.includes(category));
    refreshDrillScope(true);
    const periods = getPeriods();
    if (!periods.length) state.period = null;
    else if (!periods.some(period => String(period) === String(state.period))) state.period = periods.find(period => /^(2026|26|FY26|FY2026)$/.test(String(period))) || periods.at(-1);
    refreshDrillScope(true);
  }
  function applyPreferences(preferences = {}, { replace = false } = {}) {
    if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return false;
    const get = key => preferences instanceof URLSearchParams ? preferences.get(key) : preferences[key];
    const has = key => preferences instanceof URLSearchParams ? preferences.has(key) : Object.hasOwn(preferences, key);
    if (replace) Object.assign(state, { period: null, category: ['all'], comparisonScale: 'values', groupId: null, projectId: null, skuId: null, compareIds: [], revenueGrowth: 0, marginChange: 0, budgetChange: 0,
      metrics: ['revenue'], connectivity: ['all'], productSort: 'revenue', sortDirection: 'desc', overlay: null, scenarioEnabled: false, scenarioStart: null });
    const year = get('year');
    if ((typeof year === 'string' || typeof year === 'number') && /^\d{4}$/.test(String(year)) && Number(year) >= 1900 && Number(year) <= 2200) state.period = String(year);
    if (has('category') && typeof get('category') === 'string' && get('category').length <= 1200 && !/[\u0000-\u001f\u007f]/.test(get('category'))) state.category = get('category').split(',').map(value => value.trim()).filter(Boolean);
    if (has('scale')) state.comparisonScale = get('scale') === 'trend' ? 'trend' : 'values';
    for (const key of ['groupId', 'projectId', 'skuId']) if (has(key)) state[key] = scopeId(get(key));
    if (has('compare')) state.compareIds = parseCompare(get('compare'));
    if (has('workspace')) applyWorkspace(get('workspace'));
    for (const [parameter, key, min, max] of [['revenue', 'revenueGrowth', -30, 30], ['margin', 'marginChange', -10, 10], ['spend', 'budgetChange', -30, 30]]) {
      const raw = get(parameter), numeric = typeof raw === 'number' || typeof raw === 'string' && raw.trim() !== '';
      if (has(parameter) && numeric && Number.isFinite(Number(raw))) state[key] = Math.max(min, Math.min(max, Number(raw)));
    }
    state.drillQuery = '';
    if (hasSource()) loadFilters(true);
    return true;
  }
  function selectPeriod(period) {
    const matched=getPeriods().find(p=>String(p)===String(period));
    if(matched===undefined||String(state.period)===String(matched))return;
    state.period=matched;
    draw();
  }
  function syncExplorerControls() {
    renderDrillExplorer();
    if(!workspaceControl){
    $('#explorer-selection').textContent=`${!isProductComparison()&&selectedCategories().length>2?selectedCategories().length+' categories':scopeLabel()} · ${periodLabel(state.period)}`;
    $('#explorer-selection').title=scopeLabel();
    const comparisonModel=isProductComparison()?productComparison('revenue'):isComparison()?engine().compareSeries('revenue',{...opts(),mode:state.comparisonScale}):null;
    const palette=isProductComparison()?comparisonColors():null;
    const comparisonSeries=comparisonModel?.traces?.map(trace=>({...trace,category:isProductComparison()?trace.id:trace.category,label:trace.label||trace.category,color:isProductComparison()?palette.get(trace.id)||colors[0]:categoryColor(trace.category)}))||[];
    const itemSingular=isProductComparison()?(activeDrill?.scope?.level==='group'?'project':activeDrill?.scope?.level==='project'?'SKU':'product group'):'category',itemPlural=isProductComparison()?(activeDrill?.scope?.level==='group'?'projects':activeDrill?.scope?.level==='project'?'SKUs':'product groups'):'categories';
    const timelineConfig={itemSingular,itemPlural,periods:getPeriods(),selected:state.period,series:allSeries('revenue'),comparisonSeries,comparisonModel,comparisonScale:state.comparisonScale,onScaleChange:mode=>{timelineControl?.stop();state.comparisonScale=mode;draw();},labels:Object.fromEntries(getPeriods().map(period=>{const point=allSeries('revenue').find(record=>String(record.period)===String(period));return [period,{kind:point?.kind||'unclassified',label:hasDrill()||isProductComparison()?pointBasis(point):sourceKind(period)}];})),onChange:selectPeriod};
    if(!timelineControl)timelineControl=window.HX_TIMELINE.mount($('#planning-timeline'),timelineConfig);
    else timelineControl.update(timelineConfig);
    }
    const total=engine().summarize({period:state.period,category:'All'});
    const items=[{category:'all',revenue:total.revenue,share:finite(total.revenue)&&total.revenue!==0?1:null,productCount:total.productCount},...getCategories().map(category=>{
      const value=engine().summarize({period:state.period,category});
      return {category,revenue:value.revenue,share:finite(value.revenue)&&finite(total.revenue)&&total.revenue!==0?value.revenue/total.revenue:null,productCount:value.productCount};
    })];
    const categoryConfig={categories:getCategories(),selected:state.category,categoryColors:Object.fromEntries(getCategories().map(category=>[category,categoryColor(category)])),period:{label:periodLabel(state.period),basis:categoryBasis(state.period),currency:'USD'},items,onChange:categories=>{
      timelineControl?.stop();
      resetDrill();
      state.category=categories.includes('all')?['all']:getCategories().filter(category=>categories.includes(category));
      draw();
    }};
    if(!categoryControl)categoryControl=window.HX_CATEGORY_STRIP.mount($('#category-explorer'),categoryConfig);
    else categoryControl.update(categoryConfig);
  }
  async function importFile(file) {
    if (importBusy) return;
    timelineControl?.stop();
    const importFn = window.HX_IMPORT_FILE || window.HX_IMPORT?.importWorkbook; if (!importFn) { toast('The local workbook importer is unavailable. Your current source was kept.'); return; }
    const previous = window.HX_DATA; importBusy = true; $('#import-button').disabled = true; $('#source-badge').textContent = 'Reading workbook…';
    try {
      const next = await importFn(file);
      window.HX_SOURCE_STORE.validate(next);
      await window.HX_SOURCE_STORE.save(next);
      window.HX_DATA = next;
      window.dispatchEvent(new CustomEvent('hx-data-updated'));
      toast(`${file.name} imported and saved in this browser. Source definitions and quality findings were refreshed.`);
      return { status: 'applied' };
    }
    catch (error) { window.HX_DATA = previous; toast(`Import was not applied: ${error.message || 'Source validation failed.'}`); return { status: 'failed', message: error.message || 'Source validation failed.' }; }
    finally { importBusy = false; $('#import-button').disabled = false; $('#source-badge').textContent = hasSource() ? 'Workbook snapshot' : 'No workbook loaded'; $('#import-file').value = ''; notifyParent(); }
  }
  document.addEventListener('click', event => {
    if (event.target.closest('[data-import-workbook]')) return requestImport();
    const compare = event.target.closest('[data-drill-compare]'); if (compare) return toggleCompare(activeDrill?.children?.[Number(compare.dataset.drillCompare)]?.id);
    if (event.target.closest('#drill-clear-compare')) return clearComparison();
    if(event.target.closest('#drill-sort-direction')){state.sortDirection=state.sortDirection==='desc'?'asc':'desc';draw();return;}
    const child = event.target.closest('[data-drill-child]'); if (child) return selectDrillScope(activeDrill?.children?.[Number(child.dataset.drillChild)]);
    const crumb = event.target.closest('[data-drill-crumb]'); if (crumb) return selectDrillScope(activeDrill?.breadcrumbs?.[Number(crumb.dataset.drillCrumb)]);
    const drillProduct = event.target.closest('[data-drill-product]'); if (drillProduct) { const product = (data().products || []).find(record => String(record.id) === drillProduct.dataset.drillProduct); if (product) return selectDrillScope({ category: product.category, groupId: product.id }); }
    if (event.target.closest('[data-drill-plan-source]')) { const plan = activeDrill?.economics?.plan12M; if (plan) return openDialog('Current 12-month source plan', `<p class="formula-note">${escape(plan.basis || 'Current 12-month estimate')}. This horizon is separate from annual tracker revenue and is not a verified original forecast.</p>${evidence(plan.source || [])}`, 'SOURCE ESTIMATE'); }
    const go = event.target.closest('[data-view],[data-go]'); if (go) return setView(go.dataset.view || go.dataset.go);
    const metric = event.target.closest('[data-metric-detail]'); if (metric) return metricDetail(metric.dataset.metricDetail);
    const point = event.target.closest('[data-chart-metric]'); if (point) { if (point.dataset.chartSelection === 'true') return metricDetail(point.dataset.chartMetric, point.dataset.period); return metricDetail(point.dataset.chartMetric, point.dataset.period, point.dataset.chartCategory, { groupId: scopeId(point.dataset.chartGroup), projectId: scopeId(point.dataset.chartProject), skuId: scopeId(point.dataset.chartSku) }); }
    const product = event.target.closest('[data-product-detail]'); if (product) return productDetail(product.dataset.productDetail);
    const action = event.target.closest('[data-decision-action]'); if (action) { state.decisionAction = action.dataset.decisionAction; draw(); return; }
    const decision = event.target.closest('[data-decision-detail]'); if (decision) { const record = (data().decisions || []).find(r => r.id === decision.dataset.decisionDetail); if (!record) return; return openDialog(record.name, `<div class="detail-field"><label>Saved suggested action</label><strong>${escape(record.action)}</strong></div><div class="detail-section"><h3>Source case fields</h3><div class="detail-grid">${Object.entries(record.details || {}).map(([label, value]) => `<div class="detail-field"><label>${escape(label)}</label><strong>${escape(typeof value === 'number' ? new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(value) : value ?? 'Unavailable')}</strong></div>`).join('')}</div></div><div class="model-notice">Saved source recommendations use workbook assessment rules. Review lookup alignment, project identity, ROI definitions, and source actuals status before acting.</div><div class="detail-section"><h3>Source cells</h3>${evidence(record.source || [])}</div>`, 'SAVED DECISION'); }
    const npi = event.target.closest('[data-npi-detail]'); if (npi) { const record = (data().npiValues || []).find(r => r.id === npi.dataset.npiDetail); if (!record) return; return openDialog(record.name, `<div class="detail-grid">${[['Project key',record.id],['Category',record.category],['Source data status',record.dataStatus],['Source tracking signal',record.signal],['12M revenue',fmt(record.revenue,'currency',true)],['12M gross profit',fmt(record.grossProfit,'currency',true)],['Source ROI',finite(record.roi) ? record.roi.toFixed(4)+'×' : 'Unavailable'],['ROI band',record.roiBand],['PD spend',fmt(record.spend,'currency',true)],['Source payback',finite(record.paybackMonths)?record.paybackMonths.toFixed(1)+' months':'Unavailable']].map(([label,value])=>`<div class="detail-field"><label>${escape(label)}</label><strong>${escape(value??'Unavailable')}</strong></div>`).join('')}</div><div class="model-notice">This is a project-specific saved source case. Source “Actuals” status is unverified against the stated cutoff. Multi-project product groups must retain every case rather than inherit the first matching ROI.</div><div class="detail-section"><h3>Source cells</h3>${evidence(record.source||[])}</div>`, 'NPI SOURCE CASE'); }
    const risk = event.target.closest('[data-risk-detail]'); if (risk) { const q=data().quality?.postPorDiagnostic; return openDialog('Capital at risk · audit diagnostic', `<div class="detail-grid">${[['Aligned at-risk spend',fmt(q.alignedCapitalAtRisk,'currency',true)],['Aligned at-risk ratio',fmt(q.alignedCapitalAtRiskPct,'percent',true)],['Source PD spend denominator',fmt(q.actualPDSpend,'currency',true)],['Original cached ratio',fmt(q.workbookCapitalAtRiskPctCache,'percent',true)]].map(([label,value])=>`<div class="detail-field"><label>${label}</label><strong>${value}</strong></div>`).join('')}</div><p class="formula-note">${escape(q.note)}</p><div class="detail-section"><h3>Tracking signals across all source cases</h3>${Object.entries(q.trackingSignals||{}).map(([signal,count])=>`<div class="scenario-comparison"><span>${escape(signal)}</span><strong>${count}</strong></div>`).join('')}</div><div class="model-notice">Diagnostic recomputation is shown separately from the original cached workbook result. This source-wide audit measure does not respond to the planning year or category filters.</div>`,'AUDIT DIAGNOSTIC'); }
    const sheet = event.target.closest('[data-sheet-detail]'); if (sheet) return sheetDetail(sheet.dataset.sheetDetail);
    const issue = event.target.closest('[data-issue-detail]'); if (issue) { const item = issues()[Number(issue.dataset.issueDetail)]; return openDialog(item.title || 'Source finding', `<p class="under-construction-note">${escape(item.detail || item.description || item.message)}</p>${evidence(item.source || item.sources || [{ sheet: item.sheet, cell: item.cell, formula: item.formula, value: item.value }])}`, 'QUALITY FINDING'); }
    const tab = event.target.closest('[data-select-metric]'); if (tab) { state.metric = tab.dataset.selectMetric; return draw(); }
    if (event.target.closest('#reset-scenario')) { state.revenueGrowth = 0; state.marginChange = 0; state.budgetChange = 0; draw(); }
    if (event.target.closest('#source-info-button')) sourceInfo();
  });
  document.addEventListener('keydown', event => { if (event.target.closest('button,input,select,textarea,a')) return; const row = event.target.closest('.data-row,.chart-point'); if (row && ['Enter', ' '].includes(event.key)) { event.preventDefault(); row.dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
  document.addEventListener('change',event=>{if(event.target.id==='drill-sort'){state.productSort=event.target.value;if(['name','connectivity'].includes(state.productSort))state.sortDirection='asc';draw();}});
  document.addEventListener('input', event => {
    if (event.target.id === 'drill-search') { state.drillQuery = event.target.value; renderDrillResults(); }
    if (event.target.id === 'product-search') { state.query = event.target.value; $('#product-table').innerHTML = productTable(filteredProducts()); $('#product-count').textContent = `${filteredProducts().length} products · sorted by revenue`; }
    if (event.target.id === 'sheet-search') { state.sheetQuery = event.target.value; $('#sheet-cards').innerHTML = sheetCards(); }
    if (event.target.dataset.slider) { const key = event.target.dataset.slider; state[key] = Number(event.target.value); const output = { revenueGrowth: '#revenue-output', marginChange: '#margin-output', budgetChange: '#budget-output' }[key]; $(output).textContent = key === 'marginChange' ? percentPoints(state[key]) : `${state[key] >= 0 ? '+' : ''}${state[key].toFixed(1)}%`; $('#scenario-output').innerHTML = scenarioOutput(); notifyParent(); }
  });
  $('#source-button').addEventListener('click', () => setView('source'));
  $('#menu-button').addEventListener('click', () => { const open = $('.sidebar').classList.toggle('open'); $('#menu-button').setAttribute('aria-expanded', String(open)); });
  $('#close-dialog').addEventListener('click', () => $('#detail-dialog').close());
  $('#detail-dialog').addEventListener('close',()=>{if(embedded&&window.parent!==window)window.parent.postMessage({type:'ppc:blueprint:dialog',open:Boolean($('#analysis-overlay')?.open)},location.origin);});
  $('#detail-dialog').addEventListener('click', event => { if (event.target === $('#detail-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
  $('#import-button').addEventListener('click', requestImport);
  $('#import-file').addEventListener('change', event => { if (event.target.files?.[0]) importFile(event.target.files[0]); });
  window.addEventListener('hx-data-updated', () => { loadFilters(sourceWasLoaded); sourceWasLoaded = true; draw(); });
  window.addEventListener('message', event => {
    if (!embedded || event.source !== window.parent || event.origin !== location.origin || !event.data || typeof event.data !== 'object') return;
    if (event.data.type === 'ppc:blueprint:navigate' && Object.hasOwn(views, event.data.view)) {
      const restoring = Object.hasOwn(event.data, 'preferences');
      const complete = restoring && ['year','category','scale','revenue','margin','spend'].every(key => Object.hasOwn(event.data.preferences || {}, key));
      if (restoring && !applyPreferences(event.data.preferences, { replace: complete })) return;
      if(event.data.preferences?.workspace&&['performance','overview'].includes(event.data.view)){state.view='performance';draw();}
      else setView(event.data.view, { replaceHistory: restoring });
    }
    else if (event.data.type === 'ppc:blueprint:import') requestImport();
    else if (event.data.type === 'ppc:blueprint:suspend') { timelineControl?.stop();workspaceControl?.close(); if($('#detail-dialog').open)$('#detail-dialog').close(); }
    else if (event.data.type === 'ppc:blueprint:viewport' && Number.isFinite(event.data.top) && event.data.top>=0 && Number.isFinite(event.data.height) && event.data.height>=100 && event.data.height<=3000) {
      const dialog=$('#detail-dialog');dialog.classList.add('is-host-positioned');dialog.style.setProperty('--host-dialog-top',event.data.top+'px');dialog.style.setProperty('--host-dialog-height',event.data.height+'px');
      const overlay=$('#analysis-overlay');if(overlay){overlay.style.setProperty('--analysis-overlay-top',event.data.top+'px');overlay.style.setProperty('--analysis-overlay-height',event.data.height+'px');}
    }
  });
  if (embedded && window.parent !== window) {
    let lastHeight = 0;
    const sendHeight = () => {
      const height = Math.ceil($('.app-shell').getBoundingClientRect().height);
      if (height > 0 && height !== lastHeight) {
        lastHeight = height;
        window.parent.postMessage({ type: 'ppc:blueprint:height', height }, location.origin);
      }
    };
    if (window.ResizeObserver) new ResizeObserver(sendHeight).observe($('.app-shell'));
    else window.addEventListener('resize', sendHeight);
    requestAnimationFrame(sendHeight);
  }
  window.addEventListener('hashchange', () => { const view = fragmentView(); if (views[view]) { timelineControl?.stop(); applyPreferences(locationPreferences(), { replace: true }); state.view = view; draw(); } });
  window.addEventListener('popstate', () => { const view = fragmentView() || 'overview'; timelineControl?.stop(); applyPreferences(locationPreferences(), { replace: true }); if (views[view]) state.view = view; draw(); });
  let viewportWidth = window.innerWidth, resizeTimer;
  window.addEventListener('resize', () => {
    if (window.innerWidth === viewportWidth) return;
    viewportWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(draw, 120);
  });
  window.HX_DASHBOARD = { refresh() { timelineControl?.stop(); if (hasSource()) { loadFilters(sourceWasLoaded); sourceWasLoaded = true; } draw(); }, importFile, setView, selectDrillScope, toggleCompare, clearComparison, state };
  state.view = views[fragmentView()] ? fragmentView() : 'overview';
  fillIcons(); draw();
  Promise.resolve(window.HX_SOURCE_READY).then(result => {
    const snapshot = window.HX_DATA || result?.snapshot;
    if (snapshot) {
      window.HX_SOURCE_STORE.validate(snapshot);
      window.HX_DATA = snapshot;
      loadFilters(false); sourceWasLoaded = true;
    }
    if (result?.error) toast(`The saved source could not be restored: ${result.error.message}. Import the workbook to continue.`);
  }).catch(error => toast(`The saved source could not be restored: ${error.message}. Import the workbook to continue.`)).finally(() => {
    startupComplete = true; draw();
    if (pendingImport) { pendingImport = false; requestImport(); }
  });
})();
