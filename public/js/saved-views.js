/* Named presentation preferences stay on this device. No source data or save consent is retained. */
(function savedViews(root) {
  'use strict';
  const STORAGE_KEY = 'ppc-saved-views-v1', EXPORT_KEY = 'ppc-export-preferences-v1';
  const MAX_VIEWS = 25, MAX_BYTES = 262144;
  const kinds = ['portfolio', 'retail', 'blueprint'];
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = (value, max = 240) => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value : undefined;
  const choice = (value, allowed) => allowed.includes(value) ? value : undefined;
  const ids = (value, max = 500) => Array.isArray(value) ? [...new Set(value.slice(0, max).map(item => text(item)).filter(item => item !== undefined && item !== ''))] : undefined;
  function date(value, month = false) {
    if (typeof value !== 'string' || !(month ? /^\d{4}-(0[1-9]|1[0-2])$/ : /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).test(value)) return undefined;
    const iso = month ? value + '-01' : value;
    return new Date(iso + 'T12:00:00Z').toISOString().slice(0, 10) === iso ? value : undefined;
  }
  const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : undefined;
  const clean = value => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
  function catalogGroups(value) {
    const groups = ['all','launched','in-development','in-planning','embargo','unreleased','eol'];
    if (!Array.isArray(value) || value.length > 32 || Array.from(value).some(group => !groups.includes(group))) return undefined;
    const unique = new Set(value);
    return unique.has('all') && unique.size > 1 ? undefined : groups.filter(group => unique.has(group));
  }
  function categoryVisibility(value) {
    if (!Array.isArray(value)) return undefined;
    const seen = new Set(), groups = ['all','launched','unreleased','eol'];
    return value.slice(0, 200).flatMap(entry => {
      if (!object(entry) || !Object.hasOwn(entry, 'categoryId')) return [];
      const categoryId = text(entry.categoryId);
      const hasSelection = Object.hasOwn(entry, 'catalogGroups') && entry.catalogGroups !== undefined;
      const selection = hasSelection ? catalogGroups(entry.catalogGroups) : undefined;
      const hasGroup = Object.hasOwn(entry, 'catalogGroup') && entry.catalogGroup !== undefined;
      const hasLegacy = Object.hasOwn(entry, 'hideDiscontinued') && entry.hideDiscontinued !== undefined;
      if (!categoryId?.trim() || seen.has(categoryId) || !hasSelection && !hasGroup && !hasLegacy
        || hasSelection && selection === undefined
        || !hasSelection && (hasGroup && !groups.includes(entry.catalogGroup) || hasLegacy && typeof entry.hideDiscontinued !== 'boolean')) return [];
      seen.add(categoryId);
      if (hasSelection) return [{ categoryId, catalogGroups: selection }];
      // A group is authoritative. Do not retain a contradictory legacy flag;
      // boolean-only entries preserve older per-category visibility exactly.
      return [{ categoryId, ...(hasGroup ? { catalogGroup: entry.catalogGroup } : { hideDiscontinued: entry.hideDiscontinued }) }];
    });
  }
  function sanitizePreferences(kind, value) {
    if (!kinds.includes(kind) || !object(value)) return null;
    if (kind === 'portfolio') {
      const display = object(value.display) ? clean({
        labelMode: choice(value.display.labelMode, ['default','on','off']),
        showSeasonalWindows: typeof value.display.showSeasonalWindows === 'boolean' ? value.display.showSeasonalWindows : undefined,
        detailsOpen: typeof value.display.detailsOpen === 'boolean' ? value.display.detailsOpen : undefined,
        productZoom: number(value.display.productZoom, 0.2, 2), roadmapZoom: number(value.display.roadmapZoom, 0.1, 2),
        showPrices: typeof value.display.showPrices === 'boolean' ? value.display.showPrices : undefined,
        showSkus: typeof value.display.showSkus === 'boolean' ? value.display.showSkus : undefined,
        hideDiscontinued: typeof value.display.hideDiscontinued === 'boolean' ? value.display.hideDiscontinued : undefined,
        catalogGroup: choice(value.display.catalogGroup, ['all','launched','unreleased','eol']),
        catalogGroups: catalogGroups(value.display.catalogGroups),
      }) : undefined;
      return clean({ view: choice(value.view, ['products','roadmap','split']), basis: choice(value.basis, ['lifecycle','ffs']),
        categoryIds: ids(value.categoryIds, 200), activeCategoryId: text(value.activeCategoryId),
        categoryVisibility: categoryVisibility(value.categoryVisibility),
        dateRange: object(value.dateRange) ? clean({ start: date(value.dateRange.start, true), end: date(value.dateRange.end, true) }) : undefined,
        search: text(value.search, 200), display });
    }
    if (kind === 'retail') return clean({ view: choice(value.view, ['overview','planning','records']), stores: ids(value.stores, 100), products: ids(value.products),
      storesNone: typeof value.storesNone === 'boolean' ? value.storesNone : undefined,
      productsNone: typeof value.productsNone === 'boolean' ? value.productsNone : undefined,
      category: text(value.category, 80), band: choice(value.band, ['', 'Under $50', '$50–99', '$100–149', '$150–199', '$200+', 'Unmapped']),
      comparison: choice(value.comparison, ['year','previous','none']), coverage: choice(value.coverage, ['common','available']),
      preset: choice(value.preset, ['4','13','26','52','fy25','fy26','all','custom']), start: date(value.start), end: date(value.end),
      trend: choice(value.trend, ['stores','products','total']) });
    let compare;
    try { const parsed = typeof value.compare === 'string' && value.compare.length <= 12000 ? JSON.parse(value.compare) : value.compare; compare = ids(parsed, 50); } catch (_) { /* Ignore malformed optional comparison. */ }
    return clean({ view: choice(value.view, ['overview','performance','products','investment','scenarios','source']),
      year: /^(20\d{2}|21\d{2}|2200)$/.test(String(value.year)) ? String(value.year) : undefined,
      category: text(value.category, 1200), scale: choice(value.scale, ['trend','values']),
      revenue: number(Number(value.revenue), -30, 30), margin: number(Number(value.margin), -10, 10), spend: number(Number(value.spend), -30, 30),
      groupId: text(value.groupId), projectId: text(value.projectId), skuId: text(value.skuId), compare: compare ? JSON.stringify(compare) : undefined });
  }
  function sanitizeExportPreferences(value) {
    if (!object(value)) return {};
    return clean({ scope: choice(value.scope, ['both','products','roadmap']), categoryIds: value.categoryIds === null ? null : ids(value.categoryIds, 200),
      range: object(value.range) ? clean({ start: date(value.range.start, true), end: date(value.range.end, true) }) : undefined,
      mode: choice(value.mode, ['categories','merged']) });
  }
  function defaultStorage() { try { return root.localStorage; } catch (_) { return null; } }
  function createStore(storage = defaultStorage()) {
    let problem = '';
    function read() {
      problem = '';
      try {
        const raw = storage?.getItem(STORAGE_KEY);
        if (!raw) return [];
        if (raw.length > MAX_BYTES) throw new Error('too-large');
        const data = JSON.parse(raw);
        if (!object(data) || data.version !== 1 || !Array.isArray(data.views)) throw new Error('invalid');
        const seen = new Set();
        return data.views.slice(0, MAX_VIEWS).flatMap(record => {
          if (!object(record) || !text(record.id, 100) || seen.has(record.id) || !text(record.name, 60)?.trim()) return [];
          const preferences = sanitizePreferences(record.kind, record.preferences);
          if (!preferences) return [];
          seen.add(record.id);
          return [{ id: record.id, name: record.name.trim(), kind: record.kind, preferences }];
        });
      } catch (_) { problem = 'Saved views could not be read. Your current workspace is unchanged.'; return []; }
    }
    function write(views) {
      const raw = JSON.stringify({ version: 1, views });
      if (raw.length > MAX_BYTES) throw new Error('These saved preferences exceed the device storage limit. Reduce the selected products.');
      try { if (!storage) throw new Error('unavailable'); storage.setItem(STORAGE_KEY, raw); }
      catch (_) { throw new Error('This browser could not save the view. Your current workspace is unchanged.'); }
      problem = '';
    }
    function name(value, records, except) {
      const result = text(value, 60)?.trim();
      if (!result) throw new Error('Enter a view name of 1 to 60 characters.');
      if (records.some(record => record.id !== except && record.name.toLocaleLowerCase() === result.toLocaleLowerCase())) throw new Error('A saved view already uses this name. Choose another name.');
      return result;
    }
    return {
      list: read, get problem() { return problem; },
      save(label, kind, preferences) {
        const records = read();
        if (problem) throw new Error(problem + ' Reset damaged saved views to save another view.');
        if (records.length >= MAX_VIEWS) throw new Error('You have 25 saved views. Delete one before saving another.');
        const sanitized = sanitizePreferences(kind, preferences);
        if (!sanitized) throw new Error('This view cannot be saved.');
        const record = { id: root.crypto?.randomUUID?.() || `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, name: name(label, records), kind, preferences: sanitized };
        write([...records, record]); return record;
      },
      rename(id, label) { const records = read(), record = records.find(item => item.id === id); if (!record) throw new Error('This saved view is no longer available.'); record.name = name(label, records, id); write(records); return record; },
      remove(id) { const records = read(); if (problem) throw new Error(problem); write(records.filter(item => item.id !== id)); },
      reset() { try { if (!storage) throw new Error('unavailable'); storage.removeItem(STORAGE_KEY); problem = ''; } catch (_) { throw new Error('This browser could not reset saved views.'); } },
    };
  }
  function readExportPreferences(storage = defaultStorage()) {
    try { const raw = storage?.getItem(EXPORT_KEY); return raw && raw.length <= 32000 ? sanitizeExportPreferences(JSON.parse(raw)) : {}; } catch (_) { return {}; }
  }
  function saveExportPreferences(value, storage = defaultStorage()) {
    try { if (!storage) return false; storage.setItem(EXPORT_KEY, JSON.stringify(sanitizeExportPreferences(value))); return true; } catch (_) { return false; }
  }
  let mountSequence = 0;
  function mount({ button, adapter, store = createStore() }) {
    if (!button || !adapter || button.dataset.savedViewsBound === 'true') return null;
    button.dataset.savedViewsBound = 'true'; button.classList.add('saved-views-trigger'); button.setAttribute('aria-haspopup', 'dialog');
    const doc = button.ownerDocument || root.document, id = `saved-views-${++mountSequence}`;
    const element = (tag, textContent, className) => { const node = doc.createElement(tag); if (textContent !== undefined) node.textContent = textContent; if (className) node.className = className; return node; };
    const dialog = element('dialog', undefined, 'saved-views-dialog'); dialog.id = id; dialog.setAttribute('aria-labelledby', id + '-title'); dialog.setAttribute('aria-describedby', id + '-help'); button.setAttribute('aria-controls', id);
    const heading = element('h2', 'Saved views'); heading.id = id + '-title';
    const help = element('p', 'Save filters and display choices for this device. Opening a view uses the current data.', 'saved-views-help'); help.id = id + '-help';
    const close = element('button', 'Close', 'saved-views-close'); close.type = 'button';
    const header = element('div', undefined, 'saved-views-heading'); header.append(heading, close);
    const list = element('ul', undefined, 'saved-views-list'); list.setAttribute('aria-label', 'Named views');
    const form = element('form', undefined, 'saved-views-form'), label = element('label', 'Name this view'), input = element('input'); input.id = id + '-name'; input.type = 'text'; input.maxLength = 60; input.required = true; label.htmlFor = input.id;
    const save = element('button', 'Save current view'); save.type = 'submit';
    const cancel = element('button', 'Cancel rename'); cancel.type = 'button'; cancel.hidden = true;
    const status = element('p', '', 'saved-views-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
    const recovery = element('button', 'Reset damaged saved views'); recovery.type = 'button'; recovery.hidden = true;
    form.append(label, input, save, cancel); dialog.append(header, help, list, form, status, recovery); doc.body.append(dialog);
    let renaming = null, pendingDelete = null, busy = false, pendingReset = false;
    const supported = kind => adapter.supportsKind ? adapter.supportsKind(kind) : kind === (adapter.getKind?.() || 'portfolio');
    const announce = value => { status.textContent = value; };
    function resetForm() { renaming = null; input.value = ''; save.textContent = 'Save current view'; cancel.hidden = true; }
    function render() {
      list.replaceChildren();
      const records = store.list().filter(record => supported(record.kind));
      recovery.hidden = !store.problem;
      if (!records.length) list.append(element('li', 'No saved views yet.', 'saved-views-empty'));
      for (const record of records) {
        const row = element('li'), info = element('span', undefined, 'saved-views-info'), title = element('strong', record.name), detail = element('small', {portfolio:'Portfolio',retail:'Retail',blueprint:'Portfolio plan'}[record.kind]);
        info.append(title, detail);
        const actions = element('div', undefined, 'saved-views-actions');
        const apply = element('button', 'Open'); apply.type = 'button'; apply.setAttribute('aria-label', `Open ${record.name}`);
        apply.onclick = async () => {
          if (busy) return; busy = true; apply.disabled = true; announce('Opening view…');
          try { const result = await adapter.applyView(sanitizePreferences(record.kind, record.preferences), record.kind); announce(result?.message || `${record.name} opened using the current data.`); }
          catch (error) { announce(error?.message || 'This view could not be opened.'); }
          finally { busy = false; apply.disabled = false; }
        };
        const rename = element('button', 'Rename'); rename.type = 'button'; rename.setAttribute('aria-label', `Rename ${record.name}`); rename.onclick = () => { renaming = record.id; input.value = record.name; save.textContent = 'Save name'; cancel.hidden = false; announce(`Renaming ${record.name}.`); input.focus(); input.select(); };
        const remove = element('button', pendingDelete === record.id ? 'Confirm delete' : 'Delete'); remove.type = 'button'; remove.setAttribute('aria-label', `${pendingDelete === record.id ? 'Confirm deletion of' : 'Delete'} ${record.name}`);
        remove.onclick = () => { if (pendingDelete !== record.id) { pendingDelete = record.id; render(); announce(`Select Confirm delete to remove ${record.name} from this device.`); list.querySelector('[data-confirm-delete]')?.focus(); return; } try { store.remove(record.id); pendingDelete = null; if (renaming === record.id) resetForm(); render(); announce(`${record.name} deleted.`); input.focus(); } catch (error) { announce(error.message); } };
        if (pendingDelete === record.id) remove.dataset.confirmDelete = 'true';
        actions.append(apply, rename, remove); row.append(info, actions); list.append(row);
      }
      if (store.problem) announce(store.problem);
    }
    form.addEventListener('submit', event => {
      event.preventDefault();
      try { const record = renaming ? store.rename(renaming, input.value) : store.save(input.value, adapter.getKind?.() || 'portfolio', adapter.captureView()); resetForm(); pendingDelete = null; render(); announce(`${record.name} saved on this device.`); input.focus(); }
      catch (error) { announce(error.message); }
    });
    cancel.onclick = () => { resetForm(); announce('Rename cancelled.'); input.focus(); };
    recovery.onclick = () => { if (!pendingReset) { pendingReset = true; recovery.textContent = 'Confirm reset saved views'; announce('This removes saved view preferences on this device. Your portfolio and workbooks stay unchanged.'); return; } try { store.reset(); pendingReset = false; recovery.textContent = 'Reset damaged saved views'; render(); announce('Damaged saved views reset. You can save the current view.'); input.focus(); } catch (error) { announce(error.message); } };
    close.onclick = () => dialog.close();
    dialog.addEventListener('close', () => { resetForm(); pendingDelete = null; pendingReset = false; recovery.textContent = 'Reset damaged saved views'; button.focus(); });
    const openDialog = () => { if (dialog.open) return; resetForm(); pendingDelete = null; announce(''); render(); dialog.showModal(); input.focus(); };
    button.addEventListener('click', openDialog);
    return { dialog, refresh: render, destroy() { button.removeEventListener('click', openDialog); dialog.remove(); button.removeAttribute('aria-controls'); delete button.dataset.savedViewsBound; } };
  }
  const api = { STORAGE_KEY, EXPORT_KEY, MAX_VIEWS, sanitizePreferences, sanitizeExportPreferences, createStore, readExportPreferences, saveExportPreferences, mount };
  root.PPCSavedViews = api;
  function initialize() {
    const portfolio = root.document?.getElementById('savedViewsButton');
    if (portfolio && root.PortfolioWorkflowAdapter) mount({ button: portfolio, adapter: root.PortfolioWorkflowAdapter });
    const analytics = root.document?.getElementById('analyticsSavedViews');
    if (analytics && root.PPCAnalyticsWorkspace) mount({ button: analytics, adapter: root.PPCAnalyticsWorkspace });
  }
  if (root.document?.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', initialize, { once: true }); else initialize();
})(globalThis);
