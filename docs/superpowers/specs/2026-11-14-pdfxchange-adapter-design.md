# PDF-XChange Editor adapter — design addendum

Status: draft for review · 2026-11-14 · extends `2026-11-14-acrobat-smart-markup-plugin-design.md`

## Why

The Acrobat adapter is built and reviewed but cannot be run: the dev machine's Acrobat keeps
starting in Reader mode, which refuses unsigned plug-ins. PDF-XChange Editor **Plus 10.8.4** is
installed and — proven by a spike on 2026-11-14 — loads an **unsigned, VendorID 0, native C++**
`.pvp` from `Plugins.x64` and runs its full lifecycle (`PXCE_GetPlugin → Setup → RegisterExts →
FinalizeRegistering → Init`). This makes "the core is host-independent; PDF-XChange is just another
adapter" real instead of a story.

Everything in the parent spec (intent, users, goals 1–4, anti-goals, linking rules, tables,
lifecycle semantics, acceptance) applies unchanged; only the host changes. The Acrobat adapter
stays in the tree, shelved until Acrobat Pro starts reliably.

## Decisions

- **Language/shape:** native C++ `.pvp` (DLL) exporting `PXCE_GetPlugin`, implementing
  `IPXV_Plugin` by hand (19 members). COM types come from `#import` of the installed
  `PDFXEditCore.x64.dll` type library (path from CMake `-DPDFXCHANGE_DIR`, default
  `C:/Program Files/Tracker Software/PDF Editor`). No paid SDK, no C#. (My call: keeps the core
  linkable without interop, matches the spike.)
- **Core reused unchanged:** `smartmarkup_core` (model, linking, reconcile, tables, inspect_rows),
  `duckdb.dll` next to the `.pvp`.
- **Folder:** `plugin/pdfxchange/`, built only when `-DPDFXCHANGE=ON`.
- **Events** (names from the 2016–18 SDK wiki; verified at runtime in the first task, which logs
  every candidate event as it fires):
  - open: `e.document.initialized` and/or `e.document.viewingStarted`
  - save: `e.document.beforeSave` (write tables; must not set Result, so saving continues),
    `e.document.afterSave` (log the save HRESULT)
  - markup changes: `e.annots.inserted`, `e.annots.changed`, `e.annots.deleted`
  - close: `e.document.beforeClose` / `e.document.closed`
  - clicks (inspect): `e.pagesView.mouse` with Param1 = `WM_LBUTTONDOWN`
- **Element map:** walk page content via `IPXC_Content` / `IPXC_ContentItems`; an item's
  `MC_Tag` = `Element<digits>` marks the owning element; union item bboxes in PDF user space.
  Must match `plugin/tests/fixtures/element-boxes.json` (same ids, ≤ 1 pt), as for Acrobat.
- **Attachments:** read via the document's `EmbeddedFiles` name tree (`IPXC_NameTree`,
  `IPXC_EmbeddedFileStream`); write by rebuilding a sorted flat `/Names` array (same rule and
  same safety bounds as the Acrobat adapter: decode only our six tables, per-stream 64 MB, total
  256 MB, no partial trees).
- **Annotation identity:** `/NM` read/written through the annotation's PDF dictionary (PXS layer).
- **UI:** a "Smart Markup" command group with "Inspect elements" (toggle) added in the
  command-layout customisation callback (Init runs before the main frame exists). Popup: a plain
  Win32 ListView window, as in the Acrobat adapter (reuse `inspect_window.*` by moving it to a
  shared `plugin/hostui/` folder).
- **Self-test:** same contract as Acrobat (`SMARTMARKUP_SELFTEST=<dir>`, steps, `selftest.json`),
  script `plugin/scripts/Run-PxcSelfTest.ps1`. **Closes the Editor gently** (`CloseMainWindow`,
  then wait) — never a force-kill.
- **Dev install:** one admin step creates `Plugins.x64\SmartMarkup.pvp` and `duckdb.dll` and grants
  the current user Modify on **those two files only** (`icacls`), so later rebuilds are copied
  without admin. (My call; the alternative is an admin copy per rebuild.) Editor must be closed to
  replace them.

## Confirmed at runtime (2026-11-14, Editor Plus 10.8.4)

- **Events** (probe session, all fired from `IPXV_Document` unless noted): open =
  `e.document.initialized` → `e.document.viewingStarted` → `e.document.activated`; markups =
  `e.annots.inserted` / `e.annots.changed` / `e.annots.deleted`; save = `e.document.beforeSave` →
  `e.document.savePerformed` → `e.document.afterSave` (Param1 = HRESULT); clicks =
  `e.pagesView.mouse` from `IPXV_PagesView`, Param1 = `WM_LBUTTONDOWN` (0x201), Param2 = `IUIX_Event`.
  Close events not yet observed.
- **Content walk:** read-only content is **flat** — `BMC/BDC … EMC` arrive as
  `CIT_BeginContainer` / `CIT_EndContainer` items (1241 pairs on Snowdon A101), not nested
  `CIT_Container`s. The walk keeps a stack of open containers.
- **Element map vs fixture:** 1099/1099 ids, built in ~60 ms; median box difference 0.12 pt,
  90th percentile 0.9 pt. 78 text-based annotation elements (wall/room tags, generic annotations,
  dimensions) differ by up to 6.6 pt because PDF-XChange measures glyph boxes (and stroke width)
  where the pdfplumber fixture measures character boxes and bare paths. Accepted: linking uses a
  50 % overlap rule, so a few points do not change results.
- **Dev install:** the one-time admin script must grant the *desktop* user (owner of
  `explorer.exe`), not the elevated identity — with a separate admin account they differ.

## Risks

- The SDK wiki is old and thin; event names, content-item bbox semantics and name-tree write calls
  are discovered by trial. Mitigation: the first task is an instrumented probe; each later task
  verifies against fixtures through the self-test before building on it.
- PDF-XChange may refuse `/NM` writes or name-tree edits through high-level APIs; fallback is the
  PXS (raw object) layer.

## Out of scope

Everything the parent spec excludes, plus: a C# adapter, the paid SDK, and PDF-XChange free edition.
