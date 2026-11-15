// Per-document model data owned by the lifecycle (lifecycle.cpp). Other features (inspect) read it.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "PIHeaders.h"
#include "smartmarkup/model.h"

// The exporter tables of an open enhanced PDF, loaded when it opened; nullptr if the document is not
// enhanced, not loaded yet, or loading failed. Valid until the document closes.
const sm::ModelData* FindModel(PDDoc doc);

// Element ids linked to the markup with this /NM ('linked' and 'referenced'), sorted, unique, from the
// latest in-memory reconcile. Empty if the document or the markup is unknown.
std::vector<int64_t> LinkedElementIds(PDDoc doc, const std::string& annotationId);
