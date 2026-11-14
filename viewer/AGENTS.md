# Enhanced PDF Viewer

Browser app (React, TypeScript, Vite) that opens an enhanced PDF from the Revit add-in, lets you hover and click elements on the drawing, and annotate it. Everything runs client-side. Design rules: `docs/design-system.md`.

```sh
bun install
bun run dev        # http://localhost:5313, or DEV_PORT=NNNN bun run dev
bun run typecheck
bun run test
```

Use `bun`, not npm.

## Data contract

The viewer reads the Parquet attachments the add-in already writes (`elements`, `parameters`, `drawings`, `appearances`). Hover and click need one more table that the add-in **does not export yet**:

`geometry.parquet`, one row per element drawn on the page:

| Column | Type | Meaning |
| --- | --- | --- |
| `DrawingId` | string | Matches `drawings.DrawingId`. |
| `ElementKey` | string | Matches `elements.ElementKey`. |
| `MinX`, `MinY`, `MaxX`, `MaxY` | double | Bounding box in PDF points, origin bottom-left. |
| `Outline` | string, optional | JSON `[[x,y],...]` polygon in the same space. Used for hit-testing when present. |

Without it the viewer still opens the PDF and falls back to placeholder walls (below), with a banner saying so. `scripts/make-demo-pdf.py` writes a synthetic PDF with this table (`public/demo/demo-enhanced.pdf`); its data is made up.

## Placeholder walls (temporary)

With no `geometry` table, `src/lib/placeholderWalls.ts` guesses walls from the drawing: filled, thin, long quadrilaterals (not white), read from pdf.js's operator list. Each gets made-up data (`Wall 01`, ID 900001, demo parameters) flagged `placeholder: true`; the UI shows a "Placeholder data" badge. When the add-in exports `geometry`, those rows are used instead and this code path goes unused. `scripts/make-demo-pdf.py ... --plain` writes a drawing with no attachments to test it.

## Annotations and object IDs

Every annotation carries an optional `elementKey` (the object ID). It is set automatically from the element under the annotation's anchor point, and can be changed or cleared in the Notes tab ("Object ID" select).

## Gotchas

- pdf.js v6 `getAttachments()` returns names only. Bytes come from `getAttachmentContent(name)`.
- Open text editors on `click`, not `pointerdown`, or the trailing focus change closes them.
- The add-in writes gzip Parquet; `hyparquet-compressors` is required.
