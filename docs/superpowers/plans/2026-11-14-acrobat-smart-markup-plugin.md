# Acrobat Smart-Markup Plug-in Implementation Plan

> **For agentic workers:** Controller-orchestrated execution (user asked for parallel subagents; per
> user CLAUDE.md, do NOT use superpowers:subagent-driven-development). Parallel implementers run in
> separate git worktrees on disjoint files. Steps use checkbox (`- [ ]`) syntax.

**Goal:** An Acrobat Standard/Pro plug-in that silently links native markups to Revit elements and
writes `annotations.parquet` / `annotation-links.parquet` on save, plus an optional click-to-inspect toggle.

**Architecture:** Host-independent C++ core (`plugin/core`: element map, linking, reconcile, DuckDB
table I/O) + thin Acrobat adapter (`plugin/acrobat`: SDK entry, notifications, content walking,
attachments, inspect UI). A self-test mode lets agents verify the adapter in a real Acrobat without
GUI clicking.

**Tech Stack:** C++17, MSVC v143 (VS2022 Pro), CMake (VS-bundled), Acrobat SDK 2021 v3, DuckDB C API
v1.1.3, Python (uv) for fixtures and the `list` checker.

**Spec:** `docs/superpowers/specs/2026-11-14-acrobat-smart-markup-plugin-design.md`

## Global Constraints

- Windows x64 only; plug-in file `SmartMarkup.api`; runtime deps: `duckdb.dll` beside it, nothing else.
- SDK root (CMake `-DACROBAT_SDK=`): `C:/Users/sveress/GitHub/AECTech-Hackathons/SmartPDF/vendor/Acrobat_DC_SDK_Windows_2021_v3/Adobe/Acrobat DC SDK/Version 1`.
- SDK compile defines: `WIN_PLATFORM;_WINDOWS;WIN_ENV;ACRO_SDK_LEVEL=0x00060000`; include dirs
  `PluginSupport/Headers`, `Headers/SDK`, `Headers/ADM`, `Headers/API`; compile `Headers/API/PIMain.c`;
  disable warnings 4267, 4244; static CRT (`/MT`, `/MTd`) as in the samples.
- CMake: `"C:/Program Files/Microsoft Visual Studio/2022/Professional/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe"`
  (call it `$CMAKE`). Configure: `$CMAKE -S plugin -B plugin/build -G "Visual Studio 17 2022" -A x64 -DACROBAT_SDK="<sdk>"`.
  Build: `$CMAKE --build plugin/build --config Release`. Test: `ctest --test-dir plugin/build -C Release --output-on-failure` (ctest is beside cmake).
  The core and its tests must build without `ACROBAT_SDK`.
- Schema version 1. Table and column names exactly as in the spec's *Tables* section.
- Linking thresholds: area overlap ≥ 0.5 of element bbox; element area ≤ 4 × markup area;
  point-like if markup rect width < 24 and height < 24 (pt); text mentions regex `\b\d{4,9}\b`.
- Never throw across an SDK callback; every callback body is wrapped in `DURING/HANDLER` + `try/catch(...)`,
  logs, and returns normally.
- Log file: `%LOCALAPPDATA%\SmartMarkup\smartmarkup.log` (append, one line per event, ISO-8601 UTC prefix).
- Test PDF: `C:\Users\sveress\GitHub\AECTech-Hackathons\SmartPDF\enhanced_pdfs\snowdon-towers-a101-enhanced.pdf` (untracked, read-only — copy before modifying).
- Shell commands one at a time (no `&&`, `;`, `||`). Never touch the `P:` drive.

## Review Focus

1. **Acrobat save with the plug-in failing** (DuckDB missing, parquet unreadable) → save completes, file opens, log has the error. Test: Task 6 self-test `--fault duckdb`.
2. **Ordinary PDF (no `elements.parquet`)** → plug-in inert: no tables written, no dirty flag. Test: Task 6 self-test on a plain PDF.
3. **Markup with no `/NM`** (some tools omit it) → gets `ep-<uuid>` once, stable across saves. Test: Task 2 `reconcile_assigns_missing_id_once`.
4. **Markup over empty paper / over the title block only** → zero links, row still written (not dropped). Test: Task 2 `link_area_ignores_title_block`.
5. **Second save with no changes** → tables byte-equal to first save, no duplicate rows. Test: Task 2 `reconcile_is_idempotent` + Task 6 self-test double save.

