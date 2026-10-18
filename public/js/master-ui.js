/* Shared record checks and complete package loading have distinct status/actions. */
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
      case "REVIEW_REQUIRED": return "Your draft changed. Review the latest changes before saving.";
      case "CONFLICT": case "MASTER_CONFLICT": case "STALE_MERGE": case "MERGE_CONFLICT": return "Another team updated these products. Review the latest values and try again.";
      case "INVALID_CHANGE": case "INVALID_CHANGES": case "VALIDATION_FAILED": case "INVALID_PRODUCT": return "Some product details need checking. Review dates and repeated SKUs, then try again.";
      case "RATE_LIMIT": case "RATE_LIMITED": case "RETRY_LATER": case "MASTER_BUSY": return `Please wait a moment before trying again. ${safe}`;
      case "REQUEST_TOO_LARGE": case "MASTER_TOO_LARGE": return "This update is too large to finish. Your changes are safe; ask your portfolio owner to help.";
      case "PLACEMENT_UNAVAILABLE": return "These product positions are saved on this device. Sharing positions needs a service update; retrying cannot finish it yet. Your other edits are safe.";
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
    const saveButton = document.getElementById("saveSharedChanges");
    if (!button || !adapter || !root.PortfolioMasterClient || !root.PortfolioMasterModel) return null;
    const endpoint = source?.endpoint || (root.PPC_PACKAGE_SOURCE?.mode === "relay" ? root.PPC_PACKAGE_SOURCE.endpoint : "");
    const session = root.PortfolioMasterClient.createSession({ endpoint, source, adapter, fetchImpl });
    const githubMode = source?.mode === "github", teamMode = source?.team === true, configured = session.getState().configured;
    const notices = root.PortfolioNotifications;
    const dialog = element("dialog", "master-dialog");
    dialog.id = "masterDialog";
    dialog.setAttribute("aria-labelledby", "masterDialogTitle"); dialog.setAttribute("aria-describedby", "masterDialogDescription");
    document.body.append(dialog);
    let running = false, discarding = false, connectingGitHub = false, modalResolve = null, modalCancel = null, lastError = "", lastErrorWasSave = false, publicationDelayed = false;
    let progressState = null, progressTimer = null, modalOperation = null, modalView = "", destroyed = false;
    let lastCheckedAt = 0, checkedPublication = null, lastCheckError = "", checkMessage = "", localBaselineGeneration = 0;
    const updates = element("dialog", "master-dialog portfolio-updates-dialog");
    updates.id = "portfolioUpdatesDialog"; updates.setAttribute("aria-labelledby", "portfolioUpdatesTitle");
    document.body.append(updates);
    const timeText = (at) => Number.isFinite(new Date(at).getTime()) ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(at)) : "time unavailable";
    function closeUpdates() { if (updates.open) updates.close(); if (button.isConnected) button.focus({ preventScroll: true }); }
    function renderUpdates() {
      if (!updates.open) return;
      const focusedId = document.activeElement?.id;
      const state = session.getState(), count = state.pending.length, busy = running || discarding || refreshRunning || state.busy || Boolean(adapter.hasPendingPackageOperation?.());
      const heading = element("header", "master-dialog-heading"), title = element("h2", "", "Portfolio updates"); title.id = "portfolioUpdatesTitle";
      const dismiss = element("button", "icon-button master-dialog-close", "×"); dismiss.id = "closePortfolioUpdates"; dismiss.type = "button"; dismiss.setAttribute("aria-label", "Close portfolio updates"); dismiss.addEventListener("click", closeUpdates); heading.append(title, dismiss);
      const body = element("div", "master-dialog-body portfolio-updates-body");
      const team = element("section", "portfolio-update-card"); team.append(element("h3", "", "Team records"));
      const teamStatus = element("p", "portfolio-update-status", refreshRunning ? "Checking team updates…" : lastCheckError ? "Could not check team updates." : !configured ? "Team updates are not connected." : !state.hasKey ? "Open the team portfolio to check updates." : lastCheckedAt ? `Last checked ${timeText(lastCheckedAt)}.` : "Check needed. No successful check in this session yet.");
      teamStatus.setAttribute("role", "status"); team.append(teamStatus);
      team.append(element("p", "", running ? "Saving your reviewed changes…" : count ? `${count} ${count === 1 ? "product has" : "products have"} changes to review and save.` : "No shared record changes waiting to save."));
      if (lastCheckError) team.append(element("p", "portfolio-update-note", lastCheckError + (lastCheckedAt ? ` Last successful check: ${timeText(lastCheckedAt)}.` : "")));
      if (checkMessage) team.append(element("p", "portfolio-update-note", checkMessage));
      const check = element("button", "secondary-button", refreshRunning ? "Checking…" : lastCheckError ? "Retry check" : "Check team updates"); check.id = "checkTeamUpdates"; check.type = "button"; check.disabled = busy || !configured || !state.hasKey;
      check.addEventListener("click", () => { void refreshQuietly({ force: true, manual: true }); }); team.append(check);
      if (count) { const review = element("button", "quiet-button", "Review changes"); review.type = "button"; review.disabled = busy; review.addEventListener("click", () => { closeUpdates(); void saveFlow(); }); team.append(review); }
      team.append(element("p", "portfolio-update-note", "Checks merge shared records while keeping your open edits. A check does not save your changes."));
      const pack = element("section", "portfolio-update-card"); pack.append(element("h3", "", "Complete portfolio package"));
      const loaded = adapter.getLoadedPackageInfo?.(), published = checkedPublication, latestSha = /^[a-f0-9]{40}$/i.test(published?.githubSha || "") ? published.githubSha.toLowerCase() : "";
      const loadedSha = loaded?.version === 1 && /^[a-f0-9]{40}$/i.test(loaded.gitBlobSha || "") ? loaded.gitBlobSha.toLowerCase() : "";
      const sharePointComparison = published?.provider === "sharepoint";
      const sharePointKnown = sharePointComparison && loaded?.version === 2 && loaded.provider === "sharepoint" && Number.isSafeInteger(loaded.generation) && /^[a-f0-9]{64}$/.test(loaded.sha256 || "") && Number.isSafeInteger(published.generation) && /^[a-f0-9]{64}$/.test(published.sha256 || "");
      const samePackage = sharePointComparison ? sharePointKnown && loaded.generation === published.generation && loaded.sha256 === published.sha256 && loaded.candidateId === published.candidateId : loadedSha === latestSha;
      const packageText = !lastCheckedAt || lastCheckError ? "Check team updates to compare the published package."
        : published?.status === "error" ? "At the last check, the published package was delayed. Team records may already be saved."
        : published?.status === "pending" ? "At the last check, a complete package was still being prepared. Team records and the download may differ."
        : published?.status !== "current" || (sharePointComparison ? !sharePointKnown : !latestSha || !loadedSha) ? "Package comparison unavailable. The image package loaded here has not been verified against the published copy."
        : samePackage ? "The package last opened here matches the published copy at the last check."
        : "A different published package was available at the last check, including its images.";
      pack.append(element("p", "portfolio-update-status", packageText));
      if ((loadedSha || sharePointKnown) && loaded.loadedAt) pack.append(element("p", "portfolio-update-note", `Complete package opened ${timeText(loaded.loadedAt)}. Local edits may have been made since then.`));
      pack.append(element("p", "portfolio-update-note", "Opening a complete package replaces this workspace, including local images and settings. Export a backup of work you want to keep."));
      const publicationBlocked = published?.status === "pending" || published?.status === "error";
      const load = element("button", "secondary-button", "Open complete package"); load.type = "button"; load.disabled = busy || count > 0 || publicationBlocked;
      load.addEventListener("click", () => { const now = session.getState(); if (session.track().length || now.busy || adapter.hasPendingPackageOperation?.()) { checkMessage = "Review your changes and finish the current update before loading a package."; renderUpdates(); return; } if (["pending", "error"].includes(now.snapshot?.publication?.status)) { checkMessage = "The complete package is not ready. Check team updates again before opening it."; renderUpdates(); return; } closeUpdates(); root.PortfolioPackageUI?.open("pull"); }); pack.append(load);
      const backup = element("button", "quiet-button", "Export current portfolio"); backup.type = "button"; backup.disabled = busy;
      backup.addEventListener("click", () => { closeUpdates(); root.PortfolioPackageUI?.open("export"); }); pack.append(backup);
      if (count) pack.append(element("p", "portfolio-update-note", "Save or discard the shared record changes above before opening a package."));
      if (publicationBlocked) pack.append(element("p", "portfolio-update-note", "Wait for the complete package to finish publishing before replacing this workspace."));
      body.append(team, pack); updates.replaceChildren(heading, body);
      if (focusedId) document.getElementById(focusedId)?.focus({ preventScroll: true });
    }
    function showUpdates() { if (!updates.open) updates.showModal(); renderUpdates(); updates.querySelector("button")?.focus({ preventScroll: true }); }
    updates.addEventListener("cancel", (event) => { event.preventDefault(); closeUpdates(); });

    function updateStatus() {
      const state = session.getState(), count = state.pending.length;
      if (!lastError) lastErrorWasSave = false;
      const publication = state.snapshot?.publication;
      if (publication?.status === "error") publicationDelayed = true;
      // A new accepted edit may reset the publisher to pending, and a package
      // reload may temporarily omit its snapshot. Neither proves recovery.
      else if (publication?.status === "current") publicationDelayed = false;
      const duplicateAttention = /duplicate|repeated.*(?:product|sku)/i.test(lastError) || Boolean(root.PortfolioProductIssues?.getState()?.errors);
      button.textContent = "Updates";
      button.disabled = Boolean(adapter.hasPendingPackageOperation?.());
      button.title = "Check team records and complete package status";
      if (saveButton) {
        const canShowProgress = running && progressState && progressState.generation === localBaselineGeneration;
        saveButton.hidden = !count && !running && !discarding;
        saveButton.textContent = discarding ? "Discarding…" : running ? connectingGitHub ? "Connecting…" : "Saving…" : `Save changes${count ? ` (${count})` : ""}`;
        saveButton.disabled = discarding || refreshRunning || Boolean(adapter.hasPendingPackageOperation?.()) || Boolean((running || state.busy) && !canShowProgress);
        saveButton.classList.toggle("master-save-active", Boolean(canShowProgress));
        saveButton.setAttribute("aria-label", canShowProgress ? connectingGitHub ? "Show connection progress" : "Show save progress" : saveButton.textContent);
        saveButton.title = canShowProgress ? "View progress. Closing the panel keeps this operation running." : "Review and save your product changes";
      }
      if (publicationDelayed) button.title += ". Saved changes are available to the team; the downloadable copy is waiting to update. See Messages for status.";
      button.classList.toggle("master-has-changes", count > 0);
      if (count) notices?.publish({ id: "master-pending", severity: "info", title: discarding ? "Discarding changes…" : running ? connectingGitHub ? "Connecting…" : "Saving changes…" : "Changes ready to save", message: running || discarding ? "Your changes are safe while this update finishes." : `${count} ${count === 1 ? "product has" : "products have"} unsaved changes. Review them when you’re ready.`, toast: false, dismissible: false, actions: running || discarding ? [] : [{ label: "Review changes", onClick: saveFlow }] });
      else notices?.resolve("master-pending");
      if (count && !configured) notices?.publish({ id: "master-saving-unavailable", severity: "warning", title: "Saving is not available yet", message: "You can keep editing. Your changes are safe; ask your portfolio owner to enable saving.", toast: false });
      else notices?.resolve("master-saving-unavailable");
      if (lastError) notices?.publish({ id: "master-sync-error", severity: "error", title: lastErrorWasSave ? "Changes still need saving" : "Update needs attention", message: lastError, toast: false, dismissible: !lastErrorWasSave, actions: [...(duplicateAttention ? [{ label: "Review products", onClick: () => root.PortfolioProductIssues?.reviewDuplicateIssues?.() }] : []), { label: count ? "Review and try again" : "Try again", onClick: () => count ? saveFlow() : session.getState().hasKey ? refreshQuietly({ force: true }) : root.PortfolioPackageUI?.open("pull") }] });
      else notices?.resolve("master-sync-error");
      if (publication?.status === "error") notices?.publish({ id: "master-publication", severity: "warning", title: "Downloadable copy delayed", message: "Your saved changes are available to the team. The downloadable portfolio copy has not caught up yet. It will retry automatically; no need to save your changes again. If the delay continues, your portfolio owner can check the publishing job.", revision: "publication-retry", acknowledgeOnDismiss: true, toast: false, actions: [{ id: "check-status", label: "Check status", onClick: () => session.getState().hasKey ? refreshQuietly({ force: true }) : root.PortfolioPackageUI?.open("pull") }] });
      else if (publication?.status === "current") notices?.resolve("master-publication");
      root.dispatchEvent(new CustomEvent("portfolio:master-status", { detail: { connected: state.connected, hasKey: state.hasKey } }));
      renderUpdates();
    }

    function close(value) {
      const resolve = modalResolve; modalResolve = null; modalCancel = null;
      stopProgressTimer();
      if (progressState) progressState.nodes = null;
      modalOperation = null; modalView = "";
      if (dialog.open) dialog.close();
      resolve?.(value);
      if (!running && !discarding && button.isConnected) button.focus({ preventScroll: true });
    }

    function show(title, description, contentBuilder, { cancellable = true, view = "", dismissLabel = "Close and keep local changes", onDismiss } = {}) {
      if (modalResolve) close(null);
      modalOperation = running ? progressState : null; modalView = view;
      dialog.setAttribute("data-view", view);
      dialog.replaceChildren();
      const form = element("form", "master-dialog-form"); form.method = "dialog";
      const header = element("header", "master-dialog-heading"), titleWrap = element("div");
      const titleNode = element("h2", "", title); titleNode.id = "masterDialogTitle";
      const descriptionNode = element("p", "master-dialog-description", description); descriptionNode.id = "masterDialogDescription";
      titleWrap.append(titleNode, descriptionNode); header.append(titleWrap);
      if (cancellable) {
        const dismiss = element("button", "icon-button master-dialog-close", "×"); dismiss.type = "button"; dismiss.setAttribute("aria-label", dismissLabel);
        dismiss.addEventListener("click", () => onDismiss ? onDismiss() : close(null)); header.append(dismiss);
      }
      const body = element("div", "master-dialog-body"), footer = element("footer", "master-dialog-actions");
      form.append(header, body, footer); dialog.append(form);
      return new Promise((resolve) => {
        modalResolve = resolve; modalCancel = cancellable ? () => onDismiss ? onDismiss() : close(null) : () => {};
        contentBuilder({ body, footer, form, finish: close });
        dialog.showModal();
        (form.querySelector("[autofocus]") || form.querySelector("input,button,textarea"))?.focus({ preventScroll: true });
      });
    }
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); modalCancel?.(); });
    dialog.addEventListener("click", (event) => { if (event.target !== dialog) return; const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) modalCancel?.(); });
    const addCancel = (footer, text = "Cancel") => { const cancel = element("button", "quiet-button", text); cancel.type = "button"; cancel.addEventListener("click", () => close(null)); footer.append(cancel); };
    const addSubmit = (footer, text) => { const submit = element("button", "primary-button", text); submit.type = "submit"; footer.append(submit); return submit; };

    function reviewIntent(pending) {
      const products = pending.map((item) => {
        const kind = item.kind || "update", identity = { kind, productId: item.productId, categoryId: item.categoryId, laneId: item.laneId };
        if (kind === "create") return { ...identity, mine: item.mine };
        if (kind === "delete") return { ...identity, base: item.base, baseProductVersion: item.baseProductVersion };
        if (kind === "merge") return { ...identity, sourceProductId: item.sourceProductId, sourceCategoryId: item.sourceCategoryId, sourceLaneId: item.sourceLaneId,
          mine: item.mine, choices: item.choices || {}, base: item.base, sourceBase: item.sourceBase, baseProductVersion: item.baseProductVersion, sourceBaseProductVersion: item.sourceBaseProductVersion,
          keeperProduct: adapter.serializeNewProduct?.(item.keeperProduct) || item.keeperProduct, sourceProduct: adapter.serializeNewProduct?.(item.sourceProduct) || item.sourceProduct };
        return { ...identity, patch: item.patch };
      }).sort((a, b) => String(a.productId).localeCompare(String(b.productId)));
      return JSON.stringify(products, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
    }

    function review() {
      const pending = session.track(), intent = reviewIntent(pending);
      return show("Review changes", "Expand a product to check its changes.", ({ body, footer, form, finish }) => {
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
        form.addEventListener("submit", (event) => { event.preventDefault(); finish({ reason: reason.value, intent }); });
      }, { view: "review" });
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

    function stopProgressTimer() {
      if (progressTimer !== null) root.clearInterval(progressTimer);
      progressTimer = null;
    }

    function closeOperation(operation) {
      if (operation && modalOperation === operation) {
        if (dialog.open && !operation.hidden) operation.restoreFocus = true;
        close(null);
      }
    }

    function retireProgress(operation = progressState) {
      if (!operation || progressState !== operation) return false;
      const restoreFocus = !operation.hidden && Boolean(operation.restoreFocus || (dialog.open && modalOperation === operation));
      closeOperation(operation); stopProgressTimer(); progressState = null;
      return restoreFocus;
    }

    function updateProgress(operation) {
      if (progressState !== operation || modalOperation !== operation || modalView !== "progress" || !dialog.open || !operation.nodes) return;
      const seconds = Math.max(0, Math.floor((Date.now() - operation.startedAt) / 1000));
      const waiting = Date.now() - operation.phaseStartedAt >= 10000;
      const phases = { save: "Saving your updates", connect: "Connecting to your portfolio", account: "Checking your access", refresh: "Loading the latest records" };
      const title = waiting ? "Waiting for confirmation" : phases[operation.phase];
      const detail = waiting ? "Still waiting for a response. You can keep working." : "Closing this panel keeps the update running.";
      if (operation.nodes.title.textContent !== title) operation.nodes.title.textContent = title;
      if (operation.nodes.detail.textContent !== detail) operation.nodes.detail.textContent = detail;
      operation.nodes.elapsed.textContent = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
      operation.nodes.elapsed.setAttribute("aria-label", `Elapsed ${seconds} ${seconds === 1 ? "second" : "seconds"}`);
    }

    function hideProgress(operation) {
      if (progressState !== operation || modalOperation !== operation || modalView !== "progress") return;
      operation.hidden = true; closeOperation(operation);
      if (saveButton?.isConnected && !saveButton.disabled) saveButton.focus({ preventScroll: true });
    }

    function openProgress() {
      const operation = progressState;
      if (!operation || !running || destroyed || operation.generation !== localBaselineGeneration || (dialog.open && modalView !== "progress")) return;
      operation.hidden = false;
      if (dialog.open && modalOperation === operation && modalView === "progress") { updateProgress(operation); return; }
      const description = operation.count ? `${operation.count} ${operation.count === 1 ? "product" : "products"}` : "";
      void show(connectingGitHub ? "Connecting" : "Saving changes", description, ({ body, footer }) => {
        const row = element("div", "master-progress"), indicator = element("span", "master-progress-indicator"), copy = element("div", "master-progress-copy");
        indicator.setAttribute("aria-hidden", "true");
        const title = element("span", "master-progress-title"), detail = element("span", "master-progress-detail"), elapsed = element("span", "master-progress-elapsed");
        title.setAttribute("role", "status"); elapsed.setAttribute("role", "timer"); elapsed.setAttribute("aria-live", "off");
        copy.append(title, detail); row.append(indicator, copy, elapsed); body.append(row);
        operation.nodes = { title, detail, elapsed };
        const hide = element("button", "quiet-button", "Keep working"); hide.type = "button"; hide.addEventListener("click", () => hideProgress(operation)); footer.append(hide);
      }, { view: "progress", dismissLabel: "Close save progress", onDismiss: () => hideProgress(operation) }).catch(() => hideProgress(operation));
      updateProgress(operation);
      stopProgressTimer();
      progressTimer = root.setInterval(() => updateProgress(operation), 1000);
    }

    function progress(phase = "save") {
      const operation = progressState;
      if (!operation || operation.generation !== localBaselineGeneration || destroyed) return;
      if (operation.startedAt === null) operation.startedAt = Date.now();
      if (operation.phase !== phase) { operation.phase = phase; operation.phaseStartedAt = Date.now(); }
      updateStatus();
      if (!operation.hidden) openProgress();
    }

    async function connectGitHub() {
      if (destroyed || !githubMode || running || dialog.open || !session.getState().hasKey) return;
      const operationGeneration = localBaselineGeneration;
      root.PortfolioMasterPresence?.close?.();
      const token = await getAccess("github"); if (!token || operationGeneration !== localBaselineGeneration) return;
      const operation = { generation: operationGeneration, count: 0, phase: "", startedAt: null, phaseStartedAt: null, hidden: false, nodes: null };
      progressState = operation; running = true; connectingGitHub = true; progress("account");
      try {
        const account = await session.setGitHubToken(token);
        if (operationGeneration !== localBaselineGeneration) { closeOperation(operation); return; }
        lastError = "";
        progress("refresh"); await session.refresh(); closeOperation(operation); if (operationGeneration !== localBaselineGeneration) return; retryUntil = 0; lastRefreshAt = Date.now();
        notices?.publish({ id: "master-github-connected", severity: "success", title: "Connected", message: `Connected as ${account.name || account.login}.`, revision: String(Date.now()), toast: true });
      } catch (error) { closeOperation(operation); if (operationGeneration !== localBaselineGeneration) return; if (Number.isFinite(error.retryUntil)) retryUntil = Math.max(retryUntil, error.retryUntil); lastError = friendlyError(error); }
      finally {
        const restoreFocus = retireProgress(operation); running = false; connectingGitHub = false; if (!destroyed) updateStatus();
        if (restoreFocus && !destroyed) (saveButton && !saveButton.hidden && !saveButton.disabled ? saveButton : button).focus({ preventScroll: true });
      }
    }

    async function saveFlow() {
      if (destroyed) return;
      if (running) { openProgress(); return; }
      if (discarding || refreshRunning || dialog.open || session.getState().busy || adapter.hasPendingPackageOperation?.()) return;
      const operationGeneration = localBaselineGeneration;
      let operation = null;
      try {
        adapter.beforeSave?.();
        const reviewed = await review();
        if (!reviewed || operationGeneration !== localBaselineGeneration) return;
        lastError = "";
        operation = { generation: operationGeneration, count: session.track().length, phase: "", startedAt: null, phaseStartedAt: null, hidden: false, nodes: null };
        progressState = operation; running = true; updateStatus();
        while (!session.getState().hasKey) {
          const key = await getAccess();
          if (!key || operationGeneration !== localBaselineGeneration) return;
          progress("connect");
          try { await session.connect({ key }); closeOperation(operation); if (operationGeneration !== localBaselineGeneration) return; }
          catch (error) { closeOperation(operation); if (operationGeneration !== localBaselineGeneration) return; if (error.code === "INVALID_KEY") { const retryKey = await getAccess(false, friendlyError(error)); if (!retryKey || operationGeneration !== localBaselineGeneration) return; progress("connect"); await session.connect({ key: retryKey }); closeOperation(operation); if (operationGeneration !== localBaselineGeneration) return; } else throw error; }
        }
        let result;
        for (;;) {
          try {
            if (githubMode && !session.getState().hasGitHubToken) {
              closeOperation(operation); const token = await getAccess("github"); if (!token || operationGeneration !== localBaselineGeneration) return;
              progress("account"); await session.setGitHubToken(token); if (operationGeneration !== localBaselineGeneration) { closeOperation(operation); return; }
            }
            if (reviewIntent(session.track()) !== reviewed.intent) throw Object.assign(new Error("The reviewed draft changed."), { code: "REVIEW_REQUIRED" });
            progress("save");
            result = await session.save({ reason: reviewed.reason, resolveConflicts: async (conflicts) => {
              if (operationGeneration !== localBaselineGeneration) return null;
              closeOperation(operation); operation.phase = "review";
              const selected = await resolveConflicts(conflicts);
              if (operationGeneration !== localBaselineGeneration) return null;
              if (selected) progress("save"); return selected;
            } });
            closeOperation(operation); if (operationGeneration !== localBaselineGeneration) return; break;
          } catch (error) {
            closeOperation(operation);
            if (operationGeneration !== localBaselineGeneration) return;
            if (error.code === "INVALID_KEY") {
              const newKey = await getAccess(false, friendlyError(error));
              if (!newKey || operationGeneration !== localBaselineGeneration) return;
              progress("connect"); await session.connect({ key: newKey }); closeOperation(operation); if (operationGeneration !== localBaselineGeneration) return;
              continue;
            }
            if (githubMode && ["GITHUB_TOKEN_REQUIRED", "INVALID_GITHUB_TOKEN", "GITHUB_PERMISSION_DENIED"].includes(error.code)) {
              const token = await getAccess("github", friendlyError(error)); if (!token || operationGeneration !== localBaselineGeneration) return;
              progress("account"); await session.setGitHubToken(token); closeOperation(operation); if (operationGeneration !== localBaselineGeneration) return; continue;
            }
            if (error.code !== "EDITOR_KEY_REQUIRED" || teamMode) throw error;
            const token = await getAccess(true, session.getState().snapshot?.requiresEditorToken ? "" : friendlyError(error));
            if (!token || operationGeneration !== localBaselineGeneration) return;
            session.setEditorToken(token);
          }
        }
        if (result.saved) {
          lastError = "";
          notices?.resolve("plc-master-sharing");
          notices?.publish({ id: "master-save-result", severity: "success", title: result.keptMaster ? "Latest values kept" : "Changes saved", message: "Your team will see these updates automatically.", revision: String(Date.now()), toast: true });
        }
      } catch (error) {
        if (operationGeneration !== localBaselineGeneration) { closeOperation(operation); return; }
        if (Number.isFinite(error.retryUntil)) retryUntil = Math.max(retryUntil, error.retryUntil);
        if (operation) closeOperation(operation); else if (modalView === "review") close(null);
        lastError = friendlyError(error, true); lastErrorWasSave = true;
        updateStatus(); notices?.show("master-sync-error");
      } finally {
        const restoreFocus = retireProgress(operation); running = false; if (!destroyed) updateStatus();
        if (restoreFocus && !destroyed) (saveButton && !saveButton.hidden && !saveButton.disabled ? saveButton : button).focus({ preventScroll: true });
      }
    }

    async function saveScoped(options) {
      if (running || discarding || refreshRunning || dialog.open || session.getState().busy || adapter.hasPendingPackageOperation?.()) return { status: "pending", saved: false, code: "MASTER_BUSY", message: "PLC data is saved on this device. Sharing will resume when the current update finishes." };
      if (typeof session.saveScoped !== "function") return { status: "local", saved: false, code: "SCOPED_SAVE_UNAVAILABLE", message: "PLC data is saved on this device. Shared saving needs an updated connection." };
      const operationGeneration = localBaselineGeneration;
      running = true;
      try {
        const result = await session.saveScoped(options);
        if (operationGeneration !== localBaselineGeneration) return { status: "superseded", saved: false };
        if (Number.isFinite(result.retryUntil)) retryUntil = Math.max(retryUntil, result.retryUntil);
        if (result.status === "saved") notices?.resolve("plc-master-sharing");
        else notices?.publish({ id: "plc-master-sharing", severity: result.status === "pending" ? "warning" : "info", title: result.status === "pending" ? "PLC sharing needs attention" : "PLC data collected", message: result.status === "pending" ? "Your PLC data is saved on this device. Review the pending changes to share them." : "Your PLC data is saved on this device. Connect with editing access to share it automatically.", toast: false, actions: [{ label: "Review changes", onClick: saveFlow }] });
        return result;
      } catch (error) { if (operationGeneration !== localBaselineGeneration) return { status: "superseded", saved: false }; throw error; }
      finally { running = false; updateStatus(); }
    }

    button.addEventListener("click", (event) => { event.preventDefault(); event.stopImmediatePropagation(); showUpdates(); }, true);
    saveButton?.addEventListener("click", () => { void saveFlow(); });
    root.addEventListener("portfolio:render", updateStatus);
    let refreshRunning = false, lastRefreshAt = 0, retryUntil = 0;
    async function refreshQuietly({ force = false, manual = false } = {}) {
      const state = session.getState();
      if (!configured || running || discarding || dialog.open || refreshRunning || state.busy || document.visibilityState === "hidden" || !state.hasKey || adapter.canRefresh?.({ allowUpdatesDialog: manual && updates.open }) === false) {
        if (manual) { checkMessage = "Finish the current edit or update, then check again. Your workspace has not been replaced."; renderUpdates(); }
        return { status: "blocked" };
      }
      if (!force && Date.now() < retryUntil) return;
      if (githubMode && !force && Date.now() - lastRefreshAt < (session.getState().hasGitHubToken ? 120000 : 300000)) return;
      lastRefreshAt = Date.now();
      const operationGeneration = localBaselineGeneration;
      refreshRunning = true; checkMessage = ""; updateStatus();
      try { const result = await session.refresh(); if (operationGeneration !== localBaselineGeneration) return { status: "superseded" }; if (result === null) throw Object.assign(new Error("Another update is in progress."), { code: "MASTER_BUSY" }); lastCheckedAt = Date.now(); checkedPublication = session.getState().snapshot?.publication ? JSON.parse(JSON.stringify(session.getState().snapshot.publication)) : null; lastCheckError = ""; if (!lastErrorWasSave || !session.getState().pending.length) lastError = ""; retryUntil = 0; return { status: "checked", checkedAt: lastCheckedAt }; }
      catch (error) { if (operationGeneration !== localBaselineGeneration) return { status: "superseded" }; lastCheckError = friendlyError(error); if (Number.isFinite(error.retryUntil)) retryUntil = Math.max(retryUntil, error.retryUntil); if (!lastErrorWasSave) lastError = lastCheckError; return { status: "error" }; }
      finally { refreshRunning = false; updateStatus(); }
    }
    const timer = root.setInterval(refreshQuietly, githubMode ? 60000 : 45000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState !== "hidden") refreshQuietly(); });
    active = Object.freeze({ session, updateStatus, connectGitHub, refresh: () => refreshQuietly({ force: true }), save: saveFlow, saveScoped, openUpdates: showUpdates,
      getSummary() { const state = session.getState(); return { pendingCount: session.track().length, busy: Boolean(state.busy || running || discarding || refreshRunning), connected: state.connected, lastCheckedAt, publicationStatus: checkedPublication?.status || state.snapshot?.publication?.status || '', error: Boolean(lastError || lastCheckError) }; },
      reviewConflicts(conflicts) { if (running || discarding || session.getState().busy || !Array.isArray(conflicts) || !conflicts.length) return null; return resolveConflicts(conflicts); },
      markImported(products, key) { localBaselineGeneration += 1; retireProgress(); session.markImported(products, key); notices?.resolve("master-save-result"); notices?.resolve("master-github-connected"); lastError = ""; lastCheckError = ""; lastCheckedAt = 0; checkedPublication = null; lastRefreshAt = 0; retryUntil = 0; updateStatus(); if (key) refreshQuietly(); },
      adoptLocalBaseline() { localBaselineGeneration += 1; retireProgress(); session.adoptLocalBaseline(); lastError = ""; lastErrorWasSave = false; lastCheckError = ""; lastCheckedAt = 0; checkedPublication = null; checkMessage = ""; publicationDelayed = false; lastRefreshAt = 0; retryUntil = 0; for (const id of ["master-save-result", "master-sync-error", "master-publication", "master-github-connected", "plc-master-sharing", "master-discard-result", "master-discard-undone"]) notices?.resolve(id); updateStatus(); },
      disconnect() { localBaselineGeneration += 1; retireProgress(); root.PortfolioMasterPresence?.leave(); session.disconnect(); notices?.resolve("master-save-result"); notices?.resolve("master-github-connected"); lastError = ""; lastCheckedAt = 0; checkedPublication = null; lastCheckError = ""; updateStatus(); },
      destroy() { destroyed = true; localBaselineGeneration += 1; retireProgress(); root.clearInterval(timer); session.disconnect(); for (const id of ["master-pending", "master-saving-unavailable", "master-sync-error", "master-save-result", "master-github-connected", "master-discard-result", "master-discard-undone", "plc-master-sharing"]) notices?.resolve(id); notices?.resolve("master-publication", { preserveAcknowledgment: true }); updates.remove(); dialog.remove(); },
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
  root.PortfolioMasterUI = Object.freeze({ initialize, getSession() { return active?.session || null; }, getSummary() { return active?.getSummary() || {}; }, openUpdates() { return active?.openUpdates(); }, connectGitHub() { return active?.connectGitHub(); }, updateStatus() { active?.updateStatus(); }, refresh() { return active?.refresh(); }, save() { return active?.save(); }, saveScoped(options) { return active?.saveScoped(options) ?? Promise.resolve({ status: "local", saved: false, code: "SHARING_NOT_CONNECTED", message: "PLC data is saved on this device. Connect shared saving to share it automatically." }); }, reviewConflicts(conflicts) { return active?.reviewConflicts(conflicts) ?? null; }, markImported(products, key) { active?.markImported(products, key); }, adoptLocalBaseline() { active?.adoptLocalBaseline(); }, disconnect() { active?.disconnect(); } });
  if (root.PortfolioMasterAdapter) {
    const openWhenReady = () => initialize({ adapter: root.PortfolioMasterAdapter });
    root.addEventListener?.("portfolio:workspace-ready", openWhenReady);
    if (root.PortfolioWorkspaceReady) void root.PortfolioWorkspaceReady.then(openWhenReady).catch(() => {});
    else openWhenReady();
  }
})(globalThis);
