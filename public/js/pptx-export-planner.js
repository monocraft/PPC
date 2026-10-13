(function registerPptxExportPlanner(globalObject) {
  "use strict";
  const FONT_SIZE = 12, COMPACT_FONT_SIZE = 7, COMPACT_ROW_HEIGHT = .16, COMPACT_BAR_HEIGHT = .08;
  const EXPORT_FONT_FACE = "HP Forma DJR Office";
  const STANDARD_CANVAS = Object.freeze({ width: 40 / 3, height: 7.5 }), MAX_CANVAS_SIZE = 56;
  const FRAME = Object.freeze({ x: .38, y: 1.25, width: 12.55, height: 5.50, labelWidth: 3.98, headerHeight: .27, gap: .07 });
  const COMPACT = Object.freeze({ margin: .38, nameWidth: 2.60, priceWidth: .52, priceGap: .08,
    labelPadding: .12, headerHeight: .20, familyHeight: .16, gap: .04, bodyTop: 1.25, axisTop: .68,
    monthFontSize: 6, quarterFontSize: 7, yearFontSize: 16, bottomMargin: .24 });
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const STATUS_LABELS = Object.freeze({ launched: "Launched", released: "Launched", "in-development": "In development", "in-planning": "In planning", concept: "In planning", embargo: "Embargo", "end-of-life": "End of life" });
  const statusLabel = product => product.statusLabel || STATUS_LABELS[product.status] || product.status || "";
  let measuringContext;
  const monthIndex = value => {
    const match = String(value || "").match(/^(\d{4})-(0[1-9]|1[0-2])$/);
    return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : null;
  };
  const monthString = index => `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`;
  const monthLabel = index => `${MONTH_NAMES[index % 12]} ${Math.floor(index / 12)}`;
  const hex = (value, fallback) => /^#[a-f\d]{6}$/i.test(String(value || "")) ? value.slice(1).toUpperCase() : fallback;

  function measureName(text, fontFace, fontSize = FONT_SIZE) {
    if (globalObject.document?.createElement) {
      const context = measuringContext ||= globalObject.document.createElement("canvas").getContext("2d");
      if (context) {
        context.font = `${fontSize * 96 / 72}px "${fontFace}"`;
        return context.measureText(text).width / 96;
      }
    }
    // The browser measures the loaded export font. Standalone consumers
    // without a font engine reserve conservative glyph widths at the same size.
    return [...text].reduce((width, character) => width + (/\s/.test(character) ? .045 : /[MW@]/.test(character) ? .15 : .095), 0) * fontSize / FONT_SIZE;
  }

  function wrapName(value, width, measure) {
    const name = String(value || "Product").trim(), lines = [];
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

  function measurement(options) {
    const fontFace = options.fontFace || EXPORT_FONT_FACE, cache = new Map();
    const measure = (text, size = FONT_SIZE) => {
      const key = `${size}:${text}`;
      if (!cache.has(key)) cache.set(key, typeof options.measureText === "function" ? options.measureText(text, size) : measureName(text, fontFace, size));
      const value = cache.get(key);
      if (!Number.isFinite(value) || value < 0) throw new Error("PowerPoint text could not be measured.");
      return value;
    };
    return { fontFace, measure };
  }

  function prepareSections(sections, range, options, compact) {
    const ids = new Set(), categoryIds = new Set(), metrics = measurement(options);
    const fontSize = compact ? COMPACT_FONT_SIZE : FONT_SIZE, measure = text => metrics.measure(text, fontSize);
    const hasPrices = compact && (sections || []).some(section => (section.products || []).some(product => product.priceLabel));
    const labelWidth = compact ? COMPACT.nameWidth + COMPACT.labelPadding + (hasPrices ? COMPACT.priceWidth + COMPACT.priceGap : 0) : FRAME.labelWidth;
    const monthWidth = Math.max(.16, ...MONTH_NAMES.map(name => metrics.measure(name, COMPACT.monthFontSize) + .04));
    const minimumTimelineWidth = Math.max(1.5, range.count * monthWidth);
    let outsideRangeCount = 0, unscheduledCount = 0;
    const prepared = (Array.isArray(sections) ? sections : []).map(section => {
      if (!section?.id || categoryIds.has(section.id)) throw new Error("PowerPoint categories need distinct identities.");
      categoryIds.add(section.id);
      const products = [];
      for (const product of section.products || []) {
        if (!product?.id || ids.has(product.id)) throw new Error("PowerPoint products need distinct identities.");
        ids.add(product.id);
        const start = monthIndex(product.startMonth), end = monthIndex(product.endMonth), scheduled = start != null && end != null && end >= start;
        if (scheduled && (end < range.start || start > range.end)) { outsideRangeCount++; continue; }
        if (!scheduled) unscheduledCount++;
        const lines = wrapName(product.name, compact ? COMPACT.nameWidth : FRAME.labelWidth - .22, measure);
        const priceLines = product.priceLabel ? wrapName(product.priceLabel, compact ? COMPACT.priceWidth : FRAME.labelWidth - .22, measure) : [];
        const status = statusLabel(product);
        const dateLines = scheduled ? [] : wrapName(`Dates TBD${status ? `. ${status}` : ""}`, compact ? minimumTimelineWidth - .12 : FRAME.width - FRAME.labelWidth - .16, measure);
        const rowHeight = compact ? Math.max(1, lines.length, priceLines.length, dateLines.length) * COMPACT_ROW_HEIGHT
          : Math.max(.32, Math.max(lines.length + priceLines.length, dateLines.length) * .2 + .07);
        const family = String(product.family || "").trim(), familyLines = family ? wrapName(family, compact ? COMPACT.nameWidth : FRAME.width - .16, measure) : [];
        products.push({ ...product, start, end, scheduled, lines, priceLines, dateLines, familyLines, rowHeight });
      }
      const nameLines = wrapName(section.name || section.id, compact ? COMPACT.nameWidth : FRAME.labelWidth - .22, measure);
      return { ...section, products, nameLines, headerHeight: compact ? Math.max(COMPACT.headerHeight, nameLines.length * COMPACT_ROW_HEIGHT + .04) : Math.max(FRAME.headerHeight, nameLines.length * .2 + .06) };
    });
    return { sections: prepared, outsideRangeCount, unscheduledCount, fontFace: metrics.fontFace, measure: metrics.measure, labelWidth,
      nameWidth: compact ? COMPACT.nameWidth : FRAME.labelWidth - .22, priceWidth: hasPrices ? COMPACT.priceWidth : 0, monthWidth, minimumTimelineWidth };
  }

  // Keep a header with its first product and repeat category/family headings
  // on continuation columns. Exact source order and identities are preserved.
  function packColumns(sections, capacity, limit, compact) {
    const columns = [{ rows: [], height: 0 }];
    let column = columns[0], categoryId = "", family = "";
    const add = row => { row.top = column.height; column.rows.push(row); column.height += row.height; };
    for (const section of sections) for (const product of section.products) {
      const nextFamily = String(product.family || "").trim();
      const familyHeight = nextFamily ? (compact ? Math.max(COMPACT.familyHeight, product.familyLines.length * COMPACT_ROW_HEIGHT) : .24) : 0;
      let gap = categoryId && categoryId !== section.id ? (compact ? COMPACT.gap : FRAME.gap) : 0;
      let headerHeight = categoryId !== section.id ? section.headerHeight : 0;
      let nextFamilyHeight = nextFamily && (categoryId !== section.id || nextFamily !== family) ? familyHeight : 0;
      if (column.height + gap + headerHeight + nextFamilyHeight + product.rowHeight > capacity + 1e-9) {
        if (!column.rows.length || columns.length >= limit) return null;
        column = { rows: [], height: 0 }; columns.push(column); categoryId = ""; family = "";
        gap = 0; headerHeight = section.headerHeight; nextFamilyHeight = familyHeight;
      }
      if (gap + headerHeight + nextFamilyHeight + product.rowHeight > capacity + 1e-9) return null;
      column.height += gap;
      if (headerHeight) add({ kind: "category", section, height: section.headerHeight });
      if (nextFamilyHeight) add({ kind: "family", name: nextFamily, lines: product.familyLines, height: nextFamilyHeight });
      categoryId = section.id; family = nextFamily;
      add({ kind: "product", sectionId: section.id, product, height: product.rowHeight });
    }
    return columns;
  }

  function detailSlides(sections, range, frame = FRAME, canvas = STANDARD_CANVAS) {
    const slides = [];
    for (const section of sections) {
      if (!section.products.length) continue;
      const columns = packColumns([section], frame.height, Infinity, false);
      if (!columns) throw new Error(`A full product name in ${section.name || section.id} is too long for a readable PowerPoint page.`);
      columns.forEach((column, pageIndex) => slides.push({ kind: "roadmap-detail", sections: [section], ...column, range, pageIndex,
        frame, canvas, categoryId: section.id, categoryName: section.name, fontSize: FONT_SIZE }));
    }
    return slides;
  }

  function legendEntries(sections) {
    const legend = new Map();
    sections.forEach(section => section.products.filter(product => product.scheduled).forEach(product => {
      const status = statusLabel(product);
      if (status) legend.set(`${status}:${product.fill}`, { status, fill: hex(product.fill, "4D5054") });
    }));
    return [...legend.values()];
  }

  function legendLayout(entries, width, measure, fontSize = COMPACT_FONT_SIZE) {
    let x = 0, y = 0;
    const lineHeight = fontSize >= 12 ? .24 : .18;
    const items = [];
    for (const entry of entries) {
      const w = measure(entry.status, fontSize) + .25;
      if (w > width) return null;
      if (x && x + w > width) { x = 0; y += lineHeight; }
      items.push({ ...entry, x, y, width: w }); x += w;
    }
    return { items, height: entries.length ? y + lineHeight : 0 };
  }

  function compactCanvas(prepared, range) {
    const minimumWidth = COMPACT.margin * 2 + prepared.labelWidth + prepared.minimumTimelineWidth;
    if (minimumWidth > MAX_CANVAS_SIZE) return null;
    const entries = legendEntries(prepared.sections);
    const [flow] = packColumns(prepared.sections, Infinity, 1, true);
    const fit = width => {
      const height = width * 9 / 16, legend = legendLayout(entries, width - COMPACT.margin * 2, prepared.measure);
      if (!legend) return null;
      const capacity = height - COMPACT.bodyTop - COMPACT.bottomMargin - (legend.height ? legend.height + .10 : 0);
      return flow.height <= capacity + 1e-9 ? { width, height, capacity, legend } : null;
    };
    if (!fit(MAX_CANVAS_SIZE)) return null;
    let low = Math.max(STANDARD_CANVAS.width, minimumWidth), high = MAX_CANVAS_SIZE;
    for (let iteration = 0; iteration < 35; iteration++) {
      const mid = (low + high) / 2;
      if (fit(mid)) high = mid; else low = mid;
    }
    const width = high <= STANDARD_CANVAS.width + 1e-7 ? STANDARD_CANVAS.width : Math.ceil((high - 1e-8) * 100) / 100;
    const { height, capacity, legend } = fit(width);
    // A merged slide has exactly one calendar and one ordered product stack.
    // It enlarges in16:9; no product moves beside a repeated calendar.
    const frame = { x: COMPACT.margin, y: COMPACT.bodyTop, width: width - COMPACT.margin * 2, height: capacity,
      labelWidth: prepared.labelWidth, nameWidth: prepared.nameWidth, priceWidth: prepared.priceWidth,
      timelineX: COMPACT.margin + prepared.labelWidth, timelineWidth: width - COMPACT.margin * 2 - prepared.labelWidth,
      rowHeight: COMPACT_ROW_HEIGHT, barHeight: COMPACT_BAR_HEIGHT, axisTop: COMPACT.axisTop, headerHeight: COMPACT.bodyTop - COMPACT.axisTop };
    return { canvas: { width, height }, columns: [{ ...flow, index: 0, frame }], legend, rows: flow.rows, height: flow.height, range };
  }

  function prefixSections(sections, count) {
    const prefix = [];
    for (const section of sections) {
      if (!count) break;
      const products = section.products.slice(0, count);
      if (products.length) prefix.push({ ...section, products });
      count -= products.length;
    }
    return prefix;
  }

  function cutoffFor(prepared, total) {
    let low = 0, high = total;
    // At the fixed maximum canvas, additional rows/headings or legend entries
    // can only consume more space. Find the exact largest source prefix.
    const fits = count => {
      const sections = prefixSections(prepared.sections, count), [flow] = packColumns(sections, Infinity, 1, true);
      const legend = legendLayout(legendEntries(sections), MAX_CANVAS_SIZE - COMPACT.margin * 2, prepared.measure);
      return legend && COMPACT.bodyTop + flow.height + COMPACT.bottomMargin + (legend.height ? legend.height + .10 : 0) <= MAX_CANVAS_SIZE * 9 / 16 + 1e-9;
    };
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (fits(mid)) low = mid; else high = mid - 1;
    }
    const ordered = prepared.sections.flatMap(section => section.products.map(product => ({ id: product.id, name: product.name, categoryName: section.name || section.id })));
    return { includedCount: low, excludedCount: total - low, lastIncluded: ordered[low - 1] || null, firstExcluded: ordered[low] || null };
  }

  function planRoadmap(sections, options = {}) {
    const start = monthIndex(options.startMonth), end = monthIndex(options.endMonth), merged = options.mode === "merged";
    if (start == null || end == null || end < start) return { slides: [], requiresDecision: true, reason: "Choose a valid start and end month for the roadmap.", validRange: false, selectedProductCount: 0, outsideRangeCount: 0, unscheduledCount: 0, canvas: STANDARD_CANVAS };
    const range = { start, end, count: end - start + 1, startMonth: monthString(start), endMonth: monthString(end) };
    const prepared = prepareSections(sections, range, options, merged), selectedProductCount = prepared.sections.reduce((count, section) => count + section.products.length, 0);
    const { measure, ...publicPrepared } = prepared;
    const result = { ...publicPrepared, range, selectedProductCount, selectedTotal: selectedProductCount,
      includedProductCount: selectedProductCount, excludedProductCount: 0, limitToFit: options.limitToFit === true, minimumFontSize: merged ? COMPACT_FONT_SIZE : FONT_SIZE,
      validRange: true, requiresDecision: false, reason: "", slides: [], canvas: STANDARD_CANVAS, exactFits: false };
    if (!merged) {
      const minimumWidth = COMPACT.margin * 2 + FRAME.labelWidth + prepared.minimumTimelineWidth;
      const width = minimumWidth <= STANDARD_CANVAS.width ? STANDARD_CANVAS.width : Math.ceil(minimumWidth * 100) / 100;
      if (width > MAX_CANVAS_SIZE) {
        result.requiresDecision = true;
        result.reason = "All monthly labels exceed PowerPoint’s 56-inch slide limit. Choose a shorter period.";
        return result;
      }
      result.canvas = { width, height: width * 9 / 16 };
      const legend = legendLayout(legendEntries(prepared.sections), width - COMPACT.margin * 2, prepared.measure, FONT_SIZE);
      const availableHeight = legend ? result.canvas.height - FRAME.y - COMPACT.bottomMargin - legend.height - .10 : 0;
      if (availableHeight <= .6) {
        result.requiresDecision = true; result.reason = "The full status legend needs more room. Choose fewer categories."; return result;
      }
      const frame = { ...FRAME, width: width - COMPACT.margin * 2, height: Math.min(FRAME.height, availableHeight) };
      result.slides = detailSlides(prepared.sections, range, frame, result.canvas); result.exactFits = true;
      if (width > STANDARD_CANVAS.width) result.reason = `Category pages use a ${width.toFixed(2)} × ${result.canvas.height.toFixed(2)} inch slide so every month remains labeled. Product names remain 12 pt.`;
      return result;
    }
    let exportPrepared = prepared, layout = compactCanvas(prepared, range);
    if (!layout && prepared.labelWidth + prepared.minimumTimelineWidth + COMPACT.margin * 2 > MAX_CANVAS_SIZE) {
      result.includedProductCount = 0;
      result.requiresDecision = true;
      result.reason = "All monthly labels exceed PowerPoint’s 56-inch width limit. Choose a shorter period.";
      return result;
    }
    if (!layout) {
      result.cutoff = cutoffFor(prepared, selectedProductCount);
      result.includedProductCount = 0;
      result.excludedProductCount = result.cutoff.excludedCount;
      if (options.limitToFit !== true || !result.cutoff.includedCount) {
        result.requiresDecision = true;
        result.reason = `One shared calendar can fit the first ${result.cutoff.includedCount} of ${selectedProductCount} products within the largest 16:9 slide. Choose fewer products or explicitly export only the fitting range.`;
        return result;
      }
      exportPrepared = { ...prepared, sections: prefixSections(prepared.sections, result.cutoff.includedCount) };
      layout = compactCanvas(exportPrepared, range);
      result.includedProductCount = result.cutoff.includedCount;
      result.includedUnscheduledCount = exportPrepared.sections.reduce((sum, section) => sum + section.products.filter(product => !product.scheduled).length, 0);
    }
    result.canvas = layout.canvas; result.exactFits = true;
    result.fitsStandard = Math.abs(layout.canvas.width - STANDARD_CANVAS.width) < 1e-6 && Math.abs(layout.canvas.height - STANDARD_CANVAS.height) < 1e-6;
    result.columnCount = layout.columns.length;
    if (result.cutoff) result.reason = `Export only the first ${result.includedProductCount} of ${selectedProductCount} products on one 16:9 slide. ${result.excludedProductCount} remaining products will be excluded by your choice. Names remain 7 pt.`;
    else if (!result.fitsStandard) result.reason = `All ${selectedProductCount} products fit beneath one shared calendar on a ${layout.canvas.width.toFixed(2)} × ${layout.canvas.height.toFixed(2)} inch 16:9 slide. Product names remain 7 pt; every month is labeled.`;
    result.slides = [{ kind: "roadmap-merged", sections: exportPrepared.sections, ...layout, frame: layout.columns[0].frame, fontSize: COMPACT_FONT_SIZE }];
    return result;
  }

  function configureDeckCanvas(pptx, plan) {
    const canvas = plan?.canvas || STANDARD_CANVAS;
    if (![canvas.width, canvas.height].every(value => Number.isFinite(value) && value > 0 && value <= MAX_CANVAS_SIZE) || Math.abs(canvas.width / canvas.height - 16 / 9) > 1e-6) throw new Error("The PowerPoint slide dimensions are invalid.");
    if (Math.abs(canvas.width - STANDARD_CANVAS.width) < 1e-6 && Math.abs(canvas.height - STANDARD_CANVAS.height) < 1e-6) pptx.layout = "LAYOUT_WIDE";
    else { pptx.defineLayout({ name: "PPC_COMPACT_ROADMAP", width: canvas.width, height: canvas.height }); pptx.layout = "PPC_COMPACT_ROADMAP"; }
    return canvas;
  }

  function readOptions(form) {
    return { mode: form?.querySelector('input[name="pptxRoadmapLayout"]:checked')?.value || "categories",
      startMonth: form?.querySelector("#pptxRoadmapStart")?.value || "", endMonth: form?.querySelector("#pptxRoadmapEnd")?.value || "",
      limitToFit: Boolean(form?.querySelector("#pptxRoadmapLimit")?.checked) };
  }

  function syncDialog(form, plan, { includeRoadmap = true } = {}) {
    const section = form?.querySelector("#pptxRoadmapOptions");
    if (!section) return;
    section.hidden = !includeRoadmap;
    const limit = form.querySelector("#pptxRoadmapLimitOptions"), cutoff = form.querySelector("#pptxRoadmapCutoff");
    if (limit) limit.hidden = !includeRoadmap || readOptions(form).mode !== "merged" || !plan.cutoff?.excludedCount;
    if (cutoff) cutoff.textContent = plan.cutoff?.excludedCount
      ? `Fits: first ${plan.cutoff.includedCount} of ${plan.selectedProductCount} products. Last included: ${plan.cutoff.lastIncluded ? `${plan.cutoff.lastIncluded.categoryName} — ${plan.cutoff.lastIncluded.name}` : "none"}. Next product: ${plan.cutoff.firstExcluded.categoryName} — ${plan.cutoff.firstExcluded.name}. ${plan.cutoff.excludedCount} remaining products would be excluded if you choose the fitting range.` : "";
    const fit = form.querySelector("#pptxRoadmapFit"), coverage = form.querySelector("#pptxRoadmapCoverage");
    if (fit) fit.textContent = plan.reason || (readOptions(form).mode === "merged" ? "Every selected product fits on one slide with 7 pt names and all monthly labels." : "Products remain readable on separate category pages.");
    if (coverage) coverage.textContent = plan.validRange ? `${plan.selectedProductCount} products selected in this period. ${plan.outsideRangeCount} outside the period. ${plan.unscheduledCount} have dates to be confirmed.${plan.cutoff && !plan.requiresDecision ? ` This export includes ${plan.includedProductCount} and excludes ${plan.excludedProductCount} by your choice.` : ""}` : "";
  }

  function calendarBuckets(range, unit) {
    const buckets = [];
    for (let start = range.start; start <= range.end;) {
      const end = Math.min(range.end, start + unit - 1 - start % unit);
      buckets.push({ start, end, year: Math.floor(start / 12), quarter: Math.floor(start % 12 / 3) + 1 }); start = end + 1;
    }
    return buckets;
  }

  function addSlide(pptx, plan, options = {}) {
    if (!plan?.range || !Array.isArray(plan.rows)) throw new Error("The roadmap export plan is incomplete.");
    const slide = pptx.addSlide(), compact = plan.kind === "roadmap-merged", canvas = options.canvas || plan.canvas || STANDARD_CANVAS;
    // Roadmap text/bars retain their physical size even on a larger deck.
    // Product-card pages in a Both export scale separately in the application.
    const scale = 1, fontSize = compact ? COMPACT_FONT_SIZE : FONT_SIZE;
    const colors = options.theme?.colors || globalObject.PortfolioTheme?.colors || {};
    const background = hex(colors.page, "1A1B1C"), panel = hex(colors.surface, "242527"), header = hex(colors.header, "333538");
    const label = hex(colors.body || colors.text, "D5D7DC"), muted = hex(colors.label, "BBBCC0"), fontFace = options.fontFace || EXPORT_FONT_FACE;
    slide.background = { color: background };
    const text = (value, rect, extra = {}) => slide.addText(value, { ...rect, fontFace, fontSize, color: label, margin: 0, valign: "top", breakLine: false, wrap: false, paraSpaceAfter: 0, ...extra });
    const shape = (rect, fill, objectName) => slide.addShape(pptx.ShapeType.rect, { ...rect, objectName, fill: { color: fill }, line: { color: fill, width: 0, transparency: 100 } });
    const line = (x, y, w, h, transparency, width, objectName) => slide.addShape(pptx.ShapeType.line, { x, y, w, h, objectName, line: { color: muted, transparency, width, beginArrowType: "none", endArrowType: "none" } });
    const title = options.title || (compact ? "Combined roadmap" : `${plan.categoryName || plan.categoryId} Roadmap${plan.pageIndex ? " (continued)" : ""}`);
    text(title, { x: .38 * scale, y: .16 * scale, w: canvas.width - .76 * scale, h: .34 * scale }, { fontSize: 20 * scale, bold: true });
    text(`${monthLabel(plan.range.start)} to ${monthLabel(plan.range.end)}`, { x: .38 * scale, y: .51 * scale, w: canvas.width - .76 * scale, h: .18 * scale }, { fontSize: (compact ? 8 : 11) * scale, color: muted });
    const productGroups = [];
    let productIndex = 0;
    const columns = compact ? plan.columns : [{ rows: plan.rows, height: plan.height,
      frame: { ...(plan.frame || FRAME), width: canvas.width - COMPACT.margin * 2 }, index: 0 }];
    for (const column of columns) {
      const raw = column.frame, frame = compact ? raw : { ...raw, x: raw.x * scale, y: raw.y * scale, width: raw.width * scale, height: raw.height * scale, labelWidth: raw.labelWidth * scale };
      const timelineX = compact ? frame.timelineX : frame.x + frame.labelWidth, timelineWidth = compact ? frame.timelineWidth : frame.width - frame.labelWidth;
      const monthWidth = timelineWidth / plan.range.count, axisTop = (compact ? COMPACT.axisTop : .72) * scale;
      const axisBottom = frame.y - .03 * scale, bodyHeight = column.height * scale, coordinate = month => timelineX + (month - plan.range.start) * monthWidth;
      const calendarPrefix = `Calendar: ${column.index}`;
      let rowIndex = productIndex;
      for (const row of column.rows) if (row.kind === "product") {
        if (rowIndex++ % 2 === 0) shape({ x: frame.x, y: frame.y + row.top * scale, w: frame.width, h: row.height * scale }, panel, `Roadmap row: ${row.product.id}`);
      }
      // Calendar alignment marks precede product objects; bars occlude the
      // seams. There are no decorative product-row perimeters.
      for (let month = plan.range.start; month <= plan.range.end; month++) {
        const x = coordinate(month);
        if (month % 2 === 1) slide.addShape(pptx.ShapeType.rect, { x, y: frame.y, w: monthWidth, h: bodyHeight, objectName: `${calendarPrefix}:month-band:${month}`, fill: { color: "000000", transparency: 96 }, line: { transparency: 100, width: 0 } });
        if (month > plan.range.start) line(x, frame.y, 0, bodyHeight, month % 12 === 0 ? 78 : month % 3 === 0 ? 91 : 97, month % 12 === 0 ? 1.1 : .35, `${calendarPrefix}:body-seam:${month}`);
      }
      const yearFont = (compact ? COMPACT.yearFontSize : 16) * scale;
      for (const year of calendarBuckets(plan.range, 12)) {
        const x = coordinate(year.start), w = (year.end - year.start + 1) * monthWidth, name = String(year.year);
        const required = measureName(name, fontFace, yearFont) + .04 * scale;
        let labelX = x + .04 * scale, labelW = Math.max(w - .08 * scale, required);
        // A tiny initial partial year uses spare label-column header space;
        // a tiny final year aligns to the timeline's right edge.
        if (w < required + .08 * scale) labelX = year.start === plan.range.start ? x + w - required - .04 * scale : x + w - required;
        labelX = Math.max(frame.x, Math.min(frame.x + frame.width - labelW, labelX));
        text(name, { x: labelX, y: axisTop, w: labelW, h: .25 * scale }, { fontSize: yearFont, bold: true, objectName: `${calendarPrefix}:year:${year.year}` });
        if (year.start > plan.range.start) line(x, axisTop + .025 * scale, 0, axisBottom - axisTop - .025 * scale, 62, 1.1, `${calendarPrefix}:year-seam:${year.year}`);
      }
      for (const quarter of calendarBuckets(plan.range, 3)) {
        const x = coordinate(quarter.start), w = (quarter.end - quarter.start + 1) * monthWidth;
        text(`Q${quarter.quarter}`, { x, y: axisTop + .27 * scale, w, h: .13 * scale }, { fontSize: (compact ? COMPACT.quarterFontSize : 8) * scale, color: muted, bold: true, align: "center", objectName: `${calendarPrefix}:quarter:${quarter.year}:${quarter.quarter}` });
        if (quarter.start > plan.range.start && quarter.start % 12) line(x, axisTop + .27 * scale, 0, .13 * scale, 86, .5, `${calendarPrefix}:quarter-seam:${quarter.start}`);
      }
      for (let month = plan.range.start; month <= plan.range.end; month++) text(MONTH_NAMES[month % 12], { x: coordinate(month), y: axisTop + .43 * scale, w: monthWidth, h: .13 * scale }, { fontSize: (compact ? COMPACT.monthFontSize : 6) * scale, color: muted, align: "center", objectName: `${calendarPrefix}:month:${monthString(month)}` });
      line(frame.x, axisBottom, frame.width, 0, 82, .5, `${calendarPrefix}:footer`);
      for (const row of column.rows) {
        const y = frame.y + row.top * scale, height = row.height * scale;
        if (row.kind === "category") {
          shape({ x: frame.x, y, w: frame.width, h: height }, header, `Category: ${row.section.id}`);
          text(row.section.nameLines.join("\n"), { x: frame.x + .06 * scale, y: y + .015 * scale, w: frame.labelWidth - .12 * scale, h: height - .025 * scale }, { fontSize: fontSize * scale, bold: true });
        } else if (row.kind === "family") text((row.lines || [row.name]).join("\n"), { x: frame.x + .06 * scale, y: y + .015 * scale, w: frame.width - .12 * scale, h: height - .02 * scale }, { fontSize: fontSize * scale, color: muted, bold: true });
        else if (row.kind === "product") {
          const product = row.product;
          const prefix = `ppc-roadmap-${productIndex++}-part-`, labelLines = compact ? product.lines : [...product.lines, ...product.priceLines];
          const nameWidth = compact ? frame.nameWidth : frame.labelWidth / scale - .22;
          text(labelLines.join("\n"), { x: frame.x + .06 * scale, y: y + .023 * scale, w: nameWidth * scale, h: height - .025 * scale }, { objectName: `${prefix}0`, fontSize: fontSize * scale });
          const barHeight = (compact ? COMPACT_BAR_HEIGHT : .18) * scale;
          if (product.scheduled) {
            const x = coordinate(Math.max(plan.range.start, product.start)), right = coordinate(Math.min(plan.range.end, product.end) + 1);
            shape({ x, y: y + height / 2 - barHeight / 2, w: Math.max(.015, right - x), h: barHeight }, hex(product.fill, "4D5054"), `${prefix}1`);
          } else text(product.dateLines.join("\n"), { x: timelineX + .06 * scale, y: y + .023 * scale, w: timelineWidth - .12 * scale, h: height - .025 * scale }, { objectName: `${prefix}1`, fontSize: fontSize * scale });
          let partCount = 2;
          if (compact && product.priceLines.length) {
            text(product.priceLines.join("\n"), { x: frame.x + .06 + frame.nameWidth + COMPACT.priceGap, y: y + .023, w: frame.priceWidth, h: height - .025 }, { objectName: `${prefix}2`, fontSize: COMPACT_FONT_SIZE, color: muted }); partCount++;
          }
          productGroups.push({ prefix, name: `Product: ${product.id} — ${product.name}`, x: frame.x, y, width: frame.width, height, partCount });
        }
      }
    }
    if (!plan.rows.some(row => row.kind === "product")) text("No products in the selected period", { x: .44, y: COMPACT.bodyTop + .3, w: canvas.width - .88, h: .2 }, { fontSize: compact ? 7 : 12 });
    const legend = compact ? plan.legend : legendLayout(legendEntries(plan.sections), canvas.width - COMPACT.margin * 2, (value, size) => measureName(value, fontFace, size), 12);
    if (!legend) throw new Error("The roadmap status legend needs more room.");
    const legendTop = canvas.height - COMPACT.bottomMargin - legend.height;
    if (legendTop + 1e-7 < Math.max(...columns.map(column => column.frame.y + column.height)) + .10) throw new Error("The roadmap status legend needs more room.");
    for (const entry of legend.items) {
      const x = .38 * scale + entry.x * scale, y = legendTop + entry.y * scale;
      shape({ x, y: y + .035 * scale, w: .10 * scale, h: .08 * scale }, entry.fill, `Status: ${entry.status}`);
      text(entry.status, { x: x + .15 * scale, y, w: (entry.width - .18) * scale, h: (compact ? .16 : .22) * scale }, { fontSize: (compact ? 7 : 12) * scale, color: muted });
    }
    globalObject.PPTXEditable?.registerSlide(pptx, productGroups);
    return slide;
  }

  globalObject.PPTXExportPlanner = Object.freeze({ FONT_SIZE, COMPACT_FONT_SIZE, COMPACT_ROW_HEIGHT, COMPACT_BAR_HEIGHT, EXPORT_FONT_FACE,
    FRAME, COMPACT, STANDARD_CANVAS, MAX_CANVAS_SIZE, monthIndex, wrapName, planRoadmap, configureDeckCanvas, readOptions, syncDialog, addSlide });
}(globalThis));
