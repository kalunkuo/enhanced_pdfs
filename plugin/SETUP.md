# Smart Markup plug-ins — setup

Smart Markup links a contractor's comments and markups to the Revit elements drawn under them and stores
the links inside the enhanced PDF as two more Parquet attachments (`annotations.parquet`,
`annotation-links.parquet`). The contractor keeps using the PDF editor's own tools; the plug-in works
silently. Optional extras: **Inspect elements** (click an element → its properties, highlighted on the
page) and **linked highlight** (select a markup → the elements it is linked to light up).

There are two host adapters over one shared C++ core:

| Folder | What | Status |
|---|---|---|
| `core/` | Host-independent C++: linking rules, reconcile, DuckDB Parquet I/O, inspect rows. Unit-tested. | 20/20 tests |
| `pdfxchange/` | `SmartMarkup.pvp` for **PDF-XChange Editor (Plus/Pro) 10.x**, x64 | Verified in Editor 10.8.4 (in-app self-tests + manual use) |
| `acrobat/` | `SmartMarkup.api` for **Adobe Acrobat Pro/Standard** (not Reader), x64 | Builds; first in-app test pending (see `acrobat/TESTING.md`) |
| `hostui/` | Shared Windows helpers (log, properties window) | |
| `scripts/` | Install / update / self-test / packaging / fixture scripts | |

Design and plans: `docs/superpowers/specs/2026-11-14-acrobat-smart-markup-plugin-design.md`,
`docs/superpowers/specs/2026-11-14-pdfxchange-adapter-design.md` (incl. "Confirmed at runtime"),
`docs/superpowers/plans/`. PDF-XChange event names: `docs/pdfxchange-event-names-10.8.4.txt`.

## Prerequisites

- Windows 10/11 x64, **Visual Studio 2022** with the *Desktop development with C++* workload
  (CMake ships with it: `C:\Program Files\Microsoft Visual Studio\2022\<edition>\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe`).
