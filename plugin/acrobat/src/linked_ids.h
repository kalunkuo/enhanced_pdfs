// TEMPORARY: replaced by doc_state.h's declaration at merge (same signature).
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "PIHeaders.h"

std::vector<int64_t> LinkedElementIds(PDDoc doc, const std::string& annotationId);
