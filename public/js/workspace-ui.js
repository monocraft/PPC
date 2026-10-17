/* The workspace shell: navigation and one accessible home for every setting. */
(() => {
  "use strict";

  const get = (id) => document.getElementById(id);
  const dialog = get("workspaceSettingsDialog");
  const trigger = get("workspaceSettingsButton");
  const tabs = [...document.querySelectorAll("[data-settings-tab]")];
  const panels = [...document.querySelectorAll("[data-settings-panel]")];
  const categoryContext = get("categoryContext");
  const app = document.querySelector(".app-shell");
  const header = document.querySelector(".topbar");
  const controls = document.querySelector(".workspace-controls");
  let activeTab = "display";
  let snapshot = null;
  let activeSettingsModal = null;

  function isAvailable(element) {
    return Boolean(element?.isConnected && !element.disabled &&
      !element.closest("[inert], .hidden, [hidden], .visually-hidden") &&
      element.getClientRects().length &&
      (typeof getComputedStyle !== "function" || getComputedStyle(element).visibility !== "hidden"));
  }

  function modalControls(container) {
    return [...container.querySelectorAll('button, input, select, textarea, a[href], summary, [tabindex]')]
      .filter((element) => element.tabIndex >= 0 && !element.matches?.(":disabled") && isAvailable(element));
  }

  // Settings share one focus owner. Message dialogs temporarily take ownership
  // through their existing inert snapshot, then return it to these controllers.
  function createSettingsModal(element) {
    let returnFocus = null;
    let initialFocus = null;
    let lastFocus = null;
    let inertSnapshot = new Map();
    const isOpen = () => !element.classList.contains("hidden");
    const ownsFocus = () => activeSettingsModal === controller && isOpen() && !element.inert &&
      !window.PortfolioDialogs?.isOpen?.() && !document.querySelector("dialog[open]");
    const focusInside = (preferred = lastFocus) => {
      const target = element.contains(preferred) && isAvailable(preferred) ? preferred :
        element.contains(initialFocus) && isAvailable(initialFocus) ? initialFocus : modalControls(element)[0] || element;
      target.focus({ preventScroll: true });
    };
    const observer = new MutationObserver(() => {
      if (ownsFocus() && (!element.contains(document.activeElement) || !isAvailable(document.activeElement))) focusInside();
    });
    const controller = {
      isOpen,
      ownsFocus,
      open(options = {}) {
        if (window.PortfolioDialogs?.isOpen?.()) return false;
        if (!isOpen()) {
          activeSettingsModal?.close({ restoreFocus: false });
          returnFocus = options.returnFocus || document.activeElement;
          initialFocus = options.initialFocus || null;
          lastFocus = null;
          element.setAttribute("tabindex", "-1");
          element.classList.remove("hidden");
          element.setAttribute("aria-hidden", "false");
          activeSettingsModal = controller;
          inertSnapshot = new Map();
          for (const background of new Set([app, get("workspaceEmpty"), ...document.querySelectorAll(".modal-backdrop")])) {
            if (!background || background === element || (background !== app && background !== get("workspaceEmpty") && !isAvailable(background))) continue;
            inertSnapshot.set(background, { attribute: background.getAttribute("inert"), inert: background.inert });
            if (!background.inert) background.inert = true;
          }
          observer.observe(element, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled", "hidden", "class", "tabindex"] });
        } else if (options.initialFocus) initialFocus = options.initialFocus;
        focusInside(initialFocus);
        return true;
      },
      close({ restoreFocus = true } = {}) {
        if (!isOpen() || window.PortfolioDialogs?.isOpen?.()) return null;
        observer.disconnect?.();
        element.classList.add("hidden");
        element.setAttribute("aria-hidden", "true");
        if (activeSettingsModal === controller) activeSettingsModal = null;
        for (const [background, previous] of inertSnapshot) {
          if (previous.attribute === null) background.inert = previous.inert;
          else background.setAttribute("inert", previous.attribute);
        }
        inertSnapshot.clear();
        const preferred = returnFocus;
        if (restoreFocus) {
          const target = preferred !== document.body && isAvailable(preferred) ? preferred : isAvailable(trigger) ? trigger :
            [get("emptyImportPackage"), get("emptyPullLatestData")].find(isAvailable);
          target?.focus({ preventScroll: true });
        }
        return preferred;
      },
      handleKeydown(event) {
        if (!ownsFocus()) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          controller.close();
          if (element === dialog) trigger.setAttribute("aria-expanded", "false");
        } else if (event.key === "Tab") {
          const controls = modalControls(element);
          const first = controls[0], last = controls.at(-1);
          const active = document.activeElement;
          if (!first || !controls.includes(active) || event.shiftKey && active === first || !event.shiftKey && active === last) {
            event.preventDefault();
            (event.shiftKey ? last || element : first || element).focus({ preventScroll: true });
          }
        }
      },
      handleFocusin(event) {
        if (!ownsFocus()) return;
        if (element.contains(event.target) && isAvailable(event.target)) lastFocus = event.target;
        else focusInside();
      },
    };
    return controller;
  }

  const workspaceModal = createSettingsModal(dialog);
  const categoryModal = createSettingsModal(get("categorySettingsDialog"));
  document.addEventListener("keydown", (event) => activeSettingsModal?.handleKeydown(event), true);
  document.addEventListener("focusin", (event) => activeSettingsModal?.handleFocusin(event), true);

  function setupToolbarMenus() {
    const menus = [...document.querySelectorAll(".workspace-tool-menu")];
    const summaryFor = (menu) => menu?.querySelector("summary");
    const visible = (node) => node?.isConnected && !node.closest(".hidden") && node.getClientRects().length > 0;
    function close({ except = null, focus = false } = {}) {
      const closing = menus.filter((menu) => menu !== except && menu.open);
      for (const menu of closing) menu.open = false;
      if (focus) {
        const summary = summaryFor(closing[0]);
        if (visible(summary)) summary.focus({ preventScroll: true });
      }
      return closing.length > 0;
    }
    for (const menu of menus) {
      menu.addEventListener("toggle", () => { if (menu.open) close({ except: menu }); });
      menu.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !menu.open) return;
        event.preventDefault();
        event.stopPropagation();
        close({ focus: true });
      });
      menu.addEventListener("focusout", (event) => {
        if (event.relatedTarget && !menu.contains(event.relatedTarget)) menu.open = false;
      });
    }
    document.addEventListener("pointerdown", (event) => {
      if (!event.target.closest(".workspace-tool-menu")) close();
    });
    document.addEventListener("click", (event) => {
      const button = event.target.closest(".workspace-tool-menu-panel button");
      if (!button || button.disabled) return;
      const menu = button.closest(".workspace-tool-menu");
      const summary = summaryFor(menu);
      close();
      if (!app.inert && document.activeElement === button && visible(summary)) summary.focus({ preventScroll: true });
    });
    return close;
  }
  const closeToolMenus = setupToolbarMenus();

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
    get("settingsActiveCategory").textContent = snapshot?.categories?.find(category => category.id === snapshot.activeCategoryId)?.name || categoryContext?.textContent || "Active category";
  }

  function openSettings(tabName = activeTab) {
    if (window.PortfolioDialogs?.isOpen?.()) return;
    const actionMenu = document.activeElement?.closest(".workspace-tool-menu");
    const returnFocus = actionMenu?.querySelector("summary") || document.activeElement;
    closeToolMenus();
    activateTab(tabName);
    workspaceModal.open({ returnFocus, initialFocus: tabs.find((tab) => tab.dataset.settingsTab === activeTab) });
    trigger.setAttribute("aria-expanded", "true");
  }

  function closeSettings(options) {
    const returnFocus = workspaceModal.close(options);
    if (!workspaceModal.isOpen()) trigger.setAttribute("aria-expanded", "false");
    return returnFocus;
  }

  function clickAction(id) {
    const action = get(id);
    if (action && !action.disabled) action.click();
  }

  function refresh(detail = snapshot) {
    if (detail) snapshot = detail;
    const activeId = detail?.activeCategoryId;
    const categories = detail?.categories || [];
    const active = categories.find((category) => category.id === activeId);
    const total = detail?.productCount ?? active?.count;
    const selected = detail?.selectedName;
    const hasPortfolioProducts = total > 0 || categories.some((category) => category.count > 0);
    const emptyPortfolio = total === 0 && !hasPortfolioProducts;

    app.classList.toggle("is-empty-portfolio", emptyPortfolio);
    header.classList.toggle("hidden", emptyPortfolio);
    controls.classList.toggle("hidden", emptyPortfolio);
    get("statusbar").classList.toggle("hidden", emptyPortfolio);

    get("settingsActiveCategory").textContent = active?.name || categoryContext?.textContent || "Active category";
    const visible = detail?.visibleCount;
    get("workspaceSummary").textContent = total == null ? "Portfolio" : `${visible != null && visible < total ? `${visible} of ` : ""}${total} ${total === 1 ? "product" : "products"}`;
    if (detail) {
      get("workspaceSelection").textContent = selected || "No product selected";
      get("workspaceSelection").title = selected || "No product selected";
    }
    get("quickEditSelected").disabled = get("editSelected").disabled;
    get("quickEditSelected").title = selected ? `Edit ${selected}` : "Select a product to edit";
    get("quickEditSelected").setAttribute("aria-label", selected ? `Edit product: ${selected}` : "Edit product");
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
    if (["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key) && event.target.closest("[data-settings-tab]")) {
      event.preventDefault();
      let index = tabs.indexOf(event.target.closest("[data-settings-tab]"));
      if (event.key === "Home") index = 0;
      else if (event.key === "End") index = tabs.length - 1;
      else index = (index + (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1) + tabs.length) % tabs.length;
      activateTab(tabs[index].dataset.settingsTab, true);
    }
  });

  window.addEventListener("close-workspace-settings", closeSettings);
  window.addEventListener("portfolio:render", (event) => refresh(event.detail));
  get("roadmapStart").addEventListener("change", updateTimelineSummary);
  get("roadmapEnd").addEventListener("change", updateTimelineSummary);
  new MutationObserver(() => { get("quickEditSelected").disabled = get("editSelected").disabled; })
    .observe(get("editSelected"), { attributes: true, attributeFilter: ["disabled"] });

  window.PortfolioWorkspaceUI = Object.freeze({ openSettings, closeSettings, refresh, closeToolMenus,
    openCategorySettings: (options) => categoryModal.open(options),
    closeCategorySettings: () => categoryModal.close(),
  });
  refresh();
  window.dispatchEvent(new CustomEvent("portfolio:ui-ready"));
})();
