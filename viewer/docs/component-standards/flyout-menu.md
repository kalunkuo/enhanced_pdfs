# Flyout menu standard

The second reference shows a small anchored panel with a vertical list of icon and text options, a divider, and a final separate action. Use it for contextual or workspace actions that do not need to remain visible. The panel follows the dark application palette.

## Anatomy and shared values

An icon button is the trigger. The flyout is a 232px-wide panel aligned to the trigger's right edge. It uses the shared 8px menu padding, 6px radius, 32px minimum row height, 16px SVG icons, 8px icon-label gap, and 13px label size from `components.css` and semantic tokens. An optional separator uses the shared border width and border color. A label must accompany each icon.

## Motion sequence

1. On trigger activation, mount the shell at `opacity: 0` and `scale(--menu-scale-closed)` (`.94`). Measure the button center relative to the panel and set `transform-origin` to that focal point for both entrance and exit.
2. Fade and scale the shell to `opacity: 1` and `scale(1)` over `--menu-transition-duration` (**500ms**) with `--ease-enter` (ease-out).
3. Start revealing rows as the shell opens. Each fades in over `--menu-options-transition-duration` (**150ms**), with successive starts separated by `--menu-row-stagger` (**30ms**). Move focus to the first option after its short fade; do not wait for the 500ms shell motion.
4. On dismissal, hide and disable the rows immediately. Fade and scale the shell back to the same focal point over `--menu-exit-duration` (**400ms**), then unmount it. Exit is 20% faster than entrance.

With `prefers-reduced-motion: reduce`, complete the visual motion immediately while preserving focus and visibility order. Avoid animations that move the menu away from its trigger or make options clickable while invisible.

## Interaction and accessibility

- Trigger: `aria-haspopup="menu"`, `aria-expanded`, and `aria-controls`; use an accessible name.
- Panel: `role="menu"` with an accessible name. Rows use `role="menuitem"`.
- Enter or Space on the trigger opens the panel. Up and Down Arrow move among options. Escape closes it and returns focus to the trigger. Tab leaves and closes it. Pointer interaction outside closes it.
- Keep destructive or session-level actions after a separator. Do not put form fields or multi-step content inside this compact menu; use a dialog instead.
- Menu item hover/focus uses the same raised dark surface and 500ms button state transition as the vertical menu. The panel's animation time and row state time are separate tokens that currently alias the same semantic duration.

Implementation: `src/components/ui/FlyoutMenu.tsx` and `src/components/ui/kit.css`. Supply `label` and an `items` array with stable `id`, `label`, and `onSelect`; optional `icon`, `disabled`, and `separatorBefore` configure rows. Use `align="start"` or `align="end"` for anchor alignment. Inspect the live example in `src/examples/ComponentGallery.tsx`.
