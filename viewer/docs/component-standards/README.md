# Component standards

The files in this folder define reusable React/TypeScript viewer controls in `src/components/ui/`. Each standard names the component's anatomy, variants, states, interaction contract, accessibility contract, and token ownership. Components are exported from `src/components/ui/index.ts`; shared styles live in `src/components/ui/kit.css`. Use semantic tokens for shared meaning and component tokens for stable control values. Keep document content and PDF overlays separate from application chrome.

| Component | Standard | Prototype example |
| --- | --- | --- |
| Panel | [panel.md](panel.md) | Page sidebar and inspector |
| Dialog | [dialog.md](dialog.md) | Open PDF, search, and information dialogs |
| Tooltip | [tooltip.md](tooltip.md) | Toolbar action hints |
| Field | [field.md](field.md) | Page filter, zoom input, comment composer, upload |
| Data table | [data-table.md](data-table.md) | Specification table |
| Page navigation | [page-navigation.md](page-navigation.md) | Sidebar pages and previous/next |
| Zoom control | [zoom-control.md](zoom-control.md) | Toolbar zoom group |
| Status message | [status-message.md](status-message.md) | Link banner, stage status, toast |
| Comment | [comment.md](comment.md) | Inspector review and gallery tone examples |
| Metadata rows | [metadata-rows.md](metadata-rows.md) | Inspector properties |
| Vertical navigation | [menubar.md](menubar.md) | Main sidebar menu |
| Flyout menu | [flyout-menu.md](flyout-menu.md) | Workspace and inspector options |

For each component, verify resting, hover, focus, active, disabled, loading, empty, warning, and error states where applicable. Document an omitted state as intentionally unsupported. The interactive examples in `src/examples/ComponentGallery.tsx` import the same components and styles as `src/App.tsx`.
