# Logo standard

**Purpose:** Identify the application in the document bar with the "BIMprint." wordmark.

**Anatomy:** the text "BIMprint" in bold Manrope followed by a square period. "BIM" uses primary blue (`--logo-accent` → `--color-primary` → `--primitive-color-blue-500`), "print" uses primary text (`--logo-text` → `--color-text` → `--primitive-color-white`), and the period is a filled square in secondary red (`--logo-dot` → `--color-secondary` → `--primitive-color-red-500`) sized at 0.2em so it scales with the type. The wordmark is live text, not an image, so it always matches the bundled font and current tokens.

**States:** static only. It has no hover, focus, or pressed state and is not a link.

**Accessibility:** the wrapper uses `role="img"` with the accessible name "BIMprint"; the inner letters and square are `aria-hidden`.

**Tokens:** `--logo-font-size`, `--logo-font-weight`, `--logo-text`, `--logo-accent`, `--logo-dot`, `--logo-dot-size` in `src/styles/tokens/components.css`. Change the brand colors through these tokens, never with literals.

**Implementation:** `src/components/ui/Logo.tsx`, exported from `src/components/ui/index.ts`; styles in `src/components/ui/kit.css`. Used at the start of `DocBar`.
