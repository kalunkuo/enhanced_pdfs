// Silent linking + table sync. Filled in by Task 6.
#include "doc_state.h"
#include "hooks.h"
#include "log.h"

void RegisterLifecycle() { LogLine("lifecycle: not implemented yet"); }

const sm::ModelData* FindModel(PDDoc) { return nullptr; }
