# /// script
# requires-python = ">=3.11"
# dependencies = ["PyMuPDF==1.26.6", "pyarrow==22.0.0"]
# ///

"""Write a synthetic enhanced PDF for developing the viewer.

It mirrors the add-in's tables (drawings, elements, appearances, parameters; gzip Parquet)
and adds `geometry`, the table the viewer needs for hover and click: one outline per element
in PDF points with the origin at the bottom-left. The data is made up, not from a Revit model.

Usage: uv run --python 3.13 --script scripts/make-demo-pdf.py public/demo/demo-enhanced.pdf
       ... make-demo-pdf.py public/demo/plain.pdf --plain [--pages 3]   (same drawing, no attachments: what a Revit export is today)
"""

import io
import json
import sys

import pyarrow as pa
import pyarrow.parquet as pq
import pymupdf

PAGE_W, PAGE_H = 792, 612  # landscape letter
T = 9  # wall thickness in points

EXT = ('ext', 'Exterior - 2HR Stud-MTL', '2 HR', 'Exterior')
INT = ('int', 'I_0HR_Stud-MTL-3-5/8" (5/8" GWB)-(5/8" GWB) 4-7/8"', '', 'Interior')

# (mark, x0, y0, x1, y1, type) in top-left page coordinates
WALLS = [
    ('Wall 01', 140, 130, 640, 130 + T, EXT),
    ('Wall 02', 640 - T, 130, 640, 480, EXT),
    ('Wall 03', 140, 480 - T, 640, 480, EXT),
    ('Wall 04', 140, 130, 140 + T, 480, EXT),
    ('Wall 05', 380, 130, 380 + T, 330, INT),
    ('Wall 06', 380, 330 - T, 640, 330, INT),
]
COLUMNS = [('Column 01', 250, 295, 266, 311), ('Column 02', 500, 395, 516, 411)]
# Standalone illustrative door symbols, not measured building geometry.
# (mark, hinge x, hinge y, display width); one intentionally lacks a width.
DOORS = [('D01', 215, 240, '2\' 8"'), ('D02', 305, 415, '3\' 0"'),
         ('D03', 455, 250, '3\' 6"'), ('D04', 555, 420, None)]


def pq_bytes(columns):
    buf = io.BytesIO()
    pq.write_table(pa.table(columns), buf, compression='gzip')
    return buf.getvalue()


def outline(x0, y0, x1, y1):
    # page (top-left) -> PDF (bottom-left)
    return json.dumps([[x0, PAGE_H - y0], [x1, PAGE_H - y0], [x1, PAGE_H - y1], [x0, PAGE_H - y1]])