---

### 🟡 Task 0: Scaffold, shared contract, fixtures — controller inline

The contract every parallel task codes against; written by the controller, not delegated.

**Files:**
- Create: `plugin/CMakeLists.txt` (core lib `smartmarkup_core`, test exe `core_tests` registered with ctest, `acrobat/` subdir only if `ACROBAT_SDK` set)
- Create: `plugin/core/include/smartmarkup/model.h`, `plugin/core/tests/check.h` (≈40-line CHECK/TEST harness)
- Create: `plugin/scripts/Get-DuckDb.ps1` (downloads `https://github.com/duckdb/duckdb/releases/download/v1.1.3/libduckdb-windows-amd64.zip` into `plugin/third_party/duckdb/`)
- Create: `plugin/scripts/make_fixtures.py` → `plugin/tests/fixtures/{elements,parameters,appearances,drawings,schedule-cells}.parquet`, `poc-annotations.parquet`, `poc-annotation-links.parquet` (PoC v1 schema, for migration), `element-boxes.json` (`{"<ElementId>": [x0,y0,x1,y1], ...}` from the PoC's pdfplumber code, PDF user space)
- Create: `plugin/.gitignore` (`build/`, `third_party/`)
- Commit also: the spec, this plan, `scripts/smart_annotations.py`

**Interfaces — Produces (`model.h`, namespace `sm`):**
```cpp
struct Box { double x0, y0, x1, y1; };                 // PDF user space, y up, x0<=x1, y0<=y1
using ElementMap = std::unordered_map<int64_t, Box>;   // ElementId -> union bbox, one page
enum class Shape { Area, Point, Arrow };
struct Markup {                                        // what the host reports per annotation
  std::string id;                                      // /NM, may be empty
  int page;                                            // 1-based
  std::string subtype, subject, text, author;          // subtype without '/', e.g. "Square"
  std::string createdUtc, modifiedUtc;                 // ISO-8601, may be empty
  Box rect; Shape shape; double anchorX, anchorY;      // anchor used for Point/Arrow
};
struct ElementRow { std::string elementKey; int64_t elementId; std::string category, name, family, type, typeKey; };
struct ParameterRow { std::string ownerKey, scope, name, displayValue; };
struct AppearanceRow { std::string drawingId, elementKey; };
struct DrawingRow { std::string drawingId; std::optional<std::string> parentDrawingId; std::string name, kind; int page; };
struct AnnotationRow {
  std::string annotationId, drawingId; int32_t page; std::string kind, subtype, text, author,
  status /* "Open"|"Deleted" */, createdUtc, modifiedUtc; std::array<double,4> sheetRect; int32_t schemaVersion = 1;
};
struct LinkRow { std::string annotationId, elementKey; int64_t elementId; std::string relation; /* "linked"|"referenced" */ };
struct ModelData { std::vector<ElementRow> elements; std::vector<ParameterRow> parameters;
                   std::vector<AppearanceRow> appearances; std::vector<DrawingRow> drawings; };
struct AnnotationState { std::vector<AnnotationRow> annotations; std::vector<LinkRow> links; };
```

- [ ] Write the files above; run `Get-DuckDb.ps1` and `uv run --script plugin/scripts/make_fixtures.py`.
- [ ] Configure + build + ctest: `core_tests` builds and reports 0 tests, PASS.
- [ ] Commit `chore(plugin): scaffold core contract, fixtures, build`.

---

### 🟡 Task 1: Core linking + reconcile — Sonnet subagent, worktree, parallel with Tasks 2 and 3

**Files:** Create `plugin/core/include/smartmarkup/linking.h`, `plugin/core/src/linking.cpp`,
`plugin/core/include/smartmarkup/reconcile.h`, `plugin/core/src/reconcile.cpp`, `plugin/core/tests/linking_tests.cpp`, `plugin/core/tests/reconcile_tests.cpp`.

**Interfaces:**
- Consumes: `model.h`.
- Produces:
```cpp
std::vector<int64_t> LinkedElements(const ElementMap&, const Markup&);              // sorted, unique
std::vector<int64_t> ReferencedElements(const std::string& text,
    const std::unordered_set<int64_t>& knownIds, const std::vector<int64_t>& linked); // sorted
std::optional<int64_t> ElementAt(const ElementMap&, double x, double y);            // smallest bbox containing point
struct ReconcileInput { const std::map<int, ElementMap>* pages; const ModelData* model;
                        std::vector<Markup> markups; AnnotationState existing; std::string nowUtc; };
struct ReconcileResult { AnnotationState state; bool changed; std::vector<std::pair<size_t,std::string>> assignedIds; /* markup index -> new /NM */ };
ReconcileResult Reconcile(const ReconcileInput&);
```
Reconcile rules: one row per markup (id = `/NM`, or new `ep-<uuid v4>` reported in `assignedIds`);
`kind` = subject, else subtype; links recomputed from current geometry/text; ElementId→all matching
ElementKeys; `drawingId` = most frequent non-sheet drawing among linked keys' appearances, else the
drawing with null parent; rows whose id is not among markups → `status = "Deleted"`, links kept;
`createdUtc` preserved from existing row; `modifiedUtc` = markup's if set else existing; `changed`
= result differs from `existing` (order-insensitive). Output sorted by annotationId, links by (annotationId, elementId, elementKey).

- [ ] Tests first (`check.h` style), using small hand-built maps plus `element-boxes.json` + `elements.parquet`-free stubs:
  `link_area_basic` (cloud over a 10×60 box at 50% overlap → linked; 49% → not), `link_area_ignores_title_block`
  (box 5× markup area excluded), `link_point_picks_smallest`, `link_arrow_uses_anchor`,
  `referenced_excludes_linked_and_unknown` ("see 676281 and 1234 and 99" with known {676281} → [676281]),
  `reconcile_assigns_missing_id_once`, `reconcile_marks_deleted`, `reconcile_relinks_moved_markup`,
  `reconcile_is_idempotent` (Reconcile(output as existing) → changed=false, identical state),
  `reconcile_drawing_id_prefers_view`.
- [ ] Run ctest → FAIL; implement; ctest → PASS.
- [ ] Commit `feat(core): linking rules and reconcile`.

---

### 🟡 Task 2: Core DuckDB table I/O — Sonnet subagent, worktree, parallel with Tasks 1 and 3

**Files:** Create `plugin/core/include/smartmarkup/tables.h`, `plugin/core/src/tables.cpp`, `plugin/core/tests/tables_tests.cpp`. (DuckDB is already linked and copied by Task 0; sources are globbed — no CMake edits.)

**Interfaces:**
- Consumes: `model.h`.
- Produces:
```cpp
using Attachments = std::map<std::string, std::vector<uint8_t>>;   // file name -> bytes
bool IsEnhanced(const Attachments&);                                // has "elements.parquet"
ModelData ReadModel(const Attachments&);                            // throws sm::TableError
AnnotationState ReadAnnotations(const Attachments&);               // empty if absent; migrates PoC v1 (missing Subtype/ModifiedUtc -> "")
std::vector<uint8_t> WriteAnnotationsParquet(const std::vector<AnnotationRow>&);
std::vector<uint8_t> WriteLinksParquet(const std::vector<LinkRow>&);
struct TableError : std::runtime_error { using std::runtime_error::runtime_error; };
```
Bytes reach DuckDB via temp files under `%TEMP%\SmartMarkup\<random>\` deleted afterwards. Written
parquet: exact column names/types from the spec (`Page`/`SchemaVersion` INTEGER, `ElementId` BIGINT,
`SheetRect` DOUBLE[]), gzip, rows in input order. Nullable spec columns written as NULL when the C++ string is empty.

- [ ] Tests first: `read_model_snowdon` (1204 elements, 30755 parameters, 3 drawings; element 676281 has
  category "Walls"), `read_poc_annotations_migrates`, `write_then_read_roundtrip`, `written_columns_match_spec`
  (reads back via DuckDB `DESCRIBE`). Python interop is checked in Step 3, outside ctest.
- [ ] ctest FAIL → implement → PASS.
- [ ] Step 3: write tables from the test into `plugin/build/tables-out/`, run
  `uv run --with pyarrow==22.0.0 python -c "import pyarrow.parquet as p; print(p.read_table('plugin/build/tables-out/annotations.parquet').schema)"` → matches spec.
- [ ] Commit `feat(core): DuckDB parquet table I/O`.

---

### 🔴 Task 3: Acrobat skeleton, install, self-test harness — controller inline (needs the user for one admin step)

**Files:** Create `plugin/acrobat/CMakeLists.txt`, `plugin/acrobat/src/SmartMarkupInit.cpp` (PIHandshake/PluginInit/Unload, menu `Smart Markup` → `About Smart Markup…`), `plugin/acrobat/src/log.{h,cpp}`, `plugin/acrobat/src/selftest.{h,cpp}` (stub), empty hook files `lifecycle.cpp` and `inspect.cpp` exposing `void RegisterLifecycle(); void RegisterInspect();` called from init; `plugin/scripts/Install-Plugin.ps1`, `plugin/scripts/Uninstall-Plugin.ps1`, `plugin/scripts/Run-SelfTest.ps1`.

**Interfaces — Produces:** `void LogLine(const char* fmt, ...)`; hook functions above; self-test contract:
Acrobat launched with env `SMARTMARKUP_SELFTEST=<outdir>` and a PDF path → on `AVDocDidOpen` the plug-in
runs the registered self-test steps, writes `<outdir>/selftest.json`, then closes the doc and exits Acrobat
(`AVAppExit` or equivalent). `Run-SelfTest.ps1 -Pdf <path> -Out <dir> [-Steps a,b]` wraps this with a 120 s timeout.

Install approach (dev): build output dir is exposed in `C:\Program Files\Adobe\Acrobat DC\Acrobat\plug_ins\SmartMarkup`
via a directory junction created once (admin), so rebuilds need no admin (Acrobat must be closed to rebuild).
Install script also sets "Use only certified plug-ins" off for the current user (find the HKCU key under
`Software\Adobe\Adobe Acrobat\DC\`; confirm by toggling it in the UI once and diffing the registry).

- [ ] Build `SmartMarkup.api` with v143; ask the user to run `Install-Plugin.ps1` as admin.
- [ ] Verify with the user: Acrobat starts, `Smart Markup` menu present, log shows init + `AVDocDidOpen`.
- [ ] Verify `Run-SelfTest.ps1` on the test PDF produces `selftest.json` `{ "ok": true }` and Acrobat exits.
- [ ] Commit `feat(acrobat): plug-in skeleton, install, self-test harness`.

---

### 🟢 Task 4: Update `smart_annotations.py list` — controller inline, any time after Task 0

**Files:** Modify `scripts/smart_annotations.py`.
- Match markups to rows by `/NM` (drop the `EP_SchemaVersion` requirement); accept missing `Subtype`/`ModifiedUtc`;
  print `DELETED` for `Status == "Deleted"` instead of `ORPHAN`; still flag rows whose markup is gone but status is `Open` as `ORPHAN`.
- [ ] Re-run `list` on the PoC's `annotated-2.pdf` / `annotated-3.pdf`: same output as before except ORPHAN wording rules.
- [ ] Commit `feat(scripts): list matches markups by /NM`.

---

### 🔴 Task 5: Element map from page content — Opus subagent (after Task 3), or controller

**Files:** Create `plugin/acrobat/src/element_map.{h,cpp}`; register self-test step `elementmap` in `selftest.cpp`.

**Interfaces:**
- Consumes: `model.h` (`sm::ElementMap`), self-test harness.
- Produces: `const sm::ElementMap& GetElementMap(PDDoc, int pageIndex)` (cached per doc+page, cleared on doc close; `pageIndex` 0-based).

Walk `PDPageAcquirePDEContent` recursively (containers, form XObjects with their matrix); for containers
whose `PDEContainerGetMCTag` matches `Element<digits>`, union the bboxes of all descendant elements
(`PDEElementGetBBox`, already in user space for page content; apply form matrices for XObject contents).
Nested `ViewRegion…` containers are traversed, not mapped.

- [ ] Self-test step `elementmap` writes `{"<id>": [x0,y0,x1,y1]}` to `selftest.json`.
- [ ] Compare with `plugin/tests/fixtures/element-boxes.json`: same id set; every coordinate within 1.0 pt (write the check as `plugin/scripts/compare_boxes.py`). Wall 676281 ≈ `[-123.7, 343.7, -114.2, 406.4]`.
- [ ] Time it on the test PDF: < 2 s (log the duration).
- [ ] Commit `feat(acrobat): element map from marked content`.

---

### 🔴 Task 6: Attachments + lifecycle — Opus subagent (after Tasks 1, 2, 5)

**Files:** Create `plugin/acrobat/src/attachments.{h,cpp}`, fill `plugin/acrobat/src/lifecycle.cpp`; add self-test steps.

**Interfaces:**
- Consumes: `Reconcile`, `ReadModel`, `ReadAnnotations`, `Write*Parquet`, `IsEnhanced`, `GetElementMap`.
- Produces: `sm::Attachments ReadAttachments(PDDoc)`; `void WriteAttachments(PDDoc, const sm::Attachments& replaceOrAdd)`
  — rebuilds the `EmbeddedFiles` name tree with keys sorted (byte-wise), reusing existing filespecs for untouched names.

Lifecycle (spec *Lifecycle*): per-doc state in a map keyed by `PDDoc`. `AVDocDidOpen`: if not enhanced, mark inert and stop;
else read model + annotations, collect markups (in-scope subtypes: Square, Circle, Polygon, PolyLine, Line, Ink, FreeText, Text;
Line → Arrow shape with anchor = end with a non-None line ending, else /L end point; Text → Point; tiny rect → Point),
Reconcile; apply `assignedIds` (`/NM` set via Cos); if `changed`, `PDDocSetFlags(doc, PDDocNeedsSave)`.
`PDPageDidAddAnnot`, `PDAnnotDidChange`, `PDPageDidRemoveAnnot`: re-collect that page's markups and Reconcile in memory.
`PDDocWillSaveEx`: Reconcile once more, write both parquet files via `WriteAttachments`. Every failure → log, continue.

- [ ] Self-test steps: `addmarkup` (adds a Square around 676281's box + a Text note at a door via SDK, saves to `<out>/saved.pdf`),
  `reopen` (opens saved.pdf, saves again to `saved2.pdf`), `fault-duckdb` (renames access to DuckDB via a test flag, saves).
- [ ] Verify with Python on `saved.pdf`: `smart_annotations.py list` shows the Square linked to 676281 (`Exterior | 2 HR`); the five
  exporter attachments' extracted bytes equal the source's; name tree keys sorted; `saved2.pdf` tables byte-equal to `saved.pdf`'s.
- [ ] Verify plain PDF: no attachments added, no dirty flag; `fault-duckdb`: save completes, log has error.
- [ ] Commit `feat(acrobat): attachment sync and lifecycle`.

---

### 🟡 Task 7: Click to inspect — Sonnet subagent (after Task 5; parallel with Task 6 in its own worktree, Acrobat runs serialised)

**Files:** Fill `plugin/acrobat/src/inspect.cpp`; create `plugin/acrobat/src/inspect_dialog.{h,cpp}` (plain Win32 dialog or `AVAlert`-free modeless window with a list view).

- Toolbar button + menu item "Inspect elements" (toggle, off by default). While on, `AVAppRegisterForPageViewClicks` callback:
  device → page point, `ElementAt(GetElementMap(...))`, show: Element ID, Category, Family, Type, then instance params
  (`OwnerKey = ElementKey`) and type params (`OwnerKey = TypeKey`), name → display value, sorted by name. Return `false` (don't consume) when off.
- [ ] Self-test step `inspect` calls the lookup for 676281's box centre and writes the rows to `selftest.json`: includes `Function = Exterior`, `Fire Rating = 2 HR`.
- [ ] Manual check with the user (Task 8).
- [ ] Commit `feat(acrobat): click to inspect`.

---

### 🟡 Task 8: Acceptance with the user + whole-branch review — controller

- [ ] Release build; `Install-Plugin.ps1` in release mode (copies files instead of junction); walk the spec's *Acceptance* list 1–9 with the user, fixing anything found.
- [ ] Dispatch a whole-branch review (Opus) against the spec; fix findings.
- [ ] Update `README.md` with a short "Acrobat smart-markup plug-in" section (install, what it does, limits).
- [ ] Commit; ask the user before pushing or opening a PR.

## Execution order

- Wave A (parallel): Task 0 first (inline), then Tasks 1, 2 (Sonnet, worktrees) ∥ Task 3 (controller + user) ∥ Task 4 (controller).
- Wave B: Task 5 (needs 3).
- Wave C: Task 6 (needs 1, 2, 5) ∥ Task 7 (needs 2, 5) — separate worktrees; self-tests in Acrobat run one at a time.
- Wave D: Task 8.
