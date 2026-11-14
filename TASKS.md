# Viewer tasks and ownership

Build on `viewer-v1`. The viewer already uses React, strict TypeScript, Vite, Bun, and PDF.js; no framework migration or React-PDF wrapper is required. Everything remains open source and client-side.

`geometry.parquet` is **not a dependency** for this work. The primary geometry route is native PDF marked content such as `/ViewRegion...` and `/Element...`, joined to the existing BIM attachments. Geometry tables remain an optional compatibility path for older synthetic demos.

## Shared baseline before branching

**Codex owns the shared refactor and final integration.** The shared baseline is on `codex/viewer-layer-refactor`, with a PR targeting `viewer-v1`. Yam can branch from that baseline immediately, or from updated `viewer-v1` after the PR merges. She does not need to implement or repeat the shared refactor.

| ID | Owner | Status | Deliverable and acceptance |
| --- | --- | --- | --- |
| R0 | Codex | Implemented in this PR | Split `PdfStage` into a composition layer, `PdfCanvas`, `ElementOverlay`, and `MarkupLayer`. Existing tools, save/reload, zoom/pan, and selection remain the baseline. Yam can branch from this PR; merge the shared baseline into `viewer-v1` before integrating feature branches. |
| R1 | Codex | Implemented in this PR | Typed page presentation, coordinate conversions, abortable render-capture hooks, and one element-picker interface shared by click selection and annotation auto-ties. The existing saved annotation coordinate format is preserved. |
| R2 | Codex | After both tracks | Integrate Yam's branch; check real native-tag geometry, markups, attachment-preserving export, and page/zoom/rotation behavior together. |

For a new checkout while the shared-baseline PR is open:

```sh
gh repo clone AXELWOHLIN/enhanced_pdfs enhanced_pdfs-yam -- --branch codex/viewer-layer-refactor
cd enhanced_pdfs-yam
git switch -c yam/viewer-markups
cd viewer
bun install --frozen-lockfile
bun run dev
```

After this PR merges, the clone command can use `--branch viewer-v1`. For an existing checkout, use the published refactor branch or update `viewer-v1` to the merged baseline before creating the feature branch. Do not branch from the removed `viewer-v2` branch or the older pre-refactor commit. Open Yam's eventual PR against `viewer-v1`; merge the baseline PR first.

## Yam: markup and review tools

This track can start immediately after R0. Use the synthetic demo and existing shapes while native BIM mapping is developed independently. No task here requires `geometry.parquet` or Codex's completed filter engine.

| ID | Priority | Status | Task and acceptance |
| --- | --- | --- | --- |
| Y1 | P0 | Ready after R0 | Add **arrow** and **revision cloud** tools to the existing annotation model, toolbar, preview, renderer, parser, and PDF save path. Arrow direction remains correct when drawn in either direction; clouds remain closed when resized. Saving and reopening restores the same geometry and optional element tie. |
| Y2 | P0 | Ready after R0 | Improve **text boxes and styles**: multiline text, text size, color, and line weight where applicable. Preserve existing line/text/comment/freehand/highlight/signature behavior and the distinction between tied and untied markups. |
| Y3 | P0 | Ready after R0 | Add **select, move, resize, delete, undo, and redo** for markups. A drag creates one history action; undo/redo restores geometry, styles, text, and element ties. Escape cancels an unfinished gesture without leaving a markup. |
| Y4 | P1 | Ready after R0 | Add **browser-local review recovery** and explicit review import/export. Associate recovery data with an original-file fingerprint so markups are not silently applied to another drawing revision. Handle unavailable browser storage without blocking the viewer. |
| Y5 | P0 | Alongside Y1-Y3 | Extend **standard PDF annotation export and reopen** for new tools and styles. Preserve all original Parquet attachment bytes, existing links/unrelated annotations, and `annotations.json` ties. Verify repeated saves do not duplicate viewer annotations. Check negative/cropped page origins and rotated pages; current save code rejects rotated pages. |

Yam owns:

- `viewer/src/components/patterns/MarkupLayer.tsx`
- `viewer/src/components/patterns/Toolbar.tsx` and `NotesList.tsx`
- `viewer/src/lib/save.ts` and `print.ts`
- New annotation/history/recovery modules and their focused tests

