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

The viewer reads the Parquet attachments the add-in already writes (`elements`, `parameters`, `drawings`, `appearances`). **Do not require `geometry.parquet` or an exporter change to build element interaction.** The planned primary route uses the native PDF marked-content groups (`/ViewRegion...`, `/Element...`) and actual painted paths, joined to these BIM tables. Track this work and branch ownership in [`../TASKS.md`](../TASKS.md).

Native-tag mapping is not implemented by the structural layer refactor alone. Until that adapter lands, the loader's existing behavior is the optional geometry-table path or the explicitly labeled placeholder fallback below. Keep the runtime status accurate.

The loader also accepts optional `geometry.parquet` for compatibility with the synthetic demo, one row per element drawn on the page:

| Column | Type | Meaning |
| --- | --- | --- |
| `DrawingId` | string | Matches `drawings.DrawingId`. |
| `ElementKey` | string | Matches `elements.ElementKey`. |
| `MinX`, `MinY`, `MaxX`, `MaxY` | double | Bounding box in PDF points, origin bottom-left. |
| `Outline` | string, optional | JSON `[[x,y],...]` polygon in the same space. Used for hit-testing when present. |

`scripts/make-demo-pdf.py` writes a synthetic PDF with this optional table (`public/demo/demo-enhanced.pdf`); its data is made up. Its legacy geometry conversion assumes the simple demo frame; use the shared viewport transformations for native PDF geometry, including cropped and negative-origin pages.

## Placeholder walls (temporary)

The current fallback in `src/lib/placeholderWalls.ts` guesses walls from the drawing: filled, thin, long quadrilaterals (not white), read from pdf.js's operator list. Each gets made-up data (`Wall 01`, ID 900001, demo parameters) flagged `placeholder: true`; the UI shows a "Placeholder data" badge. These are demo guesses, not verified Revit element identities or properties. Replace the production fallback with native-tag mapping under task C1; do not wait for a geometry-table export. `scripts/make-demo-pdf.py ... --plain` writes a drawing with no attachments to test the current fallback.

## Layers and parallel ownership

Codex owns the shared refactor and integration on `viewer-v1`. Yam branches from its published shared baseline for annotation/review tools. See `../TASKS.md` for file ownership, task acceptance criteria, and the integration sequence.

- `PdfStage` composes the page, handles pan/zoom, and routes non-markup selection.
- `PdfCanvas` owns PDF rendering, cancellation, presentation, and the render-capture hook.
- `ElementOverlay` displays BIM hover/selection; the semantic module owns element picking.
- `MarkupLayer` owns annotation rendering, draft/editor state, and creation gestures. It forwards select-mode page gestures to the shared picker.
- Shared contracts live in `src/lib/presentation.ts`. Existing markup coordinates remain the scale-1 PDF.js viewport (top-left); native PDF geometry uses explicit forward/inverse transforms. Do not silently migrate saved annotation coordinates.
- Observe PDF operations without skipping graphics-state, path, or clipping operations. Keep canvas backing scale separate from page/CSS coordinates.

## Annotations and object IDs

Every annotation carries an optional `elementKey` (the object ID). It is set automatically from the element under the annotation's anchor point, and can be changed or cleared in the Notes tab ("Object ID" select).

## Gotchas

- pdf.js v6 `getAttachments()` returns names only. Bytes come from `getAttachmentContent(name)`.
- Open text editors on `click`, not `pointerdown`, or the trailing focus change closes them.
- The add-in writes gzip Parquet; `hyparquet-compressors` is required.
- Missing native tags, ambiguous model identities, and unsupported paint types must remain explicit statuses; do not invent an authoritative geometry mapping.
