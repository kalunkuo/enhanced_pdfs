# PDF-XChange Adapter Implementation Plan

> Controller-orchestrated (user asked for parallel subagents; never superpowers:subagent-driven-development).
> Parallel implementers get their own worktrees; only one process drives the Editor at a time.

**Goal:** SmartMarkup.pvp for PDF-XChange Editor Plus with the same behaviour as the Acrobat adapter.
**Spec:** `docs/superpowers/specs/2026-11-14-pdfxchange-adapter-design.md` (+ parent spec).
**Global constraints:** as in the Acrobat plan (CMake path, one command at a time, never P:, log file,
never throw into the host). Editor closed gently in scripts. Core library unchanged unless a task says so.

### 🟡 Task X0: Adapter skeleton, install, event probe — controller inline (one admin step)
- `plugin/pdfxchange/` CMake target `SmartMarkup.pvp` (`-DPDFXCHANGE=ON`), `#import` typelib, `IPXV_Plugin`,
  log, self-test harness (port of `selftest.*`), `Install-PxcPlugin.ps1` (admin once: copy + icacls on the two
  files), `Run-PxcSelfTest.ps1` (gentle close).
- Register native handlers for every candidate event in the spec; log name + params as they fire.
- Verify with the user: open the Snowdon PDF, add a cloud, save, close → log shows which events fire, in order.
- Commit.

### 🔴 Task X1: Element map from content items — controller (needs Editor runs)
- `element_map` for PXC: walk content items, `MC_Tag` → ElementId, union bboxes (user space).
- Self-test `elementmap` + `compare_boxes.py` against the fixture: same ids, ≤ 1 pt; wall 676281 ≈ [-123.7, 343.7, -114.2, 406.4].

### 🔴 Task X2: Attachments + lifecycle — Opus subagent (after X0, X1), worktree
- Same behaviour, rules and self-test steps as Acrobat Task 6 (`lifecycle-open`, `addmarkup`, `fault-duckdb`),
  using the event names X0 confirmed. Controller runs the self-tests and the Python checks
  (`smart_annotations.py list`, byte-identical exporter attachments, sorted names).

### 🟡 Task X3: Inspect — Sonnet subagent (after X1; parallel with X2), worktree
- Move `inspect_window.*` to `plugin/hostui/` (shared by both adapters); command "Inspect elements"
  via command-layout customisation; `e.pagesView.mouse` → page point → `ElementAt` → `InspectRows` → window.
  Self-test `inspect` as for Acrobat.

### 🟡 Task X4: Acceptance with the user + whole-branch review — controller
- Spec acceptance 2–9 in PDF-XChange; Opus whole-branch review; README section; ask before push/PR.
