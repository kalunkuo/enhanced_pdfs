# Acrobat smart-markup plug-in — design

Status: draft for review · 2026-11-14 · branch `poc/smart-annotations`

## Intent

We send an enhanced PDF (Revit drawing + Parquet BIM tables, see `README.md`) to an external
contractor. They mark it up and send it back. We want every markup in the returned PDF to know
which Revit elements it is about, so our separate smart viewer can show it.

The contractor will not change their workflow for us. The pitch to them is: *"please install this
plug-in; you don't need to change anything."* They keep using Acrobat's own comment tools. The
plug-in links markups to elements silently and writes the links into the PDF on save.

As a small reward for installing it, the contractor can optionally click a drawn element and see
its properties (type, fire rating, function…).

This is a hackathon proof of concept. Where the real world is messy, we idealise the story so the
demo makes the case; we do not build for every edge case.

## Who uses it

- **Contractor** — Acrobat Standard or Pro on Windows. Writes comments and markups, nothing fancy.
  Should notice nothing beyond an installer.
- **Us** — receive the PDF back and read the annotation tables (smart viewer, built separately;
  `scripts/smart_annotations.py list` today).

## Goals

1. **Silent linking (must have).** Any markup the contractor creates or edits with Acrobat's native
   tools gets linked to the Revit elements under it, and to element IDs mentioned in its text.
   Markup types in scope: cloud/polygon, rectangle, ellipse, polyline, line/arrow, ink (pen),
   text box, sticky note. Text highlights are out of scope (my call): the only selectable text is
   the exporter's invisible text layer, tiled across the sheet and unrelated to the geometry
   beneath it, so area-linking a highlight would produce meaningless links.
2. **Sync on save (must have).** When the document is saved, the plug-in writes
   `annotations.parquet` and `annotation-links.parquet` into the PDF's attachments.
3. **Catch-up on open (must have).** When an enhanced PDF is opened, every in-scope markup is
   re-linked from its current geometry and text (cheap at PoC scale; this also repairs markups that
   were moved or edited elsewhere), markups without rows get rows, and rows whose markup is gone are
   marked deleted. **Only if this actually changed the tables** does the plug-in mark the document
   modified, so a file the contractor merely reads closes without a "Save changes?" prompt (my
   call). Changes are written on the next save.
4. **Click to inspect (nice to have).** A toolbar toggle "Inspect elements". While on, clicking the
   drawing shows a popup with the clicked element's category, family/type, and its parameters from
   `parameters.parquet` (instance and type). Goals 1–3 must not depend on this; it can be dropped.
5. **Portable core (story).** All smart logic sits in a host-independent core library; the Acrobat
   part is a thin adapter. The demo narrative is that PDF-XChange Editor is "just another adapter".

## Non-goals

- Custom annotation tools, panels, or a properties sidebar. The smart viewer is a separate project.
- Acrobat Reader support (cannot load unsigned plug-ins), Mac, Bluebeam.
- A PDF-XChange adapter (architecture must allow it; it is not built).
- Writing anything back into Revit; model-space coordinates.
- Editing model data from the PDF.
- Multi-user merge/conflict handling beyond the catch-up rule in goal 3.

## Anti-goals (failure even if it "works")

- **Never block the contractor.** If the plug-in fails (missing tables, bad data, DuckDB error), the
  markup and the save proceed normally; the markup simply stays unlinked. No error dialogs during
  normal markup; log instead.
- **Never damage the PDF's existing data.** The five exporter attachments must come out
  byte-identical. Lesson from the PoC: PDF name trees must stay sorted, and PyMuPDF's name lookups
  hit the wrong file once they are not. Treat the EmbeddedFiles name tree with the same care.
- **Never change how markups look** or behave in other viewers.
- **No noticeable lag** on markup creation or save for a typical sheet (~1–2k elements, dozens of markups).
- **No configuration** asked of the contractor after install.

## Constraints and facts

