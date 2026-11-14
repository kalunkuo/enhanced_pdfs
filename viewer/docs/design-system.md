# Enhanced PDF viewer design system

## Purpose and visual direction

The viewer joins a PDF drawing with geometry and specifications stored in attached Parquet tables. The PDF remains the document of record; the UI chrome provides navigation, editing tools, selection, and a clear route from highlighted geometry to metadata. Use an off-black application canvas and white typography. Bright blue is the primary accent, bright red is secondary, and pink, green, and yellow are tertiary feature colors. Keep any reference-inspired grid subtle in overlays or empty states; it must not interfere with drawing lines.

## Token architecture

`src/styles/tokens.css` is the single import point. Tokens follow this dependency direction:

| Tier | File | Contains | Used by |
| --- | --- | --- | --- |
| Primitive | `src/styles/tokens/primitives.css` | Literal colors, spacing, font, size, radius, motion | Semantic and component tokens; generic spacing and type scale may also be used in UI code |
| Semantic | `src/styles/tokens/semantic.css` | Meaningful roles such as canvas, text, focus, geometry highlight | Screens, patterns, component tokens |
| Component | `src/styles/tokens/components.css` | Stable button, toolbar, panel, and outline values | The corresponding components |

Use semantic names for meanings shared across the app. Component names may depend on semantic names. A one-off value belongs in a component only if it has no reusable design meaning; promote it to a token when reused or when states need to stay coordinated.

## Color

| Role | Token | Value | Use |
| --- | --- | --- | --- |
| Canvas | `--color-canvas` | `#111315` | Main application background |
| Surface | `--color-surface` | `#1b1e20` | Toolbar and inspector background |
| Raised surface | `--color-surface-raised` | `#292d30` | Menus, popovers, selected list rows |
| Primary text and icons | `--color-text` | `#ffffff` | Labels, controls, primary content |
| Muted text | `--color-text-muted` | `#cccccc` | Secondary descriptions |
| Primary blue | `--color-primary` | `#31c6e8` | Main actions, focus, geometry highlight |
| Secondary red | `--color-secondary` | `#ff4b5c` | Selection emphasis, errors |
| Tertiary pink | `--color-tertiary-pink` | `#f4a7e9` | Annotations and future feature cues |
| Tertiary green | `--color-tertiary-green` | `#1bb574` | Verified metadata link |
| Tertiary yellow | `--color-tertiary-yellow` | `#efb12f` | Warnings, ambiguous matches |

Accent hues approximate the supplied image. Use them sparingly, especially over a dense plan. Never apply accent colors to the PDF itself as if they were original drawing content. Use a labeled overlay or separate UI layer. The white hover fill and off-black icon are mandatory for compact toolbar buttons, even where a contextual accent is present elsewhere.

## Typography and spacing

Use **Manrope** for all application chrome, with `Helvetica Neue` and Arial as fallbacks. The variable Manrope font is bundled in `src/assets/fonts/` with its license, so the local prototype does not depend on a font CDN. Do not recolor or retype rendered PDF content. Normal UI body text is 14px with 1.5 line height; labels are 13px. Use 11px only for compact metadata, never for a primary action. Spacing follows 4px increments; common gaps are 8px and panel padding is 16px. Controls use 6px corners, not pill shapes.

Use the five semantic type styles below through `src/styles/typography.css`. Their classes set font properties and color, leaving margins to the layout. Use headings in a meaningful document hierarchy; the style name and HTML heading level can differ when the page outline requires it. Compact toolbar labels and metadata captions may use the 11px/13px UI tokens.

| Style | Size / line height | Weight | Intended use |
| --- | --- | --- | --- |
| Title · `.type-title` | 36px / 43.2px | 700 | Workspace or feature title |
| Heading 1 · `.type-h1` | 28px / 33.6px | 700 | Main screen or dialog heading |
| Heading 2 · `.type-h2` | 24px / 28.8px | 700 | Major section heading |
| Heading 3 · `.type-h3` | 18px / 21.6px | 600 | Panel or subsection heading |
| Paragraph · `.type-paragraph` | 14px / 21px | 400 | Standard explanatory or body copy |

The sizes and weights are semantic tokens in `src/styles/tokens/semantic.css`, derived from the primitive font scale. The viewer and component gallery use these styles.

## Motion

Button on/off state changes use `--duration-interaction` (**500ms**) and `--ease-interaction`. Action buttons scale to **0.97** while pressed; toolbar and menu trigger buttons do not. Flyout shells fade and scale from the trigger button's focal point on entrance and exit. Entrance uses `--ease-enter` (ease-out) over **500ms**; exit is **400ms**, 20% faster. Menu rows begin a **150ms** fade as the shell opens, staggered by **30ms**. Hide and disable options before closing starts, then unmount the shell after exit. Respect `prefers-reduced-motion` by completing visual transitions immediately. These values live in the primitive and semantic tiers; component tokens alias them where needed.

