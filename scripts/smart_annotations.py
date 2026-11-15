# /// script
# requires-python = ">=3.11"
# dependencies = ["PyMuPDF==1.26.6", "pdfplumber==0.11.7", "pyarrow==22.0.0"]
# ///

"""Proof of concept: smart annotations on an enhanced PDF.

Each annotation is a standard PDF markup (a cloud rectangle with an appearance stream) so every
viewer renders it. Its metadata lives in two Parquet attachments that follow the exporter's keys:

  annotations.parquet       AnnotationId (= the annotation's /NM), DrawingId, Page, Kind, Text, ...
  annotation-links.parquet  AnnotationId, ElementKey, ElementId, Relation ('linked' | 'referenced')

'linked' elements are found by hit-testing Revit's /Element<id> marked content under the cloud.
'referenced' elements are Revit element IDs mentioned in the annotation text.

  uv run --script scripts/smart_annotations.py add in.pdf -o out.pdf --around 676281 --text "..."
  uv run --script scripts/smart_annotations.py list out.pdf
"""

import argparse
import io
import re
import uuid
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber
import pyarrow as pa
import pyarrow.parquet as pq
import pymupdf

SCHEMA_VERSION = 1
ANNOTATIONS = "annotations.parquet"
LINKS = "annotation-links.parquet"
MARKER_KEY = "EP_SchemaVersion"  # custom key the PoC writes on its own clouds (the plug-in does not)
# Markup subtypes the Acrobat plug-in links (spec: text highlights are out of scope).
MARKUP_SUBTYPES = {"Square", "Circle", "Polygon", "PolyLine", "Line", "Ink", "FreeText", "Text"}
TAG = re.compile(r"Element(\d+)$")

ANNOTATION_SCHEMA = pa.schema([
    ("AnnotationId", pa.string()), ("DrawingId", pa.string()), ("Page", pa.int32()),
    ("Kind", pa.string()), ("Text", pa.string()), ("Author", pa.string()),
    ("Status", pa.string()), ("CreatedUtc", pa.string()),
    ("SheetRect", pa.list_(pa.float64())),  # x0, y0, x1, y1 in PDF user space
    ("SchemaVersion", pa.int32()),
])
LINK_SCHEMA = pa.schema([
    ("AnnotationId", pa.string()), ("ElementKey", pa.string()),
    ("ElementId", pa.int64()), ("Relation", pa.string()),
])


def element_boxes(pdf_path: Path, page_index: int) -> dict[int, tuple[float, float, float, float]]:
    """Union bbox per Revit ElementId, in PDF user space (y up)."""
    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[page_index]
        # pdfplumber measures `top`/`bottom` downward, starting at page.bbox[1] at the raw MediaBox
        # top edge (checked against the title block, which spans the whole sheet). Flip to y-up.
        top_edge = float(page.page_obj.mediabox[3]) + float(page.bbox[1])
        boxes: dict[int, list[float]] = {}
        for items in page.objects.values():
            for obj in items:
                match = TAG.match(obj.get("tag") or "")
                if not match:
                    continue
                x0, x1 = obj["x0"], obj["x1"]
                y0, y1 = top_edge - obj["bottom"], top_edge - obj["top"]
                box = boxes.setdefault(int(match[1]), [x0, y0, x1, y1])
                box[0], box[1] = min(box[0], x0), min(box[1], y0)
                box[2], box[3] = max(box[2], x1), max(box[3], y1)
    return {k: tuple(v) for k, v in boxes.items()}


def overlap_fraction(element, rect) -> float:
    w = min(element[2], rect[2]) - max(element[0], rect[0])
    h = min(element[3], rect[3]) - max(element[1], rect[1])
    area = max((element[2] - element[0]) * (element[3] - element[1]), 1e-6)
    return max(w, 0) * max(h, 0) / area


# PDF name trees must be sorted by key. PyMuPDF's embfile_add() appends, and its name lookups
# (embfile_get/embfile_del by name) then hit the wrong entry — embfile_del("annotations.parquet")
# removed parameters.parquet in testing. So: read attachments by index, rewrite the tree sorted.
def attachments(doc: pymupdf.Document) -> dict[str, bytes]:
    return {doc.embfile_info(i)["name"]: doc.embfile_get(i) for i in range(doc.embfile_count())}


