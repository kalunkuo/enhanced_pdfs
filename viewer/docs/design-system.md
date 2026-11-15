# Enhanced PDF viewer design system

## Purpose

The functional React/TypeScript viewer displays a PDF and connects its element geometry to attached Parquet specifications. Application chrome uses an off-black canvas, white Manrope text, bright blue primary actions, bright red secondary emphasis, and pink, green, and yellow for contextual features. The PDF raster keeps its original colors and typography. Geometry outlines and annotations occupy separate layers aligned to document coordinates. Annotations are drawn in the secondary red (`--color-annotation`) and turn gray when they are not tied to an object.

## Three token tiers

Import `src/styles/tokens.css` once before component styles. Tokens flow from primitives to semantics to components.

| Tier | Location | Purpose |
| --- | --- | --- |
| Primitive | `src/styles/tokens/primitives.css` | Literal palette, type scale, spacing, sizes, radius, and motion |
| Semantic | `src/styles/tokens/semantic.css` | Canvas, surface, text, focus, status, geometry, and accent roles |
| Component | `src/styles/tokens/components.css` | Button, menu, field, comment, toolbar, panel, and viewer chrome values |

Use semantic roles in screens and patterns. Add a component token when variants or states must stay coordinated. Add a primitive when a literal becomes a reusable foundation. The literal PDF annotation ink colors in `Toolbar.tsx` are saved document data and should not be changed by a theme update.

## Color and typography

| Role | Token | Value |
| --- | --- | --- |
| Canvas | `--color-canvas` | `#111315` |
| Surface | `--color-surface` | `#1b1e20` |
| Raised surface | `--color-surface-raised` | `#292d30` |
| Primary text | `--color-text` | `#ffffff` |
| Muted text | `--color-text-muted` | `#cccccc` |
| Primary blue | `--color-primary` | `#31c6e8` |
| Secondary red | `--color-secondary` | `#ff4b5c` |
| Tertiary pink | `--color-tertiary-pink` | `#f4a7e9` |
| Tertiary green | `--color-tertiary-green` | `#1bb574` |
| Tertiary yellow | `--color-tertiary-yellow` | `#efb12f` |

The bundled variable Manrope font is in `src/assets/fonts/`. UI body text is 14px with 1.5 line height; labels are 13px. Use 11px only for compact metadata. Spacing uses 4px steps, common gaps are 8px, panel padding is 16px, and the shared control radius is 6px. Type styles live in `src/styles/typography.css` and leave margins to layout.

| Style | Size / line height | Weight | Use |
| --- | --- | --- | --- |
| Title `.type-title` | 36px / 43.2px | 700 | Workspace title |
| Heading 1 `.type-h1` | 28px / 33.6px | 700 | Main screen or dialog |
| Heading 2 `.type-h2` | 24px / 28.8px | 700 | Major section |
| Heading 3 `.type-h3` | 18px / 21.6px | 600 | Panel heading |
| Paragraph `.type-paragraph` | 14px / 21px | 400 | Standard body copy |

Use semantic heading levels in the DOM even when a different visual type class fits the layout. Do not retype PDF page content.

## Controls and motion

Compact icon buttons have a 24 by 24px visual box, 16px SVG glyph, and 6px radius. At rest they have a transparent background and white glyph; on hover and while pressed they use a white background and off-black glyph. Use clear vector strokes and `currentColor`; provide an accessible name for each icon-only action. Keyboard focus has a 2px blue outline with 2px offset. A touch-first surface needs a separate 44px hit target around the visual button.

Toolbars (`--toolbar-*` in `components.css`) use 4px container padding and 8px gaps; the horizontal document bar uses 8px block padding (`--docbar-padding-block`) so its row breathes slightly more. Inline toolbar controls such as the page field and zoom-level menu match the 24px icon-button height; text action buttons in the header and document bar are 32px (`--toolbar-action-height`). The vertical tool rail is one icon button wide plus padding and border. The document bar ends with the demo drawing action, then the primary upload action, at the far right. Opening a file shows a non-dismissible progress dialog (see `component-standards/progress-bar.md`).

Button on/off transitions take 500ms. Action buttons scale to 0.97 on press; toolbar buttons and menu closes do not. Menus use an ease-out scale/fade from the trigger focal point for 500ms on open and 400ms on close. Menu rows reveal over 150ms, staggered by 30ms. Movement between positions, such as a segmented control's selected indicator, slides over 300ms on an arc speed curve (`--ease-slide`, ease-in-out: accelerate, then decelerate), never linearly. Options become inactive as closing starts. Respect `prefers-reduced-motion`. Shared menu tokens are in `components.css`; the reusable flyout implements the full enter/exit sequence. The specialized viewer zoom and annotation menus currently mount and unmount with their existing application state and use the shared entrance styling.

## Component catalog and viewer composition

Reusable React components and SVG icons live in `src/components/ui/`, with shared styles in `kit.css` and exports in `index.ts`. [Component standards](component-standards/README.md) describe anatomy, states, behavior, accessibility, and token ownership for panels, dialogs, tooltips, fields, tables, page navigation, zoom controls, status messages, comments, metadata rows, vertical menus, and flyouts. The `Comment` component supports user-chosen Info, Warning, and Error tones; a review tone never changes the verified, possible, or missing geometry-to-record link state.

The functional viewer is `src/App.tsx`. Specialized compositions in `src/components/patterns/` connect design controls to document state. `DocBar` keeps page entry, navigation, fit modes, and zoom presets. `Toolbar` keeps drawing, annotation colors, and delete actions. `PdfStage`, `PdfCanvas`, overlays, and `MarkupLayer` keep rendering, geometry picking, and annotation behavior. Inspector panels retain real Parquet data, filters, and object IDs. Do not replace those with sample records or generic controls that omit existing actions.

- Center the PDF on the off-black stage; use a neutral shadow to separate paper and chrome.
- Outline matched geometry in blue, and selected geometry in the same blue with a stronger fill and a thicker outline, without obscuring fine drawing lines. Also show the element ID or label.
- Use green only for a verified metadata link, yellow for ambiguous or missing information, and explicit words for every status.
- Let the inspector move below the page at narrow widths before reducing the PDF's readable size.
- Keep annotation and metadata write operations distinct and label the target of each save.

See the [geometry inspector example](screen-examples/geometry-inspector.md), [vertical menu standard](component-standards/menubar.md), [flyout standard](component-standards/flyout-menu.md), and [comment standard](component-standards/comment.md). The former token-gallery test frontend was removed during integration; the viewer itself is the live composition of the library.
