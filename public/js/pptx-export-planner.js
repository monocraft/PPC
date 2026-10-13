(function registerPptxExportPlanner(globalObject) {
  "use strict";

  const FONT_SIZE = 12;
  const FRAME = Object.freeze({ x: .38, y: 1.15, width: 12.55, height: 5.62, labelWidth: 3.98, headerHeight: .27, gap: .07 });
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const STATUS_LABELS = Object.freeze({ launched: "Launched", released: "Launched", "in-development": "In development", "in-planning": "In planning", concept: "In planning", embargo: "Embargo", "end-of-life": "End of life" });
  const statusLabel = product => product.statusLabel || STATUS_LABELS[product.status] || product.status || "";
  let measuringContext;
  const monthIndex = (value) => {
    const match = String(value || "").match(/^(\d{4})-(0[1-9]|1[0-2])$/);
    return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : null;
  };
  const monthString = (index) => `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`;
  const monthLabel = (index) => `${MONTH_NAMES[index % 12]} ${Math.floor(index / 12)}`;
  const hex = (value, fallback) => /^#[a-f\d]{6}$/i.test(String(value || "")) ? value.slice(1).toUpperCase() : fallback;

  function measureName(text, fontFace) {
    if (globalObject.document?.createElement) {
      const context = measuringContext ||= globalObject.document.createElement("canvas").getContext("2d");
      if (context) {
        context.font = `${FONT_SIZE * 96 / 72}px "${fontFace}"`;
        return context.measureText(text).width / 96;
      }
    }
    // Used by standalone consumers without a font engine. Conservatively
    // reserve wide characters; the browser measures its actual loaded font.
    return [...text].reduce((width, character) => width + (/\s/.test(character) ? .045 : /[MW@]/.test(character) ? .15 : .095), 0);
  }

  function wrapName(value, width, measure) {
    const name = String(value || "Product").trim();
    const lines = [];
    let line = "";
    for (const word of name.split(/\s+/)) {
      if (line && measure(`${line} ${word}`) > width) { lines.push(line); line = ""; }
      if (measure(word) <= width) { line = line ? `${line} ${word}` : word; continue; }
      for (const character of word) {
        if (line && measure(line + character) > width) { lines.push(line); line = ""; }
        line += character;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : ["Product"];
  }

  function axisForRange(range, timelineWidth) {
    const unit = range.count <= 18 ? 1 : range.count <= 60 ? 3 : Math.max(12, Math.ceil(range.count / 120) * 12);
    const buckets = [];
    for (let start = range.start; start <= range.end;) {
      const end = Math.min(range.end, start + unit - 1 - start % unit);
      const year = Math.floor(start / 12);
      const label = unit === 1 ? MONTH_NAMES[start % 12] : unit === 3 ? `Q${Math.floor(start % 12 / 3) + 1}` : year === Math.floor(end / 12) ? String(year) : `${year}-${Math.floor(end / 12)}`;
      buckets.push({ start, end, year, label });
      start = end + 1;
    }
    // Wider ranges use year labels so the time axis keeps readable text.
    if (unit < 12 && buckets.some((bucket) => (bucket.end - bucket.start + 1) / range.count * timelineWidth < .27)) {
      return { unit: 12, buckets: Array.from({ length: Math.floor(range.end / 12) - Math.floor(range.start / 12) + 1 }, (_, index) => {
        const year = Math.floor(range.start / 12) + index;
        return { start: Math.max(range.start, year * 12), end: Math.min(range.end, year * 12 + 11), year, label: String(year) };
      }) };
    }
    return { unit, buckets };
  }

  function prepareSections(sections, range, options) {
    const ids = new Set(), categoryIds = new Set();
    const fontFace = options.fontFace || globalObject.PortfolioTheme?.fontFace || "Arial";
    const measure = typeof options.measureText === "function" ? options.measureText : (text) => measureName(text, fontFace);
    let outsideRangeCount = 0, unscheduledCount = 0;
    const prepared = (Array.isArray(sections) ? sections : []).map((section) => {
      if (!section?.id || categoryIds.has(section.id)) throw new Error("PowerPoint categories need distinct identities.");
      categoryIds.add(section.id);
      const products = [];
      for (const product of section.products || []) {
        if (!product?.id || ids.has(product.id)) throw new Error("PowerPoint products need distinct identities.");
        ids.add(product.id);
        const start = monthIndex(product.startMonth), end = monthIndex(product.endMonth);
        const scheduled = start != null && end != null && end >= start;
        if (scheduled && (end < range.start || start > range.end)) { outsideRangeCount += 1; continue; }
        if (!scheduled) unscheduledCount += 1;
        const lines = wrapName(product.name, FRAME.labelWidth - .22, measure);
        const priceLines = product.priceLabel ? wrapName(product.priceLabel, FRAME.labelWidth - .22, measure) : [];
        const status = statusLabel(product);
        const dateLines = scheduled ? [] : wrapName(`Dates TBD${status ? `. ${status}` : ""}`, FRAME.width - FRAME.labelWidth - .16, measure);
        products.push({ ...product, start, end, scheduled, lines, priceLines, dateLines, rowHeight: Math.max(.32, Math.max(lines.length + priceLines.length, dateLines.length) * .2 + .07) });
      }
      const nameLines = wrapName(section.name || section.id, FRAME.labelWidth - .22, measure);
      return { ...section, products, nameLines, headerHeight: Math.max(FRAME.headerHeight, nameLines.length * .2 + .06) };
    });
    return { sections: prepared, outsideRangeCount, unscheduledCount, fontFace };
  }

  function rowsForSections(sections) {
    const rows = [];
    let height = 0;
    sections.forEach((section) => {
      if (!section.products.length) return;
      rows.push({ kind: "category", section, top: height, height: section.headerHeight });
      height += section.headerHeight;
      let family = "";
      for (const product of section.products) {
        const nextFamily = String(product.family || "").trim();
        if (nextFamily && nextFamily !== family) {
          rows.push({ kind: "family", name: nextFamily, top: height, height: .24 });
          height += .24;
        }
        family = nextFamily;
        rows.push({ kind: "product", sectionId: section.id, product, top: height, height: product.rowHeight });
        height += product.rowHeight;
      }
      height += FRAME.gap;
    });
    return { rows, height: Math.max(0, height - FRAME.gap) };
  }

  function detailSlides(sections, range) {
    const slides = [];
    for (const section of sections) {
      let rows = [], height = 0, pageIndex = 0, family = "";
      const addHeader = () => { rows = [{ kind: "category", section, top: 0, height: section.headerHeight }]; height = section.headerHeight; family = ""; };
      const finish = () => { slides.push({ kind: "roadmap-detail", sections: [section], rows, height, range, pageIndex: pageIndex++, categoryId: section.id, categoryName: section.name }); };
      addHeader();
      for (const product of section.products) {
        const nextFamily = String(product.family || "").trim();
        const familyHeight = nextFamily ? .24 : 0;
        if (section.headerHeight + familyHeight + product.rowHeight > FRAME.height) throw new Error(`The full name of ${product.name} is too long for a readable PowerPoint page.`);
        if (height + (nextFamily && nextFamily !== family ? familyHeight : 0) + product.rowHeight > FRAME.height + 1e-9) { finish(); addHeader(); }
        if (nextFamily && nextFamily !== family) { rows.push({ kind: "family", name: nextFamily, top: height, height: familyHeight }); height += familyHeight; }
        family = nextFamily;
        rows.push({ kind: "product", sectionId: section.id, product, top: height, height: product.rowHeight });
        height += product.rowHeight;
      }
      finish();
    }
    return slides;
  }

  function coverageIntervals(products, range) {
    const ordered = products.filter((product) => product.scheduled).map((product) => ({ start: Math.max(range.start, product.start), end: Math.min(range.end, product.end) }))
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const intervals = [];
    for (const interval of ordered) {
      const last = intervals.at(-1);
      if (last && interval.start <= last.end + 1) last.end = Math.max(last.end, interval.end);
      else intervals.push({ ...interval });
    }
    return intervals;
  }

  function planRoadmap(sections, options = {}) {
    const start = monthIndex(options.startMonth), end = monthIndex(options.endMonth);
    if (start == null || end == null || end < start) return { slides: [], requiresDecision: true, reason: "Choose a valid start and end month for the roadmap.", validRange: false, selectedProductCount: 0, outsideRangeCount: 0, unscheduledCount: 0 };
    const range = { start, end, count: end - start + 1, startMonth: monthString(start), endMonth: monthString(end) };
    const prepared = prepareSections(sections, range, options);
    const selectedProductCount = prepared.sections.reduce((count, section) => count + section.products.length, 0);
    const merged = rowsForSections(prepared.sections);
    const exactFits = merged.height <= FRAME.height + 1e-9;
    const overviewRows = prepared.sections.map((section) => ({ kind: "overview", section, height: Math.max(.45, section.nameLines.length * .2 + .24), intervals: coverageIntervals(section.products, range) }));
    let overviewHeight = 0;
    overviewRows.forEach((row) => { row.top = overviewHeight; overviewHeight += row.height; });
    const overviewFits = overviewHeight <= FRAME.height + 1e-9;
    const mode = options.mode === "merged" ? "merged" : "categories";
    const overflow = ["overview-details", "details"].includes(options.overflow) ? options.overflow : "ask";
    const result = { ...prepared, range, selectedProductCount, exactFits, overviewFits, minimumFontSize: FONT_SIZE, validRange: true, requiresDecision: false, reason: "", slides: [] };
    if (mode === "categories") { result.slides = detailSlides(prepared.sections, range); return result; }
    if (exactFits) { result.slides = [{ kind: "roadmap-merged", sections: prepared.sections, rows: merged.rows, range, height: merged.height }]; return result; }
    result.reason = `${selectedProductCount} products across ${prepared.sections.length} categories need more room than one readable slide. Choose an overview with detailed pages, use detailed pages, or reduce the categories or period.`;
    if (overflow === "ask" || (overflow === "overview-details" && !overviewFits)) {
      result.requiresDecision = true;
      if (!overviewFits) result.reason += " The category summaries also need more than one slide; choose detailed pages or fewer categories.";
      return result;
    }
    const details = detailSlides(prepared.sections, range);
    result.slides = overflow === "overview-details" ? [{ kind: "roadmap-overview", sections: prepared.sections, rows: overviewRows, range, height: overviewHeight }, ...details] : details;
    return result;
  }

  function readOptions(form) {
    return { mode: form?.querySelector('input[name="pptxRoadmapLayout"]:checked')?.value || "categories",
      startMonth: form?.querySelector("#pptxRoadmapStart")?.value || "", endMonth: form?.querySelector("#pptxRoadmapEnd")?.value || "",
      overflow: form?.querySelector('input[name="pptxRoadmapOverflow"]:checked')?.value || "ask" };
  }

  function syncDialog(form, plan, { includeRoadmap = true } = {}) {
    const section = form?.querySelector("#pptxRoadmapOptions");
    if (!section) return;
    section.hidden = !includeRoadmap;
    const merged = readOptions(form).mode === "merged";
    const overflow = form.querySelector("#pptxRoadmapOverflow");
    overflow.hidden = !includeRoadmap || !merged || plan.exactFits || !plan.validRange;
    const overviewChoice = form.querySelector('input[name="pptxRoadmapOverflow"][value="overview-details"]');
    if (overviewChoice) overviewChoice.disabled = !plan.overviewFits;
    const fit = form.querySelector("#pptxRoadmapFit"), coverage = form.querySelector("#pptxRoadmapCoverage");
    if (fit) fit.textContent = plan.reason || (merged ? "Every selected product fits on one slide with readable labels." : "Products remain readable on separate category pages.");
    if (coverage) coverage.textContent = plan.validRange ? `${plan.selectedProductCount} products in this period. ${plan.outsideRangeCount} outside the period. ${plan.unscheduledCount} with dates to be confirmed remain included.` : "";
  }

  function addSlide(pptx, plan, options = {}) {
    if (!plan?.range || !Array.isArray(plan.rows)) throw new Error("The roadmap export plan is incomplete.");
    const slide = pptx.addSlide();
    const colors = options.theme?.colors || globalObject.PortfolioTheme?.colors || {};
    const background = hex(colors.page, "1A1B1C"), panel = hex(colors.surface, "242527"), header = hex(colors.header, "333538"), label = hex(colors.body || colors.text, "D5D7DC");
    const fontFace = options.fontFace || globalObject.PortfolioTheme?.fontFace || "Arial";
    slide.background = { color: background };
    const text = (value, rect, extra = {}) => slide.addText(value, { ...rect, fontFace, fontSize: FONT_SIZE, color: label, margin: 0, valign: "top", breakLine: false, wrap: false, paraSpaceAfter: 0, ...extra });
    const shape = (rect, fill, objectName) => slide.addShape(pptx.ShapeType.rect, { ...rect, objectName, fill: { color: fill }, line: { color: fill, width: 0, transparency: 100 } });
    const overview = plan.kind === "roadmap-overview";
    const title = options.title || (overview ? "Roadmap overview" : plan.kind === "roadmap-merged" ? "Combined roadmap" : `${plan.categoryName || plan.categoryId} Roadmap${plan.pageIndex ? " (continued)" : ""}`);
    text(title, { x: FRAME.x, y: .16, w: FRAME.width, h: .38 }, { fontSize: 20, bold: true });
    const period = `${monthLabel(plan.range.start)} to ${monthLabel(plan.range.end)}`;
    const subtitle = overview ? `${period}. Category summaries; full product names and statuses follow on detailed pages.` : period;
    text(subtitle, { x: FRAME.x, y: .64, w: FRAME.width, h: .22 }, { fontSize: 11 });
    const timelineX = FRAME.x + FRAME.labelWidth, timelineWidth = FRAME.width - FRAME.labelWidth;
    const axis = axisForRange(plan.range, timelineWidth);
    for (const bucket of axis.buckets) {
      const x = timelineX + (bucket.start - plan.range.start) / plan.range.count * timelineWidth;
      const w = (bucket.end - bucket.start + 1) / plan.range.count * timelineWidth;
      if (w >= .27) {
        const axisLabel = axis.unit >= 12 ? bucket.label : `${bucket.label} ${String(bucket.year).slice(-2)}`;
        const labelWidth = Math.max(w, measureName(axisLabel, fontFace) + .04);
        const labelX = Math.max(FRAME.x, Math.min(FRAME.x + FRAME.width - labelWidth, x + (w - labelWidth) / 2));
        text(axisLabel, { x: labelX, y: .89, w: labelWidth, h: .23 }, { align: "center", fontSize: 12 });
      }
    }
    const bar = (start, end, y, height, fill, objectName) => {
      const x = timelineX + (Math.max(plan.range.start, start) - plan.range.start) / plan.range.count * timelineWidth;
      const right = timelineX + (Math.min(plan.range.end, end) - plan.range.start + 1) / plan.range.count * timelineWidth;
      shape({ x, y, w: Math.max(.015, right - x), h: height }, fill, objectName);
    };
    let productIndex = 0;
    const productGroups = [];
    for (const row of plan.rows) {
      const y = FRAME.y + row.top;
      if (row.kind === "category") {
        shape({ x: FRAME.x, y, w: FRAME.width, h: row.height }, header, `Category: ${row.section.id}`);
        text(row.section.nameLines.join("\n"), { x: FRAME.x + .08, y: y + .035, w: FRAME.labelWidth - .16, h: row.height - .04 }, { bold: true });
      } else if (row.kind === "family") {
        text(row.name, { x: FRAME.x + .08, y: y + .02, w: FRAME.width - .16, h: row.height - .025 }, { color: hex(colors.label, "BBBCC0"), bold: true });
      } else if (row.kind === "overview") {
        const section = row.section;
        shape({ x: FRAME.x, y, w: FRAME.width, h: row.height - .035 }, panel, `Category summary: ${section.id}`);
        text(section.nameLines.join("\n"), { x: FRAME.x + .08, y: y + .025, w: FRAME.labelWidth - .16, h: section.nameLines.length * .2 }, { bold: true });
        const unscheduled = section.products.filter((product) => !product.scheduled).length;
        text(`${section.products.length} products${unscheduled ? `, ${unscheduled} dates TBD` : ""}`, { x: FRAME.x + .08, y: y + section.nameLines.length * .2 + .055, w: FRAME.labelWidth - .16, h: .2 }, { fontSize: 11 });
        row.intervals.forEach((interval, index) => bar(interval.start, interval.end, y + row.height / 2 - .065, .13, "676A70", `Category coverage: ${section.id}:${index}`));
      } else {
        const product = row.product;
        if (productIndex % 2 === 0) shape({ x: FRAME.x, y, w: FRAME.width, h: row.height }, panel, `Roadmap row: ${product.id}`);
        const prefix = `ppc-roadmap-${productIndex++}-part-`;
        const labelLines = [...product.lines, ...product.priceLines];
        text(labelLines.join("\n"), { x: FRAME.x + .08, y: y + .035, w: FRAME.labelWidth - .22, h: labelLines.length * .2 + .01 }, { objectName: `${prefix}0`, bold: false });
        if (product.scheduled) bar(product.start, product.end, y + row.height / 2 - .09, .18, hex(product.fill, "4D5054"), `${prefix}1`);
        else text(product.dateLines.join("\n"), { x: timelineX + .08, y: y + .035, w: timelineWidth - .16, h: product.dateLines.length * .2 + .01 }, { objectName: `${prefix}1` });
        productGroups.push({ prefix, name: `Product: ${product.id} — ${product.name}`, x: FRAME.x, y, width: FRAME.width, height: row.height, partCount: 2 });
      }
    }
    if (!plan.rows.some((row) => row.kind === "product" || row.kind === "overview")) {
      text("No products in the selected period", { x: FRAME.x + .08, y: FRAME.y + .42, w: FRAME.width - .16, h: .24 });
    }
    if (!overview) {
      const legend = new Map();
      plan.rows.filter(row => row.kind === "product" && row.product.scheduled).forEach(({ product }) => {
        const status = statusLabel(product);
        if (status) legend.set(`${status}:${product.fill}`, { status, fill: hex(product.fill, "4D5054") });
      });
      let x = FRAME.x, y = 7.01;
      for (const entry of legend.values()) {
        const width = measureName(entry.status, fontFace) + .34;
        if (x + width > FRAME.x + FRAME.width) { x = FRAME.x; y += .24; }
        if (y + .2 > 7.48) throw new Error("The roadmap status legend needs more room. Reduce the selected categories.");
        shape({ x, y: y + .045, w: .14, h: .1 }, entry.fill, `Status: ${entry.status}`);
        text(entry.status, { x: x + .2, y, w: width - .22, h: .22 });
        x += width;
      }
    }
    globalObject.PPTXEditable?.registerSlide(pptx, productGroups);
    return slide;
  }

  globalObject.PPTXExportPlanner = Object.freeze({ FONT_SIZE, FRAME, monthIndex, wrapName, planRoadmap, readOptions, syncDialog, addSlide });
}(globalThis));
