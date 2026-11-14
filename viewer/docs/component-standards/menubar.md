# Vertical menubar standard

The first reference shows a compact vertical navigation list: an uppercase section label, icon and text rows, a selected parent with a chevron, indented child rows, and a final help action. Use this pattern for persistent viewer navigation. In markup, use a labeled `<nav>` rather than `role="menubar"`; this is ordinary site navigation, so normal Tab order remains appropriate.

## Anatomy

1. Section caption, such as **MAIN MENU**.
2. Top-level rows with a 16px outline icon and text label.
3. Expandable parent row with a trailing chevron and `aria-expanded` / `aria-controls`.
4. Indented child rows. Show one active destination with a blue background and off-black text/icon.
5. Optional bottom help row, separated by spacing rather than an unrelated border.

## Shared measurements and tokens

| Property | Token | Value |
| --- | --- | --- |
| Row minimum height | `--menu-item-height` | 32px |
| Icon size | `--menu-icon-size` | 16px |
| Icon-to-label gap | `--menu-item-gap` | 8px |
| Container padding | `--menu-padding` | 8px |
| Row radius | `--menu-radius` | 6px |
| Label size | `--text-label-size` | 13px |
| Row state transition | `--button-transition-duration` | 500ms |

The same menu values apply to flyout rows. Use `--primitive-space-*` for layout gaps and `--color-*` for roles; do not create separate row dimensions or radii for each navigation surface.

## States and behavior

- Resting rows are transparent with white text and icons. Hover and keyboard focus use the raised dark surface. The active destination uses primary blue with off-black content.
- Parent expansion is independent of child selection. A chevron points down when expanded and rotates when collapsed. The nested section changes height over 500ms with ease-out; its text fades in over 150ms.
- When collapsed, nested actions are `inert` and `aria-hidden="true"`. The parent remains reachable by keyboard. Enter or Space toggles it; Tab moves through visible rows in document order.
- An active child should describe the current destination. If navigation changes to another view, update active styling and the corresponding page content together.
- Give icon and text the same hover/focus state. Keep icons simple, 24 × 24 viewBox line art using `currentColor`.

Implementation: `src/components/ui/VerticalMenu.tsx` and `src/components/ui/kit.css`. Supply `items`, `selected`, and `onSelect`; nested items use `children`, and a final help action can use `footer`. The current viewer does not need persistent site navigation; use this component when the application gains destinations beyond the document workspace.
