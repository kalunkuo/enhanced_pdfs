// Silent linking + table sync (spec "Lifecycle") on the Editor's document and annotation events.
#pragma once

#include <cstddef>

#include "pxv.h"

// Subscribes the lifecycle events (call from IPXV_Plugin::Init, before InitSelfTest).
void RegisterLifecycle(IPXV_Inst* inst);

// Drops all document state and instance references (call from IPXV_Plugin::Unload, after UnsubscribeAll).
void UnregisterLifecycle();

// Instances captured by RegisterLifecycle (null before / after).
// plugin.cpp: false when duckdb.dll could not be loaded; every table operation must then be skipped.
bool DuckDbAvailable();

IPXV_Inst* PxvInst();
IPXS_Inst* PxsInst();

// --- Self-test hooks ---------------------------------------------------------------------------------

struct LifecycleInfo {
    bool known = false;     // the lifecycle has seen this document open
    bool inert = true;
    bool enhanced = false;
    size_t openMarkups = 0;  // markups found by catch-up on open
    size_t currentRows = 0, currentLinks = 0;      // latest in-memory reconcile
    size_t persistedRows = 0, persistedLinks = 0;  // what the attachments hold (as read / last written)
};

// Runs the open handling for `doc` if it has not run yet, then reports its state.
LifecycleInfo GetLifecycleInfo(IPXV_Document* doc);

// Makes the next table write throw sm::TableError; FaultHit() reports whether it fired.
void SetFaultNextWrite(bool on);
bool FaultHit();
