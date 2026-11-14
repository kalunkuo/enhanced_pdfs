// Per-document model data owned by the lifecycle (lifecycle.cpp). Other features (inspect) read it.
#pragma once

#include "pxv.h"
#include "smartmarkup/model.h"

// The exporter tables of an open enhanced PDF, loaded when it opened; nullptr if the document is not
// enhanced, not loaded yet, or loading failed. Valid until the document closes.
const sm::ModelData* FindModel(IPXC_Document* doc);
