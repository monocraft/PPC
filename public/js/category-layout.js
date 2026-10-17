/* Category layout drafts contain presentation metadata, never product copies. */
(function registerCategoryLayout(root) {
  "use strict";
  const copy = value => JSON.parse(JSON.stringify(value));
  const customId = value => typeof value === "string" && /^custom-[a-z0-9][a-z0-9-]{0,170}$/.test(value);
  function project(portfolio) {
    return (portfolio?.categories || []).map(category => ({
      id: category.id, custom: category.custom === true, name: category.name,
      title: category.board.title, sideLabel: category.board.settings?.roadmap?.categoryLabel || category.name,
      lanes: [...category.board.lanes].sort((a, b) => a.order - b.order).map(lane => ({ ...lane, label: String(lane.label || ""), subtitle: String(lane.subtitle || "") })),
    }));
  }
  const signature = portfolio => JSON.stringify(project(portfolio));
  function validate(layout, current) {
    if (!Array.isArray(layout) || !layout.length || layout.length > 200) throw Error("Use between 1 and 200 categories.");
    const ids = new Set(), names = new Set();
    for (const category of layout) {
      if (!category || typeof category.id !== "string" || ids.has(category.id)) throw Error("Each category needs a unique identifier.");
      const existing = current?.categories?.find(item => item.id === category.id);
      if (!existing && (category.custom !== true || !customId(category.id))) throw Error("This category cannot be created. Add it again.");
      ids.add(category.id);
      for (const key of ["name", "title", "sideLabel"]) if (typeof category[key] !== "string" || !category[key].trim() || category[key].length > 240) throw Error("Enter a category name, board title and side label of 1–240 characters.");
      const name = category.name.trim().toLowerCase();
      if (names.has(name)) throw Error("Choose a different name for each category."); names.add(name);
      if (!Array.isArray(category.lanes) || !category.lanes.length || category.lanes.length > 100) throw Error("Use between 1 and 100 lanes in each category.");
      const lanes = new Set();
      for (const lane of category.lanes) {
        if (!lane || typeof lane.id !== "string" || !lane.id || lane.id.length > 180 || lanes.has(lane.id)) throw Error("Each lane needs a unique identifier.");
        lanes.add(lane.id);
        if (typeof lane.label !== "string" || !lane.label.trim() || lane.label.length > 240 || typeof lane.subtitle !== "string" || lane.subtitle.length > 240) throw Error("Enter a lane name of 1–240 characters.");
      }
      if (existing?.board.lanes.some(lane => !lanes.has(lane.id))) throw Error("Existing lanes must remain in this layout. Move or rename them instead.");
    }
    if (current?.categories?.some(category => !ids.has(category.id))) throw Error("Existing categories must remain in this layout.");
    return true;
  }
  function apply(portfolio, layout, expected) {
    if (signature(portfolio) !== expected) throw Error("The category layout changed elsewhere. Cancel this draft to load the current layout, then try again.");
    validate(layout, portfolio);
    const byId = new Map(portfolio.categories.map(category => [category.id, category]));
    const next = layout.map(category => {
      const prior = byId.get(category.id);
      const result = prior || { id: category.id, custom: true, name: category.name.trim(), board: {
        version: 1, title: category.title.trim(), lanes: [], products: [],
        settings: { showPrices: true, showSkus: true, freeMove: false, roadmap: { categoryLabel: category.sideLabel.trim(), familyOrder: [] } },
      } };
      result.name = category.name.trim(); result.board.title = category.title.trim();
      result.board.settings ||= {}; result.board.settings.roadmap ||= {};
      result.board.settings.roadmap.categoryLabel = category.sideLabel.trim();
      result.board.lanes = category.lanes.map((lane, order) => ({ ...lane, label: lane.label.trim(), subtitle: lane.subtitle.trim(), order }));
      return result;
    });
    portfolio.categories = next;
    return portfolio;
  }
  function move(list, source, target) {
    const from = list.findIndex(item => item.id === source), to = list.findIndex(item => item.id === target);
    if (from < 0 || to < 0 || from === to) return false;
    list.splice(to, 0, list.splice(from, 1)[0]); return true;
  }
  root.PortfolioCategoryLayout = Object.freeze({ project, signature, validate, apply, move, customId });

  function initialize() {
    const doc = root.document, host = doc?.getElementById("settingsCategoryLayout"), adapter = root.PortfolioCategoryLayoutAdapter;
    if (!host || !adapter || host.dataset.initialized) return;
    if (!adapter.getPortfolio()) { root.PortfolioWorkspaceReady?.then(initialize, () => {}); return; }
    host.dataset.initialized = "true";
    const node = (tag, cls, text) => { const el = doc.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; };
    let draft = null, base = "", selected = adapter.getPortfolio().activeCategoryId, dragging = null;
    const status = node("p", "category-layout-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const problem = node("p", "category-layout-error"); problem.setAttribute("role", "alert");
    const dock = node("div", "category-layout-dock"); dock.setAttribute("aria-label", "Category order");
    const addRow = node("form", "category-layout-add");
    const newName = node("input"); newName.type = "text"; newName.maxLength = 240; newName.placeholder = "New category name"; newName.setAttribute("aria-label", "New category name");
    const add = node("button", "", "Add category"); add.type = "submit"; addRow.append(newName, add);
    const editor = node("div", "category-layout-editor");
    const footer = node("div", "category-layout-actions"), note = node("p", "", "Layout changes are saved on this device and included in exported portfolios.");
    const cancel = node("button", "", "Cancel"), save = node("button", "primary-button", "Save layout"); cancel.type = save.type = "button";
    footer.append(note, cancel, save); host.append(addRow, dock, editor, problem, status, footer);
    const current = () => draft || project(adapter.getPortfolio());
    const ensureDraft = () => { if (!draft) { base = signature(adapter.getPortfolio()); draft = project(adapter.getPortfolio()); } return draft; };
    const setDirty = () => { save.disabled = cancel.disabled = !draft; root.PortfolioWorkspaceUI?.setCategoryDraftState?.(Boolean(draft)); problem.textContent = ""; };
    const uniqueId = () => "custom-" + root.crypto.randomUUID();
    const action = (label, text, callback, disabled = false) => { const button = node("button", "category-layout-move", text); button.type = "button"; button.setAttribute("aria-label", label); button.disabled = disabled; button.addEventListener("click", callback); return button; };
    function focusKey(key) { [...host.querySelectorAll("[data-focus-key]")].find(element => element.dataset.focusKey === key)?.focus({ preventScroll: true }); }
    function moveCategory(id, delta) {
      const values = ensureDraft(), index = values.findIndex(item => item.id === id), target = values[index + delta];
      if (target && move(values, id, target.id)) { render(); focusKey(`category-${id}`); status.textContent = "Category order updated in this draft."; }
    }
    function moveLane(id, delta) {
      const category = ensureDraft().find(item => item.id === selected), index = category.lanes.findIndex(item => item.id === id), target = category.lanes[index + delta];
      if (target && move(category.lanes, id, target.id)) { render(); focusKey(`lane-${id}`); status.textContent = "Lane order updated in this draft."; }
    }
    function field(label, key, category, lane = null) {
      const wrap = node("label", "category-layout-field", label), input = node("input"); input.type = "text"; input.maxLength = 240; input.value = (lane || category)[key] || "";
      input.dataset.focusKey = lane ? `lane-${lane.id}` : `field-${key}`;
      input.addEventListener("input", () => { const target = ensureDraft().find(item => item.id === category.id); (lane ? target.lanes.find(item => item.id === lane.id) : target)[key] = input.value; setDirty();
        if (key === "name") { const name = [...dock.querySelectorAll("[data-category-label]")].find(element => element.dataset.categoryLabel === category.id); if (name) name.textContent = input.value || "Unnamed category"; }
      }); wrap.append(input); return wrap;
    }
    function dragEvents(element, kind, id) {
      element.draggable = true;
      element.addEventListener("dragstart", event => { if (event.target.closest("input")) { event.preventDefault(); return; } dragging = { kind, id, category: selected }; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", id); element.classList.add("is-dragging"); });
      element.addEventListener("dragover", event => { if (dragging?.kind === kind && (kind !== "lane" || dragging.category === selected)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; element.classList.add("is-drop-target"); } });
      element.addEventListener("dragleave", () => element.classList.remove("is-drop-target"));
      element.addEventListener("drop", event => { event.preventDefault(); if (dragging?.kind !== kind || kind === "lane" && dragging.category !== selected) return; const list = kind === "category" ? ensureDraft() : ensureDraft().find(item => item.id === selected).lanes; if (move(list, dragging.id, id)) { render(); status.textContent = `${kind === "category" ? "Category" : "Lane"} order updated in this draft.`; } dragging = null; });
      element.addEventListener("dragend", () => { dragging = null; host.querySelectorAll(".is-drop-target,.is-dragging").forEach(item => item.classList.remove("is-drop-target", "is-dragging")); });
    }
    function render() {
      const values = current(); if (!values.some(category => category.id === selected)) selected = values[0]?.id;
      dock.replaceChildren(); editor.replaceChildren();
      values.forEach((category, index) => {
        const chip = node("div", "category-layout-chip"), choose = node("button", "category-layout-choice"); choose.type = "button"; choose.dataset.focusKey = `category-${category.id}`; choose.setAttribute("aria-pressed", String(category.id === selected));
        const label = node("span", "", category.name); label.dataset.categoryLabel = category.id; choose.append(label);
        choose.addEventListener("click", () => { selected = category.id; render(); focusKey(`category-${category.id}`); });
        chip.append(choose, action(`Move ${category.name} left`, "‹", () => moveCategory(category.id, -1), index === 0), action(`Move ${category.name} right`, "›", () => moveCategory(category.id, 1), index === values.length - 1));
        dragEvents(chip, "category", category.id); dock.append(chip);
      });
      const category = values.find(item => item.id === selected); if (!category) return;
      const productAction = doc.getElementById("addProduct");
      if (productAction) { productAction.setAttribute("aria-label", `Add product to ${category.name}`); const scope = productAction.querySelector("small"); if (scope) scope.textContent = `To ${category.name}`; }
      const labels = node("div", "category-layout-labels"); labels.append(field("Category name", "name", category), field("Board title", "title", category), field("Side label", "sideLabel", category));
      const heading = node("div", "category-layout-lane-heading"); heading.append(node("h4", "", "Board layout"), node("span", "", "Drag lanes or use the arrows"));
      const lanes = node("div", "category-layout-lanes");
      category.lanes.forEach((lane, index) => {
        const row = node("div", "category-layout-lane"); dragEvents(row, "lane", lane.id);
        const handle = node("span", "category-layout-grip", "⠿"); handle.setAttribute("aria-hidden", "true");
        const laneFields = node("div", "category-layout-lane-fields"); laneFields.append(field("Lane name", "label", category, lane), field("Subtitle", "subtitle", category, lane));
        const silhouette = node("div", "category-layout-silhouette"); silhouette.setAttribute("aria-hidden", "true");
        const record = adapter.getPortfolio().categories.find(item => item.id === category.id), count = record?.board.products.filter(product => product.laneId === lane.id).length || 0;
        for (let number = 0; number < Math.max(1, Math.min(count, 5)); number++) silhouette.append(node("span", "category-layout-card"));
        const countLabel = node("span", "category-layout-count", `${count} ${count === 1 ? "product" : "products"}`);
        const moves = node("div", "category-layout-lane-moves"); moves.append(action(`Move ${lane.label} up`, "↑", () => moveLane(lane.id, -1), index === 0), action(`Move ${lane.label} down`, "↓", () => moveLane(lane.id, 1), index === category.lanes.length - 1));
        row.append(handle, laneFields, silhouette, countLabel, moves); lanes.append(row);
      });
      const addLane = node("form", "category-layout-add category-layout-add-lane"), laneName = node("input"); laneName.type = "text"; laneName.maxLength = 240; laneName.placeholder = "New lane name"; laneName.setAttribute("aria-label", "New lane name");
      const laneAdd = node("button", "", "Add lane"); laneAdd.type = "submit"; addLane.append(laneName, laneAdd);
      addLane.addEventListener("submit", event => { event.preventDefault(); if (!laneName.value.trim()) { laneName.focus(); return; } const target = ensureDraft().find(item => item.id === selected); if (target.lanes.length >= 100) { problem.textContent = "This category already has 100 lanes."; return; } const laneId = "lane-" + root.crypto.randomUUID(); target.lanes.push({ id: laneId, label: laneName.value.trim(), subtitle: "", order: target.lanes.length }); render(); focusKey(`lane-${laneId}`); });
      editor.append(labels, heading, lanes, addLane); setDirty();
    }
    addRow.addEventListener("submit", event => { event.preventDefault(); const name = newName.value.trim(); if (!name) { newName.focus(); return; } const values = current(); if (values.length >= 200 || values.some(category => category.name.trim().toLowerCase() === name.toLowerCase())) { problem.textContent = values.length >= 200 ? "This portfolio already has 200 categories." : "A category with this name already exists."; return; } selected = uniqueId(); ensureDraft().push({ id: selected, custom: true, name, title: `${name} Portfolio`, sideLabel: name, lanes: [{ id: "main", label: "Main", subtitle: "", order: 0 }] }); newName.value = ""; render(); focusKey("field-title"); status.textContent = "Category added to this draft. Save layout to use it."; });
    cancel.addEventListener("click", () => { draft = null; base = ""; render(); focusKey(`category-${selected}`); status.textContent = "Draft cancelled. Current layout restored."; });
    save.addEventListener("click", () => { if (!draft) return; try { validate(draft, adapter.getPortfolio()); adapter.applyLayout(copy(draft), base); draft = null; base = ""; render(); focusKey(`category-${selected}`); status.textContent = "Category layout saved on this device."; } catch (error) { problem.textContent = error.message; } });
    doc.getElementById("addProduct")?.addEventListener("click", event => {
      event.preventDefault(); event.stopImmediatePropagation();
      if (draft) { problem.textContent = "Save or cancel the layout draft before adding a product."; save.focus(); return; }
      try { adapter.addProduct(selected); } catch (error) { problem.textContent = error.message; }
    }, true);
    root.addEventListener("portfolio:settings-section", event => { if (event.detail?.section === "category") { if (!draft) selected = adapter.getPortfolio().activeCategoryId; render(); } });
    root.addEventListener("portfolio:render", () => { if (!draft) render(); });
    render();
  }
  if (root.document) { root.addEventListener("portfolio:ui-ready", initialize); root.addEventListener("portfolio:workspace-ready", initialize); if (root.PortfolioWorkspaceUI) initialize(); }
})(typeof window !== "undefined" ? window : globalThis);
