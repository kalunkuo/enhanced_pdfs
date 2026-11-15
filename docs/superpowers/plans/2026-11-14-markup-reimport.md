# Markup Reimport Implementation Plan

> **For agentic workers:** Execute inline with superpowers:executing-plans (user preference: never subagent-driven). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Revit button that imports a marked-up enhanced PDF, has headless Claude Code interpret each markup through a review-only Revit MCP server, and lets the user approve/reject each proposed change in a docked review panel with on-model previews.

**Architecture:** Revit-free logic (PDF/Parquet/JSON readers, review session, validation, MCP JSON-RPC, Claude launch/stream parsing, decisions writer) lives in a new `MarkupReview.Core` library with xUnit tests, behind an `IModelGateway` interface. The `EnhancedPdfs` add-in implements the gateway on Revit's thread, hosts a named-pipe endpoint, launches `claude -p`, and owns the WPF pane and previews. A tiny `MarkupReview.Bridge` exe is the stdio MCP server Claude Code spawns; it pipes bytes to the add-in.

**Tech Stack:** C# / .NET 8 (`net8.0`, `net8.0-windows10.0.19041.0`), Revit 2025 API, PDFsharp 6.2.4, Parquet.Net 6.1.0, System.Text.Json, WPF, `Windows.Data.Pdf`, xUnit, Claude Code 2.1.325 headless.

**Spec:** `docs/superpowers/specs/2026-11-14-markup-reimport-design.md`

## Global Constraints

- Revit 2025 (`C:\Program Files\Autodesk\Revit 2025`), add-in TFM stays net8 (bump to `net8.0-windows10.0.19041.0` only for `Windows.Data.Pdf`; update `scripts/Install-RevitAddin.ps1:21` build path to match).
- No MCP tool writes to the model. Only Approve (UI, Revit thread) runs a model `Transaction`, named `Markup: <element title> <parameter|Type>`.
- Element handle in every tool = `ElementKey` from the PDF. Match by `UniqueId`; `VersionGuid` differs → "changed since export"; host model only (`LinkInstanceId` non-null → linked-model note).
- Hard stop before launching Claude when PDF `ModelKey` ≠ open document `ProjectInformation.UniqueId`; non-blocking warning when `drawings.Model` ≠ document title.
- Claude launch: `claude -p <prompt> --mcp-config <session.json> --strict-mcp-config --tools "" --allowedTools "mcp__revit__*" --output-format stream-json --verbose --no-session-persistence --max-budget-usd 2`, cwd = fresh temp folder. Never `--bare`.
- Markup sources: viewer `annotations.json` (first), Acrobat `annotations.parquet` + `annotation-links.parquet` (wins when present), `/Annots` fallback (no links).
- Original PDF never modified. Save review → `<name>-reviewed.pdf` (no stacked suffix), replace any existing `review-decisions.parquet`, other attachments byte-identical, EmbeddedFiles name tree sorted.
- Change kinds: `set_parameter` (instance|type) and `change_type` only.
- Shell commands one at a time; tests: `dotnet test tests/MarkupReview.Core.Tests`.

## Review Focus

- **A markup tied to an element that appears in no `elements.parquet` row** (viewer tie to a stale key) → markup listed with handle status `missing`, not a crash. Test in Task 1.
- **Value strings Claude formats loosely** ("1hr", "1 HR ", a length in feet-inches) → validator either normalises to an allowed value or rejects with a message naming allowed values; never stages a raw unparsed string for a non-text parameter. Test in Task 2.
- **Claude exits early, crashes, or hits the budget cap** (stream ends without `finish_review`) → panel shows "Claude stopped: <reason>", proposals so far kept. Test (stream parser) in Task 3.
- **The user edits or deletes the element between proposal and Approve** → Approve re-validates and refuses with a reason. Test in Task 2 (re-validate path); manual check in Task 5.
- **A second import while a review is running** → button refuses ("finish or cancel the current review") rather than spawning a second Claude. Manual check in Task 4.

---

### 🔴 Task 1: Core library — returned-PDF reading and the review session

**Files:**
- Create: `src/MarkupReview.Core/MarkupReview.Core.csproj` (net8.0; PDFsharp 6.2.4, Parquet.Net 6.1.0; lock file like the add-in)
- Create: `src/MarkupReview.Core/ReturnedPdf.cs`, `ExportTables.cs`, `MarkupSources.cs`, `ReviewSession.cs`
- Create: `tests/MarkupReview.Core.Tests/` (xUnit) with `Fixtures/FixturePdf.cs` (builds synthetic enhanced PDFs in code with PDFsharp + Parquet; no binary fixtures committed)
- Modify: `src/EnhancedPdfs/EnhancedPdfs.csproj` (ProjectReference to Core)

