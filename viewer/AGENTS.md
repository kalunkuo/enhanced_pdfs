# Enhanced PDF Viewer

Browser app (React, TypeScript, Vite) that opens an enhanced PDF from the Revit add-in, lets you hover and click elements on the drawing, and annotate it. Everything runs client-side. Design rules: `docs/design-system.md`.

The optional drawing-agent API is the exception: provider modules in `server/` and `server/agentMiddleware.ts` run only in the local Vite dev/preview server. `AGENT_PROVIDER` selects `bedrock` or `openai`; without it, a Bedrock bearer token or model setting selects Bedrock, otherwise OpenAI. Bedrock uses `AWS_BEARER_TOKEN_BEDROCK`, matching `AWS_REGION`, and `BEDROCK_MODEL_ID`; it accepts an API bearer token, not an AWS access-key pair. OpenAI keeps `OPENAI_API_KEY` and `OPENAI_MODEL`. Credentials come from ignored `.env.local` or server environment variables, never `VITE_*`, browser code, or storage. Status exposes only configured/provider/model. Only prompts, bounded conversation history, and aggregate page counts go to the model; actual drawing actions execute against current client-side data through `src/lib/agentApi.ts`. Bedrock Converse uses standard tool requests; both server and browser must validate returned actions independently of provider schema enforcement. Missing credentials keep Local demo available. API failures must stay explicit rather than silently changing modes. See `README.md` for setup.

```sh
bun install
bun run dev        # http://localhost:5313, or DEV_PORT=NNNN bun run dev
bun run typecheck
bun run test
```

Use `bun`, not npm.

## Design system implementation

The default screen is the functional viewer in `src/App.tsx`. Keep PDF loading, rendering, native geometry capture, Parquet lookup, annotation coordinates, filtering, and save/print behavior intact when changing the visual system. Do not restore the former test frontend or sample data as the application entry point.

- `src/styles/tokens/primitives.css`: raw palette, Manrope scale, spacing, 6px radius, and motion values. Add literals here when a reusable foundation is needed.
- `src/styles/tokens/semantic.css`: app roles such as canvas, text, blue primary, red secondary, review status, and geometry accents. View and pattern styles should use these roles.
- `src/styles/tokens/components.css`: values shared by controls, menus, comments, toolbars, and viewer chrome. Add a component token when a value coordinates variants or states.
- `src/styles/tokens.css`: import entry point and local Manrope font face. Import once in `src/main.tsx`, followed by `src/styles/typography.css`, `src/components/ui/icon-button.css`, `src/components/ui/kit.css`, and `src/styles/app.css`.
- `src/components/ui/`: reusable React/TypeScript controls and SVG icons; `src/components/ui/index.ts` exports the design kit. `src/components/ui/Button.tsx` adapts the viewer's existing button API to the kit. Keep accessible names on icon-only actions.
- `src/components/patterns/`: viewer compositions and interaction state. Use the shared tokens and controls here without replacing specialized PDF behavior with a generic demo control.
- `docs/component-standards/`: anatomy, variants, states, accessibility, and interaction rules for each reusable control. `docs/screen-examples/` describes composition.

Chrome is off-black with white Manrope text. Blue is primary, red secondary, and pink/green/yellow are contextual accents. The PDF raster retains its document colors. Compact icon buttons are 24px with a 6px radius, transparent/white at rest and white/off-black on hover. Button state transitions are 500ms; action buttons scale to 0.97 on press. Segmented-control indicators slide between options over 300ms with an ease-in-out arc, never linear. Menus enter with ease-out scale/fade from the trigger focal point, rows reveal over 150ms with 30ms stagger, and exit is 400ms. Respect reduced motion. Treat the annotation ink palette as document data; changing it would alter saved PDF output.

## Data contract

The viewer reads the Parquet attachments the add-in already writes (`elements`, `parameters`, `drawings`, `appearances`). **Do not require `geometry.parquet` or an exporter change for element interaction.** The primary route indexes native PDF marked-content groups (`/ViewRegion...`, `/Element...`), resolves them through drawing membership, and captures actual painted paths. Track work and branch ownership in [`../TASKS.md`](../TASKS.md).

`nativeTags.ts` resolves identities; `nativeGeometry.ts` captures paths and clips from a complete main-thread render and builds a Flatbush/Path2D picker. Unresolved/ambiguous identities and unsupported graphics remain explicit. Capture must index the exact operator list for the render's annotation mode and honor its abort signal before publishing.

