import assert from "node:assert/strict";
import { test } from "node:test";
import "../../public/js/package-codec.js";
import "../../public/js/ascm-import.js";

const importer = globalThis.ASCMImporter;
const validRow = ["Headset", "VALID01", "HyperX Cloud III BLK GAM HS", "2026-07-20", "2029-12-31"];
const xmlText = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function workbook(dataRows, { date1904 = false, extraHeaders = [] } = {}) {
  const table = [[...Object.values(importer.REQUIRED_HEADERS), ...extraHeaders], ...dataRows];
  const rows = table.map((values, index) => `<row r="${index + 1}">${values.map((value, column) => {
    const reference = `${String.fromCharCode(65 + column)}${index + 1}`;
    return typeof value === "number" ? `<c r="${reference}"><v>${value}</v></c>` : `<c r="${reference}" t="inlineStr"><is><t>${xmlText(value)}</t></is></c>`;
  }).join("")}</row>`).join("");
  const entries = {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    "xl/workbook.xml": `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${date1904 ? '<workbookPr date1904="1"/>' : ""}<sheets><sheet name="ASCM" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`,
  };
  return globalThis.PortfolioPackage.createZip(Object.entries(entries).map(([name, xml]) => ({ name, data: new TextEncoder().encode(xml) })));
}

test("cloud strict dates reject date-prefixed garbage while ordinary manual parsing keeps its existing behavior", async () => {
  // Removing strict validation would silently accept the normalized day and publish it.
  for (const raw of ["2026-07-20 garbage", "2026-07-20T99:99:99Z", "2026-07-20T12:30:00Z trailing text"]) {
    const row = [...validRow]; row[3] = raw;
    const bytes = workbook([validRow, [...row.slice(0, 1), "OTHER01", ...row.slice(2)]]);
    const ordinary = await importer.parseAscmWorkbook(bytes);
    assert.equal(ordinary.rows.length, 2);
    assert.equal(ordinary.rows[1].ga, "2026-07-20");
    await assert.rejects(importer.parseAscmWorkbook(bytes, { strictDates: true }), error => error.code === "INVALID_DATE_INPUT" && error.details.sourceRow === 3 && error.details.field === "ga");
  }
});

test("cloud rejects malformed GA and EM before partial row filtering or date normalization", async () => {
  const malformed = ["2026-02-30", "2026-07-20T24:00:00Z", "2026-07-20T12:60:00Z", "2026-07-20T12:00:60Z", "2026-07-20T12:00:00+24:00", "2026-07-20T12:00:00+01:60", "2026-07-20T12:00:00.1.2Z", "2026-07-20T12", "NaN", "Infinity", "0xB490", -1, 2958466];
  for (const field of ["ga", "em"]) for (const raw of malformed) {
    const row = [...validRow]; row[1] = "OTHER01"; row[field === "ga" ? 3 : 4] = raw;
    await assert.rejects(importer.parseAscmWorkbook(workbook([validRow, row]), { strictDates: true }), error => error.code === "INVALID_DATE_INPUT" && error.details.field === field);
  }
});

test("strict dates accept exact calendar days and fully valid ISO clock times without changing the reported day", async () => {
  const dates = ["2026-07-20", "2026-07-20T00:00:00Z", "2026-07-20T23:59:59.123Z", "2026-07-20T12:30", "2026-07-20T12:30:59", "2026-07-20T00:00:00+14:00", "2026-07-20T23:59:59-12:30", "2026-07-20 12:30:59", " 2026-07-20 "];
  for (const raw of dates) {
    const row = [...validRow]; row[3] = raw;
    const result = await importer.parseAscmWorkbook(workbook([row]), { strictDates: true });
    assert.equal(result.rows[0].ga, "2026-07-20");
    assert.equal(result.metadata.invalidRowsFiltered, 0);
  }
  const leap = [...validRow]; leap[3] = "2028-02-29T23:59:59Z";
  assert.equal((await importer.parseAscmWorkbook(workbook([leap]), { strictDates: true })).rows[0].ga, "2028-02-29");
});

test("strict dates retain Excel serial dates for both supported workbook date systems", async () => {
  for (const [raw, date1904, expected] of [[45292, false, "2024-01-01"], [45292.5, false, "2024-01-01"], [0, true, "1904-01-01"], ["45292", false, "2024-01-01"], ["4.5292E4", false, "2024-01-01"]]) {
    const row = [...validRow]; row[3] = raw;
    const result = await importer.parseAscmWorkbook(workbook([row], { date1904 }), { strictDates: true });
    assert.equal(result.rows[0].ga, expected);
  }
});

test("strict blank dates remain source blanks so the transaction planner can preserve saved values", async () => {
  const blank = [...validRow]; blank[1] = "BLANK01"; blank[3] = ""; blank[4] = "   ";
  const bytes = workbook([validRow, blank]);
  const strict = await importer.parseAscmWorkbook(bytes, { strictDates: true });
  assert.equal(strict.rows.length, 2);
  assert.equal(strict.rows[1].ga, "");
  assert.equal(strict.rows[1].em, "");
  assert.equal(strict.metadata.invalidRowsFiltered, 0);
  const ordinary = await importer.parseAscmWorkbook(bytes);
  assert.equal(ordinary.rows.length, 1);
  assert.equal(ordinary.metadata.invalidRowsFiltered, 1, "manual default retains its established required-date filtering");
});

test("the cloud option must be explicit and localization filtering remains intentional", async () => {
  const malformed = [...validRow]; malformed[3] = "2026-07-20 garbage";
  const ordinary = await importer.parseAscmWorkbook(workbook([malformed]), { strictDates: false });
  assert.equal(ordinary.rows[0].ga, "2026-07-20");
  const localized = [...malformed, "USA"];
  const result = await importer.parseAscmWorkbook(workbook([[...validRow, ""], localized], { extraHeaders: [importer.OPTIONAL_HEADERS.localCode[0]] }), { strictDates: true });
  assert.equal(result.rows.length, 1);
  assert.equal(result.metadata.localizedRowsFiltered, 1);
});
