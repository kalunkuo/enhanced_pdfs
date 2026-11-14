# Page navigation standard

**Purpose:** Move through document pages without losing the current page context.

**Anatomy:** previous button, current page, total pages, next button; optional page list or thumbnail rail. Show the page label and number together when the document provides both. Use the shared icon button, control spacing, and type tokens.

**States:** first, middle, last, single-page, loading, and unavailable. Native `disabled` prevents navigation beyond the first or last page. When the page count is unknown, state that explicitly rather than showing a fabricated total.

**Interaction:** previous/next change exactly one page. Page-list selection changes to that page and updates `aria-current="page"`. Keep the document and inspector in sync; clear or remap geometry selection when it belongs to another page. Keyboard shortcuts must not fire while typing in a field or operating a menu/dialog.

**Accessibility:** label icon-only controls. Announce page changes without overwhelming the user. Preserve a visible focus indicator and predictable focus position after navigation.

**Implementation:** `src/components/ui/PageNavigation.tsx` exports `PageNavigation` and `PageList`. Control both with a current page and `onPageChange`; `PageList` also accepts page descriptions and a filter.
