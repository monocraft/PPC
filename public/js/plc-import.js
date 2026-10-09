/* Inert XLSX evidence, conservative identity matching and repeatable PLC updates. */
(function (root) {
  "use strict";
  const version = 1;
  const fieldLabels = Object.freeze({ ffsDate: "FFS", generalAvailabilityDate: "General availability", endManufacturingDate: "End of manufacturing", globalAnnouncementDate: "Global announcement", webReadinessDate: "Web readiness", finalAssetsDate: "Final assets" });
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const clean = (value) => String(value ?? "").replace(/\u00a0/g, " ").trim();
  const dayMs = 86400000;
  const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const dateStamp = (day) => Date.parse(`${day}T00:00:00Z`);
  function exact(year, month, day) {
    const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : "";
  }
  const yearNumber = (text) => Number(text) < 100 ? 2000 + Number(text) : Number(text);
  function parseDate(raw, options = {}) {
    const original = raw instanceof Date ? raw.toISOString() : clean(raw);
    const result = (kind, extra = {}) => ({ raw: original, kind, value: "", reason: kind, ...extra });
    if (!original || /^(?:tbd|tbc|n\/?a|none|null|not set|[-–—])$/i.test(original)) return result("blank");
    if (raw instanceof Date) return result("exact", { value: raw.toISOString().slice(0, 10), reason: "Native Excel date" });
    if ((typeof raw === "number" || options.numeric === true && /^\d+(?:\.\d+)?$/.test(original)) && options.numeric !== false) {
      const serial = Number(raw);
      if (!Number.isFinite(serial) || serial < 0 || serial > 100000 || !options.date1904 && Math.floor(serial) === 60) return result("invalid", { reason: "Invalid Excel date serial (1900 leap-day error included)" });
      const date = new Date(Date.UTC(options.date1904 ? 1904 : 1899, options.date1904 ? 0 : 11, options.date1904 ? 1 : 31) + (serial - (!options.date1904 && serial > 60 ? 1 : 0)) * dayMs);
      return result("exact", { value: date.toISOString().slice(0, 10), reason: "Excel date serial" });
    }
    const text = original.replace(/[’‘`]/g, "'").replace(/\s+/g, " ");
    if (/=>|→|->|\bto\b|[~～]/i.test(text)) return result("range", { reason: "Revision or date range requires an explicit selected date" });
    if (/\?/.test(text)) return result("unknown", { reason: "Unconfirmed date" });
    const quarter = text.match(/\bQ([1-4])\s*[/ '-]*(\d{4}|\d{2})\b/i) || text.match(/\b(\d{4})\s*Q([1-4])\b/i)?.map((v, i, a) => i === 1 ? a[2] : i === 2 ? a[1] : v);
    if (quarter) {
      const year = yearNumber(quarter[2]), startMonth = (Number(quarter[1]) - 1) * 3 + 1;
      return result("quarter", { year, quarter: Number(quarter[1]), periodBasis: options.quarterBasis || "unspecified", ...(options.quarterBasis === "calendar" ? { start: exact(year, startMonth, 1), end: new Date(Date.UTC(year, startMonth + 2, 0)).toISOString().slice(0, 10) } : {}), reason: "Quarter precision and calendar/fiscal basis require review" });
    }
    const monthNames = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    const namedDay = text.match(/^([A-Za-z]{3,9})\s+(\d{1,2})(?:,\s*|\s+)'?(\d{4})$/) || text.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/)?.map((v, i, a) => i === 1 ? a[2] : i === 2 ? a[1] : v);
    if (namedDay && monthNames[namedDay[1].slice(0, 3).toLowerCase()]) {
      const value = exact(Number(namedDay[3]), monthNames[namedDay[1].slice(0, 3).toLowerCase()], Number(namedDay[2]));
      return value ? result("exact", { value, reason: "Explicit named calendar date" }) : result("invalid", { reason: "Not a real calendar date" });
    }
    if (/^[A-Za-z]{3,9}\s+\d{1,2}$/.test(text)) return result("missing-year", { reason: "No explicit year" });
    const named = text.match(/^([A-Za-z]{3,9})\s*(?:\/|\s)\s*'?(\d{4}|\d{2})$/);
    if (named && monthNames[named[1].slice(0, 3).toLowerCase()]) {
      const year = yearNumber(named[2]), month = monthNames[named[1].slice(0, 3).toLowerCase()];
      return result("month", { start: exact(year, month, 1), end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10), reason: "Month precision cannot become an exact day" });
    }
    const isoMonth = text.match(/^(\d{4})[/-](0?[1-9]|1[0-2])$/);
    if (isoMonth) return result("month", { start: exact(Number(isoMonth[1]), Number(isoMonth[2]), 1), end: new Date(Date.UTC(Number(isoMonth[1]), Number(isoMonth[2]), 0)).toISOString().slice(0, 10) });
    const region = (text.match(/\((?:CN|TH|VN|RSB|PC|US|UK|CHINA|THAILAND|VIETNAM)(?:\s*\/\s*(?:CN|TH|VN|RSB|US|UK))*\)/gi) || []).map((value) => value.slice(1, -1)).join(", ");
    let stripped = text.replace(/\((?:CN|TH|VN|RSB|PC|US|UK|CHINA|THAILAND|VIETNAM)(?:\s*\/\s*(?:CN|TH|VN|RSB|US|UK))*\)/gi, "").replace(/^(?:current\s+|actual\s+|newest\s+)?FFS\s*/i, "").trim();
    // A standalone explicit year above a month/day is common in timeline cells.
    stripped = stripped.replace(/^(\d{4})\s+(\d{1,2}\/\d{1,2})$/, "$1/$2");
    const dateTokens = stripped.match(/\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}\/\d{1,2}\/\s*'?\d{2,4}/g) || [];
    if (dateTokens.length > 1 || /[,;]/.test(stripped) && /\d/.test(stripped)) return result("multiple", { region, reason: "Multiple regional dates must be selected explicitly" });
    let match = stripped.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:T00:00:00(?:\.000Z|Z)?)?$/);
    let value = match ? exact(Number(match[1]), Number(match[2]), Number(match[3])) : "";
    if (!match) {
      match = stripped.match(/^(\d{1,2})\/(\d{1,2})\/\s*'?(\d{4}|\d{2})$/);
      if (match) value = exact(yearNumber(match[3]), Number(match[1]), Number(match[2]));
    }
    if (match) return value ? result("exact", { value, region, reason: region ? `Explicit date for ${region}` : "Explicit calendar date" }) : result("invalid", { reason: "Not a real calendar date" });
    if (/\b\d{1,2}\/\d{1,2}\b/.test(stripped) && !/\d{4}|\/'\d{2}/.test(stripped)) return result("missing-year", { region, reason: "No explicit year; the report year is not assumed" });
    return result("unknown", { region, reason: "Notes or unsupported date text retained without guessing" });
  }

  function normalizeName(raw) {
    return clean(raw).toLowerCase().replace(/[“”"]/g, "").replace(/\bhyperx\b/g, "").replace(/\biii\b/g, "3").replace(/\biv\b/g, "4").replace(/\bii\b/g, "2")
      .replace(/\bwl\b/g, "wireless").replace(/\bwd\b/g, "wired").replace(/\bpf\b/g, "pulsefire").replace(/\bcloud\s*([234])\s*s\b/g, "cloud $1 s")
      .replace(/\b(?:gaming|headsets?|microphones?|mice|mouse|keyboard|kb|for|pc|wired|colorway)\b/g, " ")
      .replace(/\bhaste\b/g, "pulsefire haste").replace(/\bpulsefire\s+pulsefire\b/g, "pulsefire").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function extractIdentity(name) {
    const match = clean(name).match(/["“]([^"”]+)["”]/);
    return { codename: match ? clean(match[1]) : "", marketingName: match ? clean(name).replace(match[0], "").trim() : clean(name) };
  }
  const normalizeCode = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  function categoryFor(name, section = "") {
    const text = `${name} ${section}`.toLowerCase();
    if (/pop filter|microphone arm/.test(text)) return "microphone-accessories";
    if (/mousepad|mouse pad|top plate|housing|accessory|accessories/.test(name.toLowerCase())) return "accessories";
    if (/microphone|solocast|flipcast|quadcast/.test(name.toLowerCase())) return "microphones";
    if (/controller|clutch/.test(text)) return "controllers";
    if (/keyboard|\bkb\b/.test(name.toLowerCase())) return "keyboards";
    if (/mice|mouse|haste|hydra|soma/.test(text)) return "mice";
    if (/xbox|playstation|ps5|ps4/.test(name.toLowerCase())) return "console-gaming-audio";
    if (/headset|cloud|alpha/.test(text)) return "pc-gaming-audio";
    return "";
  }
  function sourceKey(row) { return row.key || `${normalizeName(row.codename)}|${normalizeName(row.name)}`; }
  function identities(portfolio) {
    return (portfolio.categories || []).flatMap((category) => (category.board?.products || []).map((product) => ({ product, productId: product.id, name: product.name, categoryId: category.id })));
  }
  function matchProduct(row, portfolio, options = {}) {
    const all = identities(portfolio), key = sourceKey(row);
    const explicit = options.selections?.[key] || options.aliases?.[key];
    const compatible = (entry) => !row.categoryId || row.categoryId === entry.categoryId;
    const candidates = [];
    const incomingIdentity = extractIdentity(row.name);
    const incomingName = normalizeName(row.marketingName || incomingIdentity.marketingName);
    const incomingCode = normalizeCode(row.codename || incomingIdentity.codename);
    const skuList = (row.skus || row.partNumbers || []).map((sku) => clean(sku).toUpperCase());
    for (const entry of all) {
      const product = entry.product;
      let score = 0, reason = "";
      if (explicit === entry.productId) { score = 100; reason = "Selected product"; }
      else if (!compatible(entry)) continue;
      else if (/\b(?:xbox|ps5|ps4|playstation)\b/i.test(row.name) && /\b(?:xbox|ps5|ps4|playstation)\b/i.test(product.name)
        && /xbox/i.test(row.name) !== /xbox/i.test(product.name)) continue;
      else if (/\b(?:wireless|wl)\b/i.test(row.name) && /\b(?:wired|wd)\b/i.test(product.name) || /\b(?:wired|wd)\b/i.test(row.name) && /\b(?:wireless|wl)\b/i.test(product.name)) continue;
      else if (row.productId === entry.productId || row.projectId && !/^\d+$/.test(String(row.projectId)) && row.projectId === entry.productId) { score = 100; reason = "Exact PPC product ID"; }
      else if (product.plc?.identities?.some((identity) => identity.key === key)) { score = 99; reason = "Remembered source identity"; }
      else {
        const codes = [...(product.partSkus || []).map((sku) => sku.code), ...(product.ascm?.basePartNumbers || [])].map((sku) => clean(sku).toUpperCase());
        const ownIdentity = extractIdentity(product.name);
        const name = normalizeName(ownIdentity.marketingName);
        const code = normalizeCode(product.codename || product.codeName || ownIdentity.codename);
        if (skuList.some((sku) => codes.includes(sku))) { score = 98; reason = "Exact HP SKU"; }
        else if (incomingCode && code === incomingCode) { score = 96; reason = "Exact codename"; }
        else if (incomingName && incomingName === name) { score = 94; reason = "Exact normalized product name"; }
        else {
          const a = new Set(incomingName.split(" ").filter(Boolean)), b = new Set(name.split(" ").filter(Boolean));
          const overlap = [...a].filter((token) => b.has(token)).length;
          score = Math.round(70 * overlap / Math.max(a.size, b.size, 1));
          if (score >= 25) reason = "Similar name; confirmation required";
        }
      }
      if (reason) candidates.push({ productId: entry.productId, name: entry.name, categoryId: entry.categoryId, score, reason });
    }
    candidates.sort((a, b) => b.score - a.score || a.productId.localeCompare(b.productId));
    if (!/\b(?:wired|wireless|wl|wd)\b/i.test(row.marketingName || incomingIdentity.marketingName)) {
      const wirelessSibling = all.some((entry) => compatible(entry) && /\bwireless\b/i.test(entry.name) && normalizeName(entry.name).replace(/\bwireless\b/g, "").replace(/\s+/g, " ").trim() === incomingName);
      if (wirelessSibling) for (const candidate of candidates) if (candidate.reason === "Exact normalized product name") { candidate.score = 70; candidate.reason = "Connection type missing; wired and wireless siblings require review"; }
      candidates.sort((a, b) => b.score - a.score || a.productId.localeCompare(b.productId));
    }
    const strong = candidates.filter((candidate) => candidate.score >= 94);
    if (explicit && !all.some((entry) => entry.productId === explicit)) return { status: "unmatched", reason: "Selected product no longer exists", candidates };
    if (explicit) return { status: "matched", productId: explicit, reason: "Selected product", candidates };
    if (strong.length === 1) return { status: "matched", productId: strong[0].productId, reason: strong[0].reason, candidates };
    return { status: strong.length > 1 || candidates.length ? "ambiguous" : "unmatched", reason: strong.length > 1 ? "Multiple strong identities; choose a product" : "No unique exact identity", candidates };
  }

  const xmlText = (value) => root.ASCMImporter.helpers.decodeXml(value || "");
  function attrs(text) {
    const result = {}; for (const match of text.matchAll(/([\w:.-]+)\s*=\s*["']([^"']*)["']/g)) result[match[1]] = xmlText(match[2]);
    return result;
  }
  function safeXml(xml) { if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Unsafe XML declarations in the workbook."); return xml; }
  function textTags(xml) { return [...xml.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((match) => xmlText(match[1])).join(""); }
  const colIndex = (letters) => [...letters].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0);
  function sheetData(xml, strings, name, styleFormats = []) {
    safeXml(xml);
    const cells = new Map(), rows = new Map(), merges = [];
    for (const match of xml.matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
      const rowNumber = Number(attrs(match[1]).r);
      if (!Number.isInteger(rowNumber) || rowNumber < 1 || rowNumber > 100000 || rows.size > 100000) throw new Error("Invalid worksheet row address or too many worksheet rows.");
      const row = [];
      for (const cellMatch of match[2].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
        const attr = attrs(cellMatch[1]), body = cellMatch[2] || "", coordinate = attr.r;
        if (!/^[A-Z]+\d+$/.test(coordinate || "")) throw new Error("Worksheet has a cell without a valid address.");
        const column = colIndex(coordinate.match(/^[A-Z]+/)[0]);
        if (column > 4096 || cells.size > 250000) throw new Error("Worksheet exceeds cell limits.");
        const token = body.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1] ?? "";
        let value = attr.t === "s" ? strings[Number(token)] : attr.t === "inlineStr" ? textTags(body) : xmlText(token);
        if (attr.t === "s" && value === undefined) throw new Error("Invalid shared string reference.");
        if (clean(value).length > 32768) throw new Error("A workbook cell is too long.");
        const format = styleFormats[Number(attr.s || 0)] || "";
        const dateFormat = format.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
        const cell = { value: clean(value), coordinate, row: rowNumber, column, numeric: !attr.t && /^\d+(?:\.\d+)?$/.test(value) && /[dmy]/i.test(dateFormat), formula: /<(?:\w+:)?f\b/.test(body), error: attr.t === "e", style: Number(attr.s || 0), precision: /m/i.test(dateFormat) && /y/i.test(dateFormat) && !/d/i.test(dateFormat) ? "month" : "day", hidden: attrs(match[1]).hidden === "1" };
        cells.set(coordinate, cell); row.push(cell);
      }
      rows.set(rowNumber, row);
    }
    for (const match of xml.matchAll(/<(?:\w+:)?mergeCell\b([^>]*?)\/>/g)) {
      const range = attrs(match[1]).ref, parts = range?.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
      if (parts) merges.push({ range, c1: colIndex(parts[1]), r1: Number(parts[2]), c2: colIndex(parts[3]), r2: Number(parts[4]), origin: `${parts[1]}${parts[2]}` });
    }
    return { name, cells, rows, merges, xml };
  }
  function cellAt(sheet, row, column) {
    const actual = (sheet.rows.get(row) || []).find((cell) => cell.column === column);
    const merge = sheet.merges.find((range) => row >= range.r1 && row <= range.r2 && column >= range.c1 && column <= range.c2);
    const origin = merge ? sheet.cells.get(merge.origin) : actual;
    const cell = actual?.value ? actual : origin;
    return { ...(cell || { value: "", row, column }), source: { sheet: sheet.name, cell: cell?.coordinate || "", mergeRange: merge?.range || "", inherited: Boolean(merge && (row !== merge.r1 || column !== merge.c1)), crossProduct: Boolean(merge && merge.r1 !== merge.r2), formula: Boolean(cell?.formula) } };
  }
  function isoWeekEnd(week, year) {
    const jan4 = new Date(Date.UTC(year, 0, 4));
    return new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * dayMs + (week - 1) * 7 * dayMs + 6 * dayMs).toISOString().slice(0, 10);
  }
  function reportWindow(raw) {
    const text = clean(raw).replace(/[’‘]/g, "'");
    const window = text.match(/\b(\d{1,2})\/(\d{1,2})\s*[~～-]\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
    if (window) return { value: exact(Number(window[5]), Number(window[3]), Number(window[4])), basis: "Report window end" };
    const week = text.match(/\bWK\s*(\d{1,2})\/(\d{4})\b/i);
    if (week && Number(week[1]) >= 1 && Number(week[1]) <= 53) return { value: isoWeekEnd(Number(week[1]), Number(week[2])), basis: "ISO week end (approximate)" };
    return null;
  }
  function parseCellDate(cell, date1904) {
    let parsed = parseDate(cell.value, { date1904, numeric: cell.numeric });
    if (cell.error) parsed = { raw: cell.value, kind: "invalid", value: "", reason: "Excel error cell" };
    if (cell.numeric && cell.precision === "month" && parsed.value) {
      const [year, month] = parsed.value.split("-").map(Number);
      parsed = { ...parsed, kind: "month", value: "", start: exact(year, month, 1), end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10), reason: "Excel displays month precision; the hidden day is not authoritative" };
    }
    return { ...parsed, source: cell.source };
  }
  async function parseWorkbook(input, options = {}) {
    if (!root.ASCMImporter?.helpers?.openZip) throw new Error("The Excel reader did not load. Reload PPC.");
    const bytes = input?.arrayBuffer ? new Uint8Array(await input.arrayBuffer()) : input instanceof ArrayBuffer ? new Uint8Array(input) : input;
    if (!root.crypto?.subtle) throw new Error("PLC imports require a secure browser context for file identification.");
    const fingerprint = [...new Uint8Array(await root.crypto.subtle.digest("SHA-256", bytes))].map((value) => value.toString(16).padStart(2, "0")).join("");
    const zip = await root.ASCMImporter.helpers.openZip(bytes, { maxFileBytes: 40 * 1024 * 1024, maxTotalUncompressedBytes: 128 * 1024 * 1024 });
    const types = safeXml(await zip.getText("[Content_Types].xml") || "");
    if (/macroEnabled/i.test(types) || !/spreadsheetml\.sheet\.main\+xml/i.test(types)) throw new Error("Choose an ordinary .xlsx workbook.");
    const workbook = safeXml(await zip.getText("xl/workbook.xml") || "");
    const relationships = safeXml(await zip.getText("xl/_rels/workbook.xml.rels") || "");
    const rels = new Map([...relationships.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/>/g)].map((match) => { const a = attrs(match[1]); return [a.Id, a]; }));
    const date1904 = /date1904=["'](?:1|true)["']/.test(workbook);
    const stylesRel = [...rels.values()].find((r) => /\/styles$/.test(r.Type));
    const styleXml = safeXml(await zip.getText(stylesRel ? root.ASCMImporter.helpers.resolveZipTarget("xl/workbook.xml", stylesRel.Target) : "xl/styles.xml") || "");
    const formats = new Map([[14, "m/d/yy"], [15, "d-mmm-yy"], [16, "d-mmm"], [17, "mmm-yy"], [22, "m/d/yy h:mm"]]);
    for (const match of styleXml.matchAll(/<(?:\w+:)?numFmt\b([^>]*?)\/>/g)) { const a = attrs(match[1]); formats.set(Number(a.numFmtId), a.formatCode); }
    const xfs = styleXml.match(/<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/)?.[1] || "";
    const styleFormats = [...xfs.matchAll(/<(?:\w+:)?xf\b([^>]*?)(?:\/>|>)/g)].map((match) => formats.get(Number(attrs(match[1]).numFmtId)) || "");
    const sharedRel = [...rels.values()].find((r) => /\/sharedStrings$/.test(r.Type));
    const strings = root.ASCMImporter.helpers.parseSharedStrings(await zip.getText(sharedRel ? root.ASCMImporter.helpers.resolveZipTarget("xl/workbook.xml", sharedRel.Target) : "xl/sharedStrings.xml") || "");
    const sheets = [], diagnostics = [], rows = [], supportingRows = [];
    for (const match of workbook.matchAll(/<(?:\w+:)?sheet\b([^>]*?)\/>/g)) {
      const a = attrs(match[1]), rel = rels.get(a["r:id"]);
      if (!rel || rel.TargetMode === "External" || !/\/worksheet$/.test(rel.Type)) continue;
      if (sheets.length >= 128) throw new Error("Too many worksheets.");
      const path = root.ASCMImporter.helpers.resolveZipTarget("xl/workbook.xml", rel.Target);
      const xml = await zip.getText(path);
      if (!xml) throw new Error(`Missing worksheet: ${a.name}`);
      const sheet = sheetData(xml, strings, a.name, styleFormats);
      sheet.path = path;
      sheet.hidden = Boolean(a.state && a.state !== "visible"); sheets.push(sheet);
    }
    const primaryCandidates = sheets.filter((sheet) => [...sheet.rows.values()].some((cells) => cells.some((c) => /^current\s+ffs$/i.test(c.value)) && cells.some((c) => /^(target|original)\s+ffs/i.test(c.value)) && cells.some((c) => /^stage$/i.test(c.value))));
    if (!primaryCandidates.length) throw new Error("No biweekly PLC table was found. Expected Stage, Target/Original FFS and Current FFS headers.");
    primaryCandidates.sort((a, b) => {
      const date = (sheet) => [...sheet.cells.values()].map((cell) => reportWindow(cell.value)).find((window) => window?.basis === "Report window end")?.value || (sheet.name.match(/20\d{2}/)?.[0] || "");
      return date(b).localeCompare(date(a));
    });
    if (primaryCandidates.length > 1) {
      const date = (sheet) => [...sheet.cells.values()].map((cell) => reportWindow(cell.value)).find((window) => window?.basis === "Report window end")?.value || (sheet.name.match(/20\d{2}/)?.[0] || "");
      if (date(primaryCandidates[0]) === date(primaryCandidates[1])) throw new Error("More than one equally current PLC snapshot table was found. The source is ambiguous.");
    }
    const primary = primaryCandidates[0];
    const healthShapes = new Map();
    const drawingId = primary.xml.match(/<(?:\w+:)?drawing\b[^>]*r:id=["']([^"']+)["']/)?.[1];
    if (drawingId) {
      const parts = primary.path.split("/"), filename = parts.pop();
      const sheetRels = safeXml(await zip.getText(`${parts.join("/")}/_rels/${filename}.rels`) || "");
      const relationship = [...sheetRels.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/>/g)].map((match) => attrs(match[1])).find((rel) => rel.Id === drawingId && rel.TargetMode !== "External");
      if (relationship) {
        const drawingPath = root.ASCMImporter.helpers.resolveZipTarget(primary.path, relationship.Target), drawingXml = safeXml(await zip.getText(drawingPath) || "");
        for (const match of drawingXml.matchAll(/<(?:\w+:)?(?:twoCellAnchor|oneCellAnchor)\b[^>]*>([\s\S]*?)<\/(?:\w+:)?(?:twoCellAnchor|oneCellAnchor)>/g)) {
          const body = match[1], from = body.match(/<(?:\w+:)?from>([\s\S]*?)<\/(?:\w+:)?from>/)?.[1] || "";
          const row = Number(from.match(/<(?:\w+:)?row>(\d+)<\/(?:\w+:)?row>/)?.[1]) + 1, column = Number(from.match(/<(?:\w+:)?col>(\d+)<\/(?:\w+:)?col>/)?.[1]) + 1;
          const color = body.match(/<(?:\w+:)?solidFill>\s*<(?:\w+:)?srgbClr\b[^>]*val=["']([A-Fa-f0-9]{6})["']/)?.[1]?.toUpperCase();
          if (column === 8 && /prst=["']ellipse["']/.test(body) && color) healthShapes.set(row, { label: color === "00B050" ? "Green source indicator" : color === "FFFF00" ? "Yellow source indicator" : `Source indicator #${color}`, color, source: { sheet: primary.name, cell: `H${row}`, drawing: drawingPath, shape: attrs(body.match(/<(?:\w+:)?cNvPr\b([^>]*?)(?:\/>|>)/)?.[1] || "").id || "" } });
        }
      }
    }
    const globalWindow = [...primary.cells.values()].map((cell) => reportWindow(cell.value)).find((window) => window?.basis === "Report window end");
    const metadata = { fileName: options.fileName || input?.name || "PLC report.xlsx", fingerprint, reportDate: globalWindow?.value || "", reportDateBasis: globalWindow?.basis || "Import date fallback", date1904, byteLength: bytes.byteLength, sheets: [] };
    let header = null, section = "", sectionDate = "", sectionBasis = "", nameColumn = 3;
    for (const [rowNumber, cells] of primary.rows) {
      if (cells.some((c) => /^current\s+ffs$/i.test(c.value))) {
        header = {}; for (const cell of cells) header[cell.value.replace(/\s+/g, " ").toLowerCase()] = cell.column;
        const stageColumn = header.stage;
        nameColumn = cells.filter((cell) => cell.column < stageColumn && !/^no\.?$/i.test(cell.value)).at(-1)?.column || 3;
        section = cells.find((cell) => cell.column === nameColumn)?.value || "Projects";
        const week = cells.map((cell) => reportWindow(cell.value)).find(Boolean);
        sectionDate = week?.value || metadata.reportDate; sectionBasis = week?.basis || metadata.reportDateBasis;
        if (week && globalWindow && /^Status in WK/i.test(cells.find((cell) => reportWindow(cell.value))?.value || "") && week.value >= globalWindow.value && week.value <= new Date(dateStamp(globalWindow.value) + 7 * dayMs).toISOString().slice(0, 10)) { sectionDate = globalWindow.value; sectionBasis = globalWindow.basis; }
        continue;
      }
      const nameCell = cells.find((cell) => cell.column === nameColumn);
      if (!header || !nameCell?.value) continue;
      if (/project cancelled/i.test(nameCell.value)) { section = "Cancelled projects"; continue; }
      if (!/["“]|headset|microphone|mice|mousepad|controller|keyboard/i.test(nameCell.value)) continue;
      const identity = extractIdentity(nameCell.value), currentCol = header["current ffs"], targetCol = Object.entries(header).find(([name]) => /^(target|original) ffs/.test(name))?.[1];
      const current = cellAt(primary, rowNumber, currentCol), target = cellAt(primary, rowNumber, targetCol);
      const statusColumn = Object.entries(header).find(([label]) => /^status\b/.test(label))?.[1] || 17, forecastColumn = Object.entries(header).find(([label]) => /fcst|forecast/i.test(label))?.[1] || 18;
      const row = { name: nameCell.value, ...identity, projectId: cellAt(primary, rowNumber, Object.entries(header).find(([label]) => /^no\.?$/i.test(label))?.[1] || nameColumn - 1).value, categoryId: categoryFor(nameCell.value, section), section, stage: cellAt(primary, rowNumber, header.stage).value, status: cellAt(primary, rowNumber, statusColumn).value, forecast: cellAt(primary, rowNumber, forecastColumn).value, reportDate: sectionDate, reportDateBasis: sectionBasis, dates: { ffsDate: parseCellDate(current, date1904) }, milestones: { targetFfs: parseCellDate(target, date1904) }, data: {}, sources: [{ sheet: primary.name, cell: nameCell.coordinate }], sourceRow: rowNumber };
      row.key = `${normalizeName(identity.codename)}|${normalizeName(identity.marketingName)}|${/colorway/i.test(section) ? "colorway" : /cancelled/i.test(section) ? "cancelled" : "base"}`;
      for (const cell of cells) if (cell.column > nameColumn && cell.value) row.data[`${Object.keys(header).find((key) => header[key] === cell.column) || `column ${cell.column}`} (${cell.coordinate})`] = cell.value;
      const health = cellAt(primary, rowNumber, Object.entries(header).find(([label]) => /^health\b/.test(label))?.[1] || 8); if (health.value) row.health = health.value; else if (healthShapes.has(rowNumber)) row.health = healthShapes.get(rowNumber);
      if (header["shipping ok"]) row.milestones.shippingOk = parseCellDate(cellAt(primary, rowNumber, header["shipping ok"]), date1904);
      if (/cancelled/i.test(section)) row.cancelled = true;
      rows.push(row);
    }
    // Supporting sheets are retained as dated observations, never promoted to a current date merely because they appear in a current file.
    for (const sheet of sheets.filter((sheet) => sheet !== primary)) {
      if (/^Quebec, Chile phase-in$/i.test(sheet.name)) {
        for (const [r, cells] of sheet.rows) {
          if (r <= 2) continue;
          const name = cellAt(sheet, r, 4), sku = cellAt(sheet, r, 3), code = cellAt(sheet, r, 5);
          if (!name.value || !sku.value || name.source.inherited) continue;
          const observation = { name: name.value, marketingName: name.value, codename: code.value, skus: sku.value.split(/[\s,;]+/).filter((value) => /^[A-Z0-9]{4,}(?:#[A-Z0-9]+)?$/i.test(value)), data: {}, dates: {}, milestones: {}, sources: [name.source], reportDate: "", reportDateBasis: "Compliance table has no reporting date", supporting: true };
          for (const cell of cells.filter((cell) => cell.column >= 6 && cell.column <= 14 && cell.value)) observation.data[`${cellAt(sheet, 2, cell.column).value || `column ${cell.column}`} (${cell.coordinate})`] = cell.value;
          supportingRows.push(observation);
        }
        metadata.sheets.push({ name: sheet.name, role: "SKU, packaging, compliance and shipment evidence (supporting)", hidden: sheet.hidden, rowCount: sheet.rows.size });
        continue;
      }
      if (/^BSP LQ$/i.test(sheet.name)) {
        for (const [r] of sheet.rows) {
          if (r <= 2) continue;
          const name = cellAt(sheet, r, 3), code = cellAt(sheet, r, 4);
          if (!name.value || !code.value || name.source.inherited) continue;
          const observation = { name: name.value, marketingName: name.value, codename: code.value, data: {}, dates: {}, milestones: {}, sources: [name.source], reportDate: "", reportDateBasis: "Launch-quarter table has no reporting date", supporting: true };
          for (let col = 5; col <= 9; col++) {
            const cell = cellAt(sheet, r, col), label = cellAt(sheet, 2, col).value; if (!cell.value) continue;
            observation.data[`${label} (${cell.source.cell})`] = cell.value;
            if (col === 6 || col === 7) observation.milestones[label] = parseCellDate(cell, date1904);
          }
          supportingRows.push(observation);
        }
        metadata.sheets.push({ name: sheet.name, role: "PLC/SM FFS and launch-quarter evidence (supporting)", hidden: sheet.hidden, rowCount: sheet.rows.size });
        continue;
      }
      if (/^New Project in PLC$/i.test(sheet.name)) {
        let stageHeaders = [], context = "", contextDate = "", contextBasis = "";
        for (const [r, cells] of sheet.rows) {
          if (cells.some((cell) => cell.column === 9 && /FFS/.test(cell.value)) && cells.some((cell) => cell.column === 14 && /SM/i.test(cell.value))) {
            stageHeaders = cells.filter((cell) => cell.column >= 5 && cell.column <= 15); context = cells.find((cell) => cell.column === 3)?.value || context;
            const sectionWindow = cells.map((cell) => reportWindow(cell.value)).find(Boolean);
            if (sectionWindow) { contextDate = sectionWindow.value; contextBasis = sectionWindow.basis; }
            continue;
          }
          const sectionWindow = cells.filter((cell) => cell.column === 10).map((cell) => reportWindow(cell.value)).find(Boolean);
          if (sectionWindow) { contextDate = sectionWindow.value; contextBasis = sectionWindow.basis; }
          const name = cellAt(sheet, r, 4);
          if (!stageHeaders.length || !name.value || !/["“]/.test(name.value) || name.source.inherited) continue;
          const identity = extractIdentity(name.value), observation = { name: name.value, ...identity, section: context, data: {}, dates: {}, milestones: {}, sources: [name.source], reportDate: contextDate, reportDateBasis: contextBasis || "Supporting section has no as-of date", supporting: true, cancelled: /cancel|paused/i.test(context), owners: { tu: cellAt(sheet, r, 14).value, tw: cellAt(sheet, r, 15).value } };
          for (const h of stageHeaders) {
            const cell = cellAt(sheet, r, h.column); if (!cell.value) continue;
            observation.data[`${h.value} (${cell.source.cell})`] = cell.value;
            if (h.column <= 9) observation.milestones[h.value] = parseCellDate(cell, date1904);
          }
          observation.currentFfs = parseCellDate(cellAt(sheet, r, 9), date1904);
          supportingRows.push(observation);
        }
        metadata.sheets.push({ name: sheet.name, role: "Stage-gate milestones, owners and workload (supporting)", hidden: sheet.hidden, rowCount: sheet.rows.size });
        continue;
      }
      const supported = /^(?:GA-PLC Exit|BSP LQ|Project Development Timeline|Est\.milestone|RSB & Tariff|Choice Points)/i.test(sheet.name);
      if (!supported) { metadata.sheets.push({ name: sheet.name, role: "Reference / historical / matrix (inventoried)", hidden: sheet.hidden, rowCount: sheet.rows.size }); continue; }
      for (const [headerRow, cells] of sheet.rows) {
        if (headerRow > 6) continue;
        for (const nameHeader of cells.filter((cell) => /^(?:project name|colorway project name|product name|project code|codename)$/i.test(cell.value))) {
          const nextName = cells.find((cell) => cell.column > nameHeader.column && /^(?:project name|colorway project name|product name|project code|codename)$/i.test(cell.value))?.column || Math.min(nameHeader.column + 22, 4096);
          const headers = cells.filter((cell) => cell.column >= nameHeader.column && cell.column < nextName);
          const sourceWindow = [...sheet.cells.values()].filter((c) => c.row <= 4).map((c) => reportWindow(c.value)).find(Boolean);
          for (const [r] of sheet.rows) {
            if (r <= headerRow) continue;
            const name = cellAt(sheet, r, nameHeader.column);
            if (!name.value || name.source.inherited) continue;
            const identity = extractIdentity(name.value), observation = { name: name.value, ...identity, data: {}, dates: {}, milestones: {}, sources: [name.source], reportDate: sourceWindow?.value || "", reportDateBasis: sourceWindow?.basis || "Supporting sheet has no as-of date", supporting: true };
            if (/project code|codename/i.test(nameHeader.value)) observation.codename = name.value;
            for (const h of headers.filter((c) => c.column !== nameHeader.column)) {
              const cell = cellAt(sheet, r, h.column); if (!cell.value) continue;
              observation.data[`${h.value} (${cell.source.cell})`] = cell.value;
              if (!/\b(?:ffs|ga|date|por|db|si1|si2|pv|mv|rtp|npi|ca|mrr|pco|co|evt|dvt|build|release|ready|exit|timing)\b/i.test(h.value)) continue;
              const parsed = parseCellDate(cell, date1904);
              observation.milestones[h.value] = parsed;
              if (/^GA Date$/i.test(h.value)) observation.dates.generalAvailabilityDate = parsed;
              if (parsed.kind === "exact" && parsed.value < "2019-01-01") diagnostics.push({ severity: "warning", code: "IMPLAUSIBLE_YEAR", sheet: sheet.name, cell: cell.source.cell, raw: cell.value, message: "Historical or implausible date year; source retained without repair" });
            }
            supportingRows.push(observation);
          }
        }
      }
      metadata.sheets.push({ name: sheet.name, role: "Supporting observations (not current authority)", hidden: sheet.hidden, rowCount: sheet.rows.size });
    }
    metadata.sheets.unshift({ name: primary.name, role: "Current biweekly snapshot", hidden: primary.hidden, rowCount: primary.rows.size });
    for (const row of rows) {
      row.observations = supportingRows.filter((observation) => row.codename && normalizeCode(observation.codename) === normalizeCode(row.codename) || normalizeName(observation.marketingName) === normalizeName(row.marketingName));
      row.skus = [...new Set(row.observations.flatMap((observation) => observation.skus || []))];
      row.conflicts = row.observations.filter((observation) => observation.currentFfs?.value && row.dates.ffsDate.value && observation.currentFfs.value !== row.dates.ffsDate.value && observation.reportDate && metadata.reportDate && observation.reportDate >= metadata.reportDate && !observation.cancelled).map((observation) => ({ field: "ffsDate", value: observation.currentFfs.value, raw: observation.currentFfs.raw, source: observation.currentFfs.source, reason: "Different FFS in a current stage-gate table" }));
      const gaObservations = row.observations.filter((observation) => observation.dates.generalAvailabilityDate);
      if (gaObservations.length === 1) row.dates.generalAvailabilityDate = { ...gaObservations[0].dates.generalAvailabilityDate, source: { ...gaObservations[0].dates.generalAvailabilityDate.source, supporting: true }, reason: "Explicit GA from an undated supporting sheet requires review" };
      const noteFfs = row.status.match(/FFS\s*\/?(?:CN|TH|VN)?\s*\((\d{1,2})\/(\d{1,2})\)/i);
      if (noteFfs && row.dates.ffsDate.value && row.dates.ffsDate.value.slice(5) !== `${String(noteFfs[1]).padStart(2, "0")}-${String(noteFfs[2]).padStart(2, "0")}`) row.conflicts.push({ field: "ffsDate", raw: noteFfs[0], source: { sheet: primary.name, cell: `Q${row.sourceRow}` }, reason: "FFS day in status notes differs from the structured current FFS" });
      if (row.dates.ffsDate.source.crossProduct) diagnostics.push({ severity: "warning", code: "MERGED_PRODUCT_DATE", ...row.dates.ffsDate.source, message: "FFS merged across product rows requires review" });
    }
    metadata.sourceRows = rows.length; metadata.supportingRows = supportingRows.length; metadata.healthIndicators = healthShapes.size;
    return { version, metadata, rows, supportingRows, diagnostics };
  }

  function buildPlan(dataset, portfolio, options = {}) {
    // Identical bytes retain their original collection date on every re-drop.
    const knownRun = !options.review && (portfolio.plcImports || []).find((run) => run.type !== "review" && run.fingerprint === dataset.metadata?.fingerprint);
    const proposedReportDate = knownRun?.reportDate || options.reportDate || dataset.metadata?.reportDate || localDay(options.now ? new Date(options.now) : new Date());
    const reportParsed = parseDate(proposedReportDate);
    if (reportParsed.kind !== "exact") throw new Error("The report date must be an exact calendar date.");
    const reportDate = reportParsed.value;
    const products = new Map(identities(portfolio).map((entry) => [entry.productId, entry.product]));
    const items = dataset.rows.map((row) => {
      const key = sourceKey(row), match = matchProduct(row, portfolio, options), product = products.get(match.productId);
      const metadata = row._plcMetadata || dataset.metadata || {};
      // The operator's import date controls collection freshness. Explicit
      // workbook periods still control field ordering, including older sections.
      const sourceDate = options.review ? row.reportDate || metadata.reportDate || reportDate : options.reportDateBasis === "Import date" ? row.reportDate || metadata.reportDate || reportDate : row.reportDate && row.reportDate !== dataset.metadata?.reportDate ? row.reportDate : reportDate;
      const fields = Object.entries(row.dates || {}).filter(([field]) => fieldLabels[field]).map(([field, supplied]) => {
        const parsed = typeof supplied === "object" && supplied ? supplied : parseDate(supplied);
        const current = clean(product?.[field]), incoming = parsed.value || "", previous = product?.plc?.fields?.[field];
        let status = parsed.kind === "blank" ? "blank" : parsed.kind === "exact" ? current === incoming ? "unchanged" : "update" : "review", reason = parsed.reason || "";
        if (row.cancelled) { status = "review"; reason = "Cancelled project; current dates stay unchanged"; }
        else if ((row.supporting || parsed.source?.supporting) && !(previous?.reviewed && !previous.supersededAt && parsed.kind === "exact" && previous.value === incoming && current === incoming && previous.raw === parsed.raw && previous.source?.sheet === parsed.source?.sheet)) { status = "review"; reason = "Supporting sheet is not a current dated authority"; }
        else if (parsed.source?.formula) { status = "review"; reason = "Cached formula dates require review; formulas are not evaluated"; }
        else if (parsed.source?.crossProduct) { status = "review"; reason = "Date merged across distinct product rows"; }
        else if (parsed.kind === "exact" && parsed.region && previous?.scope !== parsed.region && current !== incoming) { status = "review"; reason = `Regional ${parsed.region} date: choose which date represents PPC FFS`; }
        if (row.conflicts?.some((conflict) => conflict.field === field)) { status = "review"; reason = row.conflicts.filter((conflict) => conflict.field === field).map((conflict) => conflict.reason).join(". "); }
        if (previous?.reportDate && sourceDate < previous.reportDate) { status = "stale"; reason = "An older source cannot replace a newer accepted observation"; }
        else if (previous && sourceDate === previous.reportDate && incoming && incoming !== previous.value) { status = "review"; reason = "Different value for the same report date"; }
        else if (previous?.value && (current !== previous.value || previous.supersededAt) && current !== incoming && status === "update") { status = "review"; reason = "PPC date was edited after the previous PLC import"; }
        if (!previous && product && status === "update") {
          const accepted = root.PortfolioMasterModel?.dateEditsForProduct?.(portfolio, product.id)?.[field];
          if (accepted?.at && accepted.at.slice(0, 10) > sourceDate) { status = "review"; reason = "The master has an accepted date change newer than this source report"; }
        }
        const localEdit = portfolio.dateLocalEdits?.[product?.id]?.[field];
        const localEditTime = localEdit?.at ? new Date(localEdit.at) : null;
        if (status === "update" && localEdit?.source !== "plc" && clean(localEdit?.value) === current && localEditTime && Number.isFinite(localEditTime.getTime()) && localDay(localEditTime) >= sourceDate) {
          status = "review"; reason = "PPC has a local date edit on or after this source report; verify the incoming date";
        }
        const ga = field === "generalAvailabilityDate" ? incoming : product?.generalAvailabilityDate, em = field === "endManufacturingDate" ? incoming : product?.endManufacturingDate;
        if (ga && em && em < ga && status === "update") { status = "review"; reason = "GA would fall after end of manufacturing"; }
        return { field, label: fieldLabels[field], current, incoming, raw: parsed.raw || "", region: parsed.region || "", kind: parsed.kind, status, reason, source: parsed.source || row.sources?.[0] || {}, reportDate: sourceDate };
      });
      const gaProposal = fields.find((field) => field.field === "generalAvailabilityDate" && field.status === "update");
      const emProposal = fields.find((field) => field.field === "endManufacturingDate" && field.status === "update");
      const plannedGa = gaProposal?.incoming || product?.generalAvailabilityDate, plannedEm = emProposal?.incoming || product?.endManufacturingDate;
      if (plannedGa && plannedEm && plannedEm < plannedGa) for (const field of [gaProposal, emProposal].filter(Boolean)) { field.status = "review"; field.reason = "The proposed GA and end of manufacturing dates conflict"; }
      let action = match.status !== "matched" ? match.status === "unmatched" ? "unmatched" : "review" : fields.some((field) => field.status === "review") ? "review" : fields.some((field) => field.status === "update") ? "update" : fields.every((field) => field.status === "stale") ? "stale" : "unchanged";
      return { key, row, metadata, reportDate: sourceDate, match, matchedProductId: match.productId || "", fields, action };
    });
    const byProduct = new Map(); for (const item of items.filter((item) => item.matchedProductId)) { const list = byProduct.get(item.matchedProductId) || []; list.push(item); byProduct.set(item.matchedProductId, list); }
    for (const list of byProduct.values()) if (list.length > 1) for (const item of list) {
      item.action = "review";
      for (const field of item.fields) if (["update", "unchanged"].includes(field.status)) { field.status = "review"; field.reason = "Multiple source products or variants map to one PPC product"; }
    }
    const summary = { total: items.length, matched: items.filter((i) => i.match.status === "matched").length, update: items.filter((i) => i.action === "update").length, review: items.filter((i) => i.action === "review").length, unmatched: items.filter((i) => i.action === "unmatched").length, stale: items.filter((i) => i.action === "stale").length, unchanged: items.filter((i) => i.action === "unchanged").length };
    return { version, dataset, reportDate, reportDateBasis: knownRun?.reportDateBasis || options.reportDateBasis || (dataset.metadata?.reportDate ? reportDate !== dataset.metadata.reportDate ? "User supplied report date" : dataset.metadata.reportDateBasis : "Import date fallback"), items, summary, options: { ...options, reportDate }, baseline: [...products].map(([productId, p]) => ({ productId, fields: Object.fromEntries(Object.keys(fieldLabels).map((field) => [field, clean(p[field])])), plc: clone(p.plc || null) })) };
  }
  function buildReviewPlan(portfolio, options = {}) {
    const entries = portfolio.plcReview?.version === 1 ? portfolio.plcReview.entries || [] : [];
    const rows = entries.map((entry) => ({ ...clone(entry.row), dates: Object.fromEntries(Object.entries(entry.row.dates || {}).filter(([field]) => entry.matchNeeded || entry.fields.includes(field))), _plcMetadata: clone(entry.metadata), reportDate: entry.reportDate }));
    const metadata = { fileName: "Pending project updates", fingerprint: "review", reportDate: localDay(), reportDateBasis: "Each source retains its own report date" };
    const plan = buildPlan({ version, metadata, rows, diagnostics: [] }, portfolio, { ...options, review: true });
    plan.review = true;
    return plan;
  }
  function updateReviewQueue(next, effective, options, now) {
    let entries = clone(next.plcReview?.version === 1 ? next.plcReview.entries || [] : []);
    const products = new Map(identities(next).map((entry) => [entry.productId, entry.product]));
    for (const item of effective.items) {
      const earlier = entries.find((entry) => entry.key === item.key);
      if (earlier && earlier.reportDate > item.reportDate) continue;
      entries = entries.filter((entry) => entry.key !== item.key);
      if (item.row.cancelled || options.skippedKeys?.includes(item.key)) continue;
      const product = products.get(item.matchedProductId), matchNeeded = item.match.status !== "matched";
      const fields = item.fields.filter((field) => !options.skippedFields?.[item.key]?.includes(field.field) && !options.resolutions?.[item.key]?.[field.field] && field.status === "review"
        && !(product?.plc?.fields?.[field.field]?.reviewed && product.plc.fields[field.field].fingerprint === item.metadata.fingerprint && product.plc.fields[field.field].raw === field.raw)).map((field) => field.field);
      if (!matchNeeded && !fields.length) continue;
      const row = clone(item.row); delete row._plcMetadata;
      // Current raw data, conflicts and all date sources are sufficient to resolve
      // an exception. Supporting tables remain in collected product evidence.
      delete row.observations;
      entries.push({ key: item.key, row, metadata: { fileName: item.metadata.fileName, fingerprint: item.metadata.fingerprint, reportDate: item.reportDate, reportDateBasis: !effective.options.review && item.reportDate === effective.reportDate ? effective.reportDateBasis : item.metadata.reportDateBasis || effective.reportDateBasis }, reportDate: item.reportDate, fields, matchNeeded, createdAt: earlier?.createdAt || now, observedAt: earlier?.metadata.fingerprint === item.metadata.fingerprint ? earlier.observedAt : now });
    }
    if (entries.length > 2000 || JSON.stringify(entries).length > 1500000) throw new Error("The saved review queue is full. Resolve or export older exceptions before importing more files.");
    next.plcReview = { version, entries };
    return entries.length;
  }
  function applyPlan(portfolio, plan, options = {}) {
    const now = new Date(options.now || new Date()).toISOString(), next = clone(portfolio), result = { imported: 0, datesUpdated: 0, unchanged: 0, skipped: 0, review: 0, duplicate: false };
    const effective = buildPlan(plan.dataset, portfolio, { ...plan.options, selections: { ...plan.options?.selections, ...options.selections } });
    const products = new Map(identities(next).map((entry) => [entry.productId, entry.product]));
    const originalProducts = new Map(identities(portfolio).map((entry) => [entry.productId, entry.product]));
    const baselines = new Map((plan.baseline || []).map((entry) => [entry.productId, entry]));
    const history = [], proposals = new Map();
    // Validate every resolution before constructing mutations. Older reports cannot be forced through review.
    for (const item of effective.items) {
      if (options.skippedKeys?.includes(item.key) || item.match.status !== "matched") { result.skipped++; continue; }
      const product = products.get(item.matchedProductId), original = originalProducts.get(item.matchedProductId), baseline = baselines.get(item.matchedProductId);
      if (baseline && (JSON.stringify(baseline.plc) !== JSON.stringify(original.plc || null) || Object.keys(fieldLabels).some((field) => baseline.fields[field] !== clean(original[field])))) throw new Error("PPC changed since the preview. Reload the preview before applying PLC updates.");
      const previous = product.plc || {};
      const metadata = item.metadata;
      const olderObservation = previous.reportDate && item.reportDate < previous.reportDate;
      const patch = {}, fieldEvidence = { ...(previous.fields || {}) }, historyStart = history.length;
      for (const field of item.fields) {
        const skipped = options.skippedFields?.[item.key]?.includes(field.field), resolution = options.resolutions?.[item.key]?.[field.field];
        if (resolution && field.status === "stale") throw new Error("Older reports cannot overwrite newer dates.");
        if (resolution && parseDate(resolution).kind !== "exact") throw new Error("Reviewed dates must use a valid YYYY-MM-DD calendar date.");
        let incoming = resolution || field.incoming;
        const allowed = !skipped && !item.row.cancelled && (resolution || field.status === "update" || field.status === "unchanged");
        if (!allowed || !incoming || field.status === "stale") { if (field.status === "review") result.review++; continue; }
        if (proposals.has(`${product.id}/${field.field}`) && proposals.get(`${product.id}/${field.field}`) !== incoming) throw new Error("Two source rows propose different dates for one PPC product. Keep one source date and apply again.");
        proposals.set(`${product.id}/${field.field}`, incoming);
        const oldEvidence = fieldEvidence[field.field];
        if (product[field.field] !== incoming) { patch[field.field] = incoming; result.datesUpdated++; history.push({ at: now, productId: product.id, field: field.field, before: clean(product[field.field]), after: incoming, reportDate: field.reportDate, sourceFile: metadata.fileName, fingerprint: metadata.fingerprint, source: field.source, raw: field.raw, reviewed: Boolean(resolution) }); }
        const localChange = next.dateLocalEdits?.[product.id]?.[field.field];
        fieldEvidence[field.field] = { value: incoming, reportDate: field.reportDate, sourceFile: metadata.fileName, fingerprint: metadata.fingerprint, changedAt: product[field.field] !== incoming ? now : localChange?.value === incoming && localChange.at > (oldEvidence?.changedAt || "") ? localChange.at : oldEvidence?.changedAt || "", observedAt: !oldEvidence?.supersededAt && oldEvidence?.fingerprint === metadata.fingerprint && oldEvidence.value === incoming ? oldEvidence.observedAt : now, raw: field.raw, source: field.source, scope: resolution && incoming === field.incoming ? field.region : oldEvidence?.scope || "", reviewed: Boolean(resolution) || oldEvidence?.reviewed && oldEvidence.raw === field.raw && oldEvidence.value === incoming || false };
      }
      const ga = patch.generalAvailabilityDate || product.generalAvailabilityDate, em = patch.endManufacturingDate || product.endManufacturingDate;
      if ((Object.hasOwn(patch, "generalAvailabilityDate") || Object.hasOwn(patch, "endManufacturingDate")) && ga && em && em < ga) throw new Error("A selected date places GA after end of manufacturing. Correct the review dates first.");
      const already = previous.fingerprint === metadata.fingerprint && (previous.rows || []).some((row) => row.key === item.key) && !Object.keys(patch).length && !Object.keys(options.resolutions?.[item.key] || {}).length && JSON.stringify(fieldEvidence) === JSON.stringify(previous.fields || {});
      if (already) { result.unchanged++; continue; }
      const merged = root.PortfolioModel?.mergeProductUpdate ? root.PortfolioModel.mergeProductUpdate(product, patch) : { ...product, ...patch };
      const rowRecord = { ...clone(item.row), importedAt: now, reportDate: item.reportDate, fingerprint: metadata.fingerprint }; delete rowRecord._plcMetadata;
      const currentRows = previous.fingerprint === metadata.fingerprint ? previous.rows || [] : [];
      merged.plc = { version, sourceFile: olderObservation ? previous.sourceFile : metadata.fileName, fingerprint: olderObservation ? previous.fingerprint : metadata.fingerprint, reportDate: olderObservation ? previous.reportDate : item.reportDate, reportDateBasis: olderObservation ? previous.reportDateBasis : effective.options.review || item.reportDate !== effective.reportDate ? item.row.reportDateBasis || metadata.reportDateBasis : effective.reportDateBasis, importedAt: olderObservation ? previous.importedAt : now, changedAt: Object.keys(patch).length ? now : previous.changedAt || "", fields: fieldEvidence, rows: olderObservation ? previous.rows || [] : [...currentRows.filter((row) => row.key !== item.key), rowRecord], identities: [...(previous.identities || []).filter((identity) => identity.key !== item.key), { key: item.key, name: item.row.name, codename: item.row.codename || "", confirmed: item.match.reason === "Selected product" }].slice(-200), history: [...(previous.history || []), ...history.slice(historyStart)].slice(-100) };
      Object.assign(product, merged); result.imported++;
    }
    result.pendingReview = updateReviewQueue(next, effective, options, now);
    const previousCollection = next.plcCollection;
    const olderCollection = previousCollection?.metadata?.reportDate && effective.dataset.metadata.reportDate && effective.dataset.metadata.reportDate < previousCollection.metadata.reportDate;
    if (!effective.options.review && !olderCollection && previousCollection?.metadata?.fingerprint !== effective.dataset.metadata.fingerprint) {
      // Retain the current typed source snapshot, including supporting projects
      // that do not yet have a PPC match. Do not duplicate attached observations.
      const primaryRows = effective.dataset.rows.map((row) => Object.fromEntries(Object.entries(clone(row)).filter(([key]) => !["observations", "_plcMetadata"].includes(key))));
      next.plcCollection = { version, importedAt: now, metadata: clone(effective.dataset.metadata), primaryRows, supportingRows: clone(effective.dataset.supportingRows || []) };
      if (JSON.stringify(next.plcCollection).length > 3000000) throw new Error("The collected source evidence is too large for this workspace. The previous collection remains intact.");
    }
    const run = { at: now, type: plan.review || effective.options.review ? "review" : "import", reportDate: effective.reportDate, reportDateBasis: effective.reportDateBasis, sourceFile: effective.dataset.metadata.fileName, fingerprint: effective.dataset.metadata.fingerprint, metadata: clone(effective.dataset.metadata), summary: result, diagnostics: effective.dataset.diagnostics || [], rows: effective.items.map((item) => ({ key: item.key, name: item.row.name, productId: item.matchedProductId, action: item.action, observation: Object.fromEntries(Object.entries(clone(item.row)).filter(([key]) => !["observations", "_plcMetadata"].includes(key))), fields: item.fields.map((field) => ({ field: field.field, status: field.status, raw: field.raw, reason: field.reason, source: field.source })) })) };
    if (!result.imported && !history.length && (next.plcImports || []).some((entry) => entry.fingerprint === run.fingerprint) && JSON.stringify(next.plcReview) === JSON.stringify(portfolio.plcReview) && JSON.stringify(next.plcCollection) === JSON.stringify(portfolio.plcCollection)) { result.duplicate = true; return { portfolio: clone(portfolio), summary: result, history: [] }; }
    next.plcImports = [...(next.plcImports || []), run].slice(-52);
    while (next.plcImports.length > 1 && JSON.stringify(next.plcImports).length > 1500000) next.plcImports.shift();
    return { portfolio: next, summary: result, history };
  }
  function freshness(metadata, today = localDay()) {
    const day = today instanceof Date ? localDay(today) : String(today).slice(0, 10), stamp = dateStamp(day);
    const age = (date) => {
      if (!date || parseDate(String(date).slice(0, 10)).kind !== "exact") return null;
      const timestamp = String(date).includes("T") ? new Date(date) : null;
      if (timestamp && !Number.isFinite(timestamp.getTime())) return null;
      const observedDay = timestamp ? localDay(timestamp) : String(date).slice(0, 10);
      return Math.max(0, Math.floor((stamp - dateStamp(observedDay)) / dayMs));
    };
    const ageDays = age(metadata?.reportDate), importAgeDays = age(metadata?.importedAt), changeAgeDays = age(metadata?.changedAt);
    const valid = parseDate(metadata?.reportDate || "").kind === "exact";
    return { ageDays: valid ? ageDays : null, importAgeDays, changeAgeDays, status: !valid ? "unknown" : dateStamp(metadata.reportDate) > stamp ? "future" : ageDays > 14 ? "overdue" : ageDays === 14 ? "due" : "current", nextDueDate: valid ? new Date(dateStamp(metadata.reportDate) + 14 * dayMs).toISOString().slice(0, 10) : "" };
  }
  function snapshotDateValues(portfolio) {
    return Object.fromEntries(identities(portfolio).map(({ productId, product }) => [productId, Object.fromEntries(Object.keys(fieldLabels).map((field) => [field, clean(product[field])]))]));
  }
  // Call only for actual local mutations, never to reconstruct missing history.
  function recordDateChanges(before, portfolio, { now = new Date(), source = "local" } = {}) {
    const at = new Date(now).toISOString();
    for (const { productId, product } of identities(portfolio)) for (const field of Object.keys(fieldLabels)) {
      const value = clean(product[field]), previous = before?.[productId]?.[field] || "";
      if (value === previous) continue;
      portfolio.dateLocalEdits ||= {};
      portfolio.dateLocalEdits[productId] ||= {};
      portfolio.dateLocalEdits[productId][field] = { at, value, source };
      if (source !== "plc" && product.plc?.fields?.[field]) product.plc.fields[field].supersededAt = at;
    }
    return snapshotDateValues(portfolio);
  }
  function getFieldAge(product, field, today = localDay(), context = {}) {
    const value = clean(product?.[field]);
    const raw = product?.plc?.fields?.[field];
    const evidence = !raw?.supersededAt && clean(raw?.value) === value ? raw : null;
    const local = context.draft || context.local || null;
    const localAt = local && clean(local.value) === value ? local.at || "" : "";
    const accepted = context.accepted;
    const acceptedAt = accepted && (!Object.hasOwn(accepted, "value") || clean(accepted.value) === value) ? accepted.at || "" : "";
    const changedAt = value ? [evidence?.changedAt || "", localAt, evidence || localAt ? "" : acceptedAt].filter(Boolean).sort().at(-1) || "" : "";
    const observedAt = value ? evidence?.observedAt || localAt || acceptedAt : "";
    const clocks = freshness({ reportDate: evidence?.reportDate, importedAt: observedAt, changedAt }, today);
    return { value, populated: Boolean(value), changedAt, changeAgeDays: clocks.changeAgeDays, observedAt, observedAgeDays: clocks.importAgeDays, acceptedAt, acceptedAgeDays: freshness({ changedAt: acceptedAt }, today).changeAgeDays, sourceReportDate: evidence?.reportDate || "", sourceAgeDays: clocks.ageDays, sourceFile: evidence?.sourceFile || "", source: evidence?.source || null };
  }
  root.PLCImporter = Object.freeze({ version, fieldLabels, parseDate, normalizeName, matchProduct, parseWorkbook, buildPlan, buildReviewPlan, applyPlan, freshness, localDay, snapshotDateValues, recordDateChanges, getFieldAge });
})(globalThis);
