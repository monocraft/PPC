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
  const yearNumber = (text) => /^\d{2}$/.test(String(text)) ? 2000 + Number(text) : Number(text);
  function normalizePeriod(period, value) {
    if (!period || period.precision !== "quarter" || period.basis !== "calendar" || !Number.isInteger(period.year) || period.year < 1900 || period.year > 9999 || ![1, 2, 3, 4].includes(period.quarter)) return null;
    const startMonth = (period.quarter - 1) * 3 + 1;
    const canonical = { precision: "quarter", basis: "calendar", year: period.year, quarter: period.quarter, start: exact(period.year, startMonth, 1), end: new Date(Date.UTC(period.year, startMonth + 2, 0)).toISOString().slice(0, 10), label: `Q${period.quarter} ${period.year}` };
    return value === canonical.start && period.start === canonical.start && period.end === canonical.end ? canonical : null;
  }
  function currentPeriod(product, field) {
    const evidence = product?.plc?.fields?.[field];
    return evidence && !evidence.supersededAt && evidence.value === product?.[field] ? normalizePeriod(evidence.period, product[field]) : null;
  }
  function dateLabel(value, period) { return normalizePeriod(period, value)?.label || value || "TBD"; }
  function parseQuarterDate(text, basis) {
    if (/\?|\b(?:FY|fiscal|risk|maybe|tentative)\b/i.test(text)) return null;
    const plain = text.replace(/^(?:PM\s+adjusted\s+(?:(?:FFS|GA)\s+)?to\s+|(?:current\s+)?FFS\s+(?:to\s+)?)/i, "").replace(/^calendar\s+/i, "").trim();
    const match = plain.match(/^Q([1-4])\s*[/ '-]*(\d{4}|\d{2})$/i) || plain.match(/^(\d{4})\s*Q([1-4])$/i)?.map((v, i, a) => i === 1 ? a[2] : i === 2 ? a[1] : v);
    if (!match) return null;
    const year = yearNumber(match[2]), quarter = Number(match[1]), startMonth = (quarter - 1) * 3 + 1;
    if (year < 1900 || year > 9999) return null;
    const start = exact(year, startMonth, 1), end = new Date(Date.UTC(year, startMonth + 2, 0)).toISOString().slice(0, 10);
    return { year, quarter, periodBasis: basis || "unspecified", ...(basis === "calendar" ? { value: start, start, end, period: { precision: "quarter", basis: "calendar", year, quarter, start, end, label: `Q${quarter} ${year}` } } : {}), reason: basis === "calendar" ? "Calendar quarter; first day is a roadmap placement anchor" : "Quarter calendar requires review" };
  }
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
    const calendarQuarter = parseQuarterDate(text, options.quarterBasis);
    if (calendarQuarter) return result("quarter", calendarQuarter);
    if (options.currentFfs && /=>|→|->/.test(text) && !/\?|[~～]|\bto\b/i.test(text)) {
      const parts = text.split(/\s*(?:=>|→|->)\s*/);
      const priorDates = parts.slice(0, -1).map((part) => parseDate(part));
      const dateOnly = (part) => /^(?:FFS\s*)?(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\s*'?\d{2,4})?)(?:\s*\((?:[A-Za-z /,]+)\))?$/i.test(part);
      if (parts.length <= 10 && parts.slice(0, -1).every(dateOnly) && priorDates.every((date) => ["exact", "missing-year"].includes(date.kind))) {
        const latest = parseDate(parts.at(-1), { ...options, currentFfs: false });
        const selected = latest.kind === "multiple" ? parseCurrentFfsChoices(parts.at(-1), options, latest) : latest;
        return { ...selected, raw: original, revision: { previous: parts.slice(0, -1), current: parts.at(-1) }, reason: selected.kind === "exact" ? "Latest explicit date in Current FFS revision" : selected.reason };
      }
    }
    if (/=>|→|->|\bto\b|[~～]/i.test(text)) return result("range", { reason: "Revision or date range requires an explicit selected date" });
    if (/\?/.test(text)) return result("unknown", { reason: "Unconfirmed date" });
    if (/\bQ[1-4]\b/i.test(text)) return result("quarter", { reason: "Multiple, fiscal, or unsupported quarter text requires review" });
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
    if (dateTokens.length > 1 || /[,;]/.test(stripped) && /\d/.test(stripped)) {
      const multiple = result("multiple", { region, reason: "Multiple regional dates must be selected explicitly" });
      return options.currentFfs ? parseCurrentFfsChoices(text, options, multiple) : multiple;
    }
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

  function parseCurrentFfsChoices(text, options, fallback) {
    const tokens = [...text.matchAll(/(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\s*'?\d{2,4})?)(?:\s*\((?:CN|TH|VN|RSB|PC|US|UK|CHINA|THAILAND|VIETNAM)(?:\s*\/\s*(?:CN|TH|VN|RSB|US|UK))*\))?/gi)];
    let remainder = text;
    for (const token of tokens) remainder = remainder.replace(token[0], "");
    if (tokens.length < 2 || tokens.length > 20 || !/^[\s,;]*$/.test(remainder)) return fallback;
    const candidates = tokens.map((token) => parseDate(token[0], { ...options, currentFfs: false }));
    const values = new Set(candidates.filter((candidate) => candidate.kind === "exact").map((candidate) => candidate.value));
    if (candidates.every((candidate) => candidate.kind === "exact") && values.size === 1) return { ...fallback, kind: "exact", value: candidates[0].value, region: [...new Set(candidates.map((candidate) => candidate.region).filter(Boolean))].join(", "), candidates, reason: "All explicit regional Current FFS dates agree" };
    return { ...fallback, candidates };
  }

  const scopeTokens = (region) => clean(region).toUpperCase().split(/[\s,\/]+/).filter(Boolean).map((token) => ({ CHINA: "CN", THAILAND: "TH", VIETNAM: "VN" })[token] || token);
  const sameScope = (a, b) => scopeTokens(a).sort().join("/") === scopeTokens(b).sort().join("/");
  const compatibleScope = (a, b) => !a || !b || scopeTokens(a).some((token) => scopeTokens(b).includes(token));

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
  const colorVariants = (product) => (product?.variantGroups || []).filter((group) => group.type === "color").flatMap((group) => (group.items || []).map((variant) => ({ ...variant, groupId: group.id })));
  const colorCode = (value) => root.ASCMImporter?.helpers?.canonicalColorCode?.(value) || root.PortfolioModel?.canonicalColorCode?.(value) || clean(value).toUpperCase();
  const variantName = (variant) => [variant?.colorName, variant?.colorName2].filter(Boolean).join(" / ") || variant?.label || variant?.code || "Colorway";
  const colorwaySnapshot = (variant) => Object.fromEntries(["code", "colorKey", "colorName", "colorHex", "colorKey2", "colorName2", "colorHex2"].map((field) => [field, String(variant?.[field] ?? "")]));
  function colorIdentity(variant) {
    const canonical = root.ASCMImporter?.helpers?.canonicalColorCode;
    const codes = clean(canonical?.(variant?.canonicalCode || variant?.code)).split("/");
    const names = clean(canonical?.(variant?.colorName)).split("/");
    const primary = names[0] || canonical?.(variant?.colorKey) || codes[0] || `custom:${normalizeCode(variant?.colorName)}:${clean(variant?.colorHex).toLowerCase()}`;
    const secondaryPresent = Boolean(variant?.colorKey2 || variant?.colorName2 || variant?.colorHex2 || names[1] || codes[1]);
    const secondary = secondaryPresent ? canonical?.(variant?.colorName2) || canonical?.(variant?.colorKey2) || names[1] || codes[1] || `custom:${normalizeCode(variant?.colorName2)}:${clean(variant?.colorHex2).toLowerCase()}` : "";
    return `${primary}|${secondary}`;
  }
  const sourceColorMatches = (variant, source) => !source || colorIdentity(variant) === colorIdentity(source);
  function colorwayIdentity(row) {
    const identity = extractIdentity(row.name), code = clean(row.codename || identity.codename), name = clean(row.marketingName || identity.marketingName);
    const infer = root.ASCMImporter?.helpers?.inferColorVariant;
    const codeColor = infer?.(code), nameColor = infer?.(name), color = codeColor || nameColor || null;
    const remove = (text, found) => found ? clean(`${text.slice(0, found.matchStart)} ${text.slice(found.matchEnd)}`).replace(/\s+/g, " ") : text;
    const detected = Boolean(color || /\bcolorway\b/i.test(`${row.section || ""} ${row.name || ""}`));
    return { detected, color, baseName: remove(name, nameColor), baseCodename: remove(code, codeColor), reason: detected ? "Colorway milestones belong to a color option, not the product-wide dates" : "" };
  }
  function hardwareConflict(source, target) {
    const signature = (value) => normalizeName(value).replace(/\b(quadcast|solocast|flipcast|cloud|alpha)\s*(\d+)/g, "$1 $2").replace(/\b(\d+)(s|pro|mini)\b/g, "$1 $2").replace(/\bsmini\b/g, "s mini");
    const first = signature(source), second = signature(target);
    const family = (value) => value.match(/\b(?:quadcast|solocast|flipcast|cloud|alpha|pulsefire haste|clutch|alloy origins)\b/)?.[0] || "";
    const a = family(first), b = family(second);
    if (a && b && a !== b) return "Product families differ";
    if (a && a === b) {
      const generation = (value) => value.slice(value.indexOf(a) + a.length).match(/^\s+(\d+)\b/)?.[1] || "";
      if (generation(first) !== generation(second)) return "Hardware generations differ";
      const qualifiers = (value) => (value.match(/\b(?:pro|s|mini|core)\b/g) || []).sort().join("/");
      if (qualifiers(first) !== qualifiers(second)) return "Hardware editions differ";
    }
    const connection = (value) => /\b(?:wireless|wl)\b/i.test(value) ? "wireless" : /\b(?:wired|wd)\b/i.test(value) ? "wired" : "";
    if (connection(source) && connection(target) && connection(source) !== connection(target)) return "Wired and wireless models differ";
    const platform = (value) => /\bxbox\b/i.test(value) ? "xbox" : /\b(?:ps[345]|playstation)\b/i.test(value) ? "playstation" : "";
    if (platform(source) && platform(target) && platform(source) !== platform(target)) return "Console platforms differ";
    return "";
  }
  function getVariantProject(product, variantId) { return product?.plc?.variantProjects?.[variantId] || null; }
  function variantProduct(product, variantId) {
    if (!variantId || !product) return product;
    const project = getVariantProject(product, variantId) || {};
    return { ...product, ...Object.fromEntries(Object.keys(fieldLabels).map((field) => [field, clean(project.fields?.[field]?.value)])), plc: project };
  }
  function rememberedVariant(product, key) {
    const identity = product?.plc?.identities?.find((entry) => entry.key === key && entry.variantId);
    return identity && colorVariants(product).some((variant) => variant.id === identity.variantId) ? identity.variantId : "";
  }
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
    const explicit = options.variantAssignments?.[key]?.productId || options.selections?.[key] || options.aliases?.[key];
    const compatible = (entry) => !row.categoryId || row.categoryId === entry.categoryId;
    const candidates = [];
    const incomingIdentity = extractIdentity(row.name);
    const incomingName = normalizeName(row.marketingName || incomingIdentity.marketingName);
    const incomingCode = normalizeCode(row.codename || incomingIdentity.codename);
    const colorway = colorwayIdentity(row), baseName = normalizeName(colorway.baseName), baseCode = normalizeCode(colorway.baseCodename);
    const skuList = (row.skus || row.partNumbers || []).map((sku) => clean(sku).toUpperCase());
    for (const entry of all) {
      const product = entry.product;
      let score = 0, reason = "";
      if (explicit === entry.productId) { score = 100; reason = "Selected product"; }
      else if (product.plc?.createdFromSource?.key === key && product.plc?.identities?.some((identity) => identity.key === key)) { score = 99; reason = "Confirmed PLC source identity"; }
      else if (!compatible(entry)) continue;
      else if (hardwareConflict(colorway.baseName || incomingIdentity.marketingName, extractIdentity(product.name).marketingName)) continue;
      else if (/\b(?:xbox|ps5|ps4|playstation)\b/i.test(row.name) && /\b(?:xbox|ps5|ps4|playstation)\b/i.test(product.name)
        && /xbox/i.test(row.name) !== /xbox/i.test(product.name)) continue;
      else if (/\b(?:wireless|wl)\b/i.test(row.name) && /\b(?:wired|wd)\b/i.test(product.name) || /\b(?:wired|wd)\b/i.test(row.name) && /\b(?:wireless|wl)\b/i.test(product.name)) continue;
      else if (row.productId === entry.productId || row.projectId && !/^\d+$/.test(String(row.projectId)) && row.projectId === entry.productId) { score = 100; reason = "Exact PPC product ID"; }
      else if (product.plc?.identities?.some((identity) => identity.key === key)) { score = 99; reason = "Remembered source identity"; }
      else {
        const codes = [...(product.partSkus || []).map((sku) => sku.code), ...(product.ascm?.basePartNumbers || []), ...colorVariants(product).map((variant) => variant.code).filter((value) => !root.ASCMImporter?.helpers?.canonicalColorCode?.(value) && /^[A-Z0-9]{4,}(?:#[A-Z0-9]+)?$/i.test(clean(value)))].map((sku) => clean(sku).toUpperCase());
        const ownIdentity = extractIdentity(product.name);
        const name = normalizeName(ownIdentity.marketingName);
        const code = normalizeCode(product.codename || product.codeName || ownIdentity.codename);
        const ownColorway = colorwayIdentity({ name: product.name, codename: product.codename || product.codeName });
        if (skuList.some((sku) => codes.includes(sku))) { score = 98; reason = "Exact HP SKU"; }
        else if (incomingCode && code === incomingCode) { score = 96; reason = "Exact codename"; }
        else if (incomingName && incomingName === name) { score = 94; reason = "Exact normalized product name"; }
        else if (colorway.detected && baseCode && normalizeCode(ownColorway.baseCodename) === baseCode) { score = 95; reason = "Same hardware codename; select its color option"; }
        else if (colorway.detected && baseName && baseName === normalizeName(ownColorway.baseName)) { score = 94; reason = "Same hardware name; select its color option"; }
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
    if (window) return { value: exact(Number(window[5]), Number(window[3]), Number(window[4])), basis: "Report window end", precision: "day" };
    const week = text.match(/\bWK\s*(\d{1,2})\/(\d{4})\b/i);
    if (week && Number(week[1]) >= 1 && Number(week[1]) <= 53) {
      const end = isoWeekEnd(Number(week[1]), Number(week[2]));
      return { value: end, basis: "ISO week end (approximate)", precision: "week", start: new Date(dateStamp(end) - 6 * dayMs).toISOString().slice(0, 10), end };
    }
    return null;
  }
  function parseCellDate(cell, date1904, options = {}) {
    let parsed = parseDate(cell.value, { date1904, numeric: cell.numeric, ...options });
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
      const currentFfs = parseCellDate(current, date1904, { currentFfs: true, quarterBasis: "calendar" });
      currentFfs.source.authoritativeCurrentFfs = current.column === currentCol;
      if (current.column !== currentCol) currentFfs.source.currentFfsFromOtherColumn = true;
      const row = { name: nameCell.value, ...identity, projectId: cellAt(primary, rowNumber, Object.entries(header).find(([label]) => /^no\.?$/i.test(label))?.[1] || nameColumn - 1).value, categoryId: categoryFor(nameCell.value, section), section, stage: cellAt(primary, rowNumber, header.stage).value, status: cellAt(primary, rowNumber, statusColumn).value, forecast: cellAt(primary, rowNumber, forecastColumn).value, reportDate: sectionDate, reportDateBasis: sectionBasis, dates: { ffsDate: currentFfs }, milestones: { targetFfs: parseCellDate(target, date1904) }, data: {}, sources: [{ sheet: primary.name, cell: nameCell.coordinate }], sourceRow: rowNumber };
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
        let stageHeaders = [], context = "", contextDate = "", contextBasis = "", contextPeriod = null;
        for (const [r, cells] of sheet.rows) {
          if (cells.some((cell) => cell.column === 9 && /FFS/.test(cell.value)) && cells.some((cell) => cell.column === 14 && /SM/i.test(cell.value))) {
            stageHeaders = cells.filter((cell) => cell.column >= 5 && cell.column <= 15); context = cells.find((cell) => cell.column === 3)?.value || context;
            const sectionWindow = cells.map((cell) => reportWindow(cell.value)).find(Boolean);
            if (sectionWindow) { contextDate = sectionWindow.value; contextBasis = sectionWindow.basis; contextPeriod = sectionWindow; }
            continue;
          }
          const sectionWindow = cells.filter((cell) => cell.column === 10).map((cell) => reportWindow(cell.value)).find(Boolean);
          if (sectionWindow) { contextDate = sectionWindow.value; contextBasis = sectionWindow.basis; contextPeriod = sectionWindow; }
          const name = cellAt(sheet, r, 4);
          if (!stageHeaders.length || !name.value || !/["“]/.test(name.value) || name.source.inherited) continue;
          const identity = extractIdentity(name.value), observation = { name: name.value, ...identity, section: context, data: {}, dates: {}, milestones: {}, sources: [name.source], reportDate: contextDate, reportDateBasis: contextBasis || "Supporting section has no as-of date", reportDatePrecision: contextPeriod?.precision || "", reportPeriodStart: contextPeriod?.start || "", reportPeriodEnd: contextPeriod?.end || "", supporting: true, cancelled: /cancel|paused/i.test(context), owners: { tu: cellAt(sheet, r, 14).value, tw: cellAt(sheet, r, 15).value } };
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
      const differentFfs = row.observations.filter((observation) => observation.currentFfs?.value && row.dates.ffsDate.value && observation.currentFfs.value !== row.dates.ffsDate.value && !observation.cancelled);
      const newerAuthority = (observation) => Boolean(observation.reportDate && row.reportDate && (observation.reportDatePrecision === "week" ? observation.reportPeriodStart && observation.reportPeriodStart > row.reportDate : observation.reportDate >= row.reportDate));
      row.conflicts = differentFfs.filter((observation) => compatibleScope(observation.currentFfs.region, row.dates.ffsDate.region) && newerAuthority(observation)).map((observation) => ({ field: "ffsDate", value: observation.currentFfs.value, raw: observation.currentFfs.raw, source: observation.currentFfs.source, reason: "Different FFS in a current stage-gate table" }));
      row.ffsAuthorityNotes = differentFfs.filter((observation) => !compatibleScope(observation.currentFfs.region, row.dates.ffsDate.region) || !newerAuthority(observation)).map((observation) => ({ value: observation.currentFfs.value, raw: observation.currentFfs.raw, source: observation.currentFfs.source, reportDate: observation.reportDate, reportDateBasis: observation.reportDateBasis, reason: !compatibleScope(observation.currentFfs.region, row.dates.ffsDate.region) ? "Different manufacturing region retained as supporting evidence; primary Current FFS is used" : "Supporting reporting period does not establish a newer date; primary Current FFS is used" }));
      const gaObservations = row.observations.filter((observation) => observation.dates.generalAvailabilityDate);
      if (gaObservations.length === 1) row.dates.generalAvailabilityDate = { ...gaObservations[0].dates.generalAvailabilityDate, source: { ...gaObservations[0].dates.generalAvailabilityDate.source, supporting: true }, reason: "Explicit GA from an undated supporting sheet requires review" };
      const noteFfs = row.status.match(/FFS\s*\/?(?:CN|TH|VN)?\s*\((\d{1,2})\/(\d{1,2})\)/i);
      if (noteFfs && row.dates.ffsDate.value && row.dates.ffsDate.value.slice(5) !== `${String(noteFfs[1]).padStart(2, "0")}-${String(noteFfs[2]).padStart(2, "0")}`) row.conflicts.push({ field: "ffsDate", raw: noteFfs[0], source: { sheet: primary.name, cell: `Q${row.sourceRow}` }, reason: "FFS day in status notes differs from the structured current FFS" });
      if (row.dates.ffsDate.source.crossProduct) diagnostics.push({ severity: "warning", code: "MERGED_PRODUCT_DATE", ...row.dates.ffsDate.source, message: "FFS merged across product rows requires review" });
    }
    metadata.sourceRows = rows.length; metadata.supportingRows = supportingRows.length; metadata.healthIndicators = healthShapes.size;
    return { version, metadata, rows, supportingRows, diagnostics };
  }

  function stableId(value, prefix) {
    let hash = 2166136261;
    for (const character of value) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619) >>> 0; }
    return `${prefix}-${hash.toString(36)}`;
  }
  function prepareVariantAssignments(dataset, portfolio, options = {}) {
    const requests = options.variantAssignments || {};
    if (!requests || typeof requests !== "object" || Array.isArray(requests)) throw new Error("Colorway assignments need reviewed product and color details.");
    const requested = Object.entries(requests).filter(([, request]) => request);
    if (requested.length > 200) throw new Error("Review at most 200 colorway assignments in one collection.");
    if (!requested.length) return { portfolio, assignments: {}, variantChanges: [] };
    const prepared = clone(portfolio), assignments = {}, variantChanges = [];
    const text = (value, label, limit = 160) => {
      if (typeof value !== "string" || !clean(value) || clean(value).length > limit) throw new Error(`Confirm the ${label} before attaching a PLC colorway.`);
      return clean(value);
    };
    for (const [key, request] of requested) {
      if (options.skippedKeys?.includes(key)) continue;
      if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Confirm the product and its color option.");
      const rows = (dataset.rows || []).filter((row) => sourceKey(row) === key);
      if (rows.length !== 1) throw new Error("A color option must come from one unique PLC source record.");
      const row = rows[0], source = colorwayIdentity(row);
      if (!source.detected) throw new Error("This source has no explicit colorway identity. Keep its product-wide milestones separate.");
      if (row.cancelled) throw new Error("Cancelled PLC projects cannot attach color options.");
      const entry = identities(prepared).find((item) => item.productId === request.productId);
      if (!entry) throw new Error("Choose an existing parent product for this colorway.");
      const conflict = hardwareConflict(source.baseName, extractIdentity(entry.product.name).marketingName);
      if (conflict) throw new Error(`${conflict}. A colorway cannot change the hardware model.`);
      const product = entry.product;
      let variant = null, created = false;
      if (request.variantId) {
        variant = colorVariants(product).find((item) => item.id === request.variantId);
        if (!variant) throw new Error("The selected color option no longer exists on this product.");
        if (!sourceColorMatches(variant, source.color)) throw new Error("The source primary or secondary color differs from the selected color option. Choose the matching color.");
      } else if (request.create === true) {
        const code = colorCode(text(request.colorCode, "color code")), name = text(request.colorName, "color name"), hex = text(request.colorHex, "primary color");
        if (!/^#[a-f\d]{6}$/i.test(hex)) throw new Error("A color option needs a valid six-digit color value.");
        const name2 = clean(request.colorName2), hex2 = clean(request.colorHex2);
        if (name2.length > 160 || hex2 && !/^#[a-f\d]{6}$/i.test(hex2) || Boolean(name2) !== Boolean(hex2)) throw new Error("Confirm both the secondary color name and its six-digit color value.");
        if (source.color && code !== source.color.canonicalCode) throw new Error("The source color differs from the new color option. Keep its explicit color code.");
        const proposed = { code, colorName: name, colorHex: hex, colorName2: name2, colorHex2: hex2 };
        if (!sourceColorMatches(proposed, source.color)) throw new Error("The source primary or secondary color differs from the new color option.");
        const existing = colorVariants(product).filter((item) => colorCode(item.code) === code && colorIdentity(item) === colorIdentity(proposed));
        if (existing.length > 1) throw new Error("More than one color option uses this code. Choose the exact existing option.");
        if (existing.length === 1) variant = existing[0];
        else {
          product.variantGroups ||= [];
          let group = product.variantGroups.find((item) => item.type === "color");
          if (!group) { group = { id: stableId(product.id, "plc-colors"), type: "color", label: "COLOR SKU", items: [] }; product.variantGroups.push(group); }
          const id = stableId(`${product.id}|${code}|${colorIdentity(proposed)}`, "plc-color");
          if (product.variantGroups.some((item) => (item.items || []).some((value) => value.id === id))) throw new Error("This color option ID is already reserved. Choose the existing option.");
          variant = { id, code, label: name2 ? `${name} / ${name2}` : name, colorKey: source.color?.colorKey || "custom", colorName: name, colorHex: hex.toLowerCase(), colorKey2: name2 ? source.color?.colorKey2 || "custom" : "", colorName2: name2, colorHex2: hex2.toLowerCase(), groupId: group.id };
          const saved = { ...variant }; delete saved.groupId;
          group.items.push(saved); created = true;
        }
      } else throw new Error("Choose an existing color option or confirm a new color option.");
      assignments[key] = { productId: product.id, variantId: variant.id };
      const saved = { ...variant }; delete saved.groupId;
      variantChanges.push({ productId: product.id, variantId: variant.id, groupId: variant.groupId, created, variant: saved, sourceKey: key });
    }
    return { portfolio: prepared, assignments, variantChanges };
  }
  function prepareProductCreations(dataset, portfolio, options = {}) {
    const requests = options.createProducts || {};
    if (!requests || typeof requests !== "object" || Array.isArray(requests)) throw new Error("New PLC products need reviewed product details.");
    const requested = Object.entries(requests).filter(([, request]) => request);
    if (requested.length > 200) throw new Error("Review at most 200 new PLC products in one collection.");
    if (!requested.length) return { portfolio, selections: Object.create(null), createdProducts: [] };
    const prepared = clone(portfolio), selections = Object.create(null), createdProducts = [];
    const text = (value, label) => {
      if (typeof value !== "string" || !clean(value) || clean(value).length > 2048) throw new Error(`Confirm the ${label} before creating a PLC product.`);
      return clean(value);
    };
    for (const [key, request] of requested) {
      if (options.skippedKeys?.includes(key)) continue;
      if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Confirm the new PLC product name, codename and category.");
      const rows = (dataset.rows || []).filter((row) => sourceKey(row) === key);
      if (rows.length !== 1) throw new Error("A new product must come from one unique PLC source record. Resolve duplicate source records first.");
      const row = rows[0];
      if (row.cancelled) throw new Error("Cancelled PLC projects cannot create new portfolio products.");
      if (colorwayIdentity(row).detected && request.separateProduct !== true) throw new Error("Attach this colorway to its parent product, or explicitly confirm that it is different hardware before creating another product.");
      const name = text(request.name, "product name"), codename = text(request.codename, "codename"), categoryId = text(request.categoryId, "portfolio category");
      if (!normalizeCode(codename)) throw new Error("Confirm a codename containing letters or digits so future PLC imports can identify this product.");
      const category = (prepared.categories || []).find((entry) => entry.id === categoryId);
      if (!category || !Array.isArray(category.board?.products) || !Array.isArray(category.board?.lanes) || !category.board.lanes.length) throw new Error("Choose an existing portfolio category with a product lane.");
      const laneId = request.laneId ? text(request.laneId, "product lane") : category.board.lanes[0].id;
      if (!category.board.lanes.some((lane) => lane.id === laneId)) throw new Error("Choose a product lane in the confirmed portfolio category.");
      const sourceCode = row.codename || extractIdentity(row.name).codename;
      if (sourceCode && normalizeCode(sourceCode) !== normalizeCode(codename)) throw new Error("The confirmed codename must identify the selected PLC source project.");
      const all = identities(prepared);
      const remembered = all.filter((entry) => entry.product.plc?.identities?.some((identity) => identity.key === key));
      if (remembered.length === 1 && normalizeCode(remembered[0].product.codename) === normalizeCode(codename)) {
        selections[key] = remembered[0].productId;
        continue;
      }
      if (remembered.length || all.some((entry) => normalizeCode(entry.product.codename || entry.product.codeName || extractIdentity(entry.name).codename) === normalizeCode(codename))) throw new Error("This PLC codename already belongs to a portfolio product. Match the existing product instead of creating a duplicate.");
      if (all.some((entry) => entry.categoryId === categoryId && normalizeName(entry.name) === normalizeName(name))) throw new Error("This product name already exists in the selected category. Match that product or confirm a distinct product name.");
      const existingMatch = matchProduct(row, prepared, options);
      if (existingMatch.status === "matched") throw new Error("This PLC source already matches a portfolio product. Use its existing match instead of creating a duplicate.");
      let hash = 2166136261;
      for (const character of `${normalizeCode(codename)}|${key}`) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619) >>> 0; }
      const slug = normalizeCode(codename).replace(/\s+/g, "-").slice(0, 40) || "project";
      const productId = `plc-${slug}-${hash.toString(36)}`;
      if (all.some((entry) => entry.productId === productId) || portfolio.masterSync?.products?.[productId]?.deleted || portfolio.masterLocalRemovedProducts?.[productId]) throw new Error("The PLC product ID is already reserved. Resolve the existing or removed product before creating this source again.");
      const startMonth = localDay(options.now ? new Date(options.now) : new Date()).slice(0, 7);
      const end = new Date(`${startMonth}-01T00:00:00Z`); end.setUTCMonth(end.getUTCMonth() + 18);
      const product = { id: productId, name, codename, price: null, priceLabel: "", imageAssetId: "", tier: "", ...Object.fromEntries(Object.keys(fieldLabels).map((field) => [field, ""])), ascm: null, partSkus: [], laneId, order: category.board.products.filter((entry) => entry.laneId === laneId).length, statusType: "new", statusLabel: "NEW PRODUCT", variantLabel: "", variantColor: "#526564", highlightEnabled: false, highlightColor: "#526564", specs: [], featuredVariantId: "", variantGroups: [], roadmap: { family: "Other", startMonth, launchMonth: startMonth, endMonth: end.toISOString().slice(0, 7), status: "in-planning", confidence: "low", predecessorId: "", successorId: "" } };
      if (request.separateProduct === true) product.plc = { version, createdFromSource: { key, productId, separateProduct: true }, identities: [] };
      category.board.products.push(product);
      selections[key] = productId;
      createdProducts.push({ key, productId, name, codename, categoryId, laneId, ...(request.separateProduct === true ? { separateProduct: true } : {}) });
    }
    return { portfolio: prepared, selections, createdProducts };
  }

  function buildPlan(dataset, portfolio, options = {}) {
    const creations = prepareProductCreations(dataset, portfolio, options);
    const variants = prepareVariantAssignments(dataset, creations.portfolio, options);
    const matchingPortfolio = variants.portfolio;
    const matchingOptions = { ...options, selections: { ...options.selections, ...creations.selections }, variantAssignments: { ...options.variantAssignments, ...variants.assignments } };
    // Identical bytes retain their original collection date on every re-drop.
    const knownRun = !options.review && (portfolio.plcImports || []).find((run) => run.type !== "review" && run.fingerprint === dataset.metadata?.fingerprint);
    const proposedReportDate = knownRun?.reportDate || options.reportDate || dataset.metadata?.reportDate || localDay(options.now ? new Date(options.now) : new Date());
    const reportParsed = parseDate(proposedReportDate);
    if (reportParsed.kind !== "exact") throw new Error("The report date must be an exact calendar date.");
    const reportDate = reportParsed.value;
    const products = new Map(identities(matchingPortfolio).map((entry) => [entry.productId, entry.product]));
    const items = dataset.rows.map((row) => {
      const key = sourceKey(row), match = matchProduct(row, matchingPortfolio, matchingOptions), parent = products.get(match.productId);
      const sourceColorway = colorwayIdentity(row), separate = parent?.plc?.createdFromSource?.key === key && parent.plc.createdFromSource.separateProduct;
      const colorway = separate ? { ...sourceColorway, detected: false, reason: "Reviewed separate hardware product" } : sourceColorway;
      const assignment = variants.assignments[key], remembered = parent && rememberedVariant(parent, key);
      const chosenId = colorway.detected ? assignment?.variantId || remembered || "" : "";
      const chosen = chosenId && !hardwareConflict(colorway.baseName, extractIdentity(parent.name).marketingName) && colorVariants(parent).find((variant) => variant.id === chosenId && sourceColorMatches(variant, colorway.color));
      const variantTarget = chosen ? { productId: parent.id, variantId: chosen.id, groupId: chosen.groupId, name: variantName(chosen), create: Boolean(variants.variantChanges.find((entry) => entry.sourceKey === key)?.created) } : null;
      const variantBindingNeeded = colorway.detected && !variantTarget;
      const product = variantBindingNeeded && parent ? { ...parent, ...Object.fromEntries(Object.keys(fieldLabels).map((field) => [field, ""])), plc: {} } : variantProduct(parent, variantTarget?.variantId);
      const sourceSkus = (row.skus || row.partNumbers || []).map((value) => clean(value).toUpperCase());
      const variantCandidates = colorVariants(parent).map((variant) => {
        const exactSku = sourceSkus.some((code) => clean(variant.code).toUpperCase() === code || (parent.partSkus || []).some((part) => clean(part.code).toUpperCase() === code && part.variantId === variant.id));
        return { variantId: variant.id, name: variantName(variant), colorCode: variant.code, reason: exactSku ? "Exact supplied HP SKU" : colorway.color && sourceColorMatches(variant, colorway.color) ? "Exact source color" : "Existing color option", suggested: exactSku || Boolean(colorway.color && sourceColorMatches(variant, colorway.color)) };
      }).sort((a, b) => Number(b.suggested) - Number(a.suggested) || a.name.localeCompare(b.name));
      const metadata = row._plcMetadata || dataset.metadata || {};
      // The operator's import date controls collection freshness. Explicit
      // workbook periods still control field ordering, including older sections.
      const sourceDate = options.review ? row.reportDate || metadata.reportDate || reportDate : options.reportDateBasis === "Import date" ? row.reportDate || metadata.reportDate || reportDate : row.reportDate && row.reportDate !== dataset.metadata?.reportDate ? row.reportDate : reportDate;
      const fields = Object.entries(row.dates || {}).filter(([field]) => fieldLabels[field]).map(([field, supplied]) => {
        const suppliedDate = typeof supplied === "object" && supplied ? supplied : parseDate(supplied, { quarterBasis: "calendar" });
        // Older saved review rows can classify a now-supported, single quarter
        // as a range. Reinterpret only that explicit raw quarter and retain all
        // original source guards; previewing never rewrites saved evidence.
        const refreshedQuarter = !suppliedDate.value && !suppliedDate.period && ["quarter", "range"].includes(suppliedDate.kind) && suppliedDate.raw ? parseDate(suppliedDate.raw, { quarterBasis: "calendar" }) : null;
        const parsed = refreshedQuarter?.kind === "quarter" && normalizePeriod(refreshedQuarter.period, refreshedQuarter.value) ? { ...suppliedDate, ...refreshedQuarter, source: suppliedDate.source } : suppliedDate;
        const current = clean(product?.[field]), incoming = parsed.value || "", previous = product?.plc?.fields?.[field];
        const period = normalizePeriod(parsed.period, incoming), oldPeriod = currentPeriod(product, field), usable = parsed.kind === "exact" || Boolean(period);
        let status = parsed.kind === "blank" ? "blank" : usable ? current === incoming && JSON.stringify(period) === JSON.stringify(oldPeriod) ? "unchanged" : "update" : "review", reason = parsed.reason || "";
        if (variantBindingNeeded && status !== "blank") { status = "review"; reason = "Select the product's color option before updating its milestones"; }
        if (row.cancelled) { status = "review"; reason = "Cancelled project; current dates stay unchanged"; }
        else if ((row.supporting || parsed.source?.supporting) && !(previous?.reviewed && !previous.supersededAt && usable && previous.value === incoming && current === incoming && JSON.stringify(period) === JSON.stringify(oldPeriod) && previous.raw === parsed.raw && previous.source?.sheet === parsed.source?.sheet)) { status = "review"; reason = "Supporting sheet is not a current dated authority"; }
        else if (parsed.source?.currentFfsFromOtherColumn) { status = "review"; reason = "Current FFS inherits another column; verify the source date"; }
        else if (parsed.source?.formula) { status = "review"; reason = "Cached formula dates require review; formulas are not evaluated"; }
        else if (parsed.source?.crossProduct) { status = "review"; reason = "Date merged across distinct product rows"; }
        else if (usable && previous?.scope && !sameScope(previous.scope, parsed.region) && (parsed.region || current !== incoming)) { status = "review"; reason = `FFS manufacturing scope changed from ${previous.scope} to ${parsed.region || "unspecified"}; verify the incoming date`; }
        else if (usable && parsed.region && !previous?.scope && !parsed.source?.authoritativeCurrentFfs && current !== incoming) { status = "review"; reason = `Regional ${parsed.region} date: choose which date represents PPC FFS`; }
        if (period && current && !oldPeriod && status === "update") { status = "review"; reason = "PPC has an exact day; confirm before replacing it with quarter precision"; }
        if (row.conflicts?.some((conflict) => conflict.field === field)) { status = "review"; reason = row.conflicts.filter((conflict) => conflict.field === field).map((conflict) => conflict.reason).join(". "); }
        if (previous?.reportDate && sourceDate < previous.reportDate) { status = "stale"; reason = "An older source cannot replace a newer accepted observation"; }
        else if (previous && sourceDate === previous.reportDate && incoming && (incoming !== previous.value || JSON.stringify(period) !== JSON.stringify(oldPeriod))) { status = "review"; reason = "Different value or date precision for the same report date"; }
        else if (previous?.value && (current !== previous.value || previous.supersededAt) && current !== incoming && status === "update") { status = "review"; reason = "PPC date was edited after the previous PLC import"; }
        if (!variantTarget && !previous && product && status === "update") {
          const accepted = root.PortfolioMasterModel?.dateEditsForProduct?.(portfolio, product.id)?.[field];
          if (accepted?.at && accepted.at.slice(0, 10) >= sourceDate) { status = "review"; reason = "The master has an accepted date change on or after this source report"; }
        }
        const localEdit = !variantTarget && portfolio.dateLocalEdits?.[product?.id]?.[field];
        const localEditTime = localEdit?.at ? new Date(localEdit.at) : null;
        if (status === "update" && localEdit?.source !== "plc" && clean(localEdit?.value) === current && localEditTime && Number.isFinite(localEditTime.getTime()) && localDay(localEditTime) >= sourceDate) {
          status = "review"; reason = "PPC has a local date edit on or after this source report; verify the incoming date";
        }
        const ga = field === "generalAvailabilityDate" ? incoming : product?.generalAvailabilityDate, em = field === "endManufacturingDate" ? incoming : product?.endManufacturingDate;
        if (ga && em && em < ga && status === "update") { status = "review"; reason = "GA would fall after end of manufacturing"; }
        return { field, label: fieldLabels[field], current, incoming, currentPeriod: oldPeriod, period, displayCurrent: dateLabel(current, oldPeriod), displayIncoming: dateLabel(incoming, period), raw: parsed.raw || "", region: parsed.region || "", kind: parsed.kind, status, reason, source: parsed.source || row.sources?.[0] || {}, reportDate: sourceDate, ...(parsed.revision ? { revision: clone(parsed.revision) } : {}), ...(parsed.candidates ? { candidates: clone(parsed.candidates) } : {}) };
      });
      const gaProposal = fields.find((field) => field.field === "generalAvailabilityDate" && field.status === "update");
      const emProposal = fields.find((field) => field.field === "endManufacturingDate" && field.status === "update");
      const plannedGa = gaProposal?.incoming || product?.generalAvailabilityDate, plannedEm = emProposal?.incoming || product?.endManufacturingDate;
      if (plannedGa && plannedEm && plannedEm < plannedGa) for (const field of [gaProposal, emProposal].filter(Boolean)) { field.status = "review"; field.reason = "The proposed GA and end of manufacturing dates conflict"; }
      let action = match.status !== "matched" ? match.status === "unmatched" ? "unmatched" : "review" : fields.some((field) => field.status === "review") ? "review" : fields.some((field) => field.status === "update") ? "update" : fields.every((field) => field.status === "stale") ? "stale" : "unchanged";
      if (variantBindingNeeded && match.status === "matched") action = "review";
      return { key, row, metadata, reportDate: sourceDate, match, matchedProductId: match.productId || "", matchedVariantId: variantTarget?.variantId || "", variantTarget, variantBindingNeeded, variantCandidates, colorway, fields, action };
    });
    const byProduct = new Map(); for (const item of items.filter((item) => item.matchedProductId && !item.variantBindingNeeded)) { const scope = `${item.matchedProductId}/${item.matchedVariantId || "base"}`, list = byProduct.get(scope) || []; list.push(item); byProduct.set(scope, list); }
    for (const list of byProduct.values()) if (list.length > 1) for (const item of list) {
      item.action = "review";
      for (const field of item.fields) if (["update", "unchanged"].includes(field.status)) { field.status = "review"; field.reason = "Multiple source products or variants map to one PPC product"; }
    }
    const summary = { total: items.length, matched: items.filter((i) => i.match.status === "matched").length, update: items.filter((i) => i.action === "update").length, review: items.filter((i) => i.action === "review").length, unmatched: items.filter((i) => i.action === "unmatched").length, stale: items.filter((i) => i.action === "stale").length, unchanged: items.filter((i) => i.action === "unchanged").length, fields: summarizeFields(items) };
    summary.created = creations.createdProducts.length;
    summary.colorwaysCreated = variants.variantChanges.filter((entry) => entry.created).length;
    return { version, dataset, reportDate, reportDateBasis: knownRun?.reportDateBasis || options.reportDateBasis || (dataset.metadata?.reportDate ? reportDate !== dataset.metadata.reportDate ? "User supplied report date" : dataset.metadata.reportDateBasis : "Import date fallback"), items, summary, options: { ...options, reportDate }, createdProducts: clone(creations.createdProducts), variantChanges: clone(variants.variantChanges), baseline: [...products].map(([productId, p]) => ({ productId, fields: Object.fromEntries(Object.keys(fieldLabels).map((field) => [field, clean(p[field])])), plc: clone(p.plc || null) })) };
  }
  function summarizeFields(items) {
    const fields = {};
    for (const item of items) for (const field of item.fields) {
      const stats = fields[field.field] ||= { source: 0, exact: 0, quarter: 0, eligible: 0, updated: 0, unchanged: 0, review: 0, unmatched: 0, blank: 0, stale: 0, preserved: 0, skipped: 0, blockedReasons: [] };
      stats.source++;
      if (field.kind === "exact") stats.exact++;
      if (field.period) stats.quarter++;
      const outcome = item.row.cancelled ? "preserved" : item.match.status !== "matched" ? "unmatched" : field.status === "update" ? "eligible" : field.status;
      if (Object.hasOwn(stats, outcome)) stats[outcome]++;
      if (["review", "unmatched", "stale"].includes(outcome)) {
        const reason = clean(outcome === "unmatched" ? item.match.reason : field.reason).slice(0, 240) || "Verify this source date";
        const existing = stats.blockedReasons.find((entry) => entry.reason === reason);
        if (existing) existing.count++;
        else if (stats.blockedReasons.length < 12) stats.blockedReasons.push({ reason, count: 1 });
        else {
          const other = stats.blockedReasons.find((entry) => entry.reason === "Other review reasons");
          if (other) other.count++;
          else { const last = stats.blockedReasons.pop(); stats.blockedReasons.push({ reason: "Other review reasons", count: last.count + 1 }); }
        }
      }
    }
    return fields;
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
      const product = variantProduct(products.get(item.matchedProductId), item.matchedVariantId), matchNeeded = item.match.status !== "matched" || item.variantBindingNeeded;
      const fields = item.fields.filter((field) => !options.skippedFields?.[item.key]?.includes(field.field) && !options.resolutions?.[item.key]?.[field.field] && (field.status === "review" || options.deferredFields?.[item.key]?.includes(field.field))
        && !(product?.plc?.fields?.[field.field]?.reviewed && product.plc.fields[field.field].fingerprint === item.metadata.fingerprint && product.plc.fields[field.field].raw === field.raw)).map((field) => field.field);
      if (!matchNeeded && !fields.length) continue;
      const row = clone(item.row); delete row._plcMetadata;
      // Current raw data, conflicts and all date sources are sufficient to resolve
      // an exception. Supporting tables remain in collected product evidence.
      delete row.observations;
      entries.push({ key: item.key, row, metadata: { fileName: item.metadata.fileName, fingerprint: item.metadata.fingerprint, reportDate: item.reportDate, reportDateBasis: !effective.options.review && item.reportDate === effective.reportDate ? effective.reportDateBasis : item.metadata.reportDateBasis || effective.reportDateBasis }, reportDate: item.reportDate, fields, matchNeeded, variantBindingNeeded: item.variantBindingNeeded, variantId: item.matchedVariantId, createdAt: earlier?.createdAt || now, observedAt: earlier?.metadata.fingerprint === item.metadata.fingerprint ? earlier.observedAt : now });
    }
    if (entries.length > 2000 || JSON.stringify(entries).length > 1500000) throw new Error("The saved review queue is full. Resolve or export older exceptions before importing more files.");
    next.plcReview = { version, entries };
    return entries.length;
  }
  function applyPlan(portfolio, plan, options = {}) {
    const now = new Date(options.now || new Date()).toISOString();
    const combinedOptions = { ...plan.options, ...options, now, selections: { ...plan.options?.selections, ...options.selections }, createProducts: { ...plan.options?.createProducts, ...options.createProducts }, variantAssignments: { ...plan.options?.variantAssignments, ...options.variantAssignments } };
    const creations = prepareProductCreations(plan.dataset, portfolio, combinedOptions);
    const variants = prepareVariantAssignments(plan.dataset, creations.portfolio, combinedOptions);
    const next = variants.portfolio === portfolio ? clone(portfolio) : variants.portfolio;
    const variantChanges = variants.variantChanges.map((record) => ({ ...record, at: now }));
    const createdProducts = creations.createdProducts.map((record) => ({ ...record, at: now }));
    const result = { imported: 0, datesUpdated: 0, unchanged: 0, skipped: 0, review: 0, duplicate: false, created: createdProducts.length, colorwaysCreated: variantChanges.filter((entry) => entry.created).length };
    const effective = buildPlan(plan.dataset, next, { ...combinedOptions, createProducts: {}, variantAssignments: variants.assignments, selections: { ...combinedOptions.selections, ...creations.selections } });
    result.fields = clone(effective.summary.fields);
    const products = new Map(identities(next).map((entry) => [entry.productId, entry.product]));
    const originalProducts = new Map(identities(next).map((entry) => [entry.productId, clone(entry.product)]));
    const baselines = new Map((plan.baseline || []).map((entry) => [entry.productId, entry]));
    const history = [], proposals = new Map();
    const clearBlockedCount = (item, field, outcome = "review") => {
      const stats = result.fields[field.field];
      stats[outcome] = Math.max(0, stats[outcome] - 1);
      const text = clean(outcome === "unmatched" ? item.match.reason : field.reason).slice(0, 240);
      const reason = stats.blockedReasons.find((entry) => entry.reason === text);
      if (reason) reason.count = Math.max(0, reason.count - 1);
      stats.blockedReasons = stats.blockedReasons.filter((entry) => entry.count > 0);
    };
    // Validate every resolution before constructing mutations. Older reports cannot be forced through review.
    for (const item of effective.items) {
      if (options.skippedKeys?.includes(item.key)) {
        for (const field of item.fields) {
          result.fields[field.field].skipped++;
          if (item.match.status !== "matched") clearBlockedCount(item, field, "unmatched"); else if (field.status === "review") clearBlockedCount(item, field);
        }
        result.skipped++; continue;
      }
      if (item.match.status !== "matched" || item.variantBindingNeeded) {
        if (item.variantBindingNeeded && Object.keys(options.resolutions?.[item.key] || {}).length) throw new Error("Select the product's color option before applying colorway dates.");
        result.skipped++; continue;
      }
      const parent = products.get(item.matchedProductId), originalParent = originalProducts.get(item.matchedProductId), baseline = baselines.get(item.matchedProductId);
      if (baseline && (JSON.stringify(baseline.plc) !== JSON.stringify(originalParent.plc || null) || Object.keys(fieldLabels).some((field) => baseline.fields[field] !== clean(originalParent[field])))) throw new Error("PPC changed since the preview. Reload the preview before applying PLC updates.");
      const product = variantProduct(parent, item.matchedVariantId), original = variantProduct(originalParent, item.matchedVariantId);
      const previous = product.plc || {};
      const metadata = item.metadata;
      const olderObservation = previous.reportDate && item.reportDate < previous.reportDate;
      const patch = {}, fieldEvidence = { ...(previous.fields || {}) }, historyStart = history.length;
      for (const field of item.fields) {
        const skipped = options.skippedFields?.[item.key]?.includes(field.field), deferred = options.deferredFields?.[item.key]?.includes(field.field), resolution = options.resolutions?.[item.key]?.[field.field];
        if (resolution && field.status === "stale") throw new Error("Older reports cannot overwrite newer dates.");
        const resolutionValue = typeof resolution === "object" ? resolution.value : resolution;
        const selectedPeriod = resolution && typeof resolution === "object" ? normalizePeriod(resolution.period, resolutionValue) : resolution ? null : field.period;
        if (resolution && (parseDate(resolutionValue).kind !== "exact" || typeof resolution === "object" && resolution.period && !selectedPeriod)) throw new Error("Reviewed dates must use a valid calendar day or a validated calendar quarter.");
        let incoming = resolutionValue || field.incoming;
        const allowed = !skipped && !deferred && !item.row.cancelled && (resolution || field.status === "update" || field.status === "unchanged");
        if (!allowed || !incoming || field.status === "stale") {
          if (skipped) result.fields[field.field].skipped++;
          if (field.status === "review" && skipped) clearBlockedCount(item, field); else if (field.status === "review" && !item.row.cancelled) result.review++;
          continue;
        }
        const proposal = JSON.stringify({ value: incoming, period: selectedPeriod });
        const proposalKey = `${product.id}/${item.matchedVariantId || "base"}/${field.field}`;
        if (proposals.has(proposalKey) && proposals.get(proposalKey) !== proposal) throw new Error("Two source rows propose different dates for one PPC product or color option. Keep one source date and apply again.");
        proposals.set(proposalKey, proposal);
        const oldEvidence = fieldEvidence[field.field];
        const fieldStats = result.fields[field.field];
        const oldPeriod = currentPeriod(product, field.field), semanticChange = product[field.field] !== incoming || JSON.stringify(oldPeriod) !== JSON.stringify(selectedPeriod);
        if (semanticChange) { patch[field.field] = incoming; result.datesUpdated++; fieldStats.updated++; history.push({ at: now, productId: product.id, ...(item.matchedVariantId ? { variantId: item.matchedVariantId, variantName: item.variantTarget.name } : {}), field: field.field, before: clean(product[field.field]), after: incoming, beforePeriod: oldPeriod, afterPeriod: selectedPeriod, reportDate: field.reportDate, sourceFile: metadata.fileName, fingerprint: metadata.fingerprint, source: field.source, raw: field.raw, reviewed: Boolean(resolution) }); }
        else if (field.status !== "unchanged") fieldStats.unchanged++;
        if (resolution && field.status === "review") {
          clearBlockedCount(item, field);
        }
        const localChange = !item.matchedVariantId && next.dateLocalEdits?.[product.id]?.[field.field];
        const selectedCandidates = resolution ? (field.candidates || []).filter((candidate) => candidate.kind === "exact" && candidate.value === incoming) : [];
        const selectedScope = selectedCandidates.length ? [...new Set(selectedCandidates.map((candidate) => candidate.region).filter(Boolean))].join(", ") : (resolution || field.source?.authoritativeCurrentFfs) && incoming === field.incoming && field.region ? field.region : oldEvidence?.scope || "";
        fieldEvidence[field.field] = { value: incoming, ...(selectedPeriod ? { period: clone(selectedPeriod) } : {}), reportDate: field.reportDate, sourceFile: metadata.fileName, fingerprint: metadata.fingerprint, changedAt: semanticChange ? now : localChange?.value === incoming && localChange.at > (oldEvidence?.changedAt || "") ? localChange.at : oldEvidence?.changedAt || "", observedAt: !semanticChange && !oldEvidence?.supersededAt && oldEvidence?.fingerprint === metadata.fingerprint && oldEvidence.value === incoming ? oldEvidence.observedAt : now, raw: field.raw, source: field.source, scope: selectedScope, reviewed: Boolean(resolution) || oldEvidence?.reviewed && oldEvidence.raw === field.raw && oldEvidence.value === incoming && !semanticChange || false, ...(field.revision ? { revision: clone(field.revision) } : {}), ...(field.candidates ? { candidates: clone(field.candidates) } : {}), ...(selectedCandidates.length ? { selectedCandidates: clone(selectedCandidates) } : {}) };
      }
      const ga = patch.generalAvailabilityDate || product.generalAvailabilityDate, em = patch.endManufacturingDate || product.endManufacturingDate;
      if ((Object.hasOwn(patch, "generalAvailabilityDate") || Object.hasOwn(patch, "endManufacturingDate")) && ga && em && em < ga) throw new Error("A selected date places GA after end of manufacturing. Correct the review dates first.");
      const reviewedBinding = item.matchedVariantId && variantChanges.find((record) => record.sourceKey === item.key);
      const approvedColorway = item.matchedVariantId ? reviewedBinding || !previous.colorway ? colorwaySnapshot(colorVariants(parent).find((variant) => variant.id === item.matchedVariantId)) : clone(previous.colorway) : null;
      const already = previous.fingerprint === metadata.fingerprint && (previous.rows || []).some((row) => row.key === item.key) && !Object.keys(patch).length && !Object.keys(options.resolutions?.[item.key] || {}).length && JSON.stringify(fieldEvidence) === JSON.stringify(previous.fields || {}) && (!item.matchedVariantId || JSON.stringify(approvedColorway) === JSON.stringify(previous.colorway));
      if (already) { result.unchanged++; continue; }
      const merged = item.matchedVariantId ? { ...product, ...patch } : root.PortfolioModel?.mergeProductUpdate ? root.PortfolioModel.mergeProductUpdate(product, patch) : { ...product, ...patch };
      const rowRecord = { ...clone(item.row), importedAt: now, reportDate: item.reportDate, fingerprint: metadata.fingerprint }; delete rowRecord._plcMetadata;
      if (item.matchedVariantId) delete rowRecord.observations;
      const currentRows = previous.fingerprint === metadata.fingerprint ? previous.rows || [] : [];
      merged.plc = { version, sourceFile: olderObservation ? previous.sourceFile : metadata.fileName, fingerprint: olderObservation ? previous.fingerprint : metadata.fingerprint, reportDate: olderObservation ? previous.reportDate : item.reportDate, reportDateBasis: olderObservation ? previous.reportDateBasis : effective.options.review || item.reportDate !== effective.reportDate ? item.row.reportDateBasis || metadata.reportDateBasis : effective.reportDateBasis, importedAt: olderObservation ? previous.importedAt : now, changedAt: Object.keys(patch).length ? now : previous.changedAt || "", fields: fieldEvidence, rows: olderObservation ? previous.rows || [] : [...currentRows.filter((row) => row.key !== item.key), rowRecord], identities: [...(previous.identities || []).filter((identity) => identity.key !== item.key), { key: item.key, name: item.row.name, codename: item.row.codename || "", confirmed: item.match.reason === "Selected product" }].slice(-200), history: [...(previous.history || []), ...history.slice(historyStart)].slice(-100) };
      if (previous.createdFromSource) merged.plc.createdFromSource = clone(previous.createdFromSource);
      if (item.matchedVariantId) {
        const originalPlc = parent.plc || { version }, variantId = item.matchedVariantId;
        merged.plc.variantId = variantId; merged.plc.variantName = item.variantTarget.name; merged.plc.codename = item.row.codename || ""; merged.plc.colorway = approvedColorway;
        merged.plc.history = merged.plc.history.slice(-50);
        const addition = variantChanges.find((record) => record.sourceKey === item.key && record.created);
        if (addition) merged.plc.createdFromSource = { key: item.key, productId: parent.id, variantId, groupId: addition.groupId, at: now, sourceFile: metadata.fileName, fingerprint: metadata.fingerprint };
        parent.plc = { ...originalPlc, variantProjects: { ...(originalPlc.variantProjects || {}), [variantId]: merged.plc }, identities: [...(originalPlc.identities || []).filter((identity) => identity.key !== item.key), { key: item.key, name: item.row.name, codename: item.row.codename || "", confirmed: true, variantId }].slice(-200), history: [...(originalPlc.history || []), ...history.slice(historyStart)].slice(-100) };
      } else {
        if (previous.variantProjects) merged.plc.variantProjects = clone(previous.variantProjects);
        Object.assign(parent, merged);
      }
      result.imported++;
    }
    for (const record of createdProducts) {
      const item = effective.items.find((entry) => entry.key === record.key);
      record.sourceFile = item?.metadata.fileName || effective.dataset.metadata.fileName;
      record.fingerprint = item?.metadata.fingerprint || effective.dataset.metadata.fingerprint;
      products.get(record.productId).plc.createdFromSource = clone(record);
    }
    result.pendingReview = updateReviewQueue(next, effective, options, now);
    // Receipts count exceptions that still exist after selections, verified
    // dates and explicit keep-current decisions have been applied.
    const pending = new Map(next.plcReview.entries.map((entry) => [entry.key, entry]));
    for (const [field, stats] of Object.entries(result.fields)) {
      const remaining = effective.items.filter((item) => !item.row.cancelled && pending.has(item.key) && item.fields.some((entry) => entry.field === field));
      stats.unmatched = remaining.filter((item) => pending.get(item.key).matchNeeded).length;
      stats.review = remaining.filter((item) => !pending.get(item.key).matchNeeded && pending.get(item.key).fields.includes(field)).length;
      const blocked = summarizeFields(remaining.map((item) => ({ ...item, fields: item.fields.filter((entry) => entry.field === field && (pending.get(item.key).matchNeeded || pending.get(item.key).fields.includes(field))) })))[field]?.blockedReasons || [];
      stats.blockedReasons = blocked;
    }
    const previousCollection = next.plcCollection;
    const olderCollection = previousCollection?.metadata?.reportDate && effective.dataset.metadata.reportDate && effective.dataset.metadata.reportDate < previousCollection.metadata.reportDate;
    if (!effective.options.review && !olderCollection && previousCollection?.metadata?.fingerprint !== effective.dataset.metadata.fingerprint) {
      // Retain the current typed source snapshot, including supporting projects
      // that do not yet have a PPC match. Do not duplicate attached observations.
      const primaryRows = effective.dataset.rows.map((row) => Object.fromEntries(Object.entries(clone(row)).filter(([key]) => !["observations", "_plcMetadata"].includes(key))));
      next.plcCollection = { version, importedAt: now, metadata: clone(effective.dataset.metadata), primaryRows, supportingRows: clone(effective.dataset.supportingRows || []) };
      if (JSON.stringify(next.plcCollection).length > 3000000) throw new Error("The collected source evidence is too large for this workspace. The previous collection remains intact.");
    }
    const run = { at: now, type: plan.review || effective.options.review ? "review" : "import", reportDate: effective.reportDate, reportDateBasis: effective.reportDateBasis, sourceFile: effective.dataset.metadata.fileName, fingerprint: effective.dataset.metadata.fingerprint, metadata: clone(effective.dataset.metadata), summary: result, createdProducts: clone(createdProducts), variantChanges: clone(variantChanges), diagnostics: effective.dataset.diagnostics || [], rows: effective.items.map((item) => ({ key: item.key, name: item.row.name, productId: item.matchedProductId, ...(item.matchedVariantId ? { variantId: item.matchedVariantId, variantName: item.variantTarget.name } : {}), action: item.action, observation: Object.fromEntries(Object.entries(clone(item.row)).filter(([key]) => !["observations", "_plcMetadata"].includes(key))), fields: item.fields.map((field) => ({ field: field.field, status: field.status, raw: field.raw, reason: field.reason, source: field.source })) })) };
    if (!result.created && !result.imported && !history.length && !variantChanges.some((entry) => entry.created) && (next.plcImports || []).some((entry) => entry.fingerprint === run.fingerprint) && JSON.stringify(next.plcReview) === JSON.stringify(portfolio.plcReview) && JSON.stringify(next.plcCollection) === JSON.stringify(portfolio.plcCollection)) { result.duplicate = true; return { portfolio: clone(portfolio), summary: result, history: [], createdProducts: [], variantChanges }; }
    next.plcImports = [...(next.plcImports || []), run].slice(-52);
    while (next.plcImports.length > 1 && JSON.stringify(next.plcImports).length > 1500000) next.plcImports.shift();
    return { portfolio: next, summary: result, history, createdProducts, variantChanges };
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
    return Object.fromEntries(identities(portfolio).map(({ productId, product }) => {
      const values = Object.fromEntries(Object.keys(fieldLabels).map((field) => [field, clean(product[field])]));
      const periods = Object.fromEntries(Object.keys(fieldLabels).map((field) => [field, currentPeriod(product, field)]).filter(([, period]) => period));
      if (Object.keys(periods).length) values._periods = periods;
      return [productId, values];
    }));
  }
  // Call only for actual local mutations, never to reconstruct missing history.
  function recordDateChanges(before, portfolio, { now = new Date(), source = "local" } = {}) {
    const at = new Date(now).toISOString();
    for (const { productId, product } of identities(portfolio)) for (const field of Object.keys(fieldLabels)) {
      const value = clean(product[field]), previous = before?.[productId]?.[field] || "";
      const period = currentPeriod(product, field), previousPeriod = before?.[productId]?._periods?.[field] || null;
      if (value === previous && JSON.stringify(period) === JSON.stringify(previousPeriod)) continue;
      portfolio.dateLocalEdits ||= {};
      portfolio.dateLocalEdits[productId] ||= {};
      portfolio.dateLocalEdits[productId][field] = { at, value, source };
      const evidence = product.plc?.fields?.[field];
      if (source !== "plc" && evidence && !(evidence.sourceType === "local" && evidence.value === value && evidence.changedAt && !evidence.supersededAt)) evidence.supersededAt = at;
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
    const period = currentPeriod(product, field);
    return { value, period, displayValue: dateLabel(value, period), populated: Boolean(value), changedAt, changeAgeDays: clocks.changeAgeDays, observedAt, observedAgeDays: clocks.importAgeDays, acceptedAt, acceptedAgeDays: freshness({ changedAt: acceptedAt }, today).changeAgeDays, sourceReportDate: evidence?.reportDate || "", sourceAgeDays: clocks.ageDays, sourceFile: evidence?.sourceFile || "", source: evidence?.source || null };
  }
  function getVariantFieldAge(product, variantId, field, today = localDay()) { return getFieldAge(variantProduct(product, variantId), field, today); }
  root.PLCImporter = Object.freeze({ version, fieldLabels, parseDate, dateLabel, normalizePeriod, normalizeName, matchProduct, colorwayIdentity, parseWorkbook, buildPlan, buildReviewPlan, applyPlan, freshness, localDay, snapshotDateValues, recordDateChanges, getFieldAge, getVariantProject, getVariantFieldAge });
})(globalThis);
