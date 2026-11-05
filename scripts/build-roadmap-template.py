#!/usr/bin/env python3
"""Derive the reviewed public roadmap shell from an explicitly supplied private PPTX.

The private reference is never copied. Only the declared, sanitized relationship
closure is emitted. This offline build helper uses the Python standard library.
"""

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import posixpath
import tempfile
import xml.etree.ElementTree as ET
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

SOURCE_SHA256 = "79c9d42cc81f9bf0cd3d84891bc532031a56297204526f6366a7685e4a76c748"
P = "http://schemas.openxmlformats.org/presentationml/2006/main"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
CP = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
DC = "http://purl.org/dc/elements/1.1/"
EP = "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
NS = {"p": P, "a": A, "r": R}
SLIDES = {f"ppt/slides/slide{i}.xml" for i in range(1, 5)}
LAYOUTS = {f"ppt/slideLayouts/slideLayout{i}.xml" for i in (1, 2, 25)}
MASTERS = {f"ppt/slideMasters/slideMaster{i}.xml" for i in (1, 2)}
APPROVED_MEDIA = {
    "ppt/media/image1.jpeg": "01142d9b2a466c75dce5f823aa59a965ab84025ea50972f77acf1c941b9ae253",
    "ppt/media/image2.svg": "cf17386df773f61093c66a1ab379c73516498b92f0501b3d3dbed210e7ea8b7a",
    "ppt/media/image36.svg": "3d32a0c808234b1be83eb0cdecb109be5d76ef30a7c8fea4aeebed7ba8803d88",
    "ppt/media/image37.svg": "e49fbf3be0297a9ab6efc9d34d16a9e77bd34ddce8691012a9f03107a162362e",
    "ppt/media/image38.svg": "7b6c39c4ae36a8455b504919e0c1a8e41dc72846fb45a0391627c5ac1c380815",
}
EXPECTED_PARTS = sorted({
    "[Content_Types].xml", "_rels/.rels", "docProps/app.xml", "docProps/core.xml",
    "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels", "ppt/tableStyles.xml",
    "ppt/theme/theme1.xml", "ppt/theme/theme2.xml", *SLIDES, *LAYOUTS, *MASTERS, *APPROVED_MEDIA,
    *(f"ppt/slides/_rels/slide{i}.xml.rels" for i in range(1, 5)),
    *(f"ppt/slideLayouts/_rels/slideLayout{i}.xml.rels" for i in (1, 2, 25)),
    *(f"ppt/slideMasters/_rels/slideMaster{i}.xml.rels" for i in (1, 2)),
})

for prefix, namespace in {
    "p": P, "a": A, "r": R, "cp": CP, "dc": DC,
    "a14": "http://schemas.microsoft.com/office/drawing/2010/main",
    "a16": "http://schemas.microsoft.com/office/drawing/2014/main",
}.items():
    ET.register_namespace(prefix, namespace)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def relationship_path(owner):
    if not owner:
        return "_rels/.rels"
    return posixpath.join(posixpath.dirname(owner), "_rels", posixpath.basename(owner) + ".rels")


def resolve_target(owner, target):
    return posixpath.normpath(posixpath.join(posixpath.dirname(owner), target)).lstrip("/")


def encode_xml(root):
    namespace = root.tag.split("}", 1)[0].lstrip("{")
    if namespace in (REL, CT, EP):
        ET.register_namespace("", namespace)
    return b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + ET.tostring(root, encoding="utf-8")


