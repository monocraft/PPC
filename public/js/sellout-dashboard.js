/* Retail analytics has its own file imports and storage. It never writes portfolio facts. */
(function retailDashboard(root) {
  "use strict";
  const app = document.getElementById("selloutApp");
  if (!app) return;
  const $ = id => app.querySelector(`#${id}`), M = root.PPCSelloutModel;
  const colors = ["var(--so-chart-white)", "var(--so-chart-1)", "var(--so-chart-3)", "var(--so-chart-4)", "var(--so-chart-5)", "var(--so-chart-6)"];
  const retailerColors = [colors[0], colors[2], colors[3], colors[5], colors[1], colors[4]];
  const seriesStyle = key => { let hash = 0; for (const c of key) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) >>> 0; return { color: colors[hash % colors.length], dash: ["", "7 4", "2 4"][Math.floor(hash / colors.length) % 3] }; };
  const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = v => Number.isFinite(v) ? number.format(v) : "—";
  const short = v => Number.isFinite(v) ? compact.format(v) : "—";
  const pct = v => Number.isFinite(v) ? `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%` : "n.a.";
  const day = (v, full = false) => v ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", ...(full ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(`${v}T12:00:00Z`)) : "n.a.";
  const niceName = v => String(v || "").replace(/^HyperX\s+/i, "").replace(/\s+(?:HX-|HHSC|KHX-|HMS|HMIS|HMIQ|HKBO|HKCP|HEPB)[A-Z0-9#\-/]+.*$/i, "");
  const limited = (v, n) => v.length > n ? v.slice(0, n - 1) + "…" : v;
  const bandNames = ["Under $50", "$50–99", "$100–149", "$150–199", "$200+", "Unmapped"];
  const state = { snapshot: null, prices: {}, ppcPrices: {}, ppcProjection: null, pricingSource: null, stores: [], products: [], storesNone: false, productsNone: false, shortlist: [], drafts: {}, sort: "current", descending: true, page: 0, analysis: null, pending: null, sheets: [], hiddenSeries: new Set(), candidates: [], view: "overview", brushing: false, markerDate: null, hoverDate: null };
  const barAnimations = new Map();
  let timelineFull = null, playTimer = null, brushUpdateTimer = null, playing = false, playbackScale = null;
  let dbPromise;
  const reduced = () => root.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let chartSpring = null, chartSpringReduced = null;
  function paintChartSpring(pose) {
    const surface = $("trendChart").querySelector("#soTrendSurface"); if (!surface) return;
    if (!pose.x && !pose.stretch) { surface.removeAttribute("transform"); return; }
    const origin = Number(surface.dataset.origin || 0);
    surface.setAttribute("transform", `translate(${pose.x} 0) translate(${origin} 0) scale(${1 + pose.stretch} 1) translate(${-origin} 0)`);
  }
  function springController() {
    const quiet = reduced();
    if (!chartSpring || chartSpringReduced !== quiet) { chartSpring?.destroy(); chartSpringReduced = quiet; chartSpring = root.PPCSelloutSpring.create({ reducedMotion: quiet, onFrame: paintChartSpring }); }
    return chartSpring;
  }
  const priceRecord = sku => Object.hasOwn(state.prices, sku) ? state.prices[sku] : state.ppcPrices[sku];
  const priceOf = sku => Number.isFinite(priceRecord(sku)?.msrp) && priceRecord(sku).msrp >= 0 ? priceRecord(sku).msrp : null;
  const bandOf = sku => { const p = priceOf(sku); return p === null ? "Unmapped" : p < 50 ? bandNames[0] : p < 100 ? bandNames[1] : p < 150 ? bandNames[2] : p < 200 ? bandNames[3] : bandNames[4]; };
  function message(text, error = false) { $("status").textContent = text; $("status").classList.toggle("is-error", error); }
  function openDb() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const req = root.indexedDB.open("ppc-retail-analytics-v1", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("workspace");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("Close an older analytics tab to save this workspace."));
    });
    return dbPromise;
  }
  async function storage(mode, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("workspace", mode), store = tx.objectStore("workspace");
      const req = mode === "readonly" ? store.get("current") : store.put(value, "current");
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Analytics save was interrupted."));
    });
  }
  async function persist() {
    try { await storage("readwrite", { snapshot: state.snapshot, prices: state.prices, shortlist: state.shortlist, ppcProjection: state.ppcProjection, pricingSource: state.pricingSource }); return true; }
    catch (_) { message("This browser could not save analytics locally. The current view works; save an analytics snapshot to keep your changes.", true); return false; }
  }
  function retailerIcon(store) {
    const brand = store.toLowerCase().replace(/[^a-z0-9]/g, ""), icons = {
      amazon: '<path d="M3 14c5 4 12 5 18-1M18 12l4 .5-1 4"/>',
      bestbuy: '<path d="M3 5h13l6 7-6 7H3Z"/><circle cx="7" cy="12" r="1.3"/>',
      target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
      walmart: '<path d="M12 2v5M12 17v5M3.3 7l4.3 2.5M16.4 14.5l4.3 2.5M3.3 17l4.3-2.5M16.4 9.5 20.7 7" stroke-width="2.5"/>',
    };
    if (Object.hasOwn(icons, brand)) return `<svg class="so-retailer-icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[brand]}</svg>`;
    const words = store.match(/[\p{L}\p{N}]+/gu) || [], initials = words.length > 1 ? Array.from(words[0])[0] + Array.from(words.at(-1))[0] : Array.from(words[0] || store).slice(0, 2).join("");
    return `<span class="so-retailer-monogram" aria-hidden="true">${esc(initials.toUpperCase())}</span>`;
  }
  function renderStoreOptions(stores) {
    const container = $("storeOptions"), buttons = [...container.querySelectorAll("button[data-store]")];
    if (buttons.length !== stores.length || buttons.some((button, index) => button.dataset.store !== stores[index])) container.innerHTML = stores.map(store => `<button class="so-retailer-toggle" type="button" data-store="${esc(store)}" aria-label="${esc(store)}" aria-pressed="false">${retailerIcon(store)}<span>${esc(store)}</span></button>`).join("");
    container.querySelectorAll("button[data-store]").forEach(button => button.setAttribute("aria-pressed", String(!state.storesNone && (!state.stores.length || state.stores.includes(button.dataset.store)))));
  }
  function controls() {
    if (!state.snapshot) return;
    const o = M.options(state.snapshot);
    renderStoreOptions(o.stores);
    renderProductOptions();
    const oldCategory = $("categoryFilter").value;
    $("categoryFilter").innerHTML = '<option value="">All categories</option>' + o.categories.map(c => `<option>${esc(c)}</option>`).join("");
    $("categoryFilter").value = oldCategory;
    const oldMarket = $("marketStore").value;
    $("marketStore").innerHTML = '<option value="">All selected retailers</option>' + o.stores.filter(s => !state.storesNone && (!state.stores.length || state.stores.includes(s))).map(s => `<option>${esc(s)}</option>`).join("");
    $("marketStore").value = oldMarket;
    for (const id of ["startDate", "endDate"]) { $(id).min = o.start; $(id).max = o.end; }
  }
  function renderProductOptions() {
    if (!state.snapshot) return;
    const q = $("productSearch").value.trim().toLowerCase(), products = M.options(state.snapshot).products;
    const count = state.productsNone ? 0 : state.products.length ? products.filter(product => state.products.includes(product.sku)).length : products.length;
    $("productLabel").textContent = count === 0 ? "None" : count === products.length ? "All" : `${count} selected`;
    $("productSelectionCount").textContent = `${count} selected`;
    const visible = products.filter(product => `${product.sku} ${product.product} ${(product.aliases || []).join(" ")}`.toLowerCase().includes(q));
    const container = $("productOptions"), inputs = [...container.querySelectorAll("input[data-product]")];
    if (inputs.length !== visible.length || inputs.some((input, index) => input.dataset.product !== visible[index].sku)) container.innerHTML = visible.map(product => `<label><input type="checkbox" data-product="${esc(product.sku)}"><span>${esc(niceName(product.product))}<small>${esc(product.sku)} · ${esc(product.category)}</small></span></label>`).join("");
    container.querySelectorAll("input[data-product]").forEach(input => { input.checked = !state.productsNone && (!state.products.length || state.products.includes(input.dataset.product)); });
  }
  function positionProductMenu() {
    const picker = $("productPicker"); if (!picker.open) return;
    const menu = picker.querySelector(".so-picker-menu"), viewport = document.documentElement.clientWidth || root.innerWidth;
    menu.style.maxWidth = `${Math.max(0, viewport - 36)}px`;
    const box = picker.getBoundingClientRect(), width = menu.getBoundingClientRect().width;
    menu.style.left = `${Math.max(18, Math.min(box.left, viewport - width - 18)) - box.left}px`; menu.style.right = "auto";
  }
  function filters() {
    let products = state.productsNone ? ["__no_products_selected__"] : [...state.products];
    if ($("bandFilter").value) {
      products = M.options(state.snapshot).products.filter(p => (!products.length || products.includes(p.sku)) && bandOf(p.sku) === $("bandFilter").value).map(p => p.sku);
      if (!products.length) products = ["__unmapped_price_filter_no_matches__"];
    }
    return { stores: state.storesNone ? ["__no_retailers_selected__"] : state.stores, products, categories: $("categoryFilter").value ? [$("categoryFilter").value] : [], start: $("startDate").value, end: $("endDate").value, comparison: $("comparison").value, coverage: $("coverage").value };
  }
  function setFilterSelection(field, value, checked) {
    const options = M.options(state.snapshot), all = field === "stores" ? options.stores : options.products.map(product => product.sku);
    if (!all.includes(value)) return;
    const noneField = `${field}None`, selected = new Set(state[noneField] ? [] : state[field].length ? state[field] : all);
    if (checked) selected.add(value); else selected.delete(value);
    const next = all.filter(key => selected.has(key));
    state[noneField] = next.length === 0;
    state[field] = next.length === all.length ? [] : next;
  }
  function setAllFilters(field, checked = true) {
    state[field] = []; state[`${field}None`] = !checked;
  }
  function applyPreset() {
    if (!state.snapshot || $("periodPreset").value === "custom") return;
    const s = state.snapshot, f = filters(), all = M.analyze(s, { ...f, start: s.periods[0].date, end: s.periods.at(-1).date, comparison: "none" });
    const last = f.coverage === "common" ? all.coverage.commonEnd : all.coverage.cutoffs.map(c => c.last).filter(Boolean).sort().at(-1);
    const end = last || s.periods.at(-1).date, preset = $("periodPreset").value;
    let start = s.periods[0].date;
    if (/^\d+$/.test(preset)) start = M.addDays(end, -(Number(preset) - 1) * 7);
    if (preset === "fy26" || preset === "fy25") {
      const year = preset === "fy26" ? "FY26" : "FY25", p = s.periods.filter(p => p.quarter.startsWith(year));
      if (p.length) { start = p[0].date; $("endDate").value = p.at(-1).date < end ? p.at(-1).date : end; }
    } else $("endDate").value = end;
    $("startDate").value = start < s.periods[0].date ? s.periods[0].date : start;
  }
  function svgFrame(id, h, title) {
    const el = $(id), w = Math.max(250, Math.round(el.getBoundingClientRect().width));
    return { el, w, h, begin: `<svg class="so-plot" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>` };
  }
  const rect = (x, y, w, h, fill, extra = "") => `<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${Math.max(0, h)}" fill="${fill}" ${extra}/>`;
  const txt = (x, y, v, extra = "") => `<text x="${x}" y="${y}" ${extra}>${esc(v)}</text>`;
  const noChart = (id, text) => { $(id).innerHTML = `<div class="so-no-chart">${text}</div>`; };
  function showTip(html, x, y) {
    const tip = $("chartTooltip"); tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(x + 15, root.innerWidth - r.width - 10))}px`;
    tip.style.top = `${Math.max(8, Math.min(y + 15, root.innerHeight - r.height - 10))}px`;
  }
  function attachTips(el) {
    el.querySelectorAll("[data-tip]").forEach(mark => {
      const show = e => { const r = mark.getBoundingClientRect(); showTip(mark.getAttribute("data-tip"), e.clientX ?? r.left, e.clientY ?? r.top); };
      mark.addEventListener("pointermove", show); mark.addEventListener("focus", show); mark.addEventListener("click", show);
      mark.addEventListener("pointerleave", () => { $("chartTooltip").hidden = true; }); mark.addEventListener("blur", () => { $("chartTooltip").hidden = true; });
    });
  }
  function animateMarks(el) {
    const marks = [...el.querySelectorAll(".so-bar-mark")], attributes = ["x", "y", "width", "height"], previous = barAnimations.get(el.id);
    if (previous?.frame) cancelAnimationFrame(previous.frame);
    const entries = marks.map((mark, i) => { const key = mark.getAttribute("data-bar-key") || String(i), target = attributes.map(a => Number(mark.getAttribute(a))); return { mark, key, target, from: previous?.values.get(key) || target }; });
    const cache = { values: new Map(), frame: null }; barAnimations.set(el.id, cache);
    const paint = progress => { const ease = 1 - Math.pow(1 - progress, 3); entries.forEach(entry => { const values = entry.target.map((value, j) => entry.from[j] + (value - entry.from[j]) * ease); attributes.forEach((attribute, j) => entry.mark.setAttribute(attribute, values[j])); cache.values.set(entry.key, values); }); };
    if (reduced() || !previous || !entries.length) { paint(1); return; }
    paint(0); const start = performance.now(), duration = playing ? 275 : 420;
    const step = now => { cache.frame = null; if (!marks[0]?.isConnected) return; const progress = Math.min(1, (now - start) / duration); paint(progress); if (progress < 1) cache.frame = requestAnimationFrame(step); };
    cache.frame = requestAnimationFrame(step);
  }
  function linePath(values, x, y) {
    let path = "", start = 0;
    while (start < values.length) {
      if (!Number.isFinite(values[start])) { start++; continue; }
      let end = start; while (end + 1 < values.length && Number.isFinite(values[end + 1])) end++;
      const slope = i => values[i + 1] - values[i];
      const tangent = i => { if (start === end) return 0; if (i === start) return slope(i); if (i === end) return slope(i - 1); const a = slope(i - 1), b = slope(i); return a * b <= 0 ? 0 : 2 * a * b / (a + b); };
      path += `M${x(start).toFixed(2)},${y(values[start]).toFixed(2)} `;
      for (let i = start; i < end; i++) { const dx = (x(i + 1) - x(i)) / 3; path += `C${(x(i) + dx).toFixed(2)},${y(values[i] + tangent(i) / 3).toFixed(2)} ${(x(i + 1) - dx).toFixed(2)},${y(values[i + 1] - tangent(i + 1) / 3).toFixed(2)} ${x(i + 1).toFixed(2)},${y(values[i + 1]).toFixed(2)} `; }
      start = end + 1;
    }
    return path;
  }
  function trendSeries(analysis, mode) {
    const matched = analysis.selection.comparison !== "none" && analysis.totals.comparisonComplete;
    if (mode === "stores") { const retailers = M.options(state.snapshot).stores; return [...analysis.stores].sort((a, b) => a.key.localeCompare(b.key)).map(s => ({ key: s.key, name: s.name, values: s.series, color: retailerColors[retailers.indexOf(s.key) % retailerColors.length] })); }
    if (mode === "products") {
      const entries = state.products.length ? analysis.products : analysis.products.filter(p => p.current > 0).slice(0, 5);
      return entries.map(p => ({ key: p.key, name: niceName(p.name), sku: p.sku || p.key, values: p.series, ...seriesStyle(p.key) }));
    }
    return [{ key: "current", name: matched ? "Matched units" : "Reported units", values: analysis.series.map(p => matched ? p.comparableCurrent : p.current), color: "var(--so-chart-3)" }, ...(analysis.selection.comparison !== "none" ? [{ key: "previous", name: analysis.selection.comparison === "year" ? "Year ago" : "Previous", values: analysis.series.map(p => matched ? p.comparablePrevious : p.previous), color: "var(--color-text-secondary)", dash: "5 6", baseline: true }] : [])];
  }
  function fullTrendScale() {
    const periods = state.snapshot.periods, full = M.analyze(state.snapshot, { ...filters(), start: periods[0].date, end: periods.at(-1).date, coverage: "available" });
    const values = trendSeries(full, $("trendMode").value).flatMap(s => s.values).filter(Number.isFinite);
    return { min: Math.min(0, ...values), max: Math.max(1, ...values) * 1.12 };
  }
  function sampleSegments(samples) {
    const segments = []; let segment = [];
    for (const sample of samples) {
      const last = segment.at(-1);
      if (last && Date.parse(sample.date) - Date.parse(last.date) > 7 * 86400000) { segments.push(segment); segment = []; }
      if (Number.isFinite(sample.y)) segment.push(sample);
      else if (segment.length) { segments.push(segment); segment = []; }
    }
    if (segment.length) segments.push(segment);
    return segments;
  }
  function renderWeekValues(date) {
    const el = $("markerReadout"); if (!el || !state.analysis) return;
    const observation = M.weekObservation(state.analysis, date);
    if (!observation.date) { el.innerHTML = ""; return; }
    const signature = JSON.stringify([observation.date, Boolean(state.markerDate), observation.retailers.map(r => [r.key, r.current])]);
    if (el.dataset.observation === signature) return;
    el.dataset.observation = signature;
    el.setAttribute("aria-label", `Reported retailer units for ${day(observation.date, true)}${state.markerDate ? ", pinned on chart" : ""}`);
    el.innerHTML = `<div class="so-marker-caption"><span>${day(observation.date, true)}${state.markerDate ? " · pinned" : ""}</span>${state.markerDate ? '<button id="clearMarker" type="button" aria-label="Clear pinned week">×</button>' : ""}</div><div class="so-week-retailers">${observation.retailers.map(retailer => `<div class="so-week-value"><span>${esc(retailer.name)}</span><strong class="${retailer.current < 0 ? "so-negative" : ""}">${fmt(retailer.current)}</strong></div>`).join("")}</div>`;
    if ($("clearMarker")) $("clearMarker").onclick = () => { state.markerDate = null; state.hoverDate = null; renderTrend(); };
  }
  const trendMotionKeys = new Set();
  function renderTrend() {
    const a = state.analysis, mode = $("trendMode").value;
    app.querySelectorAll("[data-trend]").forEach(button => button.setAttribute("aria-pressed", button.dataset.trend === mode));
    if (!a.series.length) { root.PPCSelloutMotion.reset(); trendMotionKeys.clear(); noChart("trendChart", "No reported weeks in this selection."); $("trendLegend").innerHTML = ""; return; }
    let series = trendSeries(a, mode);

    $("trendLegend").innerHTML = series.map(s => '<button type="button" title="' + esc(s.name + (s.sku ? ' · ' + s.sku : '')) + '" aria-label="Toggle ' + esc(s.name + (s.sku ? ' · ' + s.sku : '')) + '" aria-pressed="' + !state.hiddenSeries.has(s.key) + '" data-series="' + esc(s.key) + '"><span class="so-swatch" style="background:' + s.color + '"></span>' + esc(limited(s.name, 28)) + (s.sku ? '<small>' + esc(s.sku) + '</small>' : '') + '</button>').join("");
    $("trendLegend").querySelectorAll("button").forEach(b => b.onclick = () => { state.hiddenSeries.has(b.dataset.series) ? state.hiddenSeries.delete(b.dataset.series) : state.hiddenSeries.add(b.dataset.series); renderTrend(); });
    series = series.filter(s => !state.hiddenSeries.has(s.key));
    const f = svgFrame("trendChart", 370, "Weekly net sell-out units by reporting date"), left = 50, right = f.w - 12, top = 20, bottom = 328;
    const values = series.flatMap(s => s.values).filter(Number.isFinite), scale = playbackScale || { min: Math.min(0, ...values), max: Math.max(1, ...values) * 1.12 }, { min, max } = scale;
    const firstDate = a.series[0].date, lastDate = a.series.at(-1).date, first = Date.parse(firstDate), span = Date.parse(lastDate) - first;
    const xDate = date => span ? left + (Date.parse(date) - first) / span * (right - left) : (left + right) / 2;
    const x = i => xDate(a.series[i].date), y = v => bottom - (v - min) / (max - min || 1) * (bottom - top);
    let content = f.begin + '<defs><clipPath id="soPlotClip"><rect x="' + left + '" y="' + (top - 5) + '" width="' + (right - left) + '" height="' + (bottom - top + 10) + '"/></clipPath>';
    series.forEach((s, i) => { content += '<linearGradient id="soArea' + i + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + s.color + '" stop-opacity="' + (mode === 'total' ? '.18' : '.07') + '"/><stop offset="1" stop-color="' + s.color + '" stop-opacity="0"/></linearGradient>'; });
    content += '</defs>';
    for (let i = 0; i < 5; i++) { const val = min + (max - min) * i / 4, yy = y(val); content += '<line class="so-grid-line" x1="' + left + '" x2="' + right + '" y1="' + yy + '" y2="' + yy + '"/>' + txt(left - 10, yy + 4, short(val), 'text-anchor="end"'); }
    content += txt(left, 9, "Net units", 'class="so-axis-title"');
    const tickCount = Math.min(f.w < 380 ? 4 : 6, a.series.length);
    for (let i = 0; i < tickCount; i++) { const idx = tickCount === 1 ? 0 : Math.round(i * (a.series.length - 1) / (tickCount - 1)); content += txt(x(idx), bottom + 23, day(a.series[idx].date), 'text-anchor="' + (i === 0 ? 'start' : i === tickCount - 1 ? 'end' : 'middle') + '"'); }
    content += txt((left + right) / 2, 367, "Reporting week", 'text-anchor="middle" class="so-axis-title"');
    content += '<g clip-path="url(#soPlotClip)"><g id="soTrendSurface" data-origin="' + ((left + right) / 2) + '">';
    series.forEach((s, i) => { content += (!s.baseline ? '<path data-area="' + esc(s.key) + '" fill="url(#soArea' + i + ')"/>' : '') + '<path data-line="' + esc(s.key) + '" fill="none" stroke="' + s.color + '" stroke-width="' + (mode === 'total' && !s.baseline ? 2.6 : 2) + '" stroke-linecap="round" stroke-linejoin="round"' + (s.dash ? ' stroke-dasharray="' + s.dash + '"' : '') + '/><g data-dots="' + esc(s.key) + '"></g>'; });
    content += '<g id="soPinnedMark" clip-path="url(#soPlotClip)" style="pointer-events:none"></g><line id="soTrendGuide" x1="0" x2="0" y1="' + top + '" y2="' + bottom + '" stroke="var(--color-border-strong)" visibility="hidden"/><g id="soTrendDots" style="pointer-events:none"></g></g></g><rect id="soTrendHit" x="' + left + '" y="' + top + '" width="' + (right - left) + '" height="' + (bottom - top) + '" fill="transparent" tabindex="0" role="slider" aria-label="Pin or drag a reporting-week marker" aria-valuemin="0" aria-valuemax="' + (a.series.length - 1) + '" aria-valuenow="' + (a.series.length - 1) + '" style="cursor:crosshair"/></svg>';
    f.el.innerHTML = content;
    if (chartSpring) paintChartSpring(chartSpring.inspect());
    const activeKeys = new Set(series.map(s => mode + ':' + s.key));
    for (const key of trendMotionKeys) if (!activeKeys.has(key)) { root.PPCSelloutMotion.reset(key); trendMotionKeys.delete(key); }
    const displayedSeries = new Map(); let repaintPinned = null;
    series.forEach(s => {
      const key = mode + ':' + s.key, samples = a.series.map((p, i) => ({ date: p.date, x: x(i), y: Number.isFinite(s.values[i]) ? y(s.values[i]) : null }));
      const path = f.el.querySelector('[data-line="' + CSS.escape(s.key) + '"]'), area = f.el.querySelector('[data-area="' + CSS.escape(s.key) + '"]'), dots = f.el.querySelector('[data-dots="' + CSS.escape(s.key) + '"]');
      trendMotionKeys.add(key);
      root.PPCSelloutMotion.transition(key, samples, {
        domain: { start: firstDate, end: lastDate, left, right }, baseline: y(0), duration: playing ? 275 : state.brushing ? 150 : 420, reducedMotion: reduced(),
        onFrame: frame => {
          if (!path.isConnected) return;
          const segments = sampleSegments(frame.samples), paths = segments.map(segment => linePath(segment.map(p => p.y), i => segment[i].x, v => v));
          path.setAttribute('d', paths.join(' '));
          if (area) area.setAttribute('d', segments.map((segment, i) => paths[i] + 'L' + segment.at(-1).x + ',' + frame.baseline + 'L' + segment[0].x + ',' + frame.baseline + 'Z').join(' '));
          dots.innerHTML = a.series.length < 18 ? frame.samples.filter(p => Number.isFinite(p.y)).map(p => '<circle data-date="' + p.date + '" cx="' + p.x + '" cy="' + p.y + '" r="2.7" fill="' + s.color + '"/>').join('') : '';
          displayedSeries.set(s.key, frame.samples); if (state.markerDate && repaintPinned) repaintPinned(true);
        }
      });
    });
    const hit = f.el.querySelector("#soTrendHit");
    let markerPointer = null;
    const pointerIndex = e => {
      const r = f.el.querySelector("svg").getBoundingClientRect(), mouse = (e.clientX - r.left) * f.w / r.width;
      const pose = chartSpring?.inspect() || { x: 0, stretch: 0 }, origin = (left + right) / 2, local = origin + (mouse - origin - pose.x) / (1 + pose.stretch);
      const displayed = displayedSeries.get(series[0]?.key), position = date => displayed?.find(p => p.date === date)?.x ?? xDate(date);
      return a.series.reduce((best, p, i) => Math.abs(position(p.date) - local) < Math.abs(position(a.series[best].date) - local) ? i : best, 0);
    };
    const paintPinned = (geometryOnly = false) => {
      const group = f.el.querySelector("#soPinnedMark");
      if (!state.markerDate) { group.innerHTML = ""; if (!geometryOnly) renderWeekValues(state.hoverDate); return; }
      const observation = M.weekObservation(a, state.markerDate); state.markerDate = observation.date;
      const index = observation.index, points = series.map(s => ({ series: s, point: displayedSeries.get(s.key)?.find(p => p.date === observation.date) })).filter(p => p.point && Number.isFinite(p.point.y));
      const xx = points[0]?.point.x ?? x(index);
      group.innerHTML = `<line x1="${xx}" x2="${xx}" y1="${top}" y2="${bottom}" stroke="var(--color-text)" stroke-width="1.3" opacity=".65"/>${points.map(({ series: s, point }) => `<circle cx="${point.x}" cy="${point.y}" r="5.2" fill="${s.color}" stroke="var(--color-page)" stroke-width="2"/>`).join("")}`;
      hit.setAttribute("aria-valuenow", index); hit.setAttribute("aria-valuetext", day(observation.date, true)); if (!geometryOnly) renderWeekValues(observation.date);
    };
    const pin = index => { state.markerDate = a.series[index].date; state.hoverDate = null; paintPinned(); };
    const hover = e => {
      const index = pointerIndex(e);
      if (markerPointer === e.pointerId) pin(index);
      state.hoverDate = a.series[index].date;
      if (!state.markerDate) renderWeekValues(state.hoverDate);
      const guide = f.el.querySelector("#soTrendGuide"); guide.setAttribute("x1", x(index)); guide.setAttribute("x2", x(index)); guide.setAttribute("visibility", "visible");
      f.el.querySelector("#soTrendDots").innerHTML = series.filter(s => Number.isFinite(s.values[index])).map(s => '<circle cx="' + x(index) + '" cy="' + y(s.values[index]) + '" r="4" fill="' + s.color + '"/>').join("");
      showTip('<strong>' + day(a.series[index].date, true) + '</strong>' + series.map(s => '<div class="so-tooltip-row"><span>' + esc(s.name + (s.sku ? ' · ' + s.sku : '')) + '</span><b>' + fmt(s.values[index]) + '</b></div>').join('') + '<p>' + fmt(a.series[index].current) + ' total reported · ' + a.series[index].observedRows + '/' + a.series[index].totalRows + ' rows' + (mode === 'total' && a.series[index].comparisonDate ? '<br>Baseline ' + day(a.series[index].comparisonDate, true) : '') + '</p>', e.clientX, e.clientY);
    };
    hit.onpointermove = hover;
    hit.onpointerdown = e => { if (e.button !== 0 || e.isPrimary === false) return; stopTimeline({ refit: false }); markerPointer = e.pointerId; hit.setPointerCapture(e.pointerId); pin(pointerIndex(e)); hover(e); e.preventDefault(); };
    const finishMarker = e => { if (markerPointer !== e.pointerId) return; if (e.type !== "pointercancel") pin(pointerIndex(e)); markerPointer = null; if (hit.hasPointerCapture(e.pointerId)) hit.releasePointerCapture(e.pointerId); };
    hit.onpointerup = finishMarker; hit.onpointercancel = finishMarker;
    hit.onpointerleave = () => { if (markerPointer !== null) return; state.hoverDate = null; $("chartTooltip").hidden = true; f.el.querySelector("#soTrendGuide").setAttribute("visibility", "hidden"); f.el.querySelector("#soTrendDots").innerHTML = ""; renderWeekValues(state.markerDate); };
    hit.onkeydown = e => { if (!["ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "].includes(e.key)) return; e.preventDefault(); stopTimeline({ refit: false }); const current = M.weekObservation(a, state.markerDate || state.hoverDate).index, next = e.key === "Home" ? 0 : e.key === "End" ? a.series.length - 1 : current + (e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0); pin(Math.max(0, Math.min(a.series.length - 1, next))); };
    repaintPinned = paintPinned; paintPinned();
    $("trendFoot").textContent = a.totals.comparisonComplete && mode === 'total' ? 'Current and baseline lines use matching retailer-SKU observations.' : 'Each line retains reported values and missing-week gaps.';
  }
  function renderMix() {
    root.PPCSelloutMix.render($("mixChart"), $("mixLegend"), {
      categories: state.analysis.categories, palette: colors, reducedMotion: reduced(), showTip,
      hideTip: () => { $("chartTooltip").hidden = true; },
      onSelect: key => { stopTimeline(); $("categoryFilter").value = $("categoryFilter").value === key ? "" : key; update(true); }
    });
  }
  function renderBars(id, entries, paired, clickable) {
    entries = entries.map(entry => ({ ...entry, reportedCurrent: entry.current, current: paired ? entry.comparableCurrent : entry.current, previous: paired ? entry.comparablePrevious : entry.previous })).sort((a, b) => (b.current ?? -Infinity) - (a.current ?? -Infinity));
    entries = entries.filter(e => Number.isFinite(e.current)).slice(0, 7);
    if (!entries.length) return noChart(id, "No reported quantities in this selection.");
    const f = svgFrame(id, entries.length * 47 + 53, (paired ? "Matched net units" : "Reported net units") + " by " + (id === "storeChart" ? "retailer" : "SKU")), labelW = Math.min(f.w * .42, 200), left = labelW, right = f.w - 49;
    const max = Math.max(1, ...entries.flatMap(e => [e.current, paired ? e.previous || 0 : 0])), min = Math.min(0, ...entries.flatMap(e => [e.current, paired ? e.previous || 0 : 0])), scale = v => left + (v - min) / (max - min) * (right - left), zero = scale(0);
    let html = f.begin;
    entries.forEach((e, i) => { const yy = 19 + i * 47, label = niceName(e.name), tip = `<strong>${esc(e.name)}</strong><p>${e.sku ? esc(e.sku) + "<br>" : ""}${paired ? "Matched current" : "Reported net units"}: ${fmt(e.current)}${paired ? `<br>Matched baseline: ${fmt(e.previous)}<br>Paired change: ${pct(e.growth)}<br>All reported units: ${fmt(e.reportedCurrent)}` : ""}<br>${e.observedWeeks} reported weeks</p>`; html += txt(left - 10, yy + 13, limited(label, Math.floor(labelW / 6.2)), 'text-anchor="end"') + rect(Math.min(zero, scale(e.current)), yy + 1, Math.abs(scale(e.current) - zero), paired ? 12 : 20, e.current < 0 ? "var(--so-negative)" : "var(--color-text-secondary)", `rx="3" class="so-bar-mark" data-bar-key="${esc(e.key)}:current"`); if (paired && Number.isFinite(e.previous)) html += rect(Math.min(zero, scale(e.previous)), yy + 18, Math.abs(scale(e.previous) - zero), 7, "var(--color-text-secondary)", `rx="2" opacity=".5" class="so-bar-mark" data-bar-key="${esc(e.key)}:previous"`); html += txt(Math.max(zero, scale(e.current)) + 8, yy + 13, short(e.current), 'class="so-direct-value"') + rect(0, yy - 4, f.w, 38, "transparent", `data-tip="${esc(tip)}" ${clickable ? `data-sku="${esc(e.sku)}" style="cursor:pointer"` : ""} tabindex="0"`); });
    for (let i = 0; i < 3; i++) { const value = min + (max - min) * i / 2; html += txt(scale(value), f.h - 22, short(value), 'text-anchor="middle"'); }
    html += txt((left + right) / 2, f.h - 3, paired ? "Matched units · current / baseline" : "Reported net units", 'text-anchor="middle" class="so-axis-title"') + "</svg>";
    f.el.innerHTML = html; attachTips(f.el); animateMarks(f.el);
    f.el.querySelectorAll("[data-sku]").forEach(r => { const go = () => focusSku(r.dataset.sku); r.onclick = go; r.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } }; });
  }
  function renderGrowth() {
    const a = state.analysis, entries = [...a.movers.gainers.slice(0, 4), ...a.movers.decliners.slice(0, 4)].sort((a, b) => b.delta - a.delta);
    if (!entries.length) return noChart("growthChart", "<div><strong>Comparison unavailable</strong>Select a period with reported baseline observations.</div>");
    const f = svgFrame("growthChart", entries.length * 38 + 48, "Paired net unit change by SKU"), left = Math.min(190, f.w * .4), right = f.w - 64;
    const max = Math.max(1, ...entries.map(e => Math.abs(e.delta))), zero = left + (right - left) / 2, scale = v => zero + v / max * (right - left) / 2;
    let html = f.begin + `<line x1="${zero}" x2="${zero}" y1="5" y2="${f.h - 40}" stroke="var(--color-border-strong)"/>`;
    entries.forEach((e, i) => { const yy = 12 + i * 38; html += txt(left - 10, yy + 13, limited(niceName(e.name), Math.floor(left / 6.2)), 'text-anchor="end"') + rect(Math.min(zero, scale(e.delta)), yy, Math.abs(scale(e.delta) - zero), 20, e.delta >= 0 ? "var(--color-text-secondary)" : "var(--so-negative)", `rx="3" class="so-bar-mark" data-tip="${esc(`<strong>${esc(e.name)}</strong><p>${e.delta > 0 ? "+" : ""}${fmt(e.delta)} paired units · ${pct(e.growth)}<br>${fmt(e.comparableCurrent)} vs ${fmt(e.comparablePrevious)}<br>${e.pairedCells} matched observations</p>`)}" tabindex="0"`) + txt(f.w - 2, yy + 14, `${e.delta > 0 ? "+" : ""}${short(e.delta)}`, 'text-anchor="end" class="so-direct-value"'); });
    html += txt(zero, f.h - 5, "Change in paired net units", 'text-anchor="middle" class="so-axis-title"') + "</svg>"; f.el.innerHTML = html; attachTips(f.el); animateMarks(f.el);
  }
  function renderMomentum() {
    const data = state.analysis.products.filter(p => Number.isFinite(p.growth) && p.current > 0);
    if (!data.length) return noChart("momentumChart", "<div><strong>No comparable SKU baselines</strong>Growth requires matching reports and a positive baseline.</div>");
    const f = svgFrame("momentumChart", 298, "SKU net units against paired growth percent"), left = 58, right = f.w - 18, top = 20, bottom = 244;
    const maxUnits = Math.max(1, ...data.map(p => p.current)) * 1.12, low = Math.min(-.1, ...data.map(p => p.growth)), high = Math.max(.1, ...data.map(p => p.growth));
    const transform = v => Math.sign(v) * Math.log1p(Math.abs(v) * 100), inverse = v => Math.sign(v) * Math.expm1(Math.abs(v)) / 100;
    const x = v => left + v / maxUnits * (right - left), y = v => bottom - (transform(v) - transform(low)) / (transform(high) - transform(low) || 1) * (bottom - top);
    let html = f.begin + `<defs><pattern id="soMomentumDots" x="${left}" y="${top}" width="19" height="19" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="var(--color-text-secondary)" opacity=".22"/></pattern></defs><rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" fill="url(#soMomentumDots)" stroke="none" aria-hidden="true"/>`;
    for (let i = 0; i < 4; i++) { const v = inverse(transform(low) + (transform(high) - transform(low)) * i / 3), yy = y(v); html += txt(left - 8, yy + 4, `${short(v * 100)}%`, 'text-anchor="end"'); }
    if (low < 0 && high > 0) html += `<line x1="${left}" x2="${right}" y1="${y(0)}" y2="${y(0)}" stroke="var(--color-text-secondary)" opacity=".45" stroke-dasharray="1 6" stroke-linecap="round"/>`;
    data.forEach(p => { html += `<circle cx="${x(p.current)}" cy="${y(p.growth)}" r="5" fill="${p.growth >= 0 ? "var(--color-text-secondary)" : "var(--so-negative)"}" opacity=".72"/><circle cx="${x(p.current)}" cy="${y(p.growth)}" r="14" fill="transparent" data-tip="${esc(`<strong>${esc(niceName(p.name))}</strong><p>${esc(p.sku)}<br>${fmt(p.current)} net units<br>${pct(p.growth)} paired growth<br>${p.pairedCells} matched observations</p>`)}" tabindex="0"/>`; });
    for (let i = 0; i < 3; i++) html += txt(x(maxUnits * i / 2), bottom + 22, short(maxUnits * i / 2), 'text-anchor="middle"');
    html += txt(left, 9, "Paired growth (%) · compressed scale", 'class="so-axis-title"') + txt((left + right) / 2, 286, "Net sell-out units", 'class="so-axis-title" text-anchor="middle"') + "</svg>";
    f.el.innerHTML = html; attachTips(f.el);
  }
  function matrices() {
    const a = state.analysis, stores = a.stores.map(s => s.key), rows = a.storeProducts;
    const build = (id, groups, key) => {
      const cells = groups.map(group => stores.map(store => { const members = rows.filter(r => r.store === store && key(r) === group); return { members, value: M.sum(members.map(r => r.current)) }; }));
    const max = Math.max(1, ...cells.flat().map(c => c.value || 0));
      $(id).innerHTML = `<table><thead><tr><th>${key === categoryKey ? "Category" : "USD MSRP"}</th>${stores.map(s => `<th>${esc(s)}</th>`).join("")}</tr></thead><tbody>${groups.map((g, i) => `<tr><th>${esc(g)}</th>${cells[i].map((c, j) => { const denom = M.sum(cells[i].map(v => v.value)), share = c.value !== null && denom > 0 ? c.value / denom * 100 : null, shade = matrixCellAppearance(c.value, max), tip = `<strong>${esc(stores[j])} · ${esc(g)}</strong><p>${fmt(c.value)} net units<br>${share === null ? "Share unavailable" : `${share.toFixed(1)}% of selected ${key === categoryKey ? "category" : "band"} units`}<br>${c.members.length} retailer-SKU rows${c.members.length ? "" : " · no source rows in this selection"}</p>`; return `<td><button type="button" data-matrix-store="${esc(stores[j])}" ${key === categoryKey ? `data-matrix-category="${esc(g)}"` : `data-matrix-band="${esc(g)}"`} style="background:${shade.background};color:${shade.color}" data-tip="${esc(tip)}" aria-label="${esc(stores[j])}, ${esc(g)}, ${fmt(c.value)} net units. Filter this cell."><span class="so-cell-value">${fmt(c.value)}</span></button></td>`; }).join("")}</tr>`).join("")}</tbody></table>`;
      attachTips($(id));
      $(id).querySelectorAll("button").forEach(b => b.onclick = () => { state.stores = [b.dataset.matrixStore]; state.storesNone = false; if (b.dataset.matrixCategory) $("categoryFilter").value = b.dataset.matrixCategory; else $("bandFilter").value = b.dataset.matrixBand; controls(); update(true); });
    };
    const categoryKey = r => r.category, priceKey = r => bandOf(r.sku);
    root.PPCSelloutFlow.render($("categoryMatrix"), { cells: a.storeCategories, stores: a.stores, categories: a.categories, reducedMotion: reduced(), showTip, hideTip: () => { $("chartTooltip").hidden = true; }, onSelect: ({ store, category }) => { stopTimeline(); state.stores = [store]; state.storesNone = false; $("categoryFilter").value = category; controls(); update(true); } });
    const mapped = new Set(rows.filter(r => priceOf(r.sku) !== null).map(r => r.sku));
    $("priceCoverage").textContent = `${mapped.size} / ${a.products.length} selected SKUs mapped · USD MSRP`;
    if (!mapped.size) noChart("priceMatrix", "<div><strong>Price map needed</strong>The workbook contains no prices.<br>Add USD MSRP to compare retailer impact by band.</div>");
    else build("priceMatrix", bandNames.filter(b => rows.some(r => bandOf(r.sku) === b)), priceKey);
  }
  function renderQuarters() {
    const a = state.analysis, years = [...new Set(state.snapshot.periods.map(p => p.quarter.match(/^FY(\d+)Q[1-4]$/)?.[1]).filter(Boolean))].sort((a, b) => Number(a) - Number(b)).slice(-2);
    if (!years.length) return noChart("quarterChart", "Fiscal-quarter labels are unavailable in this source.");
    const latestYear = Number(years.at(-1)), dateIndex = new Map(state.snapshot.periods.map((p, i) => [p.date, i]));
    const f = svgFrame("quarterChart", 270, `${years.map(y => "FY" + y).join(" and ")} reported units for matching fiscal weeks`);
    const groups = [1, 2, 3, 4].map(q => {
      const slots = [...new Set(a.periods.filter(p => p.quarter.endsWith(`Q${q}`) && /^FY\d+Q/.test(p.quarter)).map(p => M.addDays(p.date, (latestYear - Number(p.quarter.match(/^FY(\d+)/)[1])) * 364)))];
      return { q, slots, values: years.map(year => M.sum(a.rows.flatMap(r => slots.map(date => { const index = dateIndex.get(M.addDays(date, -(latestYear - Number(year)) * 364)); return index !== undefined && state.snapshot.periods[index].quarter === `FY${year}Q${q}` ? r.values[index] : null; })))) };
    }).filter(q => q.slots.length);
    if (!groups.length) return noChart("quarterChart", "No fiscal weeks selected.");
    const left = 50, right = f.w - 15, top = 26, bottom = 224, max = Math.max(1, ...groups.flatMap(g => g.values.filter(Number.isFinite))) * 1.18, min = Math.min(0, ...groups.flatMap(g => g.values.filter(Number.isFinite))), y = v => bottom - (v - min) / (max - min) * (bottom - top);
    let html = f.begin;
    for (let i = 0; i < 4; i++) { const val = min + (max - min) * i / 3; html += `<line class="so-grid-line" x1="${left}" x2="${right}" y1="${y(val)}" y2="${y(val)}"/>` + txt(left - 7, y(val) + 4, short(val), 'text-anchor="end"'); }
    groups.forEach((g, i) => { const center = left + (right - left) * (i + .5) / groups.length, bw = Math.min(28, (right - left) / groups.length * .23); g.values.forEach((v, year) => { if (v === null) return; const xx = center + (years.length === 1 ? -bw / 2 : year ? 3 : -bw - 3); html += rect(xx, Math.min(y(v), y(0)), bw, Math.abs(y(0) - y(v)), v < 0 ? "var(--so-negative)" : year === years.length - 1 ? "var(--color-text)" : "var(--color-text-secondary)", `rx="3" opacity="${year === years.length - 1 ? 1 : .65}" class="so-bar-mark" data-tip="${esc(`<strong>FY${years[year]} Q${g.q}</strong><p>${fmt(v)} units<br>${g.slots.length} same fiscal-week slots selected<br>Reported observations only</p>`)}" tabindex="0"`); }); html += txt(center, bottom + 22, `Q${g.q}`, 'text-anchor="middle"'); });
    html += txt(left, 12, "Net units", 'class="so-axis-title"') + txt((left + right) / 2, 268, "Fiscal quarter", 'class="so-axis-title" text-anchor="middle"') + "</svg>"; f.el.innerHTML = html; attachTips(f.el); animateMarks(f.el);
    $("quarterFoot").innerHTML = years.map((year, i) => `<span class="so-swatch" style="background:${i === years.length - 1 ? "var(--color-text)" : "var(--color-text-secondary)"}"></span> FY${year}`).join(" ") + " · Same fiscal-week slots, reported totals. Missing cells can differ.";
  }
  function matrixCellAppearance(value, maximum) {
    const negative = Number.isFinite(value) && value < 0;
    const intensity = value > 0 ? .1 + .68 * Math.sqrt(value / Math.max(1, maximum)) : .035;
    return {
      background: `color-mix(in srgb,${negative ? "var(--so-negative)" : "var(--color-text-secondary)"} ${negative ? 18 : intensity * 100}%,transparent)`,
      color: negative ? "var(--so-negative)" : intensity > .43 ? "var(--so-bg)" : "var(--so-text)"
    };
  }
  function renderHeat() {
    const a = state.analysis;
    if (!a.periods.length || !a.heatmap.length) return noChart("heatChart", "No reporting periods selected.");
    const rows = [...a.heatmap].sort((a, b) => a.store.localeCompare(b.store)), el = $("heatChart");
    const maximum = Math.max(1, ...rows.flatMap(r => r.values).filter(Number.isFinite));
    const weekTip = index => `<strong>${day(a.periods[index].date, true)}</strong>${rows.map(r => `<div class="so-tooltip-row"><span>${esc(r.store)}</span><b>${r.values[index] === null ? "Missing" : fmt(r.values[index])}</b></div>`).join("")}<p>Net units · Click to pin week</p>`;
    el.innerHTML = `<table style="--so-report-weeks:${a.periods.length}" aria-label="Weekly net reporting quantities by retailer. Lighter shades mean more positive net units on a shared scale. A dash means missing; zero remains reported; negative adjustments use the alert color."><colgroup><col class="so-report-label-column">${a.periods.map(() => "<col>").join("")}</colgroup><thead><tr><th scope="col">Week</th>${a.periods.map(p => { const [month, date] = day(p.date).split(" "); return `<th scope="col" aria-label="${day(p.date, true)}"><span>${month}</span><small>${date}</small></th>`; }).join("")}</tr></thead><tbody>${rows.map((r, j) => `<tr><th scope="row">${esc(r.store)}</th>${r.values.map((value, i) => {
      const shade = matrixCellAppearance(value, maximum), description = value === null ? "Missing report" : `${fmt(value)} net units`;
      return `<td><button type="button" data-report-date="${a.periods[i].date}" data-report-row="${j}" data-report-index="${i}" data-value="${value === null ? "" : value}" data-zero="${value === 0}" data-missing="${value === null}" style="background:${value === null ? "transparent" : shade.background};color:${shade.color}" data-tip="${esc(weekTip(i))}" aria-label="${esc(r.store)}, ${day(a.periods[i].date, true)}, ${description}. Pin this reporting week on the chart.">${value === null ? '<span class="so-report-missing">—</span>' : `<span class="so-cell-value">${short(value)}</span>`}</button></td>`;
    }).join("")}</tr>`).join("")}</tbody></table>`;
    attachTips(el);
    const emphasize = date => el.querySelectorAll("[data-report-date]").forEach(cell => cell.classList.toggle("is-active-week", cell.dataset.reportDate === date));
    el.querySelectorAll("[data-report-date]").forEach(cell => {
      cell.addEventListener("pointerenter", () => emphasize(cell.dataset.reportDate));
      cell.addEventListener("focus", () => emphasize(cell.dataset.reportDate));
      cell.addEventListener("pointerleave", () => emphasize(null));
      cell.addEventListener("blur", () => emphasize(null));
      cell.onclick = () => { stopTimeline({ refit: false }); state.markerDate = cell.dataset.reportDate; state.hoverDate = null; showView("overview"); };
      cell.onkeydown = e => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        const row = Number(cell.dataset.reportRow), index = Number(cell.dataset.reportIndex), nextRow = Math.max(0, Math.min(rows.length - 1, row + (e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0))), nextIndex = Math.max(0, Math.min(a.periods.length - 1, e.key === "Home" ? 0 : e.key === "End" ? a.periods.length - 1 : index + (e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0)));
        const next = el.querySelector(`[data-report-row="${nextRow}"][data-report-index="${nextIndex}"]`);
        next.focus({ preventScroll: true }); next.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
      };
    });
  }
  function insights() {
    const top = state.analysis.top.product;
    $("insights").innerHTML = top ? `<span><i class="so-dot"></i><strong>${esc(niceName(top.name))}</strong> leads this view</span><button type="button" id="exploreLeader">Explore ↗</button>` : '<span>No reported units in this window</span>';
    if (top) $("exploreLeader").onclick = () => { focusSku(top.sku); };
  }
  function planning() {
    const a = state.analysis, market = $("marketStore").value, data = a.storeProducts.filter(r => !market || r.store === market), candidates = [];
    const add = (key, label, title, text, evidence, extra = {}) => candidates.push({ key, label, title, text, evidence, ...extra });
    [...data].filter(r => r.current > 0).sort((a, b) => b.current - a.current).slice(0, 2).forEach(r => add(`scale:${r.key}`, "MARKET PLAYBOOK", `Review volume leader ${niceName(r.product)} at ${r.store}`, "Use this reported volume signal in retailer sell-in. Validate stock, listing content and promo readiness, then carry the SKU evidence into the market plan.", `${r.sku} · ${fmt(r.current)} units · ${pct(r.growth)} paired change · ${r.observedWeeks}/${a.periods.length} reported weeks`, { sku: r.sku, store: r.store, category: r.category }));
    [...data].filter(r => r.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 2).forEach(r => add(`review:${r.key}`, "SKU REVIEW", `Investigate ${niceName(r.product)} at ${r.store}`, "Check inventory, price position, listing execution and lifecycle. Use the evidence to decide between support, repositioning and a roadmap successor.", `${r.sku} · ${fmt(r.delta)} paired units · ${pct(r.growth)} change · ${r.pairedCells} matched observations`, { sku: r.sku, store: r.store, category: r.category }));
    const targetStores = a.stores.filter(s => !market || s.key === market);
    for (const category of a.categories.filter(c => c.current > 0).slice(0, 6)) {
      const leader = a.storeCategories.filter(r => r.category === category.key && r.current > 0).sort((a, b) => b.current - a.current)[0];
      const absent = targetStores.find(store => !data.some(r => r.store === store.key && r.category === category.key && r.current > 0));
      if (leader && absent && leader.store !== absent.key) add(`gap:${absent.key}:${category.key}`, "PORTFOLIO GAP HYPOTHESIS", `Review ${category.key} at ${absent.key}`, `Benchmark ${leader.store}'s category mix, then validate the target retailer's assortment and consumer demand. The sell-out source alone cannot establish an unmet market need.`, `${leader.store}: ${fmt(leader.current)} units · ${absent.key}: no positive units in the selected source rows`, { store: absent.key, category: category.key });
      if (candidates.length >= 7) break;
    }
    const pricesMapped = new Set(a.rows.filter(r => priceOf(r.sku) !== null).map(r => r.sku));
    if (pricesMapped.size < a.products.length) add("price-map", "PRICE POSITIONING", "Complete the MSRP evidence", "Add USD MSRP / list prices and their sources. Then compare category and price-band strengths before proposing gaps for PPC product planning.", `${pricesMapped.size} of ${a.products.length} selected SKUs have USD MSRP`);
    if (!candidates.length) add("coverage", "SOURCE FOLLOW-UP", "Resolve the reporting gap", "Request the missing retailer-SKU observations before concluding that a product is underperforming.", `${a.totals.numericCells} reported cells · ${a.totals.missingCells} missing cells`);
    state.candidates = candidates.slice(0, 8);
    $("planningCards").innerHTML = state.candidates.map(c => { const selected = state.shortlist.some(s => s.key === c.key); return `<article class="so-plan-card ${selected ? "is-selected" : ""}"><p class="so-eyebrow">${esc(c.label)}</p><h3>${esc(c.title)}</h3><p>${esc(c.text)}</p><p class="so-evidence">${esc(c.evidence)}</p><button type="button" data-shortlist="${esc(c.key)}" aria-pressed="${selected}">${selected ? "Remove from shortlist" : "Add to PPC planning shortlist"}</button></article>`; }).join("");
    $("shortlistCount").textContent = `${state.shortlist.length} ${state.shortlist.length === 1 ? "opportunity" : "opportunities"} shortlisted`;
    renderShortlist();
    $("planningCards").querySelectorAll("button").forEach(b => b.onclick = async () => { const existing = state.shortlist.find(s => s.key === b.dataset.shortlist); if (existing) state.shortlist = state.shortlist.filter(s => s.key !== b.dataset.shortlist); else state.shortlist.push({ ...state.candidates.find(s => s.key === b.dataset.shortlist), period: { ...a.selection, priceBand: $("bandFilter").value || "All" }, sourceTitle: state.snapshot.title, addedAt: new Date().toISOString() }); planning(); await persist(); });
  }
  function renderShortlist() {
    $("shortlistReviewCount").textContent = `${state.shortlist.length} saved`;
    $("shortlistEditor").innerHTML = state.shortlist.map((c, i) => `<article class="so-shortlist-row"><h3>${esc(c.title)}</h3><p>${esc(c.evidence)}</p><p>Saved period: ${esc(c.period?.start || "n.a.")} – ${esc(c.period?.end || "n.a.")} · ${esc(c.sourceTitle || "Imported source")}</p><div class="so-shortlist-fields"><label>Owner<input type="text" maxlength="120" data-plan-field="owner" data-plan-index="${i}" value="${esc(c.owner || "")}" placeholder="Assign an owner"></label><label>Proposed roadmap month<input type="month" data-plan-field="targetMonth" data-plan-index="${i}" value="${esc(/^\d{4}-\d{2}$/.test(c.targetMonth || "") ? c.targetMonth : "")}"></label><label>Validation / next step<textarea maxlength="2000" data-plan-field="notes" data-plan-index="${i}" placeholder="Availability, price position, market follow-up…">${esc(c.notes || "")}</textarea></label><button type="button" data-remove-plan="${i}">Remove</button></div></article>`).join("") || '<p class="so-shortlist-intro">Add an opportunity from the cards above to prepare your PPC planning brief.</p>';
    $("shortlistEditor").querySelectorAll("[data-plan-field]").forEach(input => input.onchange = async () => { state.shortlist[Number(input.dataset.planIndex)][input.dataset.planField] = input.value; await persist(); });
    $("shortlistEditor").querySelectorAll("[data-remove-plan]").forEach(button => button.onclick = async () => { state.shortlist.splice(Number(button.dataset.removePlan), 1); planning(); await persist(); });
  }
  function table() {
    if (!state.analysis) return;
    const q = $("tableSearch").value.toLowerCase(), entries = state.analysis.storeProducts.filter(r => `${r.product} ${r.sku} ${r.store} ${r.category}`.toLowerCase().includes(q) && (!$("signalFilter").value || signal(r) === $("signalFilter").value));
    entries.sort((a, b) => { const va = a[state.sort], vb = b[state.sort]; if (typeof va === "string") return (state.descending ? -1 : 1) * va.localeCompare(vb); return (state.descending ? -1 : 1) * ((va ?? -Infinity) - (vb ?? -Infinity)); });
    state.tableEntries = entries; const pages = Math.max(1, Math.ceil(entries.length / 15)); state.page = Math.min(state.page, pages - 1);
    $("tableBody").innerHTML = entries.slice(state.page * 15, state.page * 15 + 15).map(r => `<tr><td>${esc(niceName(r.product))}<small>${esc(r.sku)}</small></td><td>${esc(r.store)}</td><td>${esc(r.category)}</td><td>${priceOf(r.sku) === null ? "Unmapped" : money.format(priceOf(r.sku))}</td><td>${fmt(r.current)}${Number.isFinite(r.growth) && r.comparableCurrent !== r.current ? `<small>${fmt(r.comparableCurrent)} matched</small>` : ""}</td><td>${state.analysis.totals.comparisonComplete && r.pairedCells ? fmt(r.comparablePrevious) : "—"}</td><td class="${r.growth > 0 ? "so-positive" : r.growth < 0 ? "so-negative" : ""}">${pct(r.growth)}</td><td>${r.observedWeeks} / ${state.analysis.periods.length}</td><td>${signal(r)}</td><td><button type="button" data-explore="${esc(r.sku)}" data-retailer="${esc(r.store)}">Explore</button></td></tr>`).join("") || '<tr><td colspan="10">No retailer-SKU records match this selection.</td></tr>';
    $("tableCount").textContent = `${entries.length} retailer-SKU rows`; $("pageLabel").textContent = `${state.page + 1} / ${pages}`; $("prevPage").disabled = state.page === 0; $("nextPage").disabled = state.page === pages - 1;
    $("tableBody").querySelectorAll("button").forEach(b => b.onclick = () => focusSku(b.dataset.explore, b.dataset.retailer));
    app.querySelectorAll("th button[data-sort]").forEach(b => { b.textContent = { product: "Product / SKU", store: "Retailer", current: "Net units", growth: "Change" }[b.dataset.sort] + (state.sort === b.dataset.sort ? state.descending ? " ↓" : " ↑" : ""); b.parentElement.setAttribute("aria-sort", state.sort === b.dataset.sort ? state.descending ? "descending" : "ascending" : "none"); });
  }
  function signal(row) { return row.current === null ? "Missing reports" : row.current < 0 ? "Negative net units" : row.current === 0 ? "Zero net units" : row.delta === null ? "No comparable baseline" : row.delta > 0 ? "Paired gain" : row.delta < 0 ? "Paired decline" : "Stable paired units"; }
  function update(resetPeriod = false) {
    if (!state.snapshot) return;
    $("chartTooltip").hidden = true;
    if (resetPeriod) applyPreset();
    if ($("startDate").value > $("endDate").value) { message("The start date must be on or before the end date.", true); return; }
    message(""); state.page = 0; state.analysis = M.analyze(state.snapshot, filters()); const a = state.analysis;
    $("dashboardContent").hidden = false; $("emptyState").hidden = true; $("exportButton").disabled = false;
    $("windowLabel").textContent = a.selection.start ? `${day(a.selection.start, true)} – ${day(a.selection.end, true)}` : "No reported weeks selected";
    $("windowDetail").textContent = `${a.periods.length} weeks · ${a.totals.stores} retailers`;
    $("sourceBadge").textContent = `Imported report · ${state.snapshot.asOf ? day(state.snapshot.asOf, true) : "date unspecified"}`;
    $("headingContext").textContent = state.storesNone ? "No retailers selected" : state.productsNone ? "No SKUs selected" : state.products.length === 1 ? `${niceName(a.products[0]?.name || state.products[0])} · ${state.products[0]}` : state.stores.length ? state.stores.join(" · ") : "All retailers";
    $("filterSummary").textContent = "";
    $("advancedCount").textContent = [$("categoryFilter").value, $("bandFilter").value].filter(Boolean).length || "";
    $("coverageNotice").textContent = a.selection.coverage === "common" ? `Shared through ${day(a.coverage.commonEnd)}` : "Available reports";
    $("coverageNotice").setAttribute("aria-label", [a.selection.coverage === "common" ? `Shared retailer cutoff ${a.coverage.commonEnd || "unavailable"}` : "Available reports may be partial", ...a.coverage.warnings].join(". "));
    const selling = a.products.filter(p => p.current > 0).length, peak = a.series.filter(p => Number.isFinite(p.current)).sort((a, b) => b.current - a.current)[0];
    const stats = [["Units", fmt(a.totals.current), `${a.periods.length} weeks`], ["Matched change", pct(a.totals.growth), Number.isFinite(a.totals.delta) ? `${a.totals.delta > 0 ? "+" : ""}${short(a.totals.delta)} units` : "Baseline unavailable"]];
    $("kpis").innerHTML = stats.map(([label, value, context], i) => `<article class="so-stat"><p class="so-stat-label">${label}</p><p class="so-stat-value ${i === 1 ? a.totals.growth > 0 ? "so-positive" : a.totals.growth < 0 ? "so-negative" : "" : ""}">${value}</p><p class="so-stat-context">${esc(context)}</p></article>`).join("") + '<div id="markerReadout" class="so-marker-readout"></div>';
    renderCharts(); if (state.view === "overview") insights(); if (state.view === "planning") planning(); if (state.view === "records") table();
    if (!state.brushing) renderTimeline();
    updatePriceStatus();
    $("sourceFooter").textContent = `${state.snapshot.title} · ${state.snapshot.sheet || "Imported table"} · Imported snapshot · Blank ≠ zero`;
    root.PPCSelloutDashboard.analysis = a;
  }
  function renderCharts() {
    if (!state.analysis) return;
    if (state.view === "overview") {
      renderTrend(); renderBars("storeChart", state.analysis.stores, state.analysis.totals.comparisonComplete, false); renderBars("productChart", state.analysis.products, false, true); renderGrowth(); renderMomentum();
      renderMix(); matrices(); renderQuarters(); renderHeat();
    }
  }
  function showView(view) {
    if (!["overview", "planning", "records"].includes(view)) return;
    stopTimeline(); state.view = view;
    app.querySelectorAll("[data-analytics-view]").forEach(el => { el.hidden = el.dataset.analyticsView !== view; el.classList.toggle("is-current", !el.hidden); });
    app.querySelectorAll(".so-sidebar nav a").forEach(a => { const current = a.hash === "#" + view; a.classList.toggle("is-active", current); if (current) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    renderCharts(); if (view === "overview") { insights(); renderTimeline(); } if (view === "planning") planning(); if (view === "records") table();
    document.documentElement.scrollTo({ top: 0, behavior: reduced() ? "instant" : "smooth" });
  }
  function timelineBounds() {
    if (!state.snapshot) return { start: 0, end: 0, limit: 0 };
    const periods = state.snapshot.periods, current = filters();
    const all = M.analyze(state.snapshot, { ...current, start: periods[0].date, end: periods.at(-1).date, comparison: "none", coverage: "available" });
    const last = current.coverage === "common" ? all.coverage.commonEnd : all.coverage.cutoffs.map(c => c.last).filter(Boolean).sort().at(-1);
    const limit = last ? Math.max(0, periods.findLastIndex(p => p.date <= last)) : periods.length - 1;
    const start = Math.max(0, Math.min(limit, periods.findIndex(p => p.date >= $("startDate").value)));
    const end = Math.max(start, Math.min(limit, periods.findLastIndex(p => p.date <= $("endDate").value)));
    timelineFull = all;
    return { start, end, limit };
  }
  function renderTimeline() {
    if (state.view !== "overview" || !state.snapshot || state.brushing) return;
    const bounds = timelineBounds(), periods = state.snapshot.periods, n = periods.length;
    const full = timelineFull, f = svgFrame("timelineChart", 84, "Full weekly reporting history"), values = periods.map(p => full.series.find(point => point.date === p.date)?.current ?? null);
    const max = Math.max(1, ...values.filter(Number.isFinite)), min = Math.min(0, ...values.filter(Number.isFinite)), x = i => n === 1 ? f.w / 2 : i / (n - 1) * f.w, y = value => 60 - (value - min) / (max - min || 1) * 53;
    let html = f.begin + `<path d="${linePath(values, x, y)}" stroke="var(--color-text-secondary)" stroke-width="1.3" fill="none" opacity=".65"/>`;
    if (bounds.limit < n - 1) html += rect(x(bounds.limit), 0, f.w - x(bounds.limit), 65, "var(--color-header)", 'opacity=".55"');
    const ticks = f.w < 450 ? 4 : 8;
    for (let i = 0; i < ticks; i++) { const index = Math.round(i / (ticks - 1) * (n - 1)), date = periods[index].date, label = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z")); html += txt(x(index), 80, label, `text-anchor="${i === 0 ? "start" : i === ticks - 1 ? "end" : "middle"}"`); }
    f.el.innerHTML = html + "</svg>";
    state.timeline = bounds; renderTimelineMonths(); paintTimeline(bounds.start, bounds.end);
  }
  function renderTimelineMonths() {
    const rail = $("timelineMonths");
    if (!rail || !state.snapshot || !state.timeline || !timelineFull) return;
    const periods = state.snapshot.periods, limit = state.timeline.limit, n = periods.length;
    const axis = index => n === 1 ? 50 : index / (n - 1) * 100;
    const width = rail.getBoundingClientRect().width;
    const reports = new Map(timelineFull.series.map(point => [point.date, point.current]));
    const hasCutoff = filters().coverage !== "common" || Boolean(timelineFull.coverage.commonEnd);
    const months = new Map();
    periods.forEach((period, index) => {
      const key = period.date.slice(0, 7);
      if (!months.has(key)) months.set(key, { key, indices: [] });
      months.get(key).indices.push(index);
    });
    const years = new Map();
    for (const month of months.values()) {
      const year = month.key.slice(0, 4);
      if (!years.has(year)) years.set(year, []);
      years.get(year).push(month);
    }
    const monthButton = (month, yearAnchor = false) => {
      const indices = month.indices.filter(index => index <= limit);
      const reportingWeeks = hasCutoff ? indices.filter(index => Number.isFinite(reports.get(periods[index].date))).length : 0;
      const start = indices[0] ?? month.indices[0], end = indices.at(-1) ?? month.indices.at(-1);
      const date = new Date(`${month.key}-01T12:00:00Z`);
      const label = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date);
      const fullLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
      const selected = reportingWeeks > 0 && state.timeline.start === start && state.timeline.end === end;
      const description = reportingWeeks ? `${fullLabel}: ${reportingWeeks} reported ${reportingWeeks === 1 ? "week" : "weeks"}` : `${fullLabel}: no reported weeks in the current scope`;
      const left = n === 1 ? 0 : Math.max(0, axis(month.indices[0] - .5)), right = n === 1 ? 100 : Math.min(100, axis(month.indices.at(-1) + .5));
      const center = axis((start + end) / 2), labelOffset = (center - left) / (right - left || 1) * 100;
      const narrow = (right - left) / 100 * width < 26;
      const yearLabel = yearAnchor ? `<span class="so-month-year-label" data-year="${month.key.slice(0, 4)}" data-month-anchor="${month.key}" aria-hidden="true">${month.key.slice(0, 4)}</span>` : "";
      return `<button class="so-month${narrow ? " is-narrow" : ""}${yearAnchor ? " is-year-anchor" : ""}" type="button" data-month="${month.key}" data-start="${start}" data-end="${end}" style="left:${left}%;width:${right - left}%;--month-label:${labelOffset}%" aria-label="${esc(description)}" aria-pressed="${selected}" title="${esc(description)}" ${reportingWeeks ? "" : "disabled"}><span class="so-month-label">${yearLabel}<span class="so-month-name">${label}</span></span></button>`;
    };
    rail.innerHTML = [...years].map(([year, entries], index) => {
      const first = entries[0].indices[0], last = entries.at(-1).indices.at(-1), position = n === 1 ? 0 : axis(first);
      const buttons = entries.map((month, monthIndex) => monthButton(month, monthIndex === 0)).join("");
      return `<div class="so-month-year-group" data-year="${year}" data-start="${first}" data-end="${last}" role="group" aria-label="${year} reporting months">${index ? `<span class="so-month-year-divider" style="left:${position}%" aria-hidden="true"></span>` : ""}<div class="so-month-year-items">${buttons}</div></div>`;
    }).join("");
    rail.querySelectorAll("[data-month]").forEach(button => button.onclick = () => {
      if (button.disabled) return;
      const month = button.dataset.month;
      stopTimeline(); $("periodPreset").value = "custom";
      setTimelineRange(Number(button.dataset.start), Number(button.dataset.end));
      rail.querySelector(`[data-month="${month}"]`)?.focus({ preventScroll: true });
    });
    const scroll = $("timelineScroll");
    if (scroll && scroll.scrollWidth - scroll.clientWidth > 1 && scroll.scrollTo) {
      const canvas = rail.getBoundingClientRect(), viewport = scroll.getBoundingClientRect();
      const startX = canvas.left + axis(state.timeline.start) / 100 * canvas.width, endX = canvas.left + axis(state.timeline.end) / 100 * canvas.width;
      if (startX < viewport.left + 12 || endX > viewport.left + scroll.clientWidth - 12) {
        const target = scroll.scrollLeft + (startX + endX) / 2 - viewport.left - scroll.clientWidth / 2;
        const next = Math.max(0, Math.min(scroll.scrollWidth - scroll.clientWidth, target));
        if (Math.abs(next - scroll.scrollLeft) > 1) scroll.scrollTo({ left: next, behavior: "instant" });
      }
    }
  }
  function paintTimeline(start, end) {
    const n = state.snapshot.periods.length, a = n === 1 ? 0 : start / (n - 1) * 100, b = n === 1 ? 100 : end / (n - 1) * 100;
    $("timelineWindow").style.left = `${a}%`; $("timelineWindow").style.width = `${Math.max(.4, b - a)}%`;
    $("timelineStart").style.left = `${a}%`; $("timelineEnd").style.left = `${b}%`;
    for (const [id, value] of [["timelineStart", start], ["timelineEnd", end]]) { $(id).setAttribute("aria-valuemax", state.timeline?.limit ?? n - 1); $(id).setAttribute("aria-valuenow", value); $(id).setAttribute("aria-valuetext", `Reporting week ${day(state.snapshot.periods[value].date, true)}`); }
    $("timelineDates").textContent = `${day(state.snapshot.periods[start].date, true)} – ${day(state.snapshot.periods[end].date, true)} · ${end - start + 1} weeks`;
    app.querySelectorAll("[data-period]").forEach(button => button.setAttribute("aria-pressed", button.dataset.period === $("periodPreset").value));
    $("timelineMonths")?.querySelectorAll("[data-month]").forEach(button => button.setAttribute("aria-pressed", !button.disabled && Number(button.dataset.start) === start && Number(button.dataset.end) === end));
    $("timelineBack").disabled = start === 0; $("timelineNext").disabled = end >= state.timeline.limit; $("timelinePlay").disabled = end - start >= state.timeline.limit;
    const empty = !state.brushing && !state.analysis.periods.length;
    for (const id of ["timelineWindow", "timelineStart", "timelineEnd"]) $(id).hidden = empty;
    if (empty) $("timelineDates").textContent = "No reported weeks in this selection";
  }
  function setTimelineRange(start, end, { deferred = false } = {}) {
    const periods = state.snapshot.periods, limit = state.timeline?.limit ?? periods.length - 1;
    start = Math.max(0, Math.min(limit, start)); end = Math.max(start, Math.min(limit, end));
    const previousMid = ((state.timeline?.start || 0) + (state.timeline?.end || 0)) / 2, direction = Math.sign((start + end) / 2 - previousMid);
    $("periodPreset").value = "custom"; $("startDate").value = periods[start].date; $("endDate").value = periods[end].date;
    state.timeline.start = start; state.timeline.end = end; paintTimeline(start, end);
    clearTimeout(brushUpdateTimer);
    if (deferred) brushUpdateTimer = setTimeout(() => update(), 65); else update();
    if (!state.brushing && !playing && direction) springController().release({ impulseX: direction * 110 });
  }
  function stepTimeline(direction) {
    if (!state.timeline) return;
    const { start, end, limit } = state.timeline, span = end - start, next = Math.max(0, Math.min(limit - span, start + direction));
    setTimelineRange(next, next + span);
  }
  function stopTimeline({ refit = true } = {}) {
    const wasPlaying = playing; clearTimeout(playTimer); playTimer = null; playing = false; playbackScale = null;
    $("timelinePlay").textContent = "Play"; $("timelinePlay").setAttribute("aria-pressed", "false");
    if (refit && wasPlaying && state.analysis && state.view === "overview") renderTrend();
  }
  function playTimeline() {
    if (playing) return stopTimeline();
    if (!state.timeline || state.timeline.end - state.timeline.start >= state.timeline.limit) return;
    playbackScale = fullTrendScale(); playing = true;
    if (state.timeline.end >= state.timeline.limit) setTimelineRange(0, state.timeline.end - state.timeline.start);
    else renderTrend();
    $("timelinePlay").textContent = "Pause"; $("timelinePlay").setAttribute("aria-pressed", "true");
    const interval = reduced() ? 1000 : 350;
    const tick = () => { if (state.timeline.end >= state.timeline.limit) return stopTimeline(); stepTimeline(1); playTimer = setTimeout(tick, interval); };
    playTimer = setTimeout(tick, interval);
  }
  $("timelineTrack").addEventListener("pointerdown", event => {
    if (!state.snapshot || event.button !== 0 || event.isPrimary === false || state.brushing) return;
    stopTimeline(); const track = $("timelineTrack"), r = track.getBoundingClientRect(), n = state.snapshot.periods.length;
    const index = x => Math.max(0, Math.min(state.timeline.limit, Math.round((x - r.left) / r.width * (n - 1))));
    const origin = index(event.clientX), mode = event.target.closest("[data-brush]")?.dataset.brush || "new", original = { ...state.timeline };
    playbackScale = fullTrendScale(); state.brushing = true; track.classList.add("is-dragging"); track.setPointerCapture(event.pointerId); event.preventDefault();
    const move = e => { if (e.pointerId !== event.pointerId) return; const current = index(e.clientX); let start = original.start, end = original.end;
      if (mode === "start") start = Math.min(current, end);
      else if (mode === "end") end = Math.max(current, start);
      else if (mode === "pan") { const span = end - start; start = Math.max(0, Math.min(original.limit - span, original.start + current - origin)); end = start + span; }
      else { start = Math.min(origin, current); end = Math.max(origin, current); }
      setTimelineRange(start, end, { deferred: true });
      const raw = (e.clientX - r.left) / r.width * (n - 1), plotWidth = Math.max(100, $("trendChart").getBoundingClientRect().width - 62), residual = raw - current;
      const tug = Math.max(-18, Math.min(18, residual * plotWidth / Math.max(1, (state.analysis?.periods.length || 2) - 1)));
      springController().pull({ x: tug, stretch: mode === "pan" ? 0 : Math.max(-.018, Math.min(.018, tug / plotWidth)) });
    };
    const finish = e => { if (e.pointerId !== event.pointerId) return; if (e.type !== "pointercancel") move(e); clearTimeout(brushUpdateTimer); state.brushing = false; playbackScale = null; track.classList.remove("is-dragging"); track.removeEventListener("pointermove", move); track.removeEventListener("pointerup", finish); track.removeEventListener("pointercancel", finish); if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId); update(); chartSpring?.release(); };
    track.addEventListener("pointermove", move); track.addEventListener("pointerup", finish); track.addEventListener("pointercancel", finish);
    if (mode === "new") move(event);
  });
  for (const id of ["timelineStart", "timelineEnd"]) $(id).addEventListener("keydown", event => {
    if (!state.timeline) return; const direction = ["ArrowLeft", "ArrowDown", "PageDown"].includes(event.key) ? -1 : ["ArrowRight", "ArrowUp", "PageUp"].includes(event.key) ? 1 : 0;
    if (!direction && !["Home", "End"].includes(event.key)) return;
    event.preventDefault(); stopTimeline(); const original = state.timeline, field = id === "timelineStart" ? "start" : "end", next = event.key === "Home" ? 0 : event.key === "End" ? original.limit : original[field] + direction * (event.key.startsWith("Page") ? 4 : 1);
    setTimelineRange(field === "start" ? Math.min(next, original.end) : original.start, field === "end" ? Math.max(original.start, next) : original.end);
  });
  $("timelineBack").onclick = () => { stopTimeline(); stepTimeline(-1); }; $("timelineNext").onclick = () => { stopTimeline(); stepTimeline(1); }; $("timelinePlay").onclick = playTimeline;
  app.querySelectorAll("[data-period]").forEach(button => button.onclick = () => { stopTimeline(); $("periodPreset").value = button.dataset.period; update(true); });
  function productSelectionChanged() { stopTimeline(); state.hiddenSeries.clear(); $("trendMode").value = state.productsNone || state.products.length ? "products" : "stores"; }
  function focusSku(sku, store) { state.products = [sku]; state.productsNone = false; if (store) { state.stores = [store]; state.storesNone = false; } productSelectionChanged(); controls(); update(true); showView("overview"); }
  function sourceDetails() {
    const s = state.snapshot;
    if (!s) { $("sourceDetails").innerHTML = '<p class="so-source-info">Import a workbook to inspect its coverage and map USD MSRP.</p>'; $("priceBody").innerHTML = ""; return; }
    const all = M.analyze(s, { comparison: "none", coverage: "available" });
    let link = ""; try { const u = new URL(s.sourceUrl); if (u.protocol === "https:") link = `<p><a href="${esc(u.href)}" target="_blank" rel="noopener">Open source workbook</a></p>`; } catch (_) { /* Imported files may not have a source URL. */ }
    $("sourceDetails").innerHTML = `<div class="so-source-info"><strong>${esc(s.title)}</strong><p>${esc(s.sheet || "Imported table")} · ${s.rows.length} retailer-SKU rows · ${M.options(s).products.length} SKUs · ${s.periods.length} weekly columns</p>${link}<p>Report as of ${day(s.asOf, true)}. This is an imported snapshot; import a newer workbook to refresh.</p><ul>${all.coverage.cutoffs.map(c => `<li>${esc(c.store)} last reports: ${day(c.last, true)}</li>`).join("")}</ul><p>Counts are net reported quantities. Negative adjustments remain intact. The source does not define the Sunday labels as week-start or week-end. Account is a retailer, not an individual store. Lifetime is the sum of source weekly columns.</p><p>Comparison growth = (paired current − paired baseline) / paired baseline. Only matching numeric retailer-SKU cells are paired. A missing or nonpositive baseline makes the rate unavailable. Category-share charts use positive category totals; other totals retain negative adjustments.</p><p>USD MSRP maps describe current list-price positioning, not historical transaction price. No revenue, margin, inventory, target or demand inference is supplied.</p>${s.warnings?.length ? `<strong>Source adjustments & notes</strong><ul>${s.warnings.map(w => `<li>${esc(typeof w === "string" ? w : w.message)}</li>`).join("")}</ul>` : ""}</div>`;
    const resolution = state.priceResolution, source = state.pricingSource;
    $("ppcPriceDetails").innerHTML = state.ppcProjection ? `${esc(source?.title || "PPC workspace")} ${source?.date ? `· ${esc(source.date)}` : ""} · ${state.ppcProjection.authority === "ppc-backup" ? "Backup snapshot" : "Current workspace"}<br>${resolution?.coverage.priced || 0} prices · ${resolution?.coverage.conflicts || 0} ambiguous · ${(resolution?.coverage.missing || 0) - (resolution?.coverage.conflicts || 0)} other unmapped${source?.note ? `<br>${esc(source.note)}` : ""}<br>Saved USD MSRP first; exact tracker USD when saved price is missing. SKU conflicts stay unmapped.` : "Open Analytics from PPC to link current USD MSRP, or select a PPC backup below. Manual entries override linked values.";
    if (resolution?.conflicts.length) $("ppcPriceDetails").innerHTML += `<details class="so-price-conflicts"><summary>Matching details (${resolution.conflicts.length})</summary><ul>${resolution.conflicts.map(c => `<li>${esc(c.sku)} · ${esc(c.code.replaceAll("_", " ").toLowerCase())}</li>`).join("")}</ul></details>`;
    renderPriceTable();
  }
  function renderPriceTable() {
    if (!state.snapshot) return;
    const q = $("priceSearch").value.toLowerCase();
    $("priceBody").innerHTML = M.options(state.snapshot).products.filter(p => `${p.sku} ${p.product}`.toLowerCase().includes(q)).map(p => { const v = state.drafts[p.sku] || {}, linked = state.ppcPrices[p.sku]; return `<tr><td>${esc(niceName(p.product))}<small>${esc(p.sku)}${linked ? ` · ${money.format(linked.msrp)} from PPC` : ""}</small></td><td><input type="number" min="0" step="0.01" data-price="${esc(p.sku)}" value="${v.msrp ?? ""}" placeholder="${linked ? linked.msrp : "Override"}" aria-label="USD MSRP override for ${esc(p.sku)}"></td><td><input type="text" maxlength="300" data-price-note="${esc(p.sku)}" value="${esc(v.source || "")}" placeholder="${esc(linked?.source || "Source or note")}" aria-label="Price source for ${esc(p.sku)}"></td></tr>`; }).join("");
    $("priceBody").querySelectorAll("input").forEach(i => i.oninput = () => { const sku = i.dataset.price || i.dataset.priceNote; if (!Object.hasOwn(state.drafts, sku)) Object.defineProperty(state.drafts, sku, { value: {}, writable: true, enumerable: true, configurable: true }); if (i.dataset.price) state.drafts[sku].msrp = i.value === "" ? null : Number(i.value); else state.drafts[sku].source = i.value; });
  }
  function openSource() { state.drafts = structuredClone(state.prices); $("priceStatus").textContent = ""; sourceDetails(); $("sourceDialog").showModal(); }
  async function workbookMatrices(file) {
    const zip = await root.ASCMImporter.helpers.openZip(file, { maxFileBytes: 40 * 1024 * 1024, maxTotalUncompressedBytes: 128 * 1024 * 1024 });
    const xml = text => { if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("Unsupported XML declarations in workbook."); const d = new DOMParser().parseFromString(text, "application/xml"); if (d.querySelector("parsererror")) throw new Error("A workbook XML part is invalid."); return d; };
    const types = await zip.getText("[Content_Types].xml"); if (!types || /macroEnabled/i.test(types)) throw new Error("Choose an ordinary XLSX workbook without macros.");
    const book = xml(await zip.getText("xl/workbook.xml") || ""), rels = xml(await zip.getText("xl/_rels/workbook.xml.rels") || ""), shared = root.ASCMImporter.helpers.parseSharedStrings(await zip.getText("xl/sharedStrings.xml") || "");
    const result = [];
    for (const sheet of [...book.getElementsByTagNameNS("*", "sheet")]) {
      const rid = sheet.getAttribute("r:id") || sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id"), rel = [...rels.getElementsByTagNameNS("*", "Relationship")].find(r => r.getAttribute("Id") === rid);
      if (!rel || rel.getAttribute("TargetMode") === "External" || !/\/worksheet$/.test(rel.getAttribute("Type"))) continue;
      const path = root.ASCMImporter.helpers.resolveZipTarget("xl/workbook.xml", rel.getAttribute("Target")), data = xml(await zip.getText(path) || ""), matrix = [];
      for (const row of [...data.getElementsByTagNameNS("*", "row")]) {
        const ri = Number(row.getAttribute("r")) - 1; if (ri < 0 || ri > 100000) throw new Error("Workbook row limit exceeded.");
        matrix[ri] ||= [];
        for (const cell of [...row.getElementsByTagNameNS("*", "c")]) {
          const letters = cell.getAttribute("r")?.match(/^[A-Z]+/)?.[0]; if (!letters) continue;
          const col = [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1; if (col > 2000) throw new Error("Workbook column limit exceeded.");
          const type = cell.getAttribute("t"), value = cell.getElementsByTagNameNS("*", "v")[0]?.textContent;
          if (type === "e") throw new Error(`Workbook error at ${sheet.getAttribute("name")}!${cell.getAttribute("r")}.`);
          if (type === "s") matrix[ri][col] = shared[Number(value)] ?? "";
          else if (type === "inlineStr") matrix[ri][col] = [...cell.getElementsByTagNameNS("*", "t")].map(t => t.textContent).join("");
          else matrix[ri][col] = value === undefined || value === "" ? null : type === "str" ? value : Number.isFinite(Number(value)) ? Number(value) : value;
        }
      }
      try { const snapshot = M.normalizeWorkbookRows(Array.from(matrix, r => r || []), { title: file.name, sheet: sheet.getAttribute("name") }); result.push(snapshot); } catch (_) { /* Other sheets do not match a sell-out table. */ }
    }
    if (!result.length) throw new Error("No sell-out table found. Expected Account, HP SKU, Product Description, Category and weekly date columns, or a tidy date/units table.");
    return result;
  }
  function importSummary() {
    const s = state.pending?.snapshot, v = s && M.validateSnapshot(s);
    if (!s || !v.ok) { $("importError").textContent = v?.errors.join(" ") || "No valid workbook selected."; $("applyImport").disabled = true; return; }
    $("importError").textContent = ""; $("applyImport").disabled = false;
    const a = M.analyze(s, { comparison: "none", coverage: "available" });
    $("importReview").innerHTML = `<div class="so-source-info"><strong>${esc(s.title)}</strong><p>${esc(s.sheet || "Table")} · ${s.rows.length} rows · ${a.products.length} SKUs · ${a.stores.length} retailers</p><p>${day(s.periods[0].date, true)} – ${day(s.periods.at(-1).date, true)}</p><p>${fmt(a.totals.current)} net reported units · ${fmt(a.totals.missingCells)} missing cells</p>${s.sourceUrl ? '<p>Your provided source link will be saved with this local report.</p>' : ""}${s.warnings?.length ? `<ul>${s.warnings.map(w => `<li>${esc(typeof w === "string" ? w : w.message)}</li>`).join("")}</ul>` : ""}</div>`;
  }
  let importRun = 0;
  async function readImport(file, { sourceUrl = null, autoApply = false, isCurrent = () => true } = {}) {
    if (!file) return;
    if (!autoApply) { cancelSharepointLoad(); if ($("sharepointDialog").open) $("sharepointDialog").close(); }
    const run = ++importRun;
    message(`Reading ${file.name}…`);
    try {
      const ext = file.name.split(".").at(-1).toLowerCase();
      const sourceLink = sourceUrl === null ? null : root.PPCSelloutSharePoint.inspectLink(sourceUrl);
      if (sourceLink && !["xlsx", "csv"].includes(ext)) throw new Error("Choose the downloaded XLSX or CSV workbook. Use Choose file for other backups.");
      const sizeLimit = ext === "pkg" ? root.PortfolioPackage.MAX_PACKAGE_BYTES : 40 * 1024 * 1024;
      if (file.size > sizeLimit) throw new Error(`Choose a file of at most ${sizeLimit / 1024 / 1024} MiB.`);
      if (ext === "pkg") { privateFile = file; openPrivate("import"); message(""); return; }
      let sheets, pending;
      if (ext === "xlsx") { sheets = await workbookMatrices(file); pending = { snapshot: sheets[0] }; }
      else if (ext === "json") { const data = JSON.parse(await file.text()); pending = root.PPCSelloutPrivate.sanitizeWorkspace(data.snapshot ? data : { snapshot: data }); sheets = [pending.snapshot]; }
      else if (ext === "csv") { pending = { snapshot: M.normalizeWorkbookRows(M.parseCsv(await file.text()), { title: file.name, sheet: "CSV" }) }; sheets = [pending.snapshot]; }
      else throw new Error("Choose an XLSX, CSV, JSON or encrypted analytics package.");
      if (run !== importRun || !isCurrent()) return;
      if (sourceLink) {
        sheets = sheets.map(snapshot => ({ ...snapshot, sourceUrl: sourceLink.url }));
        pending = { ...pending, snapshot: sheets[0] };
      }
      if (autoApply && sheets.length === 1) {
        const saved = await applySnapshot(pending.snapshot, state.prices, [], state.ppcProjection, state.pricingSource);
        if (saved && run === importRun && isCurrent()) message(""); return { status: "applied" };
      }
      state.sheets = sheets; state.pending = pending;
      $("sheetChoiceLabel").hidden = state.sheets.length < 2; $("sheetChoice").innerHTML = state.sheets.map((s, i) => `<option value="${i}">${esc(s.sheet)}</option>`).join("");
      importSummary(); if (!autoApply) $("importDialog").showModal(); message("");
      return { status: "review" };
    } catch (error) { if (run === importRun && isCurrent()) { if (autoApply) throw new Error("The workbook could not be read as a sell-out report. Your current report is still available."); message(error.message, true); } }
    finally { if (run === importRun) $("workbookFile").value = ""; }
  }
  async function applySnapshot(snapshot, prices = {}, shortlist = [], ppcProjection = state.ppcProjection, pricingSource = state.pricingSource) {
    const v = M.validateSnapshot(snapshot); if (!v.ok) throw new Error(v.errors.join(" "));
    if (ppcProjection && !root.PPCSelloutPricing.validateProjection(ppcProjection).ok) throw new Error("Invalid PPC pricing projection.");
    state.snapshot = snapshot; state.prices = sanitizePrices(prices); state.shortlist = Array.isArray(shortlist) ? shortlist.filter(s => s && typeof s.key === "string" && typeof s.title === "string" && typeof s.text === "string").slice(0, 100) : [];
    state.ppcProjection = ppcProjection; state.pricingSource = pricingSource; resolvePpc();
    stopTimeline(); root.PPCSelloutMotion.reset(); state.markerDate = null; state.hoverDate = null; state.stores = []; state.products = []; state.storesNone = false; state.productsNone = false; state.hiddenSeries.clear(); $("trendMode").value = "stores"; $("categoryFilter").value = ""; $("bandFilter").value = ""; $("periodPreset").value = "13"; controls(); update(true); const saved = await persist();
    if (ppcBridge) void refreshPpc();
    return saved;
  }
  function sanitizePrices(prices) {
    const result = {};
    if (prices && typeof prices === "object") for (const [sku, value] of Object.entries(prices)) if (value && Number.isFinite(value.msrp) && value.msrp >= 0 && sku !== "__proto__") result[sku] = { msrp: value.msrp, source: String(value.source || "").slice(0, 300) };
    return result;
  }
  let ppcBridge = null;
  function resolvePpc() {
    state.ppcPrices = {};
    if (!state.snapshot || !state.ppcProjection) return;
    const projection = root.PPCSelloutPricing.resolvePrices(state.ppcProjection, M.options(state.snapshot).products.map(p => p.sku));
    state.priceResolution = projection;
    const map = new Map(projection.prices.filter(p => p.msrp !== null).map(p => [p.sku, p]));
    for (const product of M.options(state.snapshot).products) { const price = map.get(root.PPCSelloutPricing.normalizeSku(product.sku)); if (price) state.ppcPrices[product.sku] = { ...price, source: `PPC ${price.priceSource === "saved-product" ? "saved MSRP" : "tracker USD"}${price.match === "base-pn" ? ` · base ${price.matchedSku}` : ""}` }; }
  }
  function updatePriceStatus() {
    if (!state.snapshot) return;
    const products = M.options(state.snapshot).products, count = products.filter(p => priceOf(p.sku) !== null).length;
    $("ppcPriceCoverage").textContent = `${count}/${products.length} prices${state.priceResolution?.coverage.conflicts ? ` · ${state.priceResolution.coverage.conflicts} conflicts` : ""}`;
    $("ppcPriceCoverage").title = state.ppcProjection ? state.ppcProjection.authority === "ppc-backup" ? "Prices loaded automatically from the saved PPC backup" : "USD MSRP linked automatically from the PPC workspace" : "Open Analytics from PPC to link saved USD MSRP automatically";
  }
  async function acceptPpc(projection, source) {
    const valid = root.PPCSelloutPricing.validateProjection(projection); if (!valid.ok) throw new Error(valid.errors.join(" "));
    state.ppcProjection = structuredClone(projection); state.pricingSource = source || { title: "Current PPC workspace", authority: projection.authority, updatedAt: new Date().toISOString() };
    resolvePpc(); if (state.snapshot) { update(); await persist(); }
  }
  let ppcRefreshPending = false;
  async function refreshPpc() {
    if (!ppcBridge || ppcRefreshPending) return;
    ppcRefreshPending = true;
    try { await ppcBridge.request(state.snapshot ? M.options(state.snapshot).products.map(p => p.sku) : undefined); }
    catch (_) { ppcBridge?.disconnect(); ppcBridge = null; }
    finally { ppcRefreshPending = false; }
  }
  $("ppcBackupButton").onclick = () => $("ppcPricingFile").click();
  root.addEventListener("focus", () => { void refreshPpc(); });
  $("ppcPricingFile").onchange = async event => {
    const file = event.target.files[0]; if (!file) return;
    try { if (file.size > 20 * 1024 * 1024) throw new Error("Choose a PPC backup or pricing projection under 20 MiB."); const source = JSON.parse(await file.text()), projection = source.schemaVersion === 1 && source.currency === "USD" ? source : root.PPCSelloutPricing.projectPortfolio(source, { skus: state.snapshot ? M.options(state.snapshot).products.map(p => p.sku) : undefined }); projection.authority = "ppc-backup"; await acceptPpc(projection, { title: file.name, authority: "ppc-backup", updatedAt: new Date().toISOString() }); message(""); }
    catch (error) { message(error.message, true); } finally { event.target.value = ""; }
  };
  function download(filename, content, mime) { const blob = new Blob([content], { type: mime }), url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  const csvCell = v => { let s = String(v ?? ""); if (/^[=+@\t\r]|^-\D/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  function csv(headers, rows) { return [headers, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n"); }
  function brief(planningOnly = false) {
    const s = state.snapshot, market = $("marketStore").value, a = market ? M.analyze(s, { ...filters(), stores: [market], start: state.analysis.selection.start || filters().start, end: state.analysis.selection.end || filters().end, coverage: "available" }) : state.analysis, rows = a.storeProducts, positive = [...rows].filter(r => r.current > 0).sort((a, b) => b.current - a.current).slice(0, 8), declines = [...rows].filter(r => r.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5);
    const safe = v => String(v || "").replace(/[\r\n|]/g, " "), lines = [`# ${planningOnly ? "PPC planning brief" : "Market performance brief"}`, "", `Source: ${safe(s.title)}`, `Source link: ${s.sourceUrl || "Imported local file"}`, `Report as of: ${s.asOf || "Unspecified"}`, `Period: ${a.selection.start || "No observed weeks"} to ${a.selection.end || "n.a."}`, `Comparison: ${a.selection.comparison} (${a.coverage.comparisonStart || "n.a."} to ${a.coverage.comparisonEnd || "n.a."})`, `Retailers: ${market || (state.storesNone ? "None" : state.stores.length ? state.stores.join(", ") : "All")}`, `Products: ${state.productsNone ? "None" : state.products.length ? state.products.join(", ") : "All"}`, `Category: ${$("categoryFilter").value || "All"}`, `USD MSRP band: ${$("bandFilter").value || "All"}`, "", `Net reported units (selected scope): ${fmt(a.totals.current)}`, `Paired growth: ${pct(a.totals.growth)} (${fmt(a.totals.delta)} paired units)`, `Reporting coverage: ${a.totals.numericCells} numeric cells, ${a.totals.missingCells} missing`, "", "## Retailer / SKU evidence", "", "| Retailer | SKU | Product | Net units | Paired change | Reported weeks |", "|---|---|---|---:|---:|---:|", ...[...positive, ...declines.filter(d => !positive.includes(d))].map(r => `| ${safe(r.store)} | ${safe(r.sku)} | ${safe(r.product)} | ${fmt(r.current)} | ${pct(r.growth)} | ${r.observedWeeks}/${a.periods.length} |`), "", "## PPC planning shortlist", ""];
    if (!state.shortlist.length) lines.push("No opportunities shortlisted. Review the dashboard proposals before adding product or roadmap commitments.");
    state.shortlist.forEach((c, i) => lines.push(`### ${i + 1}. ${safe(c.title)}`, "", c.text, "", `Evidence: ${safe(c.evidence)}`, `Original shortlist period: ${c.period?.start || "n.a."} to ${c.period?.end || "n.a."}`, `Original source: ${safe(c.sourceTitle || s.title)}`, "PPC category / target retailer: " + [c.category, c.store].filter(Boolean).join(" / "), `Owner: ${safe(c.owner) || "to assign"}`, `Proposed roadmap month: ${safe(c.targetMonth) || "to agree during roadmap review"}`, `Validation / next step: ${safe(c.notes) || "to define"}`, "Success measure: to set using retailer availability, unit pace and a comparable reporting window", ""));
    lines.push("## Definitions and evidence limits", "", "Net units preserve negative source adjustments. Missing cells are excluded and remain distinct from zero. Paired change uses matching numeric retailer-SKU cells, with a complete comparison date window and positive baseline for percentage growth. USD MSRP is an independent, current list-price map, not historical transaction price. Low sell-out or an absent source assortment is a hypothesis to validate with inventory, retailer listing and demand evidence. This brief proposes planning actions; it does not change PPC products or roadmap dates.", "", ...a.coverage.warnings.map(w => "- " + safe(w)), ...(s.warnings || []).map(w => "- " + safe(typeof w === "string" ? w : w.message)));
    const prices = Object.entries(state.prices); if (prices.length) lines.push("", "## USD MSRP sources", "", "| SKU | MSRP USD | Source / note |", "|---|---:|---|", ...prices.map(([sku, p]) => `| ${safe(sku)} | ${p.msrp.toFixed(2)} | ${safe(p.source)} |`));
    download(planningOnly ? "ppc-planning-brief.md" : "market-performance-brief.md", lines.join("\n"), "text/markdown;charset=utf-8");
  }
  const chooseFile = () => { cancelSharepointLoad(); $("workbookFile").click(); };
  $("emptyImport").onclick = chooseFile;
  $("workbookFile").onchange = e => readImport(e.target.files[0]);
  const sharepointClient = root.PPCSelloutSharePointClient.create({ config: root.PPCSelloutSharePointConfig, msal: root.msal, fetch: root.fetch?.bind(root), location: root.location });
  let sharepointRun = 0, sharepointAbort = null, sharepointInitializing = false, sharepointInitError = false;
  function renderSharepointLoad() {
    const busy = !!sharepointAbort;
    $("sharepointLoad").disabled = busy || !sharepointClient.ready || !sharepointClient.initialized || sharepointInitError;
    $("sharepointLoad").textContent = busy ? "Loading…" : sharepointInitializing ? "Connecting…" : "Sign in & load";
    $("sharepointLink").readOnly = busy;
    $("sharepointSetup").hidden = sharepointClient.ready;
    $("sharepointHint").hidden = !sharepointClient.ready || busy;
    $("sharepointProgress").hidden = !busy;
  }
  function cancelSharepointLoad() {
    sharepointRun++; sharepointAbort?.abort(); sharepointAbort = null; renderSharepointLoad();
  }
  if (sharepointClient.ready) {
    sharepointInitializing = true;
    void sharepointClient.initialize().catch(() => {
      sharepointInitError = true; $("sharepointError").textContent = "Microsoft sign-in could not start. Reload PPC and try again.";
    }).finally(() => { sharepointInitializing = false; renderSharepointLoad(); });
  }
  renderSharepointLoad();
  function openSharepointLink() {
    importRun++; cancelSharepointLoad(); $("sharepointError").textContent = sharepointInitError ? "Microsoft sign-in could not start. Reload PPC and try again." : ""; $("sharepointLink").value = ""; $("sharepointDialog").showModal();
  }
  $("emptyLinkImport").onclick = openSharepointLink;
  $("importButton").onclick = chooseFile;
  $("sharepointLink").oninput = () => { $("sharepointError").textContent = ""; };
  $("sharepointLinkForm").onsubmit = async event => {
    event.preventDefault();
    if (sharepointAbort) return;
    $("sharepointError").textContent = "";
    if (!sharepointClient.ready) { $("sharepointError").textContent = "Microsoft connection setup is required before PPC can load a link."; return; }
    if (!sharepointClient.initialized || sharepointInitError) { $("sharepointError").textContent = "Microsoft sign-in is not ready. Reload PPC and try again."; return; }
    importRun++;
    const run = ++sharepointRun, abort = new AbortController(); sharepointAbort = abort;
    const isCurrent = () => run === sharepointRun && !abort.signal.aborted;
    const timeout = setTimeout(() => { if (isCurrent()) abort.abort(); }, 120000);
    renderSharepointLoad(); $("sharepointProgressText").textContent = "Sign in to Microsoft…";
    try {
      const link = root.PPCSelloutSharePoint.inspectLink($("sharepointLink").value);
      const file = await sharepointClient.load(link.url, { signal: abort.signal, onProgress: progress => {
        if (!isCurrent()) return;
        $("sharepointProgressText").textContent = progress.phase === "sign-in" ? "Sign in to Microsoft…" : progress.phase === "metadata" ? "Finding your workbook…" : progress.phase === "download" ? "Downloading a temporary copy…" : "Preparing your charts…";
      } });
      if (!isCurrent()) return;
      $("sharepointProgressText").textContent = "Preparing your charts…";
      const result = await readImport(file, { sourceUrl: link.url, autoApply: true, isCurrent });
      if (!isCurrent() || !result) return;
      $("sharepointDialog").close();
      if (result.status === "review") $("importDialog").showModal();
    } catch (error) {
      if (run === sharepointRun) $("sharepointError").textContent = abort.signal.aborted ? "Loading timed out. Try again when you are ready to sign in." : error.message;
    } finally {
      clearTimeout(timeout);
      if (run === sharepointRun) { sharepointAbort = null; renderSharepointLoad(); }
    }
  };
  $("sharepointLocalFile").onclick = () => { $("sharepointDialog").close(); chooseFile(); };
  $("sharepointDialog").addEventListener("close", () => { cancelSharepointLoad(); $("sharepointLink").value = ""; $("sharepointError").textContent = ""; });
  $("applyImport").onclick = async () => { try { await applySnapshot(state.pending.snapshot, state.pending.prices || state.prices, state.pending.shortlist || [], state.pending.ppcProjection || state.ppcProjection, state.pending.pricingSource || state.pricingSource); $("importDialog").close(); state.pending = null; } catch (e) { $("importError").textContent = e.message; } };
  $("sheetChoice").onchange = () => { state.pending = { snapshot: state.sheets[Number($("sheetChoice").value)] }; importSummary(); };
  $("openSource").onclick = $("editPrices").onclick = $("sourceFooterButton").onclick = $("reportInfo").onclick = $("coverageNotice").onclick = openSource;
  $("productSearch").oninput = renderProductOptions;
  $("productPicker").ontoggle = positionProductMenu;
  root.addEventListener("resize", positionProductMenu);
  $("storeOptions").onclick = e => { const button = e.target.closest?.("button[data-store]"); if (!button || !$("storeOptions").contains(button) || !state.snapshot) return; const store = button.dataset.store, selected = !state.storesNone && (!state.stores.length || state.stores.includes(store)); stopTimeline(); setFilterSelection("stores", store, !selected); controls(); update(true); };
  $("productOptions").onchange = e => { const sku = e.target.dataset.product; if (!sku) return; setFilterSelection("products", sku, e.target.checked); productSelectionChanged(); controls(); update(true); };
  $("productAll").onclick = () => { setAllFilters("products", true); productSelectionChanged(); controls(); update(true); };
  $("productClear").onclick = () => { setAllFilters("products", false); productSelectionChanged(); controls(); update(true); };
  for (const id of ["categoryFilter", "bandFilter", "coverage", "periodPreset"]) $(id).onchange = () => { stopTimeline(); update(true); };
  for (const id of ["startDate", "endDate"]) $(id).onchange = () => { stopTimeline(); $("periodPreset").value = "custom"; update(); };
  $("comparison").onchange = () => { stopTimeline(); update(); };
  app.querySelectorAll("[data-trend]").forEach(button => button.onclick = () => { stopTimeline(); $("trendMode").value = button.dataset.trend; state.hiddenSeries.clear(); renderTrend(); });
  $("marketStore").onchange = planning;
  $("resetFilters").onclick = () => { if (!state.snapshot) return; stopTimeline(); state.markerDate = null; state.hoverDate = null; state.stores = []; state.products = []; state.storesNone = false; state.productsNone = false; state.hiddenSeries.clear(); $("trendMode").value = "stores"; $("categoryFilter").value = ""; $("bandFilter").value = ""; $("comparison").value = "year"; $("coverage").value = "common"; $("periodPreset").value = "13"; controls(); update(true); };
  $("tableSearch").oninput = $("signalFilter").onchange = () => { state.page = 0; table(); }; $("prevPage").onclick = () => { state.page--; table(); }; $("nextPage").onclick = () => { state.page++; table(); };
  app.querySelectorAll("[data-sort]").forEach(b => b.onclick = () => { state.descending = state.sort === b.dataset.sort ? !state.descending : true; state.sort = b.dataset.sort; table(); });
  $("priceSearch").oninput = renderPriceTable;
  $("savePrices").onclick = async () => {
    const bad = Object.entries(state.drafts).find(([, p]) => p.msrp != null && (!Number.isFinite(p.msrp) || p.msrp < 0));
    if (bad) { $("priceStatus").textContent = `Enter a nonnegative numeric USD MSRP for ${bad[0]}, or leave it blank.`; return; }
    state.prices = sanitizePrices(state.drafts); const saved = await persist(); update(true); $("priceStatus").textContent = `${Object.keys(state.prices).length} SKU prices applied${saved ? " and saved locally" : " for this session"}.`;
  };
  $("priceCsvButton").onclick = () => $("priceCsvFile").click();
  $("priceCsvFile").onchange = async e => {
    try { const file = e.target.files[0]; if (!file) return; const rows = M.parseCsv(await file.text()), header = rows.shift().map(v => String(v).trim().toLowerCase()), skuCol = header.indexOf("sku"), priceCol = header.indexOf("msrp"), sourceCol = header.indexOf("source"); if (skuCol < 0 || priceCol < 0) throw new Error("Price CSV needs sku,msrp,source columns."); const validSkus = new Set(M.options(state.snapshot).products.map(p => p.sku)), pending = structuredClone(state.drafts), seen = new Set(); let count = 0, skipped = 0;
      rows.forEach((r, i) => { const sku = String(r[skuCol] || "").trim(); if (!sku) return; if (seen.has(sku)) throw new Error(`Duplicate price SKU ${sku} in row ${i + 2}.`); seen.add(sku); if (!validSkus.has(sku)) { skipped++; return; } const raw = String(r[priceCol] ?? "").trim(); const price = raw === "" ? null : Number(raw); if (price !== null && (!Number.isFinite(price) || price < 0)) throw new Error(`Invalid USD MSRP for ${sku} in row ${i + 2}.`); pending[sku] = { msrp: price, source: sourceCol >= 0 ? String(r[sourceCol] || "").slice(0, 300) : "" }; count++; }); state.drafts = pending; renderPriceTable(); $("priceStatus").textContent = `${count} prices ready to apply. ${skipped} unknown SKUs skipped.`;
    } catch (e) { $("priceStatus").textContent = e.message; } finally { $("priceCsvFile").value = ""; }
  };
  $("priceTemplate").onclick = () => { if (state.snapshot) download("sku-msrp-template.csv", csv(["sku", "product", "category", "msrp", "source"], M.options(state.snapshot).products.map(p => [p.sku, p.product, p.category, priceOf(p.sku), state.prices[p.sku]?.source || ""])), "text/csv;charset=utf-8"); };
  $("exportCsv").onclick = () => download("retail-sku-performance.csv", csv(["store", "sku", "product", "category", "msrp_usd", "price_band", "net_units", "comparison_units", "paired_current", "paired_baseline", "paired_delta", "paired_growth_fraction", "reported_weeks", "selected_weeks", "paired_cells", "performance_signal", "period_start", "period_end"], state.tableEntries.map(r => [r.store, r.sku, r.product, r.category, priceOf(r.sku), bandOf(r.sku), r.current, r.previous, r.comparableCurrent, r.comparablePrevious, r.delta, r.growth, r.observedWeeks, state.analysis.periods.length, r.pairedCells, signal(r), state.analysis.selection.start, state.analysis.selection.end])), "text/csv;charset=utf-8");
  $("exportButton").onclick = () => brief(); $("exportPlanning").onclick = () => brief(true);
  $("backupButton").onclick = () => download("retail-analytics-snapshot.json", JSON.stringify(root.PPCSelloutPrivate.sanitizeWorkspace(workspace())), "application/json");
  let privateFile = null, privateMode = "export", privateRun = 0;
  function openPrivate(mode) {
    privateRun++; privateMode = mode; $("privateKey").value = ""; $("privateStatus").textContent = ""; $("privateAction").disabled = false;
    $("privateTitle").textContent = mode === "import" ? "Unlock analytics" : "Encrypted analytics";
    $("privateAction").textContent = mode === "import" ? "Unlock package" : "Save encrypted package";
    $("privatePurpose").textContent = mode === "import" ? "Enter the package's PPC key. It stays in this browser." : "Protect this dataset with a PPC package key. Everyone with that key can unlock it.";
    $("privateDialog").showModal();
  }
  $("exportPrivate").onclick = () => openPrivate("export");
  $("privateDialog").addEventListener("close", () => { privateRun++; $("privateKey").value = ""; privateFile = null; });
  $("privateAction").onclick = async () => {
    const key = $("privateKey").value, run = ++privateRun, inputFile = privateFile; $("privateAction").disabled = true; $("privateStatus").textContent = privateMode === "export" ? "Encrypting…" : "Unlocking…";
    try {
      if (privateMode === "export") { const bytes = await root.PPCSelloutPrivate.encrypt(workspace(), key); if (run !== privateRun) return; download("retail-analytics.pkg", bytes, "application/octet-stream"); $("privateDialog").close(); }
      else { const data = await root.PPCSelloutPrivate.decrypt(new Uint8Array(await inputFile.arrayBuffer()), key); if (run !== privateRun) return; state.pending = data; state.sheets = [data.snapshot]; $("sheetChoiceLabel").hidden = true; importSummary(); $("privateDialog").close(); $("importDialog").showModal(); }
    } catch (error) { if (run === privateRun) $("privateStatus").textContent = error.message; }
    finally { if (run === privateRun) { $("privateKey").value = ""; $("privateAction").disabled = false; } }
  };
  document.addEventListener("click", e => { app.querySelectorAll(".so-picker[open]").forEach(d => { if (!d.contains(e.target)) d.open = false; }); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { $("chartTooltip").hidden = true; app.querySelectorAll(".so-picker[open]").forEach(d => d.open = false); } });
  let dragDepth = 0;
  root.addEventListener("dragenter", e => { if ([...e.dataTransfer?.types || []].includes("Files")) { e.preventDefault(); dragDepth++; $("dropOverlay").hidden = false; } }); root.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("dropOverlay").hidden = true; } }); root.addEventListener("dragover", e => { if ([...e.dataTransfer?.types || []].includes("Files")) e.preventDefault(); }); root.addEventListener("drop", e => { if (e.dataTransfer?.files.length) { e.preventDefault(); dragDepth = 0; $("dropOverlay").hidden = true; readImport(e.dataTransfer.files[0]); } });
  app.querySelectorAll(".so-sidebar nav a").forEach(a => a.onclick = event => { event.preventDefault(); showView(a.hash.slice(1)); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopTimeline(); });
  let resizeTimer; new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (state.analysis && !state.brushing) { renderCharts(); renderTimeline(); } }, 100); }).observe($("trendChart"));
  const workspace = () => ({ snapshot: state.snapshot, prices: structuredClone(state.prices), shortlist: structuredClone(state.shortlist), ppcProjection: state.ppcProjection, pricingSource: state.pricingSource });
  root.PPCSelloutDashboard = { analysis: null, ready: null, applySnapshot, readImport, getSnapshot: workspace };
  root.PPCSelloutDashboard.ready = (async () => {
    const loadWorkspace = value => applySnapshot(value.snapshot || value, value.prices, value.shortlist, value.ppcProjection || null, value.pricingSource || null);
    try { const embedded = root.PPC_RETAIL_LOCAL_SNAPSHOT, saved = await storage("readonly"); if (saved?.snapshot && M.validateSnapshot(saved.snapshot).ok) await loadWorkspace(saved); else if (embedded) await loadWorkspace(embedded); }
    catch (_) { if (root.PPC_RETAIL_LOCAL_SNAPSHOT) await loadWorkspace(root.PPC_RETAIL_LOCAL_SNAPSHOT); }
    const capability = new URLSearchParams(root.location.hash.slice(1)).get("ppc-link");
    if (capability) { try { ppcBridge = root.PPCSelloutPricing.connectDashboard(capability, projection => { void acceptPpc(projection).catch(error => message(error.message, true)); }, { autoRequest: false }); await ppcBridge.request(state.snapshot ? M.options(state.snapshot).products.map(p => p.sku) : undefined); } catch (error) { message(error.message); } }
    await root.PortfolioTheme?.fontsReady?.(); if (state.analysis) { renderCharts(); renderTimeline(); }
  })();
})(globalThis);
