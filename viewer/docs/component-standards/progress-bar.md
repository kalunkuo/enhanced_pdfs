# Progress bar standard

**Purpose:** Show determinate progress for blocking work, such as opening an enhanced PDF.

**Anatomy:** an 8px raised track with a green fill (`--color-tertiary-green`), then a row with the current step (muted, left) and the percentage (full text color, tabular numerals, right).

| Property | Token | Value |
| --- | --- | --- |
| Track height | `--progress-height` | 8px |
| Radius | `--progress-radius` | 6px |
| Track / fill | `--progress-track` / `--progress-fill` | raised surface / green |
| Fill motion | `ProgressBar.tsx` | continuous ease toward the goal (220ms time constant); creep toward the step's end (2.4s time constant) |

**Behavior:** the fill reflects real work, never a timer, and moves smoothly with no hard stops: it eases continuously toward each report, and while reports stall it creeps toward the end of the current step (`ceiling`) without reaching it. It never moves backwards. Stages share one bar: when opening a file, reading the file, parsing the PDF, extracting attachments, and reading model tables fill 95%, and the first page render completes it. Show the current step as text. Under `prefers-reduced-motion`, the fill jumps.

**In a dialog:** blocking progress uses `Dialog` with `dismissible={false}` so Escape cannot hide unfinished work; use a compact title (`titleClassName="type-h3"`) and 13px description. On completion the step reads "Ready" and the bar finishes its fill; only once the visible fill reaches 100% (`onComplete`) does the dialog and its backdrop fade out together over 1.5s (`--dialog-reveal-duration`, class `is-revealing`) to reveal the loaded viewer, and the dialog unmounts. On error it closes immediately and the error shows in the viewer's status banner. Reduced motion skips the fade.

**Accessibility:** `role="progressbar"` with `aria-valuenow` (0–100), an accessible label naming the work, and `aria-valuetext` including the step.

**Implementation:** `src/components/ui/ProgressBar.tsx`. Supply `value` (0–1), `label`, and optional `detail`. Styles in `src/components/ui/kit.css`.
