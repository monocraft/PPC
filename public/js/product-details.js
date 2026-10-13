/* Read-only product details shared by card companions and split view. */
(function (root) {
  "use strict";
  const states = new Map();
  const renderedModels = new Map();
  const mountedWorkspaces = new Map();
  let launchSelection = { productId: "", id: "", availability: "markets" };
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const tone = (value) => /^#[\da-f]{6}$/i.test(value || "") ? value : "#393c40";
  const tabs = [["overview", "Specifications"], ["dates", "Dates"], ["skus", "HP SKUs"], ["more", "More"]];
  const moreTabs = [["identity", "Identity"], ["pricing", "Pricing"], ["availability", "Availability"], ["source", "Source"]];
  const dateKinds = new Set(["general-availability", "end-manufacturing", "ffs", "global-announcement", "web-readiness", "final-assets"]);
  const dateFields = { "general-availability": "generalAvailabilityDate", "end-manufacturing": "endManufacturingDate", ffs: "ffsDate", "global-announcement": "globalAnnouncementDate", "web-readiness": "webReadinessDate", "final-assets": "finalAssetsDate" };
  const lifecycleKinds = new Set(["launch", "lifecycle-end", "stage", "confidence"]);
  const kindAttribute = (name, key, kinds) => kinds.has(key) ? ` data-${name}-kind="${key}"` : "";

  function stateFor(surface, productId) {
    let state = states.get(surface);
    if (!state) states.set(surface, state = { tab: "overview", more: "identity", pages: {}, productId });
    if (state.productId !== productId) { state.productId = productId; state.tab = "overview"; state.pages = {}; }
    if (!moreTabs.some(([key]) => key === state.more)) state.more = "identity";
    return state;
  }

  function applyTabSelection(workspace, selector, panelSelector, attribute, panelAttribute, selectedValue) {
    for (const button of workspace.querySelectorAll(selector)) {
      const selected = button.dataset[attribute] === selectedValue;
      button.setAttribute("aria-selected", String(selected));
      button.classList.toggle("is-active", selected);
      button.tabIndex = selected ? 0 : -1;
    }
    for (const panel of workspace.querySelectorAll(panelSelector)) panel.classList.toggle("hidden", panel.dataset[panelAttribute] !== selectedValue);
  }

  function openTab(model, { surface = "viewer", tab = "overview" } = {}) {
    if (!model?.id || !tabs.some(([key]) => key === tab)) return false;
    surface = surface === "viewer" ? "viewer" : "split";
    stateFor(surface, model.id).tab = tab;
    const entry = mountedWorkspaces.get(surface);
    if (entry?.model.id === model.id && entry.workspace.isConnected) {
      applyTabSelection(entry.workspace, "[data-detail-tab]", "[data-detail-panel]", "detailTab", "detailPanel", tab);
    }
    return true;
  }

  function readableDate(value) {
    const text = String(value ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const date = new Date(`${text}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) return text;
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
  }

  function launchRecord(model) {
    const records = model.launch?.records || [];
    if (launchSelection.productId !== model.id) launchSelection = { productId: model.id, id: "", availability: "markets" };
    let record = records.find((item) => item.id === launchSelection.id);
    if (!record) record = records.find((item) => item.canonical || item.row === model.launch?.canonicalRow) || records[0];
    launchSelection.id = record?.id || "";
    return record;
  }

  function recordLabel(record) {
    const sku = (record.skus || []).join(" / ") || record.identity?.skuText;
    return [sku, record.identity?.productName || `Tracker row ${record.row}`].filter(Boolean).join(" · ");
  }

  function launchContent(model, record, panel, surface = "split") {
    const empty = (label) => `<div class="product-detail-empty">${escape(label)}</div>`;
    if (!record) return panel === "pricing" ? `<div class="product-detail-price-cards"><div><span>Saved MSRP</span><strong>${escape(model.priceText || "Not recorded")}</strong></div></div>` : empty("No launch tracker record attached.");
    const identity = record.identity || {}, source = record.source || {};
    const rows = (items, className = "") => `<dl class="product-detail-launch-rows ${className}">${items.map((item) => `<div><dt>${escape(item.label || item.column)}</dt><dd>${escape(item.value === null || item.value === undefined || item.value === "" ? "Not recorded" : readableDate(item.value))}</dd></div>`).join("")}</dl>`;
    if (panel === "identity") return `<div class="product-detail-tracker-identity"><h3 class="product-detail-section-title">Tracker identity</h3><strong>${escape(identity.productName || "Name not recorded")}</strong>${rows([{ label: "Codename", value: identity.codename }, { label: "Product tier", value: identity.tier }])}<details class="product-detail-source-disclosure"><summary>Source category and SKU text</summary>${rows([{ label: "Source category", value: identity.sourceCategory }, { label: "SKU text", value: identity.skuText }])}</details></div>`;
    if (panel === "pricing") {
      const price = (value, currency) => typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value) : value === null || value === undefined || value === "" ? "Not recorded" : String(value);
      return `<div class="product-detail-price-cards"><div><span>Saved MSRP</span><strong>${escape(model.priceText || "Not recorded")}</strong><small>Product record</small></div><div><span>Tracker MSRP · USD</span><strong>${escape(price(record.pricing?.usd, "USD"))}</strong><small>Selected variant</small></div><div><span>Tracker MSRP · EUR</span><strong>${escape(price(record.pricing?.eur, "EUR"))}</strong><small>Selected variant</small></div></div><p class="product-detail-launch-note">Tracker prices are recorded for this variant. The saved product MSRP is shown separately.</p>`;
    }
    if (panel === "availability") {
      const prefix = `product-detail-${surface}-launch`;
      return `<div class="product-detail-availability-tabs" role="tablist" aria-label="Tracker availability"><button type="button" role="tab" id="${prefix}-markets-tab" data-detail-availability="markets" aria-controls="${prefix}-markets" aria-selected="${launchSelection.availability === "markets"}" tabindex="${launchSelection.availability === "markets" ? 0 : -1}">Markets</button><button type="button" role="tab" id="${prefix}-milestones-tab" data-detail-availability="milestones" aria-controls="${prefix}-milestones" aria-selected="${launchSelection.availability === "milestones" ? 0 : -1}">Milestones</button></div><div id="${prefix}-markets" data-detail-availability-panel="markets" role="tabpanel" aria-labelledby="${prefix}-markets-tab" aria-label="Tracker market availability" class="${launchSelection.availability === "markets" ? "" : "hidden"}">${rows(record.regions || [], "product-detail-market-rows")}</div><div id="${prefix}-milestones" data-detail-availability-panel="milestones" role="tabpanel" aria-labelledby="${prefix}-milestones-tab" aria-label="Tracker launch milestones" class="${launchSelection.availability === "milestones" ? "" : "hidden"}">${rows(record.milestones || [])}<p class="product-detail-launch-note">These are tracker dates. Accepted product dates and their update history are in Dates.</p></div>`;
    }
    const provenance = [{ label: "Workbook", value: source.file || model.launch?.sourceFile }, { label: "Sheet / range", value: [source.sheet || model.launch?.sourceSheet, source.range || (record.row ? `Row ${record.row}` : "")].filter(Boolean).join(" · ") }, { label: "Checked", value: source.checkedDate || model.launch?.checkedDate }];
    const notes = record.notes || [];
    const overrides = (model.launch?.overrides || []).filter((item) => !item.row || item.row === record.row);
    const organized = model.launch?.organizedAt;
    return `${rows(provenance, "product-detail-provenance")}<details class="product-detail-source-disclosure"><summary>Source notes${notes.length ? ` (${notes.length})` : ""}</summary>${notes.length ? rows(notes) : '<p class="product-detail-launch-note">No additional notes in this tracker row.</p>'}</details>${overrides.length ? `<details class="product-detail-source-disclosure"><summary>Preserved edits (${overrides.length})</summary>${rows(overrides)}<p class="product-detail-launch-note">Edits made after the tracker import are retained with the source record.</p></details>` : ""}<details class="product-detail-source-disclosure"><summary>Record history</summary><p class="product-detail-launch-note">Launch tracker identity, prices, dates and regional schedules are stored separately from product specifications.${organized ? ` Organized ${escape(readableDate(String(organized).slice(0, 10)))}.` : ""}</p>${source.observedAt || model.launch?.observedAt ? rows([{ label: "Source observed", value: source.observedAt || model.launch.observedAt }]) : ""}</details>`;
  }

  function bindAvailability(workspace) {
    const buttons = [...workspace.querySelectorAll("[data-detail-availability]")];
    function select(button, focus = false) {
      launchSelection.availability = button.dataset.detailAvailability;
      for (const entry of mountedWorkspaces.values()) {
        if (entry.model.id !== launchSelection.productId || !entry.workspace.isConnected) continue;
        for (const item of entry.workspace.querySelectorAll("[data-detail-availability]")) {
          const selected = item.dataset.detailAvailability === launchSelection.availability;
          item.setAttribute("aria-selected", String(selected)); item.tabIndex = selected ? 0 : -1;
        }
        for (const panel of entry.workspace.querySelectorAll("[data-detail-availability-panel]")) panel.classList.toggle("hidden", panel.dataset.detailAvailabilityPanel !== launchSelection.availability);
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
    renderedModels.set(surface, model);
    const state = stateFor(surface, model.id);
    const prefix = `product-detail-${surface}`;
    const selectedLaunch = launchRecord(model);
    const field = (item) => `<div class="product-detail-date"${kindAttribute("date", item.key, dateKinds)}>${dateFields[item.key] && root.PortfolioDateHistory ? root.PortfolioDateHistory.labelHtml(item.label, dateFields[item.key]) : `<span>${escape(item.label)}</span>`}<strong class="${item.empty ? "is-muted" : ""}">${escape(item.value)}</strong></div>`;
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
    const colorwayDate = (date) => `<div class="product-detail-colorway-date"><span>${escape(date.label)}</span><strong>${escape(date.value || "TBD")}</strong><small>${date.changed ? `Updated ${escape(date.changed)}${date.ageDays !== null && date.ageDays !== undefined ? ` · ${escape(date.ageDays)} days old` : ""}` : "Update date not recorded"}${date.observed ? ` · Last confirmed ${escape(date.observed)}` : ""}</small></div>`;
    const colorwaySchedules = model.colorwaySchedules?.length ? `<div class="product-detail-list-heading"><h3 class="product-detail-section-title">Colorway schedules<span class="product-detail-count">${model.colorwaySchedules.length}</span></h3></div><p class="product-detail-colorway-note">Each color keeps its own PLC dates and update history.</p>${pages("colorway schedules", model.colorwaySchedules, 6, (items) => `<div class="product-detail-colorway-schedules">${items.map((item) => `<article class="product-detail-colorway-schedule" data-colorway-id="${escape(item.id)}"><div class="product-detail-colorway-heading">${colorsHtml(item.colors)}<span>${escape(item.code)}</span></div>${(item.dates || []).filter((date) => date.field === "ffsDate").map(colorwayDate).join("")}<details><summary>Other milestones${item.codename ? ` · ${escape(item.codename)}` : ""}</summary>${(item.dates || []).filter((date) => date.field !== "ffsDate").map(colorwayDate).join("")}${item.sourceFile ? `<small>Source: ${escape(item.sourceFile)}</small>` : ""}</details></article>`).join("")}</div>`, "")}` : "";
    const sourcePages = pages("source records", model.source?.records || [], 2, (items) => `<div class="product-detail-source-records">${items.map((item) => `<div><strong>${escape(item.code)}</strong><span>${escape(item.description)}</span><small>GA ${escape(item.ga)} · EM ${escape(item.em)}</small></div>`).join("")}</div>`, "No ASCM source attached.");
    const trackerRecords = model.launch?.records || [];
    const launchPicker = trackerRecords.length ? `<div class="product-detail-launch-picker"><label for="${prefix}-launch-record">Variant / SKU</label><select id="${prefix}-launch-record" data-detail-launch-record aria-label="Launch tracker variant or SKU">${trackerRecords.map((record) => `<option value="${escape(record.id)}" ${record.id === selectedLaunch?.id ? "selected" : ""}>${escape(recordLabel(record))}</option>`).join("")}</select><span data-detail-launch-check>Tracker · Checked ${escape(readableDate(selectedLaunch?.source?.checkedDate || model.launch?.checkedDate || "date not recorded"))}</span></div>` : "";
    const ascmContent = `${model.source?.records?.length ? `<p class="product-detail-source-meta">${escape(model.source.category)} · Imported ${escape(model.source.imported)}<br>${model.source.records.length} source records</p>` : ""}${sourcePages}`;
    const morePanels = {
      identity: `<div class="product-detail-identity">${(model.identity || []).map(field).join("")}</div>${trackerRecords.length ? `<div data-detail-launch-content="identity">${launchContent(model, selectedLaunch, "identity")}</div>` : ""}`,
      pricing: `<div data-detail-launch-content="pricing">${launchContent(model, selectedLaunch, "pricing")}</div>`,
      availability: `<div data-detail-launch-content="availability">${launchContent(model, selectedLaunch, "availability", surface)}</div>`,
      source: `${trackerRecords.length ? `<div data-detail-launch-content="source">${launchContent(model, selectedLaunch, "source")}</div>${model.source?.records?.length ? `<details class="product-detail-source-disclosure product-detail-ascm-source"><summary>ASCM source records (${model.source.records.length})</summary>${ascmContent}</details>` : ""}` : ascmContent}`,
    };
    const panels = {
      overview: `<div class="product-detail-all-specs">${specs}</div>`,
      dates: `<div class="product-detail-calendar"><div class="product-detail-dates">${(model.dates || []).map(field).join("")}</div><div class="product-detail-lifecycle-summary"><h3 class="product-detail-section-title">Lifecycle</h3><div class="product-detail-lifecycle">${(model.lifecycle || []).map((item) => `<span${kindAttribute("lifecycle", item.key, lifecycleKinds)}><small>${escape(item.label)}</small><strong>${escape(item.value)}</strong></span>`).join("")}</div></div></div>`,
      skus: `<div class="product-detail-list-heading"><h3 class="product-detail-section-title">HP part numbers<span class="product-detail-count">${model.skus?.length || 0}</span></h3><span>Copy a SKU to use it elsewhere</span></div><div class="product-detail-sku-content">${skuPages}${optionPages}${colorwaySchedules}</div>`,
      more: `<div class="product-detail-more-tabs" role="tablist" aria-label="Additional product information">${moreTabs.map(([key, label]) => `<button type="button" role="tab" id="${prefix}-${key}-tab" data-detail-more="${key}" aria-controls="${prefix}-${key}" aria-selected="${state.more === key}" tabindex="${state.more === key ? 0 : -1}">${label}</button>`).join("")}</div>${launchPicker}${moreTabs.map(([key]) => `<div id="${prefix}-${key}" role="tabpanel" aria-labelledby="${prefix}-${key}-tab" data-detail-more-panel="${key}" class="${state.more === key ? "" : "hidden"}">${morePanels[key]}</div>`).join("")}`,
    };
    return `<div class="product-details product-detail-workspace" data-detail-surface="${surface}" data-detail-product="${escape(model.id)}"><div class="product-detail-tabs" role="tablist" aria-label="Product details">${tabs.map(([key, label]) => `<button type="button" role="tab" id="${prefix}-${key}-tab" data-detail-tab="${key}" aria-controls="${prefix}-${key}" aria-selected="${state.tab === key}" tabindex="${state.tab === key ? 0 : -1}" class="${state.tab === key ? "is-active" : ""}">${label}</button>`).join("")}</div>${tabs.map(([key]) => `<section id="${prefix}-${key}" class="product-detail-panel ${state.tab === key ? "" : "hidden"}" role="tabpanel" aria-labelledby="${prefix}-${key}-tab" data-detail-panel="${key}" tabindex="0">${panels[key]}</section>`).join("")}<span class="visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-detail-copy-status></span></div>`;
  }

  function bind(container, { onCopy, onClose, dateHistory } = {}) {
    const workspace = container.querySelector("[data-detail-surface]");
    if (!workspace) return;
    if (dateHistory) root.PortfolioDateHistory?.bind(container, dateHistory);
    const state = stateFor(workspace.dataset.detailSurface, workspace.dataset.detailProduct);
    const model = renderedModels.get(workspace.dataset.detailSurface);
    if (model?.id === workspace.dataset.detailProduct) mountedWorkspaces.set(workspace.dataset.detailSurface, { workspace, model });
    function bindTabs(selector, panelSelector, key, attribute) {
      const buttons = [...workspace.querySelectorAll(selector)];
      function select(button, focus = false) {
        state[key] = button.dataset[attribute];
        applyTabSelection(workspace, selector, panelSelector, attribute, key === "tab" ? "detailPanel" : "detailMorePanel", state[key]);
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
    bindAvailability(workspace);
    workspace.querySelector("[data-detail-launch-record]")?.addEventListener("change", (event) => {
      const id = event.target.value;
      if (!model?.launch?.records?.some((record) => record.id === id)) return;
      launchSelection.id = id;
      launchSelection.productId = model.id;
      for (const entry of mountedWorkspaces.values()) {
        if (entry.model.id !== model.id || !entry.workspace.isConnected) continue;
        const record = launchRecord(entry.model);
        const picker = entry.workspace.querySelector("[data-detail-launch-record]");
        if (picker) picker.value = launchSelection.id;
        const checked = entry.workspace.querySelector("[data-detail-launch-check]");
        if (checked) checked.textContent = `Tracker · Checked ${readableDate(record?.source?.checkedDate || entry.model.launch?.checkedDate || "date not recorded")}`;
        for (const panel of entry.workspace.querySelectorAll("[data-detail-launch-content]")) panel.innerHTML = launchContent(entry.model, record, panel.dataset.detailLaunchContent, entry.workspace.dataset.detailSurface);
        bindAvailability(entry.workspace);
      }
    });
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

  root.PortfolioDetails = Object.freeze({ render, bind, focusMatch, openTab });
})(globalThis);
