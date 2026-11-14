# Segmented control standard

**Purpose:** Switch between a small set of peer views, such as the inspector's Properties, Elements, and Notes tabs.

**Anatomy:** a raised track, option buttons, and one selected indicator behind the options. Each option's minimum width is its label plus a 12px inset on each side; options then grow to fill the track, which stretches to the container width. The indicator matches the selected option's width. It is a single element that moves and resizes; options do not paint their own selected background.

## Shared measurements and tokens

| Property | Token | Value |
| --- | --- | --- |
| Track padding | `--segmented-padding` | 4px |
| Option gap | `--segmented-gap` | 2px |
| Option height | `--menu-item-height` | 32px |
| Option inline padding (label inset, each side) | `--segmented-indicator-inset` | 12px |
| Label size | `--text-label-size` | 13px |
| Track background | `--segmented-background` | raised surface |
| Indicator | `--segmented-indicator-background` / `-foreground` | primary blue / off-black |
| Slide duration | `--segmented-slide-duration` | 300ms |
| Slide easing | `--segmented-slide-easing` | `cubic-bezier(.65, 0, .35, 1)` |

## Motion

When an option is selected, the indicator slides from the previous option to the new one, and its width changes to fit the new label, along an arc speed curve (ease-in-out): it accelerates from rest, peaks mid-travel, and decelerates into place. Never use linear movement. The selected label color changes over the same duration and easing so text and indicator arrive together. The indicator is placed without animation on first render. Under `prefers-reduced-motion`, it moves instantly.

## States and accessibility

Resting options use muted text; hover uses full text color; the selected option uses the indicator foreground. Use `role="tablist"` with `role="tab"` and `aria-selected` when options switch a panel. Keyboard focus uses the shared 2px blue outline.

**Implementation:** `src/components/ui/SegmentedControl.tsx` (exported from `src/components/ui/index.ts`). Supply `options` (`value`, `label`), `value`, `onChange`, and an accessible `label`. It measures the selected `.tab` and sets `--indicator-x` / `--indicator-w` on the track; the indicator is the track's `::before`, styled by `.tabs` / `.tab` in `src/styles/app.css`.

**Inspector sizing:** the right panel is at least `--viewer-side-min-width` (360px) and otherwise exactly as wide as the segmented control's minimum plus its 16px side margins. Panel content uses `contain: inline-size`, so long values wrap rather than widening the inspector.