## Icon buttons and icons

The visual button box is exactly 24 × 24px with a 6px radius. The SVG glyph is 16 × 16px, with simple strokes and no visual clutter. At rest: transparent background, white icon. On hover and when pressed: white background, off-black icon. Both transitions take 500ms. Keyboard focus adds a 2px blue outline with 2px offset. Disabled controls remain transparent and visibly muted. See `src/components/ui/icon-button.css`.

SVG sources live in `src/components/ui/icons/`. Inline their markup into the button so `currentColor` follows the button state; do not use an `<img>` tag for these controls. Use consistent 24 × 24 view boxes, round line caps and joins, and strokes rather than filled pictograms. Example:

```html
<button class="icon-button" type="button" aria-label="Search document" title="Search document">
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m16 16 5 5" />
  </svg>
</button>
```

Keep at least 8px between adjacent 24px buttons. Where touch input is a primary mode, provide a separate 44px touch target around each 24px visual control without changing its visual dimensions or causing overlap. Give every icon-only action an accessible name. Use `aria-pressed` only for toggle tools, and indicate the active tool in text or a status area as well as via button state.

## Viewer patterns

- **Document stage:** center the PDF on the off-black canvas. Use neutral spacing or shadow to separate the page from chrome. Preserve page colors and scale. Keep overlays in a dedicated layer aligned with document coordinates.
- **Toolbar:** use compact icon buttons for open, search, select, pan, and annotation actions. Group related actions with 8px gaps and stronger separation between groups. Tooltips show action names and shortcuts.
- **Geometry selection:** outline the matched shape in primary blue. A secondary red handle shows the user's current selection; pink is reserved for annotations. The overlay must not obscure thin drawing strokes. Show a label or element ID so color is not the only cue.
- **Metadata inspector:** show the selected element's name, ID, source drawing/view, and specifications from Parquet. A green link indicator means the geometry-to-record relationship is verified. For ambiguous or absent matches, show the condition in words and use amber; do not show the green verified state.
- **Editing:** separate document annotations from attached metadata changes. Label any write operation clearly and show its target before saving. Preserve a path back to the source page and record.
- **Comments:** show authored observations beside the selected element. The author chooses Info, Warning, or Error; an icon and word accompany the blue, yellow, or red accent. A comment tone expresses a review judgment and never changes the verified, possible, or missing metadata-link state. Follow the [comment standard](component-standards/comment.md).
- **Responsive layout:** let the inspector collapse or move below the document before reducing PDF readability. Keep essential controls visible; overflow secondary actions into a labeled menu.

See [screen-examples/geometry-inspector.md](screen-examples/geometry-inspector.md) for a concrete workspace arrangement.

## Menu standards

The [menubar standard](component-standards/menubar.md) covers persistent vertical navigation with an expandable nested section, based on the first reference image. The [flyout standard](component-standards/flyout-menu.md) covers the compact anchored menu with icon rows and a separator, based on the second reference image. Both use `src/components/ui/kit.css` and shared menu, spacing, type, radius, and motion tokens. The React implementations are `VerticalMenu.tsx` and `FlyoutMenu.tsx`.

## Live design library

The default screen displays `src/examples/TokenLibrary.tsx` and `src/examples/ComponentGallery.tsx` together. The token inventory reads the three CSS tiers directly and shows their live values; the specimens import the reusable controls from `src/components/ui/index.ts`. Run the library using `viewer/README.md`. The viewer demo remains available through **Open viewer demo** as a context example.

| Component | Viewer and gallery examples |
| --- | --- |
| Panels | Page sidebar, drawing stage, metadata inspector; inspector has selected and empty states |
| Menus | Main vertical menubar, More options flyout, and inspector flyout |
| Dialogs | Open PDF, element search, help/about |
| Tooltips | Hover or focus a toolbar icon |
| Fields | Page filter, element search, zoom percentage, comment composer |
| Tables | Parquet-style specification table and sample schedule page |
| Page navigation | Sidebar page cards and toolbar previous/next controls |
| Zoom controls | Toolbar buttons and editable percentage |
| Status messages | Stage link status, link banner, and dismissible toast messages |
| Comments | Inspector comments and gallery examples for Info, Warning, and Error |
| Metadata rows | Inspector properties for selected sample geometry |

The sample wall, door, and window expose verified, possible, and missing link treatments. Sample data is illustrative; the prototype does not parse actual Parquet attachments or write PDF content.
