/* One package flow for the shared master, local imports and publisher exports. */
(() => {
  "use strict";
  const get = (id) => document.getElementById(id);
  const dialog = get("packageDialog");
  const form = get("packageForm");
  const keyInput = get("packageKey");
  const submit = get("confirmPackage");
  const status = get("packageStatus");
  const error = get("packageError");
  let mode = "pull", selectedFile = null, busy = false, completed = false, restoreFocus = null, controller = null, cancelRequested = false;

  function refresh() {
    get("restorePreviousPackage").disabled = !globalThis.hasPreviousPackage();
    get("sharedPackageStatus").textContent = globalThis.PPC_PACKAGE_SOURCE.endpoint ? "Load the shared master into Products and Roadmap with your package key." : "Shared data setup is pending. Local package import and export are available.";
  }

  function updateKeyControls() {
    const needsKey = mode === "pull" || (mode === "import" && selectedFile?.encrypted) || (mode === "export" && get("packageEncrypt").checked);
    get("packageKeySection").classList.toggle("hidden", !needsKey || (completed && mode !== "export"));
    keyInput.required = needsKey && !completed;
    keyInput.readOnly = completed && mode === "export";
    get("packageGenerateKey").classList.toggle("hidden", mode !== "export" || completed);
    get("packagePublisherHelp").classList.toggle("hidden", mode !== "export" || !needsKey);
    keyInput.type = get("packageShowKey").checked ? "text" : "password";
  }

  function setBusy(value, applying = false) {
    busy = value;
    for (const control of form.querySelectorAll("input, button")) control.disabled = value;
    get("cancelPackage").disabled = value && applying;
    get("closePackage").disabled = value && applying;
    submit.textContent = value ? (applying ? "Loading package…" : mode === "export" ? "Building package…" : "Downloading…") : mode === "pull" ? "Pull latest data" : mode === "export" ? "Build package" : mode === "restore" ? "Restore previous workspace" : "Import package";
  }

  function close() {
    if (busy) { if (controller) { cancelRequested = true; keyInput.value = ""; controller.abort(); } return; }
    dialog.classList.add("hidden");
    document.querySelector(".app-shell").inert = false;
    get("workspaceEmpty").inert = false;
    keyInput.value = "";
    selectedFile = null;
    completed = false;
    get("packageShowKey").checked = false;
    keyInput.type = "password";
    if (restoreFocus?.isConnected && !restoreFocus.disabled && !restoreFocus.closest(".hidden")) restoreFocus.focus();
    else get("pullLatestData").focus();
  }

  function open(nextMode, file = null) {
    if (busy) return;
    globalThis.closePopupMenus();
    restoreFocus = document.activeElement;
    mode = nextMode; selectedFile = file; completed = false;
    cancelRequested = false;
    keyInput.value = ""; get("packageShowKey").checked = false; get("packageEncrypt").checked = true;
    get("cancelPackage").classList.remove("hidden");
    error.textContent = ""; status.textContent = "";
    const titles = { pull: "Pull latest data", export: "Build master package", import: "Import project package", restore: "Restore previous workspace" };
    get("packageTitle").textContent = titles[mode];
    get("packageDescription").textContent = mode === "export" ? "One file contains every category, Products, Roadmap, settings, variants and available image files." : mode === "restore" ? "Return to the workspace saved before your last package import. Your current workspace becomes the new recovery copy." : "Replace Products and Roadmap with one complete package. Your current workspace is kept as a recovery copy on this device.";
    get("packageExportOptions").classList.toggle("hidden", mode !== "export");
    get("packageFileName").textContent = file ? file.name : "";
    get("packageFileName").classList.toggle("hidden", !file);
    updateKeyControls(); setBusy(false);
    dialog.classList.remove("hidden");
    document.querySelector(".app-shell").inert = true;
    get("workspaceEmpty").inert = true;
    if (mode === "pull") {
      try { globalThis.PortfolioPackageClient.normalizeEndpoint(globalThis.PPC_PACKAGE_SOURCE.endpoint); }
      catch (problem) { error.textContent = problem.message; submit.disabled = true; get("packageKeySection").classList.add("hidden"); keyInput.required = false; }
    }
    if (mode === "restore" && !globalThis.hasPreviousPackage()) { error.textContent = "There is no previous package workspace to restore on this device."; submit.disabled = true; }
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
        controller = new AbortController();
        const timeout = setTimeout(() => controller?.abort(), 60000);
        let bytes;
        try {
          bytes = await globalThis.PortfolioPackageClient.downloadLatest({ endpoint: globalThis.PPC_PACKAGE_SOURCE.endpoint, key, signal: controller.signal,
            onProgress: (size, total) => { status.textContent = `Downloading ${Math.round(size / 1048576)}${total ? ` of ${Math.ceil(total / 1048576)}` : ""} MB…`; },
          });
        } finally { clearTimeout(timeout); controller = null; }
        if (cancelRequested) throw new DOMException("Download cancelled.", "AbortError");
        setBusy(true, true); status.textContent = "Checking and loading the complete package…";
        result = await globalThis.importProjectPackage(new Blob([bytes]), { key, requireEncrypted: true });
      } else if (mode === "import") {
        status.textContent = "Checking and loading the complete package…";
        result = await globalThis.importProjectPackage(selectedFile.file, { key });
      } else if (mode === "restore") result = await globalThis.restorePreviousPackage();
      else { status.textContent = "Collecting data and image files…"; await globalThis.exportProjectPackage(key); }
      completed = true;
      if (mode === "export") keyInput.value = key;
      status.textContent = mode === "export" ? (key ? "master_ppc.pkg is ready. Replace the master file in SharePoint and keep the key separate." : "Private backup package created.") : `${result.productCount} products across ${result.categoryCount} categories loaded. Products and Roadmap are updated together.`;
      get("packageTitle").textContent = mode === "export" ? "Package built" : mode === "restore" ? "Workspace restored" : "Data updated";
      refresh(); updateKeyControls(); setBusy(false);
      get("packageExportOptions").classList.add("hidden");
      get("cancelPackage").classList.add("hidden"); submit.textContent = "Done"; submit.focus();
    } catch (problem) {
      if (mode === "export" && key) keyInput.value = key;
      error.textContent = problem.name === "AbortError" ? "Download cancelled or timed out. Your workspace was not changed." : problem.message || "The package could not be loaded. Your previous workspace is available.";
      status.textContent = ""; setBusy(false);
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
      const controls = [...form.querySelectorAll("button:not([disabled]), input:not([disabled])")].filter((el) => el.getClientRects().length > 0 && !el.closest(".hidden"));
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  for (const id of ["pullLatestData", "emptyPullLatestData", "settingsPullLatestData"]) get(id).onclick = () => { get("cancelPackage").classList.remove("hidden"); open("pull"); };
  get("exportPackage").onclick = () => { get("cancelPackage").classList.remove("hidden"); open("export"); };
  get("restorePreviousPackage").onclick = () => { get("cancelPackage").classList.remove("hidden"); open("restore"); };
  window.addEventListener("portfolio:render", refresh);
  globalThis.PortfolioPackageUI = Object.freeze({ openImport, open, close, refresh });
  refresh();
})();