def read_table(doc: pymupdf.Document, name: str, schema=None) -> pa.Table:
    data = attachments(doc).get(name)
    if data is not None:
        return pq.read_table(io.BytesIO(data))
    return schema.empty_table() if schema is not None else None


def write_tables(doc: pymupdf.Document, tables: dict[str, pa.Table]) -> None:
    files = attachments(doc)
    for name, table in tables.items():
        buffer = io.BytesIO()
        pq.write_table(table, buffer, compression="gzip")
        files[name] = buffer.getvalue()
    kind, value = doc.xref_get_key(doc.pdf_catalog(), "Names")
    if kind == "xref":  # /Names is an indirect dict (PDFsharp writes it this way)
        doc.xref_set_key(int(value.split()[0]), "EmbeddedFiles", "null")
    else:
        doc.xref_set_key(doc.pdf_catalog(), "Names/EmbeddedFiles", "null")
    for name in sorted(files):
        doc.embfile_add(name, files[name], filename=name)


def add(args) -> None:
    doc = pymupdf.open(args.pdf)
    page = doc[args.page - 1]
    elements = read_table(doc, "elements.parquet").to_pylist()
    keys_by_id: dict[int, list[str]] = {}
    for row in elements:
        keys_by_id.setdefault(row["ElementId"], []).append(row["ElementKey"])

    boxes = element_boxes(Path(args.pdf), args.page - 1)
    if args.around is not None:
        if args.around not in boxes:
            raise SystemExit(f"Element {args.around} is not drawn on page {args.page}.")
        b, m = boxes[args.around], args.margin
        rect = (b[0] - m, b[1] - m, b[2] + m, b[3] + m)
    else:
        rect = tuple(args.rect)
    rect_area = (rect[2] - rect[0]) * (rect[3] - rect[1])

    linked = sorted(
        eid for eid, box in boxes.items()
        if overlap_fraction(box, rect) >= 0.5
        and (box[2] - box[0]) * (box[3] - box[1]) <= 4 * rect_area  # skip title blocks, viewports
    )
    mentioned = {int(n) for n in re.findall(r"\b\d{4,9}\b", args.text)}
    referenced = sorted(eid for eid in mentioned if eid in keys_by_id and eid not in linked)

    annotation_id = f"ep-{uuid.uuid4()}"
    link_rows = [
        {"AnnotationId": annotation_id, "ElementKey": key, "ElementId": eid, "Relation": relation}
        for relation, ids in (("linked", linked), ("referenced", referenced))
        for eid in ids for key in keys_by_id.get(eid, [])
    ]

    # Pick the placed view that most linked elements belong to; fall back to the sheet itself.
    drawings = read_table(doc, "drawings.parquet").to_pylist()
    appearances = read_table(doc, "appearances.parquet").to_pylist()
    link_keys = {row["ElementKey"] for row in link_rows}
    votes = Counter(a["DrawingId"] for a in appearances if a["ElementKey"] in link_keys)
    sheet_id = next(d["DrawingId"] for d in drawings if d["ParentDrawingId"] is None)
    views = [d for d, _ in votes.most_common() if d != sheet_id]
    drawing_id = views[0] if views else sheet_id

    # The cloud: a standard Square annotation with a cloudy border, so any viewer can draw it.
    to_page = page.transformation_matrix
    page_rect = pymupdf.Rect(pymupdf.Point(rect[0], rect[3]) * to_page, pymupdf.Point(rect[2], rect[1]) * to_page)
    annot = page.add_rect_annot(page_rect)
    annot.set_border(width=2, clouds=1)
    annot.set_colors(stroke=(0.85, 0.1, 0.1))
    annot.set_info(content=args.text, title=args.author, subject=args.kind)
    annot.update()
    doc.xref_set_key(annot.xref, "NM", pymupdf.get_pdf_str(annotation_id))
    doc.xref_set_key(annot.xref, MARKER_KEY, str(SCHEMA_VERSION))

    now = datetime.now(timezone.utc).isoformat()
    new_annotation = pa.Table.from_pylist([{
        "AnnotationId": annotation_id, "DrawingId": drawing_id, "Page": args.page, "Kind": args.kind,
        "Text": args.text, "Author": args.author, "Status": "Open", "CreatedUtc": now,
        "SheetRect": list(rect), "SchemaVersion": SCHEMA_VERSION,
    }], schema=ANNOTATION_SCHEMA)
    write_tables(doc, {
        ANNOTATIONS: pa.concat_tables([read_table(doc, ANNOTATIONS, ANNOTATION_SCHEMA), new_annotation]),
        LINKS: pa.concat_tables([
            read_table(doc, LINKS, LINK_SCHEMA), pa.Table.from_pylist(link_rows, schema=LINK_SCHEMA)]),
    })

    output = Path(args.output)
    doc.save(output, garbage=1, deflate=True)
    print(f"{annotation_id}: {len(linked)} linked, {len(referenced)} referenced -> {output}")

    if args.preview:
        clip = page_rect + (-150, -150, 150, 150)
        pymupdf.open(output)[args.page - 1].get_pixmap(clip=clip, dpi=200).save(args.preview)
        print(f"preview -> {args.preview}")


