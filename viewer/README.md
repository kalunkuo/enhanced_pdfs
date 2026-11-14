# Enhanced PDF viewer

React and TypeScript application for viewing and annotating PDFs, including enhanced PDFs with attached Parquet specifications. The viewer reads native PDF geometry for element selection, supports the optional demo geometry table, and can save annotations back to a PDF. See [AGENTS.md](AGENTS.md) for the data and geometry contracts.

```sh
cd viewer
bun install
bun run dev
bun run typecheck
bun run test
```

The development server defaults to <http://localhost:5313/>. The application opens the functional viewer. **Open demo** loads the synthetic enhanced PDF from `public/demo/`; its metadata is illustrative.

## Drawing agent demo

The right sidebar opens on **Agent**. Choose **Open demo**, then use a suggestion or type a request:

- `Highlight and color code walls based on fire rating`
- `Compare door widths at 36 inches: green below and red above`
- `Give me context of the latest comments on this drawing`

After a door comparison, try `What about 42 inches?` and then `48`. The legend shows each group and its element count; **Fit highlighted elements** frames the available drawing geometry. **Clear colors** removes the overlay. Clicking a PDF element switches to **Properties**. Click **Agent** to resume the conversation; clicking empty drawing space also returns to Agent. Opening a different file or page starts a new conversation.

Element actions use the current page and the active **Drawing / view** scope from Elements. Results distinguish matching records from elements with mapped drawing geometry. Fire-rating **Unspecified** means the export contains no rating; it remains separate from explicit values such as **NR**. Door widths use exported instance/type parameters with known units. Missing, conflicting, or unrecognized widths are **Width unknown**, and doors exactly at the requested threshold form a separate group. Agent colors are temporary display overlays.

Comment context reads actual review comments on the current page and current viewer notes. Available creation/modification timestamps establish order; undated comments remain explicitly undated. Comment citations open their context in **Notes**. Comments are scoped by page rather than inferred element/view membership.

The current agent runs the supported drawing actions locally and is labeled **Local demo**. No LLM API is connected; no provider credentials were available during setup. The optional microphone uses browser speech recognition where supported, places the transcript in the composer for review, and requires **Send** to run the request. Typed input is always available.

Validated against the actual `snowdon-towers-a101-enhanced.pdf`, using its native PDF paths and embedded model tables: all 170 walls and 34 doors are highlightable. At 36 inches, door groups are 1 below, 7 above, 25 equal, and 1 unknown; at 42 inches they are 26 below, 6 above, 1 equal, and 1 unknown. The unknown opening exports a zero width. Selecting a real wall opens Properties and returning to Agent preserves the conversation. The original has no review comments; a clearly labeled demo note and reply added in the viewer were sorted correctly, opened their source thread, and survived save/reopen without duplicates. All five original Parquet attachments remained byte-identical in that saved copy.

The enhanced demo contains synthetic walls, four doors around the 36-inch threshold (including one unknown width), and dated review comments. Regenerate it after changing its fixture data:

```sh
uv run --python 3.13 --script scripts/make-demo-pdf.py public/demo/demo-enhanced.pdf
```

The visual system lives in `src/styles/tokens/`, `src/components/ui/`, and `docs/design-system.md`. Reusable controls are exported from `src/components/ui/index.ts`. `src/components/patterns/` contains the viewer compositions that connect those controls to PDF, Parquet, and annotation state. The former design-library test screen has been removed.
