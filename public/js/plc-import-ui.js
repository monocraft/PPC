/* Biweekly PLC collection, review, source freshness, and traceable milestone history. */
(function (root) {
  "use strict";
  let active = null;
  const text = (value) => value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const dateLabel = (value) => { if (!value) return "Unknown"; const raw = text(value); if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw; const date = new Date(raw); return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" }) : raw; };
  const entries = (portfolio) => (portfolio?.categories || []).flatMap((category) => (category.board?.products || []).map((product) => ({ product, categoryId: category.id, categoryName: category.name || category.id })));
  const sourceRef = (source) => source ? [source.sheet, source.cell || source.coordinate, source.mergeRange && `merged ${source.mergeRange}`, source.inherited && "inherited cell", source.crossProduct && "shared across products"].filter(Boolean).join(" · ") : "";
  const cellText = (value) => typeof value === "object" && value ? text(value.raw ?? value.value ?? value.text ?? value) : text(value);
  function csvCell(value) {
    const raw = text(value), safe = /^[\s\u0000-\u001f]*[=+@-]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replace(/"/g, '""')}"`;
  }
  function historyRows(portfolio) {
    return entries(portfolio).flatMap(({ product, categoryName }) => (product.plc?.history || []).map((event) => ({ eventType: "date-change", productId: product.id, productName: product.name || product.id, category: categoryName, sourceFile: product.plc.sourceFile, ...event })));
  }
  function importRows(portfolio) {
    return (portfolio?.plcImports || []).flatMap((run) => (run.rows?.length ? run.rows : [{}]).map((row) => ({ eventType: run.type === "review" ? "review-resolution" : "import-observation", at: run.at, reportDate: run.reportDate, sourceFile: run.sourceFile, productId: row.productId || "", productName: row.name || "", field: (row.fields || []).map((field) => field.field).join("; "), reason: row.action || "", source: { fields: row.fields || [], observation: row.observation || null }, summary: run.summary })));
  }
  function historyCsv(portfolio) {
    const keys = ["eventType", "productId", "productName", "category", "at", "importedAt", "reportDate", "field", "before", "after", "sourceFile", "reason", "source", "summary"];
    return `\uFEFF${keys.map(csvCell).join(",")}\r\n${[...importRows(portfolio), ...historyRows(portfolio)].map((row) => keys.map((key) => csvCell(row[key])).join(",")).join("\r\n")}`;
  }
  function sourceSummary(portfolio, importer = root.PLCImporter, today = localDay()) {
    const products = entries(portfolio).filter(({ product }) => product.plc?.importedAt);
    const sorted = products.slice().sort((a, b) => text(b.product.plc.importedAt).localeCompare(text(a.product.plc.importedAt)));
    const runs = (portfolio?.plcImports || []).slice().sort((a, b) => text(b.at).localeCompare(text(a.at))), latestRun = runs[0] || null, latestImport = runs.find((run) => run.type !== "review") || null;
    const latestProduct = sorted[0]?.product.plc || null;
    const last = latestImport ? { ...latestImport, importedAt: latestImport.at } : latestProduct;
    const freshness = last && importer?.freshness ? importer.freshness(last, today) : { status: "unknown", ageDays: null, importAgeDays: null };
    const overdue = products.filter(({ product }) => importer?.freshness?.(product.plc, today).status === "overdue").length;
    return { products, last, latestRun, latestImport, freshness, overdue };
  }
  function createController({ adapter, importer = root.PLCImporter, document: doc = root.document, notifications = root.PortfolioNotifications } = {}) {
    if (!adapter?.getPortfolio || !importer) return null;
    let dialog = null, returnFocus = null, body = null, footer = null, errorNode = null, fileInput = null, fileGeneration = 0, destroyed = false, renderedTab = "", openRows = new Set(), knownRows = new Set(), openProducts = new Set();
    let state = { open: false, tab: "overview", dataset: null, plan: null, reportDate: "", selections: {}, resolutions: {}, skippedKeys: new Set(), skippedFields: {}, busy: false, phase: "", error: "", result: null };
    const make = (tag, className = "", content) => { const node = doc.createElement(tag); if (className) node.className = className; if (content !== undefined) node.textContent = text(content); return node; };
    const button = (label, className, action) => { const node = make("button", className, label); node.type = "button"; node.addEventListener("click", action); return node; };
    const portfolio = () => adapter.getPortfolio();
    const setError = (value) => { state.error = text(value); if (errorNode) { errorNode.textContent = state.error; errorNode.hidden = !state.error; } };
    function ensureDialog() {
      if (dialog || !doc) return;
      dialog = make("dialog", "plc-dialog"); dialog.id = "plcUpdatesDialog"; dialog.setAttribute("aria-labelledby", "plcUpdatesTitle"); dialog.setAttribute("aria-describedby", "plcUpdatesDescription"); doc.body.append(dialog);
      dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
      dialog.addEventListener("click", (event) => { if (event.target !== dialog) return; const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close(); });
    }
    function close() {
      if (state.busy) return false;
      state.open = false; if (dialog?.open) dialog.close();
      if (returnFocus?.isConnected && !returnFocus.closest?.(".hidden")) returnFocus.focus({ preventScroll: true });
      else doc?.getElementById("workspaceSettingsButton")?.focus({ preventScroll: true });
      returnFocus = null; return true;
    }
    function open({ tab = "overview" } = {}) {
      if (destroyed || state.busy) return false;
      returnFocus = doc?.activeElement; root.dispatchEvent?.(new CustomEvent("close-workspace-settings"));
      state.open = true; state.tab = tab === "import" ? "overview" : ["overview", "review", "history"].includes(tab) ? tab : "overview"; state.error = "";
      if (!state.dataset) rebuild();
      if (doc) { ensureDialog(); render(); if (!dialog.open) dialog.showModal(); dialog.querySelector("button")?.focus({ preventScroll: true }); }
      return true;
    }
    function rebuild() {
      state.plan = state.dataset ? importer.buildPlan(state.dataset, portfolio(), { reportDate: state.reportDate || localDay(), reportDateBasis: "Import date", selections: state.selections }) : importer.buildReviewPlan?.(portfolio(), { selections: state.selections }) || null;
    }
    function resetChoices() { state.selections = {}; state.resolutions = {}; state.skippedKeys = new Set(); state.skippedFields = {}; }
    function reviewCount() { return importer.buildReviewPlan?.(portfolio())?.items?.length || 0; }
    function collectResult(result) {
      state.result = result || {}; state.dataset = null; resetChoices(); rebuild(); state.tab = "overview";
      try { adapter.afterChange?.(result); } catch { /* Collection is already retained; a view refresh must not replay it. */ }
      try { notifications?.publish?.({ id: "plc-import-result", severity: result?.sharing?.status === "pending" ? "warning" : "success", title: result?.summary?.duplicate || result?.duplicate ? "Workbook already collected" : "PLC update collected", message: result?.sharing?.message || "Reliable dates and source evidence are saved. Any uncertain details are available in Needs review.", toast: true }); } catch { /* A notification failure cannot undo a collected workbook. */ }
      refresh();
    }
    async function loadFile(file) {
      if (!file || destroyed || state.busy) return false;
      if (!/\.xlsx$/i.test(file.name || "")) { setError("Choose an Excel .xlsx PLC workbook."); return false; }
      const generation = ++fileGeneration;
      state.busy = true; state.phase = "Reading workbook…"; state.error = ""; state.tab = "overview"; state.dataset = null; rebuild(); render();
      let collected = false;
      try {
        const dataset = await importer.parseWorkbook(await file.arrayBuffer(), { fileName: file.name });
        if (destroyed || generation !== fileGeneration) return false;
        state.dataset = dataset; state.reportDate = localDay(); resetChoices(); state.result = null; rebuild();
        state.phase = "Saving reliable dates and project updates…"; render();
        const result = await adapter.applyPlan(state.plan, { automatic: true });
        if (destroyed || generation !== fileGeneration) return false;
        collected = true; collectResult(result);
      } catch (error) { state.error = error.message || "The PLC workbook could not be read."; if (!state.dataset) rebuild(); }
      finally { if (generation === fileGeneration) { state.busy = false; state.phase = ""; render(); } }
      return collected;
    }
    function loadFiles(files) {
      const workbooks = Array.from(files || []);
      if (state.busy) return false;
      if (workbooks.length !== 1) { setError("Drop one PLC Excel workbook at a time."); return false; }
      return loadFile(workbooks[0]);
    }
    function chooseMatch(key, productId) {
      if (productId === "skip") { state.skippedKeys.add(key); delete state.selections[key]; }
      else { state.skippedKeys.delete(key); if (productId) state.selections[key] = productId; else delete state.selections[key]; }
      try { rebuild(); state.error = ""; } catch (error) { state.error = error.message; }
      render();
    }
    function choices() {
      return { selections: { ...state.selections }, resolutions: JSON.parse(JSON.stringify(state.resolutions)), skippedKeys: [...state.skippedKeys], skippedFields: JSON.parse(JSON.stringify(state.skippedFields)) };
    }
    async function apply() {
      if (state.busy || !state.plan) return false;
      state.busy = true; state.phase = "Saving reviewed updates…"; setError(""); render();
      try {
        const result = await adapter.applyPlan(state.plan, { ...choices(), ...(state.dataset ? { automatic: true } : {}) });
        collectResult(result);
      } catch (error) { setError(error.message || "The PLC update could not be applied. Review the source and try again."); }
      finally { state.busy = false; state.phase = ""; render(); }
      return !state.error;
    }
    async function retrySharing() {
      if (state.busy || !adapter.retrySharing) return false;
      state.busy = true; state.phase = "Saving collected updates to master…"; setError(""); render();
      try { const result = await adapter.retrySharing(), latestRun = sourceSummary(portfolio(), importer).latestRun; state.result = { ...(state.result || (latestRun ? { summary: latestRun.summary } : {})), sharing: result?.sharing || result }; refresh(); }
      catch (error) { setError(error.message || "The update remains saved locally. Sharing could not be completed."); }
      finally { state.busy = false; state.phase = ""; render(); }
      return !state.error;
    }
    function metric(container, label, value) { const node = make("div", "plc-metric"); node.append(make("span", "", label), make("strong", "", value)); container.append(node); }
    function facts(container, values) { const list = make("dl", "plc-facts"); for (const [label, value] of values) if (value !== "" && value != null) list.append(make("dt", "", label), make("dd", "", value)); container.append(list); }
    function observations(container, row) {
      if (row.health) facts(container, [["Project health", typeof row.health === "object" ? [row.health.label, sourceRef(row.health.source)].filter(Boolean).join(" · ") : row.health]]);
      for (const observation of row.observations || []) {
        const source = make("details", "plc-raw"); source.append(make("summary", "", `${observation.sources?.[0]?.sheet || "Supporting evidence"} · ${observation.name || observation.codename || "Project"}${observation.reportDate ? ` · ${observation.reportDate}` : " · undated"}`));
        facts(source, [["Source date basis", observation.reportDateBasis], ["Stage", observation.stage], ["Status", observation.status], ["Source conflict", observation.cancelled ? "Cancelled in this source" : ""], ...Object.entries(observation.milestones || {}).map(([label, value]) => [label, `${cellText(value)}${sourceRef(value?.source) ? ` · ${sourceRef(value.source)}` : ""}`]), ...Object.entries(observation.data || {}).map(([label, value]) => [label, cellText(value)])]); container.append(source);
      }
      if (row.conflicts?.length) facts(container, row.conflicts.map((conflict) => ["Conflicting source evidence", [conflict.reason, conflict.raw || conflict.value, sourceRef(conflict.source)].filter(Boolean).join(" · ")]));
    }
    function download(content, filename, type) {
      const url = root.URL.createObjectURL(new Blob([content], { type })), anchor = make("a"); anchor.href = url; anchor.download = filename; doc.body.append(anchor); anchor.click(); anchor.remove(); root.setTimeout(() => root.URL.revokeObjectURL(url), 1000);
    }
    function render() {
      if (!doc || !state.open || destroyed) return;
      ensureDialog(); const sameTab = renderedTab === state.tab, scrollTop = sameTab ? dialog.querySelector(".plc-body")?.scrollTop || 0 : 0;
      openRows = new Set([...dialog.querySelectorAll("[data-plc-row][open]")].map((node) => node.dataset.plcRow)); knownRows = new Set([...dialog.querySelectorAll("[data-plc-row]")].map((node) => node.dataset.plcRow)); openProducts = new Set([...dialog.querySelectorAll("[data-plc-product][open]")].map((node) => node.dataset.plcProduct)); renderedTab = state.tab; dialog.replaceChildren();
      const shell = make("div", "plc-shell"), header = make("header", "plc-header"), heading = make("div"); heading.append(make("span", "eyebrow", "Biweekly project collection"));
      const title = make("h2", "", "HyperX PLC updates"); title.id = "plcUpdatesTitle";
      const description = make("p", "", "Drop the biweekly Excel workbook. Reliable dates and project updates are saved automatically; uncertain details stay available for review."); description.id = "plcUpdatesDescription"; heading.append(title, description);
      const closeButton = button("×", "icon-button", close); closeButton.setAttribute("aria-label", "Close PLC updates"); closeButton.disabled = state.busy; header.append(heading, closeButton);
      const scrollBody = make("div", "plc-body"); errorNode = make("p", "plc-error", state.error); errorNode.setAttribute("role", "alert"); errorNode.hidden = !state.error; scrollBody.append(errorNode);
      const tabs = make("div", "plc-tabs"); tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "PLC update views");
      const queueCount = reviewCount(), tabItems = [["overview", "Drop workbook & updates"], ["review", `Needs review${queueCount ? ` (${queueCount})` : ""}`], ["history", "Update history"]];
      for (const [id, label] of tabItems) { const node = button(label, "quiet-button", () => { state.tab = id; render(); doc.getElementById(`plc-tab-${id}`)?.focus(); }); node.id = `plc-tab-${id}`; node.setAttribute("role", "tab"); node.setAttribute("aria-selected", String(state.tab === id)); node.setAttribute("aria-controls", `plc-panel-${id}`); node.tabIndex = state.tab === id ? 0 : -1; node.disabled = state.busy; node.addEventListener("keydown", (event) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || state.busy) return; event.preventDefault(); const index = tabItems.findIndex(([key]) => key === id), next = event.key === "Home" ? 0 : event.key === "End" ? tabItems.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabItems.length) % tabItems.length; state.tab = tabItems[next][0]; render(); doc.getElementById(`plc-tab-${state.tab}`)?.focus(); }); tabs.append(node); }
      scrollBody.append(tabs); body = make("section"); body.id = `plc-panel-${state.tab}`; body.setAttribute("role", "tabpanel"); body.setAttribute("aria-labelledby", `plc-tab-${state.tab}`); scrollBody.append(body);
      if (state.tab === "overview") renderOverview(); else if (state.tab === "history") renderHistory(); else renderReview();
      footer = make("footer", "plc-footer"); shell.append(header, scrollBody, footer); dialog.append(shell); scrollBody.scrollTop = scrollTop; renderFooter();
    }
    function renderOverview() {
      renderDropzone();
      const summary = sourceSummary(portfolio(), importer), metrics = make("div", "plc-metrics");
      metric(metrics, "Last workbook imported", summary.last?.importedAt ? dateLabel(summary.last.importedAt) : "No workbook yet"); metric(metrics, "Days since import", summary.freshness.importAgeDays ?? "—"); metric(metrics, "Next biweekly update", summary.freshness.nextDueDate || "After first import"); metric(metrics, "Needs review", reviewCount()); body.append(metrics);
      const receipt = state.result || (summary.latestRun ? { summary: summary.latestRun.summary, sharing: portfolio()?.plcLastSharing } : null);
      if (receipt) {
        const notice = make("section", `plc-receipt${receipt.sharing?.status === "pending" ? " is-pending" : ""}`); notice.setAttribute("role", "status"); notice.setAttribute("aria-live", "polite");
        notice.append(make("h3", "", receipt.summary?.duplicate || receipt.duplicate ? "This workbook is already collected" : "Your PLC update is collected"));
        const count = receipt.summary || {}, dateCount = count.datesUpdated ?? count.changed ?? 0, productCount = count.imported ?? count.collected ?? 0, queueCount = reviewCount(); notice.append(make("p", "", `${dateCount} date${dateCount === 1 ? "" : "s"} updated · ${productCount} matched project${productCount === 1 ? "" : "s"} collected${queueCount ? ` · ${queueCount} project${queueCount === 1 ? " needs" : "s need"} review` : ""}`));
        if (receipt.summary?.duplicate || receipt.duplicate) notice.append(make("p", "plc-note", "Identical content keeps its original timestamps and aging."));
        if (receipt.sharing?.message) notice.append(make("p", "plc-note", receipt.sharing.message));
        if ((receipt.sharing?.status === "pending" || receipt.sharing?.status === "local" && portfolio()?.plcSharePending?.patches?.length) && adapter.retrySharing) { const retry = button(state.busy ? "Saving…" : "Retry saving to master", "quiet-button", () => { void retrySharing(); }); retry.disabled = state.busy; notice.append(retry); }
        if (reviewCount()) { const review = button("Review uncertain details", "quiet-button", () => { state.tab = "review"; render(); }); review.disabled = state.busy; notice.append(review); }
        const changes = receipt.history || []; if (changes.length) { const recent = make("details", "plc-raw"); recent.append(make("summary", "", "Latest date changes")); const products = new Map(entries(portfolio()).map(({ product }) => [product.id, product])); facts(recent, changes.map((change) => [`${products.get(change.productId)?.name || change.productId} · ${importer.fieldLabels?.[change.field] || change.field}`, `${change.before || "TBD"} → ${change.after}\nUpdated ${dateLabel(change.at)} · ${importer.freshness({ changedAt: change.at }, localDay()).changeAgeDays ?? "unknown"} aging days`])); notice.append(recent); }
        body.append(notice);
      }
      const productsWithDates = entries(portfolio()).filter(({ product }) => product.plc || Object.keys(importer.fieldLabels || {}).some((field) => product[field]));
      body.append(make("p", "plc-source", "Every populated date keeps its own update timestamp and aging days. A fresh report can confirm an unchanged date without resetting when that date last changed."));
      if (!productsWithDates.length) { body.append(make("p", "plc-empty", "Drop the first workbook to collect project data and start date tracking.")); return; }
      body.append(make("h3", "plc-section-title", "Product dates & aging"));
      const list = make("div", "plc-projects");
      for (const { product, categoryName } of productsWithDates.slice().sort((a, b) => text(a.product.name).localeCompare(text(b.product.name)))) {
        const meta = product.plc || {}, age = importer.freshness(meta, localDay()), details = make("details", "plc-project"), title = make("summary"), identity = make("span"); details.dataset.plcProduct = product.id; details.open = openProducts.has(product.id); identity.append(make("strong", "", product.name || product.id), make("small", "", categoryName));
        title.append(identity, make("span", `plc-badge${age.status === "overdue" ? " is-overdue" : ""}`, meta.importedAt ? `Collected ${age.importAgeDays ?? "unknown"}d ago` : "View date ages")); details.append(title);
        const content = make("div", "plc-project-content");
        const fieldFacts = Object.keys(importer.fieldLabels || {}).filter((field) => product[field]).map((field) => {
          const stored = meta.fields?.[field], evidence = stored && !stored.supersededAt && text(stored.value) === text(product[field]) ? stored : {}, clock = adapter.getFieldAge?.(product.id, field) || importer.getFieldAge?.(product, field, localDay()) || { ...evidence, ...importer.freshness({ ...evidence, importedAt: evidence.observedAt }, localDay()) }, observedAge = clock.observedAgeDays ?? clock.importAgeDays ?? clock.ageDays;
          const lines = [product[field], `Updated ${clock.changedAt ? dateLabel(clock.changedAt) : "timestamp unknown"} · ${clock.changeAgeDays ?? "unknown"} aging days`];
          if (clock.observedAt) lines.push(`Last confirmed ${dateLabel(clock.observedAt)} · ${observedAge ?? "unknown"} aging days`);
          if (clock.acceptedAt) lines.push(`Saved to master ${dateLabel(clock.acceptedAt)} · ${clock.acceptedAgeDays ?? "unknown"} days`);
          if (clock.sourceReportDate || evidence.reportDate) lines.push(`Source report ${clock.sourceReportDate || evidence.reportDate} · ${clock.sourceAgeDays ?? "unknown"} days`);
          if (evidence.raw) lines.push(`Source: ${evidence.raw}`); if (sourceRef(evidence.source)) lines.push(sourceRef(evidence.source));
          return [importer.fieldLabels[field], lines.join("\n")];
        });
        if (fieldFacts.length) { content.append(make("h3", "plc-section-title", "Date timestamps")); facts(content, fieldFacts); }
        if (meta.importedAt) { const evidence = make("details", "plc-raw"); evidence.append(make("summary", "", "Collection & source details")); facts(evidence, [["Last collected", dateLabel(meta.importedAt)], ["Days since collection", age.importAgeDays], ["Source report", meta.reportDate], ["Source report basis", meta.reportDateBasis], ["Source report age", age.ageDays], ["Next report due", age.nextDueDate], ["Source workbook", meta.sourceFile]]); content.append(evidence); }
        for (const row of meta.rows || []) { const source = make("details", "plc-raw"); source.append(make("summary", "", `${row.name || row.codename || "Project evidence"}${row.stage ? ` · ${row.stage}` : ""}${row.status ? ` · ${row.status}` : ""}`)); facts(source, [["Section", row.section], ["Stage", row.stage], ["Status", row.status], ["Forecast", row.forecast], ["Project identity", row.projectId], ...Object.entries(row.milestones || {}).map(([key, value]) => [key.replace(/([A-Z])/g, " $1"), `${cellText(value)}${sourceRef(value?.source) ? ` · ${sourceRef(value.source)}` : ""}`]), ...Object.entries(row.data || {}).map(([label, value]) => [label, cellText(value)])]); observations(source, row); content.append(source); }
        details.append(content); list.append(details);
      }
      body.append(list);
    }
    function renderDropzone() {
      const drop = make("div", "plc-dropzone"); drop.setAttribute("aria-busy", String(state.busy)); drop.append(make("strong", "", state.busy ? state.phase || "Collecting updates…" : "Drop your biweekly PLC Excel workbook here"), make("p", "", "Excel .xlsx · Products match automatically. Reliable dates are saved with timestamps and aging days."));
      fileInput = make("input", "visually-hidden"); fileInput.type = "file"; fileInput.accept = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; fileInput.setAttribute("aria-label", "Select a PLC Excel workbook"); fileInput.disabled = state.busy;
      fileInput.addEventListener("change", () => { void loadFiles(fileInput.files); });
      const choose = button(state.dataset ? "Choose another workbook" : "Choose workbook", "primary-button", () => fileInput.click()); choose.disabled = state.busy; drop.append(fileInput, choose);
      drop.addEventListener("dragover", (event) => { if (!hasFileDrag(event)) return; event.preventDefault(); event.stopPropagation(); if (!state.busy) drop.classList.add("is-dragging"); }); drop.addEventListener("dragleave", () => drop.classList.remove("is-dragging")); drop.addEventListener("drop", (event) => { if (!hasFileDrag(event)) return; event.preventDefault(); event.stopPropagation(); drop.classList.remove("is-dragging"); if (!state.busy) void loadFiles(event.dataTransfer.files); }); body.append(drop);
      if (state.dataset && !state.busy) { const retry = button("Retry collecting this workbook", "quiet-button", () => { void apply(); }); body.append(retry); }
    }
    function renderReview() {
      if (!state.plan?.items?.length) { body.append(make("p", "plc-empty", "No uncertain details to review. Drop the next workbook on the first tab when it is ready.")); return; }
      const dataset = state.plan.dataset || {}, meta = dataset.metadata || {}, sheets = meta.sheets || []; body.append(make("p", "plc-source", "Reliable updates have already been collected. Resolve only the product names or dates that need your judgment; other updates continue independently."));
      if (sheets.length) { const inventory = make("details", "plc-raw"); inventory.append(make("summary", "", "Workbook sheet inventory and authority")); facts(inventory, sheets.map((sheet) => [sheet.name, `${sheet.role || "Source"}${sheet.hidden ? " · hidden" : ""} · ${sheet.rowCount ?? "unknown"} rows`])); body.append(inventory); }
      const metrics = make("div", "plc-metrics"), items = state.plan.items || []; metric(metrics, "Source projects", items.length); metric(metrics, "Matched automatically", items.filter((item) => item.match?.status === "matched" && !state.selections[item.key]).length); metric(metrics, "Projects with date changes", items.filter((item) => item.fields?.some((field) => field.status === "update")).length); metric(metrics, "Projects to review", items.filter((item) => ["review", "unmatched"].includes(item.action) || item.match?.status !== "matched").length); body.append(metrics);
      const diagnostics = [...(dataset.diagnostics || []), ...(state.plan.diagnostics || [])];
      if (diagnostics.length) { const warnings = make("details", "plc-raw"); warnings.append(make("summary", "", `${diagnostics.length} source integrity notes`)); for (const note of diagnostics) warnings.append(make("p", "plc-source", typeof note === "string" ? note : [note.code, note.message || note.reason, sourceRef(note.source)].filter(Boolean).join(" · "))); body.append(warnings); }
      body.append(make("p", "plc-source", "Blank values preserve saved dates. Approximate, conflicting, shared merged-cell, or stale dates stay in review. Only explicit launch dates update general availability. Select an existing product for every uncertain identity you want to collect."));
      const list = make("div", "plc-projects"); for (const item of items) renderItem(item, list); body.append(list);
    }
    function renderItem(item, list) {
      const row = item.row || {}, skipped = state.skippedKeys.has(item.key), productId = state.selections[item.key] || item.matchedProductId || item.match?.productId || "", product = entries(portfolio()).find((entry) => entry.product.id === productId)?.product;
      const details = make("details", "plc-project"); details.dataset.plcRow = item.key; const title = make("summary"), identity = make("span"); identity.append(make("strong", "", row.name || row.codename || "Unnamed project"), make("small", "", [row.section, row.stage, row.status, product && `Portfolio: ${product.name}`].filter(Boolean).join(" · ")));
      const action = skipped ? "Skipped" : item.action === "update" ? "Date update" : item.action === "unchanged" ? "Already current" : item.action === "stale" ? "Older source" : item.action === "unmatched" ? "Match needed" : "Review needed";
      title.append(identity, make("span", `plc-badge${["review", "unmatched", "stale"].includes(item.action) ? " is-review" : ""}`, action)); details.append(title); details.open = knownRows.has(item.key) ? openRows.has(item.key) : item.action === "update" && !skipped;
      const content = make("div", "plc-project-content"), label = make("label", "plc-match", "Portfolio product"), select = make("select"); select.setAttribute("aria-label", `Match ${row.name || row.codename || "project"} to portfolio product`);
      const initial = make("option", "", "Choose an existing product…"); initial.value = ""; select.append(initial); const skip = make("option", "", "Skip this project"); skip.value = "skip"; select.append(skip);
      const candidates = new Map((item.match?.candidates || []).map((candidate) => [candidate.productId, candidate]));
      const products = entries(portfolio()).sort((a, b) => Number(candidates.has(b.product.id)) - Number(candidates.has(a.product.id)) || text(a.product.name).localeCompare(text(b.product.name)));
      for (const entry of products) { const candidate = candidates.get(entry.product.id), option = make("option", "", `${candidate ? "Suggested · " : ""}${entry.product.name || entry.product.id} · ${entry.categoryName}${entry.product.codename ? ` · ${entry.product.codename}` : ""}${candidate?.reason ? ` · ${candidate.reason}` : ""}`); option.value = entry.product.id; select.append(option); }
      select.value = skipped ? "skip" : productId; select.disabled = state.busy; select.addEventListener("change", () => chooseMatch(item.key, select.value)); label.append(select); content.append(label, make("p", "plc-note", item.match?.reason || ""));
      const shell = make("div", "plc-table-shell"), table = make("table", "plc-fields"), head = make("thead"), headRow = make("tr"); for (const name of ["Milestone", "Current PPC", "Source evidence", "Apply or resolve"]) headRow.append(make("th", "", name)); head.append(headRow); table.append(head); const tbody = make("tbody");
      for (const field of item.fields || []) {
        const tr = make("tr"), incoming = make("td", "", field.incoming || "No exact date"), control = make("td"); incoming.append(make("small", "", `${field.raw ? `Raw: ${text(field.raw)}` : ""}${sourceRef(field.source) ? `\n${sourceRef(field.source)}` : ""}${field.reason ? `\n${field.reason}` : ""}`));
        if (field.status === "update") { const choice = make("label", "plc-field-choice"), checkbox = make("input"); checkbox.type = "checkbox"; checkbox.checked = !(state.skippedFields[item.key] || []).includes(field.field); checkbox.disabled = skipped || !productId || state.busy; checkbox.setAttribute("aria-label", `Apply ${field.label || field.field} for ${row.name || row.codename}`); checkbox.addEventListener("change", () => { const excluded = new Set(state.skippedFields[item.key] || []); if (checkbox.checked) excluded.delete(field.field); else excluded.add(field.field); state.skippedFields[item.key] = [...excluded]; renderFooter(); }); choice.append(checkbox, make("span", "", "Apply exact source date")); control.append(choice); }
        else if (field.status === "review") { const resolution = make("label", "plc-resolution", "Optional verified exact date"), input = make("input"); input.type = "date"; input.value = state.resolutions[item.key]?.[field.field] || ""; input.disabled = skipped || !productId || state.busy; input.setAttribute("aria-label", `Verified ${field.label || field.field} for ${row.name || row.codename}`); input.addEventListener("change", () => { state.resolutions[item.key] ||= {}; if (input.value) state.resolutions[item.key][field.field] = input.value; else delete state.resolutions[item.key][field.field]; renderFooter(); }); resolution.append(input, make("small", "", "Leave blank to preserve PPC and retain source evidence.")); control.append(resolution); }
        else control.append(make("span", "plc-note", field.status === "unchanged" ? "Date unchanged" : field.status === "stale" ? "Older source · PPC preserved" : "PPC preserved"));
        const current = make("td", "", field.current || "TBD"); if (field.current && product) { const clock = adapter.getFieldAge?.(product.id, field.field) || importer.getFieldAge?.(product, field.field, localDay()); if (clock) current.append(make("small", "", `Updated ${clock.changedAt ? dateLabel(clock.changedAt) : "timestamp unknown"}\n${clock.changeAgeDays ?? "unknown"} aging days`)); }
        tr.append(make("td", "", field.label || importer.fieldLabels?.[field.field] || field.field), current, incoming, control); tbody.append(tr);
      }
      table.append(tbody); shell.append(table); content.append(shell);
      const evidence = make("details", "plc-raw"); evidence.append(make("summary", "", "All project status and milestone evidence")); facts(evidence, [["Source project key", row.key], ["Project ID", row.projectId], ["Codename", row.codename], ["Forecast", row.forecast], ...Object.entries(row.milestones || {}).map(([key, value]) => [key.replace(/([A-Z])/g, " $1"), `${cellText(value)}${sourceRef(value?.source) ? ` · ${sourceRef(value.source)}` : ""}`]), ...Object.entries(row.data || {}).map(([key, value]) => [key, cellText(value)])]); observations(evidence, row); content.append(evidence); details.append(content); list.append(details);
    }
    function renderHistory() {
      const history = historyRows(portfolio()), imports = portfolio()?.plcImports || [], tools = make("div", "plc-history-tools"); tools.append(make("p", "plc-note", `${imports.length} imports · ${history.length} milestone changes. Workbook names, raw evidence, and cell references are retained.`));
      tools.append(button("Export JSON", "quiet-button", () => download(JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), collection: portfolio()?.plcCollection || null, review: portfolio()?.plcReview || null, imports, history }, null, 2), `ppc-plc-history-${localDay()}.json`, "application/json")), button("Export CSV", "quiet-button", () => download(historyCsv(portfolio()), `ppc-plc-history-${localDay()}.csv`, "text/csv;charset=utf-8"))); body.append(tools);
      const collection = portfolio()?.plcCollection;
      if (collection) { const inventory = make("details", "plc-raw"); inventory.append(make("summary", "", "Latest workbook and complete source inventory")); facts(inventory, [["Workbook", collection.metadata?.fileName], ["Imported", dateLabel(collection.importedAt)], ["Source report", collection.metadata?.reportDate], ["Project records", collection.primaryRows?.length], ["Supporting records", collection.supportingRows?.length]]); const sheets = collection.metadata?.sheets || []; if (sheets.length) facts(inventory, sheets.map((sheet) => [sheet.name, `${sheet.role || "Source"} · ${sheet.rowCount ?? "unknown"} rows${sheet.hidden ? " · hidden" : ""}`])); inventory.append(make("p", "plc-source", "The JSON export includes the full latest source collection, review queue, and retained history.")); body.append(inventory); }
      if (imports.length) { body.append(make("h3", "plc-section-title", "Workbook collection log")); const runs = make("div", "plc-projects"); for (const run of imports.slice().reverse()) { const details = make("details", "plc-project"), title = make("summary"), identity = make("span"); identity.append(make("strong", "", run.sourceFile || "PLC workbook"), make("small", "", `${run.reportDate || "Unknown report date"} · ${run.reportDateBasis || ""}`)); title.append(identity, make("span", "plc-badge", dateLabel(run.at))); details.append(title); const content = make("div", "plc-project-content"); facts(content, [["Import result", text(run.summary)], ["Source integrity notes", text(run.diagnostics)], ["Fingerprint", run.fingerprint]]); for (const row of run.rows || []) { const evidence = make("details", "plc-raw"); evidence.append(make("summary", "", `${row.name || row.key || "Source project"} · ${row.action || "observation"}`)); facts(evidence, [["Source key", row.key], ["Portfolio product", row.productId || "Unmatched"], ...(row.fields || []).map((field) => [importer.fieldLabels?.[field.field] || field.field, [field.status, field.raw, field.reason, sourceRef(field.source)].filter(Boolean).join(" · ")])]); if (row.observation) { const observation = row.observation; facts(evidence, [["Section", observation.section], ["Stage", observation.stage], ["Status", observation.status], ["Forecast", observation.forecast], ["Project identity", observation.projectId], ["Codename", observation.codename], ["Source cells", (observation.sources || []).map(sourceRef).join(" · ")], ...Object.entries(observation.milestones || {}).map(([label, value]) => [label.replace(/([A-Z])/g, " $1"), `${cellText(value)}${sourceRef(value?.source) ? ` · ${sourceRef(value.source)}` : ""}`]), ...Object.entries(observation.data || {}).map(([label, value]) => [label, cellText(value)])]); observations(evidence, observation); } content.append(evidence); } details.append(content); runs.append(details); } body.append(runs); }
      if (!history.length) { body.append(make("p", "plc-empty", imports.length ? "No PPC milestone date changes were accepted. Source observations and review outcomes are shown in the collection log." : "No PLC update history yet. Evidence and milestone changes will appear here after you collect a workbook.")); return; }
      body.append(make("h3", "plc-section-title", "Milestone change history"));
      const list = make("div", "plc-projects");
      for (const event of history.slice().reverse().slice(0, 500)) { const details = make("details", "plc-project"), title = make("summary"), identity = make("span"); identity.append(make("strong", "", event.productName), make("small", "", [event.category, event.field && (importer.fieldLabels?.[event.field] || event.field), event.reportDate].filter(Boolean).join(" · "))); title.append(identity, make("span", "plc-badge", dateLabel(event.at || event.importedAt))); details.append(title); const content = make("div", "plc-project-content"); facts(content, Object.entries(event).map(([key, value]) => [key.replace(/([A-Z])/g, " $1"), text(value)])); details.append(content); list.append(details); }
      body.append(list); if (history.length > 500) body.append(make("p", "plc-source", "Showing the latest 500 records. Exports include all retained records."));
    }
    function renderFooter() {
      if (!footer) return; footer.replaceChildren();
      if (state.tab === "review" && state.plan?.items?.length) {
        const eligible = (state.plan.items || []).filter((item) => state.skippedKeys.has(item.key) || (!state.skippedKeys.has(item.key) && (state.selections[item.key] || item.matchedProductId || item.match?.productId) && (state.selections[item.key] || Object.keys(state.resolutions[item.key] || {}).length || item.fields?.some((field) => field.status === "update")))).length;
        footer.append(make("p", "plc-note", `${eligible} reviewed project${eligible === 1 ? "" : "s"} ready. Remaining uncertain details stay in the queue for later.`));
        const applyButton = button(state.busy ? "Saving…" : "Save reviewed updates", "primary-button", () => { void apply(); }); applyButton.disabled = state.busy || !eligible; footer.append(applyButton);
      } else footer.append(make("p", "plc-note", "One workbook every two weeks · Updated dates, timestamps, and source evidence are collected automatically."));
      const closeButton = button("Done", "quiet-button", close); closeButton.disabled = state.busy; footer.append(closeButton);
    }
    function refresh() {
      if (destroyed) return;
      if (!state.busy && !state.dataset) rebuild();
      const summary = sourceSummary(portfolio(), importer), setting = doc?.getElementById("plcSettingsStatus");
      if (setting) setting.textContent = summary.last ? `Collected ${dateLabel(summary.last.importedAt)} · ${summary.freshness.importAgeDays ?? "unknown"} aging days${reviewCount() ? ` · ${reviewCount()} projects need review` : ""}` : "Drop in the biweekly PLC workbook. Reliable milestone dates and their timestamps update automatically.";
      if (state.open && !state.busy) render();
    }
    const listeners = [];
    if (doc) for (const [id, tab] of [["settingsPlcUpdates", "overview"], ["importPlcReport", "overview"]]) { const node = doc.getElementById(id); if (node) { const listener = () => open({ tab }); node.addEventListener("click", listener); listeners.push(() => node.removeEventListener("click", listener)); } }
    function hasFileDrag(event) { return Array.from(event.dataTransfer?.types || []).includes("Files") || Boolean(event.dataTransfer?.files?.length); }
    function hasWorkbookDrag(event) { return hasFileDrag(event) && (Array.from(event.dataTransfer?.files || []).some((file) => /\.xlsx$/i.test(file.name || "")) || Array.from(event.dataTransfer?.items || []).some((item) => item.kind === "file" && item.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")); }
    if (doc) {
      const dragover = (event) => { if (event.defaultPrevented || !hasWorkbookDrag(event)) return; event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = state.busy ? "none" : "copy"; if (!state.busy) doc.body.classList.add("plc-workbook-dragging"); };
      const dragleave = (event) => { if (!event.relatedTarget || !doc.documentElement.contains(event.relatedTarget)) doc.body.classList.remove("plc-workbook-dragging"); };
      const drop = (event) => { doc.body.classList.remove("plc-workbook-dragging"); if (event.defaultPrevented || !hasWorkbookDrag(event)) return; event.preventDefault(); if (state.busy) return; if (!state.open) open(); void loadFiles(event.dataTransfer.files); };
      for (const [name, listener] of [["dragover", dragover], ["dragleave", dragleave], ["drop", drop], ["dragend", dragleave]]) { doc.addEventListener(name, listener); listeners.push(() => doc.removeEventListener(name, listener)); }
      listeners.push(() => doc.body.classList.remove("plc-workbook-dragging"));
    }
    const onRender = () => refresh(); root.addEventListener?.("portfolio:render", onRender); refresh();
    return Object.freeze({ open, close, loadFile, loadFiles, chooseMatch, apply, retrySharing, refresh, getState: () => ({ ...state, selections: { ...state.selections }, resolutions: JSON.parse(JSON.stringify(state.resolutions)), skippedKeys: [...state.skippedKeys] }), destroy() { destroyed = true; fileGeneration += 1; for (const remove of listeners) remove(); root.removeEventListener?.("portfolio:render", onRender); dialog?.remove(); } });
  }
  root.PortfolioPlcUI = Object.freeze({ createController, init(options) { active?.destroy(); active = createController(options); return active; }, open(options) { return active?.open(options); }, refresh() { active?.refresh(); }, getController() { return active; }, sourceSummary, historyRows, historyCsv, csvCell });
})(typeof globalThis !== "undefined" ? globalThis : window);
