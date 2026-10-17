/* Local view preferences and a vertical counterpart to the board navigator. */
(function (root) {
  "use strict";
  const KEY = "portfolio.roadmap.row-height.v1";
  const MIN = 24, MAX = 48;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const normalize = value => clamp(Math.round(number(value, 38) / 2) * 2, MIN, MAX);
  const listeners = new Set();
  let height = 38;
  try { const stored = root.localStorage.getItem(KEY); if (stored !== null) height = normalize(stored); } catch (_) { /* A private window can still use the view. */ }
  function getHeight() { return height; }
  function setHeight(value, metadata = {}) {
    const next = normalize(value);
    if (next === height) return height;
    const previousHeight = height;
    height = next;
    try { root.localStorage.setItem(KEY, String(height)); } catch (_) { /* Preference persistence is optional. */ }
    for (const callback of Array.from(listeners)) callback(height, { ...metadata, previousHeight });
    return height;
  }
  function subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); }
  const make = (tag, className) => { const element = document.createElement(tag); element.className = className; return element; };
  function attachControl(host) {
    const abort = new AbortController();
    const details = make("details", "roadmap-density-control");
    const summary = make("summary", "roadmap-density-trigger");
    const icon = make("span", "roadmap-density-icon");
    icon.setAttribute("aria-hidden", "true");
    summary.append(icon);
    summary.setAttribute("aria-label", "Roadmap row density");
    const panel = make("div", "roadmap-density-panel");
    const presets = make("div", "roadmap-density-presets");
    const buttons = [["Default", 38], ["Compact", 28]].map(([name, value]) => {
      const button = make("button", "roadmap-density-preset");
      button.type = "button"; button.textContent = name; button.dataset.height = value;
      button.addEventListener("click", () => { setHeight(value, { source: "preset" }); }, { signal: abort.signal });
      presets.append(button); return button;
    });
    const label = make("label", "roadmap-density-range-label");
    const text = make("span", "roadmap-density-range-title"); text.textContent = "Vertical scale";
    const output = make("output", "roadmap-density-value");
    const range = make("input", "roadmap-density-range");
    range.type = "range"; range.min = MIN; range.max = MAX; range.step = 2;
    range.setAttribute("aria-label", "Roadmap row height");
    label.append(text, output, range);
    panel.append(presets, label);
    details.append(summary, panel); host.append(details);
    function update() {
      range.value = height; output.textContent = `${height}px`;
      range.setAttribute("aria-valuetext", `${height} pixels per product row`);
      for (const button of buttons) button.setAttribute("aria-pressed", String(Number(button.dataset.height) === height));
    }
    function position() {
      if (!details.open) return;
      const rect = summary.getBoundingClientRect();
      panel.style.left = `${Math.max(8, Math.min(rect.right - panel.offsetWidth, root.innerWidth - panel.offsetWidth - 8))}px`;
      panel.style.top = `${Math.max(8, Math.min(rect.bottom + 6, root.innerHeight - panel.offsetHeight - 8))}px`;
    }
    range.addEventListener("input", () => setHeight(range.value, { source: "range" }), { signal: abort.signal });
    details.addEventListener("toggle", position, { signal: abort.signal });
    document.addEventListener("pointerdown", event => { if (!details.contains(event.target)) details.open = false; }, { signal: abort.signal });
    details.addEventListener("keydown", event => { if (event.key === "Escape") { details.open = false; summary.focus(); } }, { signal: abort.signal });
    root.addEventListener("resize", position, { signal: abort.signal });
    const unsubscribe = subscribe(update); update();
    return Object.freeze({ update, destroy() { unsubscribe(); abort.abort(); details.remove(); } });
  }
  function createNavigator(host, adapter) {
    const abort = new AbortController();
    const rail = make("div", "roadmap-vertical-navigator");
    rail.setAttribute("aria-label", adapter.label || "Roadmap vertical navigation");
    if (adapter.className) rail.classList.add(adapter.className);
    const silhouettes = make("div", "roadmap-vertical-silhouettes"); silhouettes.setAttribute("aria-hidden", "true");
    const window = make("div", "roadmap-vertical-window");
    const pan = make("button", "roadmap-vertical-pan");
    pan.type = "button"; pan.setAttribute("role", "slider"); pan.setAttribute("aria-label", "Visible products"); pan.setAttribute("aria-orientation", "vertical");
    const handles = ["top", "bottom"].map(edge => {
      const button = make("button", `roadmap-vertical-handle roadmap-vertical-${edge}`);
      button.type = "button"; button.dataset.edge = edge; button.setAttribute("role", "slider");
      button.setAttribute("aria-label", `Resize visible products from ${edge}`); button.setAttribute("aria-orientation", "vertical");
      button.setAttribute("aria-valuemin", MIN); button.setAttribute("aria-valuemax", MAX); return button;
    });
    window.append(pan, ...handles); rail.append(silhouettes, window); host.append(rail);
    let gesture = null, signature = "", destroyed = false;
    const listen = (element, name, callback) => element.addEventListener(name, callback, { signal: abort.signal });
    function state() {
      const raw = adapter.getState();
      const total = Math.max(1, number(raw.total, 1));
      const visible = clamp(number(raw.visible, total), 1, total);
      const minScale = Math.max(.01, number(raw.minScale, .2)), maxScale = Math.max(minScale, number(raw.maxScale, 2));
      const scale = Number.isFinite(raw.scale) ? clamp(raw.scale, minScale, maxScale) : null;
      return { ...raw, total, visible, scale, minScale, maxScale, offset: clamp(number(raw.offset), 0, Math.max(0, total - visible)), height: normalize(raw.height ?? getHeight()), rowCount: Math.max(0, number(raw.rowCount)), overhead: Math.max(0, number(raw.overhead)) };
    }
    function update() {
      if (destroyed) return;
      const value = state(), first = value.offset / value.total, span = value.visible / value.total;
      rail.hidden = !value.rowCount;
      window.style.top = `${first * 100}%`; window.style.height = `${span * 100}%`;
      rail.classList.toggle("is-fit", value.total <= value.visible + 1);
      const description = `Viewing ${Math.round(first * 100)}% to ${Math.round((first + span) * 100)}% of products`;
      pan.setAttribute("aria-valuemin", "0"); pan.setAttribute("aria-valuemax", String(Math.round(Math.max(0, value.total - value.visible))));
      pan.setAttribute("aria-valuenow", String(Math.round(value.offset))); pan.setAttribute("aria-valuetext", description);
      for (const handle of handles) {
        const scaling = value.scale !== null;
        handle.setAttribute("aria-valuemin", scaling ? Math.round(value.minScale * 100) : MIN);
        handle.setAttribute("aria-valuemax", scaling ? Math.round(value.maxScale * 100) : MAX);
        handle.setAttribute("aria-valuenow", scaling ? Math.round(value.scale * 100) : value.height);
        handle.setAttribute("aria-valuetext", `${scaling ? `${Math.round(value.scale * 100)}% card zoom` : `${value.height} pixels per row`}; ${description.toLowerCase()}`);
      }
      const next = JSON.stringify([value.total, value.crossTotal, value.items]);
      if (next === signature) return;
      signature = next;
      const fragment = document.createDocumentFragment();
      for (const item of value.items || []) {
        const top = clamp(number(item.y) / value.total, 0, 1);
        const size = clamp(number(item.height) / value.total, 0, 1 - top);
        if (!size) continue;
        const shape = make("i", `roadmap-vertical-silhouette${item.selected ? " is-selected" : ""}`);
        shape.style.top = `${top * 100}%`; shape.style.height = `${size * 100}%`;
        if (value.crossTotal > 0) {
          const left = clamp(number(item.x) / value.crossTotal, 0, 1);
          shape.style.left = `${left * 100}%`; shape.style.right = "auto";
          shape.style.width = `${clamp(number(item.width) / value.crossTotal, 0, 1 - left) * 100}%`;
        }
        fragment.append(shape);
      }
      silhouettes.replaceChildren(fragment);
    }
    function requestResize(height, edge, initial) {
      // The caller maps this old content coordinate into its new row geometry.
      const anchor = initial.offset + (edge === "top" ? initial.visible : 0);
      adapter.onResize?.({ height: normalize(height), edge, anchor, initialHeight: initial.height }); update();
    }
    function requestScale(scale, edge, initial) {
      const anchor = (initial.offset + (edge === "top" ? initial.visible : 0)) / initial.scale;
      adapter.onResize?.({ scale: clamp(scale, initial.minScale, initial.maxScale), edge, anchor }); update();
    }
    function resize(edge, fraction, initial) {
      if (!initial.rowCount) return;
      const first = initial.offset / initial.total, last = (initial.offset + initial.visible) / initial.total;
      const span = Math.max(.001, edge === "top" ? last - fraction : fraction - first);
      if (initial.scale !== null) { requestScale(initial.scale * initial.visible / initial.total / span, edge, initial); return; }
      requestResize((initial.visible / span - initial.overhead) / initial.rowCount, edge, initial);
    }
    const fractionAt = (event, rect) => clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
    listen(rail, "pointerdown", event => {
      if (event.isPrimary === false || event.button !== 0 || gesture) return;
      const initial = state(), rect = rail.getBoundingClientRect();
      if (rect.height <= 0) return;
      const fraction = fractionAt(event, rect), edge = event.target.closest?.(".roadmap-vertical-handle")?.dataset.edge;
      const point = fraction * initial.total, inside = point >= initial.offset && point <= initial.offset + initial.visible;
      gesture = { id: event.pointerId, edge, initial, rect, offset: inside ? point - initial.offset : initial.visible / 2 };
      event.preventDefault(); rail.classList.add("is-pointer-focused", "is-dragging");
      (edge ? handles[edge === "top" ? 0 : 1] : pan).focus({ preventScroll: true }); rail.setPointerCapture(event.pointerId);
      if (!edge && !inside) { adapter.onPan?.(clamp(point - gesture.offset, 0, initial.total - initial.visible)); update(); }
    });
    listen(rail, "pointermove", event => {
      if (!gesture || gesture.id !== event.pointerId) return;
      event.preventDefault(); const fraction = fractionAt(event, gesture.rect);
      if (gesture.edge) resize(gesture.edge, fraction, gesture.initial);
      else { const value = state(); adapter.onPan?.(clamp(fraction * value.total - gesture.offset, 0, value.total - value.visible)); update(); }
    });
    function finish(event = {}) {
      if (!gesture || (event.pointerId !== undefined && event.pointerId !== gesture.id)) return;
      const id = gesture.id; gesture = null; rail.classList.remove("is-dragging");
      if (rail.hasPointerCapture(id)) rail.releasePointerCapture(id);
    }
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) listen(rail, name, finish);
    listen(rail, "keydown", event => {
      rail.classList.remove("is-pointer-focused");
      if (event.key === "Escape") { finish(); return; }
      if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); const initial = state(), edge = event.target.dataset.edge;
      if (edge) {
        const direction = (event.key === "ArrowUp" || event.key === "PageUp" ? -1 : 1) * (edge === "top" ? 1 : -1);
        if (initial.scale !== null) {
          const value = event.key === "Home" ? initial.minScale : event.key === "End" ? initial.maxScale
            : Math.round((initial.scale + direction * (event.shiftKey || event.key.startsWith("Page") ? .5 : .1)) * 100) / 100;
          requestScale(value, edge, initial); return;
        }
        const value = event.key === "Home" ? MIN : event.key === "End" ? MAX : initial.height + direction * (event.shiftKey || event.key.startsWith("Page") ? 6 : 2);
        requestResize(value, edge, initial);
      } else {
        const step = initial.scale !== null ? 40 : initial.height;
        const distance = event.key.startsWith("Page") ? initial.visible * .9 : step * (event.shiftKey ? 5 : 1);
        const next = event.key === "Home" ? 0 : event.key === "End" ? initial.total - initial.visible : initial.offset + (event.key.endsWith("Up") ? -distance : distance);
        adapter.onPan?.(clamp(next, 0, initial.total - initial.visible)); update();
      }
    });
    listen(rail, "focusout", event => { if (!rail.contains(event.relatedTarget)) rail.classList.remove("is-pointer-focused"); });
    listen(root, "blur", () => { finish(); rail.classList.remove("is-pointer-focused"); });
    listen(document, "visibilitychange", () => { if (document.hidden) finish(); });
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    observer?.observe(host); update();
    return Object.freeze({ update, destroy() { finish(); destroyed = true; abort.abort(); observer?.disconnect(); rail.remove(); } });
  }
  root.PortfolioRoadmapDensity = Object.freeze({ getHeight, setHeight, subscribe, attachControl, createNavigator });
})(globalThis);
