#include "element_map.h"

#include <windows.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <string>
#include <utility>

#include "log.h"
#include "selftest.h"

namespace {

std::map<std::pair<PDDoc, int>, sm::ElementMap> gCache;

double Fixed(ASFixed v) { return static_cast<double>(v) / 65536.0; }

// "Element619404" -> 619404; anything else -> -1.
int64_t ElementIdFromTag(ASAtom tag) {
    const char* name = ASAtomGetString(tag);
    if (!name || std::strncmp(name, "Element", 7) != 0 || !name[7]) return -1;
    for (const char* p = name + 7; *p; ++p)
        if (*p < '0' || *p > '9') return -1;
    return std::strtoll(name + 7, nullptr, 10);
}

void Grow(sm::ElementMap& map, int64_t id, const ASFixedRect& r) {
    // ASFixedRect is (left, top, right, bottom) with top >= bottom in user space.
    double x0 = Fixed(std::min(r.left, r.right)), x1 = Fixed(std::max(r.left, r.right));
    double y0 = Fixed(std::min(r.bottom, r.top)), y1 = Fixed(std::max(r.bottom, r.top));
    auto it = map.find(id);
    if (it == map.end()) {
        map.emplace(id, sm::Box{x0, y0, x1, y1});
    } else {
        sm::Box& b = it->second;
        b.x0 = std::min(b.x0, x0);
        b.y0 = std::min(b.y0, y0);
        b.x1 = std::max(b.x1, x1);
        b.y1 = std::max(b.y1, y1);
    }
}

// Walks content; `owner` is the innermost enclosing Element id (-1 outside any element).
void Walk(PDEContent content, int64_t owner, sm::ElementMap& map, int& skippedForms) {
    ASInt32 count = PDEContentGetNumElems(content);
    for (ASInt32 i = 0; i < count; ++i) {
        PDEElement elem = PDEContentGetElem(content, i);
        ASInt32 type = PDEObjectGetType(reinterpret_cast<PDEObject>(elem));
        if (type == kPDEContainer) {
            auto container = reinterpret_cast<PDEContainer>(elem);
            int64_t id = ElementIdFromTag(PDEContainerGetMCTag(container));
            Walk(PDEContainerGetContent(container), id >= 0 ? id : owner, map, skippedForms);
        } else if (type == kPDEGroup) {
            Walk(PDEGroupGetContent(reinterpret_cast<PDEGroup>(elem)), owner, map, skippedForms);
        } else if (owner >= 0) {
            ASFixedRect bbox;
            if (type == kPDEForm)
                PDEFormGetBBox(reinterpret_cast<PDEForm>(elem), &bbox);  // whole form, already in page space
            else
                PDEElementGetBBox(elem, &bbox);
            Grow(map, owner, bbox);
        } else if (type == kPDEForm) {
            ++skippedForms;  // Revit draws elements inline; nested-form elements are not mapped (PoC limit)
        }
    }
}

sm::ElementMap Build(PDDoc doc, int pageIndex) {
    sm::ElementMap map;
    DWORD started = GetTickCount();
    PDPage page = nullptr;
    PDEContent content = nullptr;
    int skippedForms = 0;
    DURING
        page = PDDocAcquirePage(doc, pageIndex);
        content = PDPageAcquirePDEContent(page, gExtensionID);
        Walk(content, -1, map, skippedForms);
    HANDLER
        LogLine("elementmap: page %d failed (error %d)", pageIndex, (int)ERRORCODE);
    END_HANDLER
    if (content) PDPageReleasePDEContent(page, gExtensionID);
    if (page) PDPageRelease(page);
    LogLine("elementmap: page %d -> %zu elements in %lu ms (%d top-level forms skipped)", pageIndex, map.size(),
            GetTickCount() - started, skippedForms);
    return map;
}

// Self-test: dump page 1's map to <out>/elementmap.json ({"<id>": [x0,y0,x1,y1], ...}).
std::string SelfTestElementMap(PDDoc doc, const std::string& outDir) {
    DWORD started = GetTickCount();
    const sm::ElementMap& map = GetElementMap(doc, 0);
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
    RegisterSteps() { RegisterSelfTestStep("elementmap", &SelfTestElementMap); }
} gRegisterSteps;

}  // namespace

const sm::ElementMap& GetElementMap(PDDoc doc, int pageIndex) {
    auto key = std::make_pair(doc, pageIndex);
    auto it = gCache.find(key);
    if (it == gCache.end()) it = gCache.emplace(key, Build(doc, pageIndex)).first;
    return it->second;
}

void ForgetElementMaps(PDDoc doc) {
    for (auto it = gCache.begin(); it != gCache.end();)
        it = (it->first.first == doc) ? gCache.erase(it) : std::next(it);
}