def main(path, plain=False, pages=1):
    doc = pymupdf.open()
    page = doc.new_page(width=PAGE_W, height=PAGE_H)

    elements, params, geometry = [], [], []
    for i, (mark, x0, y0, x1, y1, (tkey, tname, rating, function)) in enumerate(WALLS, start=1):
        page.draw_rect(pymupdf.Rect(x0, y0, x1, y1), color=(0.1, 0.1, 0.1), fill=(0.75, 0.75, 0.75), width=0.8)
        key, eid = f'w{i}', 676280 + i
        elements.append(dict(
            ElementKey=key, ModelKey='demo', Model='Demo Building', LinkInstanceId=None, UniqueId=f'uid-{key}',
            ElementId=eid, Category='Walls', CategoryId=-2000011, Name=tname, Family='Basic Wall', Type=tname,
            TypeKey=f'type-{tkey}', TypeId=1000 + (tkey == 'ext'), Level='GROUND FLOOR', Mark=mark,
            WallFunction=function, FireRating=rating or None, FireRatingSource='Type' if rating else None,
            VersionGuid=f'v-{key}'))
        long_wall = max(x1 - x0, y1 - y0)
        inst = [
            ('Location Line', 'Wall Centerline'), ('Base Constraint', 'GROUND FLOOR'), ('Base Offset', '0\' 0"'),
            ('Base is Attached', 'No'), ('Base Extension Distance', '0\' 0"'), ('Top Constraint', 'Unconnected'),
            ('Unconnected Height', '10\' 0"'), ('Top Offset', '0\' 0"'), ('Top is Attached', 'No'),
            ('Top Extension Distance', '0\' 0"'), ('Room Bounding', 'Yes'), ('Related to Mass', 'No'),
            ('Cross-Section', 'Vertical'), ('Length', f'{round(long_wall / 72 * 12) // 12}\' {round(long_wall / 72 * 12) % 12}"'),
            ('Mark', mark),
        ]
        for n, v in inst:
            params.append(dict(OwnerKey=key, Scope='Instance', Name=n, DisplayValue=v))
        geometry.append(dict(DrawingId='d1', ElementKey=key, MinX=x0, MinY=PAGE_H - y1, MaxX=x1, MaxY=PAGE_H - y0,
                             Outline=outline(x0, y0, x1, y1)))
    for tkey, tname, rating, function in {w[5] for w in WALLS}:
        for n, v in [('Fire Rating', rating or '(none)'), ('Function', function), ('Width', '0\' 4 7/8"'),
                     ('Type Name', tname)]:
            params.append(dict(OwnerKey=f'type-{tkey}', Scope='Type', Name=n, DisplayValue=v))

    for j, (mark, x0, y0, x1, y1) in enumerate(COLUMNS, start=1):
        page.draw_rect(pymupdf.Rect(x0, y0, x1, y1), color=(0.1, 0.1, 0.1), fill=(0.35, 0.35, 0.4), width=0.8)
        key = f'c{j}'
        elements.append(dict(
            ElementKey=key, ModelKey='demo', Model='Demo Building', LinkInstanceId=None, UniqueId=f'uid-{key}',
            ElementId=700100 + j, Category='Structural Columns', CategoryId=-2001330, Name='W12x50',
            Family='W-Wide Flange-Column', Type='W12x50', TypeKey='type-col', TypeId=2000, Level='GROUND FLOOR',
            Mark=mark, WallFunction=None, FireRating=None, FireRatingSource=None, VersionGuid=f'v-{key}'))
        for n, v in [('Base Level', 'GROUND FLOOR'), ('Top Level', 'LEVEL 2'), ('Base Offset', '0\' 0"'),
                     ('Top Offset', '0\' 0"'), ('Mark', mark)]:
            params.append(dict(OwnerKey=key, Scope='Instance', Name=n, DisplayValue=v))
        geometry.append(dict(DrawingId='d1', ElementKey=key, MinX=x0, MinY=PAGE_H - y1, MaxX=x1, MaxY=PAGE_H - y0,
                             Outline=outline(x0, y0, x1, y1)))
    for n, v in [('Section Shape', 'W12x50')]:
        params.append(dict(OwnerKey='type-col', Scope='Type', Name=n, DisplayValue=v))

    if not plain:
        for j, (mark, x, y, width) in enumerate(DOORS, start=1):
            radius = [25.6, 28.8, 33.6, 28.8][j - 1]
            k = 0.55228475  # cubic approximation of the quarter-circle swing
            page.draw_line((x, y), (x, y - radius), color=(0.1, 0.1, 0.1), width=1.5)
            page.draw_bezier((x + radius, y), (x + radius, y - k * radius),
                             (x + k * radius, y - radius), (x, y - radius),
                             color=(0.25, 0.25, 0.25), width=0.7)
            page.draw_circle((x, y), 1.2, color=(0.1, 0.1, 0.1), fill=(0.1, 0.1, 0.1))
            page.insert_text((x - 4, y + 14), mark, fontsize=9)
            key, type_key = f'door-{j}', f'type-door-{j}'
            type_name = f'Single-Flush - {width or "Width unspecified"}'
            elements.append(dict(
                ElementKey=key, ModelKey='demo', Model='Demo Building', LinkInstanceId=None, UniqueId=f'uid-{key}',
                ElementId=710000 + j, Category='Doors', CategoryId=-2000023, Name=type_name,
                Family='Single-Flush', Type=type_name, TypeKey=type_key, TypeId=3000 + j, Level='GROUND FLOOR',
                Mark=mark, WallFunction=None, FireRating=None, FireRatingSource=None, VersionGuid=f'v-{key}'))
            params.append(dict(OwnerKey=key, Scope='Instance', Name='Mark', DisplayValue=mark))
            if width:
                params.append(dict(OwnerKey=type_key, Scope='Type', Name='Width', DisplayValue=width))
            x0, y0, x1, y1 = x - 2, y - radius - 2, x + radius + 2, y + 2
            geometry.append(dict(DrawingId='d1', ElementKey=key, MinX=x0, MinY=PAGE_H - y1, MaxX=x1, MaxY=PAGE_H - y0,
                                 Outline=outline(x0, y0, x1, y1)))

        page.insert_text((140, 510), 'Synthetic doors: D01 32 in | D02 36 in | D03 42 in | D04 width unavailable', fontsize=8)
        page.insert_text((140, 525), 'Try: color walls by fire rating / compare doors at 36 inches / latest comments', fontsize=8)
        reviews = [
            ((270, 220), 'Demo reviewer Alex', 'Synthetic review: Check the D01 door width against the project requirement.', "D:20261114100000-08'00'"),
            ((510, 265), 'Demo reviewer Sam', 'Synthetic review: D03 is 42 inches wide. Confirm the required opening with the design team.', "D:20261114101500-08'00'"),
            ((405, 355), 'Demo reviewer Alex', 'Synthetic review: Interior walls have no exported fire rating. Confirm the rating before review sign-off.', "D:20261114103000-08'00'"),
        ]
        for point, author, content, timestamp in reviews:
            note = page.add_text_annot(point, content)
            note.set_info(title=author, subject='Synthetic demo review', content=content,
                          creationDate=timestamp, modDate=timestamp)
            note.update()

    page.insert_text((140, 105), 'A101 - First Floor Plan (demo data, not a Revit export)', fontsize=12)

    def cols(rows, schema):
        return {name: [r.get(name) for r in rows] for name in schema}

    attach = {
        'drawings.parquet': cols([dict(DrawingId='d1', ParentDrawingId=None, Page=1, Name='A101 - First Floor Plan',
                                       Kind='Sheet')], ['DrawingId', 'ParentDrawingId', 'Page', 'Name', 'Kind']),
        'elements.parquet': cols(elements, elements[0].keys()),
        'appearances.parquet': cols([dict(DrawingId='d1', ElementKey=e['ElementKey'], Source='demo')
                                     for e in elements], ['DrawingId', 'ElementKey', 'Source']),
        'parameters.parquet': cols(params, ['OwnerKey', 'Scope', 'Name', 'DisplayValue']),
        'geometry.parquet': cols(geometry, geometry[0].keys()),
    }
    for name, data in ({} if plain else attach).items():
        doc.embfile_add(name, pq_bytes(data))
    # Extra pages (for testing page navigation): the same walls, shifted, with no attachments of their own.
    for k in range(2, pages + 1):
        extra = doc.new_page(width=PAGE_W, height=PAGE_H)
        for _, x0, y0, x1, y1, _ in WALLS:
            extra.draw_rect(pymupdf.Rect(x0 + 8 * k, y0 + 6 * k, x1 + 8 * k, y1 + 6 * k), color=(0.1, 0.1, 0.1), fill=(0.75, 0.75, 0.75), width=0.8)
        extra.insert_text((140, 105), f'A10{k} - Page {k} (demo data, not a Revit export)', fontsize=12)
    doc.save(path)
    print(f'wrote {path}: {len(elements)} elements, {len(params)} parameters')


if __name__ == '__main__':
    n = int(sys.argv[sys.argv.index('--pages') + 1]) if '--pages' in sys.argv else 1
    main(sys.argv[1], '--plain' in sys.argv, n)