**Interfaces — Produces:**
- `ReturnedPdf.Open(string path) -> ReturnedPdf` with `IReadOnlyDictionary<string, byte[]> Attachments`, `int PageCount`, `string Path`.
- Read-side records mirroring `src/EnhancedPdfs/DrawingData.cs` column names: `ExportedDrawing`, `ExportedElement`, `ExportedParameter` (only the columns we use), loaded by `ExportTables.Load(ReturnedPdf) -> ExportTables` (`Drawings`, `ElementsByKey`, `ParametersByOwner`).
- `Markup(string Id, int Page, string Kind, string? Text, string? Author, DateTimeOffset? Created, PdfRect Rect, IReadOnlyList<MarkupLink> Links)`; `MarkupLink(string ElementKey, string Relation)`; `PdfRect(double X0, double Y0, double X1, double Y1)` in PDF user space.
- `MarkupSources.Read(ReturnedPdf, ExportTables) -> (IReadOnlyList<Markup> Markups, string Source)` where `Source` ∈ `"acrobat" | "viewer" | "annots"`.
- `ReviewSession` holding `Markups`, `Proposals` (`Proposal` record: `Id`, `MarkupId`, `ElementKey`, `Change`, `Reason`, `Status`, `OldValue`, `NewValue`, `AffectsCount`, `BlockReason`), `Notes`, events `ProposalAdded`, `NoteAdded`, `Finished`. `Change` = `SetParameter(string Name, ParamScope Scope, string Value)` | `ChangeType(string TypeName)`. `ProposalStatus` = `Pending | Approved | Rejected | Blocked`.

**Steps:**
- [ ] Tests first: `Reads_viewer_annotations_json_ties` (rect tied to `ElementKey` of wall 676281 → one `linked` link; viewer top-left coords converted to PDF user space for a page with MediaBox `[-1512.12 -1080 1512.12 1080]`), `Untied_viewer_text_has_no_links`, `Element_id_mentioned_in_text_becomes_referenced_link` (4–9 digit ID present in elements → `referenced`), `Tie_to_unknown_key_is_kept_with_missing_status`, `Acrobat_tables_win_over_viewer_json`, `Falls_back_to_annots_when_no_markup_attachments`, `Exporter_tables_round_trip` (fixture writes rows, `ExportTables.Load` reads them).
- [ ] Run: `dotnet test tests/MarkupReview.Core.Tests` → FAIL (types missing).
- [ ] Implement. Read embedded files via PDFsharp (`/Names/EmbeddedFiles` tree walk, bounded like the Acrobat fix in `poc/smart-annotations` 0d3373a). Viewer coords: invert the page's crop/rotation (rotation 0 is enough for the PoC; reject rotated pages with a clear message). Acrobat schema per that branch's spec (`AnnotationId`, `Page`, `Kind`, `Text`, `Author`, `Status`≠`Deleted`, `SheetRect` list<double> x0,y0,x1,y1).
- [ ] Run tests → PASS. Build add-in: `dotnet build src/EnhancedPdfs -c Debug` → succeeds.
- [ ] Commit `feat(core): read returned PDFs, markups and export tables`.

### 🟡 Task 2: Model gateway contract, proposal validation, decisions writer

**Files:**
- Create: `src/MarkupReview.Core/IModelGateway.cs`, `ProposalValidator.cs`, `ElementMatcher.cs`, `DecisionsWriter.cs`
- Test: `tests/MarkupReview.Core.Tests/FakeModelGateway.cs`, `ValidatorTests.cs`, `MatcherTests.cs`, `DecisionsWriterTests.cs`

**Interfaces — Produces:**
- `IModelGateway` (all methods may be called from any thread; the Revit impl marshals): `string ModelKey`, `string Title`, `Task<ModelElement?> FindAsync(string uniqueId)`, `Task<IReadOnlyList<ModelType>> ListTypesAsync(string uniqueId)`, `Task<ParameterOptions> GetOptionsAsync(string uniqueId, string parameter, ParamScope scope)`.
- `ModelElement(string UniqueId, string VersionGuid, string Category, string? Family, string? Type, bool IsLinked, IReadOnlyList<ModelParameter> Parameters, int TypeInstanceCount)`; `ModelParameter(string Name, ParamScope Scope, string Storage, string? DisplayValue, bool ReadOnly)`; `ParameterOptions(string Storage, IReadOnlyList<string>? Allowed, string? Unit)`.
- `ElementMatcher.Match(ExportedElement, ModelElement?) -> MatchStatus` = `Matched | ChangedSinceExport | Missing | LinkedModel`.
- `ProposalValidator.ValidateAsync(Proposal, IModelGateway, ExportTables) -> ValidationResult(bool Ok, string? Error, string? OldValue, string? NormalisedValue, int AffectsCount)`.
- `DecisionsWriter.Write(ReturnedPdf source, ReviewSession, string reviewer) -> string outputPath`.

