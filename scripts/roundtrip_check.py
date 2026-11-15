# /// script
# requires-python = ">=3.11"
# dependencies = ["PyMuPDF==1.26.6", "pypdf==6.1.3", "pyarrow==22.0.0"]
# ///

"""Push an enhanced PDF through other tools and check that its model data survives.

Each variant re-saves the file the way a real consumer would (archive, generic PDF
library rewrite, incremental update with a markup, the browser viewer's pdf-lib save)
and then runs the same verification as verify_pdf.py: tables present, hashes equal to
manifest.json, text layer intact, joins consistent. The table bytes are also compared
with the original file, so a variant that silently re-encodes an attachment shows up.

    uv run --script scripts/roundtrip_check.py enhanced.pdf --out output/roundtrip
    uv run --script scripts/roundtrip_check.py enhanced.pdf --out output/roundtrip --node-modules C:/tools/pdflib

The pdf-lib variant runs only when node and pdf-lib are available (pass --node-modules or
set NODE_PATH). Expected to fail, and therefore not included: "print to PDF", which
rasterises or re-draws the page and drops every attachment.
"""

import argparse
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import pymupdf
from pypdf import PdfReader, PdfWriter

sys.path.insert(0, str(Path(__file__).resolve().parent))
from verify_pdf import verify  # noqa: E402

TABLE_SUFFIX = ".parquet"


def table_hashes(path: Path) -> dict[str, str]:
    reader = PdfReader(path)
    return {name: hashlib.sha256(files[0]).hexdigest() for name, files in reader.attachments.items()
            if name.endswith(TABLE_SUFFIX) or name == "manifest.json"}


def variant_zip(src: Path, out: Path) -> None:
    archive = out.with_suffix(".zip")
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(src, src.name)
    with zipfile.ZipFile(archive) as zf:
        out.write_bytes(zf.read(src.name))


def variant_pypdf(src: Path, out: Path) -> None:
    writer = PdfWriter(clone_from=str(src))
    with open(out, "wb") as handle:
        writer.write(handle)


def variant_pymupdf_rewrite(src: Path, out: Path) -> None:
    with pymupdf.open(src) as doc:
        doc.save(out, garbage=3, deflate=True)


def variant_pymupdf_incremental(src: Path, out: Path) -> None:
    shutil.copyfile(src, out)
    with pymupdf.open(out) as doc:
        page = doc[0]
        rect = page.rect
        annot = page.add_rect_annot(pymupdf.Rect(rect.x0 + 100, rect.y0 + 100, rect.x0 + 300, rect.y0 + 200))
        annot.set_info(content="round-trip test markup", title="roundtrip_check")
        annot.update()
        doc.saveIncr()


def variant_pdflib(src: Path, out: Path, node_modules: str | None) -> None:
    script = Path(__file__).resolve().parent / "roundtrip_pdflib.mjs"
    env = dict(os.environ)
    if node_modules:
        env["NODE_PATH"] = str(Path(node_modules) / "node_modules")
    subprocess.run(["node", str(script), str(src), str(out)], check=True, env=env, shell=(os.name == "nt"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--node-modules", help="Folder whose node_modules contains pdf-lib")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    original = table_hashes(args.pdf)
    baseline = verify(args.pdf)
    print(f"original: {len(original)} model-backed attachments, manifest "
          f"{'verified' if baseline.get('manifest') else 'absent'}")

    variants = [
        ("zip-unzip", lambda o: variant_zip(args.pdf, o)),
        ("pypdf-rewrite", lambda o: variant_pypdf(args.pdf, o)),
        ("pymupdf-rewrite-gc", lambda o: variant_pymupdf_rewrite(args.pdf, o)),
        ("pymupdf-incremental-markup", lambda o: variant_pymupdf_incremental(args.pdf, o)),
    ]
    if shutil.which("node"):
        variants.append(("pdf-lib-viewer-save", lambda o: variant_pdflib(args.pdf, o, args.node_modules)))
    else:
        print("node not found: skipping the pdf-lib variant")

    rows = []
    for name, make in variants:
        out = args.out / f"{args.pdf.stem}.{name}.pdf"
        try:
            make(out)
            report = verify(out)
            after = table_hashes(out)
            identical = after == original
            extra = report.get("other_attachments", [])
            status = "PASS" if identical else "FAIL"
            detail = "" if identical else "table bytes changed: " + ", ".join(sorted(set(original) ^ set(after)) or
                                                                        [k for k in original if after.get(k) != original[k]])
        except Exception as error:  # noqa: BLE001 - every failure mode is a result here
            status, extra, detail = "FAIL", [], f"{type(error).__name__}: {error}"
        size = out.stat().st_size if out.exists() else 0
        rows.append((name, status, size, extra, detail))
        print(f"  {name:28s} {status}  {size:>9,d} bytes  extra={extra}  {detail}")

    summary = {"source": str(args.pdf), "original_hashes": original, "results": [
        {"variant": n, "status": s, "bytes": b, "other_attachments": e, "detail": d} for n, s, b, e, d in rows]}
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    failed = [r for r in rows if r[1] != "PASS"]
    print(f"\n{len(rows) - len(failed)}/{len(rows)} variants kept the model data intact. Summary: {args.out / 'summary.json'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
