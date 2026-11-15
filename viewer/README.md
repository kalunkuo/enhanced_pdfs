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
- `Highlight all columns, including structural columns`
- `Color the columns by type, select them, and zoom to the results`
- `Find columns on Level 1 and show their exported properties`
- `Add a comment to the selected elements saying "Verify the column layout"`

After a door comparison, try `What about 42 inches?` and then `48`. The legend shows each group and its element count; **Fit highlighted elements** frames the available drawing geometry. **Clear colors** removes the overlay. Clicking a PDF element switches to **Properties**. Click **Agent** to resume the conversation; clicking empty drawing space also returns to Agent. Opening a different file or page starts a new conversation.

Element actions use the current page and the active **Drawing / view** scope from Elements. Results distinguish matching records from elements with mapped drawing geometry. Fire-rating **Unspecified** means the export contains no rating; it remains separate from explicit values such as **NR**. Door widths use exported instance/type parameters with known units. Missing, conflicting, or unrecognized widths are **Width unknown**, and doors exactly at the requested threshold form a separate group. Agent colors are temporary display overlays.

Comment context reads actual review comments on the current page and current viewer notes. Available creation/modification timestamps establish order; undated comments remain explicitly undated. Comment citations open their context in **Notes**. Comments are scoped by page rather than inferred element/view membership.

API mode uses a tool loop that can inspect the drawing catalog, query any exported category and property, group results, inspect elements and comments, highlight/select/focus results, adjust the view, navigate pages, add comments/replies, open a thread, and download the reviewed PDF. Result membership stays local behind handles, so a query can act on all matching objects while returning only bounded rows to the model. Queries use the current page and drawing/view scope. Numeric filters require compatible units or declared unitless data; missing or conflicting values are reported. Review writes and downloads require an explicit user request. Imported-comment upgrades retain their separate **Accept upgrade** review action.

## Upgrade existing PDF markups

Opening an enhanced PDF imports its existing review markups into **Notes**, including their authors, dates, and reply threads. The original PDF graphics stay in place. Matching runs across all pages with imported notes, including pages you have not visited. **Review imported notes** opens the first note that needs attention; matching can be paused and retried.

Point comments and arrow tips use drawing hit testing. Area markups use the objects’ printed extents and can propose several objects. Review the proposed objects, then click **Accept upgrade** to turn the PDF comment into a smart comment with object links. Suggestions can be highlighted and inspected, but stay out of the active links and `markup-links.parquet` until accepted. For uncertain matches, **Accept link to…** confirms the object you choose; the object tag also lets you search manually. Element IDs mentioned in the comment appear separately as text references. Existing plugin links and manual corrections are preserved. Sidebar filters do not change these matches. Ordinary PDFs without enhanced model identities still import their notes, but cannot acquire model links from geometry.

Select an imported note to inspect its links, change its object tag, or reply. Its pin stays at the source markup. Native message text stays read-only to preserve its printed appearance; your new browser replies can be edited. Save downloads a new PDF with links and review state in `annotations.json`, preserving the original markup appearance streams, positions, authors, dates, and model/plugin Parquet files. New replies are also saved as standard PDF replies. Deleting an imported note explicitly removes that original markup and its thread from the saved copy. Plugin `annotations` and `annotation-links` Parquet tables are read and preserved; browser edits do not rewrite those plugin tables.

Saving also refreshes the browser's `markups.parquet`, `markup-links.parquet`, and `markup-replies.parquet` export. Imported records appear there as comment review pins with their approved links and replies. Their original native shapes remain in the PDF; this export does not reconstruct those shapes in Revit.

Accepted upgrades survive reload and PDF save/reopen. Geometry links created by older viewer versions return as proposals for acceptance; previously confirmed manual links and plugin links stay smart.

Save ownership comes from exact annotation references and the browser manifest. A native markup is never treated as browser-owned just because its name begins with `ep-`.

## Agent connection

Without a configured provider, the agent runs the supported drawing actions locally and is labeled **Local demo**. A configured server offers **Amazon Bedrock** or **OpenAI** mode. The optional microphone uses browser speech recognition where supported, places the transcript in the composer for review, and requires **Send** to run the request. Typed input is always available.

### Test locally with a Bedrock API key

Copy `.env.example` to the ignored `viewer/.env.local` if needed, then enter the key directly in that file. Fill in the Region where the key was generated and an accessible model or inference profile that supports Converse tool use:

```dotenv
AGENT_PROVIDER=bedrock
AWS_BEARER_TOKEN_BEDROCK=your_bedrock_api_key_here
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=us.anthropic.claude-opus-5-5
```

A Bedrock API key authenticates with an authorization bearer token. It is distinct from an AWS access-key ID and secret-access-key pair, which require AWS request signing. This local provider accepts the Bedrock bearer-token form. Both short-term and long-term Bedrock API keys are scoped to the Region in which they were generated. Short-term keys expire with their originating session, up to 12 hours. The key's identity must have model access and permission to invoke the selected model. The example uses the selected US East Region and [Claude Opus 5.5 inference profile](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-5-5.html); change them to match your key and model access. See [Bedrock API keys](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html) and the [Converse request contract](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html).

