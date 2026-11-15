// Rows shown by click-to-inspect: element identity, then instance and type parameters.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "smartmarkup/model.h"

namespace sm {

struct InspectRow {
    std::string section;  // "Element" | "Instance" | "Type"
    std::string name;
    std::string value;
};

// Empty if the id is not in the model. Parameter groups are sorted by name, empty values skipped,
// identical (name, value) pairs collapsed.
std::vector<InspectRow> InspectRows(const ModelData& model, int64_t elementId);

}  // namespace sm
