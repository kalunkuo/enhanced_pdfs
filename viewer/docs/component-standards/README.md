# Component standards

The files in this folder define reusable React/TypeScript viewer controls in `src/components/ui/`. Each standard names the component's anatomy, variants, states, interaction contract, accessibility contract, and token ownership. Components are exported from `src/components/ui/index.ts`; shared styles live in `src/components/ui/kit.css`. Use semantic tokens for shared meaning and component tokens for stable control values. Keep document content and PDF overlays separate from application chrome.

| Component | Standard | Viewer use or library purpose |
| --- | --- | --- |
| Panel | [panel.md](panel.md) | Inspector layout reference |
| Dialog | [dialog.md](dialog.md) | Reusable modal control |
| Tooltip | [tooltip.md](tooltip.md) | Reusable action hint |
| Field | [field.md](field.md) | Search, page entry, and form reference |
| Data table | [data-table.md](data-table.md) | Specification table reference |
| Page navigation | [page-navigation.md](page-navigation.md) | Document bar reference |
| Zoom control | [zoom-control.md](zoom-control.md) | Document bar reference |
| Status message | [status-message.md](status-message.md) | Viewer errors and warnings |
| Comment | [comment.md](comment.md) | Reusable Info, Warning, Error review control |
| Metadata rows | [metadata-rows.md](metadata-rows.md) | Inspector property reference |
| Vertical navigation | [menubar.md](menubar.md) | Reusable navigation control |
| Flyout menu | [flyout-menu.md](flyout-menu.md) | Menu visual and interaction reference |
| Progress bar | [progress-bar.md](progress-bar.md) | File open dialog |
| Segmented control | [segmented-control.md](segmented-control.md) | Inspector tabs (`SegmentedControl`) |

For each component, verify resting, hover, focus, active, disabled, loading, empty, warning, and error states where applicable. Document an omitted state as intentionally unsupported. The functional viewer in `src/App.tsx` is the live composition; the former test gallery has been removed.
