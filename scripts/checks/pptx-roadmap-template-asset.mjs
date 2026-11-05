import assert from "node:assert/strict";
import { readFile, access, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";

const root = fileURLToPath(new URL("../../", import.meta.url));
const assetPath = path.join(root, "public/assets/pptx/roadmap-template.pptx");
const manifestPath = path.join(root, "public/assets/pptx/roadmap-template-manifest.json");
const generatorPath = path.join(root, "scripts/build-roadmap-template.py");
const SOURCE_SHA256 = "79c9d42cc81f9bf0cd3d84891bc532031a56297204526f6366a7685e4a76c748";
const EXPECTED_PARTS = [
  "[Content_Types].xml", "_rels/.rels", "docProps/app.xml", "docProps/core.xml",
  "ppt/_rels/presentation.xml.rels", "ppt/media/image1.jpeg", "ppt/media/image2.svg",
  "ppt/media/image36.svg", "ppt/media/image37.svg", "ppt/media/image38.svg", "ppt/presentation.xml",
  "ppt/slideLayouts/_rels/slideLayout1.xml.rels", "ppt/slideLayouts/_rels/slideLayout2.xml.rels", "ppt/slideLayouts/_rels/slideLayout25.xml.rels",
  "ppt/slideLayouts/slideLayout1.xml", "ppt/slideLayouts/slideLayout2.xml", "ppt/slideLayouts/slideLayout25.xml",
  "ppt/slideMasters/_rels/slideMaster1.xml.rels", "ppt/slideMasters/_rels/slideMaster2.xml.rels",
  "ppt/slideMasters/slideMaster1.xml", "ppt/slideMasters/slideMaster2.xml",
  "ppt/slides/_rels/slide1.xml.rels", "ppt/slides/_rels/slide2.xml.rels", "ppt/slides/_rels/slide3.xml.rels", "ppt/slides/_rels/slide4.xml.rels",
  "ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide3.xml", "ppt/slides/slide4.xml",
  "ppt/tableStyles.xml", "ppt/theme/theme1.xml", "ppt/theme/theme2.xml",
].sort();
const APPROVED_MEDIA = {
  "ppt/media/image1.jpeg": "01142d9b2a466c75dce5f823aa59a965ab84025ea50972f77acf1c941b9ae253",
  "ppt/media/image2.svg": "cf17386df773f61093c66a1ab379c73516498b92f0501b3d3dbed210e7ea8b7a",
  "ppt/media/image36.svg": "3d32a0c808234b1be83eb0cdecb109be5d76ef30a7c8fea4aeebed7ba8803d88",
  "ppt/media/image37.svg": "e49fbf3be0297a9ab6efc9d34d16a9e77bd34ddce8691012a9f03107a162362e",
  "ppt/media/image38.svg": "7b6c39c4ae36a8455b504919e0c1a8e41dc72846fb45a0391627c5ac1c380815",
};
const APPROVED_TEXT = new Set([
  "", "\t", "Category Roadmap", "Changes Made", "Date", "changelog", "Portfolio Roadmap", "LAST UPDATED: ",
  "Proprietary and confidential. ", "Do not duplicate or distribute to the public or press. ", "© 2026 HP, Inc. All rights reserved.",
  "Click to edit Master text styles", "Click to edit Master title style", "Second level", "Third level", "Fourth level", "Fifth level", "‹#›",
]);
const APPROVED_FONTS = new Set([
  "", "+mj-cs", "+mj-ea", "+mj-lt", "+mn-cs", "+mn-ea", "+mn-lt", "Angsana New", "Aptos Black", "Arial", "Calibri", "Calibri Light",
  "Cordia New", "DaunPenh", "DokChampa", "Estrangelo Edessa", "Euphemia", "Forma DJR Display", "Forma DJR Micro", "Gautami",
  "HP Forma DJR Office", "HP Forma DJR Office Medium", "Iskoola Pota", "Kalinga", "Kartika", "Latha", "MV Boli", "Mangal",
  "Microsoft Himalaya", "Microsoft Uighur", "Microsoft Yi Baiti", "Mongolian Baiti", "MoolBoran", "Nyala", "Plantagenet Cherokee",
  "Poppins", "Raavi", "Shruti", "Sylfaen", "Times New Roman", "Tunga", "Vrinda", "新細明體", "游ゴシック", "游ゴシック Light", "等线", "等线 Light", "맑은 고딕",
]);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const decode = text => text.replace(/&(?:#x([\da-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (_all, hex, dec, named) => hex ? String.fromCodePoint(parseInt(hex, 16)) : dec ? String.fromCodePoint(Number(dec)) : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[named.toLowerCase()]);
const textValues = xml => [...xml.matchAll(/<a:t\b[^>]*\/>|<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map(match => decode(match[1] || ""));
const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map(match => [match[1], decode(match[2])]));
const relationships = xml => [...xml.matchAll(/<(?:\w+:)?Relationship\b[^>]*\/>/g)].map(match => attributes(match[0]));
const shapeById = (xml, id) => [...xml.matchAll(/<p:sp(?:\s[^>]*)?>[\s\S]*?<\/p:sp>/g)].map(match => match[0]).find(block => new RegExp(`<p:cNvPr\\b[^>]*\\bid="${id}"(?:\\s|/|>)`).test(block));

assert.ok(await access(assetPath).then(() => true, () => false), "the sanitized four-slide roadmap shell must exist");
const runtime = { console, setTimeout, clearTimeout, setImmediate, clearImmediate, Buffer, Blob, URL, TextEncoder, TextDecoder };
vm.createContext(runtime);
vm.runInContext(await readFile(path.join(root, "public/vendor/pptxgen.bundle.js"), "utf8"), runtime);
const JSZip = runtime.JSZip;

async function validatePackage(bytes, manifest) {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const names = Object.keys(zip.files).sort();
  assert.deepEqual(names, EXPECTED_PARTS, "the asset has exactly the reviewed part allowlist, with no source data or fonts");
  assert.deepEqual(manifest.partAllowlist, EXPECTED_PARTS);
  const entries = new Map(await Promise.all(names.map(async name => [name, Buffer.from(await zip.file(name).async("uint8array"))])));
  const xml = name => entries.get(name).toString("utf8");
  for (const name of names) {
    assert.ok(!/(?:notes|tags|customxml|authors|comments|docmetadata|fonts\/|\.(?:ttf|otf|odttf|woff2?))/.test(name.toLowerCase()), "no private/add-in/font parts");
    if (name.endsWith(".xml")) {
      const content = xml(name);
      assert.doesNotMatch(content, /<!DOCTYPE|<!ENTITY|<p:custDataLst|\bhidden="1"|OTLSHAPE_|TargetMode="External"/i, "no hidden source/add-in/XML execution state");
      for (const text of textValues(content)) assert.ok(APPROVED_TEXT.has(text), `unapproved source text in ${name}`);
      for (const match of content.matchAll(/\btypeface="([^"]*)"/g)) assert.ok(APPROVED_FONTS.has(decode(match[1])), `unapproved font declaration in ${name}`);
    }
    if (name.endsWith(".rels")) {
      const owner = name === "_rels/.rels" ? "" : name.replace(/(?:^|\/)\_rels\//, "/").replace(/\.rels$/, "");
      for (const rel of relationships(xml(name))) {
        assert.notEqual(rel.TargetMode, "External", "external relationships must never be published");
        assert.ok(!/^(?:[a-z]+:|\/\/)/i.test(rel.Target), "relationship targets stay inside the archive");
        const destination = path.posix.normalize(path.posix.join(path.posix.dirname(owner), rel.Target)).replace(/^\//, "");
        assert.ok(names.includes(destination), `relationship ${name} -> ${destination} resolves`);
      }
    }
  }
  for (const [name, sha256] of Object.entries(APPROVED_MEDIA)) {
    assert.equal(digest(entries.get(name)), sha256, "only approved brand media bytes survive sanitization");
    if (name.endsWith(".svg")) assert.doesNotMatch(xml(name), /<script\b|(?:href|src)=["'](?:https?:|file:|\/\/)/i);
  }
  const presentation = xml("ppt/presentation.xml");
  assert.match(presentation, /<p:sldSz\b[^>]*cx="24384000"[^>]*cy="13716000"/);
  assert.equal((presentation.match(/<p:sldId\b/g) || []).length, 4);
  assert.equal((presentation.match(/<p:sldMasterId\b/g) || []).length, 2);
  assert.deepEqual(relationships(xml("ppt/slideMasters/_rels/slideMaster1.xml.rels")).filter(rel => rel.Type.endsWith("/slideLayout")).map(rel => rel.Target).sort(), ["../slideLayouts/slideLayout1.xml", "../slideLayouts/slideLayout2.xml"]);
  assert.deepEqual(relationships(xml("ppt/slideMasters/_rels/slideMaster2.xml.rels")).filter(rel => rel.Type.endsWith("/slideLayout")).map(rel => rel.Target), ["../slideLayouts/slideLayout25.xml"]);
  for (const [master, expected] of [[1, 2], [2, 1]]) assert.equal((xml(`ppt/slideMasters/slideMaster${master}.xml`).match(/<p:sldLayoutId\b/g) || []).length, expected);
  const body = xml("ppt/slides/slide4.xml");
  const tree = body.match(/<p:spTree(?:\s[^>]*)?>([\s\S]*?)<\/p:spTree>/)[1];
  assert.match(tree, /<p:nvGrpSpPr\b/); assert.match(tree, /<p:grpSpPr\b/);
  assert.doesNotMatch(tree, /<p:(?:sp|grpSp|pic|graphicFrame|cxnSp)\b/, "body contains only its preserved group root");
  const bodyRels = relationships(xml("ppt/slides/_rels/slide4.xml.rels"));
  assert.equal(bodyRels.length, 1);
  assert.equal(bodyRels[0].Id, "rId266");
  assert.equal(bodyRels[0].Target, "../slideLayouts/slideLayout25.xml");
  assert.ok(bodyRels[0].Type.endsWith("/slideLayout"));
  assert.equal(relationships(xml("ppt/slideLayouts/_rels/slideLayout25.xml.rels")).find(rel => rel.Type.endsWith("/slideMaster")).Target, "../slideMasters/slideMaster2.xml");
  const intro = xml("ppt/slides/slide1.xml"), changelog = xml("ppt/slides/slide2.xml"), divider = xml("ppt/slides/slide3.xml");
  assert.deepEqual(textValues(shapeById(intro, 1664)), ["LAST UPDATED: ", "\t", ""]);
  assert.deepEqual(textValues(shapeById(intro, 1665)), ["Portfolio Roadmap"]);
  assert.deepEqual(textValues(shapeById(divider, 2)), ["Category Roadmap"]);
  assert.match(intro, /name="ppc-template-export-date"/); assert.match(divider, /name="ppc-template-category-title"/);
  const table = changelog.match(/<a:tbl(?:\s[^>]*)?>[\s\S]*?<\/a:tbl>/)?.[0];
  assert.ok(table, "changelog stays an editable native table");
  assert.equal((table.match(/<a:gridCol\b/g) || []).length, 2);
  const rows = [...table.matchAll(/<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g)].map(match => match[0]);
  assert.equal(rows.length, 10);
  assert.deepEqual(textValues(rows[0]), ["Date", "Changes Made"]);
  assert.ok(rows.slice(1).every(row => textValues(row).every(text => text === "")), "historical changelog cells are blank");
  for (const props of table.matchAll(/<a:(rPr|defRPr|endParaRPr)\b[^>]*>[\s\S]*?<\/a:\1>/g)) assert.match(props[0], /<a:solidFill>\s*<a:srgbClr val="FFFFFF"\s*\/>\s*<\/a:solidFill>/, "changelog text properties explicitly remain white");
  const metadataBody = content => content.replace(/<\?xml[^>]*>\s*/, "").replace(/\s+xmlns(?::[\w]+)?="[^"]*"/g, "").replace(/\s+\/>/g, "/>");
  assert.equal(metadataBody(xml("docProps/core.xml")), "<cp:coreProperties><dc:title>Roadmap template shell</dc:title><dc:creator/><cp:lastModifiedBy/></cp:coreProperties>", "core metadata contains only generic title and blank authors");
  assert.equal(metadataBody(xml("docProps/app.xml")), "<Properties><Application>Product Portfolio</Application><PresentationFormat>Widescreen</PresentationFormat><Slides>4</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides><Company/></Properties>", "extended metadata contains no source author/company/history");
  assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.source.sha256, SOURCE_SHA256);
  assert.deepEqual(manifest.slideSizeEmu, { cx: 24384000, cy: 13716000 });
  assert.equal(manifest.asset.fileName, "roadmap-template.pptx");
  assert.equal(manifest.asset.byteLength, bytes.length); assert.equal(manifest.asset.sha256, digest(bytes));
  assert.deepEqual(manifest.parts.map(part => part.name), EXPECTED_PARTS);
  for (const part of manifest.parts) { assert.equal(part.byteLength, entries.get(part.name).length); assert.equal(part.sha256, digest(entries.get(part.name))); }
  assert.deepEqual(manifest.media.map(part => part.name).sort(), Object.keys(APPROVED_MEDIA).sort());
  assert.deepEqual(Object.keys(manifest).sort(), ["anchors", "asset", "media", "partAllowlist", "parts", "schemaVersion", "slideSizeEmu", "source"]);
  for (const object of [manifest.source, manifest.asset, ...manifest.parts, ...manifest.media]) {
    const allowed = object === manifest.source ? ["byteLength", "sha256"] : object === manifest.asset ? ["byteLength", "fileName", "sha256"] : ["byteLength", "name", "sha256"];
    assert.deepEqual(Object.keys(object).sort(), allowed);
  }
  assert.deepEqual(manifest.anchors, {
    body: { layoutPart: "ppt/slideLayouts/slideLayout25.xml", layoutRelationshipId: "rId266", masterPart: "ppt/slideMasters/slideMaster2.xml", part: "ppt/slides/slide4.xml" },
    changelog: { columns: 2, headerRows: 1, part: "ppt/slides/slide2.xml", shapeId: 2, templateRows: 10 },
    divider: { part: "ppt/slides/slide3.xml", titleShapeId: 2 },
    intro: { dateShapeId: 1664, dateTextRunIndex: 2, part: "ppt/slides/slide1.xml", titleShapeId: 1665 },
  }, "the manifest contains only the fixed safe renderer anchors");
  assert.doesNotMatch(JSON.stringify(manifest), /[a-z]:[\\/]|\/(?:Users|home)\/|productRows/i, "public metadata contains no source path or working records");
  for (const entry of Object.values(zip.files)) { assert.equal(entry.date.toISOString(), "1980-01-01T00:00:00.000Z", "fixed ZIP timestamps make regeneration stable"); assert.equal(entry.comment, null); }
  return { zip, entries };
}

const bytes = await readFile(assetPath), manifest = JSON.parse(await readFile(manifestPath, "utf8"));
await validatePackage(bytes, manifest);
let checks = 1;
async function rejectMutation(label, mutate, expected) {
  const zip = await JSZip.loadAsync(bytes);
  await mutate(zip);
  const modified = Buffer.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
  const claimed = structuredClone(manifest);
  claimed.asset.byteLength = modified.length; claimed.asset.sha256 = digest(modified);
  claimed.partAllowlist = Object.keys(zip.files).sort();
  claimed.parts = await Promise.all(claimed.partAllowlist.map(async name => { const data = Buffer.from(await zip.file(name).async("uint8array")); return { name, byteLength: data.length, sha256: digest(data) }; }));
  await assert.rejects(validatePackage(modified, claimed), expected, label); checks++;
}
await rejectMutation("extra notes cannot hide behind a recomputed manifest", zip => zip.file("ppt/notesSlides/notesSlide1.xml", "<private>fixture</private>", { createFolders: false }), /reviewed part allowlist/);
await rejectMutation("font binaries are never distributed", zip => zip.file("ppt/fonts/source.ttf", Buffer.from([0, 1, 2]), { createFolders: false }), /reviewed part allowlist/);
await rejectMutation("new source text is rejected", async zip => zip.file("ppt/slides/slide1.xml", (await zip.file("ppt/slides/slide1.xml").async("string")).replace("Portfolio Roadmap", "SYNTHETIC_PRIVATE_PRODUCT_001"), { createFolders: false }), /unapproved source text/);
await rejectMutation("a changed media payload cannot bypass privacy identity", zip => zip.file("ppt/media/image36.svg", "<svg>fixture</svg>", { createFolders: false }), /approved brand media/);
await rejectMutation("external relationships never enter the asset", async zip => zip.file("ppt/slides/_rels/slide4.xml.rels", (await zip.file("ppt/slides/_rels/slide4.xml.rels").async("string")).replace("</Relationships>", '<Relationship Id="external" Type="image" TargetMode="External" Target="https://example.invalid/image" /></Relationships>'), { createFolders: false }), /external relationships/);
await rejectMutation("body retains layout25", async zip => zip.file("ppt/slides/_rels/slide4.xml.rels", (await zip.file("ppt/slides/_rels/slide4.xml.rels").async("string")).replace("slideLayout25.xml", "slideLayout1.xml"), { createFolders: false }), /slideLayout25/);
await rejectMutation("source author metadata is rejected", async zip => zip.file("docProps/core.xml", (await zip.file("docProps/core.xml").async("string")).replace(/<dc:creator\s*\/>/, "<dc:creator>Synthetic author</dc:creator>"), { createFolders: false }), /blank authors/);
await rejectMutation("unapproved font declarations are rejected", async zip => zip.file("ppt/slides/slide1.xml", (await zip.file("ppt/slides/slide1.xml").async("string")).replace("HP Forma DJR Office", "Unapproved Fixture Font"), { createFolders: false }), /unapproved font/);

// Rebuild from a private source only when the caller explicitly supplies it.
// CI verifies the checked-in closure without needing or publishing that source.
if (process.env.PPC_ROADMAP_TEMPLATE_SOURCE) {
  const python = process.env.PPC_TEST_PYTHON || "python";
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ppc-roadmap-template-"));
  try {
    const output = path.join(fixtureRoot, "roadmap-template.pptx");
    const first = spawnSync(python, [generatorPath, "--source", process.env.PPC_ROADMAP_TEMPLATE_SOURCE, "--output", output], { encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.deepEqual(await readFile(output), bytes, "explicit-source regeneration matches checked-in deterministic bytes");
    assert.deepEqual(JSON.parse(await readFile(output.replace(/\.pptx$/, "-manifest.json"), "utf8")), manifest);
    const second = spawnSync(python, [generatorPath, "--source", process.env.PPC_ROADMAP_TEMPLATE_SOURCE, "--output", output], { encoding: "utf8" });
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.deepEqual(await readFile(output), bytes, "repeat generation is byte-for-byte reproducible");
    checks += 2;
    const invalid = spawnSync(python, [generatorPath, "--source", assetPath, "--output", output], { encoding: "utf8" });
    assert.notEqual(invalid.status, 0, "an unreviewed source is rejected");
    assert.deepEqual(await readFile(output), bytes, "rejected input preserves existing output"); checks++;
  } finally {
    assert.equal(path.dirname(path.resolve(fixtureRoot)), path.resolve(os.tmpdir()));
    assert.match(path.basename(fixtureRoot), /^ppc-roadmap-template-/);
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}
console.log(`Roadmap template asset checks passed: ${checks} checks, exact 32-part closure, approved branding, editable changelog, fixed body inheritance, no private source or font files.`);
