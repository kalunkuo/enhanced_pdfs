# Zoom control standard

**Purpose:** Adjust document scale while preserving readable chrome and geometric alignment.

**Anatomy:** zoom-out icon button, editable percentage field with visible or programmatic percent unit, zoom-in icon button. Use the shared icon button and field standards.

**States:** minimum, intermediate, maximum, invalid entry, and disabled/unavailable. Default prototype range is 50–180% in 10% steps; a real viewer may expand this range only after documenting the new limits. Disable decrement/increment at the bounds.

**Interaction:** accept a valid entered percentage on Enter or blur, clamp or reject out-of-range input consistently, and display the committed value. Zoom should preserve the user's point of interest when practical. A fit-to-page action, if added, must show whether the displayed value is computed or user-entered. Recalculate geometry overlays from document coordinates; do not leave highlight regions at their old screen position.

**Accessibility:** provide an accessible field label and button names. Do not trap arrow keys in a custom control. Avoid using color alone to show a limit or error.

**Implementation:** `src/components/ui/ZoomControl.tsx`. Supply `value` and `onChange`; optional `min`, `max`, `step`, and `disabled` determine its bounds and availability.
