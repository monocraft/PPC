/* Read-only product details shared by card companions and split view. */
(function (root) {
  "use strict";
  const states = new Map();
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const tone = (value) => /^#[\da-f]{6}$/i.test(value || "") ? value : "#393c40";
  const tabs = [["overview", "Overview"], ["skus", "HP SKUs"], ["more", "More"]];
  const dateKinds = new Set(["general-availability", "end-manufacturing", "ffs", "global-announcement", "web-readiness", "final-assets"]);
  const lifecycleKinds = new Set(["launch", "lifecycle-end", "stage", "confidence"]);
  const kindAttribute = (name, key, kinds) => kinds.has(key) ? ` data-${name}-kind="${key}"` : "";

  function stateFor(surface, productId) {
    let state = states.get(surface);
    if (!state) states.set(surface, state = { tab: "overview", more: "identity", pages: {}, productId });
    if (state.productId !== productId) { state.productId = productId; state.pages = {}; }
    if (!["identity", "source"].includes(state.more)) state.more = "identity";
    return state;
  }

  function colorIdentity(color) {
    if (color.id) return `id:${color.id}`;
    const name = color.code ? `code:${String(color.code).trim().toUpperCase()}` : `name:${String(color.label || "").trim().toLowerCase()}`;
    return `${name}:${tone(color.colorHex).toLowerCase()}:${tone(color.colorHex2 || color.colorHex).toLowerCase()}`;
  }

  function focusMatch(model, { surface = "split", sku = "", variant = "" } = {}) {
    const state = stateFor(surface === "viewer" ? "viewer" : "split", model.id);
    state.tab = "overview";
    state.pages = {};
    const code = (value) => String(value || "").normalize("NFKC").toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");
    if (sku) {
      const index = (model.skus || []).findIndex((item) => code(item.code) === code(sku));
      if (index >= 0) { state.tab = "skus"; state.pages.SKUs = Math.floor(index / 6); return; }
      const sourceIndex = (model.source?.records || []).findIndex((item) => code(item.code) === code(sku));
      if (sourceIndex >= 0) { state.tab = "more"; state.more = "source"; state.pages["source records"] = Math.floor(sourceIndex / 2); return; }
    }
    if (variant) {
      const assignedIndex = (model.skus || []).findIndex((item) => (item.colors || []).some((color) => code(color.code) === code(variant)));
      if (assignedIndex >= 0) { state.tab = "skus"; state.pages.SKUs = Math.floor(assignedIndex / 6); return; }
      const assignedColors = new Set((model.skus || []).flatMap((item) => (item.colors || []).map(colorIdentity)));
      const options = (model.variants || []).filter((item) => !item.colors?.length || item.colors.some((color) => !assignedColors.has(colorIdentity(color))));
      const index = options.findIndex((item) => code(item.code) === code(variant));
      if (index >= 0) { state.tab = "skus"; state.pages.options = Math.floor(index / 8); }
    }
  }

  function swatchHtml(color) {
    return `<i class="hp-sku-swatch ${color.colorHex2 ? "is-dual" : ""}" style="--sku-primary:${tone(color.colorHex)};--sku-secondary:${tone(color.colorHex2 || color.colorHex)}" aria-hidden="true"></i>`;
  }

  function colorsHtml(colors, showSwatches = true) {
    if (!colors?.length) return '<span class="hp-sku-color is-unassigned">Not assigned</span>';
    return colors.map((color) => `<span class="hp-sku-color">${showSwatches ? swatchHtml(color) : ""}<span>${escape(color.label || color.code)}</span></span>`).join("");
  }

  function skuIdentityHtml(item, option = false) {
    const hasColors = Boolean(item.colors?.length);
    const swatches = hasColors ? item.colors.map(swatchHtml).join("") : option ? `<span class="hp-sku-layout-code">${escape(item.code)}</span>` : '<i class="hp-sku-swatch is-unassigned"></i>';
    const name = hasColors || !option ? colorsHtml(item.colors, false) : `<span class="hp-sku-option-name">${escape(item.label || item.group)}</span>`;
    const caption = option && hasColors ? "Missing HP SKU" : item.group;
    const code = option ? `<div class="hp-sku-option-code"><strong>${escape(item.code)}</strong>${caption ? `<small>${escape(caption)}</small>` : ""}</div>` : `<strong class="hp-sku-code">${escape(item.code)}</strong>`;
    return `<div class="hp-sku-identity"><div class="hp-sku-swatches" aria-hidden="true">${swatches}</div><div class="hp-sku-info"><div class="hp-sku-colors">${name}</div>${code}${option && hasColors && item.label ? `<span class="hp-sku-option-name">${escape(item.label)}</span>` : ""}</div></div>`;
  }

  function render(model, { surface = "split" } = {}) {
    surface = surface === "viewer" ? "viewer" : "split";
    const state = stateFor(surface, model.id);
    const prefix = `product-detail-${surface}`;
    const field = (item) => `<div class="product-detail-date"${kindAttribute("date", item.key, dateKinds)}><span>${escape(item.label)}</span><strong class="${item.empty ? "is-muted" : ""}">${escape(item.value)}</strong></div>`;
    function pages(name, entries, size, itemHtml, empty) {
      const total = Math.max(1, Math.ceil(entries.length / size));
      const current = Math.min(state.pages[name] || 0, total - 1);
      state.pages[name] = current;
      const content = entries.length ? Array.from({ length: total }, (_, index) => `<div class="product-detail-page ${index === current ? "" : "hidden"}" data-detail-page-name="${name}" data-detail-page-index="${index}" role="group" tabindex="0" aria-label="${escape(name)} page ${index + 1}">${itemHtml(entries.slice(index * size, (index + 1) * size))}</div>`).join("") : `<div class="product-detail-empty">${escape(empty)}</div>`;
      return `<div class="product-detail-paged" data-detail-page-group="${name}">${content}${total > 1 ? `<div class="product-detail-pagination"><button type="button" data-detail-page-step="-1" ${current === 0 ? "disabled" : ""} aria-label="Previous ${name}">‹</button><span data-detail-page-label aria-live="polite">${current + 1} / ${total} · ${entries.length} ${escape(name)}</span><button type="button" data-detail-page-step="1" ${current === total - 1 ? "disabled" : ""} aria-label="Next ${name}">›</button></div>` : ""}</div>`;
    }
    const skuPages = pages("SKUs", model.skus || [], 6, (items) => `<ul class="hp-sku-grid" aria-label="HP SKUs">${items.map((item) => `<li class="hp-sku-entry">${skuIdentityHtml(item)}<button type="button" class="hp-sku-copy" data-detail-copy="${escape(item.code)}" aria-label="Copy HP SKU ${escape(item.code)}"><small>Copy</small></button></li>`).join("")}</ul>`, "No HP SKUs assigned.");
    const specs = model.specs?.length ? `<dl class="product-detail-specs">${model.specs.map((item) => `<div><dt>${escape(item.label || "Specification")}</dt><dd>${escape(item.value || "—")}</dd></div>`).join("")}</dl>` : '<div class="product-detail-empty">No specifications assigned.</div>';
    const assignedColors = new Set((model.skus || []).flatMap((item) => (item.colors || []).map(colorIdentity)));
    const options = (model.variants || []).filter((item) => !item.colors?.length || item.colors.some((color) => !assignedColors.has(colorIdentity(color))));
    const optionPages = options.length ? `<div class="product-detail-list-heading"><h3 class="product-detail-section-title">Additional options<span class="product-detail-count">${options.length}</span></h3></div>${pages("options", options, 8, (items) => `<div class="product-detail-options"><ul class="hp-sku-grid" aria-label="Additional options">${items.map((item) => `<li class="hp-sku-option">${skuIdentityHtml(item, true)}</li>`).join("")}</ul></div>`, "")}` : "";
    const sourcePages = pages("source records", model.source?.records || [], 2, (items) => `<div class="product-detail-source-records">${items.map((item) => `<div><strong>${escape(item.code)}</strong><span>${escape(item.description)}</span><small>GA ${escape(item.ga)} · EM ${escape(item.em)}</small></div>`).join("")}</div>`, "No ASCM source attached.");
    const panels = {
      overview: `<div class="product-detail-overview-grid"><div class="product-detail-calendar" role="group" tabindex="0" aria-label="Key dates and lifecycle"><h3 class="product-detail-section-title">Key dates</h3><div class="product-detail-dates">${(model.dates || []).map(field).join("")}</div><div class="product-detail-lifecycle-summary"><h3 class="product-detail-section-title">Lifecycle</h3><div class="product-detail-lifecycle">${(model.lifecycle || []).map((item) => `<span${kindAttribute("lifecycle", item.key, lifecycleKinds)}><small>${escape(item.label)}</small><strong>${escape(item.value)}</strong></span>`).join("")}</div></div></div><div class="product-detail-all-specs"><h3 class="product-detail-section-title">Specifications<span class="product-detail-count">${model.specs?.length || 0}</span></h3><div class="product-detail-spec-scroll" role="group" tabindex="0" aria-label="All product specifications">${specs}</div></div></div>`,
      skus: `<div class="product-detail-list-heading"><h3 class="product-detail-section-title">HP part numbers<span class="product-detail-count">${model.skus?.length || 0}</span></h3><span>Copy a SKU to use it elsewhere</span></div><div class="product-detail-sku-content">${skuPages}${optionPages}</div>`,
      more: `<div class="product-detail-more-tabs" role="tablist" aria-label="Additional product information">${[["identity", "Identity"], ["source", "Source"]].map(([key, label]) => `<button type="button" role="tab" id="${prefix}-${key}-tab" data-detail-more="${key}" aria-controls="${prefix}-${key}" aria-selected="${state.more === key}" tabindex="${state.more === key ? 0 : -1}">${label}</button>`).join("")}</div><div id="${prefix}-identity" role="tabpanel" aria-labelledby="${prefix}-identity-tab" data-detail-more-panel="identity" class="${state.more === "identity" ? "" : "hidden"}"><div class="product-detail-identity">${(model.identity || []).map(field).join("")}</div></div><div id="${prefix}-source" role="tabpanel" aria-labelledby="${prefix}-source-tab" data-detail-more-panel="source" class="${state.more === "source" ? "" : "hidden"}">${model.source?.records?.length ? `<p class="product-detail-source-meta">${escape(model.source.category)} · Imported ${escape(model.source.imported)}<br>${model.source.records.length} source records</p>` : ""}${sourcePages}</div>`,
    };
    return `<div class="product-details product-detail-workspace" data-detail-surface="${surface}" data-detail-product="${escape(model.id)}"><div class="product-detail-tabs" role="tablist" aria-label="Product details">${tabs.map(([key, label]) => `<button type="button" role="tab" id="${prefix}-${key}-tab" data-detail-tab="${key}" aria-controls="${prefix}-${key}" aria-selected="${state.tab === key}" tabindex="${state.tab === key ? 0 : -1}" class="${state.tab === key ? "is-active" : ""}">${label}</button>`).join("")}</div>${tabs.map(([key]) => `<section id="${prefix}-${key}" class="product-detail-panel ${state.tab === key ? "" : "hidden"}" role="tabpanel" aria-labelledby="${prefix}-${key}-tab" data-detail-panel="${key}" tabindex="0">${panels[key]}</section>`).join("")}<span class="visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-detail-copy-status></span></div>`;
  }

  function bind(container, { onCopy, onClose } = {}) {
    const workspace = container.querySelector("[data-detail-surface]");
    if (!workspace) return;
    const state = stateFor(workspace.dataset.detailSurface, workspace.dataset.detailProduct);
    function bindTabs(selector, panelSelector, key, attribute) {
      const buttons = [...workspace.querySelectorAll(selector)];
      function select(button, focus = false) {
        state[key] = button.dataset[attribute];
        for (const item of buttons) {
          const selected = item === button;
          item.setAttribute("aria-selected", String(selected));
          item.classList.toggle("is-active", selected);
          item.tabIndex = selected ? 0 : -1;
        }
        for (const panel of workspace.querySelectorAll(panelSelector)) {
          const panelKey = key === "tab" ? panel.dataset.detailPanel : panel.dataset.detailMorePanel;
          panel.classList.toggle("hidden", panelKey !== state[key]);
        }
        if (focus) button.focus();
      }
      buttons.forEach((button, index) => {
        button.addEventListener("click", () => select(button));
        button.addEventListener("keydown", (event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowLeft" ? -1 : 1) + buttons.length) % buttons.length;
          select(buttons[next], true);
        });
      });
    }
    bindTabs("[data-detail-tab]", "[data-detail-panel]", "tab", "detailTab");
    bindTabs("[data-detail-more]", "[data-detail-more-panel]", "more", "detailMore");
    workspace.querySelectorAll("[data-detail-page-group]").forEach((group) => {
      const name = group.dataset.detailPageGroup;
      const entries = [...group.querySelectorAll("[data-detail-page-index]")];
      group.querySelectorAll("[data-detail-page-step]").forEach((button) => button.addEventListener("click", () => {
        const current = Math.max(0, Math.min(entries.length - 1, (state.pages[name] || 0) + Number(button.dataset.detailPageStep)));
        state.pages[name] = current;
        entries.forEach((entry, index) => entry.classList.toggle("hidden", index !== current));
        group.querySelector("[data-detail-page-label]").textContent = `${current + 1} / ${entries.length} · ${group.querySelector("[data-detail-page-label]").textContent.split(" · ")[1]}`;
        group.querySelector('[data-detail-page-step="-1"]').disabled = current === 0;
        group.querySelector('[data-detail-page-step="1"]').disabled = current === entries.length - 1;
      }));
    });
    const copyStatus = workspace.querySelector("[data-detail-copy-status]");
    workspace.querySelectorAll("[data-detail-copy]").forEach((button) => {
      const label = button.querySelector("small");
      const row = button.closest(".hp-sku-entry");
      let resetTimer, pulse, request = 0;
      button.addEventListener("click", async () => {
        const current = ++request;
        clearTimeout(resetTimer);
        pulse?.cancel();
        let copied = false;
        try { copied = Boolean(await onCopy?.(button.dataset.detailCopy)); } catch { /* Show failure feedback when clipboard access fails. */ }
        if (current !== request || !label.isConnected) return;
        label.textContent = copied ? "Copied" : "Failed";
        button.setAttribute("aria-label", `${copied ? "Copied" : "Failed to copy"} HP SKU ${button.dataset.detailCopy}`);
        button.classList.toggle("is-copied", copied);
        row?.classList.toggle("is-copied", copied);
        if (copyStatus) copyStatus.textContent = copied ? `HP SKU ${button.dataset.detailCopy} copied.` : `Could not copy HP SKU ${button.dataset.detailCopy}. Try again.`;
        if (copied && !root.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
          pulse = row?.animate?.([{ backgroundColor: "var(--palette-indigo-dark)" }, { backgroundColor: "#34453a", offset: 0.25 }, { backgroundColor: "var(--palette-indigo-dark)" }], { duration: 700, easing: "ease-out" });
        }
        resetTimer = setTimeout(() => {
          if (!label.isConnected) return;
          label.textContent = "Copy";
          button.setAttribute("aria-label", `Copy HP SKU ${button.dataset.detailCopy}`);
          button.classList.toggle("is-copied", false);
          row?.classList.toggle("is-copied", false);
        }, 1100);
      });
    });
    container.querySelector("[data-detail-close]")?.addEventListener("click", () => onClose?.());
  }

  root.PortfolioDetails = Object.freeze({ render, bind, focusMatch });
})(globalThis);
