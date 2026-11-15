# Markup reimport into Revit — design

Status: draft for review · 2026-11-14 · branch `feat/markup-reimport`

## Intent

An enhanced PDF leaves Revit with its BIM data inside (`README.md`). A contractor marks it up and
sends it back. Today the loop stops there: someone reads the markups and retypes the changes into
Revit by hand.

We want to close that loop inside Revit. The user clicks **Import marked-up PDF**, Claude reads
every markup together with the elements it is about, and turns each one into a concrete proposed
change ("Wall 676281 · Fire Rating 2 HR → 1 HR"). The user goes through the proposals in a review
panel, sees each change previewed on the model next to the contractor's original markup, and
approves or rejects it. Nothing reaches the model without an Approve click.

This is a hackathon proof of concept. The demo must make the case convincingly on the Snowdon
Towers sample; we do not build for every edge case.

## Who uses it

- **The reviewer** — a Revit user (architect / BIM coordinator) on Windows, Revit 2025, with
  Claude Code installed and logged in on the same machine.
- **The contractor** is upstream and unchanged: they mark up the PDF in our web viewer
  (`viewer/`, the PoC's path) or, later, in Acrobat with the smart-markup plug-in from
  `poc/smart-annotations`.

## Goals

1. **One button.** Add-Ins → Enhanced PDFs → **Import marked-up PDF** picks a returned PDF and
   starts the review. No terminal, no configuration beyond Claude Code being logged in.
2. **Claude interprets the markups.** Through a custom Revit MCP server, Claude reads each markup
   (text, kind, author, linked elements) and the current state of those elements in the open
   model, and produces either a **proposed change** or a **review note** (for markups that are not
   a concrete change, e.g. "check with structural"). It never guesses a change it cannot ground in
   the markup text.
3. **Change kinds in scope:** set a parameter value (instance or type parameter) and swap an
   element's type. Moves, deletes and new elements are out of scope for the PoC.
4. **Review panel** (combined layout agreed in the mockups, see below): queue of proposals with
   status and filters; selected proposal shows the contractor's markup crop, the old → new values,
   Claude's one-line reason, and **Approve** / **Reject…**.
5. **Preview on the model.** Selecting a proposal zooms the active view to the element, colours
   it, and tags it with the change. Type swaps also draw a ghost of the new type's outline.
   Previews are temporary graphics; they are not written to the model.
6. **Approve applies, Reject records.** Approve applies the one change in its own named Revit
   transaction (`Markup: Wall 676281 Fire Rating`), so Ctrl+Z undoes exactly that approval.
   Reject asks for an optional reason.
7. **Decisions travel with the PDF.** "Save review" writes a copy `<name>-reviewed.pdf` with an
   added `review-decisions.parquet` attachment (proposal, decision, reason, reviewer, time). The
   original PDF is never modified.

## Non-goals

- Moves, deletes, new elements, geometry edits, sheet/view edits.
- Claude making any model change directly. There is no MCP tool that writes to the model.
- Running from Claude Desktop / an interactive Claude session (the server allows it later; the
  PoC does not design for it).
- Multi-user review, merging several contractors' PDFs, round-tripping decisions back to the
  contractor's viewer.
- Linked models: proposals on elements from a linked model are shown as review notes ("element
  is in linked model X") instead of changes.
- An API key inside the add-in. Authentication is Claude Code's own login.

## Anti-goals (failure even if it "works")

- **A change lands in the model without an explicit Approve.** This is the core promise.
- **A proposal silently targets the wrong element** — e.g. because the model changed since export
  or an `ElementId` is reused. When the element cannot be matched with confidence, the proposal
  says so and cannot be approved.
- **Revit hangs** while Claude works. Interpretation runs out of process; the panel shows live
  progress and a Cancel button; the user can keep navigating.
- **Invented values.** A proposal to set a parameter to a value that is not valid for it (e.g. a
  type name that does not exist) must not be approvable.
- **Damaging the returned PDF.**

## Constraints and facts

- **Add-in:** `src/EnhancedPdfs`, C#, `net8.0-windows`, Revit 2025, WPF and WinForms enabled.
  Already references **Parquet.Net 6.1.0** and **PDFsharp 6.2.4**. The ribbon panel
  "Enhanced PDFs" is created in `ExportApplication.OnStartup`.
- **Exporter tables** (`src/EnhancedPdfs/DrawingData.cs`): `elements.parquet` rows carry
  `ElementKey`, `ModelKey`, `UniqueId`, `ElementId`, `LinkInstanceId`, `Category`, `Family`,
  `Type`, `TypeKey`, `VersionGuid`; `drawings.parquet` carries `ExportedUtc`, `ModelKey`,
  `ViewUniqueId`; `parameters.parquet` keyed by `OwnerKey` (= `ElementKey` or `TypeKey`).
- **Markup sources** — two exist, both tie markups to `ElementKey`:
  - Acrobat plug-in (`poc/smart-annotations`, spec
    `docs/superpowers/specs/2026-11-14-acrobat-smart-markup-plugin-design.md` on that branch):
    `annotations.parquet` (`AnnotationId`, `DrawingId`, `Page`, `Kind`, `Subtype`, `Text`,
    `Author`, `Status`, `CreatedUtc`, `ModifiedUtc`, `SheetRect`, `SchemaVersion`) and
    `annotation-links.parquet` (`AnnotationId`, `ElementKey`, `ElementId`,
    `Relation` = `linked` | `referenced`).
  - Web viewer (`viewer/src/lib/save.ts`, `types.ts`): an `annotations.json` attachment, each
    annotation with `id`, `page`, `kind`, `from`/`to`/`points` (top-left page coordinates),
    `text`, optional `elementKey`.
  - Fallback: neither present → read the PDF's markup annotations (`/Annots`) directly, with no
    links; Claude can still use element IDs mentioned in the text.
  - **Build order (decided):** the web-viewer `annotations.json` reader first; development and the
    demo use viewer-made PDFs. The dev machine has only Acrobat Reader, which cannot load the
    plug-in, and the plug-in branch is unmerged. The Acrobat-table reader follows once that branch
    lands; its schema is copied from the plug-in spec, not guessed. When a PDF has both sources,
    the Acrobat tables win (builder may refine).
  - Viewer markup kinds today: `line`, `rect`, `ellipse`, `pen`, `highlight`, `text`, `comment`,
    `signature` (no cloud yet). Viewer coordinates are top-left page space at scale 1; convert
    with the page's crop/rotation, not `pageHeight - y` (see `TASKS.md` coordinate contract).
- **Revit API is single-threaded.** Every model read and every write must run on Revit's thread
  (ExternalEvent / idling). Model reads requested by MCP tool calls are marshalled there.
- **Claude Code 2.1.325** is installed. Headless mode gives the needed control:
  `claude -p … --mcp-config <file> --strict-mcp-config --tools "" --allowedTools "mcp__revit__*"
  --output-format stream-json --max-budget-usd <n>`. No built-in tools (no shell, no file access),
  only our MCP tools, a spend cap, a live event stream. Do **not** use `--bare` (it ignores the
  OAuth login and requires an API key).
- Default model: Claude Code's default (currently Opus 5.5); not pinned by the add-in.

## Approaches considered

1. **Add-in calls the Claude API directly** (C# SDK, in-process tools). Fewest pieces, but needs
   an API key in the add-in and the tools only exist behind this button. Not chosen: the user
   wants the Revit MCP story.
2. **Fork an existing open-source Revit MCP** (e.g. bimwright/rvt-mcp, Apache-2.0, C#, 200+
   tools) and add a review module. Not chosen: a second add-in, a large tool surface to fence off
   so Claude cannot bypass Approve, and our Parquet/markup logic would still be ported in.
3. **Our own small Revit MCP server, inside the `EnhancedPdfs` add-in, driven by headless Claude
   Code from a Revit button.** **Chosen.** One add-in; the tool surface is review-only, so
   "Claude cannot write to the model" holds by construction; reuses the add-in's Parquet/PDF code
   and key scheme; it is a standard MCP server, so other Claude clients could connect later.

## Design

### Flow

1. **Import.** The button opens a file dialog for the returned PDF. The add-in reads the
   attachments (exporter tables + whichever markup source exists) and builds an in-memory
   **review session**: markups, their linked `ElementKey`s, and the matching elements in the
   open document.
2. **Match check (deterministic, before Claude).** For each linked element: find it in the open
   document by `UniqueId` (host model only; `ModelKey` must match the open document). Compare
   `VersionGuid` to the element's current version. Results: `matched`, `changed since export`,
   `missing`, `linked model`. Also check that the PDF's `ModelKey` matches the open document;
   if not, stop with a clear message before calling Claude.
3. **Interpret.** The add-in writes a session MCP config and launches headless Claude Code with
   a fixed review prompt (below). Claude calls the review tools; every `propose_change` /
   `add_review_note` call lands in the panel immediately, so proposals appear one by one while
   Claude works. The panel shows the stream's progress text and a Cancel button (kills the
   process; proposals made so far stay).
4. **Review.** The user selects proposals, sees preview + markup crop, approves or rejects.
5. **Save review** (optional) writes `<name>-reviewed.pdf`.

**Re-import (my call):** every import starts a fresh session and a fresh Claude run; an existing
`review-decisions.parquet` in the input is ignored for interpretation (the model itself already
reflects approved changes, so their markups re-check as "already matches"). Save review replaces
any existing `review-decisions.parquet` attachment rather than adding a second one, and does not
stack suffixes (`X-reviewed.pdf` saves as `X-reviewed.pdf`, after a confirm-overwrite dialog).

**Model identity (my call, accepted risk):** the hard stop compares the PDF's `ModelKey`
(`ProjectInformation.UniqueId`, `DrawingCollector.cs`) with the open document's. Projects
created from the same template may share it, so additionally compare the exported model name
(`drawings.Model`) with the document title and show a non-blocking warning when they differ.
Per-element `UniqueId` + `VersionGuid` matching remains the real guard against wrong targets.

### MCP server — tools

Every tool is read-only on the model; the "propose" tools only add to the review session.
Tool results use element **handles** = `ElementKey` from the PDF, never raw `ElementId`s.

| Tool | Purpose |
| --- | --- |
| `list_markups()` | All markups in the session: id, kind, author, text, page, linked handles with relation (`linked`/`referenced`), and each handle's match status. |
| `get_element(handle)` | Current state from the **open model**: category, family, type, instance and type parameters (name, storage type, current display value, read-only flag), plus the exported value from the PDF where it differs. |
| `get_parameter_options(handle, parameter)` | Valid values where Revit can enumerate them (yes/no, element-id parameters, …); otherwise the storage type and units, so Claude can format a value. |
| `list_types(handle)` | Types the element can be swapped to (same category / family where applicable). |
| `propose_change(markup_id, handle, change, reason)` | `change` is either `{set_parameter: {name, scope: instance|type, value}}` or `{change_type: {type_name}}`. The server **validates** before accepting: element matched, parameter exists and is writable, value parses for its storage type / is a valid option, type exists. Invalid → returns an error to Claude (so it can correct itself) and nothing is staged. `reason` is the one-line explanation shown in the panel. |
| `add_review_note(markup_id, text)` | For markups that are not a concrete change, or that Claude cannot resolve. |
| `finish_review(summary)` | Marks interpretation done; summary shown at the top of the panel. |

A type-parameter change affects every instance of that type; `propose_change` reports the
instance count and the panel shows it ("affects 14 walls").

### Fixed review prompt (shape, wording left to the builder)

Go through every markup from `list_markups`. For each: read the linked elements; decide whether
the markup asks for a parameter change or a type swap that is stated or clearly implied by its
text; if so, call `propose_change` with the exact value and a one-line reason that cites the
markup's words; otherwise call `add_review_note`. Never propose a value the markup does not
support. One markup may yield several proposals (e.g. a cloud over three walls). Finish with
`finish_review`.

### Process and transport

My call: Claude Code launches a small **stdio bridge** executable (shipped with the add-in) as
the MCP server; the bridge forwards MCP messages to the add-in over a **named pipe** with a
per-session name and token. This avoids hosting an HTTP server inside Revit's process. The
add-in owns the session state and executes tool calls on Revit's thread. The C# MCP SDK
(`ModelContextProtocol` NuGet) or a hand-rolled JSON-RPC handler are both acceptable — builder's
call.

The add-in launches `claude` with the working directory set to a per-session temp folder (no
repo, no `CLAUDE.md` picked up), `--strict-mcp-config`, `--tools ""`, `--allowedTools
"mcp__revit__*"`, `--output-format stream-json`, a spend cap (default `$2`, my call), and
`--no-session-persistence`. If `claude` is not on `PATH` or not logged in, the panel says so
with the command to fix it (`claude auth login`).

### Review panel (agreed layout: queue from A + markup crop from C)

A Revit **dockable pane**, WPF.

```
┌─ Revit view (zoomed to element) ───────────┬─ Markup review panel ───────┐
│                                            │ All 7 · Pending 4 · Notes 1 │
│   ███ wall 676281 (orange)                 │ ✓ Door 108E → 36"×84"       │
│   [Fire Rating 2 HR → 1 HR]                │ ▸ Wall 676281 · Fire Rating │
│                                            │   ┌ PDF crop: cloud + text ┐│
│                                            │   └────────────── ⤢ enlarge┘│
│                                            │   2 HR → 1 HR               │
│                                            │   Claude: why it thinks so  │
│                                            │   [Approve]  [Reject…]      │
└────────────────────────────────────────────┴─────────────────────────────┘
```

- **Header:** PDF name, progress (`2 / 7 done`), Claude status line while running, Cancel,
  Save review.
- **Filters:** All · Pending · Notes · Done.
- **Cards:** status pill (`pending`, `approved`, `rejected`, `note`, `blocked`), one-line title.
  Selected card expands to: markup crop (rendered from the PDF page around the markup's rect,
  with margin), author · kind · date, old → new table, instance-count warning for type params,
  Claude's reason, Approve / Reject….
- **Blocked** proposals (element missing / changed since export with a conflicting current
  value / linked model) show why and have no Approve button.
- **Enlarge** opens a floating window with a bigger crop.
- Markup crop rendering: Windows' built-in `Windows.Data.Pdf` renderer (my call, no new
  library); builder may substitute PDFium if that API is unavailable from the add-in.

### Preview on the model

- On select: switch to (or stay in) a view where the element is visible — prefer the view
  matching the markup's `DrawingId` (`ViewUniqueId` in `drawings.parquet`), else the active view
  if the element is visible there; zoom to the element's bounding box.
- Highlight via **temporary view graphic overrides** (orange), removed on deselect / close;
  done in a transaction that is rolled back or in a temporary-view-mode, so it never enters the
  undo stack or the saved model. (Builder: pick the mechanism that guarantees this.)
- The old → new tag and the type-swap ghost are drawn with **DirectContext3D** (transient,
  not model elements). For a type swap, the ghost is the new type's outline at the element's
  location (e.g. a wider door swing).

### Applying

- Approve runs on Revit's thread: re-validate (element still matched, value still valid), then
  one `Transaction` named `Markup: <Element> <Parameter|Type>`; commit; card turns `approved`.
  On failure, roll back and show the Revit error on the card.
- If the current value has changed since the proposal was made, re-confirm in the card instead
  of applying blindly.

### Data written back (goal 7)

`review-decisions.parquet` (schema version 1): `ProposalId`, `AnnotationId`, `ElementKey`,
`ChangeKind` (`set_parameter` | `change_type` | `note`), `Parameter`, `Scope`, `OldValue`,
`NewValue`, `Reason` (Claude), `Decision` (`approved` | `rejected` | `pending` | `note`),
`DecisionReason`, `Reviewer` (Revit user name), `DecidedUtc`. Written into a copy of the PDF;
all existing attachments keep identical bytes and the EmbeddedFiles name tree stays sorted (same
lesson as the Acrobat plug-in spec).

## Acceptance (Snowdon Towers A101)

1. In a test copy of Snowdon Towers, export A101 as an enhanced PDF. In the web viewer draw a
   rectangle tied to wall 676281 with "should be 1 HR per code review", a comment tied to door
   108E "use 36in door", and an untied text box "check with structural". Save the PDF.
   (Later, once the Acrobat reader exists: repeat with Acrobat + plug-in and a cloud.)
2. In Revit, click **Import marked-up PDF**, choose the file. Within ~2 minutes the panel shows:
   a Fire Rating proposal for wall 676281 (2 HR → 1 HR, type parameter, with instance count),
   a type-swap proposal for door 108E to an existing 36"-wide type, and a note for "check with
   structural". Revit stays responsive throughout.
3. Selecting each proposal zooms to the element, highlights it, shows the tag (and ghost for the
   door), and shows the contractor's markup crop.
4. Approve the wall: Fire Rating is 1 HR; one Ctrl+Z restores 2 HR. Reject the door with a
   reason: the model is unchanged.
5. No proposal targets an element that the markup did not link or mention.
6. Delete door 108E from the model, re-import: the door proposal is `blocked` ("element no longer
   in model"), with no Approve button.
7. Open a different project and import the PDF: a clear "this PDF was exported from another
   model" message; Claude is not launched.
8. Save review → `A101-returned-reviewed.pdf`; its original attachments are byte-identical and
   `review-decisions.parquet` lists both decisions and the note.
9. With `claude` missing from `PATH`, the button shows how to install/log in, nothing crashes.

## Left to the builder

- MCP library vs hand-rolled JSON-RPC; bridge packaging and the pipe protocol.
- Exact Revit mechanisms for non-undoable highlighting and for the DirectContext3D tag/ghost.
- Prompt wording and the stream-json → progress-line mapping.
- WPF styling (follow the viewer's design tokens in `viewer/docs/design-system.md` loosely, if it
  helps).
- Markup crop margin and resolution.

## Backlog

- **On-model ghost for size changes (goal 5, deferred 2026-11-15).** Today a type swap shows its size delta in
  the card (Width/Height/Thickness from the types' built-in parameters) and the preview zooms to and selects the
  element. Still to build: a DirectContext3D server drawing the current outline (orange) and the proposed
  type's outline (dashed green) at the element's location. Cheaper first version: a box at the new
  width/thickness rather than the new family's real geometry (real geometry needs a rolled-back type swap to
  read it). Only verifiable inside Revit.
- **The old → new tag on the canvas** (same DirectContext3D server).

## Iteration 2 (2026-11-15, approved: "all five in this order")

Context: on `snowdon-towers-a101-enhanced.pdf` every markup became a note — door flips and a thicker wall are not
parameter/type changes, and an arrow + text box pair could not be combined. The user is fine with Claude
misreading a markup as long as the panel jumps to the right place.

- **A. Every card zooms.** Selecting a note (not only a proposal) selects and zooms to all host-model elements the
  markup is tied to, in the markup's view when they are visible there.
- **2. Related markups.** `propose_change` takes optional `related_markup_ids`; the handle may be linked by the
  markup or any related one (arrow + text box). The card quotes all of them.
- **1. Flip.** New change kind `flip` (`facing` | `hand`) for family instances Revit allows to flip; old/new read
  "not flipped"/"flipped". Applied with `flipFacing()`/`flipHand()` in one named transaction.
- **B. "Approve, but…".** A third button takes an instruction; a short follow-up Claude run (same tools, after the
  main run has finished) gets the markup, the proposal and the instruction and calls `propose_change` with
  `replaces = <proposal id>`. The old proposal becomes `revised` (shown under Done, decision recorded with the
  instruction); the new one is pending. If Claude cannot, it adds a note and the original stays pending.
- **3. New wall type at a thickness.** New change kind `new_wall_type` (`width`, optional `type_name`) for basic walls:
  duplicate the wall's type, widen or narrow its thickest core layer by the difference, swap the wall to it. Rejected
  when the name exists (use `change_type`) or the element is not a basic wall. Card shows the width change.
