# Viewer design system

Follows shadcn/ui's zinc theme for now. `src/styles/tokens.css` uses shadcn's own variable names (`--background`, `--primary`, `--muted`, `--accent`, `--border`, `--ring`, `--radius`, ...) in light and dark, so real shadcn components can replace ours later. Real shadcn needs Tailwind, which the viewer doesn't use yet, so `src/styles/app.css` recreates the button, tabs, input, badge, checkbox, popover and dropdown-item styles by hand. Components never hard-code a color.

| Layer | Folder | Rule |
| --- | --- | --- |
| Primitives | `src/components/ui/` | `Button`, `IconButton`, icons. No app state. |
| Patterns | `src/components/patterns/` | Toolbar, PdfStage, PropertiesPanel, ElementList, NotesList, HoverCard. Props in, events out. |
| Logic | `src/lib/` | Pure functions (hit-testing, table parsing, grouping) with tests in `tests/`. |

## Meaning of color

- `--element`: an element of the Revit model (hover and selection highlight). Not shadcn's `--accent`, which is a neutral gray.
- `--tied`: an annotation anchored to an element. Solid line, chip reads `↳ <mark>`.
- `--untied`: an annotation on empty paper. Dashed line, chip reads `untied`.

The PDF page is always white, so annotation ink is a fixed dark color in both themes. Tied versus untied is the main thing the annotation tools communicate, so it never relies on color alone (dash and label also differ).

## Properties panel

Mirrors Revit's Properties palette: family and type header, `<Category> (1)`, then groups of label/value rows. Yes/No parameters render as checkboxes. Groups are guessed from parameter names in `src/lib/groups.ts` until the add-in exports Revit's parameter groups.