Existing standard PDF review marks are imported by `importPdfAnnotations.ts` as comments with source provenance. Preserve native graphics and attachments; use `annotations.json` for browser links and review state. Native root/reply text stays read-only; new browser replies remain editable. The viewer's markup Parquet export represents imported records as comment review pins, retaining links and replies without reconstructing the native shapes. `upgradeDocumentAnnotations.ts` matches pending notes across all annotated pages with bounded sequential native capture. Only pending results may merge into current state, so background work cannot overwrite manual links, replies, or deletions. Text references are separate from geometry links. Keep uncertain matches explicit. Ownership and source identity use `pdfAnnotationOwnership.ts`; never remove or hide annotations by a blanket `ep-` prefix. Session import inventories distinguish old recovery states from intentional source deletions.

Geometry matches are proposals: `source.linkState='suggested'` and `source.suggestedElementKeys` hold them without active `elementKey`/`elementKeys`. **Accept upgrade** confirms links as `linked`/`manual` and clears proposal fields. Unaccepted proposals must never appear in the active object-link export. `normalizeImportedSuggestion` migrates legacy automatic geometry links during import/recovery; confirmed manual and plugin links remain accepted. Review selection/hover may preview proposed keys without writing annotation links.

The loader also accepts optional `geometry.parquet` for compatibility with the synthetic demo, one row per element drawn on the page:

| Column | Type | Meaning |
| --- | --- | --- |
| `DrawingId` | string | Matches `drawings.DrawingId`. |
| `ElementKey` | string | Matches `elements.ElementKey`. |
| `MinX`, `MinY`, `MaxX`, `MaxY` | double | Bounding box in PDF points, origin bottom-left. |
| `Outline` | string, optional | JSON `[[x,y],...]` polygon in the same space. Used for hit-testing when present. |

### Saved review data (for Revit import)

Download (Ctrl+S) writes standard PDF annotations, the lossless `annotations.json` the viewer restores from, and three Parquet tables for a Revit import (`src/lib/markupTables.ts`). They follow the add-in's conventions (PascalCase columns, `ElementKey`/`DrawingId` join keys, ISO 8601 UTC strings, `SchemaVersion`). Required columns are written non-nullable, so they deserialize into C# non-nullable record fields; the rest are optional. Coordinates are PDF user-space points with the origin at the bottom left, crop box applied, the same space as `geometry.parquet`. Each save replaces earlier copies, and the tables are left out when there are no markups.

