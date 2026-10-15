/* Device-local planning review. The host adapter owns atomic portfolio writes. */
(function (root) {
  "use strict";
  const STORAGE_KEY = "ppc-planning-decisions-v1", PAGE_SIZE = 20;
  const node = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
  function create(adapter) {
    const model = root.PortfolioPlanningIntake;
    if (!model || typeof adapter?.getPortfolio !== "function" || typeof adapter?.applyPlanning !== "function") throw new Error("Planning intake needs the portfolio adapter.");
    const dialog = node("dialog", "planning-intake"), heading = node("h2", "", "Import planning products"); heading.id = "planningIntakeTitle";
    dialog.setAttribute("aria-labelledby", heading.id);
    const close = node("button", "planning-intake-close", "Close"); close.type = "button"; close.setAttribute("aria-label", "Close planning intake");
    const header = node("header", "planning-intake-header"); header.append(heading, close);
    const intro = node("p", "planning-intake-intro", "Choose a local XLSX or CSV. Review product identities and each changed field before applying. Names and dates remain planning estimates. Blank dates keep accepted values.");
    const form = node("div", "planning-intake-source"), fileLabel = node("label", "", "Planning file"), fileInput = node("input"), selectedFile = node("span", "planning-intake-selected-file"); fileInput.type = "file"; fileInput.accept = ".xlsx,.csv,.tsv"; fileInput.setAttribute("aria-label", "Planning XLSX or CSV"); fileLabel.append(fileInput, selectedFile);
    const familyLabel = node("label", "", "Source collection"), familyInput = node("input"); familyInput.type = "text"; familyInput.maxLength = 150; familyInput.placeholder = "Keep the same collection for revised files"; familyInput.setAttribute("aria-label", "Planning source collection"); familyLabel.append(familyInput);
    const sheetLabel = node("label", "", "Worksheet"), sheetSelect = node("select"); sheetSelect.disabled = true; sheetSelect.setAttribute("aria-label", "Planning worksheet"); sheetLabel.append(sheetSelect);
    const parseButton = node("button", "", "Review file"); parseButton.type = "button";
    form.append(fileLabel, familyLabel, sheetLabel, parseButton);
    const status = node("p", "planning-intake-status", "No file selected."); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const summary = node("p", "planning-intake-summary"), toolbar = node("div", "planning-intake-toolbar"), previous = node("button", "", "Previous rows"), next = node("button", "", "Next rows"), pageLabel = node("span"), ignore = node("button", "", "Ignore undecided rows"); for (const button of [previous, next, ignore]) button.type = "button";
    toolbar.append(previous, pageLabel, next, ignore); toolbar.hidden = true;
    const rowsHost = node("div", "planning-intake-rows"), footer = node("footer", "planning-intake-footer"), apply = node("button", "planning-intake-apply", "Apply reviewed choices"); apply.type = "button"; apply.disabled = true;
    const note = node("span", "", "Matching choices are remembered on this device. Changed fields always need a new review."); footer.append(note, apply);
    dialog.append(header, intro, form, status, summary, toolbar, rowsHost, footer); document.body.append(dialog);
    const abort = new AbortController(), listen = (element, event, handler) => element.addEventListener(event, handler, { signal: abort.signal });
    let file = null, dataset = null, review = null, choices = new Map(), page = 0, busy = false, generation = 0, destroyed = false, returnFocus = null;
    const state = () => ({ busy, rowCount: review?.rows.length || 0, source: review?.source ? { ...review.source } : null, decisions: [...choices.values()].map(choice => ({ ...choice, fields: [...choice.fields], values: { ...choice.values } })) });
    function notifyState() { try { adapter.onStateChange?.(state()); } catch (_) { /* A host badge must not interrupt source review or persistence. */ } }
    const storage = () => adapter.storage || root.localStorage;
    function remembered() { try { const parsed = JSON.parse(storage().getItem(STORAGE_KEY) || "null"); return parsed?.version === 1 && Array.isArray(parsed.decisions) && parsed.decisions.length <= 1000 ? parsed.decisions.filter(row => row && typeof row.key === "string" && row.key.length < 2000 && ["match", "ignore"].includes(row.action) && (!row.productId || typeof row.productId === "string")) : []; } catch (_) { return []; } }
    function remember(result) {
      try { const map = new Map(remembered().map(row => [row.key, row])); for (const decision of result.decisions) if (decision.key.length < 2000) map.set(decision.key, { ...decision, fingerprint: result.source.fingerprint }); const decisions = [...map.values()].slice(-1000); const text = JSON.stringify({ version: 1, decisions }); if (text.length > 2 * 1024 * 1024) return false; storage().setItem(STORAGE_KEY, text); return true; } catch (_) { return false; }
    }
    function setBusy(value) { busy = value; parseButton.disabled = value; fileInput.disabled = value; familyInput.disabled = value; sheetSelect.disabled = value || !dataset || dataset.sheets.length < 2; apply.disabled = value || !review; close.disabled = value; rowsHost.inert = value; dialog.setAttribute("aria-busy", String(value)); notifyState(); }
    function refreshSummary() { if (!review) { summary.textContent = ""; notifyState(); return; } const values = [...choices.values()], decided = values.filter(row => row.action).length, selected = values.reduce((total, row) => total + row.fields.length, 0); summary.textContent = `${review.rows.length} source rows · ${decided} decisions · ${selected} fields selected for review`; apply.disabled = busy || decided !== review.rows.length; notifyState(); }
    const option = (value, label) => { const element = node("option", "", label); element.value = value; return element; };
    function allProducts() { return adapter.getPortfolio().categories.flatMap(category => category.board.products.map(product => ({ product, category }))); }
    function renderRows() {
      rowsHost.replaceChildren(); if (!review) return;
      const totalPages = Math.max(1, Math.ceil(review.rows.length / PAGE_SIZE)); page = Math.max(0, Math.min(totalPages - 1, page));
      pageLabel.textContent = `${page + 1} / ${totalPages}`; previous.disabled = page === 0; next.disabled = page >= totalPages - 1;
      for (const row of review.rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
        const choice = choices.get(row.key), article = node("article", "planning-intake-row"); article.dataset.sourceKey = row.key;
        const title = node("h3", "", row.name), source = node("p", "planning-intake-row-source", `${row.sourceId || "No immutable source ID"} · ${row.source.sheet}, row ${row.source.row}${row.category ? ` · ${row.category}` : ""}`);
        article.append(title, source);
        if (row.issues.length) article.append(node("p", "planning-intake-warning", row.issues.join(" ")));
        const controls = node("div", "planning-intake-row-controls"), actionLabel = node("label", "", "Decision"), action = node("select"); action.setAttribute("aria-label", `Decision for ${row.name}`);
        for (const [value, label] of [["", "Choose a decision"], ["match", "Match existing product"], ["create", "Create planning product"], ["ignore", "Ignore this row"]]) action.append(option(value, label)); action.value = choice.action; actionLabel.append(action); controls.append(actionLabel);
        listen(action, "change", () => { choice.action = action.value; choice.fields = []; choice.overrideProtected = false; renderRows(); refreshSummary(); });
        if (choice.action === "match") {
          const targetLabel = node("label", "", "Existing product"), target = node("select"); target.setAttribute("aria-label", `Match product for ${row.name}`); target.append(option("", "Choose a product"));
          const candidates = row.suggestions, sorted = allProducts().sort((a, b) => (candidates.find(x => x.productId === b.product.id)?.rank || 0) - (candidates.find(x => x.productId === a.product.id)?.rank || 0));
          for (const { product, category } of sorted) { const reason = candidates.find(x => x.productId === product.id)?.reason; target.append(option(product.id, `${product.name} · ${category.name}${reason ? ` · ${reason}` : ""}`)); }
          target.value = choice.productId || ""; targetLabel.append(target); controls.append(targetLabel);
          listen(target, "change", () => { choice.productId = target.value; choice.fields = []; choice.overrideProtected = false; renderRows(); refreshSummary(); });
          if (choice.productId && adapter.openProduct) { const open = node("button", "", "View product"); open.type = "button"; listen(open, "click", () => { dialog.close(); adapter.openProduct(choice.productId); }); controls.append(open); }
        }
        if (choice.action === "create") {
          const categoryLabel = node("label", "", "Category"), category = node("select"); category.setAttribute("aria-label", `Category for ${row.name}`); category.append(option("", "Choose a category")); for (const item of review.categories) category.append(option(item.id, item.name)); category.value = choice.categoryId || ""; categoryLabel.append(category); controls.append(categoryLabel);
          listen(category, "change", () => { choice.categoryId = category.value; choice.laneId = ""; renderRows(); });
          const laneLabel = node("label", "", "Lane"), lane = node("select"); lane.setAttribute("aria-label", `Lane for ${row.name}`); lane.append(option("", "Choose a lane")); for (const item of review.categories.find(item => item.id === choice.categoryId)?.lanes || []) lane.append(option(item.id, item.label)); lane.value = choice.laneId || ""; laneLabel.append(lane); controls.append(laneLabel); listen(lane, "change", () => { choice.laneId = lane.value; refreshSummary(); });
        }
        article.append(controls);
        if (["match", "create"].includes(choice.action)) {
          const existing = choice.action === "match" ? allProducts().find(item => item.product.id === choice.productId) : null;
          const fields = node("div", "planning-intake-fields");
          for (const field of model.fields) {
            const label = field === "name" ? "Working name" : field === "codename" ? "Codename" : model.dateFields[field];
            const line = node("div", "planning-intake-field"), approveLabel = node("label", "planning-intake-field-check"), check = node("input"); check.type = "checkbox"; check.checked = choice.fields.includes(field); check.setAttribute("aria-label", `Apply ${label} for ${row.name}`); approveLabel.append(check, node("span", "", label));
            const input = node("input"); input.type = "text"; input.maxLength = 300; input.setAttribute("aria-label", `${label} value for ${row.name}`); input.placeholder = field in model.dateFields ? "YYYY-MM-DD or Q2 2028" : label;
            input.value = Object.hasOwn(choice.values, field) ? choice.values[field] : field in model.dateFields ? row.dates[field]?.usable ? row.dates[field].period?.label || row.dates[field].value : row.dates[field]?.raw || "" : row[field] || "";
            if (field === "name" && choice.action === "create") { check.checked = true; check.disabled = true; if (!choice.fields.includes(field)) choice.fields.push(field); }
            const current = existing?.product[field] || "";
            const evidence = existing && field in model.dateFields ? root.PortfolioDatePrecision?.currentPeriod(existing.product, field) || (field === "ffsDate" ? root.PortfolioFfsRoadmap?.period(existing.product) : null) : null;
            const before = node("span", "planning-intake-before", existing ? `Current: ${evidence?.label || current || "TBD"}` : "New planning product");
            const policy = field in model.dateFields && existing ? model.protection(existing.category.id, existing.product.id, field) : null;
            if (policy?.protected || policy?.unavailable) { before.textContent += policy.unavailable ? " · Protection unavailable" : " · Protected"; line.classList.add("is-protected"); }
            listen(check, "change", () => { choice.fields = check.checked ? [...new Set([...choice.fields, field])] : choice.fields.filter(value => value !== field); refreshSummary(); });
            listen(input, "input", () => { choice.values[field] = input.value; refreshSummary(); });
            line.append(approveLabel, input, before); fields.append(line);
            if (field === "ffsDate" && row.proposal?.usable) { const propose = node("button", "planning-intake-proposal", `Use proposed ${row.proposal.period?.label || row.proposal.value} as FFS estimate`); propose.type = "button"; listen(propose, "click", () => { choice.values.ffsDate = row.proposal.period?.label || row.proposal.value; choice.fields = [...new Set([...choice.fields, "ffsDate"])]; renderRows(); refreshSummary(); }); fields.append(propose); }
          }
          article.append(fields);
          const overrideLabel = node("label", "planning-intake-override"), override = node("input"); override.type = "checkbox"; override.checked = choice.overrideProtected === true; override.setAttribute("aria-label", `Override protected selected dates for ${row.name}`); overrideLabel.append(override, node("span", "", "I approve replacing any protected date fields selected for this row.")); listen(override, "change", () => { choice.overrideProtected = override.checked; refreshSummary(); }); article.append(overrideLabel);
        }
        rowsHost.append(article);
      }
      refreshSummary();
    }
    async function parse(sheetName) {
      if (busy || !file) { if (!file) status.textContent = "Choose a planning file first."; return; }
      const token = ++generation; setBusy(true); status.textContent = "Reading local planning file…";
      try {
        const parsed = await model.parseFile(file, { sourceFamily: familyInput.value.trim(), ...(sheetName ? { sheetName } : {}) });
        if (destroyed || token !== generation) return;
        dataset = parsed; review = model.buildReview(dataset, adapter.getPortfolio());
        sheetSelect.replaceChildren(...dataset.sheets.map(sheet => option(sheet.name, sheet.name))); sheetSelect.value = dataset.source.sheet;
        const saved = new Map(remembered().map(decision => [decision.key, decision])), ids = new Set(allProducts().map(item => item.product.id));
        choices = new Map(review.rows.map(row => { const old = saved.get(row.key), linked = row.suggestions.filter(item => item.rank === 100); const recalled = old?.action === "ignore" ? { action: "ignore" } : old?.productId && ids.has(old.productId) ? { action: "match", productId: old.productId } : linked.length === 1 ? { action: "match", productId: linked[0].productId } : {}; return [row.key, { key: row.key, action: "", productId: "", categoryId: "", laneId: "", fields: [], values: {}, overrideProtected: false, ...recalled }]; }));
        page = 0; toolbar.hidden = false; renderRows(); status.textContent = `${dataset.rows.length} rows ready. ${dataset.source.sheet}. All changed fields start unselected; choose each field you approve.`;
      } catch (error) { review = null; dataset = null; rowsHost.replaceChildren(); toolbar.hidden = true; summary.textContent = ""; status.textContent = error.message || "Could not read the planning file."; }
      finally { if (!destroyed && token === generation) { setBusy(false); refreshSummary(); } }
    }
    function chooseFile(incoming) { if (busy) return false; file = incoming || null; generation++; review = null; dataset = null; choices.clear(); rowsHost.replaceChildren(); toolbar.hidden = true; apply.disabled = true; summary.textContent = ""; sheetSelect.replaceChildren(); sheetSelect.disabled = true; selectedFile.textContent = file?.name || ""; if (file && !familyInput.value) familyInput.value = file.name.replace(/\.(xlsx|csv|tsv)$/i, "").slice(0, 150); status.textContent = file ? "File selected. Review file to preview its rows." : "No file selected."; notifyState(); return true; }
    listen(fileInput, "change", () => { chooseFile(fileInput.files?.[0]); });
    listen(parseButton, "click", () => { void parse(); }); listen(sheetSelect, "change", () => { void parse(sheetSelect.value); });
    listen(familyInput, "input", () => { if (!review) return; generation++; review = null; dataset = null; choices.clear(); rowsHost.replaceChildren(); toolbar.hidden = true; apply.disabled = true; summary.textContent = ""; sheetSelect.disabled = true; status.textContent = "Source collection changed. Review file again before applying."; notifyState(); });
    listen(previous, "click", () => { page--; renderRows(); }); listen(next, "click", () => { page++; renderRows(); });
    listen(ignore, "click", () => { for (const choice of choices.values()) if (!choice.action) choice.action = "ignore"; renderRows(); });
    listen(apply, "click", async () => {
      if (busy || !review) return; setBusy(true); status.textContent = "Checking reviewed choices…";
      try { const result = model.applyReview(review, [...choices.values()], adapter.getPortfolio()); await adapter.applyPlanning(result); const stored = remember(result); status.textContent = `Applied ${result.summary.created} new products and ${result.summary.updated} updates. ${result.summary.ignored} rows ignored. ${result.summary.unchanged} unchanged.${stored ? " Matching decisions saved on this device." : " Matching decisions could not be saved on this device."}`; review = null; dataset = null; choices.clear(); rowsHost.replaceChildren(); toolbar.hidden = true; summary.textContent = ""; }
      catch (error) { status.textContent = error.message || "Planning choices could not be applied. Existing products were kept."; }
      finally { setBusy(false); refreshSummary(); }
    });
    listen(close, "click", () => { if (!busy) dialog.close(); }); listen(dialog, "cancel", event => { if (busy) event.preventDefault(); }); listen(dialog, "close", () => { returnFocus?.focus?.({ preventScroll: true }); });
    return Object.freeze({ open(incoming) { if (destroyed) return; if (!dialog.open) { returnFocus = document.activeElement; dialog.showModal(); } if (incoming && chooseFile(incoming)) { fileInput.value = ""; return parse(); } }, destroy() { destroyed = true; generation++; review = null; choices.clear(); abort.abort(); dialog.remove(); notifyState(); }, getState: state });
  }
  root.PortfolioPlanningIntakeUI = Object.freeze({ create, storageKey: STORAGE_KEY });
})(globalThis);
