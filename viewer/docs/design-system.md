# Viewer design system

Follows shadcn/ui's zinc theme for now. `src/styles/tokens.css` uses shadcn's own variable names (`--background`, `--primary`, `--muted`, `--accent`, `--border`, `--ring`, `--radius`, ...) in light and dark, so real shadcn components can replace ours later. Real shadcn needs Tailwind, which the viewer doesn't use yet, so `src/styles/app.css` recreates the button, tabs, input, badge, checkbox, popover and dropdown-item styles by hand. Components never hard-code a color.

| Layer | Folder | Rule |
| --- | --- | --- |
| Primitives | `src/components/ui/` | `Button`, `IconButton`, icons. No app state. |
| Patterns | `src/components/patterns/` | Toolbar, PdfStage, PropertiesPanel, ElementList, NotesList, HoverCard. Props in, events out. |
| Logic | `src/lib/` | Pure functions (hit-testing, table parsing, grouping) with tests in `tests/`. |

## Page composition and interaction

`PdfStage` composes `PdfCanvas`, `ElementOverlay`, and `MarkupLayer`. Keep base rendering, BIM emphasis, and editable review marks separate so filters can update highlights without rerendering the PDF. The shared renderer and coordinate contracts live in `src/lib/presentation.ts`.

`MarkupLayer` hosts the SVG interaction surface and annotation editor. Annotation targets handle annotation selection; select-mode page gestures are forwarded for semantic element picking. Pan belongs to `PdfStage`. A pointer gesture must have one owner, so drawing a markup does not also select or pan the model.

Existing review coordinates use the scale-1 PDF.js viewport, with a top-left origin. Native PDF paths retain PDF user coordinates and pass through the shared transform. The same presentation generation must align the base raster, highlights, pointer conversions, and markups. Device pixel ratio affects raster backing size rather than stored markup positions.

Codex owns shared stage integration and BIM interaction; Yam owns markup/review tools after the baseline refactor. See [`../../TASKS.md`](../../TASKS.md) before changing a shared component or global style.

## Meaning of color

- `--element`: an element of the Revit model (hover and selection highlight). Not shadcn's `--accent`, which is a neutral gray.
- `--tied`: an annotation anchored to an element. Solid line, chip reads `↳ <mark>`.
- `--untied`: an annotation on empty paper. Dashed line, chip reads `untied`.

The PDF page is always white, so annotation ink is a fixed dark color in both themes. Tied versus untied is the main thing the annotation tools communicate, so it never relies on color alone (dash and label also differ).

## Properties panel

Mirrors Revit's Properties palette: family and type header, `<Category> (1)`, then groups of label/value rows. Yes/No parameters render as checkboxes. Groups are guessed from parameter names in `src/lib/groups.ts` until the add-in exports Revit's parameter groups.
