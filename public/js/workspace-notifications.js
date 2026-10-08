/* Workspace messages stay readable and actionable without stretching the toolbar. */
(function (root) {
  "use strict";

  const severities = new Set(["info", "success", "warning", "error"]);
  const urgent = (item) => item.severity === "warning" || item.severity === "error";
  const text = (value, limit) => String(value ?? "").trim().slice(0, limit);

  function createStore({ now = () => Date.now(), limit = 60 } = {}) {
    const items = new Map(), dismissed = new Map(), listeners = new Set();
    let sequence = 0;
    const emit = (event) => { for (const listener of listeners) listener(event); };
    const fingerprint = (item) => JSON.stringify([item.severity, item.title, item.message, item.revision, item.dismissible, item.actions.map((action) => [action.id, action.label])]);
    const snapshot = () => [...items.values()].sort((a, b) => Number(urgent(b)) - Number(urgent(a)) || b.sequence - a.sequence).map((item) => ({ ...item, actions: item.actions.map((action) => ({ ...action })) }));
    function expire() {
      let changed = false;
      for (const [id, item] of items) if (item.expiresAt && item.expiresAt <= now()) { items.delete(id); changed = true; }
      if (changed) emit({ type: "expire" });
    }
    function publish(value = {}) {
      expire();
      const id = text(value.id, 160) || `message-${++sequence}`;
      const severity = severities.has(value.severity) ? value.severity : "info";
      const actions = (Array.isArray(value.actions) ? value.actions : []).filter((action) => typeof action?.onClick === "function" && text(action.label, 100)).slice(0, 4).map((action, index) => ({ id: text(action.id, 100) || `action-${index}`, label: text(action.label, 100), onClick: action.onClick }));
      const item = { id, severity, title: text(value.title, 300) || ({ info: "Workspace update", success: "Completed", warning: "Needs your attention", error: "Could not complete" })[severity], message: text(value.message, 24000), revision: text(value.revision, 200), dismissible: value.dismissible !== false, actions, createdAt: now(), sequence: ++sequence, read: false, expiresAt: 0 };
      const previous = items.get(id), signature = fingerprint(item);
      if (dismissed.get(id) === signature) return null;
      if (previous && fingerprint(previous) === signature) {
        // Callbacks can change with a newly rendered workspace without creating another message.
        previous.actions = actions;
        return { ...previous, actions: actions.map((action) => ({ ...action })) };
      }
      item.expiresAt = !urgent(item) && item.dismissible ? now() + Math.max(1000, Number(value.ttl) || 15 * 60 * 1000) : 0;
      dismissed.delete(id); items.set(id, item);
      // Keep current warnings and errors; discard older informational history first.
      while (items.size > limit) {
        const removable = [...items.values()].filter((entry) => !urgent(entry) && entry.dismissible).sort((a, b) => a.sequence - b.sequence)[0];
        if (!removable) break;
        items.delete(removable.id);
      }
      emit({ type: "publish", item: { ...item }, toast: value.toast === true || (value.toast !== false && severity === "success") });
      return { ...item, actions: actions.map((action) => ({ ...action })) };
    }
    function resolve(id) {
      const key = String(id); dismissed.delete(key);
      if (items.delete(key)) emit({ type: "resolve", id: key });
    }
    function dismiss(id) {
      const item = items.get(String(id));
      if (!item || !item.dismissible) return false;
      dismissed.set(item.id, fingerprint(item)); items.delete(item.id);
      while (dismissed.size > limit * 2) dismissed.delete(dismissed.keys().next().value);
      emit({ type: "dismiss", id: item.id }); return true;
    }
    function markRead() {
      let changed = false;
      for (const item of items.values()) if (!item.read) { item.read = true; changed = true; }
      if (changed) emit({ type: "read" });
    }
    function state() {
      expire(); const all = snapshot();
      return { items: all, count: all.filter((item) => urgent(item) || !item.read).length, attentionCount: all.filter(urgent).length };
    }
    return Object.freeze({ publish, upsert: publish, resolve, dismiss, markRead, expire, getState: state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } });
  }

  let active = null;
  const store = createStore();
  const element = (document, tag, className, content) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  };
  function initialize({ document = root.document, messageStore = store } = {}) {
    if (active) return active;
    const settings = document?.getElementById("workspaceSettingsButton");
    if (!settings) return null;
    const create = (tag, className, content) => element(document, tag, className, content);
    const button = create("button", "workspace-messages-trigger");
    button.id = "workspaceMessagesButton"; button.type = "button";
    button.setAttribute("aria-haspopup", "dialog"); button.setAttribute("aria-controls", "workspaceMessagesPanel"); button.setAttribute("aria-expanded", "false");
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg"); icon.setAttribute("class", "workspace-messages-symbol"); icon.setAttribute("viewBox", "0 0 24 24"); icon.setAttribute("aria-hidden", "true"); icon.setAttribute("focusable", "false");
    const bell = document.createElementNS("http://www.w3.org/2000/svg", "path"); bell.setAttribute("d", "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"); icon.append(bell);
    const label = create("span", "workspace-messages-label", "Messages"), badge = create("span", "workspace-messages-count"); badge.setAttribute("aria-hidden", "true");
    button.append(icon, label, badge);
    (document.getElementById("pullLatestData") || settings).insertAdjacentElement("beforebegin", button);
    const panel = create("dialog", "workspace-messages-panel"); panel.id = "workspaceMessagesPanel";
    panel.setAttribute("aria-labelledby", "workspaceMessagesTitle"); panel.setAttribute("aria-describedby", "workspaceMessagesDescription");
    const heading = create("header", "workspace-messages-heading"), copy = create("div"), title = create("h2", "", "Messages"); title.id = "workspaceMessagesTitle";
    const description = create("p", "", "Updates, warnings, and items to review."); description.id = "workspaceMessagesDescription";
    copy.append(title, description);
    const close = create("button", "workspace-messages-close", "×"); close.type = "button"; close.setAttribute("aria-label", "Close messages");
    heading.append(copy, close);
    const list = create("div", "workspace-messages-list"), footer = create("footer", "workspace-messages-footer"), clear = create("button", "quiet-button", "Clear updates"); clear.type = "button";
    const footerNote = create("p", "", "Warnings stay here until resolved or dismissed."); footer.append(footerNote, clear);
    panel.append(heading, list, footer);
    const polite = create("div", "visually-hidden"); polite.setAttribute("role", "status"); polite.setAttribute("aria-live", "polite"); polite.setAttribute("aria-atomic", "true");
    const assertive = create("div", "visually-hidden"); assertive.setAttribute("role", "alert"); assertive.setAttribute("aria-atomic", "true");
    const toasts = create("div", "workspace-toast-region"); toasts.setAttribute("aria-label", "Recent workspace update");
    document.body.append(panel, polite, assertive, toasts);
    let returnFocus = null, toastTimer = null, actionRunning = false, toastId = "", destroyed = false;
    function isModalOpen() {
      return document.querySelector('dialog[open], .modal-backdrop:not(.hidden):not([hidden])') !== null;
    }
    function removeToast() {
      root.clearTimeout(toastTimer); toastTimer = null; toastId = ""; toasts.replaceChildren();
    }
    function closePanel() {
      if (!panel.open) return;
      panel.close(); button.setAttribute("aria-expanded", "false");
      if (returnFocus?.isConnected && !returnFocus.disabled && !returnFocus.closest?.("[inert], .hidden, [hidden]")) returnFocus.focus({ preventScroll: true });
      else if (button.isConnected) button.focus({ preventScroll: true });
      returnFocus = null;
    }
    function show(id) {
      if (destroyed) return;
      removeToast();
      if (!panel.open) {
        if (isModalOpen()) return;
        returnFocus = document.activeElement; panel.showModal(); button.setAttribute("aria-expanded", "true");
      }
      messageStore.markRead(); render(); close.focus({ preventScroll: true });
      if (id) [...list.children].find((node) => node.dataset.messageId === String(id))?.scrollIntoView?.({ block: "nearest" });
    }
    async function runAction(item, action) {
      if (actionRunning || destroyed) return;
      actionRunning = true; render(); closePanel();
      try { await action.onClick(); }
      catch (error) {
        messageStore.publish({ id: `${item.id}:action-error`, severity: "error", title: "Could not complete this action", message: error?.message || "Please try again. Your workspace changes remain on this device.", toast: false });
      } finally { actionRunning = false; if (!destroyed) render(); }
    }
    function render() {
      if (destroyed) return;
      const state = messageStore.getState();
      badge.textContent = state.count > 99 ? "99+" : String(state.count); badge.hidden = state.count === 0;
      button.classList.toggle("has-attention", state.attentionCount > 0);
      button.setAttribute("aria-label", `Messages${state.count ? `, ${state.count} ${state.count === 1 ? "item" : "items"} to review` : ", no new messages"}`);
      button.title = state.attentionCount ? `${state.attentionCount} ${state.attentionCount === 1 ? "warning or error" : "warnings or errors"} to review` : "View workspace updates and warnings";
      clear.disabled = !state.items.some((item) => !urgent(item) && item.dismissible);
      if (!panel.open) return;
      const focused = document.activeElement, focusedKey = focused?.dataset?.messageControl;
      const rows = state.items.map((item) => {
        const row = create("article", `workspace-message workspace-message-${item.severity}`); row.dataset.messageId = item.id;
        const top = create("div", "workspace-message-top"), kind = create("span", "workspace-message-kind", ({ info: "Update", success: "Complete", warning: "Warning", error: "Error" })[item.severity]);
        top.append(kind);
        if (item.dismissible) {
          const dismiss = create("button", "workspace-message-dismiss", "×"); dismiss.type = "button"; dismiss.setAttribute("aria-label", `Dismiss ${item.title}`); dismiss.dataset.messageControl = `${item.id}:dismiss`;
          dismiss.addEventListener("click", () => { messageStore.dismiss(item.id); if (panel.open) close.focus({ preventScroll: true }); }); top.append(dismiss);
        }
        row.append(top, create("h3", "", item.title));
        if (item.message) row.append(create("p", "workspace-message-copy", item.message));
        if (item.actions.length) {
          const actions = create("div", "workspace-message-actions");
          for (const action of item.actions) {
            const control = create("button", "quiet-button", action.label); control.type = "button"; control.disabled = actionRunning; control.dataset.messageControl = `${item.id}:${action.id}`;
            control.addEventListener("click", () => { void runAction(item, action); }); actions.append(control);
          }
          row.append(actions);
        }
        return row;
      });
      if (!rows.length) { const empty = create("div", "workspace-messages-empty"); empty.append(create("span", "", "✓"), create("h3", "", "You're all caught up"), create("p", "", "Workspace updates and warnings will appear here.")); rows.push(empty); }
      list.replaceChildren(...rows);
      if (focusedKey) [...list.querySelectorAll("button")].find((node) => node.dataset.messageControl === focusedKey)?.focus({ preventScroll: true });
    }
    function showToast(item) {
      // A notice must never cover the active editor, save review, or conflict choices.
      if (isModalOpen() || document.visibilityState === "hidden") return;
      removeToast(); toastId = item.id;
      const card = create("div", `workspace-toast workspace-toast-${item.severity}`), copy = create("span", "workspace-toast-copy", text(item.title, 160));
      const view = create("button", "workspace-toast-view", "View"); view.type = "button"; view.addEventListener("click", () => show(item.id));
      const dismiss = create("button", "workspace-toast-dismiss", "×"); dismiss.type = "button"; dismiss.setAttribute("aria-label", "Hide update"); dismiss.addEventListener("click", removeToast);
      card.append(copy, view, dismiss); toasts.append(card);
      toastTimer = root.setTimeout(removeToast, 4500);
    }
    const unsubscribe = messageStore.subscribe((event) => {
      if (destroyed) return;
      if (panel.open && event.type === "publish") messageStore.markRead();
      render();
      if (event.type === "publish") {
        const announcement = urgent(event.item) ? assertive : polite;
        announcement.textContent = `${event.item.title}. ${event.item.message}`;
        if (event.toast) showToast(event.item);
      } else if ((event.type === "resolve" || event.type === "dismiss") && event.id === toastId) removeToast();
    });
    button.addEventListener("click", () => panel.open ? closePanel() : show());
    close.addEventListener("click", closePanel);
    clear.addEventListener("click", () => { for (const item of messageStore.getState().items) if (!urgent(item) && item.dismissible) messageStore.dismiss(item.id); });
    panel.addEventListener("cancel", (event) => { event.preventDefault(); event.stopPropagation(); closePanel(); });
    panel.addEventListener("click", (event) => {
      event.stopPropagation();
      if (event.target !== panel) return;
      const box = panel.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closePanel();
    });
    panel.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); closePanel(); }
    });
    panel.addEventListener("pointerdown", (event) => event.stopPropagation());
    const expirationTimer = root.setInterval(() => messageStore.expire(), 60000);
    active = Object.freeze({ show, close: closePanel, getState: messageStore.getState, destroy() { destroyed = true; unsubscribe(); root.clearInterval(expirationTimer); removeToast(); if (panel.open) panel.close(); panel.remove(); button.remove(); polite.remove(); assertive.remove(); toasts.remove(); active = null; } });
    render(); return active;
  }
  root.PortfolioNotifications = Object.freeze({ createStore, initialize, publish: store.publish, upsert: store.publish, resolve: store.resolve, dismiss: store.dismiss, show: (id) => (active || initialize())?.show(id), toast: (message, options = {}) => store.publish({ ...options, title: options.title || String(message), message: options.message || "", toast: true }), getState: store.getState });
  if (root.document) initialize();
})(globalThis);
