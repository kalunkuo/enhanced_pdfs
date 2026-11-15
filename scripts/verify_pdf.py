# /// script
# requires-python = ">=3.11"
# dependencies = ["PyMuPDF==1.26.6", "pypdf==6.1.3", "pyarrow==22.0.0"]
# ///

"""Verify the PDF layer and embedded model tables using independent readers."""

import argparse
import hashlib
import json
import re
from collections import Counter, defaultdict
from copy import copy
from io import BytesIO
from pathlib import Path

import pymupdf
from pypdf import PdfReader
from pypdf.generic import NameObject
import pyarrow.parquet as parquet


def check(condition, message):
    if not condition:
        raise ValueError(message)


def extract_bim_text(page, page_number):
    # The enrichment stream is first. Inspect its rendering state and extract it on its own.
    contents = page["/Contents"]
    check(isinstance(contents, list) and contents, f"Missing dedicated BIM text stream on page {page_number}.")
    text_page = copy(page)
    text_page[NameObject("/Contents")] = contents[0]
    render_mode = None
    shown = 0
    for operands, operator in text_page.get_contents().operations:
        if operator == b"Tr":
            render_mode = operands[0]
        elif operator == b"Tj":
            check(render_mode == 3, f"BIM text is drawn in a visible text mode on page {page_number}.")
            shown += 1
    text = text_page.extract_text()
    check(shown and text.startswith("REVIT BIM DATA"), f"BIM text did not extract on page {page_number}.")
    return text


