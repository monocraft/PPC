/* Animated category contribution. Values are shares of positive category totals. */
(function (root) {
  "use strict";
  const NS = "http://www.w3.org/2000/svg", TAU = Math.PI * 2, OTHER = Symbol("other-categories"), states = new WeakMap();
  const full = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 21 });
  const short = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
  const esc = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const ease = value => 1 - Math.pow(1 - Math.min(1, Math.max(0, value)), 3);
  const now = () => root.performance?.now?.() ?? Date.now();
  const request = callback => root.requestAnimationFrame ? root.requestAnimationFrame(callback) : root.setTimeout(() => callback(now()), 16);
  const cancel = handle => root.cancelAnimationFrame ? root.cancelAnimationFrame(handle) : root.clearTimeout(handle);
  const shorten = (value, limit = 24) => value.length > limit ? value.slice(0, limit - 1) + "…" : value;
  const shareLabel = (share, spoken = false) => share >= 0 && share < .001 ? spoken ? "less than 0.1 percent" : "<0.1%" : spoken ? `${(share * 100).toFixed(1)} percent` : `${(share * 100).toFixed(1)}%`;
  function theme() {
    const c = root.PortfolioTheme?.colors || {};
    const grayscale = [c.text || "#D5D7DC", c.label || "#BBBCC0", c.controlBorder || "#83858B", c.borderStrong || "#676A70", c.input || "#4D5054", c.header || "#333538"];
    const series = root.PortfolioTheme?.chartSeries;
    const palette = Array.isArray(series) && series.length && series.every(value => typeof value === "string") ? series : grayscale;
    return { palette, text: c.text || "#D5D7DC", muted: c.label || "#BBBCC0", surface: c.surface || "#242527", outline: c.controlBorder || "#83858B" };
  }
  function colorIndex(key, count) {
    let hash = 2166136261;
    for (const char of String(key)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    return hash % count;
  }
  function color(key) { const palette = theme().palette; return palette[colorIndex(key, palette.length)]; }
  function displayColors(state, entries) {
    const palette = state.options.palette || theme().palette, count = palette.length, assignments = new Map(), previous = state.colors || new Map(), visible = state.visibleKeys || new Set();
    const preferred = key => previous.has(key) ? previous.get(key) % count : colorIndex(key, count);
    if (entries.length <= count) {
      const used = new Set();
      if (entries.some(entry => entry.other)) { assignments.set(OTHER, count - 1); used.add(count - 1); }
      const regular = entries.filter(entry => !entry.other).sort((a, b) => a.key.localeCompare(b.key));
      // Retain existing visible colors first; returning/new keys take vacancies.
      for (const entry of regular.filter(entry => visible.has(entry.key) && previous.has(entry.key))) {
        const index = preferred(entry.key); if (!used.has(index)) { assignments.set(entry.key, index); used.add(index); }
      }
      for (const entry of regular) {
        if (assignments.has(entry.key)) continue;
        const start = preferred(entry.key);
        for (let offset = 0; offset < count; offset++) { const index = (start + offset) % count; if (!used.has(index)) { assignments.set(entry.key, index); used.add(index); break; } }
      }
    } else {
      // Expanded palettes may repeat. New entries avoid both adjacent retained
      // colors and the first slice at the closing seam whenever possible.
      for (let position = 0; position < entries.length; position++) {
        const entry = entries[position], start = preferred(entry.key);
        if (visible.has(entry.key) && previous.has(entry.key)) { assignments.set(entry.key, start); continue; }
        const before = position ? assignments.get(entries[position - 1].key) : undefined;
        const following = entries[position + 1], after = position === entries.length - 1 ? assignments.get(entries[0].key) : following && visible.has(following.key) && previous.has(following.key) ? preferred(following.key) : undefined;
        let selected = start;
        for (let offset = 0; offset < count; offset++) { const index = (start + offset) % count; if (index !== before && index !== after) { selected = index; break; } }
        assignments.set(entry.key, selected);
      }
    }
    for (const [key, index] of assignments) previous.set(key, index);
    state.colors = previous; state.visibleKeys = new Set(entries.map(entry => entry.key));
    return new Map([...assignments].map(([key, index]) => [key, palette[index]]));
  }
  function normalized(categories) {
    const groups = new Map();
    for (const category of Array.isArray(categories) ? categories : []) {
      if (!category || typeof category.key !== "string" || !category.key.trim() || category.key.length > 255 || typeof category.current !== "number" || !Number.isFinite(category.current)) continue;
      const previous = groups.get(category.key);
      if (previous) previous.current += category.current;
      else groups.set(category.key, { key: category.key, name: typeof category.name === "string" && category.name.trim() ? category.name.slice(0, 500) : category.key, current: category.current });
    }
    return [...groups.values()].filter(category => category.current > 0 && Number.isFinite(category.current)).sort((a, b) => b.current - a.current || a.key.localeCompare(b.key));
  }
  function layout(categories, expanded = false) {
    const positive = normalized(categories), total = positive.reduce((sum, category) => sum + category.current, 0);
    if (!Number.isFinite(total) || total <= 0) return { entries: [], positive: [], total: 0 };
    const visible = expanded ? [...positive] : positive.slice(0, 5);
    if (!expanded && positive.length > 5) visible.push({ key: OTHER, name: "Other", current: positive.slice(5).reduce((sum, category) => sum + category.current, 0), other: true });
    let angle = -Math.PI / 2;
    const entries = visible.map(category => { const start = angle; angle += category.current / total * TAU; return { ...category, start, end: angle, share: category.current / total }; });
    return { entries, positive, total: Number.isFinite(total) ? total : 0 };
  }
  function arc(start, end, { cx = 120, cy = 120, outer = 96, inner = 68, gap = .02 } = {}) {
    const length = Math.max(0, Math.min(TAU, end - start));
    if (length < .00001) return "";
    const point = (radius, angle) => `${(cx + Math.cos(angle) * radius).toFixed(4)},${(cy + Math.sin(angle) * radius).toFixed(4)}`;
    if (length > TAU - .00001) {
      const half = start + Math.PI;
      return `M${point(outer, start)}A${outer},${outer},0,1,1,${point(outer, half)}A${outer},${outer},0,1,1,${point(outer, start)}L${point(inner, start)}A${inner},${inner},0,1,0,${point(inner, half)}A${inner},${inner},0,1,0,${point(inner, start)}Z`;
    }
    const inset = Math.min(gap, length * .15), aa = start + inset, bb = end - inset, large = bb - aa > Math.PI ? 1 : 0;
    return `M${point(outer, aa)}A${outer},${outer},0,${large},1,${point(outer, bb)}L${point(inner, bb)}A${inner},${inner},0,${large},0,${point(inner, aa)}Z`;
  }
  function svgElement(doc, name, attrs = {}) { const node = doc.createElementNS(NS, name); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value)); return node; }
  function activeEntry(state) { const key = state.hover ?? (state.focusVisible ? state.focus : null); const entry = state.entries.get(key); return entry && entry.present ? entry : null; }
  function updateCenter(state) {
    const active = activeEntry(state);
    state.centerValue.textContent = active ? shareLabel(active.data.share) : short.format(state.displayTotal);
    state.centerLabel.textContent = active ? shorten(active.data.name, 17) : "positive units";
    state.centerUnits.textContent = active ? `${full.format(active.data.current)} units` : "";
  }
  function paint(entry) {
    entry.node.setAttribute("d", arc(entry.geometry.start, entry.geometry.end, { gap: entry.solo ? 0 : .02 }));
    const middle = (entry.geometry.start + entry.geometry.end) / 2;
    entry.node.setAttribute("transform", `translate(${(Math.cos(middle) * entry.offset).toFixed(3)} ${(Math.sin(middle) * entry.offset).toFixed(3)})`);
    entry.node.setAttribute("opacity", Math.max(0, Math.min(1, entry.geometry.opacity)).toFixed(4));
  }
  function schedule(state) {
    if (state.frame !== null || state.disposed) return;
    state.frame = request(time => tick(state, time));
  }
  function tick(state, time) {
    state.frame = null;
    if (state.disposed || state.container.isConnected === false) return;
    let running = false;
    for (const [key, entry] of state.entries) {
      const g = state.options.reducedMotion ? 1 : Math.min(1, (time - entry.geometryAt) / 560), t = ease(g);
      entry.geometry = { start: entry.from.start + (entry.target.start - entry.from.start) * t, end: entry.from.end + (entry.target.end - entry.from.end) * t, opacity: entry.from.opacity + (entry.target.opacity - entry.from.opacity) * t };
      const h = state.options.reducedMotion ? 1 : Math.min(1, (time - entry.offsetAt) / 240);
      entry.offset = entry.offsetFrom + (entry.offsetTarget - entry.offsetFrom) * ease(h);
      paint(entry);
      if (!entry.present && g >= 1) { entry.node.remove(); state.entries.delete(key); }
      else if (g < 1 || h < 1) running = true;
    }
    const progress = state.options.reducedMotion ? 1 : Math.min(1, (time - state.totalAt) / 560);
    state.displayTotal = state.totalFrom + (state.total - state.totalFrom) * ease(progress); updateCenter(state);
    if (progress < 1) running = true;
    if (running) schedule(state);
  }
  function highlight(state) {
    const active = activeEntry(state), time = now(), colors = theme();
    for (const entry of state.entries.values()) {
      const desired = active === entry ? 10 : 0;
      if (entry.offsetTarget !== desired) { entry.offsetFrom = entry.offset; entry.offsetTarget = desired; entry.offsetAt = time; }
      const keyboardFocus = state.focus === entry.key && state.focusVisible;
      entry.node.setAttribute("stroke", keyboardFocus ? colors.text : "none");
      entry.node.setAttribute("stroke-width", keyboardFocus ? "2" : "0");
    }
    updateCenter(state);
    if (state.options.reducedMotion) { for (const entry of state.entries.values()) { entry.offset = entry.offsetTarget; paint(entry); } }
    else schedule(state);
  }
  function tooltip(state, entry, event) {
    if (!entry?.present || typeof state.options.showTip !== "function") return;
    const rect = entry.node.getBoundingClientRect();
    state.options.showTip(`<strong>${esc(entry.data.name)}</strong><p>${full.format(entry.data.current)} units · ${esc(shareLabel(entry.data.share))}</p>`, event?.clientX ?? rect.left + rect.width / 2, event?.clientY ?? rect.top + rect.height / 2);
  }
  function leaveTip(state) { if (typeof state.options.hideTip === "function") state.options.hideTip(); }
  function select(state, key) {
    const entry = state.entries.get(key); if (!entry?.present) return;
    leaveTip(state);
    if (entry.data.other) { state.expanded = !state.expanded; state.hover = null; state.focus = null; draw(state); state.collapse?.focus?.({ preventScroll: true }); }
    else if (typeof state.options.onSelect === "function") state.options.onSelect(entry.data.key);
  }
  function bind(state, node, key) {
    node.addEventListener("pointerenter", event => { state.hover = key; highlight(state); tooltip(state, state.entries.get(key), event); });
    node.addEventListener("pointermove", event => { const entry = state.entries.get(key); if (entry) tooltip(state, entry, event); });
    node.addEventListener("pointerleave", () => { if (state.hover === key) state.hover = null; highlight(state); leaveTip(state); });
    node.addEventListener("focus", event => { state.focus = key; state.focusVisible = typeof node.matches === "function" ? node.matches(":focus-visible") : true; highlight(state); tooltip(state, state.entries.get(key), event); });
    node.addEventListener("blur", () => { if (state.focus === key) { state.focus = null; state.focusVisible = false; } highlight(state); leaveTip(state); });
    node.addEventListener("click", () => select(state, key));
    node.addEventListener("keydown", () => { state.focusVisible = true; highlight(state); });
    if (node.namespaceURI === NS) node.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(state, key); } else if (event.key === "Escape") { state.hover = null; state.focus = null; highlight(state); leaveTip(state); } });
  }
  function legend(state, displayed, positive) {
    const doc = state.container.ownerDocument, colors = theme(); state.legend.replaceChildren(); state.collapse = null;
    for (const data of displayed) {
      const button = doc.createElement("button"); button.type = "button"; button.className = "so-mix-row";
      Object.assign(button.style, { display: "grid", gridTemplateColumns: "8px minmax(0,1fr) auto", columnGap: "8px", rowGap: "4px", width: "100%", textAlign: "left", padding: "5px 0", border: "0", background: "transparent", color: colors.muted, whiteSpace: "normal" });
      const swatch = doc.createElement("span"); swatch.className = "so-swatch"; swatch.style.background = data.fill;
      const label = doc.createElement("span"); label.textContent = shorten(data.name); label.title = data.name;
      const value = doc.createElement("strong"); value.textContent = shareLabel(data.share); value.style.color = colors.text;
      const track = doc.createElement("span"); track.className = "so-mix-share-track"; track.setAttribute("aria-hidden", "true");
      Object.assign(track.style, { display: "block", gridColumn: "2 / 4", width: "100%", height: "3px", borderRadius: "3px", background: colors.surface });
      const fill = doc.createElement("span"); fill.className = "so-mix-share-fill";
      Object.assign(fill.style, { display: "block", height: "100%", width: `${data.share * 100}%`, borderRadius: "inherit", background: data.fill });
      track.append(fill); button.append(swatch, label, value, track); button.setAttribute("aria-label", `${data.name}: ${full.format(data.current)} units, ${shareLabel(data.share, true)}. ${data.other ? "Expand all categories." : "Filter category."}`);
      if (data.other) button.setAttribute("aria-expanded", "false");
      bind(state, button, data.key); state.legend.append(button);
    }
    if (state.expanded && positive.length > 5) {
      const button = doc.createElement("button"); button.type = "button"; button.textContent = "Show less"; button.setAttribute("aria-label", "Collapse to leading categories and Other"); button.setAttribute("aria-expanded", "true");
      Object.assign(button.style, { justifySelf: "start", padding: "5px 0", border: "0", background: "transparent", fontSize: "11px", color: colors.muted });
      button.addEventListener("click", () => { state.expanded = false; state.hover = null; state.focus = null; draw(state); [...state.legend.children].at(-1)?.focus?.({ preventScroll: true }); });
      state.legend.append(button); state.collapse = button;
    }
  }
  function draw(state) {
    if (state.frame !== null) { cancel(state.frame); state.frame = null; }
    const computed = layout(state.options.categories, state.expanded), time = now(), colors = theme();
    const fills = displayColors(state, computed.entries);
    computed.entries.forEach(entry => { entry.fill = fills.get(entry.key); });
    state.totalFrom = state.displayTotal; state.total = computed.total; state.totalAt = time;
    const validKeys = new Set(computed.entries.map(entry => entry.key));
    if (!validKeys.has(state.hover)) state.hover = null; if (!validKeys.has(state.focus)) state.focus = null;
    state.svg.setAttribute("aria-label", `Category contribution: ${full.format(computed.total)} positive category units across ${computed.positive.length} categories. Zero and negative category totals are excluded.`);
    state.title.textContent = state.svg.getAttribute("aria-label");
    for (const entry of state.entries.values()) {
      entry.from = { ...entry.geometry }; entry.geometryAt = time;
      if (!validKeys.has(entry.key)) { entry.present = false; entry.target = { start: entry.geometry.start, end: entry.geometry.start, opacity: 0 }; entry.node.setAttribute("tabindex", "-1"); entry.node.style.pointerEvents = "none"; }
    }
    for (const data of computed.entries) {
      let entry = state.entries.get(data.key);
      if (!entry) {
        const node = svgElement(state.container.ownerDocument, "path", { role: "button", tabindex: "0" });
        Object.assign(node.style, { cursor: "pointer", outline: "none", touchAction: "manipulation" });
        entry = { key: data.key, node, geometry: { start: data.start, end: data.start, opacity: 0 }, offset: 0, offsetFrom: 0, offsetTarget: 0, offsetAt: time };
        state.entries.set(data.key, entry); state.ring.append(node); bind(state, node, data.key);
      }
      entry.data = data; entry.present = true; entry.solo = computed.entries.length === 1; entry.from = { ...entry.geometry }; entry.geometryAt = time;
      // Keep angular travel near the current slice while changing its true span.
      let shift = data.start - entry.geometry.start;
      while (shift > Math.PI) shift -= TAU; while (shift < -Math.PI) shift += TAU;
      const start = entry.geometry.start + shift;
      entry.target = { start, end: start + data.end - data.start, opacity: 1 };
      entry.node.setAttribute("fill", data.fill); entry.node.setAttribute("tabindex", "0"); entry.node.style.pointerEvents = "auto";
      entry.node.setAttribute("aria-label", `${data.name}: ${full.format(data.current)} units, ${shareLabel(data.share, true)}. ${data.other ? "Expand all categories." : "Filter category."}`);
      if (data.other) entry.node.setAttribute("aria-expanded", "false"); else entry.node.removeAttribute("aria-expanded");
    }
    legend(state, computed.entries, computed.positive);
    state.centerValue.style.fill = colors.text; state.centerLabel.style.fill = colors.muted; state.centerUnits.style.fill = colors.muted;
    highlight(state);
    if (state.options.reducedMotion) tick(state, time + 1000); else { for (const entry of state.entries.values()) paint(entry); schedule(state); }
  }
  function render(container, legendContainer, options = {}) {
    if (!container?.ownerDocument || !legendContainer?.replaceChildren) throw new TypeError("Category mix requires chart and legend containers.");
    if (options.palette !== undefined && (!Array.isArray(options.palette) || options.palette.length !== 6 || Array.from(options.palette).some(value => typeof value !== "string" || !value.trim() || value.length > 500))) throw new TypeError("Category mix palette requires six nonempty color strings.");
    let state = states.get(container);
    if (!state || state.svg.parentNode !== container || state.legend !== legendContainer) {
      if (state?.frame !== null && state?.frame !== undefined) cancel(state.frame);
      if (state) state.disposed = true;
      const doc = container.ownerDocument, svg = svgElement(doc, "svg", { viewBox: "0 0 240 240", role: "group" });
      Object.assign(svg.style, { width: "100%", height: "auto", display: "block", overflow: "visible" }); container.style.maxWidth = "360px";
      const title = svgElement(doc, "title"), ring = svgElement(doc, "g"), centerValue = svgElement(doc, "text", { x: 120, y: 114, "text-anchor": "middle", "font-size": 28 }), centerLabel = svgElement(doc, "text", { x: 120, y: 135, "text-anchor": "middle", "font-size": 10 }), centerUnits = svgElement(doc, "text", { x: 120, y: 151, "text-anchor": "middle", "font-size": 10 });
      // Inline typography overrides the dashboard's generic chart text rule.
      centerValue.style.fontSize = "28px"; centerLabel.style.fontSize = "10px"; centerUnits.style.fontSize = "10px";
      svg.append(title, ring, centerValue, centerLabel, centerUnits); container.replaceChildren(svg);
      state = { container, legend: legendContainer, svg, title, ring, centerValue, centerLabel, centerUnits, entries: new Map(), colors: new Map(), visibleKeys: new Set(), expanded: false, hover: null, focus: null, focusVisible: false, frame: null, displayTotal: 0, total: 0, totalFrom: 0, totalAt: 0, disposed: false };
      states.set(container, state);
    }
    state.options = { ...options, ...(options.palette ? { palette: options.palette.map(value => value.trim()) } : {}), categories: Array.isArray(options.categories) ? options.categories : [], reducedMotion: options.reducedMotion === true };
    draw(state);
    return Object.freeze({ destroy() { if (state.frame !== null) cancel(state.frame); state.frame = null; state.disposed = true; leaveTip(state); if (states.get(container) === state) { container.replaceChildren(); legendContainer.replaceChildren(); states.delete(container); } } });
  }
  root.PPCSelloutMix = Object.freeze({ render, layout, arc, color });
})(typeof globalThis !== "undefined" ? globalThis : this);
