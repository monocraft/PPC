/* Local, inert planning intake. Parsing and review never change the portfolio. */
(function (root) {
  "use strict";
  const VERSION = 1, MAX_BYTES = 25 * 1024 * 1024, MAX_ROWS = 5000, MAX_CELLS = 250000;
  const DATES = Object.freeze({ ffsDate: "FFS", generalAvailabilityDate: "General availability", endManufacturingDate: "End of manufacturing", globalAnnouncementDate: "Global announcement", webReadinessDate: "Web readiness", finalAssetsDate: "Final assets" });
  const FIELDS = Object.freeze(["name", "codename", ...Object.keys(DATES)]);
  const clean = value => String(value ?? "").replace(/\u00a0/g, " ").trim();
  const normalize = value => clean(value).toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, " ").trim();
  const clone = value => JSON.parse(JSON.stringify(value));
  const baseline = portfolio => JSON.stringify(portfolio);
  const hash = value => { let a = 2166136261, b = 2246822507; for (const char of String(value)) { a = Math.imul(a ^ char.charCodeAt(0), 16777619); b = Math.imul(b ^ char.charCodeAt(0), 3266489909); } return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`; };
  function protection(categoryId, productId, field) { try { return root.PortfolioFieldProtection?.check?.({ categoryId, productId, variantId: "", field }) || { protected: false, unavailable: false }; } catch (_) { return { protected: false, unavailable: true, reason: "Field protection could not be read." }; } }
  const aliases = {
    sourceId: ["extract id", "project id", "planning id", "source id", "id"],
    name: ["working name provisional", "working name", "product name", "marketing name", "product", "name", "description"],
    codename: ["codename provisional", "codename prepared", "codename raw", "codename", "code name"],
    category: ["category source", "category raw", "category", "product category"],
    sku: ["sku", "base pn", "base part number", "part number", "hp sku"],
    ffsDate: ["confirmed working ffs estimate", "ffs date", "ffs date typed estimate", "plc ffs date typed estimate", "ffs", "current ffs", "target ffs raw", "plc target ffs raw"],
    generalAvailabilityDate: ["general availability", "general availability date", "ga date", "ga", "launch date"],
    endManufacturingDate: ["end of manufacturing", "end manufacturing date", "em date", "em"],
    globalAnnouncementDate: ["global announcement", "global announcement date", "announcement date"],
    webReadinessDate: ["web readiness", "web readiness date"], finalAssetsDate: ["final assets", "final assets date"],
    proposedFfs: ["proposed ffs quarter unaccepted", "proposed ffs quarter", "hashout launch quarter source", "hashout launch quarter", "launch quarter"],
    sourcePrecision: ["source date precision"], periodStart: ["ffs interval start estimate", "interpreted period start"], periodEnd: ["ffs interval end estimate", "interpreted period end"],
    interpretation: ["ffs interpretation status", "interpretation alternatives", "date form"],
    sourceReference: ["source row", "hashout source row", "plc source row"]
  };
  function safeXml(xml) { if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Workbook XML entities are unsupported."); return xml; }
  function attrs(text) { const result = {}; for (const match of text.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) { if (["__proto__", "constructor", "prototype"].includes(match[1])) throw new Error("Invalid workbook attribute."); result[match[1]] = root.ASCMImporter.helpers.decodeXml(match[2] ?? match[3]); } return result; }
  function csvRows(text) {
    if (text.length > MAX_BYTES) throw new Error("Choose a CSV of at most 25 MiB.");
    const delimiter = text.split(/\r?\n/, 1)[0].includes("\t") ? "\t" : ",";
    const rows = []; let row = [], cell = "", quoted = false, afterQuote = false, cells = 0;
    const put = () => { if (cell.length > 32768 || ++cells > MAX_CELLS) throw new Error("Planning file exceeds cell limits."); row.push(cell); cell = ""; afterQuote = false; };
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) { if (char === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; afterQuote = true; } } else cell += char; continue; }
      if (char === '"' && cell === "" && !afterQuote) { quoted = true; continue; }
      if (char === delimiter) { put(); continue; }
      if (char === "\r" || char === "\n") { if (char === "\r" && text[i + 1] === "\n") i++; put(); rows.push(row); row = []; if (rows.length > MAX_ROWS + 200) throw new Error("Planning file exceeds row limits."); continue; }
      if (afterQuote && !/\s/.test(char)) throw new Error("Malformed CSV after a quoted field.");
      if (!afterQuote) cell += char;
    }
    if (quoted) throw new Error("CSV has an unfinished quoted field.");
    if (cell || row.length) { put(); rows.push(row); }
    return rows;
  }
  function sheetRows(xml, strings) {
    safeXml(xml); const rows = [], seenRows = new Set(), seenCells = new Set(); let count = 0;
    for (const match of xml.matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row\s*>/g)) {
      if (rows.length > MAX_ROWS + 200) throw new Error("Planning worksheet exceeds row limits.");
      const number = Number(attrs(match[1]).r), values = [];
      if (!Number.isInteger(number) || number < 1 || number > 1048576 || seenRows.has(number)) throw new Error("Worksheet contains an invalid or repeated row address.");
      seenRows.add(number);
      for (const cell of match[2].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c\s*>)/g)) {
        if (++count > MAX_CELLS) throw new Error("Planning worksheet exceeds cell limits.");
        const a = attrs(cell[1]), body = cell[2] || "", coordinate = /^([A-Z]+)([1-9]\d*)$/.exec(a.r || "");
        if (!coordinate || Number(coordinate[2]) !== number || seenCells.has(a.r)) throw new Error("Worksheet has an invalid or repeated cell address.");
        seenCells.add(a.r);
        let column = 0; for (const char of coordinate[1]) column = column * 26 + char.charCodeAt(0) - 64;
        if (column > 4096) throw new Error("Worksheet exceeds column limits.");
        // Formula cells are retained as unavailable; cached calculations do not establish source facts.
        const formula = /<(?:\w+:)?f\b/.test(body);
        let value = body.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1] || "";
        if (a.t === "s") value = strings[Number(value)] ?? "";
        else if (a.t === "inlineStr") value = [...body.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(x => root.ASCMImporter.helpers.decodeXml(x[1])).join("");
        else value = root.ASCMImporter.helpers.decodeXml(value);
        if (String(value).length > 32768) throw new Error("Workbook cell exceeds the supported text size.");
        values[column - 1] = { value: formula ? "" : value, numeric: !a.t && value !== "", formula, coordinate: a.r };
      }
      rows.push({ number, values });
    }
    return rows;
  }
  function headerFor(rows) {
    for (let index = 0; index < Math.min(rows.length, 200); index++) {
      const values = rows[index].values.map(cell => normalize(cell?.value)), columns = {};
      for (const [field, names] of Object.entries(aliases)) { const found = names.map(name => values.indexOf(name)).find(i => i >= 0); if (found !== undefined) columns[field] = found; }
      if ((columns.name !== undefined || columns.codename !== undefined) && (columns.category !== undefined || Object.keys(DATES).some(field => columns[field] !== undefined) || columns.proposedFfs !== undefined)) return { index, columns };
    }
    return null;
  }
  function parseDate(value, options = {}) {
    if (!root.PLCImporter?.parseDate) throw new Error("The planning date reader did not load. Reload PPC.");
    const raw = clean(value).replace(/T00:00:00(?:\.000)?Z$/, "");
    const parsed = root.PLCImporter.parseDate(options.numeric ? Number(raw) : raw, { quarterBasis: "calendar", numeric: options.numeric === true, date1904: options.date1904 === true });
    if (parsed.kind === "exact" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.value) && parsed.value >= "1900-01-01") return { ...parsed, raw: clean(value), usable: true };
    if (parsed.kind === "quarter" && parsed.period) return { ...parsed, raw: clean(value), usable: true };
    return { ...parsed, raw: clean(value), usable: false };
  }
  function extractRows(table, source) {
    const header = table.header, output = [], seen = new Map();
    for (const row of table.rows.slice(header.index + 1)) {
      const get = field => row.values[header.columns[field]] || { value: "" };
      const name = clean(get("name").value), codename = clean(get("codename").value);
      if (!name && !codename) continue;
      const sourceId = clean(get("sourceId").value), sku = clean(get("sku").value);
      const identity = sourceId ? `id:${sourceId}` : `file:${source.fingerprint}:row:${row.number}`;
      const key = JSON.stringify([source.family, table.name, identity]);
      const dates = {};
      for (const field of Object.keys(DATES)) if (header.columns[field] !== undefined) { const cell = get(field); dates[field] = { ...parseDate(cell.value, { numeric: cell.numeric, date1904: table.date1904 }), cell: cell.coordinate || "", formula: cell.formula === true }; }
      const sourcePrecision = normalize(get("sourcePrecision").value);
      if (dates.ffsDate?.raw && sourcePrecision && !["day", "exact", "exact day"].includes(sourcePrecision)) {
        const startCell = get("periodStart"), endCell = get("periodEnd"), start = parseDate(startCell.value, { numeric: startCell.numeric, date1904: table.date1904 }), end = parseDate(endCell.value, { numeric: endCell.numeric, date1904: table.date1904 });
        const quarter = start.usable && /^\d{4}-\d{2}-01$/.test(start.value) ? root.PortfolioDatePrecision?.parseQuarter(`Q${Math.floor((Number(start.value.slice(5, 7)) - 1) / 3) + 1} ${start.value.slice(0, 4)}`) : null;
        if (sourcePrecision === "quarter" && quarter && start.value === quarter.start && end.value === quarter.end) dates.ffsDate = { ...dates.ffsDate, ...parseDate(quarter.label), sourcePrecision, raw: quarter.label };
        else dates.ffsDate = { ...dates.ffsDate, usable: false, kind: sourcePrecision, sourcePrecision, reason: "The source declares broader or ambiguous precision; a typed anchor is not an exact day. Select a reviewed exact date or quarter explicitly." };
      }
      const interpretation = clean(get("interpretation").value);
      if (dates.ffsDate?.raw && /multiple|unconfirmed|unlabelled|unlabeled|alternatives/i.test(interpretation)) dates.ffsDate = { ...dates.ffsDate, usable: false, kind: "ambiguous", reason: "The source retains alternatives without confirming the current date. Enter a reviewed exact date or quarter explicitly." };
      const proposalCell = get("proposedFfs"), proposal = parseDate(proposalCell.value, { numeric: proposalCell.numeric, date1904: table.date1904 });
      const record = { key, sourceId, stableIdentity: Boolean(sourceId), name: name || codename, codename, sku, category: clean(get("category").value), dates,
        proposal: proposal.raw ? { ...proposal, assumption: true, label: "Proposed FFS only; source launch quarter does not establish FFS" } : null,
        source: { sheet: table.name, row: row.number, reference: clean(get("sourceReference").value) }, issues: [] };
      if (!sourceId) record.issues.push("No immutable source ID; revised files require identity review.");
      if (Object.values(dates).some(date => date.formula)) record.issues.push("Formula values are unavailable; enter a reviewed date explicitly.");
      if (Object.values(dates).some(date => date.raw && !date.usable)) record.issues.push("Some date text needs an exact date or calendar quarter decision.");
      if (interpretation && /multiple|unconfirmed|review|alternatives/i.test(interpretation)) record.issues.push(interpretation.slice(0, 500));
      if (seen.has(key)) { record.issues.push("Duplicate source ID in worksheet."); output[seen.get(key)].issues.push("Duplicate source ID in worksheet."); record.duplicate = true; output[seen.get(key)].duplicate = true; record.key = `${key}:duplicate-row:${row.number}`; }
      else seen.set(key, output.length);
      output.push(record);
      if (output.length > MAX_ROWS) throw new Error("Planning intake supports at most 5,000 product rows.");
    }
    return output;
  }
  async function parseFile(file, options = {}) {
    if (!file || Number(file.size) > MAX_BYTES) throw new Error("Choose a planning XLSX or CSV of at most 25 MiB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new Error("Planning file exceeds 25 MiB.");
    if (!root.crypto?.subtle) throw new Error("Planning intake needs a secure browser for source identification.");
    const fingerprint = [...new Uint8Array(await root.crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join("");
    const source = { version: VERSION, fingerprint, fileName: clean(file.name) || "Planning file", family: clean(options.sourceFamily) || normalize(clean(file.name).replace(/\.(xlsx|csv|tsv)$/i, "")), byteLength: bytes.length };
    const tables = [];
    if (/\.(csv|tsv)$/i.test(file.name || "")) { const values = csvRows(new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "")); tables.push({ name: "CSV", rows: values.map((row, index) => ({ number: index + 1, values: row.map(value => ({ value, numeric: false })) })), date1904: false }); }
    else {
      if (!/\.xlsx$/i.test(file.name || "")) throw new Error("Choose ordinary .xlsx, .csv or .tsv. Macro workbooks are unsupported.");
      if (!root.ASCMImporter?.helpers?.openZip) throw new Error("The bounded Excel reader did not load. Reload PPC.");
      const zip = await root.ASCMImporter.helpers.openZip(bytes, { maxFileBytes: MAX_BYTES, maxEntries: 2048, maxTotalUncompressedBytes: 128 * 1024 * 1024 });
      const types = safeXml(await zip.getText("[Content_Types].xml") || "");
      if (/macroEnabled|vbaProject/i.test(types) || !/spreadsheetml\.sheet\.main\+xml/i.test(types)) throw new Error("Choose an ordinary XLSX workbook without macros.");
      const workbook = safeXml(await zip.getText("xl/workbook.xml") || ""), relationships = safeXml(await zip.getText("xl/_rels/workbook.xml.rels") || "");
      const rels = new Map([...relationships.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)(?:\/>|>)/g)].map(match => { const a = attrs(match[1]); return [a.Id, a]; }));
      const shared = [...rels.values()].find(rel => /\/sharedStrings$/.test(rel.Type) && rel.TargetMode !== "External");
      const strings = root.ASCMImporter.helpers.parseSharedStrings(await zip.getText(shared ? root.ASCMImporter.helpers.resolveZipTarget("xl/workbook.xml", shared.Target) : "xl/sharedStrings.xml") || "");
      for (const match of workbook.matchAll(/<(?:\w+:)?sheet\b([^>]*?)(?:\/>|>)/g)) {
        if (tables.length >= 128) throw new Error("Too many planning worksheets.");
        const a = attrs(match[1]), rel = rels.get(a["r:id"]); if (!rel || rel.TargetMode === "External" || !/\/worksheet$/.test(rel.Type)) continue;
        const xml = await zip.getText(root.ASCMImporter.helpers.resolveZipTarget("xl/workbook.xml", rel.Target));
        if (!xml) throw new Error("A planning worksheet is missing.");
        tables.push({ name: a.name || "Worksheet", hidden: a.state && a.state !== "visible", date1904: /date1904=["'](?:1|true)["']/.test(workbook), rows: sheetRows(xml, strings) });
      }
    }
    for (const table of tables) table.header = headerFor(table.rows);
    const supported = tables.filter(table => table.header && !table.hidden);
    const table = options.sheetName ? supported.find(item => item.name === options.sheetName) : supported.find(item => /^product collection$/i.test(item.name)) || supported.find(item => /^planning candidates$/i.test(item.name)) || supported[0];
    if (!table) throw new Error("No supported planning table found. Include a Product/Working name or Codename header and Category, FFS or a launch quarter column.");
    return { version: VERSION, source: { ...source, sheet: table.name }, sheets: supported.map(item => ({ name: item.name, headerRow: item.rows[item.header.index].number })), rows: extractRows(table, source), diagnostics: ["All imported names and FFS values are planning estimates. Review each mapping and changed field before applying."] };
  }
  function products(portfolio) { return (portfolio.categories || []).flatMap(category => (category.board?.products || []).map(product => ({ categoryId: category.id, laneId: product.laneId, product }))); }
  function sources(product) { return Array.isArray(product.plc?.planningSources) ? product.plc.planningSources : []; }
  function suggestions(row, portfolio) {
    const entries = products(portfolio), output = [];
    for (const entry of entries) {
      let reason = "", rank = 0;
      if (sources(entry.product).some(source => source.key === row.key)) { reason = "Previously reviewed source identity"; rank = 100; }
      else if (row.sku && [entry.product.sku, entry.product.basePartNumber, ...(entry.product.partSkus || []).map(sku => sku.code || sku.sku || sku.partNumber)].some(value => normalize(value) && normalize(value) === normalize(row.sku))) { reason = "Exact SKU"; rank = 90; }
      else if (row.codename && normalize(entry.product.codename) === normalize(row.codename)) { reason = "Exact codename"; rank = 80; }
      else if (normalize(entry.product.name) && normalize(entry.product.name) === normalize(row.name)) { reason = "Exact name"; rank = 70; }
      if (rank) output.push({ productId: entry.product.id, categoryId: entry.categoryId, name: entry.product.name, reason, rank, diffs: Object.fromEntries(Object.keys(DATES).map(field => [field, { before: entry.product[field] || "", after: row.dates[field]?.value || "", usable: row.dates[field]?.usable === true, protection: protection(entry.categoryId, entry.product.id, field) }])) });
    }
    return output.sort((a, b) => b.rank - a.rank || a.productId.localeCompare(b.productId));
  }
  function buildReview(dataset, portfolio) {
    if (dataset?.version !== VERSION || !Array.isArray(dataset.rows) || dataset.rows.length > MAX_ROWS || !/^[a-f0-9]{64}$/.test(dataset.source?.fingerprint || "")) throw new Error("Invalid planning source. Parse the file again.");
    return { version: VERSION, expectedBaseline: baseline(portfolio), source: clone(dataset.source), rows: dataset.rows.map(row => ({ ...clone(row), suggestions: suggestions(row, portfolio) })), categories: portfolio.categories.map(category => ({ id: category.id, name: category.name, lanes: (category.board?.lanes || []).map(lane => ({ id: lane.id, label: lane.label || lane.id })) })) };
  }
  function applyReview(review, decisions, portfolio, options = {}) {
    if (baseline(portfolio) !== review?.expectedBaseline) throw new Error("The portfolio changed while you reviewed this file. Review again before applying.");
    if (!Array.isArray(decisions) || decisions.length !== review.rows.length) throw new Error("Choose match, create or ignore for every source row.");
    const byKey = new Map(decisions.map(decision => [decision.key, decision]));
    if (byKey.size !== decisions.length) throw new Error("Repeated planning decisions are unsupported.");
    const entries = products(portfolio), usedProducts = new Set(), existingIds = new Set(entries.map(entry => entry.product.id)), operations = [], remembered = [];
    const now = options.now || new Date().toISOString();
    for (const row of review.rows) {
      const decision = byKey.get(row.key);
      if (!decision || !["ignore", "match", "create"].includes(decision.action)) throw new Error("Every planning row needs an explicit decision.");
      if (decision.action === "ignore") { remembered.push({ key: row.key, action: "ignore" }); continue; }
      if (row.duplicate) throw new Error("Duplicate source IDs must be corrected or ignored before importing.");
      const linked = entries.filter(entry => sources(entry.product).some(source => source.key === row.key));
      if (linked.length > 1) throw new Error("A source identity links to multiple products. Resolve its mappings first.");
      const entry = decision.action === "match" ? entries.find(item => item.product.id === decision.productId) : null;
      if (decision.action === "match" && !entry) throw new Error("A selected product no longer exists.");
      if (decision.action === "create" && linked.length) throw new Error("This source identity already has a product. Match it to avoid duplicates.");
      const categoryId = entry?.categoryId || decision.categoryId, category = review.categories.find(item => item.id === categoryId);
      const laneId = entry?.laneId || decision.laneId;
      if (!category || !category.lanes.some(lane => lane.id === laneId)) throw new Error("Choose a valid category and lane for every new product.");
      const productId = entry?.product.id || clean(options.idFactory?.(row) || `planning-${hash(row.key)}`);
      if (!productId || usedProducts.has(productId) || !entry && existingIds.has(productId)) throw new Error("Each product can receive only one reviewed planning row at a time. Ignore duplicate observations or review separately.");
      usedProducts.add(productId);
      const approved = decision.fields || [];
      if (!Array.isArray(approved) || new Set(approved).size !== approved.length || approved.some(field => !FIELDS.includes(field))) throw new Error("Invalid reviewed planning fields.");
      const fields = {}, evidence = {};
      for (const field of approved) {
        if (field === "name" || field === "codename") { const value = clean(decision.values?.[field] ?? row[field]); if (!value || value.length > 300) throw new Error("Reviewed product names and codenames must contain 1–300 characters."); if (value !== (entry?.product[field] || "")) { fields[field] = value; if (field === "name") fields.nameProvisional = true; } continue; }
        const parsed = Object.hasOwn(decision.values || {}, field) ? parseDate(decision.values[field]) : row.dates[field];
        if (!parsed?.usable) throw new Error(`Enter an exact date or calendar quarter for ${DATES[field]}. Blank source cells never clear accepted dates.`);
        const current = entry?.product[field] || "", currentEvidence = entry?.product.plc?.fields?.[field];
        const oldPeriod = root.PortfolioDatePrecision?.currentPeriod(entry?.product, field) || (currentEvidence && !currentEvidence.supersededAt && currentEvidence.value === current ? currentEvidence.period || null : null);
        const changed = current !== parsed.value || JSON.stringify(oldPeriod || null) !== JSON.stringify(parsed.period || null);
        if (changed) { const policy = protection(categoryId, productId, field); if (policy.unavailable) throw new Error("Field protection is unavailable. Retry before applying planning dates."); if (policy.protected && decision.overrideProtected !== true) throw new Error(`The ${DATES[field]} field is protected. Explicitly approve its override or leave it unchanged.`); fields[field] = parsed.value; evidence[field] = { value: parsed.value, raw: parsed.raw, sourceType: "import", observedAt: now, reviewed: true, estimated: true, source: { kind: "planning", fingerprint: review.source.fingerprint, sourceKey: row.key, fileName: review.source.fileName, sheet: row.source.sheet, row: row.source.row }, ...(parsed.period ? { period: clone(parsed.period) } : {}) }; }
      }
      if (!entry) { fields.name = clean(decision.values?.name ?? row.name); if (!fields.name || fields.name.length > 300) throw new Error("A new product needs a reviewed working name."); fields.nameProvisional = true; if (approved.includes("codename") && row.codename) fields.codename ||= row.codename; }
      const priorSources = sources(entry?.product || {}), sourceRecord = { key: row.key, sourceId: row.sourceId, fingerprint: review.source.fingerprint, sheet: row.source.sheet, row: row.source.row };
      const sourceChanged = !priorSources.some(source => source.key === row.key && source.fingerprint === review.source.fingerprint);
      if (Object.keys(fields).length || sourceChanged || !entry) {
        const plc = root.PortfolioMasterModel?.plcMetadata ? root.PortfolioMasterModel.plcMetadata(entry?.product.plc) || { version: 1 } : clone(entry?.product.plc || { version: 1 });
        if (plc.version !== 1) throw new Error("Unsupported existing source evidence. Review this product before planning intake.");
        plc.fields = { ...(plc.fields || {}), ...evidence };
        plc.planningSources = [...priorSources.filter(source => source.key !== row.key), sourceRecord].slice(-40);
        fields.plc = plc;
        const nextGa = fields.generalAvailabilityDate ?? entry?.product.generalAvailabilityDate, nextEm = fields.endManufacturingDate ?? entry?.product.endManufacturingDate;
        if (nextGa && nextEm && nextGa > nextEm) throw new Error("General availability cannot be after end of manufacturing. Review the selected dates.");
        operations.push({ kind: entry ? "update" : "create", productId, categoryId, laneId, fields, overrideProtected: decision.overrideProtected === true, expectedProduct: entry ? clone(entry.product) : null, provenance: { ...clone(review.source), sourceKey: row.key, row: row.source.row } });
      }
      remembered.push({ key: row.key, action: "match", productId, categoryId, laneId });
    }
    return { version: VERSION, expectedBaseline: review.expectedBaseline, source: clone(review.source), operations, decisions: remembered, summary: { created: operations.filter(x => x.kind === "create").length, updated: operations.filter(x => x.kind === "update").length, ignored: decisions.filter(x => x.action === "ignore").length, unchanged: decisions.filter(x => x.action !== "ignore").length - operations.length } };
  }
  root.PortfolioPlanningIntake = Object.freeze({ version: VERSION, limits: Object.freeze({ maxBytes: MAX_BYTES, maxRows: MAX_ROWS }), dateFields: DATES, fields: FIELDS, baseline, parseDate, parseFile, buildReview, applyReview, suggestions, protection });
})(globalThis);
