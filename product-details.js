/* Read-only product details shared by card companions and split view. */
(function (root) {
  "use strict";
  const states = new Map();
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const tone = (value) => /^#[\da-f]{6}$/i.test(value || "") ? value : "#393c40";
  const tabs = [["overview", "Overview"], ["skus", "HP SKUs"], ["more", "More"]];

  function stateFor(surface, productId) {
    let state = states.get(surface);
    if (!state) states.set(surface, state = { tab: "overview", more: "identity", pages: {}, productId });
    if (state.productId !== productId) { state.productId = productId; state.pages = {}; }
    return state;
  }

  function colorsHtml(colors) {
    if (!colors?.length) return '<span class="hp-sku-color is-unassigned">Not assigned</span>';
    return colors.map((color) => `<span class="hp-sku-color"><i class="hp-sku-swatch ${color.colorHex2 ? "is-dual" : ""}" style="--sku-primary:${tone(color.colorHex)};--sku-secondary:${tone(color.colorHex2 || color.colorHex)}" aria-hidden="true"></i><span>${escape(color.label || color.code)}</span></span>`).join("");
  }

  function render(model, { surface = "split" } = {}) {
    surface = surface === "viewer" ? "viewer" : "split";
    const state = stateFor(surface, model.id);
    const prefix = `product-detail-${surface}`;
    const field = (item) => `<div class="product-detail-date"><span>${escape(item.label)}</span><strong class="${item.empty ? "is-muted" : ""}">${escape(item.value)}</strong></div>`;
    function pages(name, entries, size, itemHtml, empty) {
      const total = Math.max(1, Math.ceil(entries.length / size));
      const current = Math.min(state.pages[name] || 0, total - 1);
      state.pages[name] = current;
      const content = entries.length ? Array.from({ length: total }, (_, index) => `<div class="product-detail-page ${index === current ? "" : "hidden"}" data-detail-page-name="${name}" data-detail-page-index="${index}" role="group" tabindex="0" aria-label="${escape(name)} page ${index + 1}">${itemHtml(entries.slice(index * size, (index + 1) * size))}</div>`).join("") : `<div class="product-detail-empty">${escape(empty)}</div>`;
      return `<div class="product-detail-paged" data-detail-page-group="${name}">${content}${total > 1 ? `<div class="product-detail-pagination"><button type="button" data-detail-page-step="-1" ${current === 0 ? "disabled" : ""} aria-label="Previous ${name}">‹</button><span data-detail-page-label aria-live="polite">${current + 1} / ${total} · ${entries.length} ${escape(name)}</span><button type="button" data-detail-page-step="1" ${current === total - 1 ? "disabled" : ""} aria-label="Next ${name}">›</button></div>` : ""}</div>`;
    }
    const skuPages = pages("SKUs", model.skus || [], 5, (items) => `<table class="hp-sku-table"><thead><tr><th>Color</th><th>HP SKU</th><th><span class="visually-hidden">Copy</span></th></tr></thead><tbody>${items.map((item) => `<tr class="hp-sku-entry"><td>${colorsHtml(item.colors)}</td><td class="hp-sku-code">${escape(item.code)}</td><td><button type="button" class="hp-sku-copy" data-detail-copy="${escape(item.code)}" aria-label="Copy HP SKU ${escape(item.code)}"><small>Copy</small></button></td></tr>`).join("")}</tbody></table>`, "No HP SKUs assigned.");
    const specs = model.specs?.length ? `<dl class="product-detail-specs">${model.specs.map((item) => `<div><dt>${escape(item.label || "Specification")}</dt><dd>${escape(item.value || "—")}</dd></div>`).join("")}</dl>` : '<div class="product-detail-empty">No specifications assigned.</div>';
    const variantPages = pages("variants", model.variants || [], 8, (items) => `<div class="product-detail-variants">${items.map((item) => `<div><small>${escape(item.group)}</small>${item.colors?.length ? colorsHtml(item.colors) : ""}<strong>${escape(item.code)}</strong>${item.label ? `<span>${escape(item.label)}</span>` : ""}</div>`).join("")}</div>`, "No variants assigned.");
    const sourcePages = pages("source records", model.source?.records || [], 2, (items) => `<div class="product-detail-source-records">${items.map((item) => `<div><strong>${escape(item.code)}</strong><span>${escape(item.description)}</span><small>GA ${escape(item.ga)} · EM ${escape(item.em)}</small></div>`).join("")}</div>`, "No ASCM source attached.");
    const panels = {
      overview: `<div class="product-detail-overview-grid"><div class="product-detail-calendar" role="group" tabindex="0" aria-label="Key dates and lifecycle"><h3 class="product-detail-section-title">Key dates</h3><div class="product-detail-dates">${(model.dates || []).map(field).join("")}</div><div class="product-detail-lifecycle-summary"><h3 class="product-detail-section-title">Lifecycle</h3><div class="product-detail-lifecycle">${(model.lifecycle || []).map((item) => `<span><small>${escape(item.label)}</small><strong>${escape(item.value)}</strong></span>`).join("")}</div></div></div><div class="product-detail-all-specs"><h3 class="product-detail-section-title">Specifications<span class="product-detail-count">${model.specs?.length || 0}</span></h3><div class="product-detail-spec-scroll" role="group" tabindex="0" aria-label="All product specifications">${specs}</div></div></div>`,
      skus: `<div class="product-detail-list-heading"><h3 class="product-detail-section-title">HP part numbers<span class="product-detail-count">${model.skus?.length || 0}</span></h3><span>Copy a SKU to use it elsewhere</span></div>${skuPages}`,
      more: `<div class="product-detail-more-tabs" role="tablist" aria-label="Additional product information">${[["identity", "Identity"], ["variants", "Variants"], ["source", "Source"]].map(([key, label]) => `<button type="button" role="tab" id="${prefix}-${key}-tab" data-detail-more="${key}" aria-controls="${prefix}-${key}" aria-selected="${state.more === key}" tabindex="${state.more === key ? 0 : -1}">${label}</button>`).join("")}</div><div id="${prefix}-identity" role="tabpanel" aria-labelledby="${prefix}-identity-tab" data-detail-more-panel="identity" class="${state.more === "identity" ? "" : "hidden"}"><div class="product-detail-identity">${(model.identity || []).map(field).join("")}</div></div><div id="${prefix}-variants" role="tabpanel" aria-labelledby="${prefix}-variants-tab" data-detail-more-panel="variants" class="${state.more === "variants" ? "" : "hidden"}">${variantPages}</div><div id="${prefix}-source" role="tabpanel" aria-labelledby="${prefix}-source-tab" data-detail-more-panel="source" class="${state.more === "source" ? "" : "hidden"}">${model.source?.records?.length ? `<p class="product-detail-source-meta">${escape(model.source.category)} · Imported ${escape(model.source.imported)}<br>${model.source.records.length} source records</p>` : ""}${sourcePages}</div>`,
    };
    return `<div class="product-details product-detail-workspace" data-detail-surface="${surface}" data-detail-product="${escape(model.id)}"><div class="product-detail-tabs" role="tablist" aria-label="Product details">${tabs.map(([key, label]) => `<button type="button" role="tab" id="${prefix}-${key}-tab" data-detail-tab="${key}" aria-controls="${prefix}-${key}" aria-selected="${state.tab === key}" tabindex="${state.tab === key ? 0 : -1}" class="${state.tab === key ? "is-active" : ""}">${label}</button>`).join("")}</div>${tabs.map(([key]) => `<section id="${prefix}-${key}" class="product-detail-panel ${state.tab === key ? "" : "hidden"}" role="tabpanel" aria-labelledby="${prefix}-${key}-tab" data-detail-panel="${key}" tabindex="0">${panels[key]}</section>`).join("")}</div>`;
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
    workspace.querySelectorAll("[data-detail-copy]").forEach((button) => button.addEventListener("click", async () => {
      const copied = await onCopy?.(button.dataset.detailCopy);
      const label = button.querySelector("small");
      label.textContent = copied ? "Copied" : "Failed";
      setTimeout(() => { if (label.isConnected) label.textContent = "Copy"; }, 1100);
    }));
    container.querySelector("[data-detail-close]")?.addEventListener("click", () => onClose?.());
  }

  root.PortfolioDetails = Object.freeze({ render, bind });
})(globalThis);