- Windows, Acrobat DC 64-bit, Standard or Pro. Plug-ins are `.api` DLLs in
  `C:\Program Files\Adobe\Acrobat DC\Acrobat\plug_ins`; "Use only certified plug-ins" must be off.
- Toolchain on the dev machine: Visual Studio 2022 Professional (C++ workload). The Acrobat SDK must
  be downloaded by the user (Adobe ID); nothing can be built before it is in place.
- Language: native C++ (my call — it keeps the contractor install to the plug-in plus one DLL).
  Parquet I/O via the **DuckDB C API**, bundled as `duckdb.dll` next to the plug-in (my call).
- Input PDFs come from `src/EnhancedPdfs` (Revit 2025 native PDF + PDFsharp enrichment). Today:
  - Revit wraps each element's drawing in marked content `/Element<ElementId> BMC … EMC`, nested
    inside `/ViewRegion<ViewId>-<n> /MC<k> BDC` per viewport. A tag carries only the ElementId.
  - Attachments are document-level: `drawings`, `elements`, `appearances`, `parameters`,
    `schedule-cells` `.parquet`. Join rules are in `README.md`.
  - MediaBox does not start at (0,0) (Snowdon A101: `[-1512.12 -1080 1512.12 1080]`). All geometry
    must be computed in PDF user space with full CTM handling; do not assume an origin.
  - One page per PDF today; do not hard-code that.
  - There is no structure tree.
- Element IDs are not unique across linked models; the full key is `ElementKey`. When a tag's ID
  matches several `ElementKey`s, link all of them (same as the PoC).

## Behaviour

### Element map (shared foundation for goals 1 and 4)

Per page, built lazily on first need and cached for the document's lifetime: ElementId → union
bounding box (PDF user space) of everything drawn inside its `/Element<id>` marked content. Built
by walking the page content (Acrobat PDEdit), recursing through containers and form XObjects.

### Linking rules (carried over from the PoC; tune only with evidence)

- **Area markups** (cloud, rectangle, ellipse, polygon, ink, text box, highlight): link an element
  when ≥ 50 % of its bbox area lies inside the markup's bbox, and the element's bbox is ≤ 4× the
  markup's area (excludes title block, viewports). Relation = `linked`.
- **Point-like markups** (sticky note; any markup whose rect is smaller than ~24 pt square): link the
  smallest element whose bbox contains the anchor point. Relation = `linked`.
- **Lines/arrows:** treat the arrowhead end point as a point-like anchor (my call: the arrow points
  at the thing being discussed).
- **Text mentions:** integers of 4–9 digits in the markup's contents that match an `ElementId` in
  `elements.parquet`, and are not already linked. Relation = `referenced`.
- Replies to a markup (Acrobat comment threads) are not separate annotations in the tables; their
  text is ignored for the PoC.

### Annotation identity

Each markup is keyed by its `/NM`. If a markup has no `/NM`, the plug-in assigns `ep-<uuid>`
(the only change it ever makes to a markup). The plug-in writes no custom keys on markups (my
call); `smart_annotations.py list` must match markups by `/NM` instead of the PoC's
`EP_SchemaVersion` marker.

### Tables (schema version 1, compatible with `scripts/smart_annotations.py`)

`annotations.parquet`: `AnnotationId` (= `/NM`), `DrawingId`, `Page` (int32), `Kind` (the markup's
subject, falling back to its subtype), `Subtype` (PDF annotation subtype), `Text`, `Author`,
`Status` (`Open` | `Deleted`), `CreatedUtc`, `ModifiedUtc`, `SheetRect` (list<double>: x0,y0,x1,y1
PDF user space), `SchemaVersion` (int32).

`annotation-links.parquet`: `AnnotationId`, `ElementKey`, `ElementId` (int64), `Relation`
(`linked` | `referenced`).

`DrawingId`: the placed view most linked elements appear in (`appearances.parquet`), else the
sheet's own drawing — same rule as the PoC.

