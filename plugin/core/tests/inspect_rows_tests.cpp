#include <fstream>
#include <iterator>
#include <string>

#include "check.h"
#include "smartmarkup/inspect_rows.h"
#include "smartmarkup/tables.h"

using namespace sm;

namespace {

ModelData LoadModel() {
    Attachments a;
    for (const char* n : {"elements", "parameters", "appearances", "drawings"}) {
        std::string f = std::string(n) + ".parquet";
        std::ifstream in(check::FixturePath(f.c_str()), std::ios::binary);
        a[f] = std::vector<uint8_t>(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
    }
    return ReadModel(a);
}

bool Has(const std::vector<InspectRow>& rows, const char* name, const char* value, const char* section = nullptr) {
    for (const auto& r : rows)
        if (r.name == name && r.value == value && (!section || r.section == section)) return true;
    return false;
}

}  // namespace

TEST(inspect_rows_wall_676281) {
    ModelData m = LoadModel();
    auto rows = InspectRows(m, 676281);
    CHECK(!rows.empty());
    CHECK(Has(rows, "Category", "Walls", "Element"));
    CHECK(Has(rows, "Element ID", "676281", "Element"));
    CHECK(Has(rows, "Function", "Exterior"));
    CHECK(Has(rows, "Fire Rating", "2 HR"));
}

TEST(inspect_rows_unknown_id) {
    ModelData m = LoadModel();
    CHECK(InspectRows(m, -12345).empty());
}
