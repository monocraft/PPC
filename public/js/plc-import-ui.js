/* Biweekly PLC collection, review, source freshness, and traceable milestone history. */
(function (root) {
  "use strict";
  let active = null;
  const text = (value) => value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const dateLabel = (value) => { if (!value) return "Unknown"; const raw = text(value); if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw; const date = new Date(raw); return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" }) : raw; };
  const entries = (portfolio) => (portfolio?.categories || []).flatMap((category) => (category.board?.products || []).map((product) => ({ product, categoryId: category.id, categoryName: category.name || category.id })));
  const colorVariants = (product) => (product?.variantGroups || []).filter((group) => group.type === "color").flatMap((group) => group.items || []);
  const colorwayName = (variant) => [variant?.colorName, variant?.colorName2].filter(Boolean).join(" / ") || variant?.label || variant?.code || "Colorway";
  function productDateEntries(portfolio, importer = root.PLCImporter) {
    return entries(portfolio).flatMap((entry) => [entry, ...colorVariants(entry.product).flatMap((variant) => {
      const project = importer?.getVariantProject?.(entry.product, variant.id) || entry.product.plc?.variantProjects?.[variant.id];
      if (!project) return [];
      const name = colorwayName(variant), product = { ...entry.product, name: `${entry.product.name || entry.product.id} · ${name}`, ...Object.fromEntries(Object.keys(importer?.fieldLabels || {}).map((field) => [field, project.fields?.[field]?.value || ""])), plc: project };
      return [{ ...entry, product, parentProduct: entry.product, variantId: variant.id, variantName: name }];
    })]);
  }
  const sourceRef = (source) => source ? [source.sheet, source.cell || source.coordinate, source.mergeRange && `merged ${source.mergeRange}`, source.inherited && "inherited cell", source.crossProduct && "shared across products"].filter(Boolean).join(" · ") : "";
  const cellText = (value) => typeof value === "object" && value ? text(value.raw ?? value.value ?? value.text ?? value) : text(value);
  const searchText = (value) => text(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/\s+/g, " ").trim();
  function browseRows(rows, { query = "", category = "all", status = "all", page = 0, pageSize = 15 } = {}) {
    const words = searchText(query).split(" ").filter(Boolean), filtered = rows.filter((row) => { if (category !== "all" && row.categoryId !== category || status !== "all" && !(row.statuses || []).includes(status)) return false; const value = words.length ? searchText(row.searchText) : ""; return words.every((word) => value.includes(word)); });
    const size = Math.max(1, Math.min(50, Number.isFinite(Number(pageSize)) ? Math.floor(Number(pageSize)) : 15)), pages = Math.max(1, Math.ceil(filtered.length / size)), currentPage = Math.max(0, Math.min(pages - 1, Number.isFinite(Number(page)) ? Math.floor(Number(page)) : 0)), start = currentPage * size;
    return { rows: filtered.slice(start, start + size), filtered, total: filtered.length, page: currentPage, pages, pageSize: size, start: filtered.length ? start + 1 : 0, end: Math.min(start + size, filtered.length) };
  }
  function dateSuggestions(field, { cancelled = false, conflicts = [] } = {}) {
    const protectedDate = Boolean(field.protected || field.newerMaster) || field.status === "stale" || /older source|newer accepted|accepted date change|local date edit|edited after|GA.*after|dates conflict/i.test(field.reason || "");
    const candidates = field.candidates?.length ? field.candidates : field.incoming ? [{ kind: field.period ? "quarter" : field.kind, value: field.incoming, period: field.period, region: field.region, raw: field.raw }] : [], choices = new Map();
    const supportedCandidate = (candidate) => /^\d{4}-\d{2}-\d{2}$/.test(candidate.value || "") && (candidate.kind === "exact" || candidate.kind === "quarter" && candidate.period);
    const sourceConflict = conflicts.some((conflict) => !conflict.field || conflict.field === field.field);
    const ambiguous = sourceConflict || candidates.some((candidate) => !supportedCandidate(candidate)) || /conflict|different value|different FFS|status notes.*differ|multiple source|scope changed|regional|supporting|merged|formula|inherits|exact day/i.test(field.reason || "") || Boolean(field.source?.crossProduct || field.source?.formula || field.source?.currentFfsFromOtherColumn);
    for (const candidate of candidates) {
      if (!supportedCandidate(candidate)) continue;
      const id = `${candidate.value}|${JSON.stringify(candidate.period || null)}`, existing = choices.get(id), region = candidate.region || "";
      if (existing) { if (region && !existing.regions.includes(region)) existing.regions.push(region); continue; }
      choices.set(id, { id, value: candidate.value, ...(candidate.period ? { period: candidate.period } : {}), label: root.PLCImporter?.dateLabel?.(candidate.value, candidate.period) || candidate.period?.label || candidate.value, regions: region ? [region] : [], raw: candidate.raw || field.raw || "", source: candidate.source || field.source, reason: field.reason || candidate.reason || "Explicit date from source", blocked: cancelled || protectedDate });
    }
    // Review exceptions remain selectable individually; only an eligible update can enter the clear batch.
    return [...choices.values()].map((choice) => ({ ...choice, clear: field.status === "update" && choices.size === 1 && !ambiguous && !choice.blocked, region: choice.regions.join(", ") }));
  }
  function matchingProducts(products, item, query = "", limit = 8) {
    const words = searchText(query).split(" ").filter(Boolean), candidates = new Map((item.match?.candidates || []).map((candidate) => [candidate.productId, candidate]));
    return products.filter((entry) => { const value = searchText([entry.product.name, entry.product.codename, entry.product.id, entry.categoryName].join(" ")); return words.length ? words.every((word) => value.includes(word)) : candidates.has(entry.product.id); }).sort((a, b) => (candidates.get(b.product.id)?.score || 0) - (candidates.get(a.product.id)?.score || 0) || text(a.product.name).localeCompare(text(b.product.name))).slice(0, Math.max(1, Math.min(8, limit))).map((entry) => ({ ...entry, candidate: candidates.get(entry.product.id) || null }));
  }
  function manualDateResolution(draft, importer = root.PLCImporter) {
    if (draft?.mode === "quarter") {
      const quarter = text(draft.quarter), year = text(draft.year);
      if (!/^[1-4]$/.test(quarter) || !/^\d{4}$/.test(year)) throw new Error("Choose Q1–Q4 and enter a four-digit year.");
      if (Number(year) < 1900 || Number(year) > 9999) throw new Error("Enter a calendar quarter with a year from 1900 to 9999.");
      const parsed = importer?.parseDate?.(`Q${quarter} ${year}`, { quarterBasis: "calendar" });
      if (parsed?.kind !== "quarter" || !parsed.period || !parsed.value || !importer.normalizePeriod?.(parsed.period, parsed.value)) throw new Error("Enter a calendar quarter with a year from 1900 to 9999.");
      return { value: parsed.value, period: JSON.parse(JSON.stringify(parsed.period)) };
    }
    if (draft?.mode !== "exact" || !/^\d{4}-\d{2}-\d{2}$/.test(text(draft.day))) throw new Error("Choose a valid exact calendar day.");
    if (Number(draft.day.slice(0, 4)) < 1900) throw new Error("Enter an exact date with a four-digit year from 1900 to 9999.");
    const parsed = importer?.parseDate?.(draft.day);
    if (parsed?.kind !== "exact" || parsed.value !== draft.day) throw new Error("Choose a valid exact calendar day.");
    return parsed.value;
  }
  function reviewScrollPosition(previousSelection, selection, scrollTop, listScrollTop = 0) {
    if (previousSelection === selection) return scrollTop;
    return selection ? 0 : listScrollTop;
  }
  function reviewRowActivation(event, row) {
    if (event.type === "keydown") return event.target === row && ["Enter", " "].includes(event.key);
    return event.type === "click" && !event.target?.closest?.("button,a,input,select,textarea,summary");
  }
  function csvCell(value) {
    const raw = text(value), safe = /^[\s\u0000-\u001f]*[=+@-]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replace(/"/g, '""')}"`;
  }
  function historyRows(portfolio) {
    return entries(portfolio).flatMap(({ product, categoryName }) => (product.plc?.history || []).map((event) => { const variant = event.variantId ? colorVariants(product).find((item) => item.id === event.variantId) : null, name = event.variantName || (variant && colorwayName(variant)); return { eventType: "date-change", productId: product.id, category: categoryName, sourceFile: product.plc.sourceFile, ...event, productName: `${product.name || product.id}${name ? ` · ${name}` : ""}` }; }));
  }
  function importRows(portfolio) {
    const products = new Map(entries(portfolio).map(({ product }) => [product.id, product]));
    return (portfolio?.plcImports || []).flatMap((run) => (run.rows?.length ? run.rows : [{}]).map((row) => ({ eventType: run.type === "review" ? "review-resolution" : "import-observation", at: run.at, reportDate: run.reportDate, sourceFile: run.sourceFile, productId: row.productId || "", productName: row.variantId ? `${products.get(row.productId)?.name || row.name || row.productId} · ${row.variantName || row.variantId}` : row.name || "", variantId: row.variantId || "", variantName: row.variantName || "", field: (row.fields || []).map((field) => field.field).join("; "), reason: row.action || "", source: { fields: row.fields || [], observation: row.observation || null }, summary: run.summary })));
  }
  function historyCsv(portfolio) {
    const keys = ["eventType", "productId", "productName", "variantId", "variantName", "category", "at", "importedAt", "reportDate", "field", "before", "after", "beforePeriod", "afterPeriod", "sourceFile", "reason", "source", "summary"];
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
    let dialog = null, returnFocus = null, body = null, footer = null, errorNode = null, fileInput = null, fileGeneration = 0, destroyed = false, renderedTab = "", renderedReviewSelection = "";
    const browsers = Object.fromEntries(["dates", "review", "history"].map((tab) => [tab, { query: "", category: "all", status: "all", page: 0, selected: "", listScrollTop: 0, editorKeys: [] }]));
    let state = { open: false, tab: "overview", dataset: null, plan: null, reportDate: "", selections: {}, variantAssignments: {}, variantDrafts: {}, separateProducts: {}, resolutions: {}, manualDates: {}, createProducts: {}, createDrafts: {}, matchQueries: {}, matchOpen: {}, skippedKeys: new Set(), skippedFields: {}, busy: false, phase: "", error: "", result: null };
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
      state.open = true; state.tab = tab === "import" ? "overview" : ["overview", "dates", "review", "history"].includes(tab) ? tab : "overview"; state.error = "";
      if (!state.dataset) rebuild();
      if (doc) { ensureDialog(); render(); if (!dialog.open) dialog.showModal(); dialog.querySelector("button")?.focus({ preventScroll: true }); }
      return true;
    }
    function rebuild() {
      const selected = { selections: state.selections, variantAssignments: state.variantAssignments, createProducts: state.createProducts };
      state.plan = state.dataset ? importer.buildPlan(state.dataset, portfolio(), { reportDate: state.reportDate || localDay(), reportDateBasis: "Import date", ...selected }) : importer.buildReviewPlan?.(portfolio(), selected) || null;
    }
    function resetChoices() { state.selections = {}; state.variantAssignments = {}; state.variantDrafts = {}; state.separateProducts = {}; state.resolutions = {}; state.manualDates = {}; state.createProducts = {}; state.createDrafts = {}; state.matchQueries = {}; state.matchOpen = {}; state.skippedKeys = new Set(); state.skippedFields = {}; }
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
      delete state.createProducts[key];
      delete state.variantAssignments[key]; delete state.resolutions[key]; delete state.manualDates[key]; delete state.skippedFields[key];
      if (productId && productId !== "skip") state.matchOpen[key] = false;
      if (productId === "skip") { state.skippedKeys.add(key); delete state.selections[key]; }
      else { state.skippedKeys.delete(key); if (productId) state.selections[key] = productId; else delete state.selections[key]; }
      try { rebuild(); state.error = ""; } catch (error) { state.error = error.message; }
      render(); if (doc && productId && productId !== "skip") focusBrowserKey(`match-disclosure-${key}`);
    }
    function chooseVariant(key, assignment) {
      const item = state.plan?.items?.find((entry) => entry.key === key);
      if (state.busy || !item || item.row?.cancelled || state.skippedKeys.has(key)) return false;
      const previous = state.variantAssignments[key], previousSelection = state.selections[key];
      state.variantAssignments[key] = { ...assignment };
      delete state.createProducts[key];
      state.selections[key] = assignment.productId;
      try { rebuild(); setError(""); } catch (error) { if (previous) state.variantAssignments[key] = previous; else delete state.variantAssignments[key]; if (previousSelection) state.selections[key] = previousSelection; else delete state.selections[key]; rebuild(); setError(error.message); render(); return false; }
      delete state.resolutions[key]; delete state.manualDates[key]; delete state.skippedFields[key]; state.separateProducts[key] = false;
      render(); return true;
    }
    function chooseSeparateProduct(key, confirmed = true) {
      const item = state.plan?.items?.find((entry) => entry.key === key);
      if (state.busy || !item || item.row?.cancelled) return false;
      state.separateProducts[key] = Boolean(confirmed); delete state.createProducts[key];
      if (confirmed) { delete state.variantAssignments[key]; delete state.resolutions[key]; }
      rebuild(); render(); return true;
    }
    function selectSuggestion(key, field, suggestion, { rerender = true } = {}) {
      if (state.busy || suggestion?.blocked || !suggestion?.value) return false;
      if (state.plan?.items?.find((item) => item.key === key)?.variantBindingNeeded) { setError("Choose the colorway before selecting its date."); return false; }
      state.resolutions[key] ||= {}; state.resolutions[key][field] = suggestion.period ? { value: suggestion.value, period: JSON.parse(JSON.stringify(suggestion.period)) } : suggestion.value;
      state.skippedFields[key] = (state.skippedFields[key] || []).filter((value) => value !== field); if (rerender) render(); return true;
    }
    function setManualDate(key, fieldName, draft) {
      if (state.busy) return false;
      const item = state.plan?.items?.find((entry) => entry.key === key), field = item?.fields?.find((entry) => entry.field === fieldName);
      if (!item || !field || !["review", "update"].includes(field.status) || item.row?.cancelled || state.skippedKeys.has(key)) { setError(field?.status === "stale" ? "Older sources cannot overwrite a newer date." : "This source date cannot be selected for review."); return false; }
      if (!(state.selections[key] || item.matchedProductId || item.match?.productId)) { setError("Match the source to a product before selecting its verified date."); return false; }
      if (item.variantBindingNeeded) { setError("Choose the colorway before selecting its verified date."); return false; }
      let resolution;
      try { resolution = manualDateResolution(draft, importer); } catch (error) { setError(error.message); return false; }
      state.resolutions[key] ||= {}; state.resolutions[key][fieldName] = resolution;
      state.manualDates[key] ||= {}; state.manualDates[key][fieldName] = { ...draft, open: true };
      state.skippedFields[key] = (state.skippedFields[key] || []).filter((value) => value !== fieldName); setError(""); render(); return true;
    }
    function keepDate(key, field) { if (state.busy || state.plan?.items?.find((item) => item.key === key)?.variantBindingNeeded) return false; delete state.resolutions[key]?.[field]; state.skippedFields[key] = [...new Set([...(state.skippedFields[key] || []), field])]; render(); return true; }
    function confirmCreate(key, draft, confirmed = true) {
      if (state.busy) return false;
      if (confirmed && state.plan?.items?.find((item) => item.key === key)?.colorway?.detected && !state.separateProducts[key]) { setError("Attach this colorway to its parent product. Choose different hardware only when a separate product is needed."); return false; }
      state.createDrafts[key] = { ...draft }; const previous = state.createProducts[key];
      if (confirmed) state.createProducts[key] = { name: text(draft.name).trim(), codename: text(draft.codename).trim(), categoryId: draft.categoryId, ...(state.separateProducts[key] ? { separateProduct: true } : {}) }; else delete state.createProducts[key];
      delete state.selections[key]; delete state.variantAssignments[key]; state.skippedKeys.delete(key);
      try { rebuild(); setError(""); } catch (error) { if (previous) state.createProducts[key] = previous; else delete state.createProducts[key]; rebuild(); setError(error.message); render(); return false; }
      render(); return true;
    }
    function choices() {
      const deferredFields = state.plan?.review ? Object.fromEntries((state.plan.items || []).map((item) => [item.key, (item.fields || []).filter((field) => ["review", "update"].includes(field.status) && !state.resolutions[item.key]?.[field.field] && !(state.skippedFields[item.key] || []).includes(field.field)).map((field) => field.field)]).filter(([, fields]) => fields.length)) : {};
      return { selections: { ...state.selections }, variantAssignments: JSON.parse(JSON.stringify(state.variantAssignments)), resolutions: JSON.parse(JSON.stringify(state.resolutions)), createProducts: JSON.parse(JSON.stringify(state.createProducts)), deferredFields, skippedKeys: [...state.skippedKeys], skippedFields: JSON.parse(JSON.stringify(state.skippedFields)) };
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
    function fieldClock(product, field, variantId = "", parentProduct = product) {
      if (variantId) return importer.getVariantFieldAge?.(parentProduct, variantId, field, localDay()) || importer.getFieldAge?.(product, field, localDay()) || {};
      const stored = product.plc?.fields?.[field], evidence = stored && !stored.supersededAt && text(stored.value) === text(product[field]) ? stored : {};
      return adapter.getFieldAge?.(product.id, field) || importer.getFieldAge?.(product, field, localDay()) || { ...evidence, ...importer.freshness({ ...evidence, importedAt: evidence.observedAt }, localDay()) };
    }
    const milestoneLabel = (value, period) => importer.dateLabel?.(value, period) || period?.label || value || "No saved date";
    const resolutionValue = (value) => typeof value === "object" && value ? value.value || "" : value || "";
    function proposedEntries() { return [...entries(portfolio()), ...(state.plan?.createdProducts || []).map((created) => ({ product: { id: created.productId, name: created.name, codename: created.codename }, categoryId: created.categoryId, categoryName: portfolio().categories?.find((category) => category.id === created.categoryId)?.name || created.categoryId }))]; }
    function focusBrowserKey(key) { const node = [...dialog.querySelectorAll("[data-plc-focus]")].find((candidate) => candidate.dataset.plcFocus === key); if (node && !node.disabled) { node.focus({ preventScroll: true }); return node; } return null; }
    function smallCell(value, note = "") { const cell = make("td", "", value); if (note) cell.append(make("small", "", note)); return cell; }
    function renderBrowser(rows, { tab = state.tab, categories = [], statuses = [], columns, renderCells, renderDetail, empty = "No products match these filters." } = {}) {
      const view = browsers[tab], wrapper = make("section", `plc-browser plc-browser-${tab}`), controls = make("div", "plc-browser-tools"), searchLabel = make("label", "plc-search", tab === "history" ? "Find a record" : "Find a product"), search = make("input");
      if (tab === "review" && view.selected) {
        const selected = rows.find((row) => row.key === view.selected);
        if (selected) {
          body.replaceChildren(); wrapper.classList.add("plc-review-editor");
          const navigation = make("div", "plc-review-editor-nav"), back = button("Back to review list", "quiet-button", () => { const returnRow = view.returnRow || view.selected; view.selected = ""; render(); focusBrowserKey(`review-row-${returnRow}`) || focusBrowserKey("review-search"); }); back.dataset.plcFocus = "review-editor-back"; back.disabled = state.busy; navigation.append(back);
          const keys = (view.editorKeys || []).filter((key) => rows.some((row) => row.key === key)), index = keys.indexOf(view.selected), move = (offset) => { view.selected = keys[index + offset]; render(); focusBrowserKey(offset > 0 ? "review-editor-next" : "review-editor-prev") || focusBrowserKey(offset > 0 ? "review-editor-prev" : "review-editor-next") || focusBrowserKey("review-editor-back"); };
          const prev = button("Previous project", "quiet-button", () => move(-1)), next = button("Next project", "quiet-button", () => move(1)); prev.dataset.plcFocus = "review-editor-prev"; next.dataset.plcFocus = "review-editor-next"; prev.disabled = state.busy || index <= 0; next.disabled = state.busy || index < 0 || index + 1 >= keys.length; navigation.append(make("span", "plc-note", index >= 0 ? `Project ${index + 1} of ${keys.length}` : "Selected project"), prev, next); wrapper.append(navigation);
          const detail = make("section", "plc-selected-detail"), title = make("h3", "plc-detail-title", selected.title); detail.id = "plc-detail-panel-review"; title.id = "plc-detail-review"; title.tabIndex = -1; title.dataset.plcFocus = "review-detail"; detail.setAttribute("aria-labelledby", title.id); detail.append(title); renderDetail(selected, detail); wrapper.append(detail); body.append(wrapper); return browseRows(rows, view);
        }
        view.selected = "";
      }
      search.type = "search"; search.value = view.query; search.placeholder = tab === "history" ? "Product, workbook, milestone…" : "Product, codename, category…"; search.dataset.plcFocus = `${tab}-search`; search.setAttribute("aria-label", tab === "history" ? "Search PLC update history" : `Search PLC ${tab === "review" ? "review projects" : "products"}`); search.disabled = state.busy;
      search.addEventListener("input", () => { view.query = search.value; view.page = 0; view.selected = ""; render(); }); searchLabel.append(search); controls.append(searchLabel);
      for (const [key, label, options] of [["category", "Category", categories], ["status", "Show", statuses]]) {
        if (!options.length) continue;
        const control = make("label", "plc-filter", label), select = make("select"); select.setAttribute("aria-label", `${tab} ${label.toLowerCase()} filter`); select.dataset.plcFocus = `${tab}-${key}`;
        for (const [value, title] of [["all", key === "category" ? "All categories" : tab === "history" ? "All records" : tab === "review" ? "All review projects" : "All products"], ...options]) { const option = make("option", "", title); option.value = value; select.append(option); }
        if (!["all", ...options.map(([value]) => value)].includes(view[key])) view[key] = "all";
        select.value = view[key]; select.disabled = state.busy; select.addEventListener("change", () => { view[key] = select.value; view.page = 0; view.selected = ""; render(); }); control.append(select); controls.append(control);
      }
      if (view.query || view.category !== "all" || view.status !== "all") { const reset = button("Clear filters", "quiet-button", () => { view.query = ""; view.category = "all"; view.status = "all"; view.page = 0; view.selected = ""; render(); doc.querySelector(`[data-plc-focus="${tab}-search"]`)?.focus({ preventScroll: true }); }); reset.disabled = state.busy; controls.append(reset); }
      wrapper.append(controls);
      const page = browseRows(rows, view); view.page = page.page;
      const pager = make("div", "plc-pagination"), count = make("p", "plc-note", `${page.start}–${page.end} of ${page.total} ${tab === "review" ? "projects" : "records"}${page.total !== rows.length ? ` (${rows.length} total)` : ""}`); count.setAttribute("role", "status"); count.setAttribute("aria-live", "polite"); pager.append(count);
      const changePage = (offset) => { view.page += offset; view.selected = ""; render(); focusBrowserKey(`${tab}-${offset < 0 ? "prev" : "next"}`) || focusBrowserKey(`${tab}-${offset < 0 ? "next" : "prev"}`) || focusBrowserKey(`${tab}-search`); };
      const prev = button("Previous", "quiet-button", () => changePage(-1)), next = button("Next", "quiet-button", () => changePage(1)); prev.dataset.plcFocus = `${tab}-prev`; next.dataset.plcFocus = `${tab}-next`; prev.disabled = state.busy || page.page === 0; next.disabled = state.busy || page.page + 1 >= page.pages; pager.append(prev, make("span", "plc-page-label", `Page ${page.page + 1} of ${page.pages}`), next); wrapper.append(pager);
      const layout = make("div", "plc-browser-grid"), list = make("div", "plc-browser-list");
      if (!page.rows.length) list.append(make("p", "plc-empty", empty));
      else {
        const shell = make("div", "plc-table-shell"), table = make("table", "plc-products-table"), head = make("thead"), heading = make("tr"), tbody = make("tbody");
        for (const label of [...columns, ...(tab === "review" ? ["Edit"] : [])]) { const cell = make("th", "", label); cell.setAttribute("scope", "col"); heading.append(cell); } head.append(heading); table.append(head);
        for (const row of page.rows) {
          const tr = make("tr"); tr.dataset.plcListRow = row.key; if (view.selected === row.key) tr.classList.add("is-selected");
          const chooseRow = () => {
            if (state.busy) return;
            if (tab === "review") { view.listScrollTop = dialog.querySelector(".plc-body")?.scrollTop || 0; view.editorKeys = page.filtered.map((entry) => entry.key); view.returnRow = row.key; view.selected = row.key; render(); doc.getElementById("plc-detail-review")?.focus({ preventScroll: true }); return; }
            view.selected = view.selected === row.key ? "" : row.key; render(); if (view.selected) { const title = doc.getElementById(`plc-detail-${tab}`); title?.focus({ preventScroll: true }); title?.scrollIntoView?.({ block: "nearest" }); } else focusBrowserKey(`${tab}-row-${row.key}`)?.scrollIntoView?.({ block: "nearest" });
          };
          const choose = button(row.title, "plc-product-link", chooseRow); choose.dataset.plcFocus = `${tab}-row-${row.key}`; choose.setAttribute("aria-expanded", String(view.selected === row.key)); choose.setAttribute("aria-controls", `plc-detail-panel-${tab}`); choose.disabled = state.busy;
          const name = make("td"); name.append(choose); if (row.subtitle) name.append(make("small", "", row.subtitle)); tr.append(name, ...renderCells(row)); tbody.append(tr);
          if (tab === "review") { tr.classList.add("plc-review-row"); tr.tabIndex = state.busy ? -1 : 0; tr.setAttribute("aria-label", `Edit ${row.title}`); tr.dataset.plcFocus = `review-row-${row.key}`; tr.addEventListener("click", (event) => { if (reviewRowActivation(event, tr)) chooseRow(); }); tr.addEventListener("keydown", (event) => { if (!reviewRowActivation(event, tr)) return; event.preventDefault(); chooseRow(); }); const action = make("td"), edit = button("Edit", "quiet-button", chooseRow); edit.setAttribute("aria-label", `Edit ${row.title}`); edit.disabled = state.busy; action.append(edit); tr.append(action); }
        }
        table.append(tbody); shell.append(table); list.append(shell);
      }
      layout.append(list);
      const detail = make("section", "plc-selected-detail"); detail.id = `plc-detail-panel-${tab}`; const selected = page.rows.find((row) => row.key === view.selected);
      if (selected) { layout.classList.add("has-selection"); const title = make("h3", "plc-detail-title", selected.title); title.id = `plc-detail-${tab}`; title.tabIndex = -1; title.dataset.plcFocus = `${tab}-detail`; detail.setAttribute("aria-labelledby", title.id); detail.append(title); renderDetail(selected, detail); }
      else detail.append(make("p", "plc-note", tab === "review" ? "Select a product to match it or review its milestone dates. Your choices stay saved while you search or change pages." : tab === "history" ? "Select a record to see the full dates, timestamps, and source evidence." : "Select a product to see every milestone timestamp, aging day, and source detail."));
      layout.append(detail); wrapper.append(layout); body.append(wrapper);
      return page;
    }
    function render() {
      if (!doc || !state.open || destroyed) return;
      ensureDialog(); const sameTab = renderedTab === state.tab, scrollTop = sameTab ? dialog.querySelector(".plc-body")?.scrollTop || 0 : 0;
      const focused = doc.activeElement, focusKey = focused?.dataset?.plcFocus, selection = focusKey && focused?.tagName === "INPUT" ? { start: focused.selectionStart, end: focused.selectionEnd } : null; renderedTab = state.tab; dialog.replaceChildren();
      const shell = make("div", "plc-shell"), header = make("header", "plc-header"), heading = make("div"); heading.append(make("span", "eyebrow", "Biweekly project collection"));
      const title = make("h2", "", "HyperX PLC updates"); title.id = "plcUpdatesTitle";
      const description = make("p", "", "Drop the biweekly Excel workbook. Reliable dates and project updates are saved automatically; uncertain details stay available for review."); description.id = "plcUpdatesDescription"; heading.append(title, description);
      const closeButton = button("×", "icon-button", close); closeButton.setAttribute("aria-label", "Close PLC updates"); closeButton.disabled = state.busy; header.append(heading, closeButton);
      const scrollBody = make("div", "plc-body"); errorNode = make("p", "plc-error", state.error); errorNode.setAttribute("role", "alert"); errorNode.hidden = !state.error; scrollBody.append(errorNode);
      const tabs = make("div", "plc-tabs"); tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "PLC update views");
      const queueCount = reviewCount(), tabItems = [["overview", "Import & results"], ["dates", "Products & FFS"], ["review", `Needs review${queueCount ? ` (${queueCount})` : ""}`], ["history", "Update history"]];
      for (const [id, label] of tabItems) { const node = button(label, "quiet-button", () => { state.tab = id; render(); doc.getElementById(`plc-tab-${id}`)?.focus(); }); node.id = `plc-tab-${id}`; node.setAttribute("role", "tab"); node.setAttribute("aria-selected", String(state.tab === id)); node.setAttribute("aria-controls", `plc-panel-${id}`); node.tabIndex = state.tab === id ? 0 : -1; node.disabled = state.busy; node.addEventListener("keydown", (event) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || state.busy) return; event.preventDefault(); const index = tabItems.findIndex(([key]) => key === id), next = event.key === "Home" ? 0 : event.key === "End" ? tabItems.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabItems.length) % tabItems.length; state.tab = tabItems[next][0]; render(); doc.getElementById(`plc-tab-${state.tab}`)?.focus(); }); tabs.append(node); }
      body = make("section"); body.id = `plc-panel-${state.tab}`; body.setAttribute("role", "tabpanel"); body.setAttribute("aria-labelledby", `plc-tab-${state.tab}`); scrollBody.append(body);
      if (state.tab === "overview") renderOverview(); else if (state.tab === "dates") renderDates(); else if (state.tab === "history") renderHistory(); else renderReview();
      footer = make("footer", "plc-footer"); shell.append(header, tabs, scrollBody, footer); dialog.append(shell);
      const reviewSelection = state.tab === "review" ? browsers.review.selected : ""; scrollBody.scrollTop = sameTab && state.tab === "review" ? reviewScrollPosition(renderedReviewSelection, reviewSelection, scrollTop, browsers.review.listScrollTop) : scrollTop; renderedReviewSelection = reviewSelection; renderFooter();
      if (focusKey && sameTab) { const replacement = [...dialog.querySelectorAll("[data-plc-focus]")].find((node) => node.dataset.plcFocus === focusKey), closed = replacement?.closest?.("details:not([open])"), hidden = closed && !closed.querySelector("summary")?.contains(replacement); if (replacement && !replacement.disabled && !hidden) { replacement.focus({ preventScroll: true }); if (selection && typeof replacement.setSelectionRange === "function" && selection.start != null) replacement.setSelectionRange(selection.start, selection.end); } else if (!state.busy) focusBrowserKey(`${state.tab}-search`) || doc.getElementById(`plc-tab-${state.tab}`)?.focus({ preventScroll: true }); }
    }
    function renderOverview() {
      renderDropzone();
      const summary = sourceSummary(portfolio(), importer), metrics = make("div", "plc-metrics");
      metric(metrics, "Last workbook imported", summary.last?.importedAt ? dateLabel(summary.last.importedAt) : "No workbook yet"); metric(metrics, "Days since import", summary.freshness.importAgeDays ?? "—"); metric(metrics, "Next biweekly update", summary.freshness.nextDueDate || "After first import"); metric(metrics, "Needs review", reviewCount()); body.append(metrics);
      const receipt = state.result || (summary.latestRun ? { summary: summary.latestRun.summary, sharing: portfolio()?.plcLastSharing } : null);
      if (receipt) {
        const notice = make("section", `plc-receipt${receipt.sharing?.status === "pending" ? " is-pending" : ""}`); notice.setAttribute("role", "status"); notice.setAttribute("aria-live", "polite");
        notice.append(make("h3", "", receipt.summary?.duplicate || receipt.duplicate ? "This workbook is already collected" : "Your PLC update is collected"));
        const count = receipt.summary || {}, dateCount = count.datesUpdated ?? count.changed ?? 0, productCount = count.imported ?? count.collected ?? 0, queueCount = reviewCount(); notice.append(make("p", "", `${dateCount} date${dateCount === 1 ? "" : "s"} updated · ${productCount} matched project${productCount === 1 ? "" : "s"} collected${count.created ? ` · ${count.created} new product${count.created === 1 ? "" : "s"} created` : ""}${count.colorwaysCreated ? ` · ${count.colorwaysCreated} colorway${count.colorwaysCreated === 1 ? "" : "s"} added` : ""}${queueCount ? ` · ${queueCount} project${queueCount === 1 ? " needs" : "s need"} review` : ""}`));
        const ffs = count.fields?.ffsDate;
        if (ffs) { notice.append(make("p", "plc-ffs-result", `FFS: ${ffs.updated || 0} dates updated · ${ffs.unchanged || 0} already current · ${ffs.review || 0} dates need review · ${ffs.unmatched || 0} product matches needed`)); if (ffs.blockedReasons?.length) { const reasons = make("details", "plc-raw"); reasons.append(make("summary", "", "Why some FFS dates were preserved")); facts(reasons, ffs.blockedReasons.map(({ reason, count }) => [reason, `${count} project${count === 1 ? "" : "s"}`])); notice.append(reasons); } }
        if (receipt.summary?.duplicate || receipt.duplicate) notice.append(make("p", "plc-note", "Identical content keeps its original timestamps and aging."));
        if (receipt.sharing?.message) notice.append(make("p", "plc-note", receipt.sharing.message));
        if ((receipt.sharing?.status === "pending" || receipt.sharing?.status === "local" && portfolio()?.plcSharePending?.patches?.length) && adapter.retrySharing) { const retry = button(state.busy ? "Saving…" : "Retry saving to master", "quiet-button", () => { void retrySharing(); }); retry.disabled = state.busy; notice.append(retry); }
        if (reviewCount()) { const review = button("Review uncertain details", "quiet-button", () => { state.tab = "review"; render(); }); review.disabled = state.busy; notice.append(review); }
        const changes = receipt.history || []; if (changes.length) { const recent = make("details", "plc-raw"); recent.append(make("summary", "", "Latest date changes")); const products = new Map(entries(portfolio()).map(({ product }) => [product.id, product])); facts(recent, changes.map((change) => [`${products.get(change.productId)?.name || change.productId}${change.variantName ? ` · ${change.variantName}` : ""} · ${importer.fieldLabels?.[change.field] || change.field}`, `${milestoneLabel(change.before, change.beforePeriod)} → ${milestoneLabel(change.after, change.afterPeriod)}\nUpdated ${dateLabel(change.at)} · ${importer.freshness({ changedAt: change.at }, localDay()).changeAgeDays ?? "unknown"} aging days`])); notice.append(recent); }
        body.append(notice);
      }
      const dates = button("Browse products & FFS", "quiet-button", () => { state.tab = "dates"; render(); doc.getElementById("plc-tab-dates")?.focus({ preventScroll: true }); }); dates.disabled = state.busy; body.append(dates);
    }
    function renderDates() {
      const productsWithDates = productDateEntries(portfolio(), importer);
      body.append(make("p", "plc-source", "Every populated date keeps its own update timestamp and aging days. A fresh report can confirm an unchanged date without resetting when that date last changed."));
      if (!productsWithDates.length) { body.append(make("p", "plc-empty", "Drop the first workbook to collect project data and start date tracking.")); return; }
      body.append(make("h3", "plc-section-title", "Product dates & aging"));
      const reviewIds = new Set((state.plan?.items || []).filter((item) => item.fields?.some((field) => field.field === "ffsDate" && field.status === "review")).map((item) => `${state.selections[item.key] || item.matchedProductId || item.match?.productId || ""}/${item.variantTarget?.variantId || ""}`));
      const rows = productsWithDates.map((entry) => { const { product, categoryId, categoryName, variantId = "", parentProduct = product } = entry, age = importer.freshness(product.plc || {}, localDay()), needsReview = reviewIds.has(`${product.id}/${variantId}`); return { ...entry, key: `${product.id}${variantId ? `/colorway/${variantId}` : ""}`, title: product.name || product.id, subtitle: `${categoryName}${variantId ? " · Colorway project" : ""}`, searchText: [product.name, product.id, product.codename, categoryName, ...(product.plc?.identities || []).map((identity) => `${identity.name || ""} ${identity.codename || ""}`)].join(" "), statuses: [product.ffsDate ? "has" : "missing", ...(variantId ? ["colorway"] : []), ...(needsReview ? ["review"] : []), ...(age.status === "overdue" ? ["overdue"] : [])], age, needsReview, clock: fieldClock(product, "ffsDate", variantId, parentProduct) }; }).sort((a, b) => a.title.localeCompare(b.title));
      const categories = [...new Map(rows.map((row) => [row.categoryId, row.categoryName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
      renderBrowser(rows, { categories, statuses: [["missing", "Missing FFS"], ["has", "Has FFS"], ["colorway", "Colorway projects"], ["review", "FFS needs review"], ["overdue", "Overdue workbook"]], columns: ["Product / colorway", "FFS date", "Last changed / age", "Last confirmed / status"], renderCells(row) { const clock = row.clock, changed = clock.changedAt ? dateLabel(clock.changedAt) : "Timestamp unknown", observed = clock.observedAt ? dateLabel(clock.observedAt) : "No PLC confirmation"; return [smallCell(clock.displayValue || milestoneLabel(row.product.ffsDate, clock.period), [clock.period && "Quarter precision", row.needsReview && "FFS source needs review"].filter(Boolean).join(" · ")), smallCell(changed, `${clock.changeAgeDays ?? "unknown"} aging days`), smallCell(observed, [clock.observedAt && `${clock.observedAgeDays ?? clock.importAgeDays ?? "unknown"} days since confirmation`, row.age.status === "overdue" && "Biweekly workbook overdue"].filter(Boolean).join(" · "))]; }, renderDetail(row, detail) { renderProductDetail(row, detail); } });
    }
    function renderProductDetail({ product, categoryName, age, needsReview, variantId = "", parentProduct = product }, content) {
      const meta = product.plc || {}; content.dataset.plcProduct = product.id; content.append(make("p", "plc-note", categoryName));
      if (variantId) { content.dataset.plcVariant = variantId; content.append(make("p", "plc-scope-note", `These dates belong to this colorway. Product FFS: ${milestoneLabel(parentProduct.ffsDate, importer.getFieldAge?.(parentProduct, "ffsDate", localDay())?.period)}.`)); }
      if (needsReview) { const review = button("Review FFS source", "quiet-button", () => { state.tab = "review"; browsers.review.query = product.name || product.id; browsers.review.page = 0; browsers.review.selected = ""; render(); doc.getElementById("plc-tab-review")?.focus({ preventScroll: true }); }); review.disabled = state.busy; content.append(review); }
      const fieldFacts = Object.keys(importer.fieldLabels || {}).map((field) => {
        if (!product[field]) return [importer.fieldLabels[field], "No saved date"];
        const stored = meta.fields?.[field], evidence = stored && !stored.supersededAt && text(stored.value) === text(product[field]) ? stored : {}, clock = fieldClock(product, field, variantId, parentProduct), observedAge = clock.observedAgeDays ?? clock.importAgeDays ?? clock.ageDays;
        const lines = [clock.displayValue || milestoneLabel(product[field], clock.period), `Updated ${clock.changedAt ? dateLabel(clock.changedAt) : "timestamp unknown"} · ${clock.changeAgeDays ?? "unknown"} aging days`];
        if (clock.period) lines.push(`Quarter precision · roadmap placement ${product[field]}`);
        if (clock.observedAt) lines.push(`Last confirmed ${dateLabel(clock.observedAt)} · ${observedAge ?? "unknown"} aging days`);
        if (clock.acceptedAt) lines.push(`Saved to master ${dateLabel(clock.acceptedAt)} · ${clock.acceptedAgeDays ?? "unknown"} days`);
        if (clock.sourceReportDate || evidence.reportDate) lines.push(`Source report ${clock.sourceReportDate || evidence.reportDate} · ${clock.sourceAgeDays ?? "unknown"} days`);
        if (evidence.raw) lines.push(`Source: ${evidence.raw}`); if (sourceRef(evidence.source)) lines.push(sourceRef(evidence.source));
        return [importer.fieldLabels[field], lines.join("\n")];
      });
      facts(content, fieldFacts);
      if (meta.importedAt) { const evidence = make("details", "plc-raw"); evidence.append(make("summary", "", "Collection & source details")); facts(evidence, [["Last collected", dateLabel(meta.importedAt)], ["Days since collection", age.importAgeDays], ["Source report", meta.reportDate], ["Source report basis", meta.reportDateBasis], ["Source report age", age.ageDays], ["Next report due", age.nextDueDate], ["Source workbook", meta.sourceFile]]); content.append(evidence); }
      for (const row of meta.rows || []) { const source = make("details", "plc-raw"); source.append(make("summary", "", `${row.name || row.codename || "Project evidence"}${row.stage ? ` · ${row.stage}` : ""}${row.status ? ` · ${row.status}` : ""}`)); facts(source, [["Section", row.section], ["Stage", row.stage], ["Status", row.status], ["Forecast", row.forecast], ["Project identity", row.projectId], ...Object.entries(row.milestones || {}).map(([key, value]) => [key.replace(/([A-Z])/g, " $1"), `${cellText(value)}${sourceRef(value?.source) ? ` · ${sourceRef(value.source)}` : ""}`]), ...Object.entries(row.data || {}).map(([label, value]) => [label, cellText(value)])]); observations(source, row); content.append(source); }
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
      const productMap = new Map(proposedEntries().map((entry) => [entry.product.id, entry]));
      const rows = items.map((item) => { const source = item.row || {}, productId = state.selections[item.key] || item.matchedProductId || item.match?.productId || "", entry = productMap.get(productId), ffs = item.fields?.find((field) => field.field === "ffsDate"), skipped = state.skippedKeys.has(item.key), selected = Boolean(Object.keys(state.resolutions[item.key] || {}).length || state.createProducts[item.key] || state.variantAssignments[item.key]), status = skipped ? "Skipped" : state.createProducts[item.key] ? "New product selected" : item.variantBindingNeeded ? "Colorway match needed" : selected ? state.variantAssignments[item.key] ? "Colorway selected" : "Dates selected" : !productId ? "Product match needed" : ffs?.status === "review" ? "FFS needs review" : item.fields?.some((field) => field.status === "update") ? "Date suggestion ready" : "Other details to review"; return { key: item.key, title: source.name || source.codename || "Unnamed project", subtitle: entry ? `PPC: ${entry.product.name || productId}${item.variantTarget ? ` · ${item.variantTarget.name}` : ""} · ${entry.categoryName}${item.colorway?.detected ? " · Colorway project" : ""}` : source.section || "Unmatched source project", categoryId: entry?.categoryId || "unmatched", categoryName: entry?.categoryName || "Needs product match", searchText: [source.name, source.codename, source.projectId, source.section, entry?.product.name, entry?.product.codename, entry?.categoryName, item.variantTarget?.name, item.colorway?.detected ? "colorway" : ""].join(" "), statuses: [...(!productId ? ["match"] : []), ...(item.variantBindingNeeded ? ["variant"] : []), ...(ffs?.status === "review" ? ["ffs"] : []), ...(item.fields?.some((field) => field.status === "update") ? ["ready"] : []), ...(skipped ? ["skipped"] : []), ...(selected ? ["selected"] : [])], item, ffs, status }; });
      const categories = [...new Map(rows.map((row) => [row.categoryId, row.categoryName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
      renderBrowser(rows, { categories, statuses: [["selected", "Selected for confirmation"], ["ffs", "FFS needs review"], ["match", "Product match needed"], ["variant", "Colorway match needed"], ["ready", "Date suggestion ready"], ["skipped", "Skipped this save"]], columns: ["Source product / PPC match", "Current FFS", "Source FFS", "Review status"], renderCells(row) { const chosen = state.resolutions[row.key]?.ffsDate; return [smallCell(row.item.variantBindingNeeded ? "Choose colorway" : milestoneLabel(row.ffs?.current, row.ffs?.currentPeriod), row.item.variantTarget ? `${row.item.variantTarget.name} colorway` : ""), smallCell(chosen ? milestoneLabel(resolutionValue(chosen), chosen.period) : row.ffs?.incoming ? milestoneLabel(row.ffs.incoming, row.ffs.period) : row.ffs?.raw || "No FFS in source", chosen ? "Selected for confirmation" : row.ffs?.reason || ""), smallCell(row.status)]; }, renderDetail(row, detail) { renderItem(row.item, detail); }, empty: "No review projects match these filters. Your existing choices remain available when you clear the filters." });
      if (browsers.review.selected) return;
      const visible = browseRows(rows, { ...browsers.review, pageSize: 50 }).filtered, clear = visible.flatMap((row) => row.item.matchedProductId && !row.item.variantBindingNeeded && !state.skippedKeys.has(row.key) ? (row.item.fields || []).flatMap((field) => ["update", "review"].includes(field.status) && !(state.skippedFields[row.key] || []).includes(field.field) ? dateSuggestions(field, row.item.row).filter((suggestion) => suggestion.clear).map((suggestion) => ({ key: row.key, field: field.field, suggestion })) : []) : []), actions = make("section", "plc-batch-actions");
      actions.append(make("p", "plc-note", `${clear.length} clear source date suggestion${clear.length === 1 ? "" : "s"} in this filter. Dates with different regional options need an individual choice.`));
      const selectClear = button(`Select ${clear.length} clear suggestions`, "quiet-button", () => { for (const choice of clear) selectSuggestion(choice.key, choice.field, choice.suggestion, { rerender: false }); render(); }); selectClear.disabled = state.busy || !clear.length; actions.append(selectClear);
      const clearDates = button("Clear selected dates", "quiet-button", () => { state.resolutions = {}; render(); }); clearDates.disabled = state.busy || !Object.values(state.resolutions).some((fields) => Object.keys(fields).length); actions.append(clearDates); body.append(actions);
    }
    function renderIdentity(item, content, product, productId) {
      const row = item.row || {}, compact = Boolean(product && !state.createProducts[item.key]), section = make("section", `plc-identity-panel${compact ? " plc-identity-matched" : ""}`), query = state.matchQueries[item.key] || "", tools = compact ? make("details", "plc-match-disclosure") : section;
      if (!compact) section.append(make("h4", "", item.colorway?.detected ? "Find the parent product" : "Match an existing product"));
      if (product) { const chip = make("p", "plc-match-chip", `${state.createProducts[item.key] ? "New product selected" : item.colorway?.detected ? "Parent product" : "Matched"}: ${product.name || productId}${product.codename ? ` · ${product.codename}` : ""}`); section.append(chip); }
      if (item.match?.reason) section.append(make("p", "plc-note", item.match.reason));
      if (compact) { tools.open = Boolean(state.matchOpen[item.key]); const summary = make("summary", "", "Change match"); summary.dataset.plcFocus = `match-disclosure-${item.key}`; tools.append(summary); tools.addEventListener("toggle", () => { if (tools.isConnected) state.matchOpen[item.key] = tools.open; }); section.append(tools); }
      const label = make("label", "plc-match", "Search by product name or codename"), search = make("input"); search.type = "search"; search.value = query; search.placeholder = "Type a name, codename, or category…"; search.dataset.plcFocus = `match-search-${item.key}`; search.setAttribute("aria-label", `Find a PPC match for ${row.name || row.codename || "project"}`); search.disabled = state.busy; search.addEventListener("input", () => { state.matchQueries[item.key] = search.value; if (compact) state.matchOpen[item.key] = tools.open; render(); }); label.append(search); tools.append(label);
      const results = matchingProducts(entries(portfolio()), item, query), cards = make("div", "plc-match-results");
      if (!results.length) cards.append(make("p", "plc-note", query ? "No matching products. Try fewer words, or create a source product below." : "No suggested match. Search the portfolio or create a source product below."));
      for (const entry of results) {
        const pick = button(entry.product.name || entry.product.id, "plc-match-card", () => chooseMatch(item.key, entry.product.id)); pick.dataset.plcFocus = `match-pick-${item.key}-${entry.product.id}`; pick.setAttribute("aria-pressed", String(productId === entry.product.id)); pick.disabled = state.busy; pick.append(make("small", "", [entry.product.codename && `Codename: ${entry.product.codename}`, entry.categoryName, entry.candidate?.reason || "Search match"].filter(Boolean).join(" · "))); cards.append(pick);
      }
      tools.append(cards, make("p", "plc-note", "Showing up to 8 matches. Choosing a card changes only this source product's match."));
      const skip = button(state.skippedKeys.has(item.key) ? "Restore this project" : "Keep this project out of PPC", "quiet-button", () => chooseMatch(item.key, state.skippedKeys.has(item.key) ? "" : "skip")); skip.disabled = state.busy; tools.append(skip); content.append(section);
      if (item.colorway?.detected || item.variantTarget) renderColorway(item, content, product, productId);
      if ((!item.colorway?.detected || state.separateProducts[item.key]) && (item.match?.status !== "matched" || state.createProducts[item.key] || state.separateProducts[item.key])) renderCreateDraft(item, content);
    }
    function renderColorway(item, content, product, productId) {
      const row = item.row || {}, target = item.variantTarget, selected = state.variantAssignments[item.key], section = make("section", "plc-colorway-panel");
      section.append(make("span", "plc-colorway-badge", "Colorway project"), make("h4", "", target ? `${product?.name || "Product"} · ${target.name || "Colorway"}` : "Choose the colorway"));
      if (item.colorway?.reason) section.append(make("p", "plc-note", item.colorway.reason));
      if (product && !state.createProducts[item.key]) {
        const parentClock = fieldClock(product, "ffsDate");
        section.append(make("p", "plc-scope-note", `Colorway milestones are tracked separately. Product FFS stays ${parentClock.displayValue || milestoneLabel(product.ffsDate, parentClock.period)}.`));
        const chips = make("div", "plc-colorway-chips");
        for (const variant of colorVariants(product)) {
          const name = colorwayName(variant), pick = button(name, "plc-colorway-chip", () => chooseVariant(item.key, { productId, variantId: variant.id })), swatch = make("span", "plc-colorway-swatch");
          if (/^#[0-9a-f]{6}$/i.test(variant.colorHex || "")) swatch.style.backgroundColor = variant.colorHex;
          pick.prepend(swatch); const candidate = item.variantCandidates?.find((entry) => entry.variantId === variant.id); if (candidate?.reason === "Exact source color") pick.append(make("small", "", "Source color")); pick.setAttribute("aria-label", `Use ${name} colorway of ${product.name || productId}`); pick.setAttribute("aria-pressed", String(target?.variantId === variant.id)); pick.dataset.plcFocus = `variant-${item.key}-${variant.id}`; pick.disabled = state.busy || row.cancelled || state.skippedKeys.has(item.key); chips.append(pick);
        }
        section.append(chips);
        const hint = item.colorway?.color || {}, draft = state.variantDrafts[item.key] ||= { colorName: hint.colorName || hint.name || hint.label || "", colorCode: hint.canonicalCode || hint.colorCode || hint.code || "", colorHex: hint.colorHex || hint.hex || "#777777", colorName2: hint.colorName2 || "", colorHex2: hint.colorHex2 || "#ffffff" };
        const existingColor = colorVariants(product).some((variant) => searchText(colorwayName(variant)) === searchText(draft.colorName));
        const add = make("details", "plc-colorway-create"); add.open = Boolean(draft.open || !target && !existingColor); add.append(make("summary", "", draft.colorName ? `Add ${draft.colorName} colorway` : "Add a new colorway"));
        const fields = make("div", "plc-colorway-fields"), confirm = button(selected?.create ? "Colorway selected for confirmation" : "Select new colorway", "quiet-button", () => chooseVariant(item.key, { productId, colorName: draft.colorName, colorCode: draft.colorCode, colorHex: draft.colorHex, ...(draft.colorName2.trim() ? { colorName2: draft.colorName2, colorHex2: draft.colorHex2 } : {}), create: true }));
        const updateConfirm = () => { const chosen = Boolean(state.variantAssignments[item.key]?.create); confirm.textContent = chosen ? "Colorway selected for confirmation" : "Select new colorway"; confirm.setAttribute("aria-pressed", String(chosen)); confirm.disabled = state.busy || row.cancelled || state.skippedKeys.has(item.key) || !draft.colorName.trim() || !draft.colorCode.trim() || !/^#[0-9a-f]{6}$/i.test(draft.colorHex); };
        for (const [key, labelText, type] of [["colorName", "Color name", "text"], ["colorCode", "Colorway code", "text"], ["colorHex", "Swatch", "color"], ["colorName2", "Second color (optional)", "text"], ["colorHex2", "Second swatch", "color"]]) {
          const label = make("label", "plc-match", labelText), input = make("input"); input.type = type; input.value = draft[key]; input.maxLength = 128; input.disabled = state.busy; input.dataset.plcFocus = `variant-new-${item.key}-${key}`; input.setAttribute("aria-label", `${labelText} for ${product.name || productId}`);
          input.addEventListener("input", () => { draft[key] = input.value; draft.open = true; if (state.variantAssignments[item.key]?.create) { delete state.variantAssignments[item.key]; delete state.resolutions[item.key]; rebuild(); for (const node of content.querySelectorAll?.(".plc-date-candidates button, .plc-manual-date input, .plc-manual-date select, .plc-manual-date button") || []) node.disabled = true; const note = section.querySelector?.(".plc-selection-note"); if (note) note.textContent = "The draft changed. Select the new colorway again before choosing its dates."; renderFooter(); } updateConfirm(); }); label.append(input); fields.append(label);
        }
        confirm.dataset.plcFocus = `variant-new-${item.key}-confirm`; confirm.setAttribute("aria-pressed", String(Boolean(selected?.create))); updateConfirm(); add.append(fields, make("p", "plc-note", "WHT is a colorway code. Confirmed HP part numbers can be assigned to this color in the product editor."), confirm); section.append(add);
        if (target) section.append(make("p", "plc-selection-note", `${target.create ? "New colorway" : "Colorway"} ${target.name || ""} selected. Confirm selected updates saves the source link; select its dates below.`));
      } else section.append(make("p", "plc-note", "Find the parent product above, then choose its existing colorway or add one. A colorway stays on the same product card."));
      const separate = make("label", "plc-separate-product"), checkbox = make("input"); checkbox.type = "checkbox"; checkbox.checked = Boolean(state.separateProducts[item.key]); checkbox.disabled = state.busy || row.cancelled; checkbox.setAttribute("aria-label", "This source is different hardware, platform, or model and needs a separate product"); checkbox.addEventListener("change", () => chooseSeparateProduct(item.key, checkbox.checked)); separate.append(checkbox, make("span", "", "Different hardware, platform, or model — create a separate product")); section.append(separate); content.append(section);
    }
    function renderCreateDraft(item, content) {
      const row = item.row || {}, draft = state.createDrafts[item.key] ||= { name: row.marketingName || row.codename || row.name || "", codename: row.codename || (!row.marketingName ? row.name : "") || "", categoryId: "" }, section = make("section", "plc-create-panel"); section.append(make("h4", "", "Create a product from this source"), make("p", "plc-note", "An unannounced product can use its codename as its name. Confirm its category and select it for the batch save."));
      for (const [key, title] of [["name", "Product name"], ["codename", "Codename"]]) {
        const label = make("label", "plc-match", title), input = make("input"); input.type = "text"; input.value = draft[key]; input.maxLength = 2048; input.disabled = state.busy; input.dataset.plcFocus = `create-${item.key}-${key}`; input.setAttribute("aria-label", `${title} for new ${row.name || row.codename || "source project"}`); input.addEventListener("input", () => { draft[key] = input.value; if (state.createProducts[item.key]) { delete state.createProducts[item.key]; rebuild(); } render(); }); label.append(input); section.append(label);
      }
      const categoryLabel = make("label", "plc-match", "Confirm category"), category = make("select"); category.dataset.plcFocus = `create-${item.key}-category`; category.setAttribute("aria-label", `Category for new ${row.name || row.codename || "source project"}`); category.disabled = state.busy; const blank = make("option", "", "Choose a category…"); blank.value = ""; category.append(blank);
      for (const entry of portfolio().categories || []) { const option = make("option", "", entry.name || entry.id); option.value = entry.id; category.append(option); } category.value = draft.categoryId; category.addEventListener("change", () => { draft.categoryId = category.value; if (state.createProducts[item.key]) { delete state.createProducts[item.key]; rebuild(); } render(); }); categoryLabel.append(category); section.append(categoryLabel);
      const selected = Boolean(state.createProducts[item.key]), choose = button(selected ? "Remove from new product batch" : "Select this new product", "quiet-button", () => confirmCreate(item.key, draft, !selected)); choose.disabled = state.busy || !draft.name.trim() || !draft.codename.trim() || !draft.categoryId || row.cancelled; choose.dataset.plcFocus = `create-${item.key}-confirm`; choose.setAttribute("aria-pressed", String(selected)); section.append(choose);
      if (row.cancelled) section.append(make("p", "plc-note", "Cancelled source projects cannot be created.")); content.append(section);
    }
    function renderManualDate(item, field, control, { skipped, productId, saved } = {}) {
      state.manualDates[item.key] ||= {};
      const sourcePeriod = field.period || importer.parseDate?.(field.raw, { quarterBasis: "calendar" })?.period, selectedPeriod = saved?.period, draft = state.manualDates[item.key][field.field] ||= { mode: selectedPeriod || sourcePeriod ? "quarter" : "exact", quarter: text((selectedPeriod || sourcePeriod)?.quarter), year: text((selectedPeriod || sourcePeriod)?.year), day: typeof saved === "string" ? saved : !field.period ? field.incoming || "" : "", open: false };
      const disabled = skipped || !productId || item.variantBindingNeeded || state.busy || field.status === "stale" || item.row?.cancelled, manual = make("details", "plc-raw plc-manual-resolution"), summary = make("summary", "", "Enter a verified date"); manual.open = Boolean(draft.open); summary.dataset.plcFocus = `manual-${item.key}-${field.field}`; manual.append(summary); manual.addEventListener("toggle", () => { if (manual.isConnected) draft.open = manual.open; });
      const box = make("div", "plc-manual-date"), modes = make("div", "plc-date-modes"); modes.setAttribute("role", "group"); modes.setAttribute("aria-label", `Verified ${field.label || field.field} precision`);
      let updatePreview = () => {};
      const updateDraft = (key, value) => { draft[key] = value; draft.open = true; updatePreview(); };
      for (const [value, title] of [["exact", "Exact day"], ["quarter", "Calendar quarter"]]) { const choose = button(title, "quiet-button", () => { draft.mode = value; draft.open = true; render(); focusBrowserKey(`manual-mode-${item.key}-${field.field}-${value}`); }); choose.disabled = disabled; choose.setAttribute("aria-pressed", String(draft.mode === value)); choose.dataset.plcFocus = `manual-mode-${item.key}-${field.field}-${value}`; modes.append(choose); } box.append(modes);
      if (draft.mode === "quarter") {
        const fields = make("div", "plc-quarter-fields"), quarterLabel = make("label", "plc-resolution", "Quarter"), quarter = make("select"), blank = make("option", "", "Choose quarter…"); blank.value = ""; quarter.append(blank);
        for (const value of [1, 2, 3, 4]) { const option = make("option", "", `Q${value}`); option.value = String(value); quarter.append(option); } quarter.value = draft.quarter; quarter.disabled = disabled; quarter.setAttribute("aria-label", `Verified ${field.label || field.field} quarter for ${item.row?.name || item.row?.codename || "project"}`); quarter.dataset.plcFocus = `manual-quarter-${item.key}-${field.field}`; quarter.addEventListener("change", () => updateDraft("quarter", quarter.value)); quarterLabel.append(quarter);
        const yearLabel = make("label", "plc-resolution", "Year"), year = make("input"); year.type = "text"; year.inputMode = "numeric"; year.pattern = "[0-9]{4}"; year.maxLength = 4; year.placeholder = "2028"; year.value = draft.year; year.disabled = disabled; year.setAttribute("aria-label", `Verified ${field.label || field.field} quarter year for ${item.row?.name || item.row?.codename || "project"}`); year.dataset.plcFocus = `manual-year-${item.key}-${field.field}`; year.addEventListener("input", () => updateDraft("year", year.value)); yearLabel.append(year); fields.append(quarterLabel, yearLabel); box.append(fields);
      } else {
        const label = make("label", "plc-resolution", "Verified exact day"), day = make("input"); day.type = "date"; day.min = "1900-01-01"; day.max = "9999-12-31"; day.value = draft.day; day.disabled = disabled; day.dataset.plcFocus = `manual-day-${item.key}-${field.field}`; day.setAttribute("aria-label", `Verified ${field.label || field.field} exact day for ${item.row?.name || item.row?.codename || "project"}`); const updateDay = () => updateDraft("day", day.value); day.addEventListener("input", updateDay); day.addEventListener("change", updateDay); label.append(day); box.append(label);
      }
      let resolution = null;
      const preview = make("div", "plc-manual-preview"); preview.setAttribute("role", "status"); preview.setAttribute("aria-live", "polite");
      box.append(preview);
      const pickKey = `manual-select-${item.key}-${field.field}`, pick = button("Select verified date", "quiet-button", () => { setManualDate(item.key, field.field, draft); focusBrowserKey(pickKey); }); pick.dataset.plcFocus = pickKey;
      // Native date controls emit change while a year is still being typed. Keep the
      // field mounted so its active month/day/year segment and calendar stay intact.
      updatePreview = () => {
        resolution = null;
        try { resolution = manualDateResolution(draft, importer); } catch { /* Incomplete input remains an unsaved draft. */ }
        preview.replaceChildren();
        if (resolution) { const value = resolutionValue(resolution); preview.append(make("strong", "", milestoneLabel(value, resolution.period)), make("p", "plc-note", `${milestoneLabel(field.current, field.currentPeriod)} → ${milestoneLabel(value, resolution.period)}`)); if (resolution.period) { const placement = new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); preview.append(make("p", "plc-note", `Quarter precision · roadmap placement: ${placement}. The actual day remains unspecified.`)); } }
        else preview.append(make("p", "plc-note", draft.mode === "quarter" ? "Choose Q1–Q4 and enter a four-digit year to preview." : "Choose a complete exact day with a four-digit year from 1900 to 9999 to preview."));
        pick.textContent = resolution ? `Select verified ${draft.mode === "quarter" ? "quarter" : "date"}` : "Select verified date";
        pick.disabled = disabled || !resolution;
      };
      updatePreview(); box.append(pick, make("p", "plc-note", field.status === "stale" ? "Older sources cannot overwrite a newer date." : item.row?.cancelled ? "Cancelled source dates remain unchanged." : "Select only after checking the source. Confirm selected updates saves it; unselected dates remain in review.")); manual.append(box); control.append(manual);
    }
    function renderItem(item, content) {
      const row = item.row || {}, skipped = state.skippedKeys.has(item.key), productId = state.selections[item.key] || item.matchedProductId || item.match?.productId || "", product = proposedEntries().find((entry) => entry.product.id === productId)?.product;
      content.dataset.plcRow = item.key; content.append(make("p", "plc-note", [row.section, row.stage, row.status].filter(Boolean).join(" · ")));
      renderIdentity(item, content, product, productId);
      const shell = make("div", "plc-table-shell"), table = make("table", "plc-fields"), head = make("thead"), headRow = make("tr"); for (const name of ["Milestone", "Current PPC", "Source evidence", "Apply or resolve"]) headRow.append(make("th", "", name)); head.append(headRow); table.append(head); const tbody = make("tbody");
      for (const field of item.fields || []) {
        const tr = make("tr"), incoming = make("td", "", field.incoming ? milestoneLabel(field.incoming, field.period) : "No confirmed source date"), control = make("td"); incoming.append(make("small", "", `${field.raw ? `Raw: ${text(field.raw)}` : ""}${sourceRef(field.source) ? `\n${sourceRef(field.source)}` : ""}${field.reason ? `\n${field.reason}` : ""}`));
        const saved = state.resolutions[item.key]?.[field.field], kept = (state.skippedFields[item.key] || []).includes(field.field), suggestions = dateSuggestions(field, row);
        if (["update", "review", "stale"].includes(field.status)) {
          const cards = make("div", "plc-date-candidates");
          suggestions.forEach((suggestion, index) => { const key = `candidate-${item.key}-${field.field}-${index}`, pick = button(`${suggestion.region ? `${suggestion.region} · ` : ""}${suggestion.label}`, "plc-suggestion-card", () => { selectSuggestion(item.key, field.field, suggestion); focusBrowserKey(key); }); pick.disabled = skipped || !productId || item.variantBindingNeeded || state.busy || suggestion.blocked; pick.dataset.plcFocus = key; pick.setAttribute("aria-pressed", String(resolutionValue(saved) === suggestion.value && JSON.stringify(saved?.period || null) === JSON.stringify(suggestion.period || null))); pick.append(make("small", "plc-suggestion-preview", `${milestoneLabel(field.current, field.currentPeriod)} → ${suggestion.label}`), make("small", "", sourceRef(suggestion.source)), make("small", "", suggestion.reason)); if (suggestion.period) pick.append(make("small", "", `Quarter precision · roadmap placement ${suggestion.value}`)); cards.append(pick); });
          if (suggestions.some((suggestion) => suggestion.blocked)) cards.append(make("p", "plc-note", "A newer or protected PPC date is preserved. Source suggestions cannot replace it."));
          if (saved) cards.append(make("p", "plc-selection-note", `Selected: ${milestoneLabel(resolutionValue(saved), saved.period)}`));
          const keep = button(kept ? "Keeping current date" : "Keep current date", "quiet-button", () => { keepDate(item.key, field.field); focusBrowserKey(`keep-${item.key}-${field.field}`); }); keep.dataset.plcFocus = `keep-${item.key}-${field.field}`; keep.disabled = skipped || !productId || item.variantBindingNeeded || state.busy; keep.setAttribute("aria-pressed", String(kept)); cards.append(keep); control.append(cards);
          renderManualDate(item, field, control, { skipped, productId, saved });
        } else control.append(make("span", "plc-note", field.status === "unchanged" ? "Date unchanged" : "PPC preserved"));
        const current = make("td", "", item.variantBindingNeeded ? "Choose colorway" : milestoneLabel(field.current, field.currentPeriod)); if (field.current && product && !item.variantBindingNeeded) { const clock = item.variantTarget ? importer.getVariantFieldAge?.(product, item.variantTarget.variantId, field.field, localDay()) : fieldClock(product, field.field); if (clock) current.append(make("small", "", `Updated ${clock.changedAt ? dateLabel(clock.changedAt) : "timestamp unknown"}\n${clock.changeAgeDays ?? "unknown"} aging days`)); }
        const milestone = make("td", "", field.label || importer.fieldLabels?.[field.field] || field.field);
        for (const [cell, label] of [[milestone, "Milestone"], [current, "Current PPC"], [incoming, "Source evidence"], [control, "Apply or resolve"]]) { cell.dataset.label = label; cell.prepend(make("span", "plc-mobile-field-label", label)); }
        tr.append(milestone, current, incoming, control); tbody.append(tr);
      }
      table.append(tbody); shell.append(table); content.append(shell);
      const evidence = make("details", "plc-raw"); evidence.append(make("summary", "", "All project status and milestone evidence")); facts(evidence, [["Source project key", row.key], ["Project ID", row.projectId], ["Codename", row.codename], ["Forecast", row.forecast], ...Object.entries(row.milestones || {}).map(([key, value]) => [key.replace(/([A-Z])/g, " $1"), `${cellText(value)}${sourceRef(value?.source) ? ` · ${sourceRef(value.source)}` : ""}`]), ...Object.entries(row.data || {}).map(([key, value]) => [key, cellText(value)])]); observations(evidence, row); content.append(evidence);
    }
    function renderHistory() {
      const history = historyRows(portfolio()), imports = portfolio()?.plcImports || [], tools = make("div", "plc-history-tools"); tools.append(make("p", "plc-note", `${imports.length} imports · ${history.length} milestone changes. Workbook names, raw evidence, and cell references are retained.`));
      tools.append(button("Export JSON", "quiet-button", () => download(JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), collection: portfolio()?.plcCollection || null, review: portfolio()?.plcReview || null, imports, history }, null, 2), `ppc-plc-history-${localDay()}.json`, "application/json")), button("Export CSV", "quiet-button", () => download(historyCsv(portfolio()), `ppc-plc-history-${localDay()}.csv`, "text/csv;charset=utf-8"))); body.append(tools);
      const collection = portfolio()?.plcCollection;
      if (collection) { const inventory = make("details", "plc-raw"); inventory.append(make("summary", "", "Latest workbook and complete source inventory")); facts(inventory, [["Workbook", collection.metadata?.fileName], ["Imported", dateLabel(collection.importedAt)], ["Source report", collection.metadata?.reportDate], ["Project records", collection.primaryRows?.length], ["Supporting records", collection.supportingRows?.length]]); const sheets = collection.metadata?.sheets || []; if (sheets.length) facts(inventory, sheets.map((sheet) => [sheet.name, `${sheet.role || "Source"} · ${sheet.rowCount ?? "unknown"} rows${sheet.hidden ? " · hidden" : ""}`])); inventory.append(make("p", "plc-source", "The JSON export includes the full latest source collection, review queue, and retained history.")); body.append(inventory); }
      if (!history.length && !imports.length) { body.append(make("p", "plc-empty", "No PLC update history yet. Evidence and milestone changes will appear here after you collect a workbook.")); return; }
      if (!history.length) body.append(make("p", "plc-source", "No PPC milestone date changes were accepted. Source observations and review outcomes remain available below."));
      const products = new Map(entries(portfolio()).map((entry) => [entry.product.id, entry]));
      const rows = imports.flatMap((run, index) => {
        const type = run.type === "review" ? "review" : "import", base = { run, at: run.at, statuses: [type], kind: type === "review" ? "Review save" : "Workbook import" };
        return [{ ...base, key: `run-${index}`, title: run.sourceFile || "PLC workbook", subtitle: `${run.rows?.length || 0} source projects`, categoryId: "workbooks", categoryName: "Workbook imports", searchText: [run.sourceFile, run.reportDate, type, run.reportDateBasis].join(" ") }, ...(run.rows || []).map((source, rowIndex) => { const entry = products.get(source.productId), ffs = source.fields?.find((field) => field.field === "ffsDate"); return { ...base, source, ffs, kind: type === "review" ? "Reviewed project" : "Source observation", key: `source-${index}-${rowIndex}`, title: source.variantId ? `${entry?.product.name || source.name || source.productId} · ${source.variantName || source.variantId}` : source.name || entry?.product.name || source.key || "Source project", subtitle: run.sourceFile || "PLC workbook", categoryId: entry?.categoryId || "unmatched", categoryName: entry?.categoryName || "Unmatched projects", searchText: [source.name, source.key, source.variantName, source.observation?.codename, entry?.product.name, entry?.categoryName, run.sourceFile, source.action, ...(source.fields || []).map((field) => `${importer.fieldLabels?.[field.field] || field.field} ${field.raw || ""}`)].join(" ") }; })];
      }).concat(history.map((event, index) => { const entry = products.get(event.productId); return { event, key: `change-${index}`, title: event.productName || event.productId, subtitle: event.category || entry?.categoryName || "", at: event.at || event.importedAt, kind: "Date change", categoryId: entry?.categoryId || event.category || "unmatched", categoryName: event.category || entry?.categoryName || "Unmatched projects", statuses: ["change", ...(event.field === "ffsDate" ? ["ffs"] : [])], searchText: [event.productName, event.productId, event.category, event.sourceFile, importer.fieldLabels?.[event.field] || event.field, event.before, event.after].join(" ") }; })).sort((a, b) => text(b.at).localeCompare(text(a.at)));
      const categories = [...new Map(rows.map((row) => [row.categoryId, row.categoryName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
      body.append(make("h3", "plc-section-title", "Imports, observations & date changes"));
      renderBrowser(rows, { categories, statuses: [["ffs", "FFS date changes"], ["change", "All date changes"], ["import", "Workbook imports & source observations"], ["review", "Reviewed updates"]], columns: ["Product / workbook", "Record", "FFS / milestone", "When saved"], renderCells(row) { const event = row.event, milestone = event ? `${importer.fieldLabels?.[event.field] || event.field}: ${milestoneLabel(event.before, event.beforePeriod)} → ${milestoneLabel(event.after, event.afterPeriod)}` : row.ffs ? `FFS: ${row.ffs.raw || "No source date"}` : row.source ? "Source evidence" : `${row.run.summary?.datesUpdated ?? row.run.summary?.changed ?? 0} dates updated`; return [smallCell(row.kind), smallCell(milestone, row.ffs?.reason || row.source?.action || ""), smallCell(dateLabel(row.at))]; }, renderDetail(row, detail) {
        if (row.event) { facts(detail, [["Before", milestoneLabel(row.event.before, row.event.beforePeriod)], ["After", milestoneLabel(row.event.after, row.event.afterPeriod)], ...Object.entries(row.event).filter(([key]) => !["before", "after"].includes(key)).map(([key, value]) => [key.replace(/([A-Z])/g, " $1"), text(value)])]); return; }
        const run = row.run; facts(detail, [["Workbook", run.sourceFile], ["Imported", dateLabel(run.at)], ["Source report", run.reportDate], ["Date basis", run.reportDateBasis], ["Import result", text(run.summary)], ["Source integrity notes", text(run.diagnostics)], ["Fingerprint", run.fingerprint]]);
        if (row.source) renderSourceHistory(row.source, detail);
        else detail.append(make("p", "plc-note", "Find the individual product observations in the table, or export the complete collection above."));
      }, empty: "No history records match these filters. Exports always include all retained records." });
    }
    function renderSourceHistory(row, content) {
      facts(content, [["Source key", row.key], ["Portfolio product", row.productId || "Unmatched"], ["Colorway", row.variantName], ["Colorway ID", row.variantId], ...(row.fields || []).map((field) => [importer.fieldLabels?.[field.field] || field.field, [field.status, field.raw, field.reason, sourceRef(field.source)].filter(Boolean).join(" · ")])]);
      if (row.observation) { const observation = row.observation; facts(content, [["Section", observation.section], ["Stage", observation.stage], ["Status", observation.status], ["Forecast", observation.forecast], ["Project identity", observation.projectId], ["Codename", observation.codename], ["Source cells", (observation.sources || []).map(sourceRef).join(" · ")], ...Object.entries(observation.milestones || {}).map(([label, value]) => [label.replace(/([A-Z])/g, " $1"), `${cellText(value)}${sourceRef(value?.source) ? ` · ${sourceRef(value.source)}` : ""}`]), ...Object.entries(observation.data || {}).map(([label, value]) => [label, cellText(value)])]); observations(content, observation); }
    }
    function renderFooter() {
      if (!footer) return; footer.replaceChildren();
      if (state.tab === "review" && state.plan?.items?.length) {
        const dates = Object.values(state.resolutions).reduce((total, fields) => total + Object.keys(fields).length, 0), created = Object.keys(state.createProducts).length, variants = Object.keys(state.variantAssignments).length, matched = Object.keys(state.selections).filter((key) => !state.variantAssignments[key]).length, kept = Object.values(state.skippedFields).reduce((total, fields) => total + fields.length, 0), skipped = state.skippedKeys.size, eligible = dates + created + variants + matched + kept + skipped;
        footer.append(make("p", "plc-note", `${dates} date${dates === 1 ? "" : "s"}, ${created} new product${created === 1 ? "" : "s"}, ${variants} colorway${variants === 1 ? "" : "s"}, ${matched} match${matched === 1 ? "" : "es"}, ${kept} kept date${kept === 1 ? "" : "s"} selected across all pages.${skipped ? ` ${skipped} source projects excluded.` : ""} Unselected dates remain in review.`));
        const applyButton = button(state.busy ? "Saving…" : "Confirm selected updates", "primary-button", () => { void apply(); }); applyButton.disabled = state.busy || !eligible; footer.append(applyButton);
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
    return Object.freeze({ open, close, loadFile, loadFiles, chooseMatch, chooseVariant, chooseSeparateProduct, selectSuggestion, setManualDate, keepDate, confirmCreate, apply, retrySharing, refresh, getState: () => ({ ...state, selections: { ...state.selections }, variantAssignments: JSON.parse(JSON.stringify(state.variantAssignments)), variantDrafts: JSON.parse(JSON.stringify(state.variantDrafts)), separateProducts: { ...state.separateProducts }, resolutions: JSON.parse(JSON.stringify(state.resolutions)), manualDates: JSON.parse(JSON.stringify(state.manualDates)), createProducts: JSON.parse(JSON.stringify(state.createProducts)), createDrafts: JSON.parse(JSON.stringify(state.createDrafts)), skippedKeys: [...state.skippedKeys] }), destroy() { destroyed = true; fileGeneration += 1; for (const remove of listeners) remove(); root.removeEventListener?.("portfolio:render", onRender); dialog?.remove(); } });
  }
  root.PortfolioPlcUI = Object.freeze({ createController, init(options) { active?.destroy(); active = createController(options); return active; }, open(options) { return active?.open(options); }, refresh() { active?.refresh(); }, getController() { return active; }, sourceSummary, historyRows, historyCsv, csvCell, browseRows, dateSuggestions, matchingProducts, productDateEntries, manualDateResolution, reviewScrollPosition, reviewRowActivation });
})(typeof globalThis !== "undefined" ? globalThis : window);
