/* Retailer/category alluvial widths encode positive aggregated net pairs only. */
(function (root) {
  "use strict";
  const NS = "http://www.w3.org/2000/svg", OTHER = Symbol("other"), states = new WeakMap();
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const key = value => typeof value === "string" && value.trim() && value.length <= 500 ? value : "";
  const full = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 21 });
  const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
  const esc = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const shorten = (value, length) => value.length > length ? value.slice(0, Math.max(1, length - 1)) + "…" : value;
  const share = value => value < .001 ? "<0.1%" : `${(value * 100).toFixed(1)}%`;
  const now = () => root.performance?.now?.() ?? Date.now();
  const request = callback => root.requestAnimationFrame ? root.requestAnimationFrame(callback) : root.setTimeout(() => callback(now()), 16);
  const cancel = id => root.cancelAnimationFrame ? root.cancelAnimationFrame(id) : root.clearTimeout(id);
  const ease = value => 1 - Math.pow(1 - Math.min(1, Math.max(0, value)), 3);
  function theme() { const c = root.PortfolioTheme?.colors || {}; return { text: c.text || "#D5D7DC", muted: c.label || "#BBBCC0", gray: c.label || "#BBBCC0", negative: c.alertText || "#FF8A8A" }; }
  function fillFor(store, palette) { if (!palette) return theme().gray; let hash = 0; for (const char of store) hash = Math.imul(hash, 31) + char.charCodeAt(0) >>> 0; return palette[hash % palette.length]; }
  function metadata(values) { return new Map((Array.isArray(values) ? values : []).filter(value => key(value?.key)).map(value => [value.key, { key: value.key, name: key(value.name) || value.key }])); }
  const pairKey = (store, category) => JSON.stringify([store, category === OTHER ? null : category]);
  const nodeKey = (side, value) => `${side}:${JSON.stringify(value === OTHER ? null : value)}`;
  function layout(options = {}) {
    const storeMeta = metadata(options.stores), categoryMeta = metadata(options.categories), pairs = new Map();
    for (const cell of Array.isArray(options.cells) ? options.cells : []) {
      if (!key(cell?.store) || !key(cell?.category) || cell.current !== null && !finite(cell.current)) continue;
      if (Array.isArray(options.stores) && !storeMeta.has(cell.store) || Array.isArray(options.categories) && !categoryMeta.has(cell.category)) continue;
      const id = pairKey(cell.store, cell.category);
      if (!pairs.has(id)) pairs.set(id, { key: id, store: cell.store, category: cell.category, current: null });
      const pair = pairs.get(id); if (finite(cell.current)) pair.current = (pair.current ?? 0) + cell.current;
      if (!storeMeta.has(cell.store)) storeMeta.set(cell.store, { key: cell.store, name: cell.store });
      if (!categoryMeta.has(cell.category)) categoryMeta.set(cell.category, { key: cell.category, name: key(cell.name) || cell.category });
    }
    const observed = [...pairs.values()].filter(pair => finite(pair.current)), positive = observed.filter(pair => pair.current > 0), negative = observed.filter(pair => pair.current < 0);
    const positiveTotal = positive.reduce((sum, pair) => sum + pair.current, 0), negativeTotal = negative.reduce((sum, pair) => sum + pair.current, 0);
    if (!Number.isFinite(positiveTotal) || !Number.isFinite(negativeTotal)) throw new RangeError("Retailer-category totals are too large to visualize.");
    const categoryTotals = new Map(); positive.forEach(pair => categoryTotals.set(pair.category, (categoryTotals.get(pair.category) || 0) + pair.current));
    const ranked = [...categoryTotals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])), visible = options.expanded ? ranked : ranked.slice(0, 7), kept = new Set(visible.map(([category]) => category));
    const categories = visible.map(([category, total]) => ({ ...categoryMeta.get(category), total, other: false })).sort((a, b) => a.key.localeCompare(b.key));
    if (!options.expanded && ranked.length > 7) categories.push({ key: OTHER, name: "Other", total: ranked.slice(7).reduce((sum, [, value]) => sum + value, 0), other: true });
    const groupedFlows = new Map();
    for (const pair of positive) { const category = kept.has(pair.category) ? pair.category : OTHER, id = pairKey(pair.store, category); if (!groupedFlows.has(id)) groupedFlows.set(id, { key: id, store: pair.store, category, current: 0, other: category === OTHER }); groupedFlows.get(id).current += pair.current; }
    const stores = [...storeMeta.values()].sort((a, b) => a.key.localeCompare(b.key)).map(store => { const rows = observed.filter(pair => pair.store === store.key); return { ...store, total: positive.filter(pair => pair.store === store.key).reduce((sum, pair) => sum + pair.current, 0), net: rows.length ? rows.reduce((sum, pair) => sum + pair.current, 0) : null, observed: rows.length > 0 }; });
    const width = finite(options.width) ? Math.max(240, options.width) : 720, left = width < 400 ? 80 : 132, right = width - (width < 400 ? 94 : 186);
    // Use the real margins and leave positive band area beyond the minimum label
    // slots. Otherwise eight categories exceed the canvas even at scale zero.
    const top = 28, footer = 52, bandReserve = 64;
    const height = Math.max(320, top + footer + bandReserve + categories.length * 26 + Math.max(0, categories.length - 1) * 8, top + footer + bandReserve + stores.length * 34 + Math.max(0, stores.length - 1) * 12), bottom = height - footer, available = bottom - top;
    const fits = (nodes, minimum, gap, scale) => nodes.reduce((sum, node) => sum + Math.max(minimum, node.total * scale), 0) + Math.max(0, nodes.length - 1) * gap <= available;
    let low = 0, high = positiveTotal ? available / positiveTotal : 0;
    for (let iteration = 0; iteration < 48; iteration++) { const candidate = (low + high) / 2; if (fits(stores, 34, 12, candidate) && fits(categories, 26, 8, candidate)) low = candidate; else high = candidate; }
    const scale = low;
    const position = (nodes, minimum, gap, x, side) => { const used = nodes.reduce((sum, node) => sum + Math.max(minimum, node.total * scale), 0) + Math.max(0, nodes.length - 1) * gap; let cursor = top + (available - used) / 2; return nodes.map(node => { const block = Math.max(minimum, node.total * scale), middle = cursor + block / 2, band = node.total * scale; cursor += block + gap; return { ...node, id: nodeKey(side, node.key), x, y0: middle - band / 2, y1: middle + band / 2, labelY: middle, side }; }); };
    const sourceNodes = position(stores, 34, 12, left, "store"), targetNodes = position(categories, 26, 8, right, "category"), sourceMap = new Map(sourceNodes.map(node => [node.key, node])), targetMap = new Map(targetNodes.map(node => [node.key, node])), sourceOffsets = new Map(), targetOffsets = new Map();
    const order = new Map(categories.map((category, index) => [category.key, index]));
    const ribbons = [...groupedFlows.values()].sort((a, b) => a.store.localeCompare(b.store) || order.get(a.category) - order.get(b.category)).map(flow => { const source = sourceMap.get(flow.store), target = targetMap.get(flow.category), amount = flow.current * scale, sourceOffset = sourceOffsets.get(flow.store) || 0, targetOffset = targetOffsets.get(flow.category) || 0; sourceOffsets.set(flow.store, sourceOffset + amount); targetOffsets.set(flow.category, targetOffset + amount); return { ...flow, storeName: source.name, categoryName: target.name, share: positiveTotal ? flow.current / positiveTotal : 0, geometry: { left, right, sy0: source.y0 + sourceOffset, sy1: source.y0 + sourceOffset + amount, ty0: target.y0 + targetOffset, ty1: target.y0 + targetOffset + amount, opacity: 1 } }; });
    return { width, height, positiveTotal, negativeTotal, netTotal: observed.length ? observed.reduce((sum, pair) => sum + pair.current, 0) : null, observedPairs: observed.length, missingPairs: [...pairs.values()].filter(pair => pair.current === null).length, zeroPairs: observed.filter(pair => pair.current === 0).length, negativePairs: negative.length, stores: sourceNodes, categories: targetNodes, ribbons, expanded: options.expanded === true, expandable: ranked.length > 7, scale };
  }
  function ribbonPath(g) { const a = g.left + (g.right - g.left) * .42, b = g.left + (g.right - g.left) * .58; return `M${g.left},${g.sy0}C${a},${g.sy0} ${b},${g.ty0} ${g.right},${g.ty0}L${g.right},${g.ty1}C${b},${g.ty1} ${a},${g.sy1} ${g.left},${g.sy1}Z`; }
  function svg(doc, name, attrs = {}) { const node = doc.createElementNS(NS, name); for (const [field, value] of Object.entries(attrs)) node.setAttribute(field, String(value)); return node; }
  function stop(state) { if (state.frame !== null) cancel(state.frame); state.frame = null; }
  function paint(state, entry) {
    entry.path.setAttribute("d", ribbonPath(entry.geometry));
    const active = state.hover ?? (state.focusVisible ? state.focus : null), highlighted = active === entry.key, alpha = active ? highlighted ? .67 : .045 : .2;
    entry.path.style.opacity = String(entry.geometry.opacity * alpha);
    entry.path.setAttribute("stroke", state.focus === entry.key && state.focusVisible ? theme().text : "none"); entry.path.setAttribute("stroke-width", state.focus === entry.key && state.focusVisible ? "2" : "0");
  }
  function paintNode(state, node) { const g = node.geometry, retailer = node.data.side === "store"; node.anchor.setAttribute("d", `M${g.x},${g.y0}L${g.x},${g.y1}`); node.label.setAttribute("x", g.x + (retailer ? -10 : 10)); node.label.setAttribute("y", g.labelY + (retailer ? -4 : 4)); if (node.units) { node.units.setAttribute("x", g.x - 10); node.units.setAttribute("y", g.labelY + 16); } node.group.style.opacity = String(g.opacity); }
  function tick(state, time) {
    state.frame = null; if (state.disposed || state.container.isConnected === false) return;
    const progress = state.options.reducedMotion ? 1 : Math.min(1, Math.max(0, (time - state.started) / 520)), t = ease(progress);
    for (const [key, entry] of state.entries) { entry.geometry = Object.fromEntries(Object.keys(entry.target).map(field => [field, entry.from[field] + (entry.target[field] - entry.from[field]) * t])); paint(state, entry); if (!entry.present && progress === 1) { entry.path.remove(); state.entries.delete(key); } }
    for (const [key, node] of state.nodes) { node.geometry = Object.fromEntries(Object.keys(node.target).map(field => [field, node.from[field] + (node.target[field] - node.from[field]) * t])); paintNode(state, node); if (!node.present && progress === 1) { node.group.remove(); state.nodes.delete(key); } }
    if (progress < 1) state.frame = request(time => tick(state, time));
  }
  function highlight(state) { for (const entry of state.entries.values()) paint(state, entry); }
  function hideTip(state) { if (typeof state.options.hideTip === "function") state.options.hideTip(); }
  function tooltip(state, entry, event) { if (!entry?.present || typeof state.options.showTip !== "function") return; const box = entry.path.getBoundingClientRect(); state.options.showTip(`<strong>${esc(entry.data.storeName)} · ${esc(entry.data.categoryName)}</strong><p>${full.format(entry.data.current)} net pair units · ${esc(share(entry.data.share))} of positive pairs</p>`, event?.clientX ?? box.left + box.width / 2, event?.clientY ?? box.top + box.height / 2); }
  function activate(state, key) { const entry = state.entries.get(key); if (!entry?.present) return; hideTip(state); if (entry.data.other) { state.expanded = true; state.hover = null; state.focus = null; draw(state); state.collapse?.focus?.(); } else if (typeof state.options.onSelect === "function") state.options.onSelect({ store: entry.data.store, category: entry.data.category }); }
  function bind(state, entry) {
    const path = entry.path;
    path.addEventListener("pointerenter", event => { state.hover = entry.key; highlight(state); tooltip(state, entry, event); }); path.addEventListener("pointermove", event => tooltip(state, entry, event)); path.addEventListener("pointerleave", () => { if (state.hover === entry.key) state.hover = null; highlight(state); hideTip(state); });
    path.addEventListener("focus", event => { state.focus = entry.key; state.focusVisible = typeof path.matches === "function" ? path.matches(":focus-visible") : true; highlight(state); tooltip(state, entry, event); }); path.addEventListener("blur", () => { if (state.focus === entry.key) state.focus = null; state.focusVisible = false; highlight(state); hideTip(state); });
    path.addEventListener("click", () => activate(state, entry.key)); path.addEventListener("keydown", event => { state.focusVisible = true; highlight(state); if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(state, entry.key); } else if (event.key === "Escape") hideTip(state); });
  }
  function draw(state) {
    stop(state); const first = !state.hasRendered, result = layout({ ...state.options, expanded: state.expanded, width: Math.round(state.container.getBoundingClientRect().width || 720) }), doc = state.container.ownerDocument, colors = theme(); state.started = now(); state.result = result;
    state.svg.setAttribute("viewBox", `0 0 ${result.width} ${result.height}`); state.svg.setAttribute("aria-label", `${full.format(result.positiveTotal)} positive aggregated net retailer-category pair units. ${result.observedPairs} observed pairs, ${result.missingPairs} missing pairs and ${result.zeroPairs} reported zero pairs. ${full.format(result.negativeTotal)} negative pair units excluded from widths. Reported net total: ${result.netTotal === null ? "missing" : full.format(result.netTotal)}. Widths use the positive-pair denominator; category net totals may differ.`); state.title.textContent = state.svg.getAttribute("aria-label");
    const wanted = new Set(result.ribbons.map(flow => flow.key)); if (!wanted.has(state.hover)) state.hover = null; if (!wanted.has(state.focus)) state.focus = null;
    for (const entry of state.entries.values()) { entry.from = { ...entry.geometry }; entry.present = wanted.has(entry.key); if (!entry.present) { const g = entry.geometry; entry.target = { ...g, sy0: (g.sy0 + g.sy1) / 2, sy1: (g.sy0 + g.sy1) / 2, ty0: (g.ty0 + g.ty1) / 2, ty1: (g.ty0 + g.ty1) / 2, opacity: 0 }; entry.path.setAttribute("tabindex", "-1"); entry.path.style.pointerEvents = "none"; } }
    for (const flow of result.ribbons) {
      let entry = state.entries.get(flow.key);
      if (!entry) { const path = svg(doc, "path", { role: "button", tabindex: 0 }); Object.assign(path.style, { cursor: "pointer", outline: "none", transition: state.options.reducedMotion ? "none" : "opacity 160ms ease", touchAction: "manipulation" }); const source = state.nodes.get(nodeKey("store", flow.store))?.geometry, target = state.nodes.get(nodeKey("category", flow.category))?.geometry, g = flow.geometry; const initial = first ? { ...g } : { ...g, sy0: source?.labelY ?? (g.sy0 + g.sy1) / 2, sy1: source?.labelY ?? (g.sy0 + g.sy1) / 2, ty0: target?.labelY ?? (g.ty0 + g.ty1) / 2, ty1: target?.labelY ?? (g.ty0 + g.ty1) / 2, opacity: 0 }; entry = { key: flow.key, path, geometry: initial }; state.entries.set(flow.key, entry); state.ribbons.append(path); bind(state, entry); }
      entry.data = flow; entry.present = true; entry.from = { ...entry.geometry }; entry.target = { ...flow.geometry }; entry.path.setAttribute("fill", fillFor(flow.store, state.options.palette)); entry.path.setAttribute("tabindex", "0"); entry.path.style.pointerEvents = "auto"; entry.path.setAttribute("aria-label", `${flow.storeName} to ${flow.categoryName}: ${full.format(flow.current)} net pair units, ${share(flow.share)} of positive pairs. ${flow.other ? "Expand Other categories." : "Filter retailer and category."}`); paint(state, entry);
    }
    const allNodes = [...result.stores, ...result.categories], nodeKeys = new Set(allNodes.map(node => node.id));
    for (const node of state.nodes.values()) { node.from = { ...node.geometry }; node.present = nodeKeys.has(node.key); if (!node.present) node.target = { ...node.geometry, opacity: 0 }; }
    for (const data of allNodes) {
      let node = state.nodes.get(data.id); const geometry = { x: data.x, y0: data.y0, y1: data.y1, labelY: data.labelY, opacity: 1 };
      if (!node) { const group = svg(doc, "g"), anchor = svg(doc, "path", { fill: "none", stroke: colors.gray, "stroke-width": 2 }), label = svg(doc, "text", { "text-anchor": data.side === "store" ? "end" : "start" }), units = data.side === "store" ? svg(doc, "text", { "text-anchor": "end" }) : null, title = svg(doc, "title"); group.append(title, anchor, label); if (units) group.append(units); node = { key: data.id, group, anchor, label, units, title, geometry: first ? { ...geometry } : { ...geometry, opacity: 0 } }; state.nodes.set(data.id, node); state.labels.append(group); }
      node.data = data; node.present = true; node.from = { ...node.geometry }; node.target = geometry; node.label.textContent = shorten(data.name, data.side === "store" ? result.width < 400 ? 11 : 20 : result.width < 400 ? 12 : 26); node.label.style.fontSize = "12px"; node.label.style.fill = colors.muted; node.label.style.pointerEvents = "none"; node.title.textContent = `${data.name}: ${full.format(data.total)} positive net pair units${data.side === "store" ? `; reported net units ${data.net === null ? "missing" : full.format(data.net)}` : ""}`; if (node.units) { node.units.textContent = data.observed ? compact.format(data.total) : "—"; node.units.style.fontSize = "14px"; node.units.style.fill = colors.text; } paintNode(state, node);
    }
    state.note.setAttribute("x", 8); state.note.setAttribute("y", result.height - 27); state.note.textContent = "Positive retailer–category net pairs"; state.note.style.fill = colors.muted; state.note.style.fontSize = "12px";
    state.negative.setAttribute("x", 8); state.negative.setAttribute("y", result.height - 11); state.negative.textContent = result.negativePairs ? `${full.format(result.negativeTotal)} net units excluded from widths` : result.missingPairs ? `${result.missingPairs} missing pairs excluded` : ""; state.negative.style.fill = result.negativePairs ? colors.negative : colors.muted; state.negative.style.fontSize = "12px";
    state.empty.setAttribute("x", result.width / 2); state.empty.setAttribute("y", result.height / 2); state.empty.textContent = result.positiveTotal ? "" : "No positive pairs"; state.empty.style.fill = colors.muted; state.empty.style.fontSize = "14px";
    if (state.collapse) { state.collapse.remove(); state.collapse = null; }
    if (state.expanded && result.expandable) { const button = doc.createElement("button"); button.type = "button"; button.textContent = "Show less"; button.setAttribute("aria-label", "Collapse to leading categories and Other"); Object.assign(button.style, { padding: "5px 0", border: "0", background: "transparent", fontSize: "11px", color: colors.muted }); button.addEventListener("click", () => { state.expanded = false; state.hover = null; state.focus = null; draw(state); }); state.container.append(button); state.collapse = button; }
    state.hasRendered = true; if (first || state.options.reducedMotion) tick(state, state.started + 1000); else state.frame = request(time => tick(state, time));
  }
  function render(container, options = {}) {
    if (!container?.ownerDocument) throw new TypeError("Retailer flow requires a chart container.");
    if (options.palette !== undefined && (!Array.isArray(options.palette) || !options.palette.length || options.palette.length > 12 || Array.from(options.palette).some(value => typeof value !== "string" || !value.trim() || value.length > 500))) throw new TypeError("Retailer flow palette requires nonempty color strings.");
    let state = states.get(container);
    if (!state || state.svg.parentNode !== container) { if (state) { stop(state); state.disposed = true; } const doc = container.ownerDocument, chart = svg(doc, "svg", { role: "group" }), title = svg(doc, "title"), ribbons = svg(doc, "g"), labels = svg(doc, "g"), note = svg(doc, "text"), negative = svg(doc, "text"), empty = svg(doc, "text", { "text-anchor": "middle" }); chart.append(title, ribbons, labels, note, negative, empty); Object.assign(chart.style, { width: "100%", height: "auto", display: "block", overflow: "visible" }); container.replaceChildren(chart); state = { container, svg: chart, title, ribbons, labels, note, negative, empty, entries: new Map(), nodes: new Map(), expanded: options.expandOther === true, hover: null, focus: null, focusVisible: false, frame: null, disposed: false, hasRendered: false, collapse: null }; states.set(container, state); }
    state.options = { ...options, ...(options.palette ? { palette: options.palette.map(value => value.trim()) } : {}), reducedMotion: options.reducedMotion === true }; draw(state);
    return Object.freeze({ destroy() { stop(state); state.disposed = true; hideTip(state); if (states.get(container) === state) { container.replaceChildren(); states.delete(container); } } });
  }
  root.PPCSelloutFlow = Object.freeze({ render, layout, ribbonPath });
})(typeof globalThis !== "undefined" ? globalThis : this);
