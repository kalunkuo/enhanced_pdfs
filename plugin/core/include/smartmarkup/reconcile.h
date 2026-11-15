// Reconciles the markups currently in a PDF with the persisted annotation state.
#pragma once

#include <cstddef>
#include <map>
#include <string>
#include <utility>
#include <vector>

#include "smartmarkup/model.h"

namespace sm {

struct ReconcileInput {
    const std::map<int, ElementMap>* pages = nullptr;  // page (1-based) -> element boxes
    const ModelData* model = nullptr;
    std::vector<Markup> markups;
    AnnotationState existing;
    std::string nowUtc;
};

struct ReconcileResult {
    AnnotationState state;  // annotations sorted by id, links by (id, elementId, key)
    bool changed = false;   // state differs from input.existing
    std::vector<std::pair<size_t, std::string>> assignedIds;  // (markup index, new id)
};

ReconcileResult Reconcile(const ReconcileInput& input);

}  // namespace sm