Deleted markups keep their rows with `Status = Deleted` (for us, history beats silence).
`smart_annotations.py` must be updated to accept the two new columns and the `Deleted` status.

Existing tables written by the PoC script (without `Subtype`/`ModifiedUtc`) are migrated in place
under `SchemaVersion` 1: missing columns are filled with nulls (my call). Their rows are then
subject to the same re-linking as any other markup.

### Attachment safety

"Byte-identical" means the **extracted contents** of the five exporter attachments; Acrobat may
rewrite or recompress the PDF objects that hold them (my call). The plug-in may rebuild the
EmbeddedFiles name tree, provided the result is sorted by name and the five existing files'
contents are unchanged.

### Lifecycle

- **Open:** if the document has `elements.parquet`, it is an enhanced PDF; otherwise the plug-in
  does nothing at all for that document. Run catch-up (goal 3) in memory.
- **Markup created/changed/deleted:** update the in-memory tables; mark the document dirty.
- **Save:** write both tables into the attachments, keeping the name tree sorted and the other
  attachments untouched. Then let the save proceed.
- Any exception anywhere → log, skip, never surface to the contractor.

### Click to inspect (nice to have)

Toolbar toggle. While on, a click on the page maps to user space, finds the smallest element whose
bbox contains the point, and shows a simple popup: Element ID, Category, Family, Type, then
instance and type parameters (name → display value). Off by default; normal clicks are unaffected
when off.

### Install

A PoC-grade script (PowerShell, run as admin) that copies the `.api` and `duckdb.dll` into
`plug_ins` and turns off "Use only certified plug-ins" for the current user. An uninstall
counterpart removes them.

## Architecture

- `core/` — host-independent C++ static library: element map data structure (fed by the host),
  linking rules, DuckDB-backed table read/write (bytes in, bytes out), catch-up/reconcile logic.
  Unit-tested without Acrobat.
- `acrobat/` — the plug-in: SDK entry points, notifications (document open/save, annotation
  added/changed/deleted), content walking to feed the element map, attachment read/write via the
  SDK, toolbar toggle + popup.
- A future `pdfxchange/` adapter would reuse `core/` unchanged.

## Acceptance

1. Install on a machine with Acrobat Standard or Pro; Acrobat starts normally, no prompts.
2. Open `snowdon-towers-a101-enhanced.pdf` (untracked, in the main checkout:
   `C:\Users\sveress\GitHub\AECTech-Hackathons\SmartPDF\enhanced_pdfs\`); draw a cloud around wall 676281 near door 108E with
   Acrobat's own cloud tool; type a comment mentioning `676281`; save.
3. `uv run --script scripts/smart_annotations.py list <saved.pdf>` shows the cloud as `ok`, wall
   676281 `Exterior | 2 HR` linked, plus the other elements under it.
4. Add a sticky note on a door and an arrow pointing at a column; save; both are linked to that one
   element.
5. Delete a markup; save; its rows show `Deleted`.
6. Add a markup in a viewer without the plug-in; reopen in Acrobat with it; save (Save is enabled
   because catch-up changed the tables); the markup is linked. Reopening an already up-to-date file
   and closing it produces no "Save changes?" prompt.
7. The five original attachments are byte-identical before and after every step.
8. Rename `elements.parquet` (or open any ordinary PDF): no errors, no tables written, markup and
   save behave normally.
9. (Nice to have) Inspect toggle on, click wall 676281 → popup shows Function Exterior, Fire Rating 2 HR.

## Left to the builder

SDK specifics (which notifications and APIs), build system and project layout inside the two
folders, how DuckDB is fed bytes (temp file vs in-memory), logging location, popup UI details,
thresholds for "point-like", and how to stage the work.

## Open items for the user

- Download the Acrobat SDK (developer.adobe.com/acrobat, Adobe ID) and tell us where it is.
- Confirm the installed Acrobat edition (Standard or Pro) used for testing.
