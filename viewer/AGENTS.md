# Viewer agent instructions

This folder contains the enhanced-PDF React/TypeScript design library. The default screen puts design tokens and reusable components together; the viewer demo is a secondary context example. Read [docs/design-system.md](docs/design-system.md) and the relevant file in [docs/component-standards/](docs/component-standards/) before changing a control. The sample PDF and records are illustrative.

## Token ownership

Import [src/styles/tokens.css](src/styles/tokens.css) once in the application entry point. It loads the tiers in dependency order:

1. **Primitives:** [src/styles/tokens/primitives.css](src/styles/tokens/primitives.css) owns literal palette, spacing, typography, size, radius, and motion values. Change this tier when the foundation changes.
2. **Semantics:** [src/styles/tokens/semantic.css](src/styles/tokens/semantic.css) assigns purpose to colors, type styles, spacing, radii, and durations shared across the application. Use semantic tokens for page and pattern styling.
3. **Components:** [src/styles/tokens/components.css](src/styles/tokens/components.css) owns values specific to buttons, menus, fields, panels, dialogs, and other controls. Add a component token when a control needs a stable named value or coordinated states.

Do not put raw colors, radii, or control dimensions in component styles. Reuse a semantic role when several components share a meaning. Keep aliases pointed toward the tier above them.

## Code and documentation locations

- Build reusable React controls in `src/components/ui/`, export them from `src/components/ui/index.ts`, and keep their shared CSS in `src/components/ui/kit.css`. The 24px toolbar button rules are in `src/components/ui/icon-button.css`. SVG glyphs are defined in `src/components/ui/Icon.tsx`; source SVG assets are in `src/components/ui/icons/`.
- Put viewer compositions and drawing patterns in `src/components/patterns/`. Keep application wiring in `src/App.tsx`, the token inventory in `src/examples/TokenLibrary.tsx`, and component specimens in `src/examples/ComponentGallery.tsx`. The token inventory reads the primitive, semantic, and component CSS files directly; keep it on the default screen with the components.
- Use `src/components/ui/Comment.tsx` for authored comments and their composer, and `src/components/patterns/ElementComments.tsx` for the geometry inspector composition. Follow `docs/component-standards/comment.md` for tone behavior.
- Put screen arrangements in `docs/screen-examples/`. Update `docs/design-system.md` when a rule becomes general, and update the matching file in `docs/component-standards/` when component anatomy, props, states, accessibility, or behavior changes.
- Use `src/styles/typography.css` for title, H1, H2, H3, and paragraph styles. Semantic type tokens live in `src/styles/tokens/semantic.css`; raw scales live in `src/styles/tokens/primitives.css`. The current Manrope sizes are 36/28/24/18/14px for those five styles, with 13px labels and 11px compact captions. Keep HTML heading levels in a meaningful order regardless of visual style.
- Run the design library with `npm.cmd run dev -- --port 8765` from this folder. Run `npm.cmd run build` after code changes. See [README.md](README.md).

## Interaction and accessibility rules

- Application chrome uses an off-black background, white primary text, Manrope, primary blue, secondary red, and tertiary pink, green, and yellow. Never recolor the rendered PDF page.
- Toolbar icon buttons are 24px square with 6px corners. Resting state is transparent with a white SVG glyph. Hover and pressed states have white fill and an off-black glyph. SVGs use `currentColor`. Button state transitions take 500ms.
- Action buttons scale to 0.97 while pressed. Toolbar buttons and menu triggers do not scale on press.
- Flyout shells fade and scale from the trigger button's focal point on both entrance and exit. Entrance uses ease-out over 500ms; exit takes 400ms. Menu rows start their 150ms fade as the shell opens, staggered by 30ms. Disable and hide menu options at the start of closing. Respect reduced-motion preferences.
- Persistent vertical navigation uses a labeled `<nav>` and normal Tab order. Flyout menus provide Escape, Arrow, Home, and End behavior and restore focus to the trigger when Escape closes them.
- Give icon-only buttons an accessible name, a visible keyboard focus ring, and a tooltip where the icon may be unclear. Use `aria-pressed` only for toggle controls. Pair status colors with text or another visible cue.
- Show whether a PDF geometry-to-Parquet-record link is verified, provisional, or absent. Never present a candidate match as a confirmed link.
- Keep user-assigned Info, Warning, and Error comment tones separate from metadata-link status. Show the tone icon and word alongside its accent; an Error comment is not a system alert.
