/* The shared shell owns navigation only. Each analysis keeps its own source and saved state. */
(function analyticsWorkspace(root) {
  'use strict';
  const tabs = [...document.querySelectorAll('[data-analysis-module]')];
  const retail = document.getElementById('selloutApp');
  const blueprint = document.getElementById('blueprintPane');
  const frame = document.getElementById('blueprintFrame');
  const loading = document.getElementById('blueprintLoading');
  const source = document.getElementById('blueprintSource');
  const viewButtons = [...document.querySelectorAll('[data-blueprint-view]')];
  if (!tabs.length || !retail || !blueprint || !frame) return;
  const views = new Set(['overview','performance','products','investment','scenarios','source']);
  const scopeKeys = ['groupId','projectId','skuId'];
  const privatePreferences = [...scopeKeys,'compare'];
  const preferences = ['year','category','revenue','margin','spend','scale',...privatePreferences];
  const validScopeId = value => typeof value === 'string' && value.length <= 240 && !/[\u0000-\u001f\u007f]/.test(value);
  function comparisonPreference(value) {
    if (typeof value !== 'string' || value.length > 12000) return null;
    try { const ids = JSON.parse(value); return Array.isArray(ids) && ids.length <= 50 && ids.every(id => validScopeId(id) && id.length > 0) ? JSON.stringify([...new Set(ids)]) : null; }
    catch (_) { return null; }
  }
  const bounds = { revenue: [-30,30], margin: [-10,10], spend: [-30,30] };
  const blueprintState = { view: 'overview' };
  const assetVersion = new URL(document.currentScript?.src || root.location.href).searchParams.get('v');
  let currentModule = 'retail', frameLoaded = false, blueprintDialogOpen = false;

  function readRoute() {
    const url = new URL(root.location.href);
    for (const key of scopeKeys) blueprintState[key] = '';
    blueprintState.compare = '[]';
    const [route, scopeQuery = ''] = url.hash.split('?');
    const scopeParams = new URLSearchParams(scopeQuery);
    const view = /^#blueprint\/([a-z]+)$/.exec(route)?.[1];
    if (views.has(view)) blueprintState.view = view;
    for (const key of preferences) {
      const value = privatePreferences.includes(key) ? scopeParams.get(key) ?? url.searchParams.get(key) : url.searchParams.get(key);
      if (value === null) continue;
      if (key === 'category' && value.length <= 1200 && !/[\u0000-\u001f\u007f]/.test(value)) blueprintState[key] = value;
      else if (scopeKeys.includes(key) && validScopeId(value)) blueprintState[key] = value;
      else if (key === 'compare' && comparisonPreference(value) !== null) blueprintState.compare = comparisonPreference(value);
      else if (key === 'scale' && ['trend','values'].includes(value)) blueprintState.scale = value;
      else if (key === 'year' && /^\d{4}$/.test(value)) blueprintState[key] = value;
      else if (bounds[key] && Number.isFinite(Number(value))) blueprintState[key] = String(Math.max(bounds[key][0], Math.min(bounds[key][1], Number(value))));
    }
    return url.searchParams.get('analysis') === 'blueprint' || views.has(view) ? 'blueprint' : 'retail';
  }
  function writeRoute(push = false) {
    // The existing PPC pricing bridge consumes this temporary capability itself.
    if (new URLSearchParams(root.location.hash.slice(1)).has('ppc-link')) return;
    const url = new URL(root.location.href);
    url.searchParams.set('analysis', currentModule);
    for (const key of preferences) {
      if (privatePreferences.includes(key)) url.searchParams.delete(key);
      else if (blueprintState[key] !== undefined) url.searchParams.set(key, blueprintState[key]);
    }
    const scopedRoute = new URLSearchParams(privatePreferences.filter(key => blueprintState[key] && blueprintState[key] !== '[]').map(key => [key, blueprintState[key]])).toString();
    url.hash = currentModule === 'blueprint' ? `blueprint/${blueprintState.view}${scopedRoute ? '?' + scopedRoute : ''}` : '';
    if (url.href !== root.location.href) root.history[push ? 'pushState' : 'replaceState'](null, '', url);
  }
  function post(message) {
    if (frameLoaded) frame.contentWindow.postMessage(message, root.location.origin);
  }
  function navigationMessage(view) {
    return { type: 'ppc:blueprint:navigate', view, preferences: Object.fromEntries(preferences
      .filter(key => blueprintState[key] !== undefined)
      .map(key => [key, blueprintState[key]])) };
  }
  function positionBlueprintDialog() {
    if (!blueprintDialogOpen || currentModule !== 'blueprint') return;
    const rect=frame.getBoundingClientRect(),top=Math.max(0,-rect.top),bottom=Math.min(rect.height,root.innerHeight-rect.top);
    post({type:'ppc:blueprint:viewport',top:top+18,height:Math.max(160,bottom-top-36)});
  }
  function syncViews() {
    for (const button of viewButtons) {
      if (button.dataset.blueprintView === blueprintState.view) button.setAttribute('aria-current','page');
      else button.removeAttribute('aria-current');
    }
  }
  function ensureBlueprint() {
    if (frame.getAttribute('src')) return;
    const url = new URL(frame.dataset.src, root.location.href);
    if (assetVersion) url.searchParams.set('v', assetVersion);
    for (const key of preferences) if (!privatePreferences.includes(key) && blueprintState[key] !== undefined) url.searchParams.set(key, blueprintState[key]);
    const scopedRoute = new URLSearchParams(privatePreferences.filter(key => blueprintState[key] && blueprintState[key] !== '[]').map(key => [key, blueprintState[key]])).toString();
    url.hash = blueprintState.view + (scopedRoute ? '?' + scopedRoute : '');
    frame.src = url.href;
  }
  function switchModule(module, push = true) {
    if (!['retail','blueprint'].includes(module)) return;
    currentModule = module;
    retail.hidden = module !== 'retail';
    blueprint.hidden = module !== 'blueprint';
    for (const button of tabs) {
      const selected = button.dataset.analysisModule === module;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    root.PPCSelloutDashboard?.setActive?.(module === 'retail');
    if (module === 'blueprint') {
      ensureBlueprint();
      post(navigationMessage(blueprintState.view));
    } else post({ type: 'ppc:blueprint:suspend' });
    syncViews();
    writeRoute(push);
  }
  function showBlueprintView(view, push = true) {
    if (!views.has(view)) return;
    blueprintState.view = view;
    if (currentModule !== 'blueprint') switchModule('blueprint', false);
    post(navigationMessage(view));
    syncViews();
    writeRoute(push);
  }
  function receiveBlueprintMessage(event) {
    if (event.origin !== root.location.origin || event.source !== frame.contentWindow) return;
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'ppc:blueprint:dialog' && typeof message.open === 'boolean') {
      blueprintDialogOpen=message.open; positionBlueprintDialog(); return;
    }
    if (message.type === 'ppc:blueprint:height') {
      if (typeof message.height === 'number' && Number.isFinite(message.height) && message.height >= 100 && message.height <= 50000) frame.style.height = `${Math.ceil(message.height)}px`;
      return;
    }
    if (message.type !== 'ppc:blueprint:state' || !message.state || !views.has(message.state.view)) return;
    const state = message.state;
    if (['trend','values'].includes(state.scale)) blueprintState.scale = state.scale;
    blueprintState.view = state.view;
    if (Number.isInteger(Number(state.year)) && Number(state.year) >= 2000 && Number(state.year) <= 2200) blueprintState.year = String(state.year);
    if (typeof state.category === 'string' && state.category.length > 0 && state.category.length <= 1200 && !/[\u0000-\u001f\u007f]/.test(state.category)) blueprintState.category = state.category;
    for (const key of scopeKeys) {
      if (validScopeId(state[key])) blueprintState[key] = state[key];
    }
    const comparison = comparisonPreference(state.compare);
    if (comparison !== null) blueprintState.compare = comparison;
    for (const key of Object.keys(bounds)) {
      const value = state[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= bounds[key][0] && value <= bounds[key][1]) blueprintState[key] = String(value);
    }
    if (typeof message.sourceLabel === 'string' && message.sourceLabel.length <= 180) {
      source.textContent = message.sourceLabel;
      source.title = message.sourceLabel;
    }
    syncViews();
    if (currentModule === 'blueprint') writeRoute(false);
  }
  for (const button of tabs) {
    button.addEventListener('click', () => switchModule(button.dataset.analysisModule));
    button.addEventListener('keydown', event => {
      const index = tabs.indexOf(button);
      const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : -1;
      if (target < 0) return;
      event.preventDefault(); tabs[target].focus(); switchModule(tabs[target].dataset.analysisModule);
    });
  }
  for (const button of viewButtons) button.addEventListener('click', () => showBlueprintView(button.dataset.blueprintView));
  document.getElementById('blueprintImport').addEventListener('click', () => post({ type: 'ppc:blueprint:import' }));
  frame.addEventListener('load', () => {
    frameLoaded = true; frame.hidden = false; loading.hidden = true;
    post(navigationMessage(blueprintState.view));
    if (currentModule !== 'blueprint') post({ type: 'ppc:blueprint:suspend' });
  });
  root.addEventListener('message', receiveBlueprintMessage);
  root.addEventListener('scroll',positionBlueprintDialog,{passive:true});
  root.addEventListener('resize',positionBlueprintDialog);
  root.addEventListener('popstate', () => switchModule(readRoute(), false));
  function captureView() {
    if (currentModule === 'retail') return root.PPCSelloutDashboard.captureView();
    return { ...blueprintState };
  }
  async function applyView(value, kind = currentModule) {
    if (!['retail','blueprint'].includes(kind)) throw new Error('This saved view belongs to another workspace.');
    const saved = root.PPCSavedViews?.sanitizePreferences(kind, value);
    if (!saved) throw new Error('This saved view is invalid.');
    if (kind === 'retail') {
      await root.PPCSelloutDashboard.ready;
      const result = root.PPCSelloutDashboard.applyView(saved);
      switchModule('retail');
      return result;
    }
    // A named view replaces presentation preferences, while the retained frame keeps its source.
    for (const key of preferences) delete blueprintState[key];
    Object.assign(blueprintState, { year: '2026', category: 'all', scale: 'trend', revenue: '0', margin: '0', spend: '0', groupId: '', projectId: '', skuId: '', compare: '[]' }, saved);
    blueprintState.view = views.has(saved.view) ? saved.view : 'overview';
    switchModule('blueprint');
    return { message: 'Portfolio plan view opened. Selections use the current workbook; unavailable source identities are checked by the plan.' };
  }
  root.PPCAnalyticsWorkspace = { switchModule, showBlueprintView, captureView, applyView,
    getKind: () => currentModule, supportsKind: kind => ['retail','blueprint'].includes(kind),
    get currentModule() { return currentModule; } };
  switchModule(readRoute(), false);
})(globalThis);
