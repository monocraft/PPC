/* Product integrity review. Names and HP SKUs may repeat across product portfolios. */
(function (root) {
  "use strict";

  const references = new WeakMap();
  let active = null;
  const text = (value) => String(value ?? "").trim();
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const normalizeSku = (value) => text(value).normalize("NFKC").toUpperCase();
  const normalizeName = (value) => text(value).replace(/[®™©]/g, "").normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
  const array = (value) => Array.isArray(value) ? value : [];
  const issueKey = (kind, value, suffix = "") => `${kind}:${encodeURIComponent(value)}${suffix ? `:${suffix}` : ""}`;
  const portfolioIssueKey = (kind, value, entry) => issueKey(kind, value, entry.locator.categoryId
    ? `portfolio-id-${encodeURIComponent(entry.locator.categoryId)}` : `portfolio-index-${entry.locator.categoryIndex}`);

  function products(portfolio) {
    const output = [];
    array(portfolio?.categories).forEach((category, categoryIndex) => {
      array(category?.board?.products).forEach((product, productIndex) => {
        if (!product || typeof product !== "object") return;
        const locator = { categoryId: text(category?.id), categoryIndex, productId: text(product.id), productIndex, productName: text(product.name) };
        references.set(locator, product);
        const lane = array(category?.board?.lanes).find((item) => text(item?.id) === text(product.laneId));
        output.push({ locator, product, category, categoryName: text(category?.name) || "Unnamed category", productName: text(product.name) || "Unnamed product",
          laneName: text(lane?.label || lane?.name) || text(product.laneId) || "No lane" });
      });
    });
    return output;
  }

  function member(entry, focus = {}) {
    return { locator: entry.locator, categoryName: entry.categoryName, productName: entry.productName, laneName: entry.laneName, focus: { ...focus } };
  }

  function buckets(entries, getKey) {
    const result = new Map();
    for (const entry of entries) {
      const key = getKey(entry);
      if (!key) continue;
      const matches = result.get(key) || [];
      matches.push(entry); result.set(key, matches);
    }
    return [...result].filter(([, matches]) => matches.length > 1);
  }

  function scan(portfolio) {
    const entries = products(portfolio), issues = [];
    for (const [id, matches] of buckets(entries, (entry) => text(entry.product.id))) {
      issues.push({ id: issueKey("product-id", id), kind: "product-id", severity: "error", code: id, title: "Products share the same internal ID",
        description: `Internal ID “${id}” appears on ${matches.length} products. Give each product its own ID before sharing these changes.`,
        guidance: "Product names can stay the same. Correct the duplicate IDs in the source package and import it again; no products are removed automatically.", members: matches.map((entry) => member(entry, { section: "identity" })) });
    }
    const hpRows = [];
    for (const entry of entries) {
      array(entry.product.partSkus).forEach((row, rowIndex) => {
        const code = normalizeSku(typeof row === "string" ? row : row?.code || row?.sku || row?.value || row?.basePn);
        if (code) hpRows.push({ entry, code, rowIndex, rowId: typeof row === "object" ? text(row?.id) : "" });
      });
    }
    // The same product may be sold in PC and Console portfolios. Review assignments
    // only within the containing portfolio, while internal IDs remain global above.
    for (const [, matches] of buckets(hpRows, (row) => `${row.entry.locator.categoryIndex}\u0000${row.code}`)) {
      const code = matches[0].code, entry = matches[0].entry;
      const sameProduct = new Set(matches.map((row) => row.entry.product)).size === 1;
      const assignments = new Map();
      for (const row of matches) assignments.set(row.entry.product, (assignments.get(row.entry.product) || 0) + 1);
      const repeatedOnProduct = [...assignments.values()].some((count) => count > 1);
      issues.push({ id: portfolioIssueKey("hp-sku", code, entry), kind: "hp-sku", severity: repeatedOnProduct ? "error" : "warning", code, title: `Repeated HP SKU · ${code}`,
        description: sameProduct ? `HP SKU “${code}” is listed ${matches.length} times on the same product in ${entry.categoryName}.` : `HP SKU “${code}” is assigned to ${matches.length} rows in ${entry.categoryName}.`,
        guidance: "Open each assignment to compare the products and update the HP SKU or remove an unintended duplicate row. Matching HP SKUs in different product portfolios are allowed.",
        members: matches.map((row) => ({ ...member(row.entry, { section: "partSkus", rowIndex: row.rowIndex, rowId: row.rowId }), detail: `HP SKU row ${row.rowIndex + 1}` })) });
    }
    // Color/locale abbreviations belong to each product. Repeating BK on two products is valid.
    for (const entry of entries) {
      const rows = [];
      array(entry.product.variantGroups).forEach((group, groupIndex) => {
        array(group?.items).forEach((row, rowIndex) => {
          const code = normalizeSku(row?.code);
          if (code) rows.push({ code, type: text(group?.type) || "color", groupIndex, groupId: text(group?.id), rowIndex, rowId: text(row?.id) });
        });
      });
      for (const [key, matches] of buckets(rows, (row) => `${row.type}\u0000${row.code}`)) {
        const code = matches[0].code, type = matches[0].type;
        issues.push({ id: issueKey("variant-sku", key, `${entry.locator.categoryIndex}-${entry.locator.productIndex}`), kind: "variant-sku", severity: "error", code,
          title: `Repeated ${type === "layout" ? "layout" : "color"} code · ${code}`, description: `The same ${type} code appears on ${matches.length} variant rows of ${entry.productName}.`,
          guidance: "Check the highlighted variant rows. Codes must be unique within each variant type on this product.",
          members: matches.map((row) => ({ ...member(entry, { section: "variantGroups", groupIndex: row.groupIndex, groupId: row.groupId, rowIndex: row.rowIndex, rowId: row.rowId }), detail: `${type === "layout" ? "Layout" : "Color"} variant row ${row.rowIndex + 1}` })) });
      }
    }
    for (const [, matches] of buckets(entries, (entry) => {
      const name = normalizeName(entry.product.name);
      return name ? `${entry.locator.categoryIndex}\u0000${name}` : "";
    })) {
      const entry = matches[0], name = normalizeName(entry.product.name);
      issues.push({ id: portfolioIssueKey("possible-name", name, entry), kind: "possible-name", severity: "info", code: name, title: `Possible product match · ${entry.productName}`,
        description: `${matches.length} products in ${entry.categoryName} have the same name after ignoring capitalization, spacing, and trademark symbols.`,
        guidance: "These may be intentional variants. Compare them; matching names do not block saving. Products in different product portfolios are checked separately.", members: matches.map((entry) => member(entry, { section: "name" })) });
    }
    return issues;
  }

  /** Resolve the actual record, never the first matching ID when identities are duplicated. */
  function resolveLocator(portfolio, locator) {
    if (!locator || typeof locator !== "object") return null;
    const entries = products(portfolio), reference = references.get(locator);
    if (reference) return entries.find((entry) => entry.product === reference) || null;
    const candidates = entries.filter((entry) => entry.locator.categoryId === text(locator.categoryId)
      && entry.locator.productId === text(locator.productId)
      && (locator.productName == null || entry.locator.productName === text(locator.productName)));
    const exact = candidates.find((entry) => entry.locator.categoryIndex === locator.categoryIndex && entry.locator.productIndex === locator.productIndex);
    return exact || (candidates.length === 1 ? candidates[0] : null);
  }

  function navigationFor(portfolio, location) {
    const located = resolveLocator(portfolio, location?.locator || location);
    if (!located) return null;
    return { ...located, clearSearch: true, clearRoadmapSearch: true, revealAllLanes: true, focus: { ...(location?.focus || {}) } };
  }

  function buildAscmIssues(plan, portfolio) {
    const entries = products(portfolio), result = [];
    array(plan?.items).forEach((item, index) => {
      if (item?.action !== "ambiguous" && item?.match?.status !== "ambiguous") return;
      const candidates = array(item?.match?.candidates);
      const found = [];
      for (const candidate of candidates) {
        const matches = entries.filter((entry) => entry.locator.categoryId === text(candidate?.categoryId) && entry.locator.productId === text(candidate?.productId)
          && (!candidate?.productName || entry.locator.productName === text(candidate.productName)));
        for (const entry of matches) if (!found.some((location) => references.get(location.locator) === entry.product)) found.push(member(entry, { section: "name" }));
      }
      if (!found.length && item?.matchedProductId) {
        for (const entry of entries.filter((entry) => entry.locator.productId === text(item.matchedProductId) && (!item.matchedCategoryId || entry.locator.categoryId === text(item.matchedCategoryId)))) found.push(member(entry, { section: "name" }));
      }
      if (!found.length) return; // An unmapped import group has no existing product to locate.
      const name = text(item?.group?.displayName || item?.group?.records?.[0]?.description) || "ASCM product";
      result.push({ id: issueKey("ascm-match", name, String(index)), kind: "ascm-match", severity: "warning", code: name, ascmIndex: index, title: `Review ASCM match · ${name}`,
        description: "The report cannot select one existing product safely. This group will be skipped until its mapping is clear.",
        guidance: "Open the candidate products to compare their names and HP SKUs, then import the report again.", members: found });
    });
    return result;
  }

  function summary(issues) {
    const count = array(issues).length;
    const possible = array(issues).filter((issue) => issue.kind === "possible-name").length;
    const errors = array(issues).filter((issue) => issue.severity === "error").length;
    const affected = new Set(array(issues).flatMap((issue) => issue.members.map((location) => `${location.locator.categoryIndex}:${location.locator.productIndex}`))).size;
    return { count, possible, errors, affected, title: count ? `${count} product ${count === 1 ? "check" : "checks"} to review` : "No duplicate assignments found",
      message: count ? `${affected} ${affected === 1 ? "product needs" : "products need"} review.${possible ? ` ${possible} ${possible === 1 ? "is a possible name match" : "are possible name matches"}.` : ""}` : "Product IDs, HP SKUs, and variant assignments have no detected duplicates." };
  }

  function renderIssues(issues) {
    return array(issues).map((issue, issueIndex) => `<article class="product-issue-card is-${escapeHtml(issue.severity)}" data-product-issue="${issueIndex}">
      <div class="product-issue-heading"><span class="product-issue-severity">${issue.kind === "possible-name" ? "Possible match" : issue.severity === "error" ? "Needs correction" : "Review assignment"}</span><h3>${escapeHtml(issue.title)}</h3></div>
      <p>${escapeHtml(issue.description)}</p><p class="product-issue-guidance">${escapeHtml(issue.guidance)}</p>
      <ul class="product-issue-locations">${array(issue.members).map((location, memberIndex) => `<li><div><strong>${escapeHtml(location.productName)}</strong><span>${escapeHtml(location.categoryName)} · ${escapeHtml(location.laneName)}</span>${location.detail ? `<small>${escapeHtml(location.detail)}</small>` : ""}</div><button type="button" class="small-button" data-open-product-issue="${issueIndex}" data-issue-member="${memberIndex}" aria-label="${escapeHtml(`Open ${location.productName} in ${location.categoryName}${location.detail ? `, ${location.detail}` : ""}`)}">Open product<span aria-hidden="true"> ↗</span></button></li>`).join("")}</ul>
    </article>`).join("");
  }

  function createController({ adapter, notifications, document: doc = root.document, onChange = () => {} } = {}) {
    let issues = [], ascmPlan = null, dialog = null, signature = "", destroyed = false, refreshTimer = null, reviewFilter = null, displayedIssues = [];
    let restoreFocus = null;
    const state = () => ({ issues: issues.slice(), ...summary(issues) });
    const allIssues = () => {
      const current = adapter?.getPortfolio?.();
      const plan = ascmPlan ? adapter?.rebuildAscmPlan?.(ascmPlan) || ascmPlan : null;
      return [...scan(current), ...buildAscmIssues(plan, current)];
    };

    function notify() {
      const details = summary(issues);
      const center = notifications || root.PortfolioNotifications;
      if (details.count) center?.publish?.({ id: "product-duplicates", severity: issues.some((issue) => issue.severity !== "info") ? "warning" : "info", title: details.title, message: details.message, dismissible: false, toast: false,
        actions: [{ label: "Review products", onClick: () => reviewDuplicateIssues() }] });
      else center?.resolve?.("product-duplicates");
      adapter?.onIssuesChanged?.(state());
      onChange(state());
    }
    function render() {
      if (!dialog) return;
      displayedIssues = reviewFilter ? issues.filter(reviewFilter) : issues;
      const details = summary(displayedIssues);
      const note = dialog.querySelector("[data-product-issues-summary]");
      note.textContent = details.count ? `${details.message} Select Open product to jump to its category and the field that needs attention.` : "No duplicate assignments found. Matching names are shown as possible matches and never block saving.";
      const list = dialog.querySelector("[data-product-issues-list]");
      const oldScroll = list.scrollTop;
      list.innerHTML = details.count ? renderIssues(displayedIssues) : '<div class="product-issues-empty"><span aria-hidden="true">✓</span><h3>Everything is clear</h3><p>There are no duplicate assignments to review.</p></div>';
      list.scrollTop = oldScroll;
      const count = dialog.querySelector("[data-product-issues-count]");
      count.textContent = String(details.count); count.hidden = !details.count;
    }
    function refresh({ force = false } = {}) {
      if (destroyed) return state();
      const next = allIssues();
      const nextSignature = JSON.stringify(next);
      issues = next;
      if (force || nextSignature !== signature) { signature = nextSignature; notify(); if (dialog?.open) render(); }
      return state();
    }
    function close() {
      if (!dialog?.open) return;
      if (typeof dialog.close === "function") dialog.close();
      else { dialog.removeAttribute("open"); dialog.hidden = true; }
      const focus = restoreFocus; restoreFocus = null;
      if (focus?.isConnected) focus.focus?.({ preventScroll: true });
    }
    function ensureDialog() {
      if (dialog || !doc?.createElement || !doc.body) return dialog;
      dialog = doc.createElement("dialog"); dialog.id = "productIssuesDialog"; dialog.className = "product-issues-dialog";
      dialog.setAttribute("aria-labelledby", "productIssuesTitle"); dialog.setAttribute("aria-describedby", "productIssuesSummary");
      dialog.innerHTML = '<div class="product-issues-header"><div><span class="eyebrow">Portfolio health</span><h2 id="productIssuesTitle">Review products <span class="product-issues-count" data-product-issues-count></span></h2></div><button type="button" class="icon-button" data-close-product-issues aria-label="Close product review">×</button></div><p id="productIssuesSummary" class="product-issues-summary" data-product-issues-summary></p><p class="product-issues-feedback" data-product-issues-feedback role="status" aria-live="polite"></p><div class="product-issues-list" data-product-issues-list></div><div class="product-issues-footer"><span>Changes stay in your draft until you save to master.</span><button type="button" class="small-button" data-refresh-product-issues>Check again</button><button type="button" class="primary-button" data-close-product-issues>Done</button></div>';
      dialog.addEventListener("click", async (event) => {
        if (event.target.closest("[data-close-product-issues]")) { close(); return; }
        if (event.target.closest("[data-refresh-product-issues]")) { refresh({ force: true }); dialog.querySelector("[data-product-issues-feedback]").textContent = "Checked the current portfolio."; return; }
        const button = event.target.closest("[data-open-product-issue]");
        if (!button) return;
        const issue = displayedIssues[Number(button.dataset.openProductIssue)], location = issue?.members[Number(button.dataset.issueMember)];
        const located = navigationFor(adapter?.getPortfolio?.(), location);
        if (!located) {
          refresh({ force: true });
          dialog.querySelector("[data-product-issues-feedback]").textContent = "This product changed or was removed. The review list has been refreshed.";
          return;
        }
        close();
        try {
          const result = await adapter?.openProduct?.(located, { focus: location.focus, issue });
          if (result === false) throw new Error("The product could not be opened. Check the current portfolio and try again.");
        } catch (error) {
          adapter?.onOpenError?.(error);
          reviewDuplicateIssues();
          dialog.querySelector("[data-product-issues-feedback]").textContent = error?.message || "The product could not be opened. Check again and retry.";
        }
      });
      dialog.addEventListener("keydown", (event) => {
        // The app's canvas shortcuts must not run while the review owns keyboard focus.
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); close(); }
      });
      dialog.addEventListener("cancel", (event) => { event.preventDefault(); event.stopPropagation(); close(); });
      doc.body.appendChild(dialog);
      return dialog;
    }
    function reviewDuplicateIssues(options = {}) {
      if (options.ascmPlan) ascmPlan = options.ascmPlan;
      reviewFilter = options.issueId ? (issue) => issue.id === options.issueId : Number.isInteger(options.ascmIndex) ? (issue) => issue.kind === "ascm-match" && issue.ascmIndex === options.ascmIndex : null;
      refresh({ force: true });
      if (!ensureDialog()) return state();
      render();
      dialog.querySelector("[data-product-issues-feedback]").textContent = "";
      if (!dialog.open) {
        restoreFocus = doc.activeElement;
        if (typeof dialog.showModal === "function") dialog.showModal();
        else { dialog.hidden = false; dialog.setAttribute("open", ""); }
      }
      return state();
    }
    const handleRender = () => { root.clearTimeout?.(refreshTimer); refreshTimer = root.setTimeout?.(() => refresh(), 180); };
    root.addEventListener?.("portfolio:render", handleRender);
    refresh({ force: true });
    return Object.freeze({ refresh, reviewDuplicateIssues, getState: state,
      setAscmPlan(plan) { ascmPlan = plan || null; return refresh({ force: true }); },
      clearAscmIssues() { ascmPlan = null; return refresh({ force: true }); }, close,
      destroy() { destroyed = true; root.clearTimeout?.(refreshTimer); root.removeEventListener?.("portfolio:render", handleRender); close(); dialog?.remove(); } });
  }

  function mount(options) { active?.destroy?.(); active = createController(options); return active; }
  root.PortfolioProductIssues = Object.freeze({ scan, products, resolveLocator, navigationFor, buildAscmIssues, summary, renderIssues, normalizeName, normalizeSku, createController, mount,
    refresh(options) { return active?.refresh(options); }, reviewDuplicateIssues(options) { return active?.reviewDuplicateIssues(options); }, setAscmPlan(plan) { return active?.setAscmPlan(plan); }, clearAscmIssues() { return active?.clearAscmIssues(); }, getState() { return active?.getState(); } });
})(typeof globalThis === "object" ? globalThis : window);
