# Field standard

**Purpose:** Collect one value or a short set of related values. Use native `input`, `textarea`, and file controls before custom widgets.

**Anatomy:** persistent visible label, control, optional hint, optional validation message. Use the shared control height, border, radius, padding, type size, and focus treatment. Placeholder text is an example, not a replacement for a label.

**Variants:** text/search, numeric, multiline, select, and file picker. The comment composer pairs a multiline field with a tone select. The numeric zoom field has an explicit unit and min/max/step contract in the zoom-control standard. Textareas may grow vertically; file pickers must expose the native file control even when visually wrapped.

**States:** resting, hover, focus, filled, disabled, readonly, required, invalid, and loading where applicable. Pair error color with text. Preserve entered values through validation errors.

**Accessibility:** associate labels with controls. Connect hint and error text using `aria-describedby`; set `aria-invalid="true"` when invalid. Use native `disabled` when activation must stop, and `readonly` when the value remains readable and focusable. Do not suppress the browser focus outline without replacing it.

**Implementation:** `src/components/ui/Field.tsx`. Wrap one native control with `label` and optional `hint` or `error`; the component supplies the ID and accessibility connections.
