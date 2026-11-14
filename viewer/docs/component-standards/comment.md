# Comment standard

**Purpose:** Let reviewers leave an authored observation on a selected PDF element. A comment describes a person's judgment; its tone does not change or verify a geometry-to-Parquet link.

**Anatomy:** 6px-radius raised surface, narrow tone-colored edge, author initial, author name, optional time and element context, explicit tone icon and label, and body text. Keep the body as plain text with line breaks; do not interpret user input as HTML. A composer uses a labeled multiline field, labeled tone selector, and Post comment action.

**Tones:** `info` uses primary blue for neutral context, `warning` uses tertiary yellow for an issue to review, and `error` uses secondary red for a reported conflict. Always show the tone word and icon with the accent. Do not use green, which is reserved for a verified metadata link.

**States:** display, editable tone, empty composer, filled composer, and disabled composer. The Post comment action is disabled for whitespace-only input. The parent owns comment text and tone; changing a tone or posting a comment calls the supplied callback. Comments have no automatic dismissal.

**Accessibility:** each comment is an `<article>` named by its tone and author. The composer uses native labeled textarea and select controls. A user-authored `error` comment is not a system alert, so it does not use `role="alert"` or force a live announcement. Preserve a visible focus indicator and keyboard access to tone changes.

**Tokens:** raw palette, 6px radius, spacing, and type scale live in `src/styles/tokens/primitives.css`; shared color and type roles live in `src/styles/tokens/semantic.css`; comment surface, padding, avatar, and tone aliases live in `src/styles/tokens/components.css`.

**Implementation:** `src/components/ui/Comment.tsx` exports `Comment`, `CommentComposer`, and `CommentTone`. The viewer composition is `src/components/patterns/ElementComments.tsx`. The gallery shows all three tones, tone changes, and posting. Prototype comments are held in browser memory for the current session.