- PowerShell 5+, and [uv](https://docs.astral.sh/uv/) for the Python helper scripts.
- For the **PDF-XChange** adapter: PDF-XChange Editor **Plus or Pro** installed (its type library
  `PDFXEditCore.x64.dll` is imported at build time; no paid SDK needed).
- For the **Acrobat** adapter: the free **Acrobat SDK 2021** (developer.adobe.com/console → Downloads →
  Acrobat SDK, Windows) unzipped anywhere; you pass the `…/Adobe/Acrobat DC SDK/Version 1` folder to CMake.
  Testing needs **Acrobat Pro or Standard** — Acrobat **Reader cannot load unsigned plug-ins**.

## Build

```powershell
# from the repository root
powershell -ExecutionPolicy Bypass -File plugin\scripts\Get-DuckDb.ps1        # DuckDB C API -> plugin\third_party (gitignored)

$cmake = "C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
& $cmake -S plugin -B plugin\build -G "Visual Studio 17 2022" -A x64 `
    -DPDFXCHANGE=ON `
    -DACROBAT_SDK="C:/path/to/Acrobat_DC_SDK_Windows_2021_v3/Adobe/Acrobat DC SDK/Version 1"
& $cmake --build plugin\build --config Release
plugin\build\Release\core_tests.exe                                          # expect: 20 tests, 0 failed checks
```

Leave out `-DPDFXCHANGE=ON` or `-DACROBAT_SDK=…` to skip that adapter; the core always builds.
`-DPDFXCHANGE_DIR=…` overrides the Editor's install folder. Sources are globbed: re-run the configure
step after adding a `.cpp` file.

Outputs:
- `plugin\build\pdfxchange\Release\SmartMarkup.pvp` + `duckdb.dll`
- `plugin\build\acrobat\Release\SmartMarkup.api` + `duckdb.dll`

`duckdb.dll` must sit **next to** the plug-in: hosts do not search a plug-in's folder for its imports, so
the plug-ins delay-load DuckDB and load it from their own folder at start-up.

## Install — PDF-XChange Editor

Close the Editor. Once, in an **administrator** PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File plugin\scripts\Install-PxcPlugin.ps1
```

It copies `SmartMarkup.pvp` + `duckdb.dll` into `C:\Program Files\Tracker Software\PDF Editor\Plugins.x64`
and (after showing the account and asking) grants the **signed-in desktop user** Modify on those two files
only, so later rebuilds install without admin (Editor closed):

```powershell
powershell -ExecutionPolicy Bypass -File plugin\scripts\Update-PxcPlugin.ps1
```

Check: Editor → **Ctrl+K → Plugins** lists *Smart Markup*. The **Inspect elements** button (a blue "i") is
added to the quick-access bar. Dev-only: the Modify grant lets that user replace a DLL every Editor user
loads — do not use this install on shared machines. Uninstall: delete the two files from `Plugins.x64` (admin).

## Install — Adobe Acrobat (Pro/Standard)

Close Acrobat. In an **administrator** PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File plugin\scripts\Install-Plugin.ps1 -Copy        # copies files
# or, for development: without -Copy it creates a junction to plugin\build\acrobat\Release
```

Then in Acrobat: **Edit → Preferences → General → untick "Use only certified plug-ins"**, restart, and
check **Help → About Adobe Plug-ins** for *SmartMarkup*. The plug-in's menu *Smart Markup* is under
*Menu → Plug-ins* in the new UI. Uninstall: `plugin\scripts\Uninstall-Plugin.ps1` (admin).

To hand the Acrobat build to a tester: `plugin\scripts\Package-Acrobat.ps1 -TestPdf <clean enhanced.pdf>`
→ `plugin\build\SmartMarkup-Acrobat-test.zip` with the plug-in, scripts and `acrobat\TESTING.md`.

## Test

**Unit tests:** `plugin\build\Release\core_tests.exe` (fixtures in `plugin\tests\fixtures`, regenerate with
`uv run --script plugin\scripts\make_fixtures.py <enhanced.pdf>`).

**In-app self-tests** open a real editor with a PDF, run steps inside the plug-in, write
`<out>\selftest.json` and close the app **gently** (never force-killed — killing Acrobat mid-way can damage
its activation). The app must be closed before you start.

```powershell
# PDF-XChange
powershell -ExecutionPolicy Bypass -File plugin\scripts\Run-PxcSelfTest.ps1 -Pdf <enhanced.pdf> -Out <dir> `
    -Steps ping,elementmap,lifecycle-open,inspect,highlight,highlight-save,linked,addmarkup,fault-duckdb
# Acrobat
powershell -ExecutionPolicy Bypass -File plugin\scripts\Run-SelfTest.ps1 -Pdf <enhanced.pdf> -Out <dir> `
    -Steps ping,elementmap,lifecycle-open,inspect,overlay,addmarkup
```

Useful checks afterwards:

```powershell
uv run --script scripts\smart_annotations.py list <saved.pdf>                   # markups -> linked elements
python plugin\scripts\compare_boxes.py <dir>\elementmap.json                     # element map vs fixture
```

**"Upgrade" test** (markups made without the plug-in get linked on open):

```powershell
uv run --script plugin\scripts\make_dumb_markups.py <clean enhanced.pdf> dumb.pdf
powershell -ExecutionPolicy Bypass -File plugin\scripts\Run-PxcSelfTest.ps1 -Pdf dumb.pdf -Out <dir> -Steps lifecycle-open,savecopy
uv run --script scripts\smart_annotations.py list <dir>\upgraded.pdf
```

The PDF-XChange step `eventnames` dumps every event name the installed Editor knows (its SDK docs are
incomplete).

## Troubleshooting

- **Log:** `%LOCALAPPDATA%\SmartMarkup\smartmarkup.log` — every plug-in step and failure. The plug-ins never
  show error dialogs and never block the contractor; on failure a document simply stays unlinked.
- **No log at all after starting the host:** the plug-in was not loaded — Acrobat **Reader** (needs Pro/
  Standard), "Use only certified plug-ins" ticked, or files not in the plug-ins folder.
- **"could not load duckdb.dll":** `duckdb.dll` is missing next to the plug-in; documents stay inert.
- **Acrobat starts as Reader although Pro is licensed:** the unified Acrobat app picks Reader/Pro from the
  sign-in at start-up — sign in with the licensed Adobe ID and restart until *Help → About* shows Acrobat Pro.
- **PDF-XChange update says "Access denied":** the one-time install granted another account (e.g. a separate
  admin account) — run `Install-PxcPlugin.ps1` again; it now grants the desktop user of your session.
