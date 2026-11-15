# /// script
# requires-python = ">=3.11"
# dependencies = ["PyMuPDF==1.26.6", "pdfplumber==0.11.7", "pyarrow==22.0.0"]
# ///

"""Build plugin/tests/fixtures from an enhanced PDF.

  uv run --script plugin/scripts/make_fixtures.py <enhanced.pdf>

Writes the exporter's Parquet attachments, PoC-schema annotation tables (for migration tests), and
element-boxes.json (ElementId -> [x0, y0, x1, y1] in PDF user space, computed by the PoC script).
"""

import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "plugin" / "tests" / "fixtures"
POC = ROOT / "scripts" / "smart_annotations.py"


def attachments(pdf: Path) -> dict[str, bytes]:
    doc = pymupdf.open(pdf)  # read by index: name lookups are unreliable on unsorted trees
    return {doc.embfile_info(i)["name"]: doc.embfile_get(i) for i in range(doc.embfile_count())}


def main() -> None:
    source = Path(sys.argv[1])
    FIXTURES.mkdir(parents=True, exist_ok=True)

    for name, data in attachments(source).items():
        if name.endswith(".parquet") and not name.startswith("annotation"):
            (FIXTURES / name).write_bytes(data)

    with tempfile.TemporaryDirectory() as tmp:
        annotated = Path(tmp) / "annotated.pdf"
        subprocess.run(["uv", "run", "--script", str(POC), "add", str(source), "-o", str(annotated),
                        "--around", "676281", "--margin", "40",
                        "--text", "Confirm 2 HR rating; see also 745963."], check=True)
        for name, data in attachments(annotated).items():
            if name.startswith("annotation"):
                (FIXTURES / f"poc-{name}").write_bytes(data)

    spec = importlib.util.spec_from_file_location("smart_annotations", POC)
    poc = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(poc)
    boxes = poc.element_boxes(source, 0)
    (FIXTURES / "element-boxes.json").write_text(
        json.dumps({str(k): [round(v, 4) for v in box] for k, box in sorted(boxes.items())}, indent=0))

    for path in sorted(FIXTURES.iterdir()):
        print(f"{path.name:32} {path.stat().st_size:>8} bytes")


if __name__ == "__main__":
    main()
