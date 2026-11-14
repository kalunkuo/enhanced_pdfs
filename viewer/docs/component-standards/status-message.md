# Status message standard

**Purpose:** Communicate the outcome or current state of a viewer action or metadata link.

**Variants:** inline status for persistent context, banner for a condition requiring attention, and toast for a brief result. Use semantic roles for info, success/verified, warning/possible, and error/missing. The source of the status must be clear: a verified link is different from an illustrative or candidate match.

**Anatomy:** icon or marker, concise text, optional supporting explanation, optional action, and dismiss control where appropriate. Pair color with wording and iconography. Use primary blue for informational status, green for verified, yellow for warning, and red for error.

**States and timing:** persistent banners stay visible until resolved or dismissed. Success toasts may dismiss automatically; errors that require action should persist. Do not reset a timeout merely because the pointer moves through a toast. Respect reduced motion for entrance/exit effects.

**Accessibility:** use `role="status"` or polite live regions for nonurgent updates; reserve `role="alert"` for urgent errors. Put a dismissible toast's button in the tab order. Avoid repeating the same announcement in a banner and toast at once. Keep the status text meaningful without its color or symbol.

**Implementation:** `src/components/ui/StatusMessage.tsx`. Choose a `tone` and `variant`; optional `title`, `onDismiss`, and `autoDismissMs` configure the content and lifecycle.