Put history or review state in a new annotation hook/module with a small exported API. Codex wires it into `App.tsx` during integration. Propose changes to shared types or global CSS as a small separate patch instead of editing those files concurrently.

## Codex: real BIM geometry and filters

This track runs in parallel with Yam's work after R0. The existing metadata reader, property panel, annotation tools, and save implementation are starting points, not greenfield features to rebuild.

| ID | Priority | Status | Task and acceptance |
| --- | --- | --- | --- |
| C1 | P0 | Ready after R0 | Replace production **guessed-wall fallback** with native marked-content resolution. Join page/view context and native element IDs through drawing memberships to `ElementKey`. Do not use bare numeric IDs as globally unique or fabricate BIM properties. Report resolved, ambiguous, unsupported, and metadata-only elements separately. |
| C2 | P0 | After C1 | Capture **actual painted paths**, transforms, styles, and clip context while executing the full PDF render. Preserve disconnected strokes and openings; do not manufacture filled wall polygons. Ignore the invisible metadata text as hit geometry. |
| C3 | P0 | Alongside C1-C2 | Build **precise picking and selection**: spatial bounds for candidates, path/stroke tests for final hits, zoom-consistent pointer tolerance, hover, click, and overlap cycling. Reuse the same picker for annotation auto-ties. |
| C4 | P0 | Metadata portion can start after R0 | Add **property filters and result highlights** for category, family, type, level, model, wall function, fire rating, and other exported parameters. OR within a field; AND across fields. Keep Unspecified separate from explicit values such as NR. Show matched element counts separately from locatable appearances. |
| C5 | P0 | Alongside C4 | Extend **results and properties** with drawing/model context, instance/type provenance, and selection synchronization. Metadata-only elements remain inspectable without an invented highlight location. |

Codex owns:

- `viewer/src/components/patterns/PdfStage.tsx`, `PdfCanvas.tsx`, and `ElementOverlay.tsx`
- `viewer/src/lib/presentation.ts`, `types.ts`, `hit.ts`, `load.ts`, and `tables.ts`
- New native-geometry/index/filter modules and filter UI
- `ElementList.tsx`, `PropertiesPanel.tsx`, and BIM-focused tests
- Shared integration in `App.tsx` and global styles

## Contract between the tracks

- **Coordinate spaces:** existing markups use the top-left, scale-1 PDF.js viewport, including page crop and intrinsic rotation. Native PDF geometry retains its original PDF user space. Use the shared forward/inverse matrices; do not implement independent `pageHeight - y` conversions. Device pixel ratio changes canvas backing resolution only.
- **Presentation:** the renderer publishes page identity, transforms, output scale, and render generation. Capture consumers check `RenderCaptureFrame.signal` before publishing asynchronous results. Keep displayed geometry and markups on the same presentation.
- **Rendering:** `PdfCanvas` exposes a capture hook. Observing an operation must still execute it; selected-only replay can drop graphics state or clipping required by later content.
- **Picking:** the element picker returns semantic element hits. Selection and markup auto-ties call that interface rather than keeping separate hit-testing implementations.
- **Interaction:** `MarkupLayer` owns markup creation and annotation pointer targets. It forwards select-mode page gestures for BIM hover/selection. `PdfStage` owns pan and page composition, so a gesture has one owner.
- **State:** filter matches, hover, selected element, selected annotation, and markup history remain distinct. Yam can use deterministic picker fixtures while Codex implements native geometry.
- **Shared files:** Codex integrates `App.tsx`, shared types/presentation contracts, stage wiring, and global CSS. Coordinate interface changes before implementation in both branches.

## Checks before handoff and integration

Run from `viewer/`:

```sh
bun run typecheck
bun run test
bun run build
```

Use browser checks for gestures and rendering, not only unit tests. Check the real Snowdon enhanced PDF without a geometry table, the synthetic enhanced demo, and an ordinary multi-page PDF. Cover zoom, page changes, cancellation, negative page origin, resizing, annotation selection and creation, save/reopen, and original attachment preservation. Report unsupported cases instead of marking them complete.

The native-tag and filter features above are planned work. The shared structural refactor alone does not mean those features or Yam's new tools have been implemented.
