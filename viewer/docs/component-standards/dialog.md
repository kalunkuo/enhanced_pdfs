# Dialog standard

**Purpose:** Complete a focused task such as opening a PDF, searching elements, or reviewing a confirmation. Use a native `<dialog>` for modal behavior.

**Anatomy:** title, optional description, content, primary and secondary actions. Use the shared type classes, spacing scale, control radius, and semantic surface/text colors. The title must identify the action or information, not merely say “Dialog.”

**Variants:** informational (one close action), form (submit and cancel), and confirmation (explicit outcome and cancel). Do not use a confirmation dialog for routine reversible navigation.

**States:** closed, open, submitting/loading, validation error, success, and unavailable. Disable repeated submission while processing. Keep user-entered values when showing an error.

**Interaction:** opening moves focus inside; Escape and Cancel close unless an operation genuinely cannot be interrupted. Closing returns focus to the trigger or next logical control. Use `method="dialog"` for simple close actions; handle form validation and submit outcomes explicitly. Close on backdrop only where losing entered work is harmless.

**Accessibility:** supply an accessible title with `aria-labelledby` or an equivalent label, and connect descriptive/help text with `aria-describedby` when useful. Show validation errors near the relevant field and announce them. Keep all controls keyboard reachable and ensure focus does not move behind the modal.

**Implementation:** `src/components/ui/Dialog.tsx`. Control it with `open` and `onClose`; supply `title`, optional `description`, content, and `footer` actions.
