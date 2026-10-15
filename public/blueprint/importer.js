/* Local, read-only Office Open XML ingestion. Never executes workbook macros. */
(function () {
  'use strict';
  const local = n => n.localName;
  const elements = (root, name) => [...root.getElementsByTagNameNS('*', name)];
  const xml = text => {
    if (typeof text !== 'string' || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('The workbook contains unsupported XML declarations or a missing part.');
    const document = new DOMParser().parseFromString(text, 'application/xml');
    if (elements(document, 'parsererror').length) throw new Error('The workbook contains unreadable XML.');
    return document;
  };
  const resolve = (base, target) => {
    if (target.startsWith('/')) return target.slice(1);
    const parts = base.split('/').slice(0, -1).concat(target.split('/'));
    const path = [];
    for (const part of parts) {
      if (part === '..') path.pop();
      else if (part && part !== '.') path.push(part);
    }
    return path.join('/');
  };
  async function zipEntries(buffer) {
    const openZip = globalThis.ASCMImporter?.helpers?.openZip;
    if (!openZip) throw new Error('The local workbook archive reader is unavailable. Your current source was kept.');
    // Check actual streamed output before allocating it, and verify each part's
    // CRC. Workbook headers alone cannot establish a safe decompressed size.
    const zip = await openZip(buffer, { maxFileBytes: 40 * 1024 * 1024, maxEntryUncompressedBytes: 120 * 1024 * 1024, maxTotalUncompressedBytes: 300 * 1024 * 1024 });
    return { read: zip.getText };
  }
  function readCells(document, strings) {
    const cells = {};
    const nodes = elements(document, 'c');
    if (nodes.length > 500000) throw new Error('The workbook worksheet exceeds the supported cell limit.');
    for (const node of nodes) {
      const address = node.getAttribute('r');
      const coordinate = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(address || '');
      const column = coordinate && [...coordinate[1]].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0);
      if (!coordinate || Number(coordinate[2]) > 1048576 || column > 16384) throw new Error('The workbook contains an invalid worksheet cell address.');
      if (Object.hasOwn(cells, address)) throw new Error('The workbook contains a duplicate worksheet cell.');
      const type = node.getAttribute('t') || 'n';
      const valueNode = [...node.children].find(n => local(n) === 'v');
      const formulaNode = [...node.children].find(n => local(n) === 'f');
      let value = valueNode?.textContent ?? null;
      if (type === 's') value = strings[Number(value)] ?? null;
      else if (type === 'inlineStr') value = elements(node, 't').map(n => n.textContent).join('');
      else if (type === 'b') value = value === '1';
      else if (type === 'n' && value !== null && value !== '') value = Number(value);
      cells[address] = { value, type, style: Number(node.getAttribute('s') || 0), formula: formulaNode ? '=' + formulaNode.textContent : null, formulaAttributes: formulaNode ? Object.fromEntries([...formulaNode.attributes].map(a => [a.name, a.value])) : null };
    }
    return cells;
  }
  window.HX_IMPORT_FILE = async function (file) {
    if (!/\.(xlsx|xlsm)$/i.test(file.name)) throw new Error('Choose an HX Blueprint .xlsx or .xlsm file.');
    if (file.size > 40 * 1024 * 1024) throw new Error('Choose a workbook smaller than 40 MB.');
    // A file handed over from the Analytics parent has a different realm.
    // Construct bytes here so the bounded ZIP reader sees its own typed array.
    const zip = await zipEntries(new Uint8Array(await file.arrayBuffer()));
    const workbookText = await zip.read('xl/workbook.xml');
    if (!workbookText) throw new Error('This file is not a supported Excel workbook.');
    const book = xml(workbookText), relationships = xml(await zip.read('xl/_rels/workbook.xml.rels'));
    const relationshipMap = Object.fromEntries(elements(relationships, 'Relationship').map(r => [r.getAttribute('Id'), resolve('xl/workbook.xml', r.getAttribute('Target'))]));
    const sharedText = await zip.read('xl/sharedStrings.xml');
    const strings = sharedText ? elements(xml(sharedText), 'si').map(si => elements(si, 't').map(t => t.textContent).join('')) : [];
    const sheets = [], sheetNodes = elements(book, 'sheet'), sheetNames = new Set();
    if (sheetNodes.length > 128) throw new Error('The workbook exceeds the supported worksheet limit.');
    let totalCells = 0;
    for (const sheet of sheetNodes) {
      const name = sheet.getAttribute('name');
      if (!name || sheetNames.has(name)) throw new Error('The workbook has a missing or duplicate worksheet name.');
      sheetNames.add(name);
      const id = sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      const document = xml(await zip.read(relationshipMap[id]));
      const cells = readCells(document, strings);
      totalCells += Object.keys(cells).length;
      if (totalCells > 2000000) throw new Error('The workbook exceeds the supported total cell limit.');
      sheets.push({ name, state: sheet.getAttribute('state') || 'visible', cells, dimension: elements(document, 'dimension')[0]?.getAttribute('ref'), formulaCount: Object.values(cells).filter(c => c.formula !== null).length });
    }
    const required = ['Cat_View', 'Dashboard', 'Budget_UnPivot', 'NPI_Tracker_All', 'TAM', 'NPI_Value', 'Combined_Products', 'Budget_Data', 'Category Targets', 'Targets Calculations'];
    const missing = required.filter(name => !sheets.some(s => s.name === name));
    if (missing.length) throw new Error('The source is missing these HX Blueprint tabs: ' + missing.join(', ') + '. The current source was kept.');
    if (!window.HX_ANALYTICS?.normalizeWorkbook) throw new Error('The dashboard calculation engine is not ready.');
    const definedNames=elements(book,'definedName').map(n=>({name:n.getAttribute('name'),definition:n.textContent}));
    const result = window.HX_ANALYTICS.normalizeWorkbook({ source: { name: file.name, size: file.size, modifiedAt: new Date(file.lastModified).toISOString(), importedAt: new Date().toISOString(), basis: 'Workbook planning snapshot', origin: 'Local file import' }, sheets, definedNames });
    if (!result.products?.length || !result.periods?.length) throw new Error('No supported product planning records were found. The current source was kept.');
    return result;
  };
})();
