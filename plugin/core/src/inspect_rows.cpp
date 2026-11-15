#include "smartmarkup/inspect_rows.h"

#include <set>
#include <utility>

namespace sm {

namespace {

void AddGroup(std::vector<InspectRow>& out, const ModelData& model, const char* section, const std::string& owner) {
    if (owner.empty()) return;
    std::set<std::pair<std::string, std::string>> unique;  // sorted by name, then value
    for (const auto& p : model.parameters)
        if (p.ownerKey == owner && !p.displayValue.empty()) unique.emplace(p.name, p.displayValue);
    for (const auto& [name, value] : unique) out.push_back({section, name, value});
}

}  // namespace

std::vector<InspectRow> InspectRows(const ModelData& model, int64_t elementId) {
    std::vector<InspectRow> rows;
    const ElementRow* first = nullptr;
    int count = 0;
    for (const auto& e : model.elements) {
        if (e.elementId != elementId) continue;
        if (!first) first = &e;
        ++count;
    }
    if (!first) return rows;

    rows.push_back({"Element", "Element ID", std::to_string(elementId)});
    rows.push_back({"Element", "Category", first->category});
    rows.push_back({"Element", "Family", first->family});
    rows.push_back({"Element", "Type", first->type});
    if (count > 1) rows.push_back({"Element", "Also in model", std::to_string(count - 1)});
    AddGroup(rows, model, "Instance", first->elementKey);
    AddGroup(rows, model, "Type", first->typeKey);
    return rows;
}

}  // namespace sm
