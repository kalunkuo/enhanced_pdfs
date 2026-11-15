// Per-document model data owned by the lifecycle (lifecycle.cpp). Other features (inspect) read it.
#pragma once

#include <string>
#include <vector>

#include "pxv.h"
#include "smartmarkup/model.h"

// The exporter tables of an open enhanced PDF, loaded when it opened; nullptr if the document is not
// enhanced, not loaded yet, or loading failed. Valid until the document closes.
const sm::ModelData* FindModel(IPXC_Document* doc);

// ElementIds the markup with this /NM is currently linked to (latest in-memory reconcile, both
// 'linked' and 'referenced'); empty if unknown. Sorted, unique.
std::vector<int64_t> LinkedElementIds(IPXC_Document* doc, const std::string& annotationId);
