/* Compact spatial overview. Navigation changes the view, never product records. */
(function (root) {
  "use strict";
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  function create(element, options) {
    const range = element.querySelector(".nav-range");
    const abort = new AbortController();
    const make = (tag, className) => { const value = document.createElement(tag); value.className = className; return value; };
    const overview = make("div", "nav-overview");
    const silhouettes = make("span", "nav-silhouettes");
    silhouettes.setAttribute("aria-hidden", "true");
    const window = make("span", "nav-window");
    const grip = make("span", "nav-window-grip");
    grip.setAttribute("aria-hidden", "true");
    const hint = make("span", "visually-hidden");
    hint.id = `${element.id}-hint`;
    hint.textContent = "Drag to scroll · Drag edges to zoom";
    const handles = ["left", "right"].map(edge => {
      const handle = make("button", `nav-window-handle nav-window-${edge}`);
      handle.type = "button";
      handle.dataset.edge = edge;
      handle.setAttribute("role", "slider");
      handle.setAttribute("aria-label", `Resize visible area from ${edge}`);
      handle.setAttribute("aria-orientation", "horizontal");
      handle.setAttribute("aria-describedby", hint.id);
      return handle;
    });
    range.before(overview);
    overview.append(silhouettes, range, window, hint);
    window.append(grip, ...handles);
    range.setAttribute("aria-describedby", hint.id);
    element.classList.add("has-overview");
    let gesture = null, signature = "", destroyed = false;
    const listen = (target, name, fn) => target.addEventListener(name, fn, { signal: abort.signal });
    function state() {
      const value = options.getState();
      const total = Math.max(1, number(value.total, 1));
      const visible = clamp(number(value.visible, total), 1, total);
      return { ...value, total, visible, left: clamp(number(value.left), 0, total - visible), scale: Math.max(.001, number(value.scale, 1)) };
    }
    function update() {
      if (destroyed) return;
      const value = state(), first = value.left / value.total, span = value.visible / value.total;
      const items = value.items || [];
      element.classList.toggle("hidden", !items.length && value.total <= value.visible + 2);
      window.style.left = `${first * 100}%`;
      window.style.width = `${span * 100}%`;
      const description = `Viewing ${Math.round(first * 100)}% to ${Math.round((first + span) * 100)}%`;
      range.setAttribute("aria-valuetext", description);
      range.step = String(Math.max(1, Math.round((value.total - value.visible) / 100)));
      range.disabled = value.total <= value.visible + 2;
      overview.classList.toggle("is-fit", range.disabled);
      overview.classList.toggle("is-narrow", span * overview.clientWidth < 32);
      for (const [index, handle] of handles.entries()) {
        handle.setAttribute("aria-valuemin", "0");
        handle.setAttribute("aria-valuemax", "100");
        handle.setAttribute("aria-valuenow", String(Math.round((first + (index ? span : 0)) * 100)));
        handle.setAttribute("aria-valuetext", `${description}; zoom ${Math.round(value.scale * 100)}%`);
      }
      // Scrolling only moves the window; the miniature changes with card geometry.
      const next = JSON.stringify([value.total, value.height, items]);
      if (next === signature) return;
      signature = next;
      const height = Math.max(1, number(value.height, 1));
      const fragment = document.createDocumentFragment();
      for (const item of items) {
        const left = clamp(number(item.x) / value.total, 0, 1);
        const width = clamp(number(item.width) / value.total, 0, 1 - left);
        if (!width) continue;
        const shape = make("i", item.selected ? "nav-silhouette is-selected" : "nav-silhouette");
        shape.style.left = `${left * 100}%`;
        shape.style.width = `${width * 100}%`;
        shape.style.top = `${clamp(number(item.y) / height, 0, .9) * 100}%`;
        shape.style.height = `${clamp(number(item.height) / height, .12, 1) * 100}%`;
        fragment.append(shape);
      }
      silhouettes.replaceChildren(fragment);
    }
    function resize(edge, fraction, initial) {
      const first = initial.left / initial.total, last = (initial.left + initial.visible) / initial.total;
      const span = edge === "left" ? last - fraction : fraction - first;
      const scale = clamp(initial.scale * initial.visible / initial.total / Math.max(.001, span), initial.minScale, initial.maxScale);
      const anchor = (initial.left + (edge === "left" ? initial.visible : 0)) / initial.scale;
      options.onResize?.({ scale, edge, anchor });
      update();
    }
    const pointerFraction = (event, rect) => clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    listen(overview, "pointerdown", event => {
      if (event.isPrimary === false || event.button !== 0 || gesture) return;
      const initial = state(), rect = overview.getBoundingClientRect();
      if (rect.width <= 0) return;
      const fraction = pointerFraction(event, rect);
      const edge = event.target.closest?.(".nav-window-handle")?.dataset.edge;
      const x = fraction * initial.total;
      const inside = x >= initial.left && x <= initial.left + initial.visible;
      gesture = { id: event.pointerId, edge, initial, rect, offset: inside ? x - initial.left : initial.visible / 2 };
      event.preventDefault();
      overview.classList.add("is-pointer-focused");
      if (edge) handles[edge === "left" ? 0 : 1].focus({ preventScroll: true });
      else range.focus({ preventScroll: true });
      overview.setPointerCapture(event.pointerId);
      overview.classList.add("is-dragging");
      if (!edge && !inside) { options.onPan(clamp(x - gesture.offset, 0, initial.total - initial.visible)); update(); }
    });
    listen(overview, "pointermove", event => {
      if (!gesture || gesture.id !== event.pointerId) return;
      event.preventDefault();
      const fraction = pointerFraction(event, gesture.rect);
      if (gesture.edge) resize(gesture.edge, fraction, gesture.initial);
      else { const value = state(); options.onPan(clamp(fraction * value.total - gesture.offset, 0, value.total - value.visible)); update(); }
    });
    function finish(event) {
      if (!gesture || (event.pointerId !== undefined && gesture.id !== event.pointerId)) return;
      const id = gesture.id;
      gesture = null;
      overview.classList.remove("is-dragging");
      if (overview.hasPointerCapture(id)) overview.releasePointerCapture(id);
    }
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) listen(overview, event, finish);
    listen(overview, "keydown", event => {
      overview.classList.remove("is-pointer-focused");
      if (event.key === "Escape") { finish(event); return; }
      const edge = event.target.dataset.edge;
      if (!edge || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const initial = state();
      const direction = (event.key === "ArrowLeft" ? -1 : 1) * (edge === "left" ? 1 : -1);
      const nextScale = clamp(Math.round((initial.scale + direction * (event.shiftKey ? .5 : .1)) * 100) / 100, initial.minScale, initial.maxScale);
      const span = initial.scale * initial.visible / initial.total / nextScale;
      const fraction = event.key === "Home" ? 0 : event.key === "End" ? 1 : edge === "left" ? (initial.left + initial.visible) / initial.total - span : initial.left / initial.total + span;
      resize(edge, fraction, initial);
    });
    listen(overview, "focusout", event => { if (!overview.contains(event.relatedTarget)) overview.classList.remove("is-pointer-focused"); });
    listen(root, "blur", event => { finish(event); overview.classList.remove("is-pointer-focused"); });
    return Object.freeze({ update, destroy() { finish({}); destroyed = true; abort.abort(); overview.before(range); overview.remove(); element.classList.remove("has-overview"); range.removeAttribute("aria-describedby"); } });
  }
  root.PortfolioNavigator = Object.freeze({ create });
})(globalThis);