| File | Row | Columns |
| --- | --- | --- |
| `markups.parquet` | one per annotation | `MarkupId`, `Page`, `DrawingId`/`ViewId`/`ViewUniqueId` (page's root drawing), `Kind`, `RevitKind` (hint: `DetailLine`, `TextNote`, `RevisionCloud`, ...), `Text`, `Author`, `CreatedUtc`, `ModifiedUtc`, `Color`, `MinX`/`MinY`/`MaxX`/`MaxY`, `AnchorX`/`AnchorY`, `Points` (JSON `[[x,y],...]`), `ElementKey` (first link), `LinkCount`, `ReplyCount`, `HasImage`, `SchemaVersion` |
| `markup-links.parquet` | one per referenced element | `MarkupId`, `Ordinal`, `ElementKey`, `Relation` (`Linked`, or `Contained`/`Overlaps` for revision clouds), `DrawingId` (viewport on that page), `ModelKey`, `UniqueId`, `ElementId`, `LinkInstanceId`, `Category`, `Resolved` (false when the key is not in `elements`) |
| `markup-replies.parquet` | one per reply | `MarkupId`, `ReplyId`, `Ordinal`, `Author`, `CreatedUtc`, `Text`, `HasImage` |

Image data URLs stay in `annotations.json` only. Add columns rather than changing existing ones, and bump `MARKUP_SCHEMA_VERSION` for breaking changes.

`scripts/make-demo-pdf.py` writes a synthetic PDF with this optional table (`public/demo/demo-enhanced.pdf`); its data is made up. Its legacy geometry conversion assumes the simple demo frame; use the shared viewport transformations for native PDF geometry, including cropped and negative-origin pages.

## Ordinary PDFs and unsupported graphics

Production loading never invents walls, element IDs, or properties. Ordinary PDFs remain viewable and annotatable with no model identities. Metadata-only records remain searchable and inspectable without an invented location. The old `placeholderWalls.ts` algorithm remains only as a legacy reference with tests; `load.ts` does not call it.

Native capture supports bounded Path2D fills/strokes and explicit clips on the base rendering context. Text/images without supported path bounds, patterns, unknown clipping, and offscreen compositing are not assigned invented hit areas. Preserve disconnected strokes and openings; do not close a wall's printed edges into a filled footprint.

## Layers and parallel ownership

Codex owns the shared refactor and integration on `viewer-v2` (cut from `main` after `viewer-v1` merged in PR #6). Feature branches, including Yam's annotation/review tools, start from `viewer-v2` and open PRs against it. See `../TASKS.md` for file ownership, task acceptance criteria, and the integration sequence.

- `PdfStage` composes the page, handles pan/zoom, and routes non-markup selection.
- `PdfCanvas` owns PDF rendering, cancellation, presentation, and the render-capture hook. It renders a full-page base raster capped at ~4 MP (this is the capture render, so its scale stops changing once zoom passes the cap), plus a full-resolution detail tile covering only the visible area and 10% margin, re-rendered after scroll/zoom settles. Do not go back to rasterizing the whole page at zoom × DPR.
- `NativeElementOverlay` draws filter matches, hover, and selection from captured native paths. Selection is a set: one picked element, several (Select similar, or a note linked to several objects), or every filter match (filtering selects all matches until something is picked). `PropertiesPanel` merges the selection's parameters via `src/lib/selection.ts`, showing shared values and "Varies" otherwise. `ElementOverlay` remains the optional legacy geometry-table adapter; the semantic module owns picking.
- Drawing/view filters use stable `DrawingId` membership. Apply the same scope to picking, highlights, coverage, appearance counts, and focus bounds; never borrow an element's plan ink to locate its schedule membership.
- `navigation.ts` fits existing page-space bounds. `PdfStage` applies a focus request after zoom layout, at most once per request. Preserve padding/centering, exclude DPR from scroll math, and cancel stale requests when the user changes context or navigates manually.
- `MarkupLayer` owns annotation rendering, draft/editor state, and creation gestures. It forwards select-mode page gestures to the shared picker.
- Shared contracts live in `src/lib/presentation.ts`. Existing markup coordinates remain the scale-1 PDF.js viewport (top-left); native PDF geometry uses explicit forward/inverse transforms. Do not silently migrate saved annotation coordinates.
- Observe PDF operations without skipping graphics-state, path, or clipping operations. Keep canvas backing scale separate from page/CSS coordinates.

## Annotations and object IDs

Every annotation carries an optional `elementKey` (the object ID). It is set automatically from the element under the annotation's anchor point, and can be changed or cleared in the Notes tab ("Object ID" select).

An annotation can link to several objects: `elementKeys` lists them all, and `elementKey` stays equal to its first entry so single-tie readers keep working. Read links through `linkedKeys` and write them through `withLinks` (`src/lib/links.ts`). A note linked to several objects keeps its links when it is dragged; re-tying it to one object in the Notes tab replaces them. Revision clouds keep their own `contained` list.

With elements selected in the select tool, `SelectionActions` pins a small bar under the selection's bottom-right corner (above the top-right corner near the page bottom; comment pins use the top edge). **Select similar** adds every element on this page and drawing scope that shares a type (`typeIdentity` in `src/lib/selection.ts`: the exported `TypeKey`, else category + family + type). **Comment** opens the composer at the selection's top-right corner, and the comment links to every selected element.

## Session recovery

`src/lib/session.ts` keeps the open file and review state in IndexedDB so a reload reopens where the user left off: annotations, page, selection, filters, zoom mode, inspector tab, draw kind, and highlight color. State is keyed to the file's SHA-256 fingerprint and discarded on mismatch; opening a new file replaces the remembered one. Storage failures show a status line and never block viewing. Add new persisted fields to `SessionState` and `parseSessionState`, which validates each field and falls back to defaults.

## Gotchas

- pdf.js v6 `getAttachments()` returns names only. Bytes come from `getAttachmentContent(name)`.
- Open text editors on `click`, not `pointerdown`, or the trailing focus change closes them.
- The add-in writes gzip Parquet; `hyparquet-compressors` is required.
- Missing native tags, ambiguous model identities, and unsupported paint types must remain explicit statuses; do not invent an authoritative geometry mapping.
