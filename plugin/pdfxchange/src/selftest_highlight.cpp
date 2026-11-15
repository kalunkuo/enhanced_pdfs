// Self-test step `highlight`: show the inspect highlight on wall 676281, then clear it. Checks that exactly
// one temporary annotation appears and disappears, and that the document's modified flag is untouched.
#include <cwchar>
#include <stdexcept>
#include <string>

#include "com_ptr.h"
#include "element_map.h"
#include "highlight.h"
#include "selftest.h"

namespace {

int CountOurs(IPXC_Document* core) {
    int n = 0;
    ComPtr<IPXC_Pages> pages;
    ComPtr<IPXC_Page> page;
    if (FAILED(core->get_Pages(pages.Put())) || FAILED(pages->get_Item(0, page.Put()))) return -1;
    ULONG_T count = 0;
    page->GetAnnotsCount(&count);
    for (ULONG_T i = 0; i < count; ++i) {
        ComPtr<IPXC_Annotation> annot;
        BSTR name = nullptr;
        if (SUCCEEDED(page->GetAnnot(i, annot.Put())) && annot && SUCCEEDED(annot->get_Name(&name)) && name &&
            std::wcscmp(name, kHighlightName) == 0)
            ++n;
        if (name) SysFreeString(name);
    }
    return n;
}

bool Modified(IPXV_Document* doc) {
    VARIANT_BOOL v = VARIANT_FALSE;
    doc->get_Modified(&v);
    return v != VARIANT_FALSE;
}

std::string HighlightStep(IPXV_Document* doc, const std::string&) {
    ComPtr<IPXC_Document> core;
    if (FAILED(doc->get_CoreDoc(core.Put())) || !core) return "{\"error\": \"no core document\"}";
    const sm::ElementMap& map = GetElementMap(core.Get(), 0);
    auto it = map.find(676281);
    if (it == map.end()) return "{\"error\": \"element 676281 not on page 1\"}";

    bool modifiedBefore = Modified(doc);
    ShowHighlight(doc, 0, it->second);
    int shown = CountOurs(core.Get());
    bool modifiedShown = Modified(doc);
    ShowHighlight(doc, 0, it->second);  // showing again must replace, not stack
    int reshown = CountOurs(core.Get());
    ClearHighlight();
    int cleared = CountOurs(core.Get());
    bool modifiedAfter = Modified(doc);

    bool ok = shown == 1 && reshown == 1 && cleared == 0 && modifiedShown == modifiedBefore &&
              modifiedAfter == modifiedBefore;
    if (!ok) throw std::runtime_error("highlight check failed: shown=" + std::to_string(shown) + " reshown=" +
                                      std::to_string(reshown) + " cleared=" + std::to_string(cleared));
    return "{\"shown\": " + std::to_string(shown) + ", \"reshown\": " + std::to_string(reshown) +
           ", \"cleared\": " + std::to_string(cleared) + ", \"modified\": [" + (modifiedBefore ? "true" : "false") +
           ", " + (modifiedShown ? "true" : "false") + ", " + (modifiedAfter ? "true" : "false") + "]}";
}

struct RegisterSteps {
    RegisterSteps() { RegisterSelfTestStep("highlight", &HighlightStep); }
} gRegisterSteps;

}  // namespace