def verify(path, native=None, wall_id=None, rating=None, excluded_id=None, dpi=144):
    reader = PdfReader(path, strict=True)
    page_count = len(reader.pages)
    check(page_count > 0, "Expected at least one PDF page.")
    attachments = reader.attachments
    required = {"drawings", "elements", "appearances", "parameters"}
    tables = {}
    for name, files in attachments.items():
        if name.removesuffix(".parquet") not in required | {"schedule-cells"}:
            continue
        check(len(files) == 1, f"Duplicate attachment {name}.")
        tables[name.removesuffix(".parquet")] = parquet.read_table(BytesIO(files[0])).to_pylist()
    check(required <= tables.keys(), "Required Parquet attachments are missing.")
    table_names = {f"{name}.parquet" for name in tables}
    other_attachments = sorted(name for name in attachments if name not in table_names | {"manifest.json"})

    # manifest.json lists the model-backed tables with their hashes. Anything not listed there
    # (review markups, links added by other tools) is a different layer and is only reported.
    manifest = None
    if "manifest.json" in attachments:
        check(len(attachments["manifest.json"]) == 1, "Duplicate attachment manifest.json.")
        manifest = json.loads(attachments["manifest.json"][0])
        check(manifest.get("format") == "enhanced-pdf" and manifest.get("schemaVersion") == 1, "Unexpected manifest format.")
        listed = {entry["name"]: entry for entry in manifest["tables"]}
        check(set(listed) == table_names, "The manifest lists different tables than the PDF carries.")
        for name, entry in listed.items():
            blob = attachments[name][0]
            check(entry["bytes"] == len(blob) and entry["sha256"] == hashlib.sha256(blob).hexdigest(),
                  f"{name} does not match its hash in manifest.json.")
            check(entry["rows"] == len(tables[name.removesuffix(".parquet")]), f"{name} row count differs from manifest.json.")
        check(len(manifest["pages"]) == page_count, "The manifest page count differs from the PDF.")

    drawings = tables["drawings"]
    by_drawing = {row["DrawingId"]: row for row in drawings}
    check(len(by_drawing) == len(drawings), "Duplicate drawing IDs.")
    roots = [row for row in drawings if row["ParentDrawingId"] is None]
    root_by_page = {row["Page"]: row for row in roots}
    check(len(roots) == page_count and set(root_by_page) == set(range(1, page_count + 1)),
          "Expected one root drawing for each PDF page.")
    if manifest is not None:
        check(manifest["model"]["savedVersion"] == root_by_page[1]["SavedVersion"]
              and manifest["exportedUtc"] == root_by_page[1]["ExportedUtc"],
              "The manifest provenance differs from drawings.parquet.")
        check([entry["drawingId"] for entry in manifest["pages"]] == [root_by_page[page]["DrawingId"] for page in sorted(root_by_page)],
              "The manifest pages differ from the root drawings.")
    for row in drawings:
        root = root_by_page.get(row["Page"])
        check(root is not None and (row is root or row["ParentDrawingId"] == root["DrawingId"]),
              "A view references a missing parent sheet or a sheet on another page.")

    data = tables["elements"]
    elements = {row["ElementKey"]: row for row in data}
    check(len(elements) == len(data), "Duplicate element keys.")
    appearances = tables["appearances"]
    check(all(row["DrawingId"] in by_drawing for row in appearances), "Missing view relation.")
    check({row["ElementKey"] for row in appearances} == elements.keys(), "Missing element relation.")
    type_keys = {row["TypeKey"] for row in data if row["TypeKey"]}
    parameters = tables["parameters"]
    check(all(row["OwnerKey"] in (type_keys if row["Scope"] == "Type" else elements)
              for row in parameters), "Orphan property row.")
    check(all(row["DrawingId"] in by_drawing for row in tables.get("schedule-cells", [])),
          "Orphan schedule cell.")

    element_ids_by_page = defaultdict(set)
    for appearance in appearances:
        page = by_drawing[appearance["DrawingId"]]["Page"]
        element_ids_by_page[page].add(elements[appearance["ElementKey"]]["ElementId"])

    walls = [row for row in data if row["WallFunction"] == "Exterior"]
    ratings = Counter(row["FireRating"] or "unspecified" for row in walls)
    if wall_id is not None:
        matched = [row for row in walls if row["ElementId"] == wall_id and row["FireRating"] == rating]
        check(matched, f"Exterior wall {wall_id} with Fire Rating {rating!r} is missing from Parquet.")
        owner = matched[0]["TypeKey"] if matched[0]["FireRatingSource"] == "Type" else matched[0]["ElementKey"]
        check(any(row["OwnerKey"] == owner and row["Name"] == "Fire Rating" and row["TextValue"] == rating
                  for row in parameters),
              "The wall's underlying Fire Rating parameter is missing.")
        wall_prefix = rf"Element ID:\s*{wall_id}\s*\|"
        rating_pattern = r"Fire Rating:\s*" + r"\s+".join(map(re.escape, rating.split())) + r"(?:\s*\||\s*\Z)"
    if excluded_id is not None:
        check(all(row["ElementId"] != excluded_id for row in data), "An excluded element is present in Parquet.")

    unique_ids = {row["ElementId"]: row["UniqueId"] for row in data}
    found_rating = False
    for page_number, page in enumerate(reader.pages, 1):
        text = extract_bim_text(page, page_number)
        text_ids = {int(match) for match in re.findall(r"Element ID:\s*(\d+)\s*\|", text)}
        check(text_ids == element_ids_by_page[page_number],
              f"Hidden text element IDs differ from the Parquet table on page {page_number}.")
        # The header describes the file for readers that only extract page text: it must name
        # every embedded table and the join keys, and each element record carries its UniqueId.
        header = text.split("Element ID:", 1)[0]
        for name in tables:
            check(f"{name}.parquet" in header, f"The text header on page {page_number} does not name {name}.parquet.")
        check("OwnerKey" in header and "TypeKey" in header, f"The text header on page {page_number} lacks the join rules.")
        if manifest is not None:
            check("manifest.json" in header, f"The text header on page {page_number} does not name manifest.json.")
        text_unique = dict(re.findall(r"Element ID:\s*(\d+)\s*\|\s*UniqueId:\s*([0-9a-f-]+)", text))
        check(all(unique_ids.get(int(element_id)) == unique_id for element_id, unique_id in text_unique.items())
              and len(text_unique) == len(text_ids),
              f"Hidden text UniqueIds differ from the Parquet table on page {page_number}.")
        if wall_id in text_ids and not found_rating:
            wall_sections = re.split(r"(?=Element ID:\s*\d+\s*\|)", text)
            found_rating = any(re.match(wall_prefix, section) and re.search(rating_pattern, section)
                               for section in wall_sections)
    if wall_id is not None:
        check(found_rating, "The exterior wall rating is missing from its text record.")

    result = {
        "revit_version": root_by_page[1]["RevitVersion"],
        "rows": {name: len(rows) for name, rows in tables.items()},
        "exterior_wall_ratings": dict(sorted(ratings.items())),
        "manifest": None if manifest is None else {
            "verified": True,
            "saved_version": manifest["model"]["savedVersion"],
            "exported_utc": manifest["exportedUtc"],
            "generator": manifest["generator"],
            "table_sha256": {entry["name"]: entry["sha256"] for entry in manifest["tables"]},
        },
        "other_attachments": other_attachments,
    }
    if page_count == 1:
        result.update(drawing=root_by_page[1]["Name"], sheet_number=root_by_page[1]["SheetNumber"])
    else:
        result["page_count"] = page_count
        result["pages"] = [{"page": page, "drawing": row["Name"], "sheet_number": row["SheetNumber"]}
                           for page, row in sorted(root_by_page.items())]

    if native:
        with pymupdf.open(native) as original, pymupdf.open(path) as enriched:
            check(len(original) == len(enriched), "Page counts differ from native PDF.")
            result["render_dpi"] = dpi
            hashes = []
            for page_number, (a, b) in enumerate(zip(original, enriched), 1):
                check(a.rect == b.rect and a.rotation == b.rotation,
                      f"Page boxes or rotation differ on page {page_number}.")
                plain = a.get_pixmap(dpi=dpi)
                enhanced = b.get_pixmap(dpi=dpi)
                check(plain.samples_mv == enhanced.samples_mv,
                      f"Rendered pixels differ from the native Revit PDF on page {page_number}.")
                check("REVIT BIM DATA" in b.get_text(), f"MuPDF could not recover BIM text on page {page_number}.")
                hashes.append(hashlib.sha256(plain.samples_mv).hexdigest())
            if page_count == 1:
                result["render_sha256"] = hashes[0]
            else:
                for page, digest in zip(result["pages"], hashes):
                    page["render_sha256"] = digest
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--native", type=Path, help="Original Revit PDF for a pixel comparison")
    parser.add_argument("--wall-id", type=int, help="ID of a wall to check against Revit")
    parser.add_argument("--rating", help="Expected Fire Rating of that exterior wall")
    parser.add_argument("--excluded-id", type=int, help="ID of a test element outside the drawing")
    parser.add_argument("--dpi", type=int, default=144)
    args = parser.parse_args()
    if (args.wall_id is None) != (args.rating is None):
        parser.error("--wall-id and --rating must be supplied together")
    try:
        report = verify(args.pdf, args.native, args.wall_id, args.rating, args.excluded_id, args.dpi)
    except ValueError as error:
        parser.exit(1, f"Verification failed: {error}\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