def list_annotations(args) -> None:
    doc = pymupdf.open(args.pdf)
    annotations = read_table(doc, ANNOTATIONS, ANNOTATION_SCHEMA).to_pylist()
    links = read_table(doc, LINKS, LINK_SCHEMA).to_pylist()
    elements = {row["ElementKey"]: row for row in read_table(doc, "elements.parquet").to_pylist()}
    drawings = {row["DrawingId"]: row for row in read_table(doc, "drawings.parquet").to_pylist()}

    # Markups are matched to rows by /NM (the plug-in writes no custom keys on markups).
    in_pdf = {}
    for page in doc:
        for annot in page.annots():
            if annot.type[1] in MARKUP_SUBTYPES and annot.info.get("id"):
                in_pdf[annot.info["id"]] = page.number + 1

    for a in annotations:
        if a.get("Status") == "Deleted":
            state = "DELETED"
        else:
            state = "ok" if a["AnnotationId"] in in_pdf else "ORPHAN (markup deleted from PDF)"
        view = drawings.get(a["DrawingId"], {}).get("Name", a["DrawingId"])
        subtype = f" {a['Subtype']}" if a.get("Subtype") else ""
        print(f"\n[{a['Kind']}{subtype}] {a['AnnotationId']}  page {a['Page']}  view '{view}'  {state}")
        print(f"  {a['Author']}: {a['Text']}")
        for link in (l for l in links if l["AnnotationId"] == a["AnnotationId"]):
            e = elements.get(link["ElementKey"], {})
            extra = " | ".join(str(v) for v in (e.get("WallFunction"), e.get("FireRating")) if v)
            print(f"  {link['Relation']:<10} {link['ElementId']:>8}  {e.get('Category')} | {e.get('Name')}"
                  + (f" | {extra}" if extra else ""))
    for nm in sorted(set(in_pdf) - {a["AnnotationId"] for a in annotations}):
        print(f"\nUNTRACKED markup {nm} on page {in_pdf[nm]} has no Parquet metadata")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    a = sub.add_parser("add", help="add a smart annotation")
    a.add_argument("pdf")
    a.add_argument("-o", "--output", required=True)
    where = a.add_mutually_exclusive_group(required=True)
    where.add_argument("--around", type=int, metavar="ELEMENT_ID", help="cloud around a drawn element")
    where.add_argument("--rect", type=float, nargs=4, metavar=("X0", "Y0", "X1", "Y1"), help="PDF user space")
    a.add_argument("--margin", type=float, default=12)
    a.add_argument("--text", required=True)
    a.add_argument("--kind", default="RFI")
    a.add_argument("--author", default="Enhanced PDF PoC")
    a.add_argument("--page", type=int, default=1)
    a.add_argument("--preview", help="write a PNG crop around the new annotation")
    a.set_defaults(func=add)

    l = sub.add_parser("list", help="list smart annotations with their linked elements")
    l.add_argument("pdf")
    l.set_defaults(func=list_annotations)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
