# Tooltip standard

**Purpose:** Give a short supplementary name or shortcut for a control. A tooltip never contains required instructions or an action.

**Anatomy:** one or two lines of text, dark raised surface, subtle border, and shared 6px radius. Position near the trigger without covering it. The same text should be available through the control's accessible name or description.

**States:** hidden and visible on hover or keyboard focus. Hide on blur, pointer exit, Escape, or when the triggering control becomes disabled. Do not show an empty tooltip. Do not rely on the browser's `title` attribute as the only source of help.

**Interaction and accessibility:** tooltip content uses `role="tooltip"` and a stable ID referenced with `aria-describedby` when it adds detail beyond the accessible name. It does not receive focus. Keep it visible while the pointer travels from the trigger into the tooltip when that interaction is supported. Avoid a long delay; use the short content-reveal motion token and respect reduced motion.

**Implementation:** `src/components/ui/Tooltip.tsx`. Wrap a labeled control and provide `content`; hover or focus shows it, and Escape dismisses it.