def sanitize_tree(root):
    # Hidden source photos and metadata do not belong to the reusable visible shell.
    parents = {child: parent for parent in root.iter() for child in parent}
    for properties in list(root.findall(".//p:cNvPr", NS)):
        if properties.get("hidden") == "1":
            shape = parents.get(parents.get(properties))
            if shape is not None and shape in parents:
                parents[shape].remove(shape)
    for parent in list(root.iter()):
        for child in list(parent):
            if child.tag in (f"{{{P}}}custDataLst", f"{{{P}}}extLst"):
                parent.remove(child)
            elif parent.tag == f"{{{P}}}cNvPr" and child.tag == f"{{{A}}}extLst":
                parent.remove(child)
            elif parent.tag in (f"{{{A}}}tr", f"{{{A}}}gridCol") and child.tag == f"{{{A}}}extLst":
                parent.remove(child)
        if parent.tag == f"{{{P}}}cNvPr":
            parent.attrib.pop("descr", None)
            parent.attrib.pop("title", None)
        if parent.tag == f"{{{A}}}fld" and "datetime" in parent.get("type", "").lower():
            for text in parent.findall(".//a:t", NS):
                text.text = ""


def shape_by_id(root, shape_id):
    for shape in root.findall(".//p:sp", NS):
        properties = shape.find("p:nvSpPr/p:cNvPr", NS)
        if properties is not None and properties.get("id") == str(shape_id):
            return shape, properties
    raise ValueError(f"Required template placeholder {shape_id} is missing")


