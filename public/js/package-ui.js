/* One package flow for the shared master, local imports and publisher exports. */
(() => {
  "use strict";
  const get = (id) => document.getElementById(id);
  const dialog = get("packageDialog");
  const form = get("packageForm");
  const keyInput = get("packageKey");
  const commentsInput = get("packageUpdateComments");
  const submit = get("confirmPackage");
  const status = get("packageStatus");
  const error = get("packageError");
  let mode = "pull", selectedFile = null, busy = false, completed = false, restoreFocus = null, controller = null, cancelRequested = false, downloadedBytes = null;
  let footerInfoKey = "", footerCommentsOpen = false;

  function packageInfoText(info) {
    const date = info?.updatedAt ? new Date(info.updatedAt) : null;
    const hasDate = date && Number.isFinite(date.getTime());
    const comments = info?.comments || "";
    return {
      updated: hasDate ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date) : "Date not supplied",
      dateTime: hasDate ? info.updatedAt : "",
      dateTitle: hasDate ? new Intl.DateTimeFormat(undefined, { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "long" }).format(date) : "",
      comments: comments.trim() ? comments : "No comments supplied.",
      hasComments: Boolean(comments.trim()),
    };
  }

  function setPackageDate(element, text) {
    element.textContent = text.updated;
    element.dateTime = text.dateTime;
    element.title = text.dateTitle;
  }

  function showPackageInfo(info, updatedId, commentsId) {
    const text = packageInfoText(info);
    setPackageDate(get(updatedId), text);
    get(commentsId).textContent = text.comments;
  }

  function showFooterPackageInfo(info) {
    const footer = get("statusbarPackage");
    if (!footer) return;
    const text = packageInfoText(info);
    const infoKey = `${text.dateTime}\n${text.comments}`;
    if (infoKey !== footerInfoKey) { footerInfoKey = infoKey; footerCommentsOpen = false; }
    const updated = document.createElement("span");
    updated.className = "statusbar-package-date";
    updated.textContent = text.dateTime ? "Updated " : "Update date ";
    const date = document.createElement("time");
    setPackageDate(date, text);
    updated.append(date);
    if (!text.hasComments) {
      const comments = document.createElement("span");
      comments.className = "statusbar-package-empty";
      comments.textContent = text.comments;
      footer.replaceChildren(updated, comments);
      return;
    }
    const comments = document.createElement("details");
    comments.className = "statusbar-package-comment";
    comments.open = footerCommentsOpen;
    const summary = document.createElement("summary");
    summary.title = "Show full package comment";
    const preview = document.createElement("span");
    preview.textContent = `Comment: ${text.comments.replace(/\s+/g, " ").trim()}`;
    summary.append(preview);
    const fullComment = document.createElement("p");
    fullComment.className = "statusbar-comment-full";
    fullComment.textContent = text.comments;
    fullComment.tabIndex = 0;
    comments.append(summary, fullComment);
    comments.addEventListener("toggle", () => { if (comments.isConnected) footerCommentsOpen = comments.open; });
    comments.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && comments.open) {
        event.preventDefault(); event.stopPropagation(); comments.open = false; footerCommentsOpen = false; summary.focus();
      }
    });
    footer.replaceChildren(updated, comments);
  }

  function usesRelay() {
    const source = globalThis.PPC_PACKAGE_SOURCE;
    return source.mode === "relay" || (!source.packageUrl && Boolean(source.endpoint));
  }

  function pullSource() {
    const source = globalThis.PPC_PACKAGE_SOURCE;
    if (source.mode === "github") {
      if (!globalThis.PortfolioMasterGitHub) throw new Error("GitHub sharing could not load. Refresh this page and try again.");
      return { github: globalThis.PortfolioMasterGitHub.normalizeConfig(source) };
    }
    if (usesRelay()) {
      return { endpoint: globalThis.PortfolioPackageClient.normalizeEndpoint(source.endpoint) };
    }
    return { packageUrl: globalThis.PortfolioPackageClient.normalizePackageUrl(source.packageUrl) };
  }

  function refresh() {
    const info = globalThis.getCurrentPackageInfo();
    showPackageInfo(info, "sharedPackageUpdated", "sharedPackageComments");
    showFooterPackageInfo(info);
    try {
      const source = pullSource();
      get("sharedPackageStatus").textContent = "Open your portfolio with your access key. Products and Roadmap update together.";
    } catch {
      get("sharedPackageStatus").textContent = "Team updates need to be connected. You can still import or export a portfolio.";
    }
  }

  function updateKeyControls() {
    const needsKey = mode === "pull" || (mode === "import" && selectedFile?.encrypted) || (mode === "export" && get("packageEncrypt").checked);
    get("packageKeySection").classList.toggle("hidden", !needsKey || (completed && mode !== "export"));
    keyInput.required = needsKey && !completed;
    keyInput.readOnly = completed && mode === "export";
    get("packageGenerateKey").classList.toggle("hidden", mode !== "export" || completed);
    get("packagePublisherHelp").classList.toggle("hidden", mode !== "export" || !needsKey);
    const teamUnlock = globalThis.PPC_MASTER_SOURCE?.team === true && (mode === "pull" || (mode === "import" && selectedFile?.encrypted));
    get("packageKeyHelp").textContent = teamUnlock ? "Your key opens the portfolio. This browser tab reconnects automatically." : "Use the access key supplied with this portfolio.";
    get("packagePublisherHelp").textContent = "Keep your access key in a safe place, separate from the exported portfolio.";
    keyInput.type = get("packageShowKey").checked ? "text" : "password";
  }

  function setBusy(value, applying = false) {
    busy = value;
    for (const control of form.querySelectorAll("input, textarea, button")) control.disabled = value;
    get("cancelPackage").disabled = value && applying;
    get("closePackage").disabled = value && applying;
    submit.textContent = value ? (applying ? "Loading package…" : mode === "export" ? "Building package…" : "Downloading…") : mode === "pull" ? "Pull latest data" : mode === "export" ? "Build package" : "Import package";
  }

  function close() {
    if (busy) { if (controller) { cancelRequested = true; keyInput.value = ""; controller.abort(); } return; }
    const refreshMaster = completed && mode !== "export";
    dialog.classList.add("hidden");
    document.querySelector(".app-shell").inert = false;
    get("workspaceEmpty").inert = false;
    keyInput.value = "";
    commentsInput.value = "";
    selectedFile = null;
    downloadedBytes = null;
    completed = false;
    get("packageShowKey").checked = false;
    keyInput.type = "password";
    if (restoreFocus?.isConnected && !restoreFocus.disabled && !restoreFocus.closest(".hidden")) restoreFocus.focus();
    else get(get("workspaceEmpty").classList.contains("hidden") ? "pullLatestData" : "emptyPullLatestData").focus();
    if (refreshMaster) globalThis.PortfolioMasterUI?.refresh?.();
  }

  function open(nextMode, file = null) {
    if (busy) return;
    globalThis.closePopupMenus();
    restoreFocus = document.activeElement;
    mode = nextMode; selectedFile = file; completed = false; downloadedBytes = null;
    cancelRequested = false;
    commentsInput.value = "";
    get("packageResultInfo").classList.add("hidden");
    get("packageResultUpdated").textContent = ""; get("packageResultComments").textContent = "";
    keyInput.value = ""; get("packageShowKey").checked = false; get("packageEncrypt").checked = true;
    get("cancelPackage").classList.remove("hidden");
    error.textContent = ""; status.textContent = "";
    const titles = { pull: "Open portfolio", export: "Export portfolio", import: "Import portfolio" };
    get("packageTitle").textContent = titles[mode];
    get("packageDescription").textContent = mode === "export" ? "One file contains every category, Products, Roadmap, settings, variants and available image files." : "Replace Products, Roadmap, settings and images with one complete package.";
    get("packageExportOptions").classList.toggle("hidden", mode !== "export");
    get("packageFileName").textContent = file ? file.name : "";
    get("packageFileName").classList.toggle("hidden", !file);
    updateKeyControls(); setBusy(false);
    dialog.classList.remove("hidden");
    document.querySelector(".app-shell").inert = true;
    get("workspaceEmpty").inert = true;
    if (mode === "pull") {
      try { pullSource(); }
      catch (problem) { error.textContent = problem.message; submit.disabled = true; get("packageKeySection").classList.add("hidden"); keyInput.required = false; }
    }
    if (!get("packageKeySection").classList.contains("hidden")) keyInput.focus(); else get("cancelPackage").focus();
  }

  async function openImport(file) {
    if (busy || !file) return;
    if (file.size > globalThis.PortfolioPackage.MAX_PACKAGE_BYTES) { open("import", { name: file.name, encrypted: false }); error.textContent = "This package exceeds the supported size."; submit.disabled = true; return; }
    const encrypted = globalThis.PortfolioPackage.isEncrypted(new Uint8Array(await file.slice(0, 8).arrayBuffer()));
    open("import", { name: file.name, encrypted, file });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    if (completed) { close(); return; }
    error.textContent = "";
    let key = "";
    try {
      if (keyInput.required) key = globalThis.PortfolioPackage.normalizeKey(keyInput.value);
      keyInput.value = "";
      setBusy(true, mode !== "pull");
      let result;
      if (mode === "pull") {
        const source = pullSource();
        let bytes = source.packageUrl ? downloadedBytes : null;
        if (!bytes) {
          controller = new AbortController();
          const timeout = setTimeout(() => controller?.abort(), 60000);
          status.textContent = "Loading your portfolio…";
          try {
            bytes = await globalThis.PortfolioPackageClient.downloadLatest({ ...source, ...(source.endpoint ? { key } : {}), signal: controller.signal,
              onProgress: (size, total) => { status.textContent = `Downloading ${Math.round(size / 1048576)}${total ? ` of ${Math.ceil(total / 1048576)}` : ""} MB…`; },
            });
            if (source.packageUrl) downloadedBytes = bytes;
          } finally { clearTimeout(timeout); controller = null; }
        }
        if (cancelRequested) throw new DOMException("Download cancelled.", "AbortError");
        setBusy(true, true); status.textContent = "Checking and loading the complete package…";
        result = await globalThis.importProjectPackage(new Blob([bytes]), { key, requireEncrypted: true });
      } else if (mode === "import") {
        status.textContent = "Checking and loading the complete package…";
        result = await globalThis.importProjectPackage(selectedFile.file, { key });
      } else { status.textContent = "Collecting data and image files…"; result = await globalThis.exportProjectPackage(key, { comments: commentsInput.value }); }
      completed = true;
      downloadedBytes = null;
      if (mode === "export") keyInput.value = key;
      status.textContent = mode === "export" ? "Your portfolio export is ready. Keep it and your access key in a safe place." : `${result.productCount} products across ${result.categoryCount} categories loaded. Products and Roadmap are updated together.`;
      get("packageTitle").textContent = mode === "export" ? "Package built" : "Data updated";
      showPackageInfo(mode === "export" ? result : result.packageInfo, "packageResultUpdated", "packageResultComments");
      get("packageResultInfo").classList.remove("hidden");
      refresh(); updateKeyControls(); setBusy(false);
      get("packageExportOptions").classList.add("hidden");
      get("cancelPackage").classList.add("hidden"); submit.textContent = "Done"; submit.focus();
    } catch (problem) {
      if (mode === "export" && key) keyInput.value = key;
      error.textContent = problem.name === "AbortError" ? "Download cancelled or timed out. Your workspace was not changed." : problem.message || (mode === "export" ? "The package could not be built. Try again." : "The package could not be loaded. Your workspace was not changed.");
      status.textContent = downloadedBytes && !cancelRequested ? "The package is downloaded. You can try again without downloading it again." : ""; setBusy(false);
      if (cancelRequested) close(); else keyInput.focus();
    } finally { key = ""; controller = null; }
  });

  get("packageGenerateKey").onclick = () => { keyInput.value = globalThis.PortfolioPackage.generateKey(); get("packageShowKey").checked = true; updateKeyControls(); status.textContent = "New key created. Copy it before exporting and keep it in a safe place."; };
  get("packageCopyKey").onclick = async () => {
    if (!keyInput.value) { error.textContent = "Enter or create a package key first."; return; }
    const copied = await globalThis.copyTextToClipboard(keyInput.value);
    status.textContent = copied ? "Package key copied." : "Select the key and copy it manually.";
  };
  get("packageShowKey").onchange = updateKeyControls;
  get("packageEncrypt").onchange = updateKeyControls;
  get("closePackage").onclick = close;
  get("cancelPackage").onclick = close;
  dialog.addEventListener("pointerdown", (event) => { if (event.target === dialog) close(); });
  dialog.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); close(); }
    else if (event.key === "Tab") {
      const controls = [...form.querySelectorAll("button:not([disabled]), input:not([disabled]), textarea:not([disabled])")].filter((el) => el.getClientRects().length > 0 && !el.closest(".hidden"));
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  for (const id of ["pullLatestData", "emptyPullLatestData", "settingsPullLatestData"]) get(id).onclick = () => { get("cancelPackage").classList.remove("hidden"); open("pull"); };
  get("exportPackage").onclick = () => { get("cancelPackage").classList.remove("hidden"); open("export"); };
  window.addEventListener("portfolio:render", refresh);
  globalThis.PortfolioPackageUI = Object.freeze({ openImport, open, close, refresh });
  refresh();
})();
