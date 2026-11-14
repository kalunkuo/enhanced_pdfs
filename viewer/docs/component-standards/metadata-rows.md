# Metadata rows standard

**Purpose:** Show a selected PDF element's Parquet-backed properties as scannable name/value pairs.

**Anatomy:** a `<dl>` with one `<dt>` and `<dd>` per property, grouped under an inspector heading. Show source drawing, element ID, and source table/record where available. Use shared spacing, text, and separator tokens.

**States:** value present, blank/unspecified, unavailable, loading, candidate match, verified match, and error. Do not replace an unspecified value with a guessed default. For a candidate match, label the entire group as provisional until the link is verified.

**Layout:** labels use muted text; values use primary text. Long values wrap rather than collide with labels. Preserve units and raw/display distinction when needed. At narrow widths, stack name and value while keeping the pair adjacent in reading order.

**Accessibility:** retain semantic name/value relationships in the DOM. Do not use table semantics for a simple one-dimensional list. If a value is editable, provide a separate labeled field and a clear save/cancel path rather than turning plain text into an unannounced editor.

**Implementation:** `src/components/ui/MetadataRows.tsx`. Supply `items` and mark candidate links with `provisional`.