def derive(source_bytes, output_name):
    if sha256(source_bytes) != SOURCE_SHA256:
        raise ValueError("The supplied source does not match the reviewed template identity")
    with ZipFile(io.BytesIO(source_bytes)) as archive:
        parts = {name: archive.read(name) for name in archive.namelist() if not name.endswith("/")}

    def xml(name):
        return ET.fromstring(parts[name])

    def save(name, root):
        parts[name] = encode_xml(root)

    def relationships(owner):
        name = relationship_path(owner)
        return xml(name) if name in parts else None

    def trim_relationships(owner, allowed_types, allowed_targets=None):
        root = relationships(owner)
        if root is None:
            return
        used = {value for element in xml(owner).iter() for key, value in element.attrib.items() if key.startswith("{" + R + "}")} if owner else set()
        for rel in list(root):
            kind = rel.get("Type", "").rsplit("/", 1)[-1]
            destination = resolve_target(owner, rel.get("Target", ""))
            keep = kind in allowed_types and rel.get("TargetMode") != "External"
            if allowed_targets and kind in allowed_targets:
                keep = keep and destination in allowed_targets[kind]
            if kind in ("image", "hdphoto"):
                keep = keep and rel.get("Id") in used
            if not keep:
                root.remove(rel)
        save(relationship_path(owner), root)

    for number in range(1, 5):
        name = f"ppt/slides/slide{number}.xml"
        root = xml(name)
        if number == 4:
            tree = root.find("p:cSld/p:spTree", NS)
            for child in list(tree):
                if child.tag not in (f"{{{P}}}nvGrpSpPr", f"{{{P}}}grpSpPr"):
                    tree.remove(child)
            # Remove ownership/timing of objects that have deliberately been removed.
            for child in list(root):
                if child.tag not in (f"{{{P}}}cSld", f"{{{P}}}clrMapOvr"):
                    root.remove(child)
        sanitize_tree(root)
        if number == 1:
            shape, properties = shape_by_id(root, 1664)
            properties.set("name", "ppc-template-export-date")
            runs = shape.findall(".//a:t", NS)
            if len(runs) != 3:
                raise ValueError("The export-date placeholder no longer has its reviewed runs")
            runs[0].text, runs[1].text, runs[2].text = "LAST UPDATED: ", "\t", ""
            title, properties = shape_by_id(root, 1665)
            properties.set("name", "ppc-template-intro-title")
            title.find(".//a:t", NS).text = "Portfolio Roadmap"
        elif number == 2:
            frame = root.find(".//p:graphicFrame", NS)
            frame.find("p:nvGraphicFramePr/p:cNvPr", NS).set("name", "ppc-template-changelog")
            table = frame.find(".//a:tbl", NS)
            if table is None or len(table.findall("a:tr", NS)) != 10:
                raise ValueError("The native changelog table structure changed")
            for row in table.findall("a:tr", NS)[1:]:
                for text in row.findall(".//a:t", NS):
                    text.text = ""
            for properties in table.iter():
                if properties.tag not in {f"{{{A}}}{tag}" for tag in ("rPr", "defRPr", "endParaRPr")}:
                    continue
                for child in list(properties):
                    if child.tag.rsplit("}", 1)[-1] in ("solidFill", "gradFill", "blipFill", "pattFill", "grpFill", "noFill"):
                        properties.remove(child)
                solid = ET.Element(f"{{{A}}}solidFill")
                ET.SubElement(solid, f"{{{A}}}srgbClr", {"val": "FFFFFF"})
                properties.insert(0, solid)
        elif number == 3:
            title, properties = shape_by_id(root, 2)
            properties.set("name", "ppc-template-category-title")
            title.find(".//a:t", NS).text = "Category Roadmap"
        save(name, root)
        trim_relationships(name, {"slideLayout", "image", "hdphoto"})

    for name in sorted(LAYOUTS):
        root = xml(name)
        sanitize_tree(root)
        save(name, root)
        trim_relationships(name, {"slideMaster", "image", "hdphoto"})
    for name in sorted(MASTERS):
        keep_ids = {rel.get("Id") for rel in relationships(name) if rel.get("Type").endswith("/slideLayout") and resolve_target(name, rel.get("Target")) in LAYOUTS}
        root = xml(name)
        sanitize_tree(root)
        layout_ids = root.find("p:sldLayoutIdLst", NS)
        for entry in list(layout_ids):
            if entry.get(f"{{{R}}}id") not in keep_ids:
                layout_ids.remove(entry)
        save(name, root)
        trim_relationships(name, {"slideLayout", "theme", "image", "hdphoto"}, {"slideLayout": LAYOUTS})

    root = xml("ppt/presentation.xml")
    for child in list(root):
        if child.tag.rsplit("}", 1)[-1] not in ("sldMasterIdLst", "sldIdLst", "sldSz", "notesSz", "defaultTextStyle"):
            root.remove(child)
    for list_tag, kind, targets in (("sldIdLst", "slide", SLIDES), ("sldMasterIdLst", "slideMaster", MASTERS)):
        keep_ids = {rel.get("Id") for rel in relationships("ppt/presentation.xml") if rel.get("Type").endswith("/" + kind) and resolve_target("ppt/presentation.xml", rel.get("Target")) in targets}
        entries = root.find("p:" + list_tag, NS)
        for entry in list(entries):
            if entry.get(f"{{{R}}}id") not in keep_ids:
                entries.remove(entry)
    save("ppt/presentation.xml", root)
    trim_relationships("ppt/presentation.xml", {"slide", "slideMaster", "theme", "tableStyles"}, {"slide": SLIDES, "slideMaster": MASTERS})

    core = ET.Element(f"{{{CP}}}coreProperties")
    ET.SubElement(core, f"{{{DC}}}title").text = "Roadmap template shell"
    ET.SubElement(core, f"{{{DC}}}creator")
    ET.SubElement(core, f"{{{CP}}}lastModifiedBy")
    save("docProps/core.xml", core)
    app = ET.Element(f"{{{EP}}}Properties")
    for name, value in (("Application", "Product Portfolio"), ("PresentationFormat", "Widescreen"), ("Slides", "4"), ("Notes", "0"), ("HiddenSlides", "0"), ("Company", None)):
        ET.SubElement(app, f"{{{EP}}}{name}").text = value
    save("docProps/app.xml", app)
    trim_relationships("", {"officeDocument", "core-properties", "extended-properties"})

    # Closure runs only after each master's layout fan-out has been reduced.
    reachable, pending = set(), [""]
    while pending:
        owner = pending.pop()
        if owner in reachable:
            continue
        if owner:
            reachable.add(owner)
        name = relationship_path(owner)
        if name not in parts:
            continue
        reachable.add(name)
        for rel in xml(name):
            if rel.get("TargetMode") == "External":
                raise ValueError("The sanitized closure contains an external relationship")
            destination = resolve_target(owner, rel.get("Target", ""))
            if destination not in parts:
                raise ValueError("The sanitized closure has an unresolved relationship")
            if destination not in reachable:
                pending.append(destination)
    types = xml("[Content_Types].xml")
    extensions = {posixpath.splitext(name)[1][1:] for name in reachable}
    for entry in list(types):
        if entry.tag == f"{{{CT}}}Override" and entry.get("PartName", "").lstrip("/") not in reachable:
            types.remove(entry)
        elif entry.tag == f"{{{CT}}}Default" and entry.get("Extension") not in extensions:
            types.remove(entry)
    save("[Content_Types].xml", types)
    reachable.add("[Content_Types].xml")
    if sorted(reachable) != EXPECTED_PARTS:
        raise ValueError("The sanitized closure differs from the reviewed 32-part allowlist")
    for name, expected in APPROVED_MEDIA.items():
        if sha256(parts[name]) != expected:
            raise ValueError("The sanitized shell contains unapproved branding bytes")

    buffer = io.BytesIO()
    with ZipFile(buffer, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for name in EXPECTED_PARTS:
            entry = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            entry.create_system = 3
            entry.external_attr = 0o644 << 16
            archive.writestr(entry, parts[name], compresslevel=9)
    output_bytes = buffer.getvalue()
    descriptions = [{"name": name, "byteLength": len(parts[name]), "sha256": sha256(parts[name])} for name in EXPECTED_PARTS]
    manifest = {
        "schemaVersion": 1,
        "source": {"sha256": SOURCE_SHA256, "byteLength": len(source_bytes)},
        "asset": {"fileName": output_name, "byteLength": len(output_bytes), "sha256": sha256(output_bytes)},
        "slideSizeEmu": {"cx": 24384000, "cy": 13716000},
        "partAllowlist": EXPECTED_PARTS,
        "parts": descriptions,
        "media": [entry for entry in descriptions if entry["name"] in APPROVED_MEDIA],
        "anchors": {
            "intro": {"part": "ppt/slides/slide1.xml", "titleShapeId": 1665, "dateShapeId": 1664, "dateTextRunIndex": 2},
            "changelog": {"part": "ppt/slides/slide2.xml", "shapeId": 2, "headerRows": 1, "columns": 2, "templateRows": 10},
            "divider": {"part": "ppt/slides/slide3.xml", "titleShapeId": 2},
            "body": {"part": "ppt/slides/slide4.xml", "layoutRelationshipId": "rId266", "layoutPart": "ppt/slideLayouts/slideLayout25.xml", "masterPart": "ppt/slideMasters/slideMaster2.xml"},
        },
    }
    return output_bytes, (json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def write_atomic(destination, data):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=".roadmap-template-", suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(data)
        os.replace(temporary, destination)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Explicit path to the reviewed owner-private source PPTX")
    parser.add_argument("--output", type=Path, required=True, help="Output shell PPTX; a matching -manifest.json is written beside it")
    args = parser.parse_args()
    try:
        source, output = args.source.resolve(), args.output.resolve()
        if output.suffix.lower() != ".pptx" or output == source:
            raise ValueError("Output must be a separate .pptx path")
        output_bytes, manifest_bytes = derive(source.read_bytes(), output.name)
        output.parent.mkdir(parents=True, exist_ok=True)
        write_atomic(output, output_bytes)
        write_atomic(output.with_name(output.stem + "-manifest.json"), manifest_bytes)
        print(json.dumps({"byteLength": len(output_bytes), "sha256": sha256(output_bytes), "partCount": len(EXPECTED_PARTS)}, sort_keys=True))
    except (OSError, ValueError, ET.ParseError) as error:
        parser.exit(2, f"Roadmap template generation failed: {error}\n")


if __name__ == "__main__":
    main()
