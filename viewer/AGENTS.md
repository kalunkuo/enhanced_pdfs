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

The viewer reads the Parquet attachments the add-in already writes (`elements`, `parameters`, `drawings`, `appearances`). **Do not require `geometry.parquet` or an exporter change for element interaction.** The primary route indexes native PDF marked-content groups (`/ViewRegion...`, `/Element...`), resolves them through drawing membership, and captures actual painted paths. Track work and branch ownership in [`../TASKS.md`](../TASKS.md).

`nativeTags.ts` resolves identities; `nativeGeometry.ts` captures paths and clips from a complete main-thread render and builds a Flatbush/Path2D picker. Unresolved/ambiguous identities and unsupported graphics remain explicit. Capture must index the exact operator list for the render's annotation mode and honor its abort signal before publishing.

The loader also accepts optional `geometry.parquet` for compatibility with the synthetic demo, one row per element drawn on the page:

| Column | Type | Meaning |
| --- | --- | --- |
| `DrawingId` | string | Matches `drawings.DrawingId`. |
| `ElementKey` | string | Matches `elements.ElementKey`. |
| `MinX`, `MinY`, `MaxX`, `MaxY` | double | Bounding box in PDF points, origin bottom-left. |
| `Outline` | string, optional | JSON `[[x,y],...]` polygon in the same space. Used for hit-testing when present. |

`scripts/make-demo-pdf.py` writes a synthetic PDF with this optional table (`public/demo/demo-enhanced.pdf`); its data is made up. Its legacy geometry conversion assumes the simple demo frame; use the shared viewport transformations for native PDF geometry, including cropped and negative-origin pages.

## Ordinary PDFs and unsupported graphics

Production loading never invents walls, element IDs, or properties. Ordinary PDFs remain viewable and annotatable with no model identities. Metadata-only records remain searchable and inspectable without an invented location. The old `placeholderWalls.ts` algorithm remains only as a legacy reference with tests; `load.ts` does not call it.

Native capture supports bounded Path2D fills/strokes and explicit clips on the base rendering context. Text/images without supported path bounds, patterns, unknown clipping, and offscreen compositing are not assigned invented hit areas. Preserve disconnected strokes and openings; do not close a wall's printed edges into a filled footprint.

## Layers and parallel ownership

Codex owns the shared refactor and integration on `viewer-v1`. Yam branches from its published shared baseline for annotation/review tools. See `../TASKS.md` for file ownership, task acceptance criteria, and the integration sequence.

- `PdfStage` composes the page, handles pan/zoom, and routes non-markup selection.
- `PdfCanvas` owns PDF rendering, cancellation, presentation, and the render-capture hook.
- `NativeElementOverlay` draws filter matches, hover, and selection from captured native paths. `ElementOverlay` remains the optional legacy geometry-table adapter; the semantic module owns picking.
- Drawing/view filters use stable `DrawingId` membership. Apply the same scope to picking, highlights, coverage, appearance counts, and focus bounds; never borrow an element's plan ink to locate its schedule membership.
- `navigation.ts` fits existing page-space bounds. `PdfStage` applies a focus request after zoom layout, at most once per request. Preserve padding/centering, exclude DPR from scroll math, and cancel stale requests when the user changes context or navigates manually.
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
