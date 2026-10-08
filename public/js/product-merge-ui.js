/* Guided product consolidation. Nothing changes until the user confirms. */
(function (root) {
  "use strict";
  let active = null;
  const text = (value) => String(value ?? "").trim();
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const normalName = (value) => text(value).replace(/[®™©]/g, "").normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
  function signature(value) {
    if (Array.isArray(value)) return `[${value.map(signature).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${signature(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  }
  function matchReason(keeper, source, model = root.PortfolioProductMerge) {
    const codes = new Set((keeper?.partSkus || []).map((row) => model.normalizeSku(row?.code)).filter(Boolean));
    const shared = [...new Set((source?.partSkus || []).map((row) => model.normalizeSku(row?.code)).filter((code) => code && codes.has(code)))];
    if (shared.length) return { score: 100 + shared.length, label: `Matching HP SKU · ${shared.slice(0, 2).join(", ")}${shared.length > 2 ? "…" : ""}` };
    const first = normalName(keeper?.name), second = normalName(source?.name);
    if (first && first === second) return { score: 80, label: "Matching product name" };
    return { score: 0, label: "" };
  }
  const friendly = (error) => {
    const message = text(error?.message);
    if (error?.code === "STALE_MERGE" || /changed|updated|stale|no longer/i.test(message)) return "These products changed while you were reviewing. Open the merge again to review the latest information.";
    if (/date|month|launch|manufacturing/i.test(message)) return "Some dates need checking. Confirm the launch and end dates before merging.";
    if (/repeated|duplicate|row IDs|assigned|points to|featured/i.test(message)) return "Some SKUs or colorway assignments need checking. Review those details before merging.";
    return "Could not merge these products yet. Your original products are safe. Please try again.";
  };

  function createController({ adapter = root.PortfolioProductMergeAdapter, notifications = root.PortfolioNotifications, document: doc = root.document, model = root.PortfolioProductMerge } = {}) {
    if (!adapter || !model) return null;
    let destroyed = false, dialog = null, returnFocus = null, searchNode = null, feedback = null, previewNode = null, progressNode = null, applyNode = null;
    let state = { open: false, phase: "pick", productId: "", sourceProductId: "", query: "", choices: {}, planned: null, error: "", validation: "", running: false };
    let keeperOriginal = null, sourceOriginal = null;
    const entries = () => (adapter.getProducts?.() || []).filter((entry) => entry?.product && entry.categoryId);
    const find = (id) => entries().find((entry) => entry.product.id === id);
    const make = (tag, className = "", content) => {
      const node = doc.createElement(tag); if (className) node.className = className; if (content !== undefined) node.textContent = String(content); return node;
    };
    const button = (label, className, action) => { const node = make("button", className, label); node.type = "button"; node.addEventListener("click", action); return node; };
    const allowed = (first, second) => {
      if (!first || !second || first.product.id === second.product.id || first.categoryId !== second.categoryId) return { allowed: false, message: "Choose two products in the same category." };
      try { const result = adapter.canMerge?.(first.product.id, second.product.id); return result === false ? { allowed: false, message: "These products cannot be merged yet." } : result || { allowed: true }; }
      catch { return { allowed: false, message: "These products cannot be merged yet." }; }
    };
    function candidates() {
      const keeper = find(state.productId); if (!keeper) return [];
      const query = normalName(state.query);
      return entries().filter((entry) => entry.product.id !== state.productId && entry.categoryId === keeper.categoryId)
        .map((entry) => ({ ...entry, match: matchReason(keeper.product, entry.product, model), permission: allowed(keeper, entry) }))
        .filter((entry) => !query || normalName(`${entry.product.name || ""} ${entry.product.codename || ""} ${(entry.product.partSkus || []).map((row) => row.code).join(" ")} ${entry.laneName || ""}`).includes(query))
        .sort((a, b) => b.match.score - a.match.score || text(a.product.name).localeCompare(text(b.product.name)) || text(a.product.id).localeCompare(text(b.product.id)));
    }
    function getState() {
      return { ...state, choices: { ...state.choices }, planned: state.planned ? copy(state.planned) : null,
        candidates: candidates().map((entry) => ({ productId: entry.product.id, name: entry.product.name || "Untitled product", categoryName: entry.categoryName, laneName: entry.laneName, match: { ...entry.match }, allowed: entry.permission.allowed, message: entry.permission.message || "" })),
        remaining: state.planned ? state.planned.conflicts.filter((item) => !state.choices[item.key]).length : 0 };
    }
    function close() {
      if (state.running) return false;
      state.open = false; if (dialog?.open) dialog.close();
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }); returnFocus = null;
      return true;
    }
    function open({ productId = adapter.getSelectedProductId?.(), sourceProductId = "" } = {}) {
      if (destroyed || state.running) return false;
      const keeper = find(productId);
      if (!keeper) { notifications?.publish({ id: "product-merge-info", severity: "info", title: "Choose a product", message: "Open the product you want to keep, then choose Merge products.", toast: true }); return false; }
      state = { open: true, phase: "pick", productId: keeper.product.id, sourceProductId: "", query: "", choices: {}, planned: null, error: "", validation: "", running: false };
      keeperOriginal = sourceOriginal = null;
      if (doc) { returnFocus = doc.activeElement; ensureDialog(); }
      if (sourceProductId) selectSource(sourceProductId);
      render(); if (dialog && !dialog.open) dialog.showModal();
      (searchNode || dialog?.querySelector("button"))?.focus({ preventScroll: true });
      return true;
    }
    function selectSource(sourceProductId) {
      if (destroyed || state.running || !state.open) return false;
      const keeper = find(state.productId), source = find(sourceProductId), permission = allowed(keeper, source);
      if (!permission.allowed) { state.error = permission.message || "Choose two products in the same category."; render(); return false; }
      try {
        keeperOriginal = copy(keeper.product); sourceOriginal = copy(source.product);
        state.planned = model.plan(keeperOriginal, sourceOriginal); state.sourceProductId = sourceProductId;
        state.phase = "review"; state.choices = {}; state.error = ""; state.validation = ""; render();
        return true;
      } catch (error) { state.error = friendly(error); render(); return false; }
    }
    function swap() {
      if (!state.open || !state.sourceProductId || state.running) return false;
      const previous = state.productId; state.productId = state.sourceProductId;
      return selectSource(previous);
    }
    function choose(key, side) {
      if (!state.open || !state.planned?.conflicts.some((item) => item.key === key) || !["keeper", "source"].includes(side) || state.running) return false;
      state.choices[key] = side; state.error = ""; updatePreview(); return true;
    }
    function preview() {
      if (!state.planned) return null;
      const choices = { ...Object.fromEntries(state.planned.conflicts.map((item) => [item.key, "keeper"])), ...state.choices };
      try { const product = model.resolve(state.planned, choices); state.validation = ""; return product; }
      catch (error) { state.validation = friendly(error); return state.planned.product; }
    }
    async function apply() {
      if (!state.open || state.phase !== "review" || !state.planned || state.running || destroyed) return false;
      if (state.planned.conflicts.some((item) => !state.choices[item.key])) { state.error = "Choose a value for each highlighted detail before merging."; updatePreview(); return false; }
      let product;
      try { product = model.resolve(state.planned, state.choices); }
      catch (error) { state.error = friendly(error); updatePreview(); return false; }
      const keeper = find(state.productId), source = find(state.sourceProductId), permission = allowed(keeper, source);
      if (!permission.allowed) { state.error = permission.message || "These products cannot be merged yet."; updatePreview(); return false; }
      if (signature(keeper.product) !== signature(keeperOriginal) || signature(source.product) !== signature(sourceOriginal)) { state.error = friendly({ code: "STALE_MERGE" }); updatePreview(); return false; }
      state.running = true; updatePreview();
      try {
        const result = await adapter.applyMerge({ productId: state.productId, sourceProductId: state.sourceProductId, choices: { ...state.choices }, product,
          keeperOriginal: copy(keeperOriginal), sourceOriginal: copy(sourceOriginal), keeperSignature: signature(keeperOriginal), sourceSignature: signature(sourceOriginal) });
        const productId = state.productId, name = product.name || "Product";
        state.running = false; close(); adapter.openProduct?.(productId);
        const undoId = result?.undoId;
        const actions = [{ label: "Review changes", onClick: () => adapter.saveChanges?.() }];
        if (undoId) actions.push({ label: "Undo merge", onClick: async () => {
          const undone = await adapter.undoMerge?.(undoId);
          if (undone) { notifications?.resolve("product-merge-complete"); notifications?.publish({ id: "product-merge-undone", severity: "info", title: "Merge undone", message: "Both products are restored. You can keep editing.", toast: true }); }
          else notifications?.publish({ id: "product-merge-undo-unavailable", severity: "info", title: "Undo is no longer available", message: "Open the completed product to make any further changes.", toast: true });
        } });
        notifications?.publish({ id: "product-merge-complete", severity: "success", title: "Products combined", message: `${name} now includes the combined information. Review and save when you’re ready.`, revision: String(Date.now()), toast: true, actions });
        return true;
      } catch (error) { state.running = false; state.error = friendly(error); updatePreview(); return false; }
    }
    function ensureDialog() {
      if (dialog) return;
      dialog = make("dialog", "product-merge-dialog"); dialog.id = "productMergeDialog"; dialog.setAttribute("aria-labelledby", "productMergeTitle"); dialog.setAttribute("aria-describedby", "productMergeDescription"); doc.body.append(dialog);
      dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
      dialog.addEventListener("click", (event) => { if (event.target !== dialog) return; const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close(); });
    }
    function productCard(entry, role) {
      const card = make("div", "product-merge-product"), name = entry?.product?.name || "Untitled product";
      card.append(make("span", "product-merge-role", role), make("strong", "", name), make("span", "product-merge-context", [entry?.categoryName, entry?.laneName].filter(Boolean).join(" · ")));
      const codes = (entry?.product?.partSkus || []).map((row) => text(row.code)).filter(Boolean);
      if (codes.length) card.append(make("span", "product-merge-codes", `HP SKU · ${codes.slice(0, 3).join(", ")}${codes.length > 3 ? ` +${codes.length - 3}` : ""}`));
      return card;
    }
    function render() {
      if (!doc || !state.open || destroyed) return;
      ensureDialog(); dialog.replaceChildren(); searchNode = null; previewNode = progressNode = applyNode = null;
      const shell = make("div", "product-merge-shell"), header = make("header", "product-merge-header"), heading = make("div");
      const title = make("h2", "", "Merge products"); title.id = "productMergeTitle";
      const description = make("p", "", state.phase === "pick" ? "Combine two records into one complete product." : "Missing information is filled in. Choose between any different values."); description.id = "productMergeDescription";
      heading.append(title, description); header.append(heading, button("×", "icon-button product-merge-close", close)); header.lastElementChild.setAttribute("aria-label", "Close merge review");
      const body = make("div", "product-merge-body"), footer = make("footer", "product-merge-footer");
      feedback = make("p", "product-merge-feedback"); feedback.setAttribute("role", "alert"); feedback.hidden = true;
      body.append(feedback);
      if (state.phase === "pick") renderPicker(body, footer); else renderReview(body, footer);
      shell.append(header, body, footer); dialog.append(shell); updatePreview();
    }
    function renderPicker(body, footer) {
      const keeper = find(state.productId); body.append(productCard(keeper, "Product to keep"));
      const label = make("label", "product-merge-search-label", "Find the other product"), input = make("input", "product-merge-search"); input.type = "search"; input.placeholder = "Search product name or HP SKU"; input.value = state.query; input.setAttribute("aria-controls", "productMergeCandidates"); label.append(input); body.append(label); searchNode = input;
      const note = make("p", "product-merge-scope", "Only products in this category are shown. Matching names or SKUs are suggested first."); body.append(note);
      const list = make("div", "product-merge-candidates"); list.id = "productMergeCandidates"; list.setAttribute("role", "list"); body.append(list);
      const resultCount = make("p", "product-merge-result-count"); resultCount.setAttribute("role", "status"); resultCount.setAttribute("aria-live", "polite"); body.append(resultCount);
      const renderCandidates = () => {
        list.replaceChildren(); const items = candidates();
        for (const entry of items) {
          const row = make("div", "product-merge-candidate"); row.setAttribute("role", "listitem");
          const description = make("div"); description.append(make("strong", "", entry.product.name || "Untitled product"), make("span", "product-merge-context", entry.laneName || entry.categoryName || ""));
          if (entry.match.label) description.append(make("span", "product-merge-match", entry.match.label));
          if (!entry.permission.allowed && entry.permission.message) description.append(make("span", "product-merge-unavailable", entry.permission.message));
          const select = button("Compare", "quiet-button", () => selectSource(entry.product.id)); select.disabled = !entry.permission.allowed; if (!entry.permission.allowed) select.dataset.mergeUnavailable = "true"; select.setAttribute("aria-label", `Compare ${entry.product.name || "this product"}`);
          row.append(description, select); list.append(row);
        }
        if (!items.length) list.append(make("p", "product-merge-empty", state.query ? "No products match this search." : "There are no other products in this category to merge."));
        resultCount.textContent = `${items.length} ${items.length === 1 ? "product" : "products"} shown`;
      };
      input.addEventListener("input", () => { state.query = input.value; renderCandidates(); }); renderCandidates();
      footer.append(make("span", "product-merge-footer-note", "Your products stay unchanged until you confirm."), button("Cancel", "quiet-button", close));
    }
    function appendValue(container, value) {
      const full = text(value) || "Not provided";
      if (full.length < 260 && full.split("\n").length < 7) { container.append(make("span", "product-merge-value", full)); return; }
      const details = make("details", "product-merge-value-details"), summary = make("summary", "", `${full.slice(0, 150)}…`); details.append(summary, make("pre", "", full)); container.append(details);
    }
    function renderReview(body, footer) {
      const pair = make("div", "product-merge-pair"), keeper = find(state.productId), source = find(state.sourceProductId);
      pair.append(productCard(keeper, "Product to keep"), button("⇄", "quiet-button product-merge-swap", swap), productCard(source, "Other product")); pair.children[1].setAttribute("aria-label", "Swap which product to keep"); body.append(pair);
      body.append(make("p", "product-merge-explanation", "The product to keep stays in its category and position. The other record is removed after combining its information."));
      const tally = make("div", "product-merge-tally");
      for (const [count, label] of [[state.planned.summary.specsAdded, "specifications added"], [state.planned.summary.skusAdded, "HP SKUs added"], [state.planned.summary.variantsAdded, "variants added"]]) if (count) tally.append(make("span", "", `${count} ${label}`));
      if (!tally.children.length) tally.append(make("span", "", "Matching rows are combined")); body.append(tally);
      if (state.planned.conflicts.length) {
        const heading = make("h3", "product-merge-section-heading", "Choose the final values"); body.append(heading);
        const list = make("div", "product-merge-conflicts");
        state.planned.conflicts.forEach((item, index) => {
          const fieldset = make("fieldset", "product-merge-conflict"); fieldset.dataset.mergeConflict = item.key;
          fieldset.append(make("legend", "", item.label));
          const options = make("div", "product-merge-choice-options");
          for (const [side, title, value] of [["keeper", "Product to keep", item.keeperText], ["source", "Other product", item.sourceText]]) {
            const label = make("label", "product-merge-choice"), input = make("input"); input.type = "radio"; input.name = `merge-choice-${index}`; input.value = side; input.checked = state.choices[item.key] === side;
            input.addEventListener("change", () => { if (input.checked) choose(item.key, side); });
            const content = make("span", "product-merge-choice-content"); content.append(make("strong", "product-merge-choice-label", title));
            if (/(?:^|\/)imageAssetId$/.test(item.key)) {
              const assetId = item[side], imageSource = assetId && adapter.getImageSource?.(assetId);
              if (imageSource) { const image = make("img", "product-merge-image"); image.src = imageSource; image.alt = `${title} image`; image.loading = "lazy"; content.append(image); }
              else content.append(make("span", "product-merge-value", assetId ? "Image from this product" : "No image"));
            } else appendValue(content, value);
            label.append(input, content); options.append(label);
          }
          fieldset.append(options); list.append(fieldset);
        }); body.append(list);
      } else body.append(make("p", "product-merge-no-conflicts", "The information fits together. No conflicting values need a decision."));
      const previewHeading = make("h3", "product-merge-section-heading", "Completed product preview"); previewNode = make("div", "product-merge-preview"); body.append(previewHeading, previewNode);
      progressNode = make("span", "product-merge-progress"); progressNode.setAttribute("role", "status"); progressNode.setAttribute("aria-live", "polite");
      applyNode = button("Merge products", "primary-button", apply);
      const back = button("Choose another", "quiet-button", () => { state.phase = "pick"; state.sourceProductId = ""; state.planned = null; state.choices = {}; state.error = ""; render(); searchNode?.focus(); });
      footer.append(progressNode, back, button("Cancel", "quiet-button", close), applyNode);
    }
    function renderPreview(product) {
      if (!previewNode || !product) return;
      const expanded = new Set([...previewNode.querySelectorAll("details[open]")].map((node) => node.dataset.previewSection));
      previewNode.replaceChildren();
      const section = (key, title, values) => {
        const details = make("details", "product-merge-preview-section"); details.dataset.previewSection = key; details.open = expanded.has(key); details.append(make("summary", "", title));
        const list = make("dl", "product-merge-preview-list");
        for (const [label, value] of values) { list.append(make("dt", "", label)); const definition = make("dd"); appendValue(definition, value); list.append(definition); }
        if (!values.length) list.append(make("p", "product-merge-empty", "Not provided")); details.append(list); previewNode.append(details);
      };
      const details = [["Product name", product.name], ["Codename", product.codename], ["MSRP", product.price === null || product.price === undefined ? "" : product.price], ["Tier", product.tier], ["Status", product.statusLabel || product.statusType], ["Platform", product.variantLabel]].filter(([, value]) => value !== undefined && value !== null && String(value) !== "");
      const dates = [["Launch / general availability", product.generalAvailabilityDate || product.roadmap?.startMonth], ["FFS", product.ffsDate], ["End of manufacturing", product.endManufacturingDate || product.roadmap?.endMonth], ["Global announcement", product.globalAnnouncementDate], ["Web readiness", product.webReadinessDate], ["Final assets", product.finalAssetsDate]].filter(([, value]) => value);
      const specs = (product.specs || []).map((row) => [row.label || "Specification", row.value]);
      const variantById = new Map((product.variantGroups || []).flatMap((group) => (group.items || []).map((row) => [row.id, { row, type: group.type }])));
      const variantName = (row, type) => type === "color" ? `${row.code || "Colorway"}${[row.colorName || row.colorKey, row.colorName2 || row.colorKey2].filter(Boolean).length ? ` · ${[row.colorName || row.colorKey, row.colorName2 || row.colorKey2].filter(Boolean).join(" / ")}` : ""}` : row.code || row.label || "Layout";
      const skus = (product.partSkus || []).map((row) => { const variant = variantById.get(row.variantId); return [row.code || "HP SKU", variant ? variantName(variant.row, variant.type) : row.colorCode || "No colorway assigned"]; });
      const variants = [...variantById.values()].map(({ row, type }) => [type === "color" ? "Colorway" : "Layout", variantName(row, type)]);
      section("details", "Product details", details); section("dates", `Dates · ${dates.length}`, dates); section("specs", `Specifications · ${specs.length}`, specs); section("skus", `HP SKUs · ${skus.length}`, skus); section("variants", `Variants · ${variants.length}`, variants);
    }
    function updatePreview() {
      if (destroyed) return;
      const resolved = preview();
      const remaining = state.planned?.conflicts.filter((item) => !state.choices[item.key]).length || 0;
      if (feedback) { feedback.textContent = state.error || (remaining === 0 ? state.validation : ""); feedback.hidden = !feedback.textContent; }
      if (progressNode) progressNode.textContent = state.running ? "Combining…" : remaining ? `${remaining} ${remaining === 1 ? "choice" : "choices"} left` : "Ready to combine";
      if (applyNode) { applyNode.disabled = state.running || remaining > 0 || Boolean(state.validation); applyNode.textContent = state.running ? "Combining…" : "Merge products"; }
      if (dialog) {
        for (const node of dialog.querySelectorAll("button, input")) { if (node !== applyNode) node.disabled = state.running || Boolean(node.dataset.mergeUnavailable); }
        for (const fieldset of dialog.querySelectorAll("[data-merge-conflict]")) fieldset.classList.toggle("is-resolved", Boolean(state.choices[fieldset.dataset.mergeConflict]));
      }
      renderPreview(resolved);
    }
    const controller = { open, close, getState, selectSource, swap, choose, apply, search(query) { state.query = text(query); return getState().candidates; }, destroy() { if (state.running) return false; destroyed = true; dialog?.remove(); state.open = false; return true; } };
    return Object.freeze(controller);
  }
  function initialize(options = {}) { if (!active) active = createController(options); return active; }
  root.PortfolioProductMergeUI = Object.freeze({ createController, initialize, matchReason, signature, friendlyError: friendly, open(options) { return (active || initialize())?.open(options); }, close() { return active?.close(); }, getState() { return active?.getState() || null; } });
})(globalThis);
