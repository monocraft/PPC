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

  const changeGroup = (change) => {
    const path = String(change.path || change.label || "");
    if (/^(?:specs(?:\/|$)|Specification)/i.test(path)) return "Specs";
    if (/^(?:partSkus(?:\/|$)|HP SKU)/i.test(path)) return "HP SKUs";
    if (/^(?:variantGroups(?:\/|$)|Variant)/i.test(path)) return "Variants";
    if (/^(?:@(?:launch|end|lifecycle)|.*Date$|startMonth$|endMonth$)/i.test(path)) return "Dates";
    if (/^(?:roadmap|predecessorId$|successorId$)/i.test(path)) return "Roadmap";
    return "Details";
  };
  const friendlyError = (error, saving = false) => {
    const safe = saving ? "Your changes are safe. Try saving again." : "Your changes are safe. We’ll try updating again automatically.";
    if (!error?.code && /(?:duplicate|repeated).*?(?:sku|product|id)|same (?:sku|colorway) code/i.test(error?.message || "")) return "Repeated product details or SKUs need review. Open Review products to find them. Your changes are safe.";
    if (!error?.code && /(?:date|YYYY-MM|end of manufacturing)/i.test(error?.message || "")) return "Some dates need checking. Confirm the launch and end dates, then try again. Your changes are safe.";
    switch (error?.code) {
      case "INVALID_KEY": return "Please unlock the portfolio again. Your changes are safe.";
      case "MERGE_REVIEW_REQUIRED": return "These products changed. Review the merge again. Your draft is safe.";
      case "CONFLICT": case "MASTER_CONFLICT": case "STALE_MERGE": case "MERGE_CONFLICT": return "Another team updated these products. Review the latest values and try again.";
      case "INVALID_CHANGE": case "INVALID_CHANGES": case "VALIDATION_FAILED": case "INVALID_PRODUCT": return "Some product details need checking. Review dates and repeated SKUs, then try again.";
      case "RATE_LIMIT": case "RATE_LIMITED": case "RETRY_LATER": case "MASTER_BUSY": return `Please wait a moment before trying again. ${safe}`;
      case "REQUEST_TOO_LARGE": case "MASTER_TOO_LARGE": return "This update is too large to finish. Your changes are safe; ask your portfolio owner to help.";
      case "EDITOR_KEY_REQUIRED": case "GITHUB_PERMISSION_DENIED": case "TEAM_SETUP_REQUIRED": case "WRITES_DISABLED": return "Editing access needs attention. Ask your portfolio owner to check it. Your changes are safe.";
      default: return `${saving ? "Could not save these changes yet." : "Updates are temporarily unavailable."} ${safe}`;
    }
  };
  const appendValue = (node, value, label) => {
    const text = readable(value);
    if (text.length <= 480 && text.split("\n").length <= 8) { node.textContent = text; return; }
    const details = element("details", "master-value-details");
    const preview = text.slice(0, 180).split("\n").slice(0, 3).join("\n");
    details.append(element("summary", "", `${preview}${text.length > preview.length ? "…" : ""}`), element("span", "master-full-value", text));
    details.setAttribute("aria-label", `${label}: show full value`); node.append(details);
  };

  function initialize({ adapter = root.PortfolioMasterAdapter, source = root.PPC_MASTER_SOURCE || root.PPC_DATE_MASTER_SOURCE, fetchImpl } = {}) {
    if (active) return active;
    const button = document.getElementById("pullLatestData");
    if (!button || !adapter || !root.PortfolioMasterClient || !root.PortfolioMasterModel) return null;
    const endpoint = source?.endpoint || (root.PPC_PACKAGE_SOURCE?.mode === "relay" ? root.PPC_PACKAGE_SOURCE.endpoint : "");
    const session = root.PortfolioMasterClient.createSession({ endpoint, source, adapter, fetchImpl });
    const githubMode = source?.mode === "github", teamMode = source?.team === true, configured = session.getState().configured;
    const notices = root.PortfolioNotifications;
    const dialog = element("dialog", "master-dialog");
    dialog.id = "masterDialog";
    dialog.setAttribute("aria-labelledby", "masterDialogTitle"); dialog.setAttribute("aria-describedby", "masterDialogDescription");
    document.body.append(dialog);
    let running = false, discarding = false, connectingGitHub = false, modalResolve = null, modalCancel = null, lastError = "";

    function updateStatus() {
      const state = session.getState(), count = state.pending.length;
      const duplicateAttention = /duplicate|repeated.*(?:product|sku)/i.test(lastError) || Boolean(root.PortfolioProductIssues?.getState()?.errors);
      button.textContent = discarding ? "Discarding…" : running ? connectingGitHub ? "Connecting…" : "Saving…" : count ? "Save changes" : "Pull latest data";
      button.disabled = running || discarding || Boolean(adapter.hasPendingPackageOperation?.());
      button.title = count ? `Review and save changes for ${count} ${count === 1 ? "product" : "products"}` : "Get the latest portfolio updates";
      button.classList.toggle("master-has-changes", count > 0);
      if (count) notices?.publish({ id: "master-pending", severity: "info", title: discarding ? "Discarding changes…" : running ? connectingGitHub ? "Connecting…" : "Saving changes…" : "Changes ready to save", message: running || discarding ? "Your changes are safe while this update finishes." : `${count} ${count === 1 ? "product has" : "products have"} unsaved changes. Review them when you’re ready.`, toast: false, dismissible: false, actions: running || discarding ? [] : [{ label: "Review changes", onClick: saveFlow }] });
      else notices?.resolve("master-pending");
      if (count && !configured) notices?.publish({ id: "master-saving-unavailable", severity: "warning", title: "Saving is not available yet", message: "You can keep editing. Your changes are safe; ask your portfolio owner to enable saving.", toast: false });
      else notices?.resolve("master-saving-unavailable");
      if (lastError) notices?.publish({ id: "master-sync-error", severity: "error", title: "Update needs attention", message: lastError, toast: false, actions: [...(duplicateAttention ? [{ label: "Review products", onClick: () => root.PortfolioProductIssues?.reviewDuplicateIssues?.() }] : []), { label: count ? "Review and try again" : "Try again", onClick: () => count ? saveFlow() : session.getState().hasKey ? refreshQuietly({ force: true }) : root.PortfolioPackageUI?.open("pull") }] });
      else notices?.resolve("master-sync-error");
      const publication = state.snapshot?.publication;
      if (publication?.status === "error") notices?.publish({ id: "master-publication", severity: "warning", title: "Update needs attention", message: "Your saved changes are available to the team. A follow-up update will retry automatically; ask your portfolio owner to check if this warning continues.", toast: false });
      else notices?.resolve("master-publication");
      root.dispatchEvent(new CustomEvent("portfolio:master-status", { detail: { connected: state.connected, hasKey: state.hasKey } }));
    }

    function close(value) {
      const resolve = modalResolve; modalResolve = null; modalCancel = null;
      if (dialog.open) dialog.close();
      resolve?.(value);
      if (!running && !discarding && button.isConnected) button.focus({ preventScroll: true });
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
      return show("Review changes", "Open a product for details, or save all changes below. Other team updates are kept automatically.", ({ body, footer, form, finish }) => {
        const overview = element("div", "master-review-overview");
        overview.append(element("strong", "master-review-count", `${pending.length} ${pending.length === 1 ? "product" : "products"}`));
        const kinds = new Map();
        const kindOf = (product) => ["create", "delete", "merge"].includes(product.kind) ? product.kind : "update";
        const kindLabel = { create: "Added", update: "Edited", delete: "Removed", merge: "Merged" };
        for (const product of pending) { const kind = kindOf(product); kinds.set(kind, (kinds.get(kind) || 0) + 1); }
        for (const [kind, count] of kinds) overview.append(element("span", `master-review-chip master-review-${kind}`, `${count} ${kindLabel[kind].toLowerCase()}`));
        body.append(overview);
        const list = element("div", "master-change-list");
        const sections = [];
        for (const product of pending) {
          const kind = kindOf(product), section = element("details", "master-product-changes");
          const summary = element("summary", "master-product-summary"), heading = element("span", "master-product-heading");
          heading.append(element("strong", "master-product-name", product.productName || product.mine?.name || "Untitled product"), element("span", `master-review-chip master-review-${kind}`, kindLabel[kind]));
          const changes = kind === "create" ? [{ label: "New product", baseText: "New", mineText: "Add product details, specifications, SKUs and dates" }] : kind === "delete" ? [{ label: "Remove product", baseText: "Current product", mineText: "Remove this product from the portfolio" }] : root.PortfolioMasterModel.describeChanges?.(product.base, product.mine) || Object.entries(product.patch || {}).map(([field, mine]) => ({ path: field, label: field, base: product.base?.[field], mine }));
          const groups = new Map();
          for (const change of changes) { const group = changeGroup(change); groups.set(group, (groups.get(group) || 0) + 1); }
          const sourceName = product.sourceProduct?.name || product.sourceProductName || product.donorProductName || "another product";
          const context = kind === "merge" ? `Merge ${sourceName} into this product` : kind === "create" ? "Product, specs, SKUs and dates" : kind === "delete" ? "Remove product" : [...groups].map(([group, count]) => `${group} ${count}`).join(" · ") || "Product details";
          heading.append(element("span", "master-product-summary-copy", context));
          summary.append(heading, element("span", "master-product-disclosure", "Details"));
          section.append(summary);
          const details = element("div", "master-product-detail-list");
          let detailsRendered = false;
          section.addEventListener("toggle", () => {
            if (!section.open || detailsRendered) return;
            detailsRendered = true;
            const columnLabels = element("div", "master-change-columns"); columnLabels.append(element("span", "", "Field"), element("span", "", "Before"), element("span", "", ""), element("span", "", "After"));
            if (changes.length) details.append(columnLabels);
            for (const change of changes) {
              const row = element("div", "master-change-row");
              const label = change.label || change.path || "Product details", before = element("span", "master-before"), after = element("span", "master-after");
              appendValue(before, change.baseText ?? change.base, `${label}, before`); appendValue(after, change.mineText ?? change.mine ?? change.value, `${label}, after`);
              row.append(element("span", "master-field-label", label), before, element("span", "master-change-arrow", "→"), after); details.append(row);
            }
            if (kind === "merge") details.append(element("p", "master-merge-review-note", "The completed product is kept, and the other product is removed. Each piece of information is combined in one update."));
          });
          section.append(details);
          const card = element("div", "master-product-card"); card.append(section);
          if (typeof adapter.discardChanges === "function") {
            const discard = element("button", "quiet-button master-discard-product"); discard.append(element("span", "", "Discard")); discard.type = "button"; discard.disabled = session.getState().busy || running || discarding || Boolean(adapter.hasPendingPackageOperation?.());
            discard.setAttribute("aria-label", `Discard changes to ${product.productName || product.mine?.name || "this product"}`);
            discard.addEventListener("click", () => discardFlow([product.productId])); card.append(discard);
          }
          sections.push({ section: card, text: `${product.productName || ""} ${sourceName} ${context} ${kindLabel[kind]}`.toLocaleLowerCase() });
          list.append(card);
        }
        if (pending.length > 6) {
          const filterWrap = element("div", "master-review-filter"), searchLabel = element("label", "", "Find a product"), search = element("input", "master-review-search"), matches = element("span", "master-review-matches", "");
          search.type = "search"; search.placeholder = "Search products or changes"; search.setAttribute("aria-controls", "masterChangeList"); matches.setAttribute("role", "status"); matches.setAttribute("aria-live", "polite"); searchLabel.append(search); filterWrap.append(searchLabel, matches); body.append(filterWrap);
          search.addEventListener("input", () => {
            const query = search.value.trim().toLocaleLowerCase(); let visible = 0;
            for (const item of sections) { item.section.hidden = Boolean(query && !item.text.includes(query)); if (!item.section.hidden) visible += 1; }
            matches.textContent = query ? `${visible} of ${pending.length} products shown. All ${pending.length} will be saved.` : "";
          });
        }
        list.id = "masterChangeList";
        body.append(list);
        const reasonDetails = element("details", "master-review-note"); reasonDetails.append(element("summary", "", "Add a note (optional)"));
        const reasonLabel = element("label", "master-reason-label", "Reason for this update");
        const reason = element("textarea", "master-reason"); reason.rows = 2; reason.maxLength = 1000; reason.placeholder = "For example: revised factory schedule"; reasonLabel.append(reason); reasonDetails.append(reasonLabel); body.append(reasonDetails);
        if (!configured) body.append(element("p", "master-notice", "Saving is not available yet. Your changes are safe; ask your portfolio owner to enable it."));
        footer.append(element("span", "master-review-footer-count", `${pending.length} ${pending.length === 1 ? "product" : "products"} to save`));
        if (typeof adapter.discardChanges === "function") {
          const discardAll = element("button", "quiet-button master-discard-all", "Discard all changes"); discardAll.type = "button"; discardAll.disabled = session.getState().busy || running || discarding || Boolean(adapter.hasPendingPackageOperation?.());
          discardAll.addEventListener("click", () => discardFlow(pending.map((product) => product.productId))); footer.append(discardAll);
        }
        addCancel(footer, "Keep editing");
        const submit = addSubmit(footer, "Save changes"); submit.disabled = !configured || !pending.length;
        form.addEventListener("submit", (event) => { event.preventDefault(); finish({ reason: reason.value }); });
      });
    }

    async function discardFlow(productIds) {
      if (running || discarding || session.getState().busy || adapter.hasPendingPackageOperation?.() || typeof adapter.discardChanges !== "function") return;
      const ids = new Set(productIds.map(String)), selected = session.track().filter((product) => ids.has(String(product.productId)));
      if (!selected.length) return;
      const confirmed = await show("Discard changes?", "Unsaved edits for these products will be undone. Saved updates are kept.", ({ body, footer, form, finish }) => {
        const list = element("ul", "master-discard-list");
        for (const product of selected.slice(0, 6)) {
          const action = product.kind === "create" ? "New product will be removed" : product.kind === "delete" ? "Removed product will be restored" : product.kind === "merge" ? "Merge will be undone" : "Edits will be reverted";
          const row = element("li"); row.append(element("strong", "", product.productName || product.mine?.name || "Untitled product"), element("span", "", action)); list.append(row);
        }
        if (selected.length > 6) list.append(element("li", "master-discard-more", `And ${selected.length - 6} more products`));
        body.append(list); addCancel(footer, "Keep changes"); const submit = addSubmit(footer, selected.length === 1 ? "Discard changes" : `Discard ${selected.length} updates`); submit.classList.add("master-discard-confirm");
        form.addEventListener("submit", (event) => { event.preventDefault(); finish(true); });
      });
      if (!confirmed) { if (session.track().length && !running && !discarding) saveFlow(); return; }
      if (running || session.getState().busy || adapter.hasPendingPackageOperation?.()) { updateStatus(); return; }
      discarding = true; updateStatus();
      show("Discarding changes…", "Restoring your products.", ({ body }) => { const status = element("p", "master-saving", "Undoing unsaved edits…"); status.setAttribute("role", "status"); body.append(status); }, { cancellable: false });
      try {
        const result = await adapter.discardChanges(selected.map((product) => String(product.productId)));
        if (!result || result.discarded === 0) throw new Error("No changes were discarded");
        lastError = ""; close(null);
        const actions = result.undoId && typeof adapter.undoDiscard === "function" ? [{ label: "Undo", onClick: async () => {
          if (running || discarding || session.getState().busy || adapter.hasPendingPackageOperation?.()) return;
          try {
            if (!await adapter.undoDiscard(result.undoId)) throw new Error("This discard cannot be undone");
            notices?.resolve("master-discard-result"); updateStatus();
            notices?.publish({ id: "master-discard-undone", severity: "success", title: "Changes restored", message: "Your edits are ready to review.", revision: String(Date.now()), toast: true });
          } catch { notices?.publish({ id: "master-discard-result", severity: "warning", title: "Could not undo this change", message: "Your portfolio has changed since those edits were discarded.", revision: String(Date.now()), toast: true }); }
        } }] : [];
        notices?.publish({ id: "master-discard-result", severity: "success", title: "Changes discarded", message: "Your products have been restored.", revision: String(Date.now()), actions, toast: true });
      } catch { close(null); notices?.publish({ id: "master-discard-result", severity: "error", title: "Could not discard these changes", message: "Your edits are safe. Try again.", revision: String(Date.now()), toast: true }); }
      finally { discarding = false; updateStatus(); }
      if (session.track().length) saveFlow();
    }

    function getAccess(editor = false, message = "") {
      const githubToken = editor === "github";
      return show(githubToken ? "Connect your GitHub account" : editor ? "Team editing key" : "Unlock your portfolio", githubToken ? `Use your own GitHub token with write access to ${source.owner}/${source.repo}. Your token stays in memory until you reload.` : editor ? "Enter the editing key supplied by your portfolio owner." : "Enter your existing portfolio key to continue. This browser tab reconnects automatically.", ({ body, footer, form, finish }) => {
        if (message) body.append(element("p", "master-notice master-error", message));
        if (githubToken) {
          const help = element("a", "", "GitHub token setup instructions"); help.href = "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens"; help.target = "_blank"; help.rel = "noopener noreferrer"; body.append(help);
          const details = element("details"), summary = element("summary", "", "Which token should I use?");
          details.append(summary, element("p", "", "The repository owner can use a fine-grained token for this repository with Contents read and write permission. Collaborators on a personal public repository may need a classic token with public_repo scope. Use your own account and token."));
          const create = element("a", "", "Create a fine-grained token (repository owner)"); create.href = "https://github.com/settings/personal-access-tokens/new"; create.target = "_blank"; create.rel = "noopener noreferrer"; details.append(create); body.append(details);
        }
        const label = element("label", "master-key-label", githubToken ? "GitHub access token" : editor ? "Team editing key" : "Portfolio key"), input = element("input", "master-key");
        input.type = "password"; input.autocomplete = "off"; input.spellcheck = false; input.required = true; input.maxLength = editor ? 512 : 128; input.setAttribute("autofocus", ""); label.append(input); body.append(label);
        const revealLabel = element("label", "master-show-key"), reveal = element("input"); reveal.type = "checkbox"; reveal.addEventListener("change", () => { input.type = reveal.checked ? "text" : "password"; }); revealLabel.append(reveal, document.createTextNode(" Show key")); body.append(revealLabel);
        addCancel(footer); addSubmit(footer, githubToken ? "Connect GitHub" : editor ? "Continue" : "Connect");
        form.addEventListener("submit", (event) => { event.preventDefault(); if (input.value.trim()) finish(input.value.trim()); });
      });
    }

    function resolveConflicts(conflicts) {
      return show("Choose the final values", "Another team updated these details while you were editing. Pick your change or the latest value for each item.", ({ body, footer, form, finish }) => {
        const selections = {}, list = element("div", "master-conflict-list");
        for (const [index, conflict] of conflicts.entries()) {
          const group = element("fieldset", "master-conflict"); group.append(element("legend", "", `${conflict.productName} · ${conflict.label || conflict.path}`));
          for (const [choice, title, value] of [["mine", "Use my change", conflict.mineText ?? conflict.mine], ["master", "Keep latest value", conflict.masterText ?? conflict.master]]) {
            const label = element("label", "master-conflict-choice"), radio = element("input"); radio.type = "radio"; radio.name = `conflict-${index}`; radio.value = choice; radio.required = true;
            const content = element("span", "master-choice-copy"), choiceValue = element("span", "master-choice-value"); content.append(element("strong", "", title));
            const imageConflict = Object.hasOwn(conflict, "mineImageId") || Object.hasOwn(conflict, "masterImageId"), imageId = choice === "mine" ? conflict.mineImageId : conflict.masterImageId;
            if (imageConflict && imageId) {
              let source = "";
              try { source = root.PortfolioProductMergeAdapter?.getImageSource?.(imageId) || ""; } catch (_) {}
              if (typeof source === "string" && source) { const image = element("img", "master-choice-image"); image.src = source; image.alt = `${title} image`; image.loading = "lazy"; content.append(image); }
            }
            appendValue(choiceValue, imageConflict ? imageId ? "Image selected" : "No image" : value, title); content.append(choiceValue);
            label.append(radio, content); group.append(label);
            radio.addEventListener("change", () => { selections[conflict.key] = choice; submit.disabled = Object.keys(selections).length !== conflicts.length; });
          }
          list.append(group);
        }
        body.append(list); addCancel(footer, "Keep editing"); const submit = addSubmit(footer, "Save choices"); submit.disabled = true;
        form.addEventListener("submit", (event) => { event.preventDefault(); if (Object.keys(selections).length === conflicts.length) finish(selections); });
      });
    }

    function progress() {
      show(connectingGitHub ? "Connecting…" : "Saving changes…", connectingGitHub ? "Checking your access." : "Your team will see these updates automatically.", ({ body }) => { const message = element("p", "master-saving", connectingGitHub ? "Checking your account…" : "Saving your product updates…"); message.setAttribute("role", "status"); body.append(message); }, { cancellable: false });
    }

    async function connectGitHub() {
      if (!githubMode || running || dialog.open || !session.getState().hasKey) return;
      root.PortfolioMasterPresence?.close?.();
      const token = await getAccess("github"); if (!token) return;
      running = true; connectingGitHub = true; updateStatus(); progress();
      try {
        const account = await session.setGitHubToken(token);
        lastError = "";
        await session.refresh(); close(null); retryUntil = 0; lastRefreshAt = Date.now();
        notices?.publish({ id: "master-github-connected", severity: "success", title: "Connected", message: `Connected as ${account.name || account.login}.`, revision: String(Date.now()), toast: true });
      } catch (error) { close(null); if (Number.isFinite(error.retryUntil)) retryUntil = Math.max(retryUntil, error.retryUntil); lastError = friendlyError(error); }
      finally { running = false; connectingGitHub = false; updateStatus(); }
    }

    async function saveFlow() {
      if (running || discarding || session.getState().busy) return;
      adapter.beforeSave?.();
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
          catch (error) { close(null); if (error.code === "INVALID_KEY") { const retryKey = await getAccess(false, friendlyError(error)); if (!retryKey) return; progress(); await session.connect({ key: retryKey }); close(null); } else throw error; }
        }
        let result;
        for (;;) {
          progress();
          try {
            if (githubMode && !session.getState().hasGitHubToken) {
              close(null); const token = await getAccess("github"); if (!token) return;
              progress(); await session.setGitHubToken(token);
            }
            result = await session.save({ reason: reviewed.reason, resolveConflicts: async (conflicts) => { close(null); const selected = await resolveConflicts(conflicts); if (selected) progress(); return selected; } });
            close(null); break;
          } catch (error) {
            close(null);
            if (error.code === "INVALID_KEY") {
              const newKey = await getAccess(false, friendlyError(error));
              if (!newKey) return;
              progress(); await session.connect({ key: newKey }); close(null);
              continue;
            }
            if (githubMode && ["GITHUB_TOKEN_REQUIRED", "INVALID_GITHUB_TOKEN", "GITHUB_PERMISSION_DENIED"].includes(error.code)) {
              const token = await getAccess("github", friendlyError(error)); if (!token) return;
              progress(); await session.setGitHubToken(token); close(null); continue;
            }
            if (error.code !== "EDITOR_KEY_REQUIRED" || teamMode) throw error;
            const token = await getAccess(true, session.getState().snapshot?.requiresEditorToken ? "" : friendlyError(error));
            if (!token) return;
            session.setEditorToken(token);
          }
        }
        if (result.saved) {
          lastError = "";
          notices?.resolve("plc-master-sharing");
          notices?.publish({ id: "master-save-result", severity: "success", title: result.keptMaster ? "Latest values kept" : "Changes saved", message: "Your team will see these updates automatically.", revision: String(Date.now()), toast: true });
        }
      } catch (error) {
        if (Number.isFinite(error.retryUntil)) retryUntil = Math.max(retryUntil, error.retryUntil);
        close(null); lastError = friendlyError(error, true);
        updateStatus(); notices?.show("master-sync-error");
      } finally { running = false; updateStatus(); }
    }

    async function saveScoped(options) {
      if (running || discarding || refreshRunning || dialog.open || session.getState().busy || adapter.hasPendingPackageOperation?.()) return { status: "pending", saved: false, code: "MASTER_BUSY", message: "PLC data is saved on this device. Sharing will resume when the current update finishes." };
      if (typeof session.saveScoped !== "function") return { status: "local", saved: false, code: "SCOPED_SAVE_UNAVAILABLE", message: "PLC data is saved on this device. Shared saving needs an updated connection." };
      running = true;
      try {
        const result = await session.saveScoped(options);
        if (Number.isFinite(result.retryUntil)) retryUntil = Math.max(retryUntil, result.retryUntil);
        if (result.status === "saved") notices?.resolve("plc-master-sharing");
        else notices?.publish({ id: "plc-master-sharing", severity: result.status === "pending" ? "warning" : "info", title: result.status === "pending" ? "PLC sharing needs attention" : "PLC data collected", message: result.status === "pending" ? "Your PLC data is saved on this device. Review the pending changes to share them." : "Your PLC data is saved on this device. Connect with editing access to share it automatically.", toast: false, actions: [{ label: "Review changes", onClick: saveFlow }] });
        return result;
      } finally { running = false; updateStatus(); }
    }

    button.addEventListener("click", (event) => {
      if (!session.track().length) return;
      event.preventDefault(); event.stopImmediatePropagation(); saveFlow();
    }, true);
    root.addEventListener("portfolio:render", updateStatus);
    let refreshRunning = false, lastRefreshAt = 0, retryUntil = 0;
    async function refreshQuietly({ force = false } = {}) {
      if (!configured || running || discarding || dialog.open || refreshRunning || document.visibilityState === "hidden" || !session.getState().hasKey || adapter.canRefresh?.() === false) return;
      if (!force && Date.now() < retryUntil) return;
      if (githubMode && !force && Date.now() - lastRefreshAt < (session.getState().hasGitHubToken ? 120000 : 300000)) return;
      lastRefreshAt = Date.now();
      refreshRunning = true;
      try { await session.refresh(); lastError = ""; retryUntil = 0; }
      catch (error) { if (Number.isFinite(error.retryUntil)) retryUntil = Math.max(retryUntil, error.retryUntil); lastError = friendlyError(error); }
      finally { refreshRunning = false; updateStatus(); }
    }
    const timer = root.setInterval(refreshQuietly, githubMode ? 60000 : 45000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState !== "hidden") refreshQuietly(); });
    active = Object.freeze({ session, updateStatus, connectGitHub, refresh: () => refreshQuietly({ force: true }), save: saveFlow, saveScoped,
      reviewConflicts(conflicts) { if (running || discarding || session.getState().busy || !Array.isArray(conflicts) || !conflicts.length) return null; return resolveConflicts(conflicts); },
      markImported(products, key) { session.markImported(products, key); notices?.resolve("master-save-result"); notices?.resolve("master-github-connected"); lastError = ""; lastRefreshAt = 0; retryUntil = 0; updateStatus(); if (key) refreshQuietly(); },
      disconnect() { root.PortfolioMasterPresence?.leave(); session.disconnect(); notices?.resolve("master-save-result"); notices?.resolve("master-github-connected"); lastError = ""; updateStatus(); },
      destroy() { root.clearInterval(timer); session.disconnect(); for (const id of ["master-pending", "master-saving-unavailable", "master-sync-error", "master-save-result", "master-github-connected", "master-publication", "master-discard-result", "master-discard-undone", "plc-master-sharing"]) notices?.resolve(id); dialog.remove(); },
    });
    updateStatus();
    if (teamMode && configured && session.getState().hasKey) refreshQuietly();
    if (source?.demo === true && source.demoKey && ["localhost", "127.0.0.1", "[::1]"].includes(String(root.location?.hostname || "").toLowerCase())) {
      const banner = element("aside", "master-demo-banner", "Team sharing trial · Edit a product, then save changes. Open this page in a second tab to try team updates and conflicts.");
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
  root.PortfolioMasterUI = Object.freeze({ initialize, getSession() { return active?.session || null; }, connectGitHub() { return active?.connectGitHub(); }, updateStatus() { active?.updateStatus(); }, refresh() { return active?.refresh(); }, save() { return active?.save(); }, saveScoped(options) { return active?.saveScoped(options) ?? Promise.resolve({ status: "local", saved: false, code: "SHARING_NOT_CONNECTED", message: "PLC data is saved on this device. Connect shared saving to share it automatically." }); }, reviewConflicts(conflicts) { return active?.reviewConflicts(conflicts) ?? null; }, markImported(products, key) { active?.markImported(products, key); }, disconnect() { active?.disconnect(); } });
  if (root.PortfolioMasterAdapter) initialize({ adapter: root.PortfolioMasterAdapter });
})(globalThis);
