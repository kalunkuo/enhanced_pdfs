// Feature entry points called from PluginInit/PluginUnload. Each lives in its own file so features can
// be developed in parallel without touching SmartMarkupInit.cpp.
#pragma once

void RegisterLifecycle();  // lifecycle.cpp — silent linking + table sync (Task 6)
void RegisterInspect();    // inspect.cpp  — click-to-inspect toggle (Task 7)
void UnregisterInspect();  // inspect.cpp  — remove UI on unload