Restart `bun run dev` after changing server configuration. The Agent panel selects the configured provider; use its mode selector to return to Local demo. **Check connection** reads configuration status without making a billable model request. Configured means the required settings are present; the first request verifies the token, Region, model access, and quota. Failed requests show an error and retain the draft for retry. They do not silently switch modes, and requests can be canceled. A configured status means the server has an OpenAI key that OpenAI accepts (checked once per ten minutes, so a stale or placeholder key leaves the viewer in Local demo instead of failing its first request); Bedrock tokens are not pre-checked.

Bedrock uses standard Converse tool calls. The server and browser validate tool names and arguments before any drawing action runs; the model does not execute drawing operations. This path does not request Bedrock's optional strict-output schema compilation.

### Use an OpenAI key instead

The existing OpenAI path remains available with:

```dotenv
AGENT_PROVIDER=openai
OPENAI_API_KEY=your_openai_key_here
OPENAI_MODEL=gpt-5.6-terra
```

It uses the [OpenAI Responses API with strict function tools](https://developers.openai.com/api/docs/guides/function-calling). `OPENAI_MODEL` selects the model; the example uses [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra). If `AGENT_PROVIDER` is blank, a Bedrock token or `BEDROCK_MODEL_ID` selects Bedrock; otherwise the server selects OpenAI. Set the provider explicitly when both are configured.

### API boundary

Credentials are read only by the local Vite server. Never put them in `VITE_*` variables, browser storage, or source files. `GET /api/agent/status` returns only configuration state, provider, and model. `POST /api/agent` plans validated drawing queries and viewer actions. The browser executes them against current drawing data and returns bounded tool observations for the model's next step.

API requests begin with your prompt, up to 12 recent conversation turns, and bounded page/category/comment counts. Requested query observations can include element identities, exported property values and provenance, and comment text. Those bounded results go to the selected provider so it can reason about the drawing; PDF bytes and complete parameter tables stay in the browser. OpenAI requests use `store: false`. The loop is bounded to eight model rounds with limits on observations and action counts, cancellation, duplicate-write protection, and sanitized errors. Each model request times out after 60 seconds for Bedrock or 30 seconds for OpenAI. The API remains restricted to the local viewer. Provider modules live in `server/`; the browser contract and tool executor are `src/lib/agentApi.ts`.

For a local production-build preview, run `bun run build` then `bun run preview`; it exposes the same local API. Serving `dist/` as static files alone runs Local demo without an API server. Hosted multi-user deployment needs a separate authenticated backend; the included proxy is for the local hackathon demo.

Provider, HTTP, and client tests use mocked responses. A real model request requires a valid key, matching Region, and model access.

Validated against the actual `snowdon-towers-a101-enhanced.pdf`, using its native PDF paths and embedded model tables: all 170 walls and 34 doors are highlightable. At 36 inches, door groups are 1 below, 7 above, 25 equal, and 1 unknown; at 42 inches they are 26 below, 6 above, 1 equal, and 1 unknown. The unknown opening exports a zero width. Selecting a real wall opens Properties and returning to Agent preserves the conversation. The original has no review comments; a clearly labeled demo note and reply added in the viewer were sorted correctly, opened their source thread, and survived save/reopen without duplicates. All five original Parquet attachments remained byte-identical in that saved copy.

The enhanced demo contains synthetic walls, four doors around the 36-inch threshold (including one unknown width), and dated review comments. Regenerate it after changing its fixture data:

```sh
uv run --python 3.13 --script scripts/make-demo-pdf.py public/demo/demo-enhanced.pdf
```

The visual system lives in `src/styles/tokens/`, `src/components/ui/`, and `docs/design-system.md`. Reusable controls are exported from `src/components/ui/index.ts`. `src/components/patterns/` contains the viewer compositions that connect those controls to PDF, Parquet, and annotation state. The former design-library test screen has been removed.

## Hosted agent API (Vercel)

The Vercel deployment serves the static build, and `api/agent.ts` and `api/agent/status.ts` run the same drawing agent as the local Vite server as serverless functions (`server/hostedAgent.ts`). Set the provider variables on the Vercel project for Production and Preview (Settings → Environment Variables, or from `viewer/` with the CLI after `vercel login` and `vercel link`), then redeploy:

```sh
vercel env add AGENT_PROVIDER production            # bedrock
vercel env add AWS_REGION production                # us-east-1
vercel env add BEDROCK_MODEL_ID production          # us.anthropic.claude-opus-5-5
vercel env add AWS_BEARER_TOKEN_BEDROCK production  # paste the token when prompted; never commit it
```

`GET /api/agent/status` on the site reports `configured: true` once the variables are in place. The function admits browser requests from the site itself (same host, no cross-site fetches) and keeps the local API's bounded inputs, at most two concurrent requests per instance and a 60-second limit. It is still a public URL: anyone who finds it can spend the configured quota, so treat it as a demo setting and remove the variables after the event.
