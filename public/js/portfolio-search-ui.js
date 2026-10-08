/* Product and SKU lookup across every category, alongside the current view filter. */
(function (root) {
  "use strict";
  const PAGE_SIZE = 8, MAX_RESULTS = 500;
  const text = (value) => String(value ?? "").trim();
  const key = (result) => JSON.stringify([result.categoryId, result.productId]);
  let active = null;

  function createController({ adapter = root.PortfolioSearchAdapter, model = root.PortfolioSearch, document: doc = root.document, eventTarget = root } = {}) {
    if (!adapter || !model?.search || !doc?.createElement) return null;
    const slots = [], removeListeners = [];
    let destroyed = false, navigating = false;
    const make = (tag, className, content) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (content !== undefined) node.textContent = String(content);
      return node;
    };
    const listen = (target, type, callback, removers = removeListeners) => {
      if (!target?.addEventListener) return;
      target.addEventListener(type, callback);
      removers.push(() => target.removeEventListener(type, callback));
    };
    const visible = (slot) => {
      const view = adapter.getActiveView?.() || "products";
      if ((view === "products") !== (slot.view === "products")) return false;
      for (let node = slot.input; node && node !== doc; node = node.parentNode) {
        if (node.hidden || node.classList?.contains("hidden") || node.getAttribute?.("aria-hidden") === "true") return false;
      }
      return slot.input.isConnected !== false;
    };
    const search = (query, limit, offset = 0) => model.search(adapter.getPortfolio?.(), query, {
      activeCategoryId: adapter.getActiveCategoryId?.(), limit, offset,
    });
    function close(slot) {
      slot.open = false; slot.activeIndex = -1;
      slot.panel.hidden = true;
      slot.input.setAttribute("aria-expanded", "false");
      slot.input.removeAttribute("aria-activedescendant");
      for (const node of slot.optionNodes) node.setAttribute("aria-selected", "false");
    }
    function fitPanel(slot) {
      const height = doc.defaultView?.innerHeight || root.innerHeight;
      const bottom = slot.shell.getBoundingClientRect?.().bottom;
      if (height && Number.isFinite(bottom)) slot.panel.style.setProperty("--portfolio-search-height", `${Math.min(320, Math.max(0, height - bottom - 12))}px`);
    }
    function setActive(slot, index, scroll = true) {
      slot.activeIndex = index;
      slot.optionNodes.forEach((node, position) => node.setAttribute("aria-selected", String(position === index)));
      const node = slot.optionNodes[index];
      if (node) {
        slot.input.setAttribute("aria-activedescendant", node.id);
        if (scroll) node.scrollIntoView?.({ block: "nearest" });
      } else slot.input.removeAttribute("aria-activedescendant");
    }
    function focusInput(slot) {
      slot.suppressFocus = true;
      try { slot.input.focus({ preventScroll: true }); } finally { slot.suppressFocus = false; }
    }
    function render(slot, keepActiveKey = "", preserveScroll = false) {
      const scrollTop = preserveScroll ? slot.panel.scrollTop : 0;
      for (const remove of slot.dynamicListeners.splice(0)) remove();
      slot.list.replaceChildren(); slot.optionNodes = [];
      const currentCategoryId = adapter.getActiveCategoryId?.();
      const count = slot.total === 1 ? "1 product" : `${slot.total} products`;
      slot.heading.textContent = `All categories · ${count}`;
      slot.summary.textContent = slot.results.length < slot.total ? `${slot.results.length} shown` : "";
      slot.feedback.textContent = slot.message || (slot.total ? "" : "No products found. Try a product name or SKU.");
      slot.feedback.hidden = !slot.feedback.textContent;
      slot.results.forEach((result, index) => {
        const option = make("li", "portfolio-search-option");
        option.id = `${slot.list.id}-option-${index}`;
        option.setAttribute("role", "option"); option.setAttribute("aria-selected", "false");
        const heading = make("div", "portfolio-search-product-heading");
        heading.append(make("span", "portfolio-search-product-name", text(result.productName) || "Untitled product"));
        if (result.categoryId === currentCategoryId) heading.append(make("span", "portfolio-search-current", "Current category"));
        option.append(heading);
        if (text(result.matchedSku)) {
          const sku = make("div", "portfolio-search-sku");
          sku.append(make("span", "portfolio-search-sku-label", result.matchType === "sku-exact" ? "Exact SKU" : "HP SKU"), make("span", "portfolio-search-sku-code", result.matchedSku));
          option.append(sku);
        } else if (text(result.matchedVariant)) option.append(make("div", "portfolio-search-variant", `Variant · ${result.matchedVariant}`));
        option.append(make("div", "portfolio-search-location", [text(result.categoryName), text(result.laneName)].filter(Boolean).join(" · ")));
        listen(option, "pointerdown", (event) => { if (event.button === 0 || event.button === undefined) event.preventDefault(); }, slot.dynamicListeners);
        listen(option, "click", () => choose(slot, result), slot.dynamicListeners);
        slot.list.append(option); slot.optionNodes.push(option);
      });
      const canShowMore = slot.results.length < Math.min(slot.total, MAX_RESULTS);
      slot.more.hidden = !canShowMore;
      slot.bound.textContent = slot.total > MAX_RESULTS && slot.results.length >= MAX_RESULTS ? "Showing the first 500 products. Refine your search for more specific results." : "";
      slot.bound.hidden = !slot.bound.textContent;
      const index = keepActiveKey ? slot.results.findIndex((result) => key(result) === keepActiveKey) : -1;
      setActive(slot, index, false);
      slot.panel.scrollTop = scrollTop;
      fitPanel(slot);
    }
    function refreshSlot(slot, { open = false, reset = false, message = "" } = {}) {
      if (destroyed || navigating || !visible(slot)) { close(slot); return false; }
      const query = text(slot.input.value);
      if (!query) { close(slot); slot.query = ""; slot.results = []; slot.total = 0; return false; }
      if (!slot.open && !open) return false;
      for (const other of slots) if (other !== slot) close(other);
      const keepActiveKey = !reset && slot.results[slot.activeIndex] ? key(slot.results[slot.activeIndex]) : "";
      const previousCount = query === slot.query && !reset ? slot.results.length : PAGE_SIZE;
      const limit = Math.min(MAX_RESULTS, Math.max(PAGE_SIZE, previousCount));
      const found = search(query, limit);
      slot.query = query; slot.results = found.results || []; slot.total = found.total || 0;
      slot.message = message; slot.open = true; slot.panel.hidden = false;
      slot.input.setAttribute("aria-expanded", "true");
      render(slot, keepActiveKey);
      if (doc.activeElement === slot.more && slot.more.hidden) focusInput(slot);
      return true;
    }
    function choose(slot, result) {
      if (destroyed || navigating || !slot.open || !visible(slot)) return false;
      if (text(slot.input.value) !== slot.query) {
        refreshSlot(slot, { reset: true, message: "The results changed. Choose a product again." }); return false;
      }
      const current = search(slot.query, MAX_RESULTS).results?.find((item) => key(item) === key(result));
      const portfolio = adapter.getPortfolio?.();
      const category = portfolio?.categories?.find((item) => item.id === result.categoryId);
      const exists = category?.board?.products?.some((item) => item.id === result.productId);
      if (!current || !exists) {
        refreshSlot(slot, { message: "The results changed. Choose a product again." }); return false;
      }
      navigating = true;
      slots.forEach(close);
      try { return adapter.openResult?.(current) !== false; }
      catch { return false; }
      finally { navigating = false; }
    }
    function showMore(slot) {
      if (destroyed || !slot.open || !visible(slot)) return false;
      if (text(slot.input.value) !== slot.query) return refreshSlot(slot, { reset: true });
      const previousCount = slot.results.length;
      if (previousCount >= Math.min(slot.total, MAX_RESULTS)) return false;
      const keepActiveKey = slot.results[slot.activeIndex] ? key(slot.results[slot.activeIndex]) : "";
      // Re-read all displayed rows so appending cannot preserve removed or reordered products.
      const found = search(slot.query, Math.min(MAX_RESULTS, previousCount + PAGE_SIZE));
      slot.results = found.results || []; slot.total = found.total || 0; slot.message = "";
      const hadMoreFocus = doc.activeElement === slot.more;
      render(slot, keepActiveKey, true);
      if (hadMoreFocus && slot.more.hidden) {
        focusInput(slot);
        setActive(slot, Math.min(previousCount, slot.results.length - 1));
      }
      return true;
    }
    function keydown(slot, event) {
      if (destroyed || navigating || !visible(slot) || event.isComposing) return;
      if (event.key === "Escape") {
        if (slot.open) { event.preventDefault(); event.stopPropagation?.(); close(slot); }
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!slot.open && !refreshSlot(slot, { open: true })) return;
        if (!slot.results.length) return;
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const index = slot.activeIndex === -1 ? (delta === 1 ? 0 : slot.results.length - 1) : (slot.activeIndex + delta + slot.results.length) % slot.results.length;
        setActive(slot, index);
      } else if (event.key === "Enter" && slot.open && slot.results.length) {
        event.preventDefault(); choose(slot, slot.results[Math.max(0, slot.activeIndex)]);
      } else if (event.key === "Tab") {
        // Keep the panel available for its Show more button; focusout closes when leaving it.
        slot.input.removeAttribute("aria-activedescendant");
      }
    }
    for (const [id, view] of [["searchInput", "products"], ["roadmapSearch", "roadmap"]]) {
      const input = doc.getElementById(id), label = input?.parentNode;
      if (!input || !label?.parentNode) continue;
      const shell = make("div", "portfolio-search-shell"), panel = make("div", "portfolio-search-panel");
      const header = make("div", "portfolio-search-header"), heading = make("span", "portfolio-search-heading"), summary = make("span", "portfolio-search-summary");
      const list = make("ul", "portfolio-search-results"), feedback = make("p", "portfolio-search-feedback");
      const more = make("button", "portfolio-search-more", "Show more"), bound = make("p", "portfolio-search-bound");
      list.id = `${id}AllCategoryResults`; list.setAttribute("role", "listbox"); list.setAttribute("aria-label", "Products in all categories");
      feedback.setAttribute("role", "status"); feedback.setAttribute("aria-live", "polite");
      heading.setAttribute("role", "status"); heading.setAttribute("aria-live", "polite");
      more.type = "button"; more.hidden = true; bound.hidden = true; panel.hidden = true;
      header.append(heading, summary); panel.append(header, feedback, list, more, bound);
      label.parentNode.insertBefore(shell, label); shell.append(label, panel);
      const attributes = new Map(["role", "aria-autocomplete", "aria-controls", "aria-haspopup", "aria-expanded", "aria-activedescendant"].map((name) => [name, input.getAttribute(name)]));
      input.setAttribute("role", "combobox"); input.setAttribute("aria-autocomplete", "list");
      input.setAttribute("aria-controls", list.id); input.setAttribute("aria-haspopup", "listbox"); input.setAttribute("aria-expanded", "false");
      const slot = { input, label, shell, panel, header, heading, summary, list, feedback, more, bound, attributes, view, open: false, activeIndex: -1, query: "", results: [], total: 0, message: "", optionNodes: [], dynamicListeners: [] };
      slots.push(slot);
      listen(input, "input", () => refreshSlot(slot, { open: true, reset: true }));
      listen(input, "search", () => { if (!text(input.value)) close(slot); });
      listen(input, "focus", () => { if (!slot.suppressFocus) refreshSlot(slot, { open: true }); });
      listen(input, "keydown", (event) => keydown(slot, event));
      listen(shell, "focusout", (event) => {
        if (event.relatedTarget && shell.contains(event.relatedTarget)) return;
        close(slot);
      });
      listen(more, "click", () => showMore(slot));
      listen(more, "keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault(); event.stopPropagation?.(); close(slot); focusInput(slot);
        }
      });
    }
    listen(doc, "pointerdown", (event) => { for (const slot of slots) if (slot.open && !slot.shell.contains(event.target)) close(slot); });
    listen(doc, "click", (event) => { for (const slot of slots) if (slot.open && !slot.shell.contains(event.target)) close(slot); });
    const refresh = () => { if (!destroyed) for (const slot of slots) refreshSlot(slot); };
    listen(eventTarget, "portfolio:render", refresh);
    listen(eventTarget, "resize", () => { for (const slot of slots) if (slot.open) fitPanel(slot); });
    const controller = {
      refresh,
      close() { if (destroyed) return false; slots.forEach(close); return true; },
      getState(id) {
        const states = slots.map((slot) => ({ inputId: slot.input.id, open: slot.open, query: slot.query, activeIndex: slot.activeIndex, results: slot.results.map((result) => ({ ...result })), total: slot.total }));
        return id ? states.find((state) => state.inputId === id) || null : { destroyed, inputs: states };
      },
      destroy() {
        if (destroyed) return false;
        destroyed = true;
        for (const remove of removeListeners.splice(0)) remove();
        for (const slot of slots) {
          close(slot);
          for (const remove of slot.dynamicListeners.splice(0)) remove();
          for (const [name, value] of slot.attributes) { if (value === null) slot.input.removeAttribute(name); else slot.input.setAttribute(name, value); }
          slot.shell.parentNode?.insertBefore(slot.label, slot.shell);
          slot.shell.remove();
        }
        if (active === controller) active = null;
        return true;
      },
    };
    return Object.freeze(controller);
  }
  function initialize(options = {}) { if (!active) active = createController(options); return active; }
  root.PortfolioSearchUI = Object.freeze({ createController, initialize, refresh() { active?.refresh(); }, close() { active?.close(); }, getState() { return active?.getState() || null; } });
  if (root.PortfolioSearchAdapter && root.document) initialize();
})(globalThis);
