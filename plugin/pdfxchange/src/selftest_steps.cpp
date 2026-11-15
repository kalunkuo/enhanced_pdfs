// Self-test steps for the element map (X1). Feature tasks add their own steps in their own files.
#include <cstdio>
#include <map>

#include "com_ptr.h"
#include "element_map.h"
#include "selftest.h"

namespace {

// Dumps page 1's map to <out>/elementmap.json ({"<id>": [x0,y0,x1,y1], ...}).
std::string ElementMapStep(IPXV_Document* doc, const std::string& outDir) {
    ComPtr<IPXC_Document> core;
    if (FAILED(doc->get_CoreDoc(core.Put())) || !core) return "{\"error\": \"no core document\"}";
    DWORD started = GetTickCount();
    const sm::ElementMap& map = GetElementMap(core.Get(), 0);
    DWORD ms = GetTickCount() - started;

    std::map<int64_t, sm::Box> sorted(map.begin(), map.end());
    std::string json = "{";
    char buf[160];
    for (const auto& [id, b] : sorted) {
        snprintf(buf, sizeof buf, "%s\n\"%lld\": [%.4f, %.4f, %.4f, %.4f]", json.size() > 1 ? "," : "",
                 static_cast<long long>(id), b.x0, b.y0, b.x1, b.y1);
        json += buf;
    }
    json += "\n}\n";
    std::string path = outDir + "\\elementmap.json";
    if (FILE* f = fopen(path.c_str(), "wb")) {
        fwrite(json.data(), 1, json.size(), f);
        fclose(f);
    }
    return "{\"count\": " + std::to_string(map.size()) + ", \"ms\": " + std::to_string(ms) +
           ", \"file\": " + JsonString(path) + "}";
}

struct RegisterSteps {
    RegisterSteps() { RegisterSelfTestStep("elementmap", &ElementMapStep); }
} gRegisterSteps;

}  // namespace
