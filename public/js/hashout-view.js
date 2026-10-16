/* Dedicated category lanes for Hashout. Product timing comes from PortfolioHashoutLayout. */
(function (root) {
  "use strict";

  const STAGES = Object.freeze({ launched: "Released", "in-development": "In development", "in-planning": "In planning", embargo: "Embargo", "end-of-life": "End of life", unknown: "Stage unverified" });
  const RING_STAGGER_MS = 32, RING_MOTION_MS = 240;
  const HASHOUT_SELECTION = "#2DD4BF";
  const LABEL_MODES = Object.freeze(["default", "on", "off"]);
  const normalizeLabelMode = (value) => LABEL_MODES.includes(value) ? value : "default";
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const monthIndex = (value) => { const parts = /^(\d{4})-(\d{2})/.exec(String(value || "")); return parts ? Number(parts[1]) * 12 + Number(parts[2]) - 1 : null; };
  const monthText = (index, long = false) => new Intl.DateTimeFormat("en", { month: long ? "long" : "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(Math.floor(index / 12), Math.floor(index % 12), 1)));
  const entryKey = (entry) => entry?.key || JSON.stringify([entry?.categoryId, entry?.productId || entry?.product?.id]);

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function create(host, options = {}) {
    if (!host || !root.PortfolioHashoutLayout) throw new Error("Hashout needs a host and the category layout module.");
    const abort = new AbortController();
    const shell = node("section", "hashout-roadmap");
    shell.style.setProperty("--hashout-selection", HASHOUT_SELECTION);
    shell.style.setProperty("--hashout-selection-halo", root.PortfolioTheme?.alpha?.(HASHOUT_SELECTION, .14) || "#2dd4bf24");
    shell.setAttribute("aria-label", "Hashout roadmap by category");
    const toolbar = node("div", "hashout-toolbar");
    const picker = node("details", "hashout-category-picker");
    const pickerSummary = node("summary", "hashout-category-summary", "All categories");
    pickerSummary.setAttribute("aria-label", "Choose Hashout categories");
    const pickerPanel = node("div", "hashout-category-panel");
    pickerPanel.setAttribute("role", "group");
    pickerPanel.setAttribute("aria-label", "Hashout categories");
    picker.append(pickerSummary, pickerPanel);
    const searchShell = node("div", "hashout-search-shell");
    const searchIcon = node("span", "hashout-search-icon", "⌕");
    searchIcon.setAttribute("aria-hidden", "true");
    const search = node("input", "hashout-search");
    search.type = "search";
    search.placeholder = "Find a product";
    search.setAttribute("aria-label", "Find a product in selected Hashout categories");
    search.setAttribute("aria-autocomplete", "list");
    search.setAttribute("aria-expanded", "false");
    const results = node("div", "hashout-search-results");
    results.hidden = true;
    results.setAttribute("role", "list");
    results.setAttribute("aria-label", "Matching Hashout products");
    searchShell.append(searchIcon, search, results);
    const scopeCount = node("span", "hashout-scope-count");
    const back = node("button", "hashout-back-view", "Back to previous view"); back.type = "button"; back.hidden = true;
    const labelControl = node("div", "hashout-label-control");
    const labelTitle = node("span", "hashout-label-title", "Labels");
    const labelOptions = node("div", "hashout-label-options");
    labelOptions.setAttribute("role", "radiogroup"); labelOptions.setAttribute("aria-label", "Product name and date labels");
    for (const mode of LABEL_MODES) {
      const button = node("button", "", mode === "default" ? "Default" : mode === "on" ? "On" : "Off");
      button.type = "button"; button.dataset.labelMode = mode; button.setAttribute("role", "radio");
      button.title = mode === "default" ? "Show labels when the category lane has room" : mode === "on" ? "Show product name and date labels" : "Hide product labels";
      labelOptions.append(button);
    }
    labelControl.append(labelTitle, labelOptions);
    const windowsControl = node("div", "hashout-windows-control");
    const windowsToggle = node("button", "hashout-windows-toggle", "Windows"); windowsToggle.type = "button"; windowsToggle.setAttribute("aria-label", "Show seasonal on-shelf planning windows");
    const windowsKey = node("details", "hashout-windows-key");
    const windowsSummary = node("summary", "", "?"); windowsSummary.setAttribute("aria-label", "About seasonal planning windows");
    const windowsPanel = node("div", "hashout-windows-panel");
    windowsPanel.append(node("strong", "hashout-windows-heading", "Seasonal planning windows"));
    for (const [season, title, months] of [["spring", "Spring on-shelf", "Feb–May · ideal FFS Feb"], ["fall", "Fall on-shelf", "Jul–Oct · ideal FFS Jul"]]) {
      const row = node("div", `hashout-windows-key-row is-${season}`); row.append(node("span", "hashout-windows-swatch"), node("span", "", title), node("strong", "", months)); windowsPanel.append(row);
    }
    windowsPanel.append(node("p", "", "Each shaded window spans the ideal FFS month through the on-shelf target: February through May for spring, July through October for fall. Product positions use their own FFS estimates."), node("p", "", "Being inside a shaded window does not confirm readiness. The ideal FFS targets remain February for May on-shelf and July for October on-shelf; later FFS estimates are not automatically on time. A quarter or broader estimate may only overlap the ideal FFS target."), node("p", "hashout-windows-exceptions", "Retailer-specific exceptions apply. Amazon and Micro Center use flexible timing. Walmart fall and Target spring are special-case launches."));
    windowsKey.append(windowsSummary, windowsPanel); windowsControl.append(windowsToggle, windowsKey);
    toolbar.append(picker, searchShell, labelControl, windowsControl, back, scopeCount);
    const stage = node("div", "hashout-stage");
    const canvas = node("canvas", "hashout-canvas");
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Hashout category map. Hover a product to see its name and timing. Click a numbered group to expand its product circles on the roadmap. Arrow keys browse products; Enter expands a group or opens a product. Escape collapses the group. Drag to pan and use the zoom controls to change scale.");
    const laneHoverClip = node("div", "hashout-lane-hover-clip"); laneHoverClip.setAttribute("aria-hidden", "true");
    const laneHover = node("div", "hashout-lane-hover-frame"); laneHoverClip.append(laneHover);
    const selectionEffects = node("div", "hashout-selection-effects"); selectionEffects.setAttribute("aria-hidden", "true");
    const selectionWave = node("div", "hashout-selection-wave"); selectionWave.hidden = true; selectionEffects.append(selectionWave);
    const selectionGuide = node("div", "hashout-selection-guide"); selectionGuide.hidden = true; selectionGuide.setAttribute("aria-hidden", "true");
    const guideStroke = node("div", "hashout-selection-guide-stroke"), guideMonth = node("span", "hashout-selection-guide-month"); selectionGuide.append(guideStroke, guideMonth);
    const rail = node("div", "hashout-lane-rail");
    rail.setAttribute("aria-label", "Category lanes");
    const empty = node("div", "hashout-empty");
    empty.hidden = true;
    const card = node("section", "hashout-product-card");
    card.hidden = true;
    card.setAttribute("aria-label", "Product timing");
    card.setAttribute("aria-live", "polite");
    const ring = node("section", "hashout-ring-overlay"); ring.hidden = true; ring.tabIndex = -1; ring.setAttribute("role", "group"); ring.setAttribute("aria-label", "Expanded roadmap products");
    const live = node("span", "visually-hidden");
    live.setAttribute("role", "status");
    const navigator = node("nav", "board-navigator hashout-navigator hidden");
    navigator.id = `${host.id || "hashout"}Navigator`;
    navigator.setAttribute("aria-label", "Hashout horizontal navigation");
    const navLeft = node("button", "nav-step", "‹"), navRight = node("button", "nav-step", "›");
    navLeft.type = navRight.type = "button";
    navLeft.setAttribute("aria-label", "Scroll Hashout left"); navRight.setAttribute("aria-label", "Scroll Hashout right");
    const navRange = node("input", "nav-range");
    navRange.type = "range"; navRange.min = navRange.max = navRange.value = "0";
    navRange.setAttribute("aria-label", "Hashout horizontal position");
    const navPosition = node("span", "nav-position", "Scroll");
    navigator.append(navLeft, navRange, navRight, navPosition);
    stage.append(canvas, laneHoverClip, selectionGuide, selectionEffects, rail, empty, card, ring);
    shell.append(toolbar, stage, navigator, live);
    host.append(shell);

    let scope = options.getScope?.() ?? null;
    let labelMode = normalizeLabelMode(options.getLabelMode?.()), labelLayout = { mode: labelMode, labels: [], lanes: [] };
    let windowsVisible = options.getWindows?.() !== false, seasonalWindows = [], seasonalBands = [], seasonalSignature = "";
    const headerHeight = () => windowsVisible ? 78 : 46;
    let entries = [], allCategories = [], layout = null, horizon = null, viewport = null;
    let width = 0, height = 0, leftWidth = 166, renderFrame = 0, animationFrame = 0, destroyed = false;
    let selectedKey = options.getSelectedKey?.() || null, hovered = null, hoverMemberKey = null, pinned = false, cardAnchor = null, cardEntries = [], hideTimer = 0, keyboardIndex = -1, drag = null, suppressClick = false;
    let railSignature = "", pickerSignature = "", searchSignature = "", viewportSignature = "";
    let labelSignature = "", capsuleExpanded = false;
    let hoveredCategoryId = null, lanePointer = null, laneHoverFrame = 0;
    let ringState = null, ringCloseTimer = 0, previousViewport = null;
    let navigatorProjection = [], navigatorProjectionEntries = null, navigatorProjectionSignature = "";
    let coarseInput = Boolean(root.matchMedia?.("(pointer: coarse)")?.matches), revealGeneration = 0, revealTimers = [], revealFrames = [];
    const listen = (element, event, handler, config = {}) => element.addEventListener(event, handler, { ...config, signal: abort.signal });
    const theme = () => root.PortfolioTheme?.colors || { page: "#1A1B1C", surface: "#242527", header: "#333538", input: "#4D5054", text: "#D5D7DC", label: "#BBBCC0", alert: "#FF2525", borderStrong: "#676A70" };
    const alpha = (color, opacity) => root.PortfolioTheme?.alpha?.(color, opacity) || color;
    const font = () => root.PortfolioTheme?.fontFace || "Jost";
    const seasonColor = (season) => season === "spring" ? root.PortfolioTheme?.chartPalette?.indigo?.[40] || "#879DF1" : root.PortfolioTheme?.chartPalette?.yellow?.[40] || "#FFD569";
    shell.style.setProperty("--hashout-spring", seasonColor("spring")); shell.style.setProperty("--hashout-fall", seasonColor("fall"));
    const targetMatches = (period) => windowsVisible && root.PortfolioHashoutLayout.windowMatches ? root.PortfolioHashoutLayout.windowMatches(period, seasonalWindows.filter((window) => window.type === "ffs")) : [];
    const productWindowTone = (entry) => { const matches = targetMatches(entry?.period).filter((match) => match.match === "within"); return matches.length === 1 ? seasonColor(matches[0].season) : null; };
    const syncWindowsControl = () => {
      windowsToggle.setAttribute("aria-pressed", String(windowsVisible));
      shell.style.setProperty("--hashout-header-height", `${headerHeight()}px`);
      canvas.setAttribute("aria-description", windowsVisible ? "Spring on-shelf planning windows span February through May, with ideal FFS in February. Fall on-shelf planning windows span July through October, with ideal FFS in July. All product positions use their own estimated FFS dates." : "Seasonal planning windows are hidden.");
    };
    const appendWindowDetail = (parent, entry, compact = false) => {
      const matches = targetMatches(entry?.period); if (!matches.length) return;
      const seasons = [...new Set(matches.map((match) => match.season))];
      const text = compact && matches.length === 1 ? `${matches[0].match === "overlap" ? "FFS target overlap · " : ""}${matches[0].season === "spring" ? "Spring" : "Fall"} on-shelf · ${matches[0].onShelfLabel}`
        : matches.length === 1 ? `${matches[0].match === "overlap" ? "Overlaps " : ""}${matches[0].season === "spring" ? "Spring" : "Fall"} ${matches[0].year} FFS target → ${matches[0].onShelfLabel} on shelf`
        : `Overlaps ${seasons.map((season) => season === "spring" ? "Spring (Feb → May)" : "Fall (Jul → Oct)").join(" and ")} FFS targets`;
      const detail = node("p", "hashout-card-window", text); detail.dataset.seasons = [...new Set(matches.map((match) => match.season))].join(" "); parent.append(detail);
    };
    listen(windowsToggle, "click", () => { windowsVisible = !windowsVisible; syncWindowsControl(); options.onWindowsChange?.(windowsVisible); closeCard(); closeRing(); requestRender(); });
    listen(windowsKey, "toggle", () => {
      if (!windowsKey.open) return;
      const bounds = windowsSummary.getBoundingClientRect(), viewportWidth = document.documentElement.clientWidth, viewportHeight = root.innerHeight;
      const panelWidth = Math.min(360, viewportWidth - 24), below = viewportHeight - bounds.bottom - 16, above = bounds.top - 16, useBelow = below >= Math.min(180, above);
      windowsPanel.style.width = `${panelWidth}px`; windowsPanel.style.maxHeight = `${Math.min(400, viewportHeight * .6, Math.max(40, useBelow ? below : above))}px`;
      windowsPanel.style.left = `${clamp(bounds.right - panelWidth, 12, Math.max(12, viewportWidth - panelWidth - 12))}px`;
      windowsPanel.style.top = `${useBelow ? bounds.bottom + 8 : Math.max(8, bounds.top - windowsPanel.getBoundingClientRect().height - 8)}px`;
    });
    listen(windowsKey, "keydown", (event) => { if (event.key === "Escape") { windowsKey.open = false; windowsSummary.focus(); event.preventDefault(); } });
    syncWindowsControl();
    const getEntry = (key) => entries.find((item) => item.key === key);
    const sameGlyph = (a, b) => Boolean(a && b && a.categoryId === b.categoryId && a.memberKeys.length === b.memberKeys.length && a.memberKeys.every((key, index) => key === b.memberKeys[index]));
    const scopeIds = () => scope === null ? allCategories.map((item) => item.id) : scope;
    const syncLabelControl = () => {
      for (const button of labelOptions.children) { const active = button.dataset.labelMode === labelMode; button.setAttribute("aria-checked", String(active)); button.tabIndex = active ? 0 : -1; }
    };
    const chooseLabelMode = (value) => {
      const next = normalizeLabelMode(value); if (next === labelMode) return;
      if (!pinned) closeCard();
      labelMode = next; syncLabelControl(); options.onLabelModeChange?.(labelMode); requestRender();
    };
    for (const button of labelOptions.children) {
      listen(button, "click", () => chooseLabelMode(button.dataset.labelMode));
      listen(button, "keydown", (event) => {
        const index = LABEL_MODES.indexOf(button.dataset.labelMode);
        const next = event.key === "Home" ? 0 : event.key === "End" ? LABEL_MODES.length - 1 : ["ArrowRight", "ArrowDown"].includes(event.key) ? (index + 1) % LABEL_MODES.length : ["ArrowLeft", "ArrowUp"].includes(event.key) ? (index + LABEL_MODES.length - 1) % LABEL_MODES.length : -1;
        if (next < 0) return; event.preventDefault(); chooseLabelMode(LABEL_MODES[next]); labelOptions.children[next].focus();
      });
    }
    syncLabelControl();
    const notifyViewport = () => {
      if (!viewport || !horizon) return;
      const signature = `${viewport.start}:${viewport.end}:${horizon.start}:${horizon.end}`;
      if (signature === viewportSignature) return;
      viewportSignature = signature;
      options.onViewportChange?.({ ...viewport, zoom: horizon.count / (viewport.end - viewport.start) });
    };

    function normalizedRange() {
      const value = options.getRange?.() || {};
      const start = Number.isFinite(value.start) ? value.start : monthIndex(value.startMonth);
      const end = Number.isFinite(value.end) ? value.end : monthIndex(value.endMonth);
      const fallback = new Date().getFullYear() * 12;
      const first = Number.isFinite(start) ? Math.floor(start) : fallback;
      const last = Number.isFinite(end) && end >= first ? Math.floor(end) : first + 119;
      return { start: first, end: last, count: last - first + 1 };
    }

    function boundViewport(value) {
      const total = horizon.count, span = clamp(value.end - value.start, Math.min(Math.max(3, total / 20), total), total);
      const first = clamp(value.start, horizon.start, horizon.end + 1 - span);
      return { start: first, end: first + span };
    }

    function setViewport(next, animate = false) {
      if (!horizon) return;
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      const target = boundViewport(next);
      if (!animate || root.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || !viewport) {
        viewport = target;
        requestRender();
        notifyViewport();
        return;
      }
      const previous = { ...viewport }, started = performance.now();
      const tick = (now) => {
        const fraction = clamp((now - started) / 150, 0, 1), easing = 1 - Math.pow(1 - fraction, 3);
        viewport = { start: previous.start + (target.start - previous.start) * easing, end: previous.end + (target.end - previous.end) * easing };
        draw();
        if (fraction < 1) animationFrame = requestAnimationFrame(tick);
        else { animationFrame = 0; viewport = target; notifyViewport(); }
      };
      animationFrame = requestAnimationFrame(tick);
    }

    function navigatorState() {
      const visible = Math.max(1, width - leftWidth), plotHeight = Math.max(1, height - headerHeight());
      if (!horizon || !viewport) return { total: visible, visible, left: 0, height: plotHeight, scale: 1, minScale: 1, maxScale: 1, items: [] };
      const scale = horizon.count / (viewport.end - viewport.start);
      const signature = JSON.stringify([horizon, visible, plotHeight, layout?.lanes.map((lane) => [lane.categoryId, lane.y, lane.height]), selectedKey]);
      if (navigatorProjectionEntries !== entries || navigatorProjectionSignature !== signature) {
        navigatorProjectionEntries = entries; navigatorProjectionSignature = signature;
        const lanes = new Map((layout?.lanes || []).map((lane) => [lane.categoryId, lane]));
        navigatorProjection = entries.flatMap((entry) => {
          const lane = lanes.get(entry.categoryId);
          const shape = lane && root.PortfolioFfsRoadmap.geometry(entry.product, horizon, 0, { leftWidth: 0, monthWidth: visible / horizon.count, rowHeight: 20 });
          if (!shape) return [];
          return [{ x: shape.x, width: shape.width, y: lane.y - headerHeight() + lane.height * .35, height: Math.max(2, lane.height * .3), selected: entry.key === selectedKey }];
        });
      }
      return { total: visible * scale, visible, left: (viewport.start - horizon.start) * visible / (viewport.end - viewport.start), height: plotHeight,
        scale, minScale: 1, maxScale: horizon.count / Math.min(Math.max(3, horizon.count / 20), horizon.count),
        items: navigatorProjection.map((item) => ({ ...item, x: item.x * scale, width: item.width * scale })) };
    }

    function panNavigator(left) {
      if (!horizon || !viewport) return;
      const span = viewport.end - viewport.start, start = horizon.start + left / Math.max(1, width - leftWidth) * span;
      closeCard(); closeRing(); setViewport({ start, end: start + span });
    }

    function resizeNavigator({ scale, edge, anchor }) {
      if (!horizon || !viewport) return;
      const fixed = horizon.start + anchor / Math.max(1, width - leftWidth) * horizon.count, span = horizon.count / scale;
      closeCard(); closeRing();
      setViewport(edge === "left" ? { start: fixed - span, end: fixed } : { start: fixed, end: fixed + span });
    }

    const overview = root.PortfolioNavigator?.create(navigator, { getState: navigatorState, onPan: panNavigator, onResize: resizeNavigator });
    listen(navRange, "input", () => panNavigator(Number(navRange.value)));
    listen(navLeft, "click", () => { const state = navigatorState(); panNavigator(Math.max(0, state.left - state.visible * .85)); });
    listen(navRight, "click", () => { const state = navigatorState(); panNavigator(Math.min(state.total - state.visible, state.left + state.visible * .85)); });

    function updateNavigator() {
      const state = navigatorState(), max = Math.max(0, state.total - state.visible);
      navRange.max = String(max); navRange.value = String(clamp(state.left, 0, max));
      navLeft.disabled = state.left <= .5; navRight.disabled = state.left >= max - .5;
      overview?.update();
      navigator.classList.toggle("hidden", !layout?.lanes.length || !state.items.length && max <= 2);
    }

    function chooseScope(ids) {
      const valid = new Set(allCategories.map((item) => item.id));
      scope = ids === null ? null : [...new Set(ids)].filter((id) => valid.has(id));
      options.onScopeChange?.(scope === null ? null : [...scope]);
      closeCard();
      closeRing();
      clearLaneHover();
      refreshData();
      requestRender();
    }

    function refreshData() {
      const portfolio = options.getPortfolio?.() || { categories: [] };
      allCategories = (portfolio.categories || []).map((category) => ({ id: category.id, name: category.name || "Category", count: category.board?.products?.length || 0 }));
      if (scope !== null) scope = scope.filter((id) => allCategories.some((category) => category.id === id));
      entries = root.PortfolioHashoutLayout.project(portfolio, scope);
      const nextHorizon = normalizedRange();
      if (!horizon) {
        horizon = nextHorizon;
        const saved = options.getViewport?.();
        viewport = saved && Number.isFinite(saved.start) && Number.isFinite(saved.end) && saved.end > saved.start ? boundViewport(saved) : { start: horizon.start, end: horizon.end + 1 };
      }
      else if (nextHorizon.start !== horizon.start || nextHorizon.end !== horizon.end) {
        const wasFit = Math.abs(viewport.end - viewport.start - horizon.count) < .001;
        horizon = nextHorizon;
        viewport = wasFit ? { start: horizon.start, end: horizon.end + 1 } : boundViewport(viewport);
      }
      if (options.getSelectedKey) selectedKey = options.getSelectedKey() || null;
      const nextSeasonalSignature = `${horizon.start}:${horizon.end}`;
      if (nextSeasonalSignature !== seasonalSignature) {
        seasonalSignature = nextSeasonalSignature;
        seasonalWindows = root.PortfolioHashoutLayout.seasonalWindows?.(horizon, { context: true }) || [];
        seasonalBands = root.PortfolioHashoutLayout.seasonalBands?.(horizon) || [];
      }
      if (selectedKey && !getEntry(selectedKey)) { hovered = null; if (pinned) closeCard(); }
      updatePicker();
      updateSearch();
      scopeCount.textContent = `${entries.length} ${entries.length === 1 ? "product" : "products"}`;
      scopeCount.setAttribute("aria-label", `${entries.length} products in ${entries.categories?.length ?? scopeIds().length} selected categories`);
    }

    function updatePicker() {
      const ids = new Set(scopeIds());
      pickerSummary.textContent = scope === null || ids.size === allCategories.length ? "All categories" : ids.size === 1 ? allCategories.find((item) => ids.has(item.id))?.name || "1 category" : `${ids.size} categories`;
      pickerSummary.title = "Choose one or multiple categories";
      const signature = JSON.stringify([allCategories, [...ids]]);
      if (signature === pickerSignature) return;
      pickerSignature = signature;
      pickerPanel.replaceChildren();
      const allRow = node("label", "hashout-category-option hashout-category-all");
      const allInput = node("input"); allInput.type = "checkbox"; allInput.checked = ids.size === allCategories.length; allInput.indeterminate = ids.size > 0 && ids.size < allCategories.length;
      allInput.setAttribute("aria-label", "All Hashout categories");
      allRow.append(allInput, node("span", "", "All categories"));
      listen(allInput, "change", () => chooseScope(allInput.checked ? null : []));
      pickerPanel.append(allRow);
      for (const category of allCategories) {
        const label = node("label", "hashout-category-option");
        const input = node("input"); input.type = "checkbox"; input.checked = ids.has(category.id); input.value = category.id;
        input.setAttribute("aria-label", `${category.name}, ${category.count} visible ${category.count === 1 ? "product" : "products"}`);
        label.append(input, node("span", "hashout-category-name", category.name), node("small", "", String(category.count)));
        listen(input, "change", () => { const current = new Set(scopeIds()); if (input.checked) current.add(category.id); else current.delete(category.id); chooseScope(current.size === allCategories.length ? null : [...current]); });
        pickerPanel.append(label);
      }
    }

    function searchText(entry) {
      const product = entry.product || {};
      return [product.name, product.family, product.basePartNumber, product.sku, ...(product.skus || []).map((sku) => [sku.code, sku.name].filter(Boolean).join(" "))].filter(Boolean).join(" ").toLocaleLowerCase();
    }

    function productButton(entry, action) {
      const button = node("button", "hashout-product-result");
      button.type = "button";
      button.setAttribute("data-product-key", entry.key);
      const name = entry.product?.name || "Unnamed product";
      button.append(node("strong", "", name), node("span", "", `${entry.period ? `FFS ${entry.period.label}` : "FFS TBD"} · ${STAGES[entry.stage] || STAGES.unknown}`));
      button.title = `${name}\n${entry.categoryName}\n${entry.period ? `FFS ${entry.period.label}` : "FFS TBD"}`;
      listen(button, "click", () => action(entry));
      listen(button, "pointerenter", () => { hoverMemberKey = entry.key; requestRender(); });
      listen(button, "pointerleave", () => { if (hoverMemberKey === entry.key) { hoverMemberKey = null; requestRender(); } });
      listen(button, "focus", () => { hoverMemberKey = entry.key; requestRender(); });
      listen(button, "blur", () => { if (hoverMemberKey === entry.key) { hoverMemberKey = null; requestRender(); } });
      return button;
    }

    function updateSearch() {
      const query = search.value.trim().toLocaleLowerCase();
      const signature = JSON.stringify([query, entries.map((entry) => [entry.key, entry.product?.name, entry.period?.label])]);
      if (signature === searchSignature) return;
      searchSignature = signature;
      results.replaceChildren();
      if (!query) { results.hidden = true; search.setAttribute("aria-expanded", "false"); return; }
      const matches = entries.filter((entry) => searchText(entry).includes(query));
      const summary = node("p", "hashout-result-summary", matches.length ? `${matches.length} ${matches.length === 1 ? "match" : "matches"}` : "No products in the selected categories");
      results.append(summary);
      for (const entry of matches.slice(0, 80)) results.append(productButton(entry, (item) => { focusProduct(item.key); results.hidden = true; search.setAttribute("aria-expanded", "false"); }));
      if (matches.length > 80) results.append(node("p", "hashout-result-summary", "Type more to narrow these results."));
      results.hidden = false;
      search.setAttribute("aria-expanded", "true");
    }

    function updateRail() {
      const signature = JSON.stringify([leftWidth, layout.lanes.map((lane) => [lane.categoryId, lane.name, lane.y, lane.height, lane.count, lane.missingCount, lane.outsideCount])]);
      if (railSignature === signature) return;
      railSignature = signature;
      rail.style.width = `${leftWidth}px`;
      rail.replaceChildren();
      for (const lane of layout.lanes) {
        const label = node("div", "hashout-lane-label");
        label.dataset.categoryId = lane.categoryId;
        label.style.top = `${lane.y}px`; label.style.height = `${lane.height}px`;
        if (lane.height < 31) label.classList.add("is-compact");
        const heading = node("button", "hashout-lane-name", lane.name);
        heading.type = "button"; heading.title = `${lane.name} · ${lane.count} products`;
        heading.setAttribute("aria-label", `${lane.name}, ${lane.count} products. Open product list.`);
        listen(heading, "click", () => showEntries(entries.filter((entry) => entry.categoryId === lane.categoryId), { x: leftWidth + 6, y: lane.y + lane.height / 2 }, true, lane.name));
        const count = node("span", "hashout-lane-count", String(lane.count));
        const headingRow = node("div", "hashout-lane-heading"); headingRow.append(heading, count);
        label.append(headingRow);
        if (lane.missingCount || lane.outsideCount) {
          const meta = node("div", "hashout-lane-meta");
          const add = (text, items, explanation) => { const button = node("button", "", text); button.type = "button"; button.title = explanation; button.setAttribute("aria-label", `${lane.name}: ${explanation}`); listen(button, "click", () => showEntries(items, { x: leftWidth + 6, y: lane.y + lane.height / 2 }, true, `${lane.name} · ${text}`)); meta.append(button); };
          if (lane.missingCount) add(`${lane.missingCount} TBD`, lane.missingEntries, `${lane.missingCount} products have no FFS timing`);
          if (lane.outsideCount) add(`${lane.outsideCount} outside`, lane.outsideEntries, `${lane.outsideCount} products are outside the selected date range`);
          label.append(meta);
        }
        rail.append(label);
      }
    }

    function dimensions() {
      const rectangle = stage.getBoundingClientRect();
      const nextWidth = Math.max(1, Math.round(rectangle.width)), nextHeight = Math.max(1, Math.round(rectangle.height));
      if (width !== nextWidth || height !== nextHeight) { clearLaneHover(); windowsKey.open = false; }
      width = nextWidth; height = nextHeight;
      if (ringState && (ringState.width !== width || ringState.height !== height)) { closeRing(); closeCard(); clearTimeout(ringCloseTimer); ring.hidden = true; ring.replaceChildren(); ring.classList.remove("is-closing"); }
      leftWidth = width < 520 ? 112 : width < 800 ? 142 : 166;
      shell.style.setProperty("--hashout-plot-left", `${leftWidth}px`);
      selectionEffects.style.left = `${leftWidth}px`;
      selectionGuide.style.left = `${leftWidth}px`;
      const ratio = Math.min(root.devicePixelRatio || 1, 3);
      const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      return ratio;
    }

    function drawCalendar(context) {
      const colors = theme(), span = viewport.end - viewport.start, plotWidth = width - leftWidth, header = headerHeight();
      context.save(); context.beginPath(); context.rect(leftWidth, 0, plotWidth, height); context.clip();
      const xAt = (month) => leftWidth + (month - viewport.start) / span * plotWidth;
      const startYear = Math.floor(viewport.start / 12), endYear = Math.floor((viewport.end - .0001) / 12);
      const yearPixels = 12 / span * plotWidth;
      const yearStride = yearPixels < 36 ? 3 : yearPixels < 58 ? 2 : 1;
      for (let year = startYear; year <= endYear; year++) {
        const x = xAt(year * 12), nextX = xAt((year + 1) * 12);
        if (year % 2) { context.fillStyle = alpha(colors.label, .024); context.fillRect(Math.max(leftWidth, x), header, Math.min(width, nextX) - Math.max(leftWidth, x), height - header); }
        context.strokeStyle = alpha(colors.label, .11); context.lineWidth = 1; context.beginPath(); context.moveTo(x + .5, 0); context.lineTo(x + .5, height); context.stroke();
        if ((year - startYear) % yearStride === 0) {
          context.font = `600 ${width < 520 ? 10 : 12}px ${font()}`; context.fillStyle = colors.text; context.textAlign = "left"; context.textBaseline = "middle";
          const label = String(year), labelWidth = context.measureText(label).width;
          context.fillText(label, clamp(x + 8, leftWidth + 6, Math.max(leftWidth + 6, width - labelWidth - 6)), 17);
        }
      }
      const monthPixels = plotWidth / span;
      if (monthPixels >= 23) {
        for (let month = Math.floor(viewport.start); month < viewport.end; month++) {
          const x = xAt(month), yearMonth = month % 12;
          context.fillStyle = colors.label; context.font = `10px ${font()}`; context.textAlign = "center";
          context.fillText(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][yearMonth], xAt(month + .5), 35);
          context.strokeStyle = alpha(colors.label, .045); context.beginPath(); context.moveTo(x + .5, header); context.lineTo(x + .5, height); context.stroke();
        }
      } else if (monthPixels * 3 >= 35) {
        for (let month = Math.floor(viewport.start / 3) * 3; month < viewport.end; month += 3) {
          context.fillStyle = colors.label; context.font = `10px ${font()}`; context.textAlign = "center"; context.fillText(`Q${Math.floor(month % 12 / 3) + 1}`, xAt(month + 1.5), 35);
        }
      }
      if (windowsVisible) {
        for (const window of seasonalBands) {
          const color = seasonColor(window.season), x = xAt(window.startMonth), right = xAt(window.endMonth);
          const visibleX = Math.max(leftWidth, x), visibleRight = Math.min(width, right), visibleWidth = visibleRight - visibleX;
          if (visibleWidth <= 0) continue;
          context.fillStyle = alpha(color, .045); context.fillRect(visibleX, header, visibleWidth, Math.max(0, height - header));
          context.fillStyle = alpha(color, .12); context.fillRect(visibleX, 46, visibleWidth, header - 46);
          context.strokeStyle = alpha(color, .2); context.lineWidth = 1; context.beginPath(); context.moveTo(x + .5, 46); context.lineTo(x + .5, height); context.moveTo(right + .5, 46); context.lineTo(right + .5, height); context.stroke();
          // The full names remain readable in the fixed corner key. Repeated
          // annual titles are shown only when they fit their own visible span.
          context.save(); context.beginPath(); context.rect(visibleX, 46, visibleWidth, header - 46); context.clip();
          context.font = `500 10px ${font()}`; context.fillStyle = color; context.textAlign = "center"; context.textBaseline = "middle";
          const center = (visibleX + visibleRight) / 2;
          if (context.measureText(window.label).width + 12 <= visibleWidth) {
            context.fillText(window.label, center, 56);
            context.font = `9px ${font()}`; context.fillStyle = alpha(colors.text, .7);
            context.fillText(window.season === "spring" ? "Feb–May" : "Jul–Oct", center, 69);
          } else {
            context.font = `500 9px ${font()}`;
            if (Math.max(context.measureText("Spring").width, context.measureText("on-shelf").width) + 6 <= visibleWidth) {
              context.fillText(window.season === "spring" ? "Spring" : "Fall", center, 56);
              context.fillText("on-shelf", center, 69);
            }
          }
          context.restore();
        }
      }
      const now = new Date(), today = now.getFullYear() * 12 + now.getMonth() + (now.getDate() - 1) / new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      if (today >= viewport.start && today < viewport.end) {
        const x = xAt(today); context.strokeStyle = colors.alert; context.lineWidth = 1; context.setLineDash([4, 4]); context.beginPath(); context.moveTo(x, header); context.lineTo(x, height); context.stroke(); context.setLineDash([]);
      }
      context.restore();
      context.fillStyle = colors.surface; context.fillRect(0, 0, leftWidth, header);
      context.font = `500 11px ${font()}`; context.fillStyle = colors.label; context.textAlign = "left"; context.textBaseline = "middle"; context.fillText("Category", 14, 24);
      if (windowsVisible) {
        context.font = `500 10px ${font()}`;
        for (const [season, label, y] of [["spring", "Spring on-shelf", 55], ["fall", "Fall on-shelf", 69]]) {
          context.fillStyle = seasonColor(season); context.beginPath(); context.roundRect(14, y - 3, 5, 6, 2); context.fill();
          context.fillStyle = colors.text; context.fillText(label, 25, y);
        }
      }
      context.strokeStyle = alpha(colors.label, .14); context.beginPath(); context.moveTo(0, header - .5); context.lineTo(width, header - .5); context.stroke();
    }

    function drawGlyph(context, glyph, selected = false, highlighted = false) {
      const colors = theme(), radius = glyph.radius || Math.min(5, Math.max(2.5, glyph.height / 2));
      const glyphLane = layout?.lanes.find((lane) => lane.categoryId === glyph.categoryId);
      const stageColor = root.PortfolioModel?.lifecycleTone?.(glyph.stage) || colors.input;
      const windowTone = glyph.entries?.length === 1 ? productWindowTone(glyph.entries[0]) : null;
      const stroke = selected ? HASHOUT_SELECTION : glyph.stage === "embargo" ? colors.alert : highlighted ? colors.text : windowTone || alpha(colors.label, .86);
      context.save(); context.lineWidth = selected || highlighted ? 2.3 : 1.65;
      if (glyphLane) { context.beginPath(); context.rect(leftWidth, glyphLane.y, width - leftWidth, glyphLane.height); context.clip(); }
      if (glyph.type === "window") {
        context.fillStyle = selected ? alpha(HASHOUT_SELECTION, .16) : alpha(stageColor, .72); context.strokeStyle = alpha(stroke, selected || highlighted ? .85 : .48);
        const y = glyph.centerY - Math.max(3, radius * .68), h = Math.max(6, radius * 1.36), actualWidth = Math.max(.65, glyph.width);
        context.beginPath(); context.roundRect(glyph.x, y, actualWidth, h, Math.min(3, actualWidth / 2)); context.fill(); context.stroke();
        context.beginPath(); context.moveTo(glyph.x, y - 2); context.lineTo(glyph.x, y + h + 2); context.moveTo(glyph.x + glyph.width, y - 2); context.lineTo(glyph.x + glyph.width, y + h + 2); context.stroke();
      } else if (glyph.type === "group") {
        const x = glyph.x, right = glyph.x + glyph.width, y = glyph.centerY;
        context.strokeStyle = alpha(colors.label, highlighted ? .8 : .4); context.lineWidth = 1.25;
        context.beginPath(); context.moveTo(x, y - 3); context.lineTo(x, y + 3); context.moveTo(x, y); context.lineTo(right, y); context.moveTo(right, y - 3); context.lineTo(right, y + 3); context.stroke();
        const cx = glyph.countLabelX ?? glyph.centerX, countRadius = glyph.badgeRadius ?? Math.min(Math.max(1, (glyphLane?.height ?? 24) / 2 - 1), Math.max(7.5, Math.min(10, glyph.entries.length >= 100 ? 10 : glyph.height / 2 + 2)));
        context.fillStyle = colors.surface; context.strokeStyle = stroke; context.lineWidth = highlighted ? 2 : 1.5; context.beginPath(); context.arc(cx, y, countRadius, 0, Math.PI * 2); context.fill(); context.stroke();
        const label = String(glyph.entries.length);
        let labelSize = Math.min(Math.max(6, 11 - label.length), countRadius * 1.15);
        context.fillStyle = colors.text; context.font = `600 ${labelSize}px ${font()}`;
        while (labelSize > 3 && context.measureText(label).width > countRadius * 2 - 3) { labelSize -= .5; context.font = `600 ${labelSize}px ${font()}`; }
        context.textAlign = "center"; context.textBaseline = "middle"; context.fillText(label, cx, y + .4);
      } else {
        if (selected || highlighted) { context.fillStyle = alpha(selected ? HASHOUT_SELECTION : colors.text, selected ? .14 : .075); context.beginPath(); context.arc(glyph.centerX, glyph.centerY, radius + 4, 0, Math.PI * 2); context.fill(); }
        context.fillStyle = colors.page; context.strokeStyle = stroke; context.beginPath(); context.arc(glyph.centerX, glyph.centerY, radius, 0, Math.PI * 2); context.fill(); context.stroke();
      }
      context.restore();
    }

    function selectedOverlay(entry, glyph) {
      if (!entry?.period || !glyph) return null;
      const range = horizon, monthWidth = (width - leftWidth) / (viewport.end - viewport.start);
      const base = root.PortfolioFfsRoadmap.geometry(entry.product, range, 0, { leftWidth: leftWidth + (horizon.start - viewport.start) * monthWidth, monthWidth, rowHeight: 20 });
      if (!base) return null;
      const x = Math.max(leftWidth, base.x), right = Math.min(width, base.x + base.width);
      if (right < leftWidth || x > width || base.centerX < leftWidth && base.kind === "point" || base.centerX > width && base.kind === "point") return null;
      return { type: base.kind, categoryId: glyph.categoryId, x, width: Math.max(0, right - x), centerX: base.kind === "point" ? base.centerX : (x + right) / 2, y: glyph.y, centerY: glyph.centerY, height: glyph.height, radius: glyph.radius, stage: entry.stage, entries: [entry], memberKeys: [entry.key] };
    }

    function focusKeys(neutral = false) {
      if (neutral) return null;
      if (ringState) return new Set(hoverMemberKey ? [hoverMemberKey] : ringState.selectedKey ? [ringState.selectedKey] : ringState.entries.map((entry) => entry.key));
      if (card.hidden) return null;
      if (hoverMemberKey) return new Set([hoverMemberKey]);
      if (pinned && cardEntries.some((entry) => entry.key === selectedKey)) return new Set([selectedKey]);
      return new Set(cardEntries.map((entry) => entry.key));
    }

    function fitLabelText(context, value, available) {
      const text = String(value || ""); if (context.measureText(text).width <= available) return text;
      const characters = Array.from(text); let low = 0, high = characters.length;
      while (low < high) {
        const count = Math.ceil((low + high) / 2), prefix = Math.ceil(count * .7), suffix = count - prefix;
        const candidate = characters.slice(0, prefix).join("") + "…" + (suffix ? characters.slice(-suffix).join("") : "");
        if (context.measureText(candidate).width <= available) low = count; else high = count - 1;
      }
      const prefix = Math.ceil(low * .7), suffix = low - prefix;
      return characters.slice(0, prefix).join("") + "…" + (suffix ? characters.slice(-suffix).join("") : "");
    }

    function updateLabels(context) {
      const signature = JSON.stringify([labelMode, width, height, leftWidth, viewport, font(), layout.glyphs.map((glyph) => [glyph.categoryId, glyph.x, glyph.width, glyph.centerY, glyph.memberKeys]), entries.map((entry) => [entry.key, entry.product?.name, entry.period?.label, entry.stage])]);
      if (signature === labelSignature) return;
      labelSignature = signature;
      const candidates = [], seen = new Set(), maximumWidth = Math.min(270, Math.max(0, width - leftWidth - 12));
      for (const glyph of layout.glyphs) for (const entry of glyph.entries) {
        if (seen.has(entry.key) || !entry.period || maximumWidth < 72) continue;
        const source = glyph.type === "group" ? selectedOverlay(entry, glyph) : glyph;
        if (!source || source.centerX < leftWidth || source.centerX > width) continue;
        seen.add(entry.key);
        const name = entry.product?.name || "Unnamed product", date = entry.period.label;
        context.font = `500 11px ${font()}`; const nameWidth = context.measureText(name).width;
        context.font = `10px ${font()}`; const dateWidth = context.measureText(date).width;
        const labelWidth = Math.min(maximumWidth, Math.max(34, nameWidth) + dateWidth + 36);
        const chipWidth = Math.min(dateWidth + 14, labelWidth - 38);
        context.font = `500 11px ${font()}`; const nameText = fitLabelText(context, name, labelWidth - chipWidth - 22);
        context.font = `10px ${font()}`; const dateText = fitLabelText(context, date, chipWidth - 14);
        candidates.push({ key: entry.key, categoryId: entry.categoryId, anchorX: source.centerX, anchorY: source.centerY, width: labelWidth, height: 28, markerRadius: source.radius || 5, name, date, nameText, dateText, chipWidth, entry, glyph: source });
      }
      labelLayout = typeof root.PortfolioHashoutLayout.labels === "function" ? root.PortfolioHashoutLayout.labels(layout, candidates, { mode: labelMode, gap: 6, padding: 4, markerGap: 5 }) : { mode: labelMode, labels: [], lanes: [] };
    }

    function drawLabels(context, focused, neutral) {
      updateLabels(context);
      for (const label of labelLayout.labels) {
        if (!neutral && !card.hidden && card.classList.contains("is-inline") && cardEntries.length === 1 && cardEntries[0].key === label.key) continue;
        context.save(); if (focused && !focused.has(label.key)) context.globalAlpha = .33;
        const lane = layout.lanes.find((item) => item.categoryId === label.categoryId);
        if (lane) { context.beginPath(); context.rect(leftWidth, lane.y, width - leftWidth, lane.height); context.clip(); }
        const active = label.key === selectedKey || !neutral && label.key === hoverMemberKey;
        const surface = "#2A2F30", chip = active ? "#3B514C" : "#373C3D";
        context.fillStyle = surface; context.beginPath(); context.roundRect(label.x, label.y, label.width, label.height, 13); context.fill();
        // A short, filled tail identifies the source without introducing a
        // connector across neighboring products or changing the date position.
        const tailX = clamp(label.anchorX, label.x + 12, label.x + label.width - 12), tailY = clamp(label.anchorY, label.y + 9, label.y + label.height - 9);
        context.beginPath();
        if (label.anchorX < label.x && label.anchorY >= label.y && label.anchorY <= label.y + label.height) { context.moveTo(label.x + 1, tailY - 4); context.lineTo(label.x - 5, tailY); context.lineTo(label.x + 1, tailY + 4); }
        else if (label.anchorX > label.x + label.width && label.anchorY >= label.y && label.anchorY <= label.y + label.height) { context.moveTo(label.x + label.width - 1, tailY - 4); context.lineTo(label.x + label.width + 5, tailY); context.lineTo(label.x + label.width - 1, tailY + 4); }
        else if (label.anchorY < label.y) { context.moveTo(tailX - 5, label.y + 1); context.lineTo(tailX, label.y - 5); context.lineTo(tailX + 5, label.y + 1); }
        else if (label.anchorY > label.y + label.height) { context.moveTo(tailX - 5, label.y + label.height - 1); context.lineTo(tailX, label.y + label.height + 5); context.lineTo(tailX + 5, label.y + label.height - 1); }
        context.closePath(); context.fill();
        const chipX = label.x + label.width - label.chipWidth - 5;
        context.fillStyle = chip; context.beginPath(); context.roundRect(chipX, label.y + 4, label.chipWidth, 20, 8); context.fill();
        context.textAlign = "left"; context.textBaseline = "middle";
        context.font = `500 11px ${font()}`; context.fillStyle = active ? "#DDF8F0" : "#E6EBE9"; context.fillText(label.nameText, label.x + 11, label.y + 14);
        context.font = `10px ${font()}`; context.fillStyle = active ? "#B5F1E3" : "#BDC8C4"; context.textAlign = "center"; context.fillText(label.dateText, chipX + label.chipWidth / 2, label.y + 14);
        context.restore();
      }
    }

    function updateSelectionWave() {
      const visibleInOrbit = ringState?.geometry?.positions.some((slot) => ringState.entries[slot.index]?.key === selectedKey);
      const glyph = selectedKey && layout.glyphs.find((item) => item.memberKeys.includes(selectedKey));
      const source = glyph?.type === "group" ? selectedOverlay(getEntry(selectedKey), glyph) : glyph;
      updateSelectionGuide(getEntry(selectedKey), source);
      const visible = Boolean(source && !visibleInOrbit && source.centerX >= leftWidth && source.centerX <= width && source.centerY >= headerHeight() && source.centerY <= height);
      selectionWave.hidden = !visible;
      if (!visible) { selectionWave.classList.remove("is-active"); return; }
      const changed = selectionWave.dataset.productKey !== selectedKey;
      selectionWave.dataset.productKey = selectedKey;
      selectionWave.style.left = `${source.centerX - leftWidth}px`; selectionWave.style.top = `${source.centerY - headerHeight()}px`;
      if (changed) { selectionWave.classList.remove("is-active"); void selectionWave.offsetWidth; }
      selectionWave.classList.add("is-active");
    }

    function updateSelectionGuide(entry, source) {
      const visible = Boolean(entry?.period && source && source.centerX >= leftWidth && source.centerX <= width && source.centerY >= headerHeight() && source.centerY <= height);
      selectionGuide.hidden = !visible;
      if (!visible) { selectionGuide.classList.remove("is-active"); selectionGuide.dataset.productKey = ""; return; }
      const changed = selectionGuide.dataset.productKey !== entry.key;
      const period = entry.period, label = ["day", "month"].includes(period.precision) ? monthText(monthIndex(period.start)) : period.label;
      if (guideMonth.textContent !== label) guideMonth.textContent = label;
      selectionGuide.dataset.productKey = entry.key;
      const x = source.centerX - leftWidth, labelWidth = guideMonth.offsetWidth;
      guideStroke.style.left = `${x}px`; guideStroke.style.height = `${Math.max(0, source.centerY - 52)}px`;
      guideMonth.style.left = `${clamp(x - labelWidth / 2, 3, Math.max(3, width - leftWidth - labelWidth - 3))}px`;
      if (changed) { selectionGuide.classList.remove("is-active"); void guideStroke.offsetHeight; }
      selectionGuide.classList.add("is-active");
    }

    function clearLaneHover() {
      lanePointer = null; hoveredCategoryId = null; laneHover.style.opacity = "0"; laneHover.dataset.categoryId = "";
    }

    function syncLaneHover(immediate = false) {
      if (!lanePointer || !layout || drag || pinned || ringState) { clearLaneHover(); return; }
      const lane = layout.lanes.find((item) => lanePointer.y >= item.y && lanePointer.y < item.y + item.height);
      if (!lane || lanePointer.x < 0 || lanePointer.x > width || lanePointer.y < headerHeight()) { clearLaneHover(); return; }
      const entering = !hoveredCategoryId;
      if (immediate || entering) {
        cancelAnimationFrame(laneHoverFrame); laneHover.classList.add("is-immediate");
        laneHoverFrame = requestAnimationFrame(() => { laneHoverFrame = 0; laneHover.classList.remove("is-immediate"); });
      }
      laneHover.style.transform = `translateY(${lane.y - headerHeight() + 1}px)`; laneHover.style.height = `${Math.max(0, lane.height - 2)}px`;
      if (immediate || entering) void laneHover.offsetHeight;
      laneHover.style.opacity = "1"; hoveredCategoryId = lane.categoryId; laneHover.dataset.categoryId = lane.categoryId;
    }

    function draw(neutral = false) {
      if (destroyed || !horizon) return;
      const ratio = dimensions();
      if (width <= 1 || height <= 1) return;
      layout = root.PortfolioHashoutLayout.layout(entries, horizon, { width, height, leftWidth, headerHeight: headerHeight(), maxLaneHeight: height, viewportStart: viewport.start, viewportEnd: viewport.end });
      const context = canvas.getContext("2d"); context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const colors = theme(); context.fillStyle = colors.page; context.fillRect(0, 0, width, height);
      const focused = focusKeys(neutral);
      drawCalendar(context);
      context.save(); context.beginPath(); context.rect(leftWidth, headerHeight(), Math.max(0, width - leftWidth), Math.max(0, height - headerHeight())); context.clip();
      for (const [index, lane] of layout.lanes.entries()) {
        if (index % 2 === 0) { context.fillStyle = alpha(colors.label, .026); context.fillRect(leftWidth, lane.y, width - leftWidth, lane.height); }
        context.strokeStyle = alpha(colors.label, .065); context.beginPath(); context.moveTo(leftWidth, lane.y + lane.height - .5); context.lineTo(width, lane.y + lane.height - .5); context.stroke();
      }
      drawLabels(context, focused, neutral);
      for (const lane of layout.lanes) {
        for (const glyph of lane.glyphs) {
          context.save(); if (focused && !glyph.memberKeys.some((key) => focused.has(key))) context.globalAlpha = .33;
          const activeGroup = !neutral && ringState && glyph.type === "group" && glyph.memberKeys.some((key) => ringState.entries.some((entry) => entry.key === key));
          drawGlyph(context, glyph, Boolean(activeGroup || glyph.type !== "group" && glyph.memberKeys.includes(selectedKey)), !neutral && sameGlyph(hovered, glyph)); context.restore();
        }
      }
      const group = layout.glyphs.find((glyph) => glyph.type === "group" && glyph.memberKeys.includes(selectedKey));
      const overlay = group && selectedOverlay(getEntry(selectedKey), group);
      if (overlay) drawGlyph(context, overlay, true, true);
      if (!neutral && hoverMemberKey && hoverMemberKey !== selectedKey) {
        const hoverGroup = layout.glyphs.find((glyph) => glyph.memberKeys.includes(hoverMemberKey));
        const hoverOverlay = hoverGroup && selectedOverlay(getEntry(hoverMemberKey), hoverGroup);
        if (hoverOverlay) drawGlyph(context, hoverOverlay, false, true);
      }
      context.restore();
      updateRail();
      const focusedCategories = focused ? new Set(entries.filter((entry) => focused.has(entry.key)).map((entry) => entry.categoryId)) : null;
      if (!neutral) for (const label of rail.children) label.classList.toggle("is-dimmed", Boolean(focusedCategories && !focusedCategories.has(label.dataset.categoryId)));
      canvas.dataset.glyphCount = String(layout.glyphs.length); canvas.dataset.productCount = String(entries.length); canvas.dataset.categoryCount = String(layout.lanes.length);
      canvas.dataset.viewportStart = String(viewport.start); canvas.dataset.viewportEnd = String(viewport.end);
      canvas.dataset.labelMode = labelMode; canvas.dataset.labelCount = String(labelLayout.labels.length);
      updateSelectionWave(); syncLaneHover();
      updateNavigator();
      empty.hidden = layout.lanes.length > 0;
      empty.textContent = allCategories.length ? "Choose categories to map your products." : "Add products to build your Hashout roadmap.";
      if (!card.hidden && cardAnchor) positionCard();
      if (!animationFrame && !drag) notifyViewport();
    }

    function requestRender() {
      if (destroyed || renderFrame) return;
      renderFrame = requestAnimationFrame(() => { renderFrame = 0; draw(); });
    }

    function point(event) { const rectangle = canvas.getBoundingClientRect(); return { x: event.clientX - rectangle.left, y: event.clientY - rectangle.top }; }
    function hit(position) {
      if (!layout || position.x < leftWidth || position.y < headerHeight()) return null;
      // Explicit On can overlap text at extreme density; the original marker
      // and group controls stay on top and retain their own hit targets.
      const direct = layout.glyphs.find((glyph) => {
        const x = glyph.type === "group" ? glyph.countLabelX ?? glyph.centerX : glyph.centerX;
        const radius = glyph.type === "group" ? glyph.badgeRadius ?? 9 : glyph.radius || 5;
        return glyph.type === "window" ? position.x >= glyph.x - 2 && position.x <= glyph.x + glyph.width + 2 && Math.abs(position.y - glyph.centerY) <= 7
          : Math.hypot(position.x - x, position.y - glyph.centerY) <= radius + 3;
      });
      if (direct) return direct;
      for (let index = labelLayout.labels.length - 1; index >= 0; index--) {
        const label = labelLayout.labels[index];
        const lane = layout.lanes.find((item) => item.categoryId === label.categoryId);
        if (lane && position.y >= lane.y && position.y < lane.y + lane.height && position.x >= label.x && position.x <= label.x + label.width && position.y >= label.y && position.y <= label.y + label.height) return { ...label.glyph, entries: [label.entry], memberKeys: [label.key], labelKey: label.key };
      }
      let nearest = null, best = Infinity;
      for (const glyph of layout.glyphs) {
        const shapeDistance = glyph.type === "point" ? Math.abs(position.x - glyph.centerX) : position.x < glyph.x ? glyph.x - position.x : position.x > glyph.x + glyph.width ? position.x - glyph.x - glyph.width : 0;
        const dx = glyph.type === "group" ? Math.min(shapeDistance, Math.abs(position.x - (glyph.countLabelX ?? glyph.centerX))) : shapeDistance;
        const dy = Math.abs(position.y - glyph.centerY), target = glyph.type === "group" ? 11 : Math.max(8, (glyph.radius || 5) + 4);
        const distance = dx * dx + dy * dy;
        if (dx <= target && dy <= target && distance < best) { nearest = glyph; best = distance; }
      }
      return nearest;
    }

    function positionCard() {
      if (!cardAnchor || card.hidden) return;
      if (card.classList.contains("is-capsule")) {
        positionCapsule(); return;
      }
      const w = card.offsetWidth; let h = card.offsetHeight;
      const right = cardAnchor.x + 14, left = cardAnchor.x - w - 14;
      let x = right + w <= width - 8 ? right : left >= 8 ? left : clamp(cardAnchor.x - w / 2, 8, Math.max(8, width - w - 8));
      let y = clamp(cardAnchor.y - Math.min(24, h / 2), 8, Math.max(8, height - h - 8));
      if (pinned && ringState?.geometry) {
        const geometry = ringState.geometry, slots = geometry.positions, half = geometry.targetSize / 2;
        const minX = Math.min(geometry.center.x - half, ringState.pagerX ?? geometry.center.x, ...slots.map((slot) => slot.x - half)), maxX = Math.max(geometry.center.x + half, (ringState.pagerX ?? geometry.center.x) + (ringState.pagerWidth || 158), ...slots.map((slot) => slot.x + half));
        const minY = Math.min(geometry.center.y - half, ringState.pagerY ?? geometry.center.y, ...slots.map((slot) => slot.y - half)), maxY = Math.max(geometry.center.y + half, (ringState.pagerY ?? geometry.center.y) + 28, ...slots.map((slot) => slot.y + half));
        if (maxX + 12 + w <= width - 8) x = maxX + 12;
        else if (minX - 12 - w >= leftWidth + 6) x = minX - 12 - w;
        else {
          const above = Math.max(0, minY - 58), below = Math.max(0, height - maxY - 20), useAbove = above >= below;
          card.style.maxHeight = `${Math.max(32, useAbove ? above : below)}px`; h = card.offsetHeight;
          x = clamp(cardAnchor.x - w / 2, 8, Math.max(8, width - w - 8)); y = useAbove ? minY - 12 - h : maxY + 12;
        }
      } else if (!pinned && x <= cardAnchor.x + 12 && x + w >= cardAnchor.x - 12) {
        const above = Math.max(0, cardAnchor.y - 22), below = Math.max(0, height - cardAnchor.y - 22), useAbove = above >= below;
        card.style.maxHeight = `${Math.max(20, useAbove ? above : below)}px`; h = card.offsetHeight;
        y = useAbove ? cardAnchor.y - 14 - h : cardAnchor.y + 14;
      } else card.style.maxHeight = `${Math.max(80, height - 16)}px`;
      card.style.left = `${x}px`; card.style.top = `${clamp(y, 8, Math.max(8, height - h - 8))}px`;
    }

    function positionCapsule() {
      const entry = cardEntries[0], label = pinned && labelLayout.labels.find((item) => item.key === entry?.key);
      const heading = card.querySelector(".hashout-capsule-heading"), disclosure = card.querySelector(".hashout-capsule-disclosure"), clip = card.querySelector(".hashout-capsule-clip");
      if (!heading || !disclosure || !clip) return;
      const bounds = { left: leftWidth + 6, right: width - 6, top: headerHeight() + 6, bottom: height - 6 };
      const availableWidth = Math.max(1, bounds.right - bounds.left), desiredWidth = pinned ? 306 : 270;
      const glyph = layout?.glyphs.find((item) => item.memberKeys.includes(entry?.key));
      const mappedSource = glyph?.type === "group" ? selectedOverlay(entry, glyph) : glyph;
      const orbitSlot = ringState?.geometry?.positions.find((slot) => ringState.entries[slot.index]?.key === entry?.key);
      // A resize can hide Default labels and move every month coordinate. Read
      // the current source geometry; cardAnchor is only a fallback for an
      // unplotted list entry. An open orbit retains its current member anchor.
      const source = label ? { x: label.anchorX, y: label.anchorY } : orbitSlot || (mappedSource ? { x: mappedSource.centerX, y: mappedSource.centerY } : cardAnchor);
      let w = Math.min(desiredWidth, availableWidth);
      let x = clamp((label?.x ?? source.x - w / 2), bounds.left, Math.max(bounds.left, bounds.right - w));
      // Retain a side label's edge nearest its marker. Wider details expand
      // away from that marker, and the original FFS donut remains unobscured.
      if (label && label.anchorY >= label.y && label.anchorY <= label.y + label.height) {
        const sideRoom = label.anchorX < label.x ? bounds.right - label.x : label.x + label.width - bounds.left;
        if (sideRoom >= Math.min(174, availableWidth)) {
          w = Math.min(w, sideRoom);
          x = label.anchorX < label.x ? label.x : label.x + label.width - w;
        }
      }
      card.style.width = `${w}px`; card.style.maxWidth = `${availableWidth}px`;
      const nameEl = heading.querySelector(".hashout-capsule-name"), dateEl = heading.querySelector(".hashout-capsule-date");
      card.classList.toggle("has-truncated-name", Boolean(nameEl && nameEl.scrollWidth > nameEl.clientWidth + 1));
      card.classList.toggle("has-truncated-date", Boolean(dateEl && dateEl.scrollWidth > dateEl.clientWidth + 1));
      const headingHeight = heading.offsetHeight || 32;
      card.style.setProperty("--hashout-capsule-heading-height", `${headingHeight}px`);
      // Measure natural body content, independently of its current animated
      // grid height, so hover redraws cannot change expansion direction.
      const naturalExtra = disclosure.querySelector(".hashout-capsule-content")?.scrollHeight || 0;
      const extraHeight = capsuleExpanded ? naturalExtra : 0;
      let above = Boolean(label && source.y > label.y + label.height);
      let y = label ? label.y + (above ? label.height - headingHeight : source.y >= label.y && source.y <= label.y + label.height ? (label.height - headingHeight) / 2 : 0) : source.y + 15;
      const sideLabel = label && source.y >= label.y && source.y <= label.y + label.height && (source.x < x - 6 || source.x > x + w + 6);
      const coversSource = !sideLabel && source.y >= y - 12 && source.y <= y + headingHeight + 12;
      if (!label || coversSource) {
        let aboveAnchor = source.y - 15 - headingHeight, belowAnchor = source.y + 15;
        if (ringState?.geometry) {
          const geometry = ringState.geometry, half = geometry.targetSize / 2;
          const minY = Math.min(geometry.center.y - half, ...geometry.positions.map((slot) => slot.y - half), ringState.pagerY ?? Infinity);
          const maxY = Math.max(geometry.center.y + half, ...geometry.positions.map((slot) => slot.y + half), (ringState.pagerY ?? -Infinity) + 28);
          aboveAnchor = minY - 12 - headingHeight; belowAnchor = maxY + 12;
        }
        const belowRoom = bounds.bottom - belowAnchor - headingHeight, aboveRoom = aboveAnchor - bounds.top;
        above = belowRoom < extraHeight && aboveRoom > belowRoom;
        y = above ? aboveAnchor : belowAnchor;
      } else if (sideLabel) {
        above = bounds.bottom - y - headingHeight < extraHeight && y - bounds.top > bounds.bottom - y - headingHeight;
      } else {
        // Vertical labels expand away from their source. At a plot boundary,
        // move the complete capsule to the opposite side rather than cover it.
        const room = above ? y - bounds.top : bounds.bottom - y - headingHeight;
        if (room < Math.min(extraHeight, 42)) {
          const oppositeY = above ? source.y + 15 : source.y - 15 - headingHeight;
          const oppositeRoom = above ? bounds.bottom - oppositeY - headingHeight : oppositeY - bounds.top;
          if (oppositeRoom > room) { above = !above; y = oppositeY; }
        }
      }
      y = clamp(y, bounds.top, Math.max(bounds.top, bounds.bottom - headingHeight));
      const maxExtra = Math.max(0, above ? y - bounds.top : bounds.bottom - y - headingHeight);
      clip.style.maxHeight = `${maxExtra}px`;
      card.classList.toggle("is-inline", Boolean(label)); card.classList.toggle("opens-up", above);
      card.style.left = `${x}px`; card.style.top = `${y}px`;
      // Tail placement is derived from the unchanged source point, never from
      // the expanded surface's center. Side tails track the stable header row.
      const horizontal = source.x < x && source.y >= y - 4 && source.y <= y + headingHeight + 4 ? "left"
        : source.x > x + w && source.y >= y - 4 && source.y <= y + headingHeight + 4 ? "right" : null;
      const plotted = entry?.period && mappedSource;
      const sourceVisible = plotted && source.x >= leftWidth && source.x <= width && source.y >= headerHeight() && source.y <= height;
      card.dataset.tail = sourceVisible ? horizontal || (source.y < y ? "top" : "bottom") : "none";
      card.style.setProperty("--hashout-tail-x", `${clamp(source.x - x, 12, Math.max(12, w - 12))}px`);
      card.style.setProperty("--hashout-tail-y", `${clamp(source.y - y, 8, headingHeight - 8)}px`);
    }

    function closeCard(returnFocus = false) {
      clearTimeout(hideTimer); card.hidden = true; card.replaceChildren(); cardEntries = []; cardAnchor = null; capsuleExpanded = false; pinned = false; hovered = null; hoverMemberKey = null; canvas.title = "";
      requestRender();
      if (returnFocus) canvas.focus({ preventScroll: true });
    }

    function entryActions(entry) {
      const actions = node("div", "hashout-card-actions");
      const action = (label, kind, handler) => {
        const button = node("button", `hashout-action-${kind}`); button.type = "button";
        const icon = node("span", `hashout-action-circle is-${kind === "details" ? "filled" : "hollow"}`); icon.setAttribute("aria-hidden", "true");
        button.append(icon, node("span", "", label)); button.setAttribute("aria-label", `${label === "Details" ? "Product details" : "Lifecycle roadmap"} for ${entry.product?.name || "this product"}`);
        listen(button, "click", handler); return button;
      };
      actions.append(action("Details", "details", () => selectEntry(entry, { openDetails: true, preserveGroup: true })));
      if (options.onOpenLifecycle) actions.append(action("Lifecycle", "lifecycle", () => options.onOpenLifecycle(entry)));
      return actions;
    }

    function updateMemberFocus(entry) {
      const list = card.querySelector(".hashout-card-list");
      if (!list) return;
      const scroll = list.scrollTop;
      card.querySelector(".hashout-member-focus")?.remove();
      const focus = node("div", "hashout-member-focus");
      focus.append(node("strong", "", entry.product?.name || "Unnamed product"), node("p", "hashout-card-time", entry.period ? `FFS ${entry.period.label}` : "FFS TBD")); appendWindowDetail(focus, entry); focus.append(entryActions(entry));
      card.insertBefore(focus, list);
      card.style.setProperty("--hashout-member-list-height", `${Math.max(60, height - 240)}px`);
      list.scrollTop = scroll;
      positionCard();
    }

    function updateBack() {
      back.hidden = !previousViewport;
      back.textContent = previousViewport && Math.abs(previousViewport.end - previousViewport.start - horizon.count) < .001 ? "Back to overview" : "Back to previous view";
    }

    function datePosition(value, after = false) {
      const [year, month, day] = value.split("-").map(Number), days = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return year * 12 + month - 1 + (day - (after ? 0 : 1)) / days;
    }

    function zoomEntries(items) {
      const timed = items.filter((entry) => entry.period);
      if (!timed.length) return;
      const start = Math.min(...timed.map((entry) => datePosition(entry.period.start))), end = Math.max(...timed.map((entry) => datePosition(entry.period.end, true)));
      if (end <= horizon.start || start >= horizon.end + 1) return;
      previousViewport = { ...viewport }; updateBack();
      const padding = Math.max(.75, (end - start) * .15);
      const span = clamp(end - start + padding * 2, Math.min(Math.max(3, horizon.count / 20), horizon.count), horizon.count), center = (start + end) / 2;
      closeRing(); closeCard();
      setViewport({ start: center - span / 2, end: center + span / 2 }, true);
    }

    function closeRing(returnFocus = false, immediate = false) {
      if (immediate) {
        cancelRingReveal(); clearTimeout(ringCloseTimer); ringState = null; hoverMemberKey = null; hovered = null;
        ring.hidden = true; ring.replaceChildren(); ring.classList.remove("is-open", "is-closing"); requestRender();
        if (returnFocus) canvas.focus({ preventScroll: true });
        return;
      }
      if (!ringState && ring.hidden) return;
      if (!ringState && ring.classList.contains("is-closing")) { if (returnFocus) canvas.focus({ preventScroll: true }); return; }
      const duration = ringState?.animationDuration || RING_MOTION_MS;
      cancelRingReveal();
      ringState = null; hoverMemberKey = null; hovered = null; ring.classList.remove("is-open"); ring.classList.add("is-closing");
      clearTimeout(ringCloseTimer);
      const hide = () => { ring.hidden = true; ring.replaceChildren(); ring.classList.remove("is-closing"); };
      if (root.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) hide(); else ringCloseTimer = setTimeout(hide, duration + 24);
      requestRender();
      if (returnFocus) canvas.focus({ preventScroll: true });
    }

    function cancelRingReveal() {
      revealGeneration++;
      revealTimers.forEach(clearTimeout); revealTimers = [];
      revealFrames.forEach(cancelAnimationFrame); revealFrames = [];
    }

    function revealRing(state, focusIndex) {
      const generation = revealGeneration, buttons = [...ring.querySelectorAll(".hashout-orbit-product")];
      const reduced = Boolean(root.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
      const enable = (button, index) => {
        if (generation !== revealGeneration || ringState !== state || !ring.contains(button)) return;
        button.disabled = false; button.classList.add("is-ready"); button.tabIndex = index === (focusIndex ?? 0) ? 0 : -1;
        if (focusIndex === index && (reduced || document.activeElement === ring)) button.focus({ preventScroll: true });
      };
      state.animationDuration = reduced ? 0 : Math.max(0, buttons.length - 1) * RING_STAGGER_MS + RING_MOTION_MS;
      if (reduced) { ring.classList.add("is-open"); buttons.forEach(enable); return; }
      if (focusIndex !== null) ring.focus({ preventScroll: true });
      // Two paint opportunities keep every page at the real origin before the individual reveal starts.
      revealFrames.push(requestAnimationFrame(() => {
        revealFrames.push(requestAnimationFrame(() => {
          if (generation !== revealGeneration || ringState !== state) return;
          ring.classList.add("is-open");
          buttons.forEach((button, index) => revealTimers.push(setTimeout(() => enable(button, index), index * RING_STAGGER_MS + RING_MOTION_MS)));
        }));
      }));
    }

    function ringDetail(entry) {
      if (!ringState || !entry) return;
      ringState.activeKey = entry.key;
      const detail = ring.querySelector(".hashout-ring-detail"); if (!detail) return;
      detail.style.width = "max-content"; detail.style.maxWidth = `${Math.min(260, Math.max(40, width - leftWidth - 12))}px`;
      detail.replaceChildren(); detail.append(node("strong", "", entry.product?.name || "Unnamed product"), node("p", "hashout-card-time", entry.period ? `FFS ${entry.period.label}` : "FFS TBD")); detail.hidden = false;
      const geometry = ringState.geometry, rectangle = detail.getBoundingClientRect(), w = rectangle.width, h = rectangle.height, half = geometry.targetSize / 2;
      const slots = geometry.positions, minY = Math.min(geometry.center.y - half, ...slots.map((slot) => slot.y - half)), maxY = Math.max(geometry.center.y + half, ...slots.map((slot) => slot.y + half));
      const slot = slots.find((item) => ringState.entries[item.index]?.key === entry.key) || geometry.center;
      const x = clamp(slot.x - w / 2, leftWidth + 6, Math.max(leftWidth + 6, width - w - 6));
      let y = maxY + 12 + (ringState.pagerY >= maxY ? 32 : 0);
      if (y + h > height - 6) y = minY - h - 12 - (ringState.pagerY < minY ? 32 : 0);
      detail.style.left = `${x}px`; detail.style.top = `${clamp(y, 4, Math.max(4, height - h - 4))}px`;
    }

    function ringSelect(entry) {
      if (!ringState) return;
      selectedKey = entry.key; ringState.selectedKey = entry.key; hoverMemberKey = entry.key;
      options.onSelect?.(entry, { openDetails: false });
      for (const button of ring.querySelectorAll(".hashout-orbit-product")) { const selected = button.dataset.productKey === entry.key; button.classList.toggle("is-selected", selected); button.setAttribute("aria-pressed", String(selected)); }
      ringDetail(entry); ring.querySelector(".hashout-ring-detail").hidden = true;
      const slot = ringState.geometry.positions.find((item) => ringState.entries[item.index]?.key === entry.key) || ringState.geometry.center;
      if (labelLayout.labels.some((label) => label.key === entry.key)) closeRing();
      showEntries([entry], { x: slot.x, y: slot.y }, true);
      live.textContent = `${entry.product?.name}, FFS ${entry.period?.label || "TBD"}`; requestRender();
    }

    function renderRingPage(focusIndex = null) {
      if (!ringState) return;
      cancelRingReveal(); ring.classList.remove("is-open");
      const state = ringState;
      const targetSize = coarseInput ? 44 : 28;
      const geometry = root.PortfolioHashoutLayout.radialLayout(state.entries.length, { anchor: state.anchor, width, height, leftWidth, headerHeight: headerHeight(), page: state.page, maxVisible: coarseInput ? 8 : 12, targetSize, gap: coarseInput ? 4 : 6 });
      state.geometry = geometry; state.page = geometry.page; state.pageSize = geometry.capacity; state.radius = geometry.radius;
      ring.replaceChildren();
      if (!geometry.fit) { closeRing(); showEntries(state.entries, state.anchor, true); return; }
      ring.style.setProperty("--ring-target", `${targetSize}px`); ring.style.setProperty("--ring-dot", coarseInput ? "17px" : "14px"); ring.style.setProperty("--ring-core-inset", coarseInput ? "8px" : "4px"); ring.style.setProperty("--ring-count-size", coarseInput ? "12px" : "10px");
      const orbit = node("div", "hashout-ring-orbit");
      const half = targetSize / 2;
      const center = node("button", "hashout-ring-center", String(state.entries.length)); center.type = "button"; center.setAttribute("aria-label", `Collapse ${state.entries.length} expanded products`); center.style.left = `${state.anchor.x - half}px`; center.style.top = `${state.anchor.y - half}px`; center.hidden = !geometry.showCenterControl; listen(center, "click", () => { closeRing(true); closeCard(); }); orbit.append(center);
      for (const [index, slot] of geometry.positions.entries()) {
        const entry = state.entries[slot.index], count = geometry.positions.length;
        const button = node("button", "hashout-orbit-product"); button.type = "button"; button.dataset.productKey = entry.key;
        const windowTone = productWindowTone(entry); if (windowTone) button.style.setProperty("--hashout-product-tone", windowTone);
        button.style.left = `${state.anchor.x - half}px`; button.style.top = `${state.anchor.y - half}px`; button.style.setProperty("--ring-x", `${slot.x - state.anchor.x}px`); button.style.setProperty("--ring-y", `${slot.y - state.anchor.y}px`); button.style.setProperty("--ring-delay", `${index * RING_STAGGER_MS}ms`);
        button.setAttribute("aria-label", `${entry.product?.name || "Unnamed product"}, FFS ${entry.period?.label || "TBD"}`); button.setAttribute("aria-pressed", String(entry.key === state.selectedKey)); button.disabled = true; button.tabIndex = -1; button.classList.toggle("is-selected", entry.key === state.selectedKey);
        const focusEntry = () => { if (!ringState) return; hoverMemberKey = entry.key; ringDetail(entry); requestRender(); };
        listen(button, "pointerenter", focusEntry); listen(button, "focus", () => { for (const other of orbit.querySelectorAll(".hashout-orbit-product")) other.tabIndex = other === button ? 0 : -1; focusEntry(); });
        listen(button, "pointerleave", () => { if (document.activeElement !== button) { hoverMemberKey = ringState?.selectedKey || null; ring.querySelector(".hashout-ring-detail").hidden = true; requestRender(); } });
        listen(button, "click", () => ringSelect(entry));
        listen(button, "keydown", (event) => {
          if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
            const next = index + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1);
            if (next >= count && state.page + 1 < Math.ceil(state.entries.length / state.pageSize)) { state.page++; renderRingPage(0); }
            else if (next < 0 && state.page > 0) { state.page--; renderRingPage(Math.min(state.pageSize, state.entries.length - state.page * state.pageSize) - 1); }
            else orbit.querySelectorAll(".hashout-orbit-product")[((next % count) + count) % count]?.focus();
            event.preventDefault();
          }
        });
        orbit.append(button);
      }
      ring.append(orbit);
      const pager = node("div", "hashout-ring-pager");
      const previous = node("button", "", "‹"); previous.type = "button"; previous.setAttribute("aria-label", "Previous products in group"); previous.disabled = state.page === 0; listen(previous, "click", () => { state.page--; renderRingPage(0); });
      const next = node("button", "", "›"); next.type = "button"; next.setAttribute("aria-label", "Next products in group"); next.disabled = (state.page + 1) * state.pageSize >= state.entries.length; listen(next, "click", () => { state.page++; renderRingPage(0); });
      const pageLabel = node("span", "", `${state.page + 1}/${geometry.pageCount}`); pager.append(previous, pageLabel, next);
      const singlePage = geometry.pageCount === 1; previous.hidden = singlePage; next.hidden = singlePage; pageLabel.hidden = singlePage;
      const list = node("button", "hashout-ring-list", "≡"); list.type = "button"; list.setAttribute("aria-label", "List all products in group"); list.title = "List all products"; listen(list, "click", () => { const snapshot = ringState; closeRing(); showEntries(snapshot.entries, snapshot.anchor, true); }); pager.append(list);
      const zoom = node("button", "hashout-ring-zoom", "↗"); zoom.type = "button"; zoom.setAttribute("aria-label", "Zoom to these products"); zoom.title = "Zoom to these products"; listen(zoom, "click", () => zoomEntries(state.entries)); pager.append(zoom);
      const minY = Math.min(geometry.center.y - half, ...geometry.positions.map((slot) => slot.y - half)), maxY = Math.max(geometry.center.y + half, ...geometry.positions.map((slot) => slot.y + half));
      state.pagerY = maxY + 34 <= height - 4 ? maxY + 6 : Math.max(headerHeight() + 2, minY - 34);
      state.pagerWidth = singlePage ? 56 : 158;
      state.pagerX = clamp(geometry.center.x - state.pagerWidth / 2, leftWidth + 4, Math.max(leftWidth + 4, width - state.pagerWidth - 4));
      pager.style.width = `${state.pagerWidth}px`; pager.style.left = `${state.pagerX}px`; pager.style.top = `${state.pagerY}px`; ring.append(pager);
      const detail = node("div", "hashout-ring-detail"); detail.hidden = true; detail.setAttribute("role", "tooltip"); detail.setAttribute("aria-live", "polite"); ring.append(detail);
      ring.hidden = false; ring.classList.remove("is-closing");
      orbit.getBoundingClientRect();
      revealRing(state, focusIndex);
    }

    function openRing(glyph, keyboard = false) {
      closeCard(); clearTimeout(ringCloseTimer);
      clearLaneHover();
      ringState = { entries: glyph.entries, anchor: { x: glyph.countLabelX ?? glyph.centerX, y: glyph.centerY }, page: 0, pageSize: 0, radius: 0, width, height, selectedKey: glyph.memberKeys.includes(selectedKey) ? selectedKey : null, activeKey: null, geometry: null };
      ring.removeAttribute("style"); ring.classList.remove("is-open"); renderRingPage(keyboard ? 0 : null); requestRender();
    }

    function selectEntry(entry, { openDetails = false, preserveGroup = false } = {}) {
      selectedKey = entry.key; live.textContent = `${entry.product?.name || "Unnamed product"}, ${entry.period ? `FFS ${entry.period.label}` : "FFS timing TBD"}, ${STAGES[entry.stage] || STAGES.unknown}`;
      options.onSelect?.(entry, { openDetails });
      requestRender();
      if (!preserveGroup) showEntries([entry], cardAnchor || { x: leftWidth + (width - leftWidth) / 2, y: 80 }, true);
      else {
        pinned = true; card.classList.add("is-pinned"); card.setAttribute("role", "dialog");
        for (const button of card.querySelectorAll("[data-product-key]")) button.classList.toggle("is-selected", button.dataset.productKey === entry.key);
        updateMemberFocus(entry);
      }
    }

    function showEntries(items, anchor, pin = false, heading = "") {
      clearTimeout(hideTimer);
      if (!items?.length) return;
      pinned = pin; cardEntries = items; cardAnchor = anchor;
      // Place a reused card at its new anchor before content reflow, so it never covers a newly hovered circle for a frame.
      card.hidden = true;
      const anticipatedWidth = Math.min(272, Math.max(1, width - 16));
      const anticipatedRight = anchor.x + 14, anticipatedLeft = anchor.x - anticipatedWidth - 14;
      card.style.left = `${anticipatedRight + anticipatedWidth <= width - 8 ? anticipatedRight : anticipatedLeft >= 8 ? anticipatedLeft : clamp(anchor.x - anticipatedWidth / 2, 8, Math.max(8, width - anticipatedWidth - 8))}px`;
      card.style.maxHeight = `${Math.max(80, height - 16)}px`;
      card.style.setProperty("--hashout-member-list-height", `${Math.max(60, height - 120)}px`);
      card.replaceChildren();
      card.classList.toggle("is-pinned", pinned); card.setAttribute("role", pin ? "dialog" : "region");
      const inlineLabel = pin && items.length === 1 && !heading ? labelLayout.labels.find((label) => label.key === items[0].key) : null;
      const single = items.length === 1 && !heading;
      card.classList.toggle("is-capsule", single); card.classList.toggle("is-inline", Boolean(inlineLabel));
      card.classList.remove("opens-up", "is-collapsed", "is-entering", "has-truncated-name", "has-truncated-date");
      card.style.width = ""; card.style.minWidth = ""; card.style.maxWidth = ""; card.style.maxHeight = "";
      if (single) {
        buildCapsule(items[0], pin);
        card.hidden = false; positionCard(); requestRender(); return;
      }
      const close = node("button", "hashout-card-close", "×"); close.type = "button"; close.setAttribute("aria-label", "Close product card"); listen(close, "click", () => closeCard(true));
      const cardHeader = node("div", "hashout-card-header");
      cardHeader.append(node("strong", "", heading || `${items.length} products`));
      cardHeader.append(close);
      card.append(cardHeader);
      const list = node("div", "hashout-card-list"); list.setAttribute("role", "list");
      const shown = pin ? items : items.slice(0, 6);
      for (const entry of shown) {
        if (pin) { const button = productButton(entry, (item) => selectEntry(item, { preserveGroup: true })); button.classList.toggle("is-selected", entry.key === selectedKey); list.append(button); }
        else { const preview = node("div", "hashout-group-preview"); preview.append(node("strong", "", entry.product?.name || "Unnamed product"), node("span", "", entry.period ? `FFS ${entry.period.label}` : "FFS TBD")); list.append(preview); }
      }
      card.append(list);
      if (pin) { const selected = items.find((entry) => entry.key === selectedKey); if (selected) updateMemberFocus(selected); }
      if (!pin) { const more = node("button", "hashout-card-more", items.length > shown.length ? `+${items.length - shown.length} more · Expand all ${items.length}` : `Expand ${items.length} products`); more.type = "button"; listen(more, "click", () => openRing({ entries: items, memberKeys: items.map((entry) => entry.key), countLabelX: anchor.x, centerX: anchor.x, centerY: anchor.y })); card.append(more); }
      card.hidden = false;
      positionCard();
    }

    function buildCapsule(entry, expand) {
      const name = entry.product?.name || "Unnamed product", date = entry.period?.label || "TBD";
      capsuleExpanded = expand;
      card.classList.toggle("is-collapsed", !expand);
      card.setAttribute("aria-label", `${name}, FFS estimate ${date}. Working product name and planning timing.`);
      const heading = node("button", "hashout-capsule-heading"); heading.type = "button";
      const nameEl = node("span", "hashout-capsule-name", name), dateEl = node("span", "hashout-capsule-date", date);
      dateEl.setAttribute("aria-label", `FFS estimate ${date}`); heading.append(nameEl, dateEl);
      const disclosure = node("div", "hashout-capsule-disclosure"), clip = node("div", "hashout-capsule-clip"), content = node("div", "hashout-capsule-content");
      content.append(node("strong", "hashout-capsule-fullname", name), node("p", "hashout-capsule-fulltime", `FFS ${date}`));
      const row = node("div", "hashout-capsule-row"), status = node("span", "hashout-capsule-status", STAGES[entry.stage] || STAGES.unknown);
      row.append(status, entryActions(entry)); content.append(row);
      clip.append(content); disclosure.append(clip); card.append(heading, disclosure);
      const sync = () => {
        card.classList.toggle("is-collapsed", !capsuleExpanded);
        heading.setAttribute("aria-expanded", String(capsuleExpanded));
        heading.setAttribute("aria-label", `${name}, FFS estimate ${date}. ${capsuleExpanded ? "Collapse" : "Expand"} product details`);
        disclosure.inert = !capsuleExpanded; disclosure.setAttribute("aria-hidden", String(!capsuleExpanded));
      };
      sync();
      if (expand && !root.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
        card.classList.add("is-entering");
        requestAnimationFrame(() => { if (!destroyed && card.contains(heading)) card.classList.remove("is-entering"); });
      }
      listen(heading, "click", () => {
        if (!pinned) { selectEntry(entry); return; }
        capsuleExpanded = !capsuleExpanded; sync(); positionCard();
      });
    }

    function focusProduct(value) {
      closeRing();
      const key = typeof value === "string" ? value : entryKey(value);
      let entry = getEntry(key);
      if (!entry) {
        const all = root.PortfolioHashoutLayout.project(options.getPortfolio?.() || { categories: [] }, null);
        entry = all.find((item) => item.key === key || item.productId === value);
        if (!entry) return false;
        if (scope !== null && !scope.includes(entry.categoryId)) { chooseScope([...scope, entry.categoryId]); entry = getEntry(entry.key); }
      }
      if (!entry) return false;
      if (entry.period) {
        const first = monthIndex(entry.period.start), last = monthIndex(entry.period.end), center = (first + last + 1) / 2, span = viewport.end - viewport.start;
        if (last + 1 < viewport.start || first > viewport.end) setViewport({ start: center - span / 2, end: center + span / 2 }, false);
      }
      draw();
      const glyph = layout.glyphs.find((item) => item.memberKeys.includes(entry.key));
      const lane = layout.lanes.find((item) => item.categoryId === entry.categoryId);
      cardAnchor = glyph ? { x: entry.period && glyph.type === "group" ? selectedOverlay(entry, glyph)?.centerX ?? glyph.centerX : glyph.centerX, y: glyph.centerY } : { x: leftWidth + 8, y: lane ? lane.y + lane.height / 2 : 70 };
      selectEntry(entry);
      return true;
    }

    listen(search, "input", () => { searchSignature = ""; updateSearch(); });
    listen(search, "focus", () => { if (search.value.trim()) { results.hidden = false; search.setAttribute("aria-expanded", "true"); } });
    listen(search, "keydown", (event) => {
      if (event.key === "Escape") { results.hidden = true; search.setAttribute("aria-expanded", "false"); search.blur(); }
      if (event.key === "ArrowDown") { results.querySelector("button")?.focus(); event.preventDefault(); }
      if (event.key === "Enter") { results.querySelector("button")?.click(); event.preventDefault(); }
    });
    listen(results, "keydown", (event) => {
      const buttons = [...results.querySelectorAll("button")], index = buttons.indexOf(document.activeElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { buttons[clamp(index + (event.key === "ArrowDown" ? 1 : -1), 0, buttons.length - 1)]?.focus(); event.preventDefault(); }
      if (event.key === "Escape") { results.hidden = true; search.setAttribute("aria-expanded", "false"); search.focus(); }
    });
    listen(document, "pointerdown", (event) => {
      if (event.pointerType === "touch") coarseInput = true;
      else if (event.pointerType === "mouse" && !root.matchMedia?.("(pointer: coarse)")?.matches) coarseInput = false;
      if (!picker.contains(event.target)) picker.open = false;
      if (!windowsControl.contains(event.target)) windowsKey.open = false;
      if (!searchShell.contains(event.target)) { results.hidden = true; search.setAttribute("aria-expanded", "false"); }
      const insideCard = card.contains(event.target);
      if (ringState && !ring.contains(event.target) && !insideCard) { closeRing(); closeCard(); }
      // Dismiss the old disclosure without cancelling the click. A different
      // product, category, or toolbar control must still work on that click.
      if (pinned && !insideCard) closeCard();
    });
    listen(card, "pointerenter", () => clearTimeout(hideTimer));
    listen(card, "pointerleave", () => { if (!pinned) hideTimer = setTimeout(() => closeCard(), 160); });
    listen(card, "click", (event) => { if (!pinned && !event.target.closest("button")) { if (cardEntries.length > 1) openRing({ entries: cardEntries, memberKeys: cardEntries.map((entry) => entry.key), countLabelX: cardAnchor.x, centerX: cardAnchor.x, centerY: cardAnchor.y }); else showEntries(cardEntries, cardAnchor, true); } });
    listen(card, "keydown", (event) => { if (event.key === "Escape") { closeCard(true); closeRing(); event.preventDefault(); } });
    listen(document, "keydown", (event) => { if (event.key === "Escape" && pinned && !card.contains(event.target) && !ring.contains(event.target)) { closeCard(true); closeRing(); event.preventDefault(); } });
    listen(ring, "keydown", (event) => { if (event.key === "Escape") { closeRing(true); closeCard(); event.preventDefault(); } });
    listen(ring, "pointerenter", () => clearTimeout(hideTimer));
    listen(stage, "pointermove", (event) => {
      if (event.pointerType === "touch" || event.isPrimary === false || event.target.closest(".hashout-product-card, .hashout-ring-overlay")) { clearLaneHover(); return; }
      const bounds = stage.getBoundingClientRect(); lanePointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }; syncLaneHover();
    });
    listen(stage, "pointerleave", clearLaneHover); listen(stage, "pointerdown", clearLaneHover); listen(root, "blur", clearLaneHover);
    listen(canvas, "pointermove", (event) => {
      const position = point(event);
      if (drag) {
        const distance = event.clientX - drag.clientX;
        if (Math.abs(distance) > 3) { drag.moved = true; suppressClick = true; closeCard(); const span = drag.viewport.end - drag.viewport.start; viewport = boundViewport({ start: drag.viewport.start - distance / Math.max(1, width - leftWidth) * span, end: drag.viewport.end - distance / Math.max(1, width - leftWidth) * span }); requestRender(); }
        return;
      }
      if (pinned || ringState || event.pointerType === "touch") return;
      const previousMemberKey = hoverMemberKey, glyph = hit(position); canvas.style.cursor = glyph ? "pointer" : "grab"; hoverMemberKey = glyph?.labelKey || null;
      const inlineNamesVisible = glyph && (labelMode === "on" || glyph.entries.every((entry) => labelLayout.labels.some((label) => label.key === entry.key)));
      if (inlineNamesVisible) {
        const nextMemberKey = glyph.labelKey || (glyph.entries.length === 1 ? glyph.entries[0].key : null);
        const changed = !sameGlyph(glyph, hovered) || previousMemberKey !== nextMemberKey || !card.hidden;
        clearTimeout(hideTimer); if (!card.hidden) closeCard();
        hovered = glyph; hoverMemberKey = nextMemberKey;
        if (changed) requestRender(); return;
      }
      if (sameGlyph(glyph, hovered)) { hovered = glyph; clearTimeout(hideTimer); if (previousMemberKey !== hoverMemberKey) requestRender(); return; }
      hovered = glyph; requestRender();
      if (!glyph) { hideTimer = setTimeout(() => { if (!pinned) closeCard(); }, 160); return; }
      showEntries(glyph.entries, { x: glyph.type === "group" ? glyph.countLabelX ?? glyph.centerX : glyph.centerX, y: glyph.centerY });
    });
    listen(canvas, "pointerleave", (event) => { if (!pinned && !ringState && !drag && !card.contains(event.relatedTarget) && !ring.contains(event.relatedTarget)) hideTimer = setTimeout(() => closeCard(), 160); });
    listen(canvas, "pointerdown", (event) => { if (event.button !== 0 || !viewport) return; cancelAnimationFrame(animationFrame); animationFrame = 0; suppressClick = false; drag = { clientX: event.clientX, viewport: { ...viewport }, moved: false }; canvas.setPointerCapture?.(event.pointerId); canvas.style.cursor = "grabbing"; });
    const finishDrag = (event) => { if (!drag) return; drag = null; canvas.style.cursor = "grab"; canvas.releasePointerCapture?.(event.pointerId); notifyViewport(); };
    listen(canvas, "pointerup", finishDrag); listen(canvas, "pointercancel", finishDrag);
    listen(canvas, "click", (event) => {
      if (suppressClick) { suppressClick = false; return; }
      const glyph = hit(point(event));
      if (!glyph) { closeCard(); return; }
      hovered = glyph;
      const anchor = { x: glyph.type === "group" ? glyph.countLabelX ?? glyph.centerX : glyph.centerX, y: glyph.centerY };
      if (glyph.entries.length === 1) { cardAnchor = anchor; selectEntry(glyph.entries[0]); }
      else openRing(glyph);
      requestRender();
    });
    listen(canvas, "dblclick", (event) => { const glyph = hit(point(event)); if (glyph?.entries.length === 1) selectEntry(glyph.entries[0], { openDetails: true }); });
    listen(canvas, "wheel", (event) => {
      if (!viewport || event.ctrlKey) return;
      event.preventDefault();
      // Navigation must remove the old screen-space orbit before the calendar itself moves.
      closeRing(false, true); closeCard();
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) { const delta = (event.deltaX || event.deltaY) / Math.max(1, width - leftWidth) * (viewport.end - viewport.start); setViewport({ start: viewport.start + delta, end: viewport.end + delta }, false); }
      else { const position = point(event); zoomScale(Math.exp(-clamp(event.deltaY, -80, 80) * .004), clamp((position.x - leftWidth) / Math.max(1, width - leftWidth), 0, 1), false); }
    }, { passive: false });
    listen(canvas, "keydown", (event) => {
      if (event.key === "Escape") { closeCard(); closeRing(); return; }
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        const candidates = layout?.glyphs || []; if (!candidates.length) return;
        keyboardIndex = clamp(keyboardIndex + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1), 0, candidates.length - 1);
        const glyph = candidates[keyboardIndex]; hovered = glyph; showEntries(glyph.entries, { x: glyph.countLabelX ?? glyph.centerX, y: glyph.centerY }, true); live.textContent = glyph.entries.length === 1 ? `${glyph.entries[0].product?.name}, FFS ${glyph.entries[0].period?.label || "TBD"}` : `${glyph.entries.length} products in ${glyph.entries[0].categoryName}`; requestRender(); event.preventDefault();
      }
      if (event.key === "Enter" || event.key === " ") { if (hovered?.type === "group") openRing(hovered, true); else if (!card.hidden) card.querySelector("button.hashout-product-result, .hashout-card-actions button, button")?.focus(); event.preventDefault(); }
      if (event.key === "+" || event.key === "=") { zoomBy(1); event.preventDefault(); }
      if (event.key === "-") { zoomBy(-1); event.preventDefault(); }
      if (event.key === "Home") { fit(); event.preventDefault(); }
    });

    listen(back, "click", () => { if (!previousViewport) return; const previous = previousViewport; previousViewport = null; updateBack(); closeCard(); closeRing(); setViewport(previous, true); });
    function fit() { if (!horizon) refreshData(); previousViewport = null; updateBack(); closeCard(); closeRing(); setViewport({ start: horizon.start, end: horizon.end + 1 }, true); }
    function zoomScale(factor, anchor = .5, animate = true) { if (!viewport || !Number.isFinite(Number(factor)) || Number(factor) <= 0) return; const span = viewport.end - viewport.start, nextSpan = clamp(span / Number(factor), Math.min(Math.max(3, horizon.count / 20), horizon.count), horizon.count), date = viewport.start + span * anchor; closeCard(); setViewport({ start: date - nextSpan * anchor, end: date + nextSpan * (1 - anchor) }, animate); }
    function zoomBy(direction) { closeRing(); zoomScale(Number(direction) > 0 ? 1.3 : 1 / 1.3); }
    function today() { if (!viewport) return; const now = new Date(), center = now.getFullYear() * 12 + now.getMonth() + .5, span = viewport.end - viewport.start; closeCard(); closeRing(); setViewport({ start: center - span / 2, end: center + span / 2 }, true); }
    function render(config = {}) { if (destroyed) return; if (Object.hasOwn(config, "selectedKey")) selectedKey = config.selectedKey; const nextScope = options.getScope?.(); if (nextScope !== undefined) scope = nextScope === null ? null : [...nextScope]; if (options.getLabelMode) { labelMode = normalizeLabelMode(options.getLabelMode()); syncLabelControl(); } if (options.getWindows) { windowsVisible = options.getWindows() !== false; syncWindowsControl(); } refreshData(); requestRender(); }
    async function exportPng() {
      draw(true);
      const image = document.createElement("canvas"); image.width = canvas.width; image.height = canvas.height;
      const context = image.getContext("2d"), ratio = canvas.width / width; context.drawImage(canvas, 0, 0); context.scale(ratio, ratio);
      context.fillStyle = theme().surface; context.fillRect(0, headerHeight(), leftWidth, height - headerHeight());
      for (const lane of layout.lanes) {
        context.save(); context.beginPath(); context.rect(8, lane.y, leftWidth - 16, lane.height); context.clip(); context.fillStyle = theme().text; context.font = `500 11px ${font()}`; context.textAlign = "left"; context.textBaseline = "middle";
        let label = lane.name; while (label.length > 1 && context.measureText(label).width > leftWidth - 35) label = label.slice(0, -2) + "…";
        context.fillText(label, 13, lane.y + lane.height / 2); context.fillStyle = theme().label; context.font = `10px ${font()}`; context.textAlign = "right"; context.fillText(String(lane.count), leftWidth - 9, lane.y + lane.height / 2); context.restore();
      }
      draw();
      return new Promise((resolve, reject) => image.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not create the Hashout image.")), "image/png"));
    }
    const resize = new ResizeObserver(() => { if (!destroyed) requestRender(); }); resize.observe(stage);
    const refreshFontMeasurements = () => { if (!destroyed) { labelSignature = ""; requestRender(); } };
    if (document.fonts?.ready) void document.fonts.ready.then(refreshFontMeasurements);
    if (document.fonts?.addEventListener) listen(document.fonts, "loadingdone", refreshFontMeasurements);
    refreshData(); requestRender();
    return Object.freeze({
      render, fit, zoomBy, today, focusProduct, exportPng,
      closeOverlay() { closeCard(); closeRing(); clearLaneHover(); },
      getViewport() { return viewport ? { ...viewport, zoom: horizon.count / (viewport.end - viewport.start) } : null; },
      setSearch(value) { search.value = String(value || ""); searchSignature = ""; updateSearch(); },
      getState() {
        const focused = focusKeys();
        return { scope: scope === null ? null : [...scope], selectedKey, viewport: viewport ? { ...viewport } : null, zoom: horizon && viewport ? horizon.count / (viewport.end - viewport.start) : 1,
          counts: layout?.counts || {}, entries, layout, labelMode, labelLayout, windowsVisible, seasonalWindows, seasonalBands, windowMatches: Object.fromEntries(entries.map((entry) => [entry.key, targetMatches(entry.period)])), hoveredCategoryId, sourcePulseKey: selectionWave.hidden ? null : selectionWave.dataset.productKey, sourceGuideKey: selectionGuide.hidden ? null : selectionGuide.dataset.productKey, focusKeys: focused ? [...focused] : null, previousViewport: previousViewport ? { ...previousViewport } : null,
          ring: ringState ? { ...ringState.geometry, open: true, page: ringState.page, pageSize: ringState.pageSize, radius: ringState.radius, activeKey: ringState.activeKey, selectedKey: ringState.selectedKey, animationDuration: ringState.animationDuration, staggerMs: RING_STAGGER_MS, motionMs: RING_MOTION_MS, memberKeys: ringState.entries.map((entry) => entry.key) } : { open: false } };
      },
      destroy() { destroyed = true; clearTimeout(hideTimer); clearTimeout(ringCloseTimer); cancelRingReveal(); cancelAnimationFrame(renderFrame); cancelAnimationFrame(animationFrame); cancelAnimationFrame(laneHoverFrame); resize.disconnect(); overview?.destroy(); abort.abort(); shell.remove(); },
    });
  }

  root.PortfolioHashoutView = Object.freeze({ create });
})(globalThis);
