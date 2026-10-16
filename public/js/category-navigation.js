/* Shared local category navigation for the catalogue and Hashout scope. */
(function registerCategoryNavigation(root) {
  "use strict";
  const DEFINITIONS = Object.freeze({
    "pc-gaming-audio": { icon: "pc-audio", short: "PC audio", name: "PC Gaming Audio" },
    "console-gaming-audio": { icon: "console-audio", short: "Console audio", name: "Console Gaming Audio" },
    "lifestyle-audio": { icon: "lifestyle-audio", short: "Lifestyle audio", name: "Lifestyle Audio" },
    "audio-accessories": { icon: "audio-accessories", short: "Audio accessories", name: "Audio Accessories" },
    microphones: { icon: "microphone", short: "Microphones", name: "Microphones" },
    "microphone-accessories": { icon: "microphone-accessories", short: "Mic accessories", name: "Microphone Accessories" },
    keyboards: { icon: "keyboard", short: "Keyboards", name: "Keyboards" },
    mice: { icon: "mouse", short: "Mice", name: "Mice" },
    accessories: { icon: "accessories", short: "Accessories", name: "Gaming Accessories" },
    controllers: { icon: "controller", short: "Controllers", name: "Controllers" },
    backpacks: { icon: "backpack", short: "Backpacks", name: "Backpacks" },
  });
  const normalizeName = value => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const definitionFor = category => Object.hasOwn(DEFINITIONS, category.id) ? DEFINITIONS[category.id]
    : Object.values(DEFINITIONS).find(value => normalizeName(value.name) === normalizeName(category.name)) || { icon: "grid", short: category.name };
  let sequence = 0;

  function create(host, { onChoose, onAll } = {}) {
    const doc = host?.ownerDocument;
    if (!doc?.createElement || typeof host.append !== "function") throw new TypeError("A category navigation host is required.");
    const win = doc.defaultView || root, records = new Map(), listeners = new Set();
    let state = { categories: [], mode: "single", selectedIds: [], allSelected: false, disabled: false };
    let destroyed = false, rovingId = null, hovered = null, identity = "", selectedSignature = "", tooltipDismissed = false;
    const node = (tag, className, text) => {
      const result = doc.createElement(tag); result.className = className;
      if (text !== undefined) result.textContent = text;
      return result;
    };
    const set = (element, key, value) => { if (element.getAttribute(key) !== String(value)) element.setAttribute(key, String(value)); };
    const listen = (element, type, handler, options) => {
      element.addEventListener(type, handler, options);
      const remove = () => { element.removeEventListener(type, handler, options); listeners.delete(remove); }; listeners.add(remove); return remove;
    };
    const dock = node("div", "category-dock"), scroller = node("div", "category-dock-scroller"), items = node("div", "category-dock-items");
    const previous = node("button", "category-dock-step", "‹"), next = node("button", "category-dock-step", "›");
    const summary = node("span", "category-dock-summary"), tooltip = node("span", "category-choice-tooltip");
    previous.type = next.type = "button"; previous.dataset.direction = "previous"; next.dataset.direction = "next";
    set(previous, "aria-label", "Scroll categories left"); set(next, "aria-label", "Scroll categories right");
    previous.tabIndex = next.tabIndex = -1;
    set(items, "role", "toolbar"); set(items, "aria-label", "Categories"); set(items, "aria-orientation", "horizontal");
    set(summary, "role", "status"); set(summary, "aria-live", "polite"); set(summary, "aria-atomic", "true");
    tooltip.id = `category-dock-tooltip-${++sequence}`; tooltip.hidden = true;
    set(tooltip, "role", "tooltip"); set(tooltip, "aria-hidden", "true");
    scroller.append(items); dock.append(previous, scroller, next, summary, tooltip); host.append(dock);

    const hideTooltip = () => { tooltip.hidden = true; };
    function showTooltip(record, deliberate = false) {
      if (deliberate) tooltipDismissed = false;
      if (destroyed || record.button.hidden || tooltipDismissed) return;
      tooltip.textContent = record.label; tooltip.hidden = false;
      const width = win.innerWidth || doc.documentElement?.clientWidth || 1024, height = win.innerHeight || doc.documentElement?.clientHeight || 768;
      tooltip.style.maxWidth = `${Math.max(0, width - 16)}px`;
      const bounds = record.button.getBoundingClientRect(), size = tooltip.getBoundingClientRect();
      const tooltipWidth = Math.min(size.width || Math.min(320, record.label.length * 7), Math.max(0, width - 16));
      tooltip.style.left = `${Math.max(8, Math.min(bounds.left + bounds.width / 2 - tooltipWidth / 2, width - tooltipWidth - 8))}px`;
      const tooltipHeight = size.height || 32;
      tooltip.style.top = `${Math.max(8, bounds.bottom + 8 + tooltipHeight <= height ? bounds.bottom + 8 : bounds.top - tooltipHeight - 8)}px`;
    }
    function refreshOverflow() {
      if (destroyed) return;
      const maximum = Math.max(0, scroller.scrollWidth - scroller.clientWidth), overflow = maximum > 1;
      previous.hidden = next.hidden = !overflow;
      previous.disabled = state.disabled || !overflow || scroller.scrollLeft <= 1;
      next.disabled = state.disabled || !overflow || scroller.scrollLeft >= maximum - 1;
    }
    function reveal(button) {
      if (!button || button.hidden) return;
      const bounds = button.getBoundingClientRect(), view = scroller.getBoundingClientRect();
      const delta = bounds.left < view.left ? bounds.left - view.left : bounds.right > view.right ? bounds.right - view.right : 0;
      if (delta) scroller.scrollBy?.({ left: delta, behavior: "auto" });
      refreshOverflow();
    }
    const visibleRecords = () => [all, ...state.categories.map(category => records.get(category.id))].filter(record => record && !record.button.hidden);
    function setRoving(record, focus = false) {
      if (!record || state.disabled || record.button.disabled) return;
      rovingId = record.id;
      for (const current of visibleRecords()) current.button.tabIndex = current === record ? 0 : -1;
      if (focus) record.button.focus({ preventScroll: true });
      reveal(record.button);
    }
    function makeRecord(id, allChoice = false) {
      const button = node("button", "category-choice"), icon = node("span", "category-icon"), name = node("span", "category-choice-name"), count = node("span", "category-choice-count");
      button.type = "button"; button.dataset.categoryId = id; button.tabIndex = -1;
      set(icon, "aria-hidden", "true"); set(name, "aria-hidden", "true"); set(count, "aria-hidden", "true");
      button.append(icon, name, count);
      const record = { id, button, icon, name, count, label: "", cleanup: [] };
      record.cleanup.push(listen(button, "click", () => {
        if (destroyed || state.disabled || button.disabled || button.hidden) return;
        setRoving(record);
        if (allChoice) onAll?.(); else onChoose?.(id);
      }));
      record.cleanup.push(listen(button, "focus", () => { setRoving(record); showTooltip(record, true); }));
      record.cleanup.push(listen(button, "blur", () => { if (hovered !== record) hideTooltip(); }));
      record.cleanup.push(listen(button, "pointerenter", () => { hovered = record; showTooltip(record, true); }));
      record.cleanup.push(listen(button, "pointerleave", () => { hovered = null; if (doc.activeElement !== button) hideTooltip(); }));
      return record;
    }
    const all = makeRecord("*", true);
    all.button.dataset.categoryIcon = "all"; all.name.textContent = "All";
    items.append(all.button);
    listen(items, "keydown", event => {
      if (event.key === "Escape" && !tooltip.hidden) { event.preventDefault(); event.stopPropagation(); tooltipDismissed = true; hideTooltip(); return; }
      if (state.disabled || event.altKey || event.ctrlKey || event.metaKey || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const available = visibleRecords().filter(record => !record.button.disabled), current = available.findIndex(record => record.button.contains(event.target));
      if (current < 0 || !available.length) return;
      const index = event.key === "Home" ? 0 : event.key === "End" ? available.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + available.length) % available.length;
      event.preventDefault(); setRoving(available[index], true);
    });
    listen(scroller, "scroll", () => {
      hideTooltip(); refreshOverflow();
      const focused = visibleRecords().find(record => record.button === doc.activeElement);
      if (!focused) return;
      const bounds = focused.button.getBoundingClientRect(), view = scroller.getBoundingClientRect();
      if (bounds.left >= view.left - 1 && bounds.right <= view.right + 1 && bounds.top >= view.top - 1 && bounds.bottom <= view.bottom + 1) showTooltip(focused);
    }, { passive: true });
    for (const [button, direction] of [[previous, -1], [next, 1]]) listen(button, "click", () => {
      if (destroyed || button.disabled || state.disabled) return;
      hideTooltip(); const reduce = win.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      scroller.scrollBy?.({ left: direction * Math.max(80, scroller.clientWidth * .7), behavior: reduce ? "auto" : "smooth" });
      refreshOverflow();
    });
    const onResize = () => { hideTooltip(); refreshOverflow(); };
    const Observer = win.ResizeObserver || root.ResizeObserver;
    const observer = typeof Observer === "function" ? new Observer(onResize) : null;
    if (observer) { observer.observe(scroller); observer.observe(items); }
    else if (win.addEventListener) listen(win, "resize", onResize);

    function update(value = {}) {
      if (destroyed) return;
      const focused = visibleRecords().find(record => record.button === doc.activeElement);
      const tooltipWasVisible = !tooltip.hidden, tooltipRecord = hovered || focused;
      const seen = new Set(), categories = [];
      for (const category of Array.isArray(value.categories) ? value.categories.slice(0, 200) : []) {
        if (!category || typeof category.id !== "string" || !category.id.trim() || category.id.length > 240 || category.id === "*" || seen.has(category.id)) continue;
        seen.add(category.id);
        const name = typeof category.name === "string" && category.name.trim() ? category.name.slice(0, 240) : category.id;
        categories.push({ id: category.id, name, count: Number.isFinite(category.count) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(category.count))) : 0 });
      }
      const selectedIds = [...new Set(Array.isArray(value.selectedIds) ? value.selectedIds.filter(id => seen.has(id)) : [])];
      state = { categories, mode: value.mode === "multiple" ? "multiple" : "single", selectedIds, allSelected: value.allSelected === true, disabled: value.disabled === true };
      const multiple = state.mode === "multiple", selected = new Set(multiple ? selectedIds : selectedIds.slice(0, 1));
      const nextIdentity = JSON.stringify(categories.map(category => category.id));
      const identitiesChanged = identity !== nextIdentity;
      if (identitiesChanged) {
        for (const [id, record] of records) if (!seen.has(id)) { record.cleanup.forEach(remove => remove()); record.button.remove(); records.delete(id); }
        for (const category of categories) if (!records.has(category.id)) records.set(category.id, makeRecord(category.id));
        for (const category of categories) items.append(records.get(category.id).button);
        identity = nextIdentity; hideTooltip();
      }
      dock.dataset.mode = state.mode; dock.classList.toggle("is-disabled", state.disabled);
      set(items, "aria-label", multiple ? "Select multiple categories" : "Product category"); set(items, "aria-disabled", state.disabled);
      set(items, "aria-description", multiple ? "Choose any combination. All toggles every category on or off. Left and right arrows move focus; Enter or Space changes selection."
        : "Choose one category. Left and right arrows move focus; Enter or Space opens the focused category.");
      all.button.hidden = !multiple; all.button.disabled = state.disabled || !categories.length;
      all.name.hidden = true;
      all.count.textContent = String(categories.reduce((sum, category) => sum + category.count, 0));
      let selectedCount = 0;
      for (const category of categories) {
        const record = records.get(category.id), definition = definitionFor(category), pressed = selected.has(category.id) || multiple && state.allSelected;
        if (pressed) selectedCount++;
        record.name.textContent = definition.short; record.name.hidden = multiple || !pressed;
        record.count.textContent = String(category.count); record.button.disabled = state.disabled;
        record.button.dataset.categoryIcon = definition.icon;
        const action = multiple ? pressed ? "Hide category" : "Add category" : pressed ? "Current category" : "Open category";
        record.label = `${category.name} · ${category.count} visible ${category.count === 1 ? "product" : "products"} · ${action}`;
        set(record.button, "aria-label", record.label); set(record.button, "aria-pressed", pressed);
      }
      const allActive = multiple && categories.length > 0 && selectedCount === categories.length;
      set(all.button, "aria-pressed", !multiple || !selectedCount ? "false" : allActive ? "true" : "mixed");
      all.label = `All categories · ${all.count.textContent} visible products · ${allActive ? "Clear every category" : "Show all categories"}`;
      set(all.button, "aria-label", all.label);
      const text = multiple ? selectedCount ? selectedCount === categories.length ? `All ${categories.length} categories selected` : `${selectedCount} of ${categories.length} categories selected` : "No categories selected"
        : `${categories.length} ${categories.length === 1 ? "category" : "categories"} · Select one`;
      if (summary.textContent !== text) summary.textContent = text;
      const available = visibleRecords(), enabled = available.filter(record => !record.button.disabled), preferred = enabled.find(record => record.id === focused?.id)
        || enabled.find(record => record.id === rovingId) || enabled.find(record => record.button.getAttribute("aria-pressed") === "true") || enabled[0];
      for (const record of [all, ...records.values()]) record.button.tabIndex = !state.disabled && record === preferred ? 0 : -1;
      rovingId = preferred?.id || null;
      if (focused && (focused.button.hidden || !focused.button.isConnected) && preferred && !state.disabled) preferred.button.focus({ preventScroll: true });
      else if (focused && doc.activeElement !== focused.button && focused.button.isConnected && !state.disabled) focused.button.focus({ preventScroll: true });
      const nextSelection = JSON.stringify([state.mode, selectedIds, state.allSelected]);
      if (nextSelection !== selectedSignature || identitiesChanged) reveal((focused?.button.isConnected && !focused.button.hidden ? focused : available.find(record => record.button.getAttribute("aria-pressed") === "true"))?.button);
      selectedSignature = nextSelection; refreshOverflow();
      if (tooltipWasVisible && tooltipRecord?.button.isConnected && !tooltipRecord.button.hidden) showTooltip(tooltipRecord);
      else if (tooltipWasVisible) hideTooltip();
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true; observer?.disconnect(); listeners.forEach(remove => remove()); records.clear(); hideTooltip(); dock.remove();
    }
    update();
    return Object.freeze({ update, destroy });
  }
  root.PortfolioCategoryNavigation = Object.freeze({ create });
})(globalThis);
