/* One familiar action: pull the shared portfolio, or save the changes waiting on this device. */
(function (root) {
  "use strict";
  let active = null;
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const readable = (value) => {
    if (value === null || value === undefined || value === "") return "Not set";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value !== "object") return String(value);
    if (Array.isArray(value)) return value.length ? value.map(readable).join("\n") : "None";
    const entries = Object.entries(value).filter(([field]) => !["id", "type"].includes(field));
    return entries.map(([field, content]) => `${field}: ${readable(content)}`).join("\n") || "None";
  };

  function initialize({ adapter = root.PortfolioMasterAdapter, source = root.PPC_MASTER_SOURCE || root.PPC_DATE_MASTER_SOURCE, fetchImpl } = {}) {
    if (active) return active;
    const button = document.getElementById("pullLatestData");
    if (!button || !adapter || !root.PortfolioMasterClient || !root.PortfolioMasterModel) return null;
    const endpoint = source?.endpoint || (root.PPC_PACKAGE_SOURCE?.mode === "relay" ? root.PPC_PACKAGE_SOURCE.endpoint : "");
    const teamMode = source?.team === true || source?.mode === "github";
    // Browser users never receive the private backend's repository credential.
    const session = root.PortfolioMasterClient.createSession({ endpoint, source: { ...source, mode: "service", team: teamMode }, adapter, fetchImpl });
    const configured = session.getState().configured;
    const notices = root.PortfolioNotifications;
    const dialog = element("dialog", "master-dialog");
    dialog.id = "masterDialog";
    dialog.setAttribute("aria-labelledby", "masterDialogTitle"); dialog.setAttribute("aria-describedby", "masterDialogDescription");
    document.body.append(dialog);
    let running = false, modalResolve = null, modalCancel = null, lastError = "";

    function updateStatus() {
      const state = session.getState(), count = state.pending.length;
      button.textContent = running ? "Saving…" : count ? "Save to master" : "Pull latest data";
      button.disabled = running || Boolean(adapter.hasPendingPackageOperation?.());
      button.title = count ? `Review and save changes for ${count} ${count === 1 ? "product" : "products"} to the shared master` : "Load the shared portfolio with your package key";
      button.classList.toggle("master-has-changes", count > 0);
      if (count) notices?.publish({ id: "master-pending", severity: "info", title: running ? "Saving changes to master" : "Changes ready to share", message: `${count} ${count === 1 ? "product has" : "products have"} changes saved on this device.${running ? " Your teams will receive accepted changes when they next check the master." : " Review your changes before sharing them with your teams."}`, toast: false, dismissible: false, actions: running ? [] : [{ label: "Review changes", onClick: saveFlow }] });
      else notices?.resolve("master-pending");
      if (count && !configured) notices?.publish({ id: "master-saving-unavailable", severity: "warning", title: "Team saving is not connected", message: "Your portfolio owner needs to finish connecting the private saving service. You can keep editing; your changes remain saved on this device.", toast: false });
      else notices?.resolve("master-saving-unavailable");
      if (lastError) notices?.publish({ id: "master-sync-error", severity: "error", title: "Master connection needs attention", message: lastError, toast: false, actions: [...(/duplicate|repeated.*(?:product|sku)/i.test(lastError) ? [{ label: "Review duplicates", onClick: () => root.PortfolioProductIssues?.reviewDuplicateIssues?.() }] : []), { label: count ? "Review and try again" : "Pull latest data", onClick: () => count ? saveFlow() : root.PortfolioPackageUI?.open("pull") }] });
      else notices?.resolve("master-sync-error");
      root.dispatchEvent(new CustomEvent("portfolio:master-status", { detail: { connected: state.connected, hasKey: state.hasKey } }));
    }

    function close(value) {
      const resolve = modalResolve; modalResolve = null; modalCancel = null;
      if (dialog.open) dialog.close();
      resolve?.(value);
      if (!running && button.isConnected) button.focus({ preventScroll: true });
    }

    function show(title, description, contentBuilder, { cancellable = true } = {}) {
      if (modalResolve) close(null);
      dialog.replaceChildren();
      const form = element("form", "master-dialog-form"); form.method = "dialog";
      const header = element("header", "master-dialog-heading"), titleWrap = element("div");
      const titleNode = element("h2", "", title); titleNode.id = "masterDialogTitle";
      const descriptionNode = element("p", "master-dialog-description", description); descriptionNode.id = "masterDialogDescription";
      titleWrap.append(titleNode, descriptionNode); header.append(titleWrap);
      if (cancellable) {
        const dismiss = element("button", "icon-button master-dialog-close", "×"); dismiss.type = "button"; dismiss.setAttribute("aria-label", "Close and keep local changes");
        dismiss.addEventListener("click", () => close(null)); header.append(dismiss);
      }
      const body = element("div", "master-dialog-body"), footer = element("footer", "master-dialog-actions");
      form.append(header, body, footer); dialog.append(form);
      return new Promise((resolve) => {
        modalResolve = resolve; modalCancel = cancellable ? () => close(null) : () => {};
        contentBuilder({ body, footer, form, finish: close });
        dialog.showModal();
        (form.querySelector("[autofocus]") || form.querySelector("input,button,textarea"))?.focus({ preventScroll: true });
      });
    }
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); modalCancel?.(); });
    dialog.addEventListener("click", (event) => { if (event.target !== dialog) return; const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) modalCancel?.(); });
    const addCancel = (footer, text = "Cancel") => { const cancel = element("button", "quiet-button", text); cancel.type = "button"; cancel.addEventListener("click", () => close(null)); footer.append(cancel); };
    const addSubmit = (footer, text) => { const submit = element("button", "primary-button", text); submit.type = "submit"; footer.append(submit); return submit; };

    function review() {
      const pending = session.track();
      return show("Save your changes to master", "Review what will be shared with your teams. Unrelated changes from other users are kept automatically.", ({ body, footer, form, finish }) => {
        const list = element("div", "master-change-list");
        for (const product of pending) {
          const section = element("section", "master-product-changes");
          section.append(element("h3", "", product.productName));
          const changes = root.PortfolioMasterModel.describeChanges?.(product.base, product.mine) || Object.entries(product.patch).map(([field, mine]) => ({ label: field, base: product.base[field], mine }));
          for (const change of changes) {
            const row = element("div", "master-change-row");
            row.append(element("span", "master-field-label", change.label || change.path), element("span", "master-before", readable(change.baseText ?? change.base)), element("span", "master-change-arrow", "→"), element("span", "master-after", readable(change.mineText ?? change.mine ?? change.value)));
            section.append(row);
          }
          list.append(section);
        }
        body.append(list);
        const reasonLabel = element("label", "master-reason-label", "Reason for this update (optional)");
        const reason = element("textarea", "master-reason"); reason.rows = 2; reason.maxLength = 1000; reason.placeholder = "For example: revised factory schedule"; reasonLabel.append(reason); body.append(reasonLabel);
        if (!configured) body.append(element("p", "master-notice", "Team saving has not been connected by the portfolio owner yet. You can keep editing; your changes remain saved on this device."));
        else if (session.getState().hasKey) {
          const connection = element("div", "master-connection"); connection.append(element("span", "", teamMode ? "Connected to your team's master. Saving is handled privately for your team." : "Your master key is remembered until you reload or disconnect."));
          const disconnect = element("button", "quiet-button", "Disconnect"); disconnect.type = "button"; disconnect.addEventListener("click", () => { root.PortfolioMasterPresence?.leave(); session.disconnect(); finish(null); updateStatus(); }); connection.append(disconnect); body.append(connection);
        }
        addCancel(footer, "Keep editing");
        const submit = addSubmit(footer, "Save to master"); submit.disabled = !configured || !pending.length;
        form.addEventListener("submit", (event) => { event.preventDefault(); finish({ reason: reason.value }); });
      });
    }

    function getAccess(editor = false, message = "") {
      return show(editor ? "Team editing key" : "Connect to your master", editor ? "Enter the editing key supplied by your portfolio owner. It is remembered only until you reload or disconnect." : "Use the same key you use to pull the master package. It is remembered only until you reload or disconnect.", ({ body, footer, form, finish }) => {
        if (message) body.append(element("p", "master-notice master-error", message));
        const label = element("label", "master-key-label", editor ? "Team editing key" : "Master package key"), input = element("input", "master-key");
        input.type = "password"; input.autocomplete = "off"; input.spellcheck = false; input.required = true; input.maxLength = editor ? 512 : 128; input.setAttribute("autofocus", ""); label.append(input); body.append(label);
        const revealLabel = element("label", "master-show-key"), reveal = element("input"); reveal.type = "checkbox"; reveal.addEventListener("change", () => { input.type = reveal.checked ? "text" : "password"; }); revealLabel.append(reveal, document.createTextNode(" Show key")); body.append(revealLabel);
        addCancel(footer); addSubmit(footer, editor ? "Continue" : "Connect");
        form.addEventListener("submit", (event) => { event.preventDefault(); if (input.value.trim()) finish(input.value.trim()); });
      });
    }

    function resolveConflicts(conflicts) {
      return show("Choose the final values", "Another team updated these details while you were editing. Pick your change or the current master for each item. Nothing is replaced until you confirm.", ({ body, footer, form, finish }) => {
        const selections = {}, list = element("div", "master-conflict-list");
        for (const [index, conflict] of conflicts.entries()) {
          const group = element("fieldset", "master-conflict"); group.append(element("legend", "", `${conflict.productName} · ${conflict.label || conflict.path}`));
          for (const [choice, title, value] of [["mine", "Use mine", conflict.mineText ?? conflict.mine], ["master", "Keep master", conflict.masterText ?? conflict.master]]) {
            const label = element("label", "master-conflict-choice"), radio = element("input"); radio.type = "radio"; radio.name = `conflict-${index}`; radio.value = choice; radio.required = true;
            const content = element("span", "master-choice-copy"); content.append(element("strong", "", title), element("span", "master-choice-value", readable(value)));
            label.append(radio, content); group.append(label);
            radio.addEventListener("change", () => { selections[conflict.key] = choice; submit.disabled = Object.keys(selections).length !== conflicts.length; });
          }
          list.append(group);
        }
        body.append(list); addCancel(footer, "Cancel — keep local changes"); const submit = addSubmit(footer, "Save final choices"); submit.disabled = true;
        form.addEventListener("submit", (event) => { event.preventDefault(); if (Object.keys(selections).length === conflicts.length) finish(selections); });
      });
    }

    function progress() {
      show("Saving to master…", "Your teams will receive the accepted changes the next time their portfolio checks the master.", ({ body }) => { const message = element("p", "master-saving", "Saving your product updates…"); message.setAttribute("role", "status"); body.append(message); }, { cancellable: false });
    }

    async function saveFlow() {
      if (running) return;
      lastError = "";
      const reviewed = await review();
      if (!reviewed) { updateStatus(); return; }
      running = true; updateStatus();
      try {
        while (!session.getState().hasKey) {
          const key = await getAccess();
          if (!key) return;
          progress();
          try { await session.connect({ key }); close(null); }
          catch (error) { close(null); if (error.code === "INVALID_KEY") { const retryKey = await getAccess(false, error.message); if (!retryKey) return; progress(); await session.connect({ key: retryKey }); close(null); } else throw error; }
        }
        let result;
        for (;;) {
          progress();
          try {
            result = await session.save({ reason: reviewed.reason, resolveConflicts: async (conflicts) => { close(null); const selected = await resolveConflicts(conflicts); if (selected) progress(); return selected; } });
            close(null); break;
          } catch (error) {
            close(null);
            if (error.code === "INVALID_KEY") {
              const newKey = await getAccess(false, error.message);
              if (!newKey) return;
              progress(); await session.connect({ key: newKey }); close(null);
              continue;
            }
            if (error.code !== "EDITOR_KEY_REQUIRED" || teamMode) throw error;
            const token = await getAccess(true, session.getState().snapshot?.requiresEditorToken ? "" : error.message);
            if (!token) return;
            session.setEditorToken(token);
          }
        }
        if (result.saved) notices?.publish({ id: "master-save-result", severity: "success", title: result.keptMaster ? "Master choices kept" : "Saved to master", message: "Your changes are synced. Other teams will receive the accepted values when they next check the master.", revision: String(Date.now()), toast: true });
      } catch (error) {
        if (Number.isFinite(error.retryUntil)) retryUntil = Math.max(retryUntil, error.retryUntil);
        close(null); lastError = error.message || "Could not save to master. Your local changes are safe.";
        updateStatus(); notices?.show("master-sync-error");
      } finally { running = false; updateStatus(); }
    }

    button.addEventListener("click", (event) => {
      if (!session.track().length) return;
      event.preventDefault(); event.stopImmediatePropagation(); saveFlow();
    }, true);
    root.addEventListener("portfolio:render", updateStatus);
    let refreshRunning = false, lastRefreshAt = 0, retryUntil = 0;
    async function refreshQuietly({ force = false } = {}) {
      if (!configured || running || dialog.open || refreshRunning || document.visibilityState === "hidden" || !session.getState().hasKey || adapter.canRefresh?.() === false) return;
      if (!force && Date.now() < retryUntil) return;
      lastRefreshAt = Date.now();
      refreshRunning = true;
      try { await session.refresh(); lastError = ""; retryUntil = 0; }
      catch (error) { if (Number.isFinite(error.retryUntil)) retryUntil = Math.max(retryUntil, error.retryUntil); lastError = error.code === "INVALID_KEY" ? "Master key changed. Pull latest data to reconnect; local changes are safe." : error.code === "UNAVAILABLE" ? "Master is offline · changes stay on this device" : error.message || "Master could not refresh · local changes are safe"; }
      finally { refreshRunning = false; updateStatus(); }
    }
    const timer = root.setInterval(refreshQuietly, 45000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState !== "hidden") refreshQuietly(); });
    active = Object.freeze({ session, updateStatus, refresh: () => refreshQuietly({ force: true }), save: saveFlow,
      markImported(products, key) { session.markImported(products, key); notices?.resolve("master-save-result"); lastError = ""; lastRefreshAt = 0; retryUntil = 0; updateStatus(); if (key) refreshQuietly(); },
      disconnect() { root.PortfolioMasterPresence?.leave(); session.disconnect(); notices?.resolve("master-save-result"); lastError = ""; updateStatus(); },
      destroy() { root.clearInterval(timer); session.disconnect(); for (const id of ["master-pending", "master-saving-unavailable", "master-sync-error", "master-save-result"]) notices?.resolve(id); dialog.remove(); },
    });
    updateStatus();
    if (source?.demo === true && source.demoKey && ["localhost", "127.0.0.1", "[::1]"].includes(String(root.location?.hostname || "").toLowerCase())) {
      const banner = element("aside", "master-demo-banner", "Team sharing trial · Edit a product, then Save to master. Open this page in a second tab to try team updates and conflicts.");
      banner.setAttribute("role", "note");
      document.querySelector(".topbar")?.insertAdjacentElement("afterend", banner);
      (async () => {
        try {
          // A new synthetic fixture has different IDs; a previous trial cannot be mistaken for it.
          const result = await root.PortfolioMasterClient.request({ endpoint, operation: "latest", key: source.demoKey, fetchImpl });
          const ids = new Set(adapter.getProducts().map((product) => String(product.id || product.productId)));
          const sameFixture = result.snapshot.products.some((product) => ids.has(product.productId));
          if (!sameFixture) {
            const bytes = await root.PortfolioPackageClient.downloadLatest({ endpoint: root.PPC_PACKAGE_SOURCE.endpoint, key: source.demoKey, fetchImpl });
            await root.importProjectPackage(new Blob([bytes], { type: "application/octet-stream" }), { key: source.demoKey, requireEncrypted: true });
          }
          await session.connect({ key: source.demoKey });
          updateStatus();
        } catch (error) { lastError = "The team sharing trial could not connect. Refresh this page to try again."; updateStatus(); }
      })();
    }
    return active;
  }
  root.PortfolioMasterUI = Object.freeze({ initialize, getSession() { return active?.session || null; }, updateStatus() { active?.updateStatus(); }, refresh() { return active?.refresh(); }, markImported(products, key) { active?.markImported(products, key); }, disconnect() { active?.disconnect(); } });
  if (root.PortfolioMasterAdapter) initialize({ adapter: root.PortfolioMasterAdapter });
})(globalThis);