**Steps:**
- [ ] Tests: `Unknown_parameter_rejected_with_name_list`, `Readonly_parameter_rejected`, `Integer_param_rejects_non_number`, `Allowed_values_normalised_case_and_whitespace` ("1 hr " → "1 HR" when allowed), `Text_param_accepts_any_string`, `Type_param_reports_instance_count` (fake: 14), `Unknown_type_name_rejected`, `Missing_element_is_blocked`, `Revalidate_after_value_changed_reports_new_old_value`, `Value_already_set_is_rejected_as_already_matches` (re-import after approval); matcher: `Version_guid_change_is_changed_since_export`, `Linked_element_is_linked_model`; writer: `Writes_reviewed_copy_with_identical_original_attachments` (compare bytes of all five exporter attachments), `Replaces_existing_decisions_attachment`, `Does_not_stack_reviewed_suffix`, `Embedded_files_name_tree_sorted`.
- [ ] Run → FAIL; implement; run → PASS.
- [ ] Commit `feat(core): gateway contract, proposal validation, review decisions`.

### 🔴 Task 3: MCP review server, Claude launch, bridge

**Files:**
- Create: `src/MarkupReview.Core/Mcp/McpServer.cs` (hand-rolled JSON-RPC 2.0, newline-delimited over a `Stream`: `initialize`, `notifications/initialized`, `tools/list`, `tools/call`, `ping`), `Mcp/ReviewTools.cs`
- Create: `src/MarkupReview.Core/Claude/ClaudeLaunch.cs` (args + session MCP config JSON + fixed prompt), `Claude/StreamEvents.cs` (stream-json line → `ProgressEvent`)
- Create: `src/MarkupReview.Bridge/MarkupReview.Bridge.csproj` (net8.0 exe, output copied next to add-in), `Program.cs` (args `--pipe <name> --token <t>`; connect `NamedPipeClientStream`, send token line, then copy stdin→pipe and pipe→stdout)
- Test: `tests/MarkupReview.Core.Tests/McpServerTests.cs`, `ClaudeLaunchTests.cs`, `StreamEventsTests.cs`

**Interfaces:**
- Consumes: `ReviewSession`, `IModelGateway`, `ProposalValidator`, `ExportTables` (Tasks 1–2).
- Produces: `McpServer.RunAsync(Stream input, Stream output, ReviewTools tools, CancellationToken)`; `ReviewTools(ReviewSession, IModelGateway, ExportTables)` exposing exactly `list_markups`, `get_element`, `get_parameter_options`, `list_types`, `propose_change`, `add_review_note`, `finish_review` (schemas per spec table); server name `revit` so tools appear as `mcp__revit__*`. `ClaudeLaunch.Build(string bridgePath, string pipe, string token, string workDir) -> ProcessStartInfo`. `StreamEvents.Parse(string line) -> ProgressEvent?` (`Thinking(string)`, `ToolCall(string name)`, `Result(bool isError, string? subtype, double? costUsd)`).

**Steps:**
- [ ] Tests: `Tools_list_has_exactly_the_seven_review_tools`, `No_tool_name_suggests_model_write` (no `set_`/`apply`/`delete` names), `Propose_change_invalid_returns_isError_and_stages_nothing`, `Propose_change_valid_adds_pending_proposal_with_reason`, `Finish_review_raises_finished`, `Unknown_method_returns_jsonrpc_error_-32601`; launch: `Args_never_contain_bare`, `Args_contain_strict_mcp_and_empty_tools`, `Mcp_config_points_to_bridge_with_pipe_and_token`; stream: `Parses_tool_use_event`, `Result_error_max_budget_is_reported` (`subtype: "error_max_budget_usd"`), `Ignores_unknown_lines`.
- [ ] Run → FAIL; implement; run → PASS.
- [ ] Smoke test outside Revit: a throwaway console harness (not committed) that hosts `McpServer` on a pipe with `FakeModelGateway` + a fixture PDF, then run the real `claude -p` command from `ClaudeLaunch` → Claude lists markups and proposes changes. Record the observed stream-json event names; adjust `StreamEvents` if they differ.
- [ ] Commit `feat(core): review MCP server, Claude launch, stdio bridge`.

