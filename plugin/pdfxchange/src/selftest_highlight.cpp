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

// Width of our highlight's normal appearance (/AP /N /BBox) vs its /Rect: the fill must cover the element.
std::string AppearanceVsRect(IPXC_Document* core) {
    ComPtr<IPXC_Pages> pages;
    ComPtr<IPXC_Page> page;
    if (FAILED(core->get_Pages(pages.Put())) || FAILED(pages->get_Item(0, page.Put()))) return "null";
    ULONG_T count = 0;
    page->GetAnnotsCount(&count);
    for (ULONG_T i = 0; i < count; ++i) {
        ComPtr<IPXC_Annotation> annot;
        BSTR name = nullptr;
        bool ours = SUCCEEDED(page->GetAnnot(i, annot.Put())) && annot && SUCCEEDED(annot->get_Name(&name)) &&
                    name && std::wcscmp(name, kHighlightName) == 0;
        if (name) SysFreeString(name);
        if (!ours) continue;
        PXC_Rect rect{};
        annot->get_Rect(&rect);
        ComPtr<IPXS_PDFVariant> dict, ap, normal, bbox;
        double width = -1;
        if (SUCCEEDED(annot->get_PDFObject(dict.Put())) &&
            SUCCEEDED(dict->Dict_Get(const_cast<LPWSTR>(L"AP"), ap.Put())) && ap &&
            SUCCEEDED(ap->Dict_Get(const_cast<LPWSTR>(L"N"), normal.Put())) && normal &&
            SUCCEEDED(normal->Dict_Get(const_cast<LPWSTR>(L"BBox"), bbox.Put())) && bbox) {
            double v[4] = {};
            for (ULONG_T k = 0; k < 4; ++k) {
                ComPtr<IPXS_PDFVariant> item;
                if (SUCCEEDED(bbox->get_Item(k, item.Put())) && item) item->GetDouble(&v[k]);
            }
            width = v[2] - v[0];
        }
        char buf[96];
        snprintf(buf, sizeof buf, "{\"rectWidth\": %.1f, \"apWidth\": %.1f}", rect.right - rect.left, width);
        return buf;
    }
    return "null";
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
    auto it = map.find(697710);  // the 50-ft exterior wall from the user's screenshot (wide element)
    if (it == map.end()) return "{\"error\": \"element 697710 not on page 1\"}";

    bool modifiedBefore = Modified(doc);
    ShowHighlight(doc, 0, it->second);
    int shown = CountOurs(core.Get());
    std::string appearance = AppearanceVsRect(core.Get());
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
    return "{\"appearance\": " + appearance + ", \"shown\": " + std::to_string(shown) + ", \"reshown\": " +
           std::to_string(reshown) +
           ", \"cleared\": " + std::to_string(cleared) + ", \"modified\": [" + (modifiedBefore ? "true" : "false") +
           ", " + (modifiedShown ? "true" : "false") + ", " + (modifiedAfter ? "true" : "false") + "]}";
}

struct RegisterSteps {
    RegisterSteps() { RegisterSelfTestStep("highlight", &HighlightStep); }
} gRegisterSteps;

}  // namespace
