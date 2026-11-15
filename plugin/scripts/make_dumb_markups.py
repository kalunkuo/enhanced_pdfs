# /// script
# requires-python = ">=3.11"
# dependencies = ["PyMuPDF==1.26.6"]
# ///

"""Adds "dumb" markups to an enhanced PDF WITHOUT the plug-in (as a contractor without it would).

  uv run --script plugin/scripts/make_dumb_markups.py <enhanced.pdf> <out.pdf>

Opening <out.pdf> with the plug-in installed must "upgrade" them: link each markup to its elements and
write the tables on the next save. Element boxes come from plugin/tests/fixtures/element-boxes.json
(PDF user space); PyMuPDF wants top-left page coordinates, so they are converted with the page matrix.
"""

import json
import sys
from pathlib import Path

import pymupdf

FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures"


def main() -> None:
    src, out = sys.argv[1], sys.argv[2]
    boxes = json.loads((FIXTURES / "element-boxes.json").read_text())
    doc = pymupdf.open(src)
    page = doc[0]
    to_page = page.transformation_matrix  # PDF user space -> PyMuPDF space

    def rect(element_id: str, margin: float) -> pymupdf.Rect:
        x0, y0, x1, y1 = boxes[element_id]
        return pymupdf.Rect(pymupdf.Point(x0 - margin, y1 + margin) * to_page,
                            pymupdf.Point(x1 + margin, y0 - margin) * to_page)

    def centre(element_id: str) -> pymupdf.Point:
        x0, y0, x1, y1 = boxes[element_id]
        return pymupdf.Point((x0 + x1) / 2, (y0 + y1) / 2) * to_page

    made = []
    # 1. Rectangle (area) around the exterior wall 676281.
    a = page.add_rect_annot(rect("676281", 30))
    a.set_info(content="Dumb rectangle: check this wall", title="No-plug-in reviewer")
    a.update()
    made.append(("Square", "wall 676281 (area)"))
    # 2. Arrow pointing at the door 745963 (arrowhead at the door's centre).
    tip = centre("745963")
    a = page.add_line_annot(tip + (-120, -80), tip)
    a.set_line_ends(pymupdf.PDF_ANNOT_LE_NONE, pymupdf.PDF_ANNOT_LE_OPEN_ARROW)
    a.set_info(content="Dumb arrow: this door", title="No-plug-in reviewer")
    a.update()
    made.append(("Line", "door 745963 (arrowhead anchor)"))
    # 3. Text box on empty paper that only MENTIONS an element id.
    a = page.add_freetext_annot(pymupdf.Rect(60, 60, 360, 110), "Dumb text box: see wall 676281 and door 745963")
    a.set_info(title="No-plug-in reviewer")
    a.update()
    made.append(("FreeText", "references 676281, 745963 by text"))
    # 4. Freehand pen stroke across the elevator core wall 678407.
    r = rect("678407", 10)
    a = page.add_ink_annot([[(r.x0, r.y0), ((r.x0 + r.x1) / 2, r.y1), (r.x1, r.y0), (r.x1, r.y1)]])
    a.set_info(content="Dumb ink stroke", title="No-plug-in reviewer")
    a.update()
    made.append(("Ink", "elevator core wall 678407 (area)"))

    doc.save(out, garbage=1, deflate=True)
    for kind, target in made:
        print(f"{kind:9} -> {target}")
    print(f"saved {out} (no plug-in tables)")


if __name__ == "__main__":
    main()
