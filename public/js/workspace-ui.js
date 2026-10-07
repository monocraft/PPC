/* The workspace shell: navigation and one accessible home for every setting. */
(() => {
  "use strict";

  const get = (id) => document.getElementById(id);
  const dialog = get("workspaceSettingsDialog");
  const trigger = get("workspaceSettingsButton");
  const tabs = [...document.querySelectorAll("[data-settings-tab]")];
  const panels = [...document.querySelectorAll("[data-settings-panel]")];
  const select = get("categorySelect");
  const app = document.querySelector(".app-shell");
  const header = document.querySelector(".topbar");
  const controls = document.querySelector(".workspace-controls");
  let restoreFocus = null;
  let activeTab = "display";
  let snapshot = null;

  function activateTab(name, focus = false) {
    activeTab = tabs.some((tab) => tab.dataset.settingsTab === name) ? name : "display";
    for (const tab of tabs) {
      const selected = tab.dataset.settingsTab === activeTab;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
    for (const panel of panels) panel.classList.toggle("hidden", panel.dataset.settingsPanel !== activeTab);
    get("settingsActiveCategory").textContent = select.selectedOptions[0]?.textContent || "Active category";
  }

  function openSettings(tabName = activeTab) {
    const wasClosed = dialog.classList.contains("hidden");
    if (wasClosed) restoreFocus = document.activeElement;
    dialog.classList.remove("hidden");
    trigger.setAttribute("aria-expanded", "true");
    app.inert = true;
    get("workspaceEmpty").inert = true;
    activateTab(tabName, true);
  }

  function closeSettings() {
    if (dialog.classList.contains("hidden")) return;
    dialog.classList.add("hidden");
    trigger.setAttribute("aria-expanded", "false");
    app.inert = false;
    get("workspaceEmpty").inert = false;
    if (restoreFocus?.isConnected && !restoreFocus.disabled && !restoreFocus.closest(".hidden")) restoreFocus.focus();
    else trigger.focus();
  }

  function clickAction(id) {
    const action = get(id);
    if (action && !action.disabled) action.click();
  }

  function refresh(detail = snapshot) {
    if (detail) snapshot = detail;
    const activeId = detail?.activeCategoryId || select.value;
    const categories = detail?.categories || [...select.options].map((option) => ({ id: option.value, name: option.textContent, count: null }));
    const active = categories.find((category) => category.id === activeId);
    const total = detail?.productCount ?? active?.count;
    const selected = detail?.selectedName;
    const hasPortfolioProducts = total > 0 || categories.some((category) => category.count > 0);
    const emptyPortfolio = total === 0 && !hasPortfolioProducts;

    app.classList.toggle("is-empty-portfolio", emptyPortfolio);
    header.classList.toggle("hidden", emptyPortfolio);
    controls.classList.toggle("hidden", emptyPortfolio);
    get("statusbar").classList.toggle("hidden", emptyPortfolio);

    get("settingsActiveCategory").textContent = active?.name || select.selectedOptions[0]?.textContent || "Active category";
    const visible = detail?.visibleCount;
    get("workspaceSummary").textContent = total == null ? "Portfolio" : `${visible != null && visible < total ? `${visible} of ` : ""}${total} ${total === 1 ? "product" : "products"}`;
    if (detail) get("workspaceSelection").textContent = selected || "No product selected";
    get("quickEditSelected").disabled = get("editSelected").disabled;
    get("workspaceEmpty").classList.toggle("hidden", total !== 0);
    get("workspaceEmptyTitle").textContent = hasPortfolioProducts ? "This category is empty" : "Start your portfolio";
    updateTimelineSummary();
  }

  function updateTimelineSummary() {
    const from = get("roadmapStart").value;
    const to = get("roadmapEnd").value;
    get("timelineRangeSummary").textContent = from && to ? `${from.slice(0, 4)}–${to.slice(0, 4)}` : "";
  }

  trigger.addEventListener("click", () => openSettings());
  get("workspaceSettingsClose").addEventListener("click", closeSettings);
  get("workspaceSettingsDone").addEventListener("click", closeSettings);
  get("quickTimelineSettings").addEventListener("click", () => openSettings("timeline"));
  get("emptyImportPackage").addEventListener("click", () => clickAction("importPackage"));
  get("quickEditSelected").addEventListener("click", () => clickAction("editSelected"));
  get("dataMenuButton").onclick = () => openSettings("data");
  get("productMenuButton").onclick = () => openSettings("display");
  get("roadmapMenuButton").onclick = () => openSettings("timeline");
  tabs.forEach((tab) => tab.addEventListener("click", () => activateTab(tab.dataset.settingsTab)));

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeSettings();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSettings();
    } else if (["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key) && event.target.closest("[data-settings-tab]")) {
      event.preventDefault();
      let index = tabs.indexOf(event.target.closest("[data-settings-tab]"));
      if (event.key === "Home") index = 0;
      else if (event.key === "End") index = tabs.length - 1;
      else index = (index + (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1) + tabs.length) % tabs.length;
      activateTab(tabs[index].dataset.settingsTab, true);
    } else if (event.key === "Tab") {
      const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex="0"]')]
        .filter((element) => !element.closest(".hidden") && element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first) {
        event.preventDefault();
        dialog.focus();
      } else if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  window.addEventListener("close-workspace-settings", closeSettings);
  window.addEventListener("portfolio:render", (event) => refresh(event.detail));
  get("roadmapStart").addEventListener("change", updateTimelineSummary);
  get("roadmapEnd").addEventListener("change", updateTimelineSummary);
  new MutationObserver(() => { get("quickEditSelected").disabled = get("editSelected").disabled; })
    .observe(get("editSelected"), { attributes: true, attributeFilter: ["disabled"] });
  new MutationObserver(() => { if (!snapshot) refresh(); })
    .observe(select, { childList: true, subtree: true });

  window.PortfolioWorkspaceUI = Object.freeze({ openSettings, closeSettings, refresh });
  refresh();
  window.dispatchEvent(new CustomEvent("portfolio:ui-ready"));
})();