### 🔴 Task 4: Revit integration — gateway, import command, Claude run

**Files:**
- Create: `src/EnhancedPdfs/Review/RevitModelGateway.cs` (ExternalEvent queue; `FindAsync` via `doc.GetElement(uniqueId)`, parameters via `Element.Parameters` + type's, `ListTypesAsync` via `GetValidTypes()`), `Review/ReviewController.cs` (one active session; pipe server with token check; starts/cancels `claude`; feeds `ProgressEvent`s to the pane), `Review/ImportCommand.cs`
- Modify: `src/EnhancedPdfs/ExportApplication.cs` (third button "Import marked-up PDF"; register dockable pane id), `src/EnhancedPdfs/EnhancedPdfs.csproj` (TFM `net8.0-windows10.0.19041.0`, reference Bridge so its exe lands in output), `scripts/Install-RevitAddin.ps1:21`

**Steps:**
- [ ] Implement import: file dialog → `ReturnedPdf` → `ExportTables` → `MarkupSources` → ModelKey stop / title warning → match all linked elements (`ElementMatcher`) → session → show pane → launch Claude. `claude` missing → pane message "Install Claude Code and run `claude auth login`". Second import while running → refuse.
- [ ] Manual check in Revit 2025 (`scripts/Install-RevitAddin.ps1`, Snowdon Towers test copy, viewer-marked A101): proposals appear one by one; Revit stays navigable; Cancel kills the process and keeps proposals; wrong project → stop message, no Claude process.
- [ ] Commit `feat(revit): import marked-up PDF and run Claude review`.

### 🔴 Task 5: Review panel and Approve/Reject

**Files:**
- Create: `src/EnhancedPdfs/Review/ReviewPane.xaml(.cs)` (dockable pane: header with PDF name, `n / m done`, status line, Cancel, Save review; filter chips All · Pending · Notes · Done; cards per spec), `Review/MarkupCrop.cs` (`Windows.Data.Pdf` render of page region around `Markup.Rect` + 10% margin → `BitmapSource`), `Review/EnlargeWindow.xaml(.cs)`, `Review/ApplyChange.cs`

**Steps:**
- [ ] Implement cards (pills `pending`/`approved`/`rejected`/`note`/`blocked`; blocked shows reason, no Approve; type params show "affects N <category>"). Approve → ExternalEvent → re-validate → `Transaction("Markup: <title> <param|Type>")` → set value (`Parameter.SetValueString` for measurable, `Set` for others) or `Element.ChangeTypeId` → status; failure rolls back and shows Revit's message. Reject → optional reason dialog. Save review → `DecisionsWriter`.
- [ ] Manual acceptance (spec steps 2, 4, 5, 6, 8): approve wall 676281 → Fire Rating 1 HR, single Ctrl+Z restores 2 HR; reject door with reason; deleted door → blocked; Save review → reviewed copy; verify attachments with `uv run --script scripts/verify_pdf.py <reviewed.pdf>`.
- [ ] Commit `feat(revit): review pane with approve/reject and saved decisions`.

### 🟡 Task 6: Previews on the model

**Files:**
- Create: `src/EnhancedPdfs/Review/Preview.cs` (select → open view by `ViewUniqueId` of markup's drawing else active view if element visible → `UIView.ZoomAndCenterRectangle` on bbox; orange highlight via `TemporaryViewModes`/override applied in a rolled-back-safe way that never hits undo or save), `Review/ChangeTagServer.cs` (`IDirectContext3DServer`: old→new tag quad + type-swap ghost outline from new type's geometry at the element's transform)

**Steps:**
- [ ] Implement; verify the highlight is gone after deselect and after closing the pane, Undo list contains no preview entries, saving the model does not persist the override.
- [ ] Manual acceptance (spec step 3): each proposal zooms, highlights, tags; door shows ghost.
- [ ] Commit `feat(revit): on-model previews for proposals`.

### 🟢 Task 7: Docs and end-to-end run

**Files:**
- Modify: `README.md` (section "Review a marked-up PDF": prerequisites — Claude Code logged in; flow; what is written)

**Steps:**
- [ ] Run full spec acceptance 1–9 on Snowdon Towers; note results in the PR description.
- [ ] Run `dotnet test tests/MarkupReview.Core.Tests` → all PASS.
- [ ] Commit `docs: markup review workflow`.
