# Viewer tasks and ownership

Build on `viewer-v2`, the current viewer integration branch (cut from `main` after PR #6). The viewer already uses React, strict TypeScript, Vite, Bun, and PDF.js; no framework migration or React-PDF wrapper is required. Everything remains open source and client-side.

`geometry.parquet` is **not a dependency** for this work. The primary geometry route is native PDF marked content such as `/ViewRegion...` and `/Element...`, joined to the existing BIM attachments. Geometry tables remain an optional compatibility path for older synthetic demos.

## Shared baseline before branching

**Codex owns the shared refactor and final integration.** The shared baseline merged into `viewer-v1` in PR #2; `viewer-v1` (including Carlos's BIM work from `codex/carlos-bim-interaction`, PRs #3 and #4) merged into `main` in PR #6, and those branches have been deleted. New feature branches start from `viewer-v2`.

| ID | Owner | Status | Deliverable and acceptance |
| --- | --- | --- | --- |
| R0 | Codex | Merged in PR #2 | Split `PdfStage` into a composition layer, `PdfCanvas`, `ElementOverlay`, and `MarkupLayer`. Existing tools, save/reload, zoom/pan, and selection remain the baseline. The shared baseline is on `main` and `viewer-v2`. |
| R1 | Codex | Merged in PR #2 | Typed page presentation, coordinate conversions, abortable render-capture hooks, and one element-picker interface shared by click selection and annotation auto-ties. The existing saved annotation coordinate format is preserved. |
| R2 | Codex | After both tracks | Integrate Yam's branch; check real native-tag geometry, markups, attachment-preserving export, and page/zoom/rotation behavior together. |

For Yam's new checkout:

```sh
gh repo clone AXELWOHLIN/enhanced_pdfs enhanced_pdfs-yam -- --branch viewer-v2
cd enhanced_pdfs-yam
git switch -c yam/viewer-markups
cd viewer
bun install --frozen-lockfile
bun run dev
```

For an existing checkout, run `git fetch --prune origin` and `git switch viewer-v2` (then `git pull`) before creating the feature branch. Do not branch from the deleted `viewer-v1`, the earlier `viewer-v2` from closed PR #1, or the pre-refactor commit. Feature branches open PRs against `viewer-v2`. Yam's existing `viewer-markups-comment` (PR #5, against `main`) needs the latest `main` merged in to resolve its conflicts.

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
| C1 | P0 | Implemented on Carlos's branch | Replace production **guessed-wall fallback** with native marked-content resolution. Join page/view context and native element IDs through drawing memberships to `ElementKey`. Do not use bare numeric IDs as globally unique or fabricate BIM properties. Report resolved, ambiguous, unsupported, and metadata-only elements separately. |
| C2 | P0 | Implemented on Carlos's branch | Capture **actual painted paths**, transforms, styles, and clip context while executing the full PDF render. Preserve disconnected strokes and openings; do not manufacture filled wall polygons. Ignore the invisible metadata text as hit geometry. |
| C3 | P0 | Implemented on Carlos's branch | Build **precise picking and selection**: spatial bounds for candidates, path/stroke tests for final hits, zoom-consistent pointer tolerance, hover, click, and overlap cycling. Reuse the same picker for annotation auto-ties. |
| C4 | P0 | Implemented on Carlos's branch | Add **property filters and result highlights** for category, family, type, level, model, wall function, fire rating, and other exported parameters. OR within a field; AND across fields. Keep Unspecified separate from explicit values such as NR. Show matched element counts separately from locatable appearances. |
| C5 | P0 | Implemented on Carlos's branch | Extend **results and properties** with drawing/model context, instance/type provenance, and selection synchronization. Metadata-only elements remain inspectable without an invented highlight location. |
| C6 | P0 | Implemented on Carlos's branch | Add **Locate on drawing** and **Fit filtered results** using existing captured bounds. Center after the requested zoom is applied, retain drawing context, and disable Locate for metadata-only/unmapped records. Cancel pending focus on file, page, filter, or manual navigation changes. |
| C7 | P0 | Implemented on Carlos's branch | Add **Drawing / view** filters keyed by stable DrawingId. Keep matching elements, located appearances, picking, highlights, and focus bounds in the same drawing scope, including repeated elements across views. |

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

## BIM milestone validation

C1-C5 merged into `viewer-v1` in PR #3, and C6-C7 in PR #4; all of it reached `main` in PR #6. The original Snowdon A101 enhanced PDF, without a geometry table, resolves 1,237 native groups into 1,099 elements and captures 18,123 painted path parts. Wall 676281 retains its eight disconnected strokes; its opening is not a wall hit.

Browser checks on that actual file passed for picking, zoom/pan, overlap cycling, and Walls + Exterior + 2 HR filtering (16 matched, 16 locatable). Planting returns 117 metadata records with 13 locatable appearances; the remaining records stay inspectable without invented locations. A note tied to real wall 676281 survived PDF save/reopen, and all five original Parquet attachments remained byte-identical.

Drawing/view checks on the same actual PDF passed: L1 has 1,090 matched and located elements; selecting Planting Schedule returns 117 metadata members and zero located appearances, without borrowing the 13 plan locations. Metadata-only Locate and zero-result Fit are disabled. Locate wall 676281 centers its real printed edges with a 200% zoom cap. Fit filtered results frames the 16 rated exterior walls; a subsequent manual zoom remains unchanged after recapture. These actions use current-page captured geometry; selecting a result can first navigate to its declared page.

Capture reports unsupported text/image or complex compositing paints instead of assigning guessed hit areas. This is native printed-path selection, not reconstructed solid wall footprints or a full composited-pixel mask. Rotation/crop transforms are unit-tested; broader PDF types and Yam's rotated-page export work remain integration checks. Yam's new markup features and R2 remain separate tasks.

## Browser upgrade of existing PDF markups

Codex owns `codex/browser-comment-upgrade`, based on current `main` per the hackathon demo request. The browser imports native review markups and replies, reads plugin links, and matches pending notes across annotated pages. Uncertain geometry matches require review; text references stay separate. Native graphics and Parquet bytes remain intact. Browser links live in `annotations.json`; plugin tables are preserved rather than rewritten. Exact ownership replaces prefix-based removal, and recovery tracks intentional imported-note deletions.

Validated in the browser with a test copy of the actual Snowdon A101 enhanced PDF containing four clearly labeled external demo markups. Two matched automatically; the arrow was manually linked to Door 745963 and received a reply. Saving, reopening, session recovery, and agent comment context retain four roots and one reply without duplicates. The saved PDF renders pixel-identically to the input, and all five original Parquet attachments are byte-identical. A separate explicit-deletion check removes only the chosen markup and its thread. The original downloaded drawing is unchanged.

Integration with current main retains browser message editing, hover previews, category labels, and markup Parquet export. Native source messages stay read-only; new browser replies remain editable. Imported marks export as comment review pins with approved links and replies, with tested crop/rotation/UserUnit transforms. The merged Snowdon save/reopen proof preserves source graphics and model attachments and verifies the new Parquet review rows and resolved Door 745963 link. All 395 tests and the production build pass.

## Comment upgrade acceptance and Bedrock demo

`codex/accept-comment-upgrades` follows merged PR #20. Geometry matches stay in `source.suggestedElementKeys` until the reviewer chooses **Accept upgrade**; unaccepted proposals have no active object links and no Parquet link rows. Manual/plugin links stay confirmed, and older automatic geometry links migrate to proposals. The actual browser Accept/download/reopen workflow preserves seven accepted rectangle links, two unaccepted ink suggestions, the existing door link/reply, original native rendering, and all five model attachments.

The local drawing agent now supports Amazon Bedrock Converse with server-only bearer credentials and explicit provider/region/model configuration. Live tests in `us-east-1` with `us.anthropic.claude-opus-5-5` passed for a 36-inch door comparison and a 42-inch follow-up on the actual drawing. The credential file is ignored/untracked; the client build and public status response contain no key. The local proxy keeps its loopback restriction; hosted authentication/deployment remains separate. Updated home copy removes the comments preset and local setup instructions. All 454 tests and the production build pass.

## General drawing-agent workspace

PR #22 expands the agent beyond the original wall/door examples. Category highlighting covers all actual exported categories, including both Columns and Structural Columns. A bounded eight-round tool loop can inspect the available properties, query/filter/group real records with unit and provenance checks, and highlight/select/focus complete local result sets. Full memberships stay in browser result handles even when model-visible rows are truncated. Selection keeps requested highlight colors visible.

Viewer actions include fit/zoom, page navigation, opening comment threads, and explicitly requested comment/reply creation or PDF download. Scoped key validation, write deduplication, completed-action receipts, cancellation, and stale-context checks protect composed operations. Native comment-upgrade acceptance remains a separate reviewer action. Requested bounded property/comment observations now go to the configured provider; PDF bytes and complete tables remain local.

All 543 automated tests pass, covering generic category actions, property/unit queries, local result handles, multi-step selection and coloring, bounded untrusted observations, explicit writes, duplicate prevention, cancellation, and scope changes. The production build and live local Bedrock door-comparison smoke test pass. Additional browser checks were skipped at the user's request.
