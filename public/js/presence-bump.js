/* A bounded, user-triggered walk between existing header characters. */
(function registerPresenceBump(root) {
  "use strict";
  const duration = 1100, maximumDistance = 220;

  function create({ shell, documentObject = root.document } = {}) {
    const view = documentObject?.defaultView || root, cleanup = [];
    let active = null, disposed = false;
    const reducedMotion = view.matchMedia?.("(prefers-reduced-motion: reduce)");
    const reduced = () => reducedMotion?.matches || documentObject?.documentElement?.classList.contains("preview-reduced-motion");
    const portrait = (node) => node?.matches?.(".presence-character") ? node : node?.querySelector?.(".presence-character");
    function listen(node, type, callback, options) {
      if (!node?.addEventListener) return;
      node.addEventListener(type, callback, options); cleanup.push(() => node.removeEventListener(type, callback, options));
    }
    function finish(record, completed) {
      if (active !== record) return;
      active = null;
      view.clearTimeout(record.collisionTimer); view.clearTimeout(record.safetyTimer);
      record.animation?.cancel();
      if (record.originalOpacity) record.source.style.setProperty("opacity", record.originalOpacity, record.opacityPriority);
      else record.source.style.removeProperty("opacity");
      if (!record.hadBumpClass) record.target.classList.remove("presence-is-bumped");
      record.actor.remove(); record.resolve(completed);
    }
    function cancel() { if (active) finish(active, false); }
    function visible(node, bounds) {
      const width = view.innerWidth || documentObject.documentElement?.clientWidth || Infinity;
      const height = view.innerHeight || documentObject.documentElement?.clientHeight || Infinity;
      return node.isConnected !== false && bounds.width > 0 && bounds.height > 0 && bounds.right > 0 && bounds.bottom > 0 && bounds.left < width && bounds.top < height;
    }
    function play({ from, target } = {}) {
      if (disposed || active || documentObject?.hidden || reduced() || !documentObject?.body?.append) return Promise.resolve(false);
      const source = portrait(from), destination = portrait(target);
      if (!source || !destination || source === destination || !shell?.contains(source) || !shell.contains(destination)) return Promise.resolve(false);
      const strip = source.closest?.(".master-presence-avatars");
      if (!strip || destination.closest?.(".master-presence-avatars") !== strip) return Promise.resolve(false);
      const start = source.getBoundingClientRect(), end = destination.getBoundingClientRect();
      if (!visible(source, start) || !visible(destination, end)) return Promise.resolve(false);
      const dx = end.left + end.width / 2 - start.left - start.width / 2;
      const dy = end.top + end.height / 2 - start.top - start.height / 2;
      if (Math.hypot(dx, dy) > maximumDistance || Math.abs(dx) < 5 || Math.abs(dy) > 35) return Promise.resolve(false);
      const actor = documentObject.createElement("span");
      if (typeof actor.animate !== "function") return Promise.resolve(false);
      actor.className = "presence-bump-actor"; actor.setAttribute("aria-hidden", "true");
      actor.style.left = `${start.left}px`; actor.style.top = `${start.top}px`;
      actor.style.width = `${start.width}px`; actor.style.height = `${start.height}px`;
      const clone = source.cloneNode(true);
      clone.removeAttribute("id"); clone.removeAttribute("title"); clone.setAttribute("aria-hidden", "true");
      for (const node of clone.querySelectorAll("[id], [tabindex]")) { node.removeAttribute("id"); node.removeAttribute("tabindex"); }
      clone.style.width = "100%"; clone.style.height = "100%"; clone.style.margin = "0"; clone.style.opacity = "1";
      actor.append(clone);
      const direction = dx < 0 ? -1 : 1, contact = dx - direction * Math.min(start.width * .42, 12);
      const position = (x, y, angle) => `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${angle}deg)`;
      const frames = [
        [0, 0, 0, 0], [.12, contact * .23, dy * .23 - 2, -7 * direction],
        [.24, contact * .46, dy * .46, 6 * direction], [.36, contact * .75, dy * .75 - 2, -6 * direction],
        [.44, contact, dy, 7 * direction], [.50, contact + 2 * direction, dy, 10 * direction],
        [.57, contact - 3 * direction, dy, -5 * direction], [.69, contact * .66, dy * .66 - 2, 7 * direction],
        [.81, contact * .33, dy * .33, -6 * direction], [.93, 0, -1.5, 4 * direction], [1, 0, 0, 0],
      ].map(([offset, x, y, angle]) => ({ offset, transform: position(x, y, angle) }));
      return new Promise((resolve) => {
        const record = { source, target: destination, actor, resolve,
          originalOpacity: source.style.getPropertyValue("opacity"), opacityPriority: source.style.getPropertyPriority("opacity"),
          hadBumpClass: destination.classList.contains("presence-is-bumped"), animation: null, collisionTimer: null, safetyTimer: null };
        active = record;
        try {
          documentObject.body.append(actor); source.style.setProperty("opacity", "0");
          record.animation = actor.animate(frames, { duration, easing: "linear", fill: "both" });
          record.collisionTimer = view.setTimeout(() => {
            if (active !== record) return;
            if (documentObject.hidden || reduced() || source.isConnected === false || destination.isConnected === false) { finish(record, false); return; }
            destination.classList.add("presence-is-bumped");
          }, duration * .44);
          record.safetyTimer = view.setTimeout(() => finish(record, true), duration + 150);
          record.animation.finished.then(() => finish(record, true), () => finish(record, false));
        } catch { finish(record, false); }
      });
    }
    listen(documentObject, "visibilitychange", () => { if (documentObject.hidden) cancel(); });
    listen(view, "resize", cancel, { passive: true });
    listen(documentObject, "scroll", cancel, { capture: true, passive: true });
    listen(reducedMotion, "change", () => { if (reduced()) cancel(); });
    const observer = shell && view.MutationObserver ? new view.MutationObserver(() => {
      if (active && (active.source.isConnected === false || active.target.isConnected === false || reduced())) cancel();
    }) : null;
    observer?.observe(shell, { childList: true, subtree: true });
    const preferenceObserver = documentObject?.documentElement && view.MutationObserver ? new view.MutationObserver(() => { if (reduced()) cancel(); }) : null;
    preferenceObserver?.observe(documentObject.documentElement, { attributes: true, attributeFilter: ["class"] });
    return Object.freeze({ play, cancel, destroy() {
      if (disposed) return;
      disposed = true; cancel(); observer?.disconnect(); preferenceObserver?.disconnect();
      for (const remove of cleanup) remove();
    } });
  }
  root.PortfolioPresenceBump = Object.freeze({ create });
})(globalThis);
