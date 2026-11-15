# Enhanced PDF viewer

React and TypeScript application for viewing and annotating PDFs, including enhanced PDFs with attached Parquet specifications. The viewer reads native PDF geometry for element selection, supports the optional demo geometry table, and can save annotations back to a PDF. See [AGENTS.md](AGENTS.md) for the data and geometry contracts.

```sh
cd viewer
bun install
bun run dev
bun run typecheck
bun run test
```

The development server defaults to <http://localhost:5313/>. The application opens the functional viewer. Open <http://localhost:5313/demo> (or `/#demo` on a static host that cannot route paths) to start straight from the bundled Snowdon Towers sheet A101, `public/demo/a101-first-floor-plan.pdf`, a real export from the Revit add-in; it replaces the remembered file for that browser. A synthetic enhanced PDF for testing is at `public/demo/demo-enhanced.pdf`; open it from the **More actions** (⋯) menu → **Upload enhanced PDF**. Its metadata is illustrative.

## Drawing agent demo

The right sidebar opens on **Agent**. Upload `public/demo/demo-enhanced.pdf`, then use a suggestion or type a request:

- `Highlight and color code walls based on fire rating`
- `Compare door widths at 36 inches: green below and red above`
- `Give me context of the latest comments on this drawing`

After a door comparison, try `What about 42 inches?` and then `48`. The legend shows each group and its element count; **Fit highlighted elements** frames the available drawing geometry. **Clear colors** removes the overlay. Clicking a PDF element switches to **Properties**. Click **Agent** to resume the conversation; clicking empty drawing space also returns to Agent. Opening a different file or page starts a new conversation.

Element actions use the current page and the active **Drawing / view** scope from Elements. Results distinguish matching records from elements with mapped drawing geometry. Fire-rating **Unspecified** means the export contains no rating; it remains separate from explicit values such as **NR**. Door widths use exported instance/type parameters with known units. Missing, conflicting, or unrecognized widths are **Width unknown**, and doors exactly at the requested threshold form a separate group. Agent colors are temporary display overlays.

Comment context reads actual review comments on the current page and current viewer notes. Available creation/modification timestamps establish order; undated comments remain explicitly undated. Comment citations open their context in **Notes**. Comments are scoped by page rather than inferred element/view membership.

## Upgrade existing PDF markups

Opening an enhanced PDF imports its existing review markups into **Notes**, including their authors, dates, and reply threads. The original PDF graphics stay in place. Matching runs across all pages with imported notes, including pages you have not visited. **Review imported notes** opens the first note that needs attention; matching can be paused and retried.

Point comments and arrow tips use drawing hit testing. Area markups use the objects’ printed extents and can link to several objects. Uncertain matches remain suggestions until you choose an object or use the object tag to search. Element IDs mentioned in the comment appear separately as text references. Existing plugin links and manual corrections are preserved. Sidebar filters do not change these matches. Ordinary PDFs without enhanced model identities still import their notes, but cannot acquire model links from geometry.

Select an imported note to inspect its links, change its object tag, or reply. Its pin stays at the source markup. Native message text stays read-only to preserve its printed appearance; your new browser replies can be edited. Save downloads a new PDF with links and review state in `annotations.json`, preserving the original markup appearance streams, positions, authors, dates, and model/plugin Parquet files. New replies are also saved as standard PDF replies. Deleting an imported note explicitly removes that original markup and its thread from the saved copy. Plugin `annotations` and `annotation-links` Parquet tables are read and preserved; browser edits do not rewrite those plugin tables.

Saving also refreshes the browser's `markups.parquet`, `markup-links.parquet`, and `markup-replies.parquet` export. Imported records appear there as comment review pins with their approved links and replies. Their original native shapes remain in the PDF; this export does not reconstruct those shapes in Revit.

Save ownership comes from exact annotation references and the browser manifest. A native markup is never treated as browser-owned just because its name begins with `ep-`.

## Agent connection

Without an API key, the agent runs the supported drawing actions locally and is labeled **Local demo**. With a key configured, it automatically offers **OpenAI** mode. The optional microphone uses browser speech recognition where supported, places the transcript in the composer for review, and requires **Send** to run the request. Typed input is always available.

### Connect an API key

The local `viewer/.env.local` file is prepared with an empty key. It is ignored by Git. If setting up another checkout, copy `.env.example` to `.env.local` first. Fill in:

```dotenv
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5.6-terra
```

Restart `bun run dev` after changing that file. The Agent panel detects the server configuration and selects API mode; its mode selector lets you return to Local demo. **Check connection** refreshes configuration status without making a billable model request. A configured status means the server has a key; the first request verifies the key, model access, and quota. Failed requests show an error and preserve the draft for retry; they do not silently switch to local behavior. Requests can be canceled.

The key is read only by the local Vite server. Never put it in a `VITE_*` variable, browser storage, or a source file. `GET /api/agent/status` returns configuration status and the model name. `POST /api/agent` uses the [OpenAI Responses API and strict function tools](https://developers.openai.com/api/docs/guides/function-calling) to choose among the supported wall, door, comment, and clear-highlight actions. The browser validates and executes those actions using its current drawing data. Drawing highlights, counts, and comment citations come from local code rather than model prose.

API requests contain your prompt, up to 12 recent conversation turns, and bounded page/category/comment counts. PDF bytes, element records, parameter tables, and comment bodies are not uploaded by the context builder. Text you type in the conversation is sent to OpenAI in API mode. Requests use `store: false`. The API is restricted to the local viewer and has bounded inputs, a 30-second timeout, cancellation, and sanitized errors. The provider boundary is `server/openaiAgent.ts`; the browser contract and tool executor are `src/lib/agentApi.ts`.

For a local production-build preview, run `bun run build` then `bun run preview`; it exposes the same local API. Serving `dist/` as static files alone runs Local demo without an API server. Hosted multi-user deployment needs a separate authenticated backend; the included proxy is for the local hackathon demo.

Provider, HTTP, and client tests use mocked model responses. A real API request still needs your future key and model access. Model configuration can be changed through `OPENAI_MODEL`; the example uses the documented [GPT-5.6 Terra model](https://developers.openai.com/api/docs/models/gpt-5.6-terra).

Validated against the actual `snowdon-towers-a101-enhanced.pdf`, using its native PDF paths and embedded model tables: all 170 walls and 34 doors are highlightable. At 36 inches, door groups are 1 below, 7 above, 25 equal, and 1 unknown; at 42 inches they are 26 below, 6 above, 1 equal, and 1 unknown. The unknown opening exports a zero width. Selecting a real wall opens Properties and returning to Agent preserves the conversation. The original has no review comments; a clearly labeled demo note and reply added in the viewer were sorted correctly, opened their source thread, and survived save/reopen without duplicates. All five original Parquet attachments remained byte-identical in that saved copy.

The enhanced demo contains synthetic walls, four doors around the 36-inch threshold (including one unknown width), and dated review comments. Regenerate it after changing its fixture data:

```sh
uv run --python 3.13 --script scripts/make-demo-pdf.py public/demo/demo-enhanced.pdf
```

The visual system lives in `src/styles/tokens/`, `src/components/ui/`, and `docs/design-system.md`. Reusable controls are exported from `src/components/ui/index.ts`. `src/components/patterns/` contains the viewer compositions that connect those controls to PDF, Parquet, and annotation state. The former design-library test screen has been removed.
