(function (globalObject) {
  "use strict";

  // The reference template is 2560 x 1440 CSS pixels. PptxGenJS uses inches
  // for frames and points for type and strokes; keep those conversions explicit.
  const model = () => {
    if (!globalObject.PPTXRoadmapModel) throw new Error("The roadmap export model did not load. Refresh and try again.");
    return globalObject.PPTXRoadmapModel;
  };
  const { G, F, C, MONTHS, SHORT_MONTHS, monthIndex, indexMonth, measureConservative,
    wrapFamilyForDisplay, categoryStripHeight, exactName, productStatus, sourcePeriod, timelineLabel } = model();
  const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
  const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
  const MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  // Capture currentScript while this classic module is evaluating. A later
  // asynchronous export must use the same versioned asset family as this code.
  const scriptSource = globalObject.document?.currentScript?.src || "";
  const ASSETS = Object.freeze({
    template: { fileName: "roadmap-template.pptx", byteLength: 1721329, sha256: "d0662b5b20f94413000181dcf5b8db6014648029e5d855b3b427e44eb24c0571" },
    metrics: { fileName: "arial-narrow-metrics.json", byteLength: 13267, sha256: "9e5687183df524397f3c4ad4db75532e0f6e24443585ed98c7d57423db9b0da5" },
  });
  const assetPromises = new Map();
  const STATIC_LOAD_TIMEOUT_MS = 20000;
  const px = value => value / 96;
  const pt = value => value * .75;
  const progress = (callback, phase, completed, total, detail = "") => {
    if (typeof callback === "function") {
      const bands = { prepare: [0, 10], render: [10, 60], merge: [60, 80], compress: [80, 100] };
      const [start, end] = bands[phase] || [0, 100];
      const fraction = total ? Math.max(0, Math.min(1, completed / total)) : 0;
      callback({ phase, completed, total, detail, percent: start + (end - start) * fraction, stage: phase,
        message: detail || ({ prepare: "Preparing the roadmap template", render: "Drawing editable roadmap slides", merge: "Applying the reference template", compress: "Compressing the PowerPoint" })[phase] || phase });
    }
  };
  const yieldFrame = () => new Promise(resolve => {
    if (typeof globalObject.requestAnimationFrame === "function") globalObject.requestAnimationFrame(() => resolve());
    else globalObject.setTimeout(resolve, 0);
  });
  function color(value) {
    const [hex, opacity] = String(value).replace(/^#/, "").split("/");
    return { color: hex, ...(opacity === undefined ? {} : { transparency: 100 - Number(opacity) }) };
  }
  function box(slide, name, left, top, width, height, fill) {
    slide.addShape("rect", { objectName: name, x: px(left), y: px(top), w: px(width), h: px(height),
      line: { transparency: 100, width: 0 }, fill: fill === "none" ? { color: "FFFFFF", transparency: 100 } : color(fill) });
  }
  function text(slide, name, value, frame, {
    size = 24, font = F.body, color: textColor = C.white, bold = false,
    align = "left", valign = "middle", rotation = 0,
  } = {}) {
    slide.addText(String(value), { objectName: name, x: px(frame.left), y: px(frame.top), w: px(frame.width), h: px(frame.height),
      fontFace: font, fontSize: pt(size), color: color(textColor).color, bold, align, valign,
      margin: 0, breakLine: false, wrap: false, paraSpaceAfterPt: 0, lineSpacingMultiple: 1,
      ...(rotation ? { rotate: rotation } : {}) });
  }
  function rule(slide, name, x1, y1, x2, y2, lineColor = C.line, width = 1) {
    slide.addShape("line", { objectName: name, x: px(Math.min(x1, x2)), y: px(Math.min(y1, y2)),
      w: px(Math.abs(x2 - x1)), h: px(Math.abs(y2 - y1)),
      line: { ...color(lineColor), width: pt(width) } });
  }

function categoryStrip(slide, categoryLabel, top, height, measureText) {
  const spanHeight = categoryStripHeight(categoryLabel, height, measureText);
  box(slide, 'Category strip', G.categoryX, top, G.categoryWidth, spanHeight, C.category);
  // Native rotated text follows the source template's editable category strip.
  // Its backing may extend below a sparse section, but never above the header.
  const centerX = G.categoryX + G.categoryWidth / 2;
  const centerY = top + spanHeight / 2;
  const textWidth = spanHeight - 32;
  text(slide, 'Category label', String(categoryLabel).toUpperCase(), {
    left: centerX - textWidth / 2, top: centerY - 30, width: textWidth, height: 60,
  }, { size: 112 / 3, font: F.narrow, align: 'center', rotation: 270 });
}

function calendar(slide, timeline, chartBottom) {
  const start = monthIndex(timeline.startMonth);
  const end = monthIndex(timeline.endMonth);
  const count = end - start + 1;
  const unit = G.plotWidth / count;
  const x = month => G.plotX + (month - start) * unit;
  box(slide, 'Calendar month scale', G.plotX, 122.03, G.plotWidth, 40, '#000000');
  // Automatically fitted history can exceed the viewport's ten-year limit.
  // Keep the same native header treatment, using readable year brackets when
  // individual quarters/months would be too narrow. Bar dates stay exact.
  if (count > 120) {
    const yearStep = Math.ceil(Math.ceil(count / 12) / Math.floor(G.plotWidth / 160));
    let band = 0;
    for (let first = start; first <= end; first += yearStep * 12) {
      const last = Math.min(end, first + yearStep * 12 - 1);
      const firstYear = Math.floor(first / 12), lastYear = Math.floor(last / 12);
      const left = x(first), width = (last - first + 1) * unit;
      const label = firstYear === lastYear ? String(firstYear) : `${firstYear} – ${lastYear}`;
      box(slide, `Calendar ${firstYear}-${lastYear} band`, left + 0.5, 94.42, Math.max(1, width - 1), 27.43, band % 2 ? '#808080/75' : '#C8C8C8/25');
      if (width >= 110) {
        text(slide, `Calendar year ${firstYear}`, String(firstYear), { left: left + 5.33, top: 19.5, width: Math.min(140, width - 10.66), height: 44 }, { size: 35.56, font: F.medium });
        text(slide, `Calendar span ${firstYear}-${lastYear}`, label, { left: left + 5.33, top: 124.39, width: width - 10.66, height: 35.28 }, { size: 24, font: F.narrow, color: C.label });
      }
      rule(slide, `Calendar year grid ${firstYear}`, left, 162.03, left, chartBottom, C.line, 1);
      band += 1;
    }
    rule(slide, 'Calendar right boundary', G.plotX + G.plotWidth, 162.03, G.plotX + G.plotWidth, chartBottom, C.line, 1);
    return;
  }
  const quarters = [];
  for (let month = start; month <= end; month += 1) {
    const monthInYear = month % 12;
    if (monthInYear % 3 !== 0 && month !== start) continue;
    // A clipped first quarter ends at its real calendar boundary, rather than
    // borrowing space from the following quarter/year's native text frames.
    const visibleMonths = Math.min(3 - monthInYear % 3, end - month + 1);
    quarters.push({ month, width: visibleMonths * unit });
  }
  // The reference caption and right-aligned quarter need 144 + 56 pixels,
  // plus breathing room. Decide from actual visible width, including edges.
  const compactCalendar = quarters.some(quarter => quarter.width < 212);
  for (let year = Math.floor(start / 12); year <= Math.floor(end / 12); year += 1) {
    const first = Math.max(start, year * 12);
    const last = Math.min(end, year * 12 + 11);
    if ((last - first + 1) * unit >= 110) text(slide, `Calendar year ${year}`, String(year), { left: x(first) + 5.33, top: 19.5, width: Math.min(140, (last - first + 1) * unit), height: 44 }, { size: 35.56, font: F.medium });
    if (!compactCalendar) text(slide, `Calendar year caption ${year}`, 'CALENDAR YEAR', { left: x(first) + 5.33, top: 64.4, width: 144, height: 22 }, { size: 17.773, font: F.narrow, color: C.label });
    for (let half = 0; half < 2; half += 1) {
      const halfFirst = Math.max(start, year * 12 + half * 6);
      const halfLast = Math.min(end, year * 12 + half * 6 + 5);
      if (halfFirst > halfLast) continue;
      const left = x(halfFirst), width = (halfLast - halfFirst + 1) * unit;
      box(slide, `Calendar ${year} H${half + 1} band`, left + 0.5, 94.42, width - 1, 27.43, half ? '#808080/75' : '#C8C8C8/25');
      text(slide, `Calendar ${year} H${half + 1}`, `${half + 1}H`, { left, top: 94.42, width, height: 27.43 }, { size: 17.773, font: F.black, align: 'center', color: half ? '#000000' : C.white });
    }
  }
  for (const { month, width } of quarters) {
    const monthInYear = month % 12;
    const left = x(month);
    text(slide, `Calendar quarter ${indexMonth(month)}`, `${compactCalendar ? '' : '__ '}Q${Math.floor(monthInYear / 3) + 1}`, { left: compactCalendar ? left + 2 : left + width - 62, top: 64.4, width: compactCalendar ? width - 4 : 56, height: 22 }, { size: 17.773, font: F.narrow, color: C.red, align: compactCalendar ? 'center' : 'right' });
    text(slide, `Calendar month ${indexMonth(month)}`, compactCalendar ? SHORT_MONTHS[monthInYear] : MONTHS[monthInYear], { left: left + 5.33, top: 124.39, width: width - 10.66, height: 35.28 }, { size: 24, font: F.body, color: C.label });
    rule(slide, `Quarter grid ${indexMonth(month)}`, left, 162.03, left, chartBottom, C.line, 1);
    if (month !== start) rule(slide, `Calendar scale separator ${indexMonth(month)}`, left, 126.03, left, 158.03, '#595959/65', 1);
  }
  rule(slide, 'Calendar right boundary', G.plotX + G.plotWidth, 162.03, G.plotX + G.plotWidth, chartBottom, C.line, 1);
}

function footer(slide, entry, plan) {
  const matching = plan.slides.filter(candidate => candidate.categoryId === entry.categoryId && candidate.section === entry.section && candidate.periodGroup === entry.periodGroup);
  const page = matching.findIndex(candidate => candidate.index === entry.index) + 1;
  text(slide, 'Roadmap period', timelineLabel(entry.timeline || plan.timeline), { left: G.plotX, top: G.footerY, width: 900, height: 32 }, { size: 64 / 3, color: C.label });
  text(slide, 'Category section page', `${page} / ${matching.length}`, { left: 2300, top: G.footerY, width: 170, height: 32 }, { size: 64 / 3, color: C.label, align: 'right' });
}

function datedSlide(slide, entry, plan, measureText) {
  const timeline = entry.timeline || plan.timeline;
  const top = G.firstRowY - 4;
  const chartHeight = entry.page.units * G.rowStep + Math.max(0, entry.page.segments.length - 1) * G.familyBoundaryGap;
  const chartBottom = top + chartHeight;
  // Backgrounds precede the native quarter grid, bars, and labels in z order.
  categoryStrip(slide, entry.categoryLabel, top, chartHeight, measureText);
  let unitOffset = 0;
  let boundaryOffset = 0;
  const positioned = [];
  for (const segment of entry.page.segments) {
    const blockY = top + unitOffset * G.rowStep + boundaryOffset;
    const blockHeight = segment.units * G.rowStep;
    box(slide, `Family background: ${segment.family}`, G.familyX, blockY, G.plotX + G.plotWidth - G.familyX, blockHeight, C.familyBackground);
    box(slide, `Family strip: ${segment.family}`, G.familyX, blockY, G.familyWidth, blockHeight, C.familyHeader);
    const displayLines = wrapFamilyForDisplay(segment.family, measureText);
    if (displayLines.length * 25.6 > blockHeight - 12) throw new Error(`Family display exceeds its allocated rows: ${segment.family}`);
    text(slide, `Family: ${segment.family}`, displayLines.join('\n'), { left: G.familyX + 1, top: blockY + 6, width: G.familyWidth - 2, height: blockHeight - 12 }, { size: 64 / 3, font: F.narrow, bold: true, align: 'center' });
    let rowOffset = 0;
    for (const row of segment.rows) {
      const rowTop = G.firstRowY + unitOffset * G.rowStep + boundaryOffset + rowOffset * G.rowStep;
      const rowHeight = row.units * G.rowStep;
      positioned.push({ row, top: rowTop, height: rowHeight });
      rowOffset += row.units;
    }
    rule(slide, `Family divider: ${segment.family}`, G.familyX, blockY + blockHeight, G.plotX + G.plotWidth, blockY + blockHeight, '#595959/45', 1);
    unitOffset += segment.units;
    boundaryOffset += G.familyBoundaryGap;
  }
  calendar(slide, timeline, chartBottom);
  const rangeStart = monthIndex(timeline.startMonth);
  const rangeEnd = monthIndex(timeline.endMonth);
  const unit = G.plotWidth / (rangeEnd - rangeStart + 1);
  const rowManifest = [];
  for (const positionedRow of positioned) {
    const { row, top: rowTop, height: rowHeight } = positionedRow;
    const product = row.product;
    const native = product.nativeLifecycleProduct;
    const start = monthIndex(native.startMonth);
    const end = monthIndex(native.endMonth);
    const clippedStart = Math.max(start, rangeStart);
    const clippedEnd = Math.min(end, rangeEnd);
    const barX = G.plotX + (clippedStart - rangeStart) * unit;
    const barWidth = (clippedEnd - clippedStart + 1) * unit;
    const barY = rowTop + (rowHeight - G.rowStep) / 2;
    box(slide, `Lifecycle bar: ${product.id}`, barX, barY, barWidth, G.barHeight, `${native.fill || '#595959'}/80`);
    const fullLabelWidth = Math.min(G.plotWidth - 24, measureConservative(row.label, 24) + 28);
    const labelWidth = row.labelLines.length > 1 ? G.plotWidth - 24 : fullLabelWidth;
    const centeredX = barX + (barWidth - labelWidth) / 2;
    const labelX = Math.max(G.plotX + 12, Math.min(centeredX, G.plotX + G.plotWidth - labelWidth - 12));
    const labelHeight = Math.max(G.barHeight, row.labelLines.length * 28.8 + 4);
    const labelY = barY + G.barHeight / 2 - labelHeight / 2;
    text(slide, `Product: ${product.id}`, row.labelLines.join('\n'), { left: labelX, top: labelY, width: labelWidth, height: labelHeight }, { size: 24, font: F.narrow, color: C.white, align: 'center' });
    rowManifest.push({
      id: product.id, family: product.family, sourceStartMonth: native.startMonth, sourceEndMonth: native.endMonth,
      visibleStartMonth: indexMonth(clippedStart), visibleEndMonth: indexMonth(clippedEnd),
      clippedStart: start < rangeStart, clippedEnd: end > rangeEnd,
      bar: { left: barX, top: barY, width: barWidth, height: G.barHeight },
      label: { left: labelX, top: labelY, width: labelWidth, height: labelHeight, lines: row.labelLines.length, fontSize: 24 },
      rowUnits: row.units,
    });
  }
  footer(slide, entry, plan);
  return { rowUnits: entry.page.units, productRows: rowManifest, tableRows: 0 };
}

  function tableSlide(slide, entry, plan, measureText) {
    if (entry.section !== "dates-tbd") throw new Error("Only products with incomplete dates use the TBD table layout.");
    text(slide, "Section title", "Dates TBD", { left: G.plotX, top: 29, width: 2050, height: 52 }, { size: 35.56, font: F.medium });
    text(slide, "Section period", timelineLabel(plan.timeline), { left: G.plotX, top: 93, width: 2050, height: 35 }, { size: 24, color: C.label });
    const totalHeight = G.tableHeaderHeight + entry.products.length * G.tableRowHeight;
    categoryStrip(slide, entry.categoryLabel, G.tableY, totalHeight, measureText);
    const values = [
      ["PRODUCT", "FFS", "GENERAL\nAVAILABILITY", "END OF\nMANUFACTURING", "STATUS"],
      ...entry.products.map(product => [exactName(product, plan.timeline), sourcePeriod(product, "ffsDate"),
        sourcePeriod(product, "generalAvailabilityDate"), sourcePeriod(product, "endManufacturingDate"), productStatus(product)]),
    ];
    const widths = [1013.33, 280, 360, 420, 310];
    values.slice(1).forEach((cells, row) => cells.forEach((value, column) => {
      if (String(value).includes("\n") || measureConservative(value, 24) > widths[column] - 32) {
        throw new Error(`The Dates TBD table label exceeds its reference cell for product ${entry.products[row].id}. Shorten the product or date label before exporting.`);
      }
    }));
    entry.products.forEach((product, row) => {
      box(slide, `Product: ${product.id}`, G.tableX, G.tableY + G.tableHeaderHeight + row * G.tableRowHeight, G.tableWidth, G.tableRowHeight, "none");
    });
    const rows = values.map((values, row) => values.map(value => ({ text: value, options: {
      fontFace: F.body, fontSize: pt(row === 0 ? 64 / 3 : 24), bold: row === 0,
      color: "FFFFFF", fill: color(row === 0 ? C.tableHeader : row % 2 ? C.tableOdd : C.tableEven),
      rowSpan: 1, margin: [pt(8), pt(16), pt(8), pt(16)], breakLine: false,
    } })));
    slide.addTable(rows, { x: px(G.tableX), y: px(G.tableY), w: px(G.tableWidth), h: px(totalHeight),
      colW: widths.map(px),
      rowH: [G.tableHeaderHeight, ...entry.products.map(() => G.tableRowHeight)].map(px),
      border: { type: "solid", color: "808080", transparency: 70, pt: pt(1) },
      margin: [pt(8), pt(16), pt(8), pt(16)], fontFace: F.body, fontSize: pt(24), color: "FFFFFF",
      valign: "middle", align: "left", autoPage: false, wrap: false, paraSpaceAfterPt: 0,
    });
    footer(slide, entry, plan);
    return { tableRows: values.length, nativeTable: true, rowUnits: 0,
      productRows: entry.products.map(product => ({ id: product.id, sourceFfs: sourcePeriod(product, "ffsDate"),
        sourceGA: sourcePeriod(product, "generalAvailabilityDate"), sourceEndManufacturing: sourcePeriod(product, "endManufacturingDate"), status: productStatus(product) })) };
  }

  async function buildContent(data, metrics, onProgress) {
    if (typeof globalObject.PptxGenJS !== "function" || typeof globalObject.JSZip?.loadAsync !== "function") {
      throw new Error("The editable PowerPoint library did not load. Refresh and try again.");
    }
    const plan = model().planRoadmapContent(data);
    if (!plan.coverage.expected) throw new Error("Select at least one product for the roadmap export.");
    const measureText = model().createReferenceTextMeasurer(metrics);
    const deck = new globalObject.PptxGenJS();
    deck.defineLayout({ name: "ROADMAP_REFERENCE", width: px(G.width), height: px(G.height) });
    deck.layout = "ROADMAP_REFERENCE";
    deck.author = "Product Portfolio";
    deck.subject = "Editable lifecycle roadmap";
    deck.title = "Portfolio Roadmap";
    deck.company = "";
    deck.lang = "en-US";
    const manifest = {
      dimensions: plan.dimensions,
      timeline: { startMonth: plan.timeline.startMonth, endMonth: plan.timeline.endMonth, showRoadmapMsrp: Boolean(plan.timeline.showRoadmapMsrp) },
      coverage: plan.coverage, categories: data.categories.map(category => ({ id: category.id, name: String(category.name || "") })),
      fonts: { basis: "reference", families: Object.values(F) }, slides: [],
    };
    progress(onProgress, "render", 0, plan.slides.length);
    for (const entry of plan.slides) {
      const slide = deck.addSlide();
      const geometry = entry.page ? datedSlide(slide, entry, plan, measureText) : tableSlide(slide, entry, plan, measureText);
      manifest.slides.push({ index: entry.index, categoryId: entry.categoryId, categoryName: entry.categoryName,
        kind: entry.kind, section: entry.section, periodGroup: entry.periodGroup,
        timeline: { startMonth: entry.timeline.startMonth, endMonth: entry.timeline.endMonth, showRoadmapMsrp: Boolean(entry.timeline.showRoadmapMsrp) },
        productIds: entry.productIds.slice(), ...geometry });
      progress(onProgress, "render", manifest.slides.length, plan.slides.length, entry.categoryName);
      await yieldFrame();
    }
    // Bypass PPTXEditable.serialize: its shared font policy would rewrite the
    // reference font names. The merged shell owns all final package metadata.
    const bytes = await deck.write({ outputType: "arraybuffer", compression: false });
    return { bytes, manifest };
  }

  const descendants = (node, namespace, name) => Array.from(node.getElementsByTagNameNS(namespace, name));
  const children = (node, namespace, name) => Array.from(node.childNodes).filter(child => child.nodeType === 1 && child.namespaceURI === namespace && child.localName === name);
  function one(nodes, description) {
    if (nodes.length !== 1) throw new Error(`The roadmap template has an invalid ${description}. Refresh and try again.`);
    return nodes[0];
  }
  function parseXml(value, part) {
    const doc = new globalObject.DOMParser().parseFromString(value, "application/xml");
    if (!doc.documentElement || descendants(doc, "*", "parsererror").length) throw new Error(`Invalid XML in roadmap template part ${part}.`);
    return doc;
  }
  const serializeXml = node => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + new globalObject.XMLSerializer().serializeToString(node.documentElement || node);
  async function readXml(zip, part) {
    const file = zip.file(part);
    if (!file) throw new Error(`The roadmap package is missing ${part}. Refresh and try again.`);
    return parseXml(await file.async("string"), part);
  }
  function replaceText(node, value) {
    const texts = descendants(node, A, "t");
    if (!texts.length) throw new Error("The roadmap template is missing a native text placeholder.");
    texts[0].textContent = String(value);
    texts.slice(1).forEach(text => { text.textContent = ""; });
  }
  function shapeById(doc, id) {
    const properties = one(descendants(doc, P, "cNvPr").filter(node => node.getAttribute("id") === String(id)), `shape ${id}`);
    return properties.parentNode.parentNode;
  }
  function checkDimensions(doc) {
    const size = one(descendants(doc, P, "sldSz"), "slide dimensions");
    if (size.getAttribute("cx") !== "24384000" || size.getAttribute("cy") !== "13716000") throw new Error("The roadmap package dimensions differ from the approved reference template.");
  }
  function layoutOnly(doc) {
    const root = doc.documentElement;
    Array.from(root.childNodes).forEach(node => {
      if (node.nodeType === 1 && !node.getAttribute("Type").endsWith("/slideLayout")) root.removeChild(node);
    });
    one(children(root, REL, "Relationship"), "slide layout ownership");
    return doc;
  }
  function nativeTree(doc) {
    if (descendants(doc, P, "pic").length || descendants(doc, A, "blip").length) throw new Error("Roadmap content must contain native editable objects, without pictures.");
    const elements = [doc.documentElement, ...descendants(doc, "*", "*")];
    if (elements.some(node => Array.from(node.attributes || []).some(attribute => attribute.namespaceURI === R))) {
      throw new Error("Native roadmap content has an unexpected relationship dependency.");
    }
    return one(descendants(doc, P, "spTree"), "native shape tree");
  }
  function forceWhiteText(doc, element) {
    ["rPr", "defRPr", "endParaRPr"].flatMap(name => descendants(element, A, name)).forEach(properties => {
      Array.from(properties.childNodes).forEach(child => {
        if (child.namespaceURI === A && ["solidFill", "noFill", "gradFill"].includes(child.localName)) properties.removeChild(child);
      });
      const fill = doc.createElementNS(A, "a:solidFill");
      const rgb = doc.createElementNS(A, "a:srgbClr");
      rgb.setAttribute("val", "FFFFFF");
      fill.appendChild(rgb);
      properties.insertBefore(fill, properties.firstChild);
    });
  }
  function validExportDate(value) {
    const date = value instanceof Date ? value : value ? new Date(`${value}T12:00:00`) : new Date();
    if (!Number.isFinite(date.getTime())) throw new Error("The roadmap export date is invalid.");
    const year = date.getFullYear(), month = date.getMonth() + 1, day = date.getDate();
    return { iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      cover: `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}-${year}`, short: `${month}/${day}/${String(year).slice(-2)}` };
  }
  function validateManifest(manifest, count) {
    if (!Array.isArray(manifest?.slides) || manifest.slides.length !== count || !Array.isArray(manifest.categories)) throw new Error("Native roadmap content manifest has invalid slide coverage.");
    const indices = manifest.slides.map(slide => slide.index).sort((a, b) => a - b);
    if (indices.some((index, position) => index !== position)) throw new Error("Native roadmap content manifest must consume every slide index exactly once.");
    const categoryIds = manifest.categories.map(category => category.id);
    if (new Set(categoryIds).size !== categoryIds.length || manifest.slides.some(slide => !categoryIds.includes(slide.categoryId))) throw new Error("Native roadmap manifest contains an invalid category.");
    const ids = manifest.slides.flatMap(slide => slide.productIds || []);
    if (new Set(ids).size !== ids.length || ids.length !== manifest.coverage?.expected || ids.length !== manifest.coverage?.represented || ids.length !== manifest.coverage?.unique) throw new Error("Native roadmap manifest product coverage must be exactly once.");
    manifest.slides.forEach(slide => {
      if (!Array.isArray(slide.productRows) || slide.productRows.length !== slide.productIds.length || slide.productRows.some((row, index) => row.id !== slide.productIds[index])) throw new Error("Native roadmap content rows differ from the manifest identities.");
    });
    return ids;
  }

  async function mergeTemplate(templateBytes, contentBytes, manifest, { exportDate, onProgress } = {}) {
    if (typeof globalObject.DOMParser !== "function" || typeof globalObject.XMLSerializer !== "function") throw new Error("This browser cannot compose the roadmap PowerPoint template.");
    const [template, content] = await Promise.all([globalObject.JSZip.loadAsync(templateBytes, { checkCRC32: true }), globalObject.JSZip.loadAsync(contentBytes, { checkCRC32: true })]);
    const templateNames = Object.keys(template.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    if (templateNames.length !== 4) throw new Error("The roadmap template must contain its four approved shell slides.");
    const contentNames = Object.keys(content.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    const ids = validateManifest(manifest, contentNames.length);
    const date = validExportDate(exportDate);
    const presentation = await readXml(template, "ppt/presentation.xml");
    checkDimensions(presentation);
    checkDimensions(await readXml(content, "ppt/presentation.xml"));
    const native = new Map();
    for (const entry of manifest.slides) {
      const doc = await readXml(content, `ppt/slides/slide${entry.index + 1}.xml`);
      native.set(entry.index, nativeTree(doc));
    }
    progress(onProgress, "merge", 0, manifest.slides.length);
    const logical = [];
    const intro = await readXml(template, "ppt/slides/slide1.xml");
    const dateTexts = descendants(shapeById(intro, 1664), A, "t");
    if (dateTexts.length !== 3) throw new Error("The roadmap template export date placeholder is invalid.");
    dateTexts[2].textContent = date.cover;
    // Sanitized template slides retain their approved branding dependencies.
    // Only replaced native bodies have the stricter layout-only ownership.
    logical.push({ kind: "intro", title: "Portfolio Roadmap", doc: intro, rels: await readXml(template, "ppt/slides/_rels/slide1.xml.rels") });
    const change = await readXml(template, "ppt/slides/slide2.xml");
    const table = one(descendants(shapeById(change, 2), A, "tbl"), "native changelog table");
    const changeRows = children(table, A, "tr");
    if (changeRows.length !== 10) throw new Error("The roadmap template changelog row count is invalid.");
    const changeCells = children(changeRows[1], A, "tc");
    if (changeCells.length !== 2) throw new Error("The roadmap template changelog columns are invalid.");
    replaceText(changeCells[0], date.short);
    replaceText(changeCells[1], `Roadmap refreshed from PPC: ${ids.length} products across ${manifest.categories.length} categories. ${timelineLabel(manifest.timeline)}. Additional timelines group products by nearby years; missing dates remain TBD.`);
    forceWhiteText(change, table);
    logical.push({ kind: "changelog", title: "Changelog", doc: change, rels: await readXml(template, "ppt/slides/_rels/slide2.xml.rels") });
    const dividerSource = await readXml(template, "ppt/slides/slide3.xml");
    const dividerRels = await readXml(template, "ppt/slides/_rels/slide3.xml.rels");
    const bodySource = await readXml(template, "ppt/slides/slide4.xml");
    const bodyRels = layoutOnly(await readXml(template, "ppt/slides/_rels/slide4.xml.rels"));
    let consumed = 0;
    for (const category of manifest.categories) {
      const divider = parseXml(serializeXml(dividerSource), "category divider");
      const title = `${category.name} Roadmap`;
      replaceText(shapeById(divider, 2), title);
      logical.push({ kind: "divider", categoryId: category.id, title, doc: divider, rels: dividerRels });
      for (const entry of manifest.slides.filter(slide => slide.categoryId === category.id)) {
        const body = parseXml(serializeXml(bodySource), "native body");
        const csld = one(descendants(body, P, "cSld"), "native body content");
        csld.replaceChild(body.importNode(native.get(entry.index), true), one(children(csld, P, "spTree"), "body shape tree"));
        children(csld, P, "custDataLst").forEach(node => csld.removeChild(node));
        ["timing", "transition", "extLst"].flatMap(name => children(body.documentElement, P, name)).forEach(node => body.documentElement.removeChild(node));
        csld.setAttribute("name", `${category.name} ${entry.section}`);
        nativeTree(body);
        logical.push({ ...entry, contentIndex: entry.index, doc: body, rels: bodyRels });
        consumed += 1;
        progress(onProgress, "merge", consumed, manifest.slides.length, category.name);
        await yieldFrame();
      }
    }
    if (consumed !== contentNames.length) throw new Error("Every native content slide must be consumed exactly once.");
    const slideList = one(descendants(presentation, P, "sldIdLst"), "presentation slide list");
    while (slideList.firstChild) slideList.removeChild(slideList.firstChild);
    ["custShowLst", "extLst", "notesMasterIdLst"].flatMap(name => children(presentation.documentElement, P, name)).forEach(node => presentation.documentElement.removeChild(node));
    const rels = await readXml(template, "ppt/_rels/presentation.xml.rels");
    children(rels.documentElement, REL, "Relationship").forEach(node => {
      if (/\/(?:slide|notesMaster|customXml|tags)$/.test(node.getAttribute("Type"))) rels.documentElement.removeChild(node);
    });
    const types = await readXml(template, "[Content_Types].xml");
    children(types.documentElement, CT, "Override").forEach(node => {
      if (/^\/(?:ppt\/(?:slides|notesSlides|notesMasters|tags)\/|customXml\/)/.test(node.getAttribute("PartName"))) types.documentElement.removeChild(node);
    });
    Object.keys(template.files).forEach(name => {
      if (/^(?:ppt\/(?:slides|notesSlides|notesMasters|tags)\/|customXml\/)/.test(name)) template.remove(name);
    });
    const finalSlides = [];
    logical.forEach((entry, index) => {
      const number = index + 1, part = `ppt/slides/slide${number}.xml`, id = `rIdRoadmap${number}`;
      template.file(part, serializeXml(entry.doc));
      template.file(`ppt/slides/_rels/slide${number}.xml.rels`, serializeXml(entry.rels));
      const slide = presentation.createElementNS(P, "p:sldId");
      slide.setAttribute("id", String(255 + number));
      slide.setAttributeNS(R, "r:id", id);
      slideList.appendChild(slide);
      const relation = rels.createElementNS(REL, "Relationship");
      relation.setAttribute("Id", id); relation.setAttribute("Type", R + "/slide"); relation.setAttribute("Target", `slides/slide${number}.xml`);
      rels.documentElement.appendChild(relation);
      const type = types.createElementNS(CT, "Override");
      type.setAttribute("PartName", "/" + part); type.setAttribute("ContentType", "application/vnd.openxmlformats-officedocument.presentationml.slide+xml");
      types.documentElement.appendChild(type);
      const { doc, rels: slideRels, ...metadata } = entry;
      finalSlides.push({ ...metadata, index, finalSlide: number });
    });
    if (content.file("ppt/tableStyles.xml")) {
      const tableStyles = await readXml(template, "ppt/tableStyles.xml");
      const newStyles = await readXml(content, "ppt/tableStyles.xml");
      const existing = new Set(Array.from(tableStyles.documentElement.childNodes).filter(node => node.nodeType === 1).map(node => node.getAttribute("styleId")));
      Array.from(newStyles.documentElement.childNodes).filter(node => node.nodeType === 1).forEach(node => {
        if (!existing.has(node.getAttribute("styleId"))) tableStyles.documentElement.appendChild(tableStyles.importNode(node, true));
      });
      template.file("ppt/tableStyles.xml", serializeXml(tableStyles));
    }
    template.file("ppt/presentation.xml", serializeXml(presentation));
    template.file("ppt/_rels/presentation.xml.rels", serializeXml(rels));
    template.file("[Content_Types].xml", serializeXml(types));
    if (template.file("docProps/app.xml")) {
      const properties = await readXml(template, "docProps/app.xml");
      descendants(properties, "*", "Slides").forEach(node => { node.textContent = String(logical.length); });
      template.file("docProps/app.xml", serializeXml(properties));
    }
    progress(onProgress, "compress", 0, 100);
    await yieldFrame();
    const bytes = await template.generateAsync({ type: "arraybuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }, update => progress(onProgress, "compress", update.percent, 100));
    return { bytes, manifest: { ...manifest, slides: finalSlides, exportDate: date.iso, nativeContentSlides: consumed,
      categoryHeaders: manifest.categories.length, products: ids.length, uniqueProducts: new Set(ids).size, allContentNative: true, templatePreserved: true } };
  }
  function assetUrl(fileName) {
    if (!scriptSource) throw new Error("The roadmap template script URL is unavailable. Refresh and try again.");
    const source = new globalObject.URL(scriptSource, globalObject.document?.baseURI);
    const url = new globalObject.URL(`../assets/pptx/${fileName}`, source);
    url.search = source.search;
    if (source.origin !== url.origin) throw new Error("The roadmap template assets must use the application's origin.");
    return url.href;
  }
  async function loadAsset(identity) {
    const url = assetUrl(identity.fileName);
    if (assetPromises.has(url)) return assetPromises.get(url);
    const promise = (async () => {
      const controller = typeof globalObject.AbortController === "function" ? new globalObject.AbortController() : null;
      let timeout;
      try {
        const bytes = await Promise.race([
          (async () => {
            const response = await globalObject.fetch(url, { credentials: "same-origin", mode: "same-origin", redirect: "error", cache: "no-cache", ...(controller ? { signal: controller.signal } : {}) });
            if (!response.ok) throw new Error(`The roadmap asset ${identity.fileName} could not load (${response.status}). Refresh and try again.`);
            return response.arrayBuffer();
          })(),
          new Promise((resolve, reject) => {
            timeout = globalObject.setTimeout(() => { reject(new Error(`Loading ${identity.fileName} timed out. Try the export again.`)); controller?.abort(); }, STATIC_LOAD_TIMEOUT_MS);
          }),
        ]);
        if (bytes.byteLength !== identity.byteLength || typeof globalObject.crypto?.subtle?.digest !== "function") throw new Error(`The roadmap asset ${identity.fileName} has an invalid identity. Refresh and try again.`);
        const digest = await globalObject.crypto.subtle.digest("SHA-256", bytes);
        const hash = Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, "0")).join("");
        if (hash !== identity.sha256) throw new Error(`The roadmap asset ${identity.fileName} has an invalid identity. Refresh and try again.`);
        return bytes;
      } finally { globalObject.clearTimeout(timeout); }
    })();
    assetPromises.set(url, promise);
    try { return await promise; }
    catch (error) { if (assetPromises.get(url) === promise) assetPromises.delete(url); throw error; }
  }
  async function generate(data, { templateBytes, metrics, exportDate, onProgress } = {}) {
    progress(onProgress, "prepare", 0, 1);
    await yieldFrame();
    const [template, referenceMetrics] = await Promise.all([
      templateBytes ? Promise.resolve(templateBytes) : loadAsset(ASSETS.template),
      metrics ? Promise.resolve(metrics) : loadAsset(ASSETS.metrics).then(bytes => JSON.parse(new globalObject.TextDecoder().decode(bytes))),
    ]);
    progress(onProgress, "prepare", 1, 1);
    const content = await buildContent(data, referenceMetrics, onProgress);
    const merged = await mergeTemplate(template, content.bytes, content.manifest, { exportDate, onProgress });
    return { blob: new globalObject.Blob([merged.bytes], { type: MIME }), fileName: `Portfolio-Roadmap-${merged.manifest.exportDate}.pptx`, manifest: merged.manifest };
  }
  globalObject.PPTXRoadmapTemplate = Object.freeze({ buildContent, mergeTemplate, generate });
})(typeof window !== "undefined" ? window : globalThis);
