# Panel standard

**Purpose:** Group related navigation, document, or metadata content on a dark application surface. A panel is a layout region, not an interactive widget.

**Anatomy:** optional eyebrow, semantic heading, optional action slot, content region, optional footer. Use `--panel-background`, `--panel-border`, and `--space-panel-padding`. The heading level follows the page outline; a visual type class may differ from the HTML heading level.

**Variants:** fixed sidebar, inspector, and inset section. Keep the same surface and spacing relationships. A panel may scroll its content while retaining its heading/footer only when that behavior is explicitly required by its context.

**States:** populated, empty, loading, error, and unavailable. Never leave an empty panel without an explanation or next action. Loading indicators must not imply that a Parquet match is verified.

**Accessibility:** label an `<aside>` or `<section>` when it is a meaningful landmark. Use real headings; do not make the whole panel focusable. Keep reading order aligned with visual order. At narrow widths, preserve access to the panel through a drawer or a move below the document.

**Implementation:** `src/components/ui/Panel.tsx`. Use `as`, `title`, `eyebrow`, `actions`, `footer`, `state`, and `stateMessage` as needed.
