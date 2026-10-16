/* Small, local view state and bounded rendering work. No portfolio data is stored here. */
(function (root) {
  "use strict";

  function frameTask(callback, { request = requestAnimationFrame, cancel = cancelAnimationFrame } = {}) {
    let frame = null;
    const schedule = () => {
      if (frame !== null) return;
      frame = request(() => { frame = null; callback(); });
    };
    schedule.cancel = () => { if (frame !== null) cancel(frame); frame = null; };
    return schedule;
  }

  function categoryTransition(element) {
    const win = element?.ownerDocument?.defaultView || root;
    let active = null, cleanup = null;
    function release() {
      cleanup?.(); cleanup = null;
    }
    function cancel() {
      const animation = active;
      active = null;
      release();
      if (animation) {
        animation.onfinish = null; animation.oncancel = null;
        animation.cancel?.();
      }
    }
    function reveal() {
      cancel();
      const media = win.matchMedia?.("(prefers-reduced-motion: reduce)");
      if (media?.matches || typeof element?.animate !== "function") return false;
      let animation;
      try {
        animation = element.animate([{ opacity: .45 }, { opacity: 1 }], {
          duration: 180, easing: "cubic-bezier(.22,1,.36,1)",
        });
      } catch (_) { return false; }
      if (!animation) return false;
      active = animation;
      const removers = [];
      const listen = (target, name, handler, options) => {
        if (typeof target?.addEventListener !== "function") return;
        target.addEventListener(name, handler, options);
        removers.push(() => target.removeEventListener?.(name, handler, options));
      };
      const interrupt = () => { if (active === animation) cancel(); };
      listen(element, "wheel", interrupt, { capture: true, passive: true });
      listen(element, "pointerdown", interrupt, { capture: true, passive: true });
      listen(element, "keydown", interrupt, { capture: true });
      listen(win, "blur", interrupt);
      const reduceMotion = event => { if (event.matches) interrupt(); };
      if (typeof media?.addEventListener === "function") listen(media, "change", reduceMotion);
      else if (typeof media?.addListener === "function") {
        media.addListener(reduceMotion);
        removers.push(() => media.removeListener?.(reduceMotion));
      }
      cleanup = () => removers.forEach(remove => remove());
      const finish = () => {
        if (active !== animation) return;
        active = null; release();
        animation.onfinish = null; animation.oncancel = null;
      };
      animation.onfinish = finish; animation.oncancel = finish;
      return true;
    }
    return Object.freeze({ reveal, cancel });
  }

  function preferences({ key, storage, maxCategories = 100 }) {
    let values = null;
    const scale = (value, minimum) => Number.isFinite(value) && value >= minimum && value <= 2 ? Math.round(value * 10) / 10 : null;
    const clean = (entry) => {
      if (!entry || typeof entry !== "object") return null;
      const productZoom = scale(entry.productZoom, .2), roadmapZoom = scale(entry.roadmapZoom, .1);
      return productZoom !== null && roadmapZoom !== null ? { productZoom, roadmapZoom } : null;
    };
    function read() {
      if (values) return values;
      values = new Map();
      try {
        const raw = storage()?.getItem(key);
        if (!raw || raw.length > 32768) return values;
        const parsed = JSON.parse(raw);
        if (parsed?.version !== 1 || !Array.isArray(parsed.categories)) return values;
        for (const [id, entry] of parsed.categories.slice(0, maxCategories)) {
          const next = clean(entry);
          if (typeof id === "string" && id.length <= 200 && next) values.set(id, next);
        }
      } catch (_) { /* A blocked preference store cannot prevent opening the workspace. */ }
      return values;
    }
    return Object.freeze({
      get(id) { const entry = read().get(id); return entry ? { ...entry } : null; },
      set(id, entry) {
        const next = clean(entry);
        if (typeof id !== "string" || !id || id.length > 200 || !next) return false;
        const records = read(); records.delete(id); records.set(id, next);
        while (records.size > maxCategories) records.delete(records.keys().next().value);
        try { storage()?.setItem(key, JSON.stringify({ version: 1, categories: [...records] })); } catch (_) {}
        return true;
      },
    });
  }

  function navigation({ key, storage, fallbackStorage } = {}) {
    let loaded = false, current = null;
    const validKey = typeof key === "string" && key.length > 0 && key.length <= 200;
    const clean = value => value && typeof value === "object" && !Array.isArray(value)
      && ["products", "roadmap"].includes(value.view) && ["lifecycle", "ffs"].includes(value.basis) && typeof value.detailsOpen === "boolean"
      ? { view: value.view, basis: value.basis, detailsOpen: value.detailsOpen } : null;
    const bounded = raw => {
      if (typeof raw !== "string" || !raw || raw.length > 4096) return false;
      let bytes = 0;
      for (const character of raw) {
        const code = character.codePointAt(0);
        bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
        if (bytes > 4096) return false;
      }
      return true;
    };
    const store = () => typeof storage === "function" ? storage() : storage;
    return Object.freeze({
      get() {
        if (!loaded) {
          loaded = true;
          try {
            let raw = validKey && store()?.getItem(key);
            if(!raw && fallbackStorage){const fallback=typeof fallbackStorage==='function'?fallbackStorage():fallbackStorage;raw=fallback?.getItem(key);}
            if (bounded(raw)) { const parsed = JSON.parse(raw); if (parsed?.version === 1) current = clean(parsed); }
          } catch (_) { /* Navigation preferences cannot prevent opening working data. */ }
        }
        return current ? { ...current } : null;
      },
      set(value) {
        const next = clean(value);
        if (!validKey || !next) return false;
        loaded = true; current = next;
        // A refresh immediately after a view switch must not wait for data-save debounce.
        try { store()?.setItem(key, JSON.stringify({ version: 1, ...next })); } catch (_) {}
        return true;
      },
    });
  }

  const layouts = new WeakMap();
  const panels = new WeakMap();
  const panelCache = Object.freeze({
    unchanged(container, signature) { return container.childElementCount > 0 && panels.get(container) === signature; },
    remember(container, signature) { panels.set(container, signature); },
    clear(container) { panels.delete(container); },
  });
  const layoutCache = Object.freeze({
    get(board, key) { const entry = layouts.get(board); return entry?.key === key && entry.products === board.products && entry.lanes === board.lanes ? entry.value : null; },
    set(board, key, value) { layouts.set(board, { key, products: board.products, lanes: board.lanes, value }); return value; },
  });

  function stickyHeader(canvas, scroll, height) {
    const overlay = document.createElement("canvas");
    overlay.className = "roadmap-header-overlay"; overlay.setAttribute("aria-hidden", "true");
    scroll.parentElement.append(overlay);
    return Object.freeze({ sync() {
      const dpr = root.devicePixelRatio || 1, width = Math.max(1, scroll.clientWidth);
      const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
      if (overlay.width !== pixelWidth) overlay.width = pixelWidth;
      if (overlay.height !== pixelHeight) overlay.height = pixelHeight;
      overlay.style.left = `${scroll.offsetLeft}px`; overlay.style.top = `${scroll.offsetTop}px`;
      overlay.style.width = `${width}px`; overlay.style.height = `${height}px`;
      const context = overlay.getContext("2d");
      context.clearRect(0, 0, pixelWidth, pixelHeight);
      const source = canvas._ppcViewportLayer || canvas;
      const sourceLeft = canvas._ppcViewportLayer ? 0 : Math.round(scroll.scrollLeft * dpr);
      const sourceTop = canvas._ppcViewportLayer ? 0 : Math.round(scroll.scrollTop * dpr);
      context.drawImage(source, sourceLeft, sourceTop, pixelWidth, pixelHeight, 0, 0, pixelWidth, pixelHeight);
    } });
  }

  function cardHover(canvas, scroll, { getCards, getOwner, getZoom, isSuspended }) {
    const clip = document.createElement("div"), frame = document.createElement("div");
    clip.className = "product-card-hover-clip"; frame.className = "product-card-hover-frame";
    // A small, reused decorative pool: no per-card DOM or continuous animation loop.
    for (let index = 0; index < 16; index++) {
      const pixel = document.createElement("span");
      pixel.className = "product-card-dissolve-pixel";
      pixel.style.cssText = `--pixel-left:${5 + index * 6}%;--pixel-size:${3 + index % 4}px;--pixel-x:${(index % 5 - 2) * 9}px;--pixel-y:${22 + index % 4 * 8}px;--pixel-delay:${index % 4 * 45}ms;`;
      frame.append(pixel);
    }
    clip.setAttribute("aria-hidden", "true"); clip.append(frame); scroll.parentElement.append(clip);
    let pointer = null, productId = "", owner = getOwner(), previousLeft = scroll.scrollLeft, previousTop = scroll.scrollTop, previousZoom = getZoom();
    const release = frameTask(() => frame.classList.remove("is-immediate"));
    function clear() { pointer = null; productId = ""; frame.style.opacity = "0"; frame.classList.remove("is-disintegrating"); canvas.title = ""; }
    function sync() {
      if (owner !== getOwner()) { owner = getOwner(); clear(); }
      clip.style.left = `${scroll.offsetLeft}px`; clip.style.top = `${scroll.offsetTop}px`;
      clip.style.width = `${scroll.clientWidth}px`; clip.style.height = `${scroll.clientHeight}px`;
      if (!pointer || isSuspended()) { clear(); return; }
      const viewport = scroll.getBoundingClientRect(), zoom = getZoom();
      const x = pointer.x - viewport.left - scroll.clientLeft, y = pointer.y - viewport.top - scroll.clientTop;
      const px = (x + scroll.scrollLeft) / zoom, py = (y + scroll.scrollTop) / zoom;
      const card = x >= 0 && y >= 0 && x < scroll.clientWidth && y < scroll.clientHeight
        ? getCards().find(item => px >= item.x && px < item.x + item.width && py >= item.y && py < item.y + item.height) : null;
      if (!card) { clear(); return; }
      const changed = productId !== card.productId;
      if (changed || !card.discontinued) frame.classList.remove("is-disintegrating");
      const immediate = !productId || previousLeft !== scroll.scrollLeft || previousTop !== scroll.scrollTop || previousZoom !== zoom;
      previousLeft = scroll.scrollLeft; previousTop = scroll.scrollTop; previousZoom = zoom;
      if (immediate) { frame.classList.add("is-immediate"); release(); }
      frame.style.transform = `translate3d(${card.x * zoom - scroll.scrollLeft}px, ${card.y * zoom - scroll.scrollTop}px, 0)`;
      frame.style.width = `${card.width * zoom}px`; frame.style.height = `${card.height * zoom}px`;
      frame.style.borderColor = !card.discontinued && root.PortfolioTheme?.productCardStyles?.[card.cardStage]?.muted || "";
      if (immediate || (changed && card.discontinued)) void frame.offsetHeight;
      if (changed && card.discontinued) frame.classList.add("is-disintegrating");
      frame.style.opacity = card.discontinued ? ".4" : "1"; productId = card.productId; frame.dataset.productId = productId;
      canvas.title = card.name || "";
    }
    const schedule = frameTask(sync);
    scroll.addEventListener("pointermove", event => {
      if (event.pointerType === "touch" || event.isPrimary === false) { clear(); return; }
      pointer = { x: event.clientX, y: event.clientY }; schedule();
    });
    scroll.addEventListener("pointerleave", clear);
    ["pointerdown", "pointercancel", "lostpointercapture"].forEach(name => scroll.addEventListener(name, clear));
    root.addEventListener("blur", clear);
    return Object.freeze({ sync, clear });
  }

  root.PortfolioViewRuntime = Object.freeze({ frameTask, categoryTransition, preferences, navigation, layoutCache, panelCache, stickyHeader, cardHover });
})(globalThis);
