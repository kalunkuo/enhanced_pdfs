# Data table standard

**Purpose:** Compare structured specifications and Parquet-derived rows. Use a semantic HTML `<table>` for two-dimensional data.

**Anatomy:** optional caption, column headers, body rows, optional source/provenance note, and optional footer. Use a shared cell-padding token and semantic text/border colors. Right-align numeric measures and retain their units in text.

**Variants:** compact key/value specification table and multi-column data table. Sorting, filtering, and row selection are separate optional behaviors; do not imply they exist with decorative affordances.

**States:** populated, empty, loading, partial data, error, and selected row where applicable. An empty table needs a clear reason and next action. Mark unavailable values explicitly rather than using blank cells.

**Interaction and accessibility:** use `<th scope="col">` and `<th scope="row">` where appropriate. A sortable header is a real button with `aria-sort` on the sorted column. Keep table reading order intact at narrow widths; permit horizontal scrolling when the data relationship requires it and keep the scroll region keyboard reachable. Show source table and record identifiers when provenance affects decisions.

**Implementation:** `src/components/ui/DataTable.tsx`. Supply typed `columns`, `rows`, and `rowKey`; optional `caption`, `compact`, and `emptyMessage` configure presentation. A column may define sorting behavior.
