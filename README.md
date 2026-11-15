# Enhanced PDFs for Revit

Export Revit drawings with their BIM data inside the PDF. The add-in uses Revit's native PDF export settings and adds an invisible, searchable text layer plus Apache Parquet attachments. Inspired by the [Speckle enhanced PDF demonstration](https://www.linkedin.com/feed/update/urn:li:activity:7524888428274950144/).

```mermaid
flowchart TD
    A["Active Revit drawing or view/sheet set"] --> C["Export the native PDF"]
    C --> D["Collect BIM data for each PDF page"]
    D --> E["Invisible searchable text on each page"]
    D --> F["Parquet attachments for the whole file"]
    C --> G["Save the enhanced PDF"]
    E --> G
    F --> G
```

## Install in Revit 2025

In the Windows guest, close Revit and run the following from the repository root in PowerShell. A source build requires a local Revit 2025 installation and the .NET SDK matching its runtime: Revit 2025.0–2025.4 runs on .NET 8, later 2025 updates on .NET 10 (the installer reads `RevitAPI.runtimeconfig.json` and builds for the right one).

```powershell
.\scripts\Install-RevitAddin.ps1
```

Use `-RevitPath` for a non-default Revit installation. Use `-BuildDirectory` to install an existing Release build without the SDK. The installer writes a per-user Revit add-in manifest and copies the build to the guest's local disk. On launch, Revit may prompt you to load the unsigned local build. Choose **Load Once** for the current session. You can save exported PDFs directly to your Mac through a Parallels shared folder.

## Export and inspect

- **One drawing.** Open the view or sheet, click its drawing canvas, and select **Add-Ins → Enhanced PDFs → Export Enhanced PDF**.
- **A set.** Select **Add-Ins → Enhanced PDFs → Export Sheet Set**, then choose **Project sheets** or a saved Revit view/sheet set. Check the drawings to include, choose a destination, and save one combined PDF. Project sheets appear in sheet-number order, with sheets containing live 3D views unchecked by default. Check those sheets individually or use **Select all** to include them. Saved sets start with every drawing checked in Revit's stored order.

Use the viewer's search or extract the page text to find drawing names, element IDs, and common properties. Open the PDF attachments to read instance and type parameters exposed by Revit.

For example, ask a PDF reader that extracts text: **“What Fire Rating values are assigned to the exterior walls on this drawing? Cite the Revit element IDs and distinguish blank ratings.”** The text layer includes each wall's Revit Function and Fire Rating, with a summary per view. A blank Fire Rating is reported as unspecified.

### Embedded tables

| Attachment | Rows |
| --- | --- |
| `drawings.parquet` | Each exported sheet or view and its placed views or schedules, with one-based PDF page numbers, placement identifiers, revisions, and export metadata |
| `elements.parquet` | Elements with Revit element IDs, unique IDs, categories, types, and common properties |
| `appearances.parquet` | Element membership per drawing or placed view |
| `parameters.parquet` | Populated instance and type parameters, including Revit display values and raw typed values |
| `schedule-cells.parquet` | Text Revit exposes for sheet schedules, when present |

Join appearances to drawings on `DrawingId` and to elements on `ElementKey`. An element shown on multiple pages has one element record and an appearance for each drawing in which it occurs. Join instance parameters using `OwnerKey = ElementKey` and type parameters using `OwnerKey = TypeKey`. Use the view and model identifiers alongside element IDs when checking linked elements. Share the enhanced PDF only with recipients who should receive its embedded model properties.

For plans, elevations, sections, details, and 3D views, membership is collected from Revit's drawing callbacks. Sheet-owned elements and schedule cells use the corresponding Revit APIs. Elements from view types such as legends and drafting views use their view-owned element lists. View data follows Revit's custom exporter, so its callbacks can differ from the PDF engine where printing hides annotations or rasterizes effects. Split schedules currently include data for the full schedule. Linked schedule rows contribute displayed cell text. Imported CAD or raster graphics carry the Revit container's properties when it is exposed.

## Review a marked-up PDF

When an enhanced PDF comes back with markups, select **Add-Ins → Enhanced PDFs → Import marked-up PDF** in the project it was exported from. Claude reads each markup and the elements it is tied to, and proposes a concrete change: a parameter value or a type swap. Markups that are not a model change become notes. Proposals appear one at a time in the **Markup review** panel while Claude works, so you can start deciding straight away.

- **Approve** applies one change in its own undoable transaction (`Markup: Walls 676281 Fire Rating`). It re-checks the element first and refuses if it changed since the proposal. Type swaps also show the dimensions that change.
- **Reject…** takes an optional reason. Nothing is written to the model.
- Clicking a card zooms to the element and shows the contractor's markup cropped from the PDF.
- **Save review** writes `<name>-reviewed.pdf` with a `review-decisions.parquet` attachment. The original PDF is never modified; if the `-reviewed.pdf` already exists (or is the file you imported), the panel asks before replacing it.
- **Stop Claude** ends the analysis and keeps the proposals so far. **End review** discards pending proposals and closes the panel; approved changes stay (Ctrl+Z reverts them).

Requirements: [Claude Code](https://claude.com/claude-code) installed and signed in (`claude auth login`) on the same machine. The add-in runs it headless with only the review tools: Claude can read the model and stage proposals, but no tool changes the model. Each run is capped at $2. Markups come from the web viewer (`annotations.json`), the Acrobat smart-markup plug-in (`annotations.parquet`, `annotation-links.parquet`), or plain PDF annotations. Each import writes a log under `%TEMP%\…\EnhancedPdfs-review\` (`latest.txt` points to the newest). Design: `docs/superpowers/specs/2026-11-14-markup-reimport-design.md`.

## Verify a PDF

Run the verifier to check the page-to-drawing mapping, Parquet tables, and searchable text. Pass the native PDF for the same drawings and page order to compare every rendered page.

```sh
uv run --script scripts/verify_pdf.py enhanced.pdf --native revit-native.pdf
```

For an exact pixel comparison, use the native PDF from the same export run. Revit can print the export time in the title block, which changes between independent exports.

### Snowdon Towers verification

In Revit 2025.4, open sheet **A101 – First Floor Plan** in Autodesk's Snowdon Towers architectural sample. In its placed **L1** plan, use **Manage → Select by ID** for wall `676281`. Its type properties show **Function** as **Exterior** and **Fire Rating** as **2 HR**.

```sh
uv run --script scripts/verify_pdf.py enhanced.pdf --native revit-native.pdf --wall-id 676281 --rating '2 HR'
```

In a test copy, use **Hide Elements** on that wall in **L1** and export **A101** again. The next PDF should exclude wall `676281` from its searchable text and Parquet data.

```sh
uv run --script scripts/verify_pdf.py hidden-wall.pdf --excluded-id 676281
```
