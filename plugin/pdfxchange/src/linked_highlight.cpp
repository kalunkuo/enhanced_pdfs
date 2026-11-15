// Selecting a markup highlights the Revit elements it is linked to (the reviewer's "what is this comment
// about?"). Works with normal selection, independent of the Inspect toggle. Selecting anything else, or
// nothing, clears the highlight.
#include "linked_highlight.h"

#include <string>
#include <vector>

#include "com_ptr.h"
#include "doc_state.h"
#include "element_map.h"
#include "events.h"
#include "highlight.h"
#include "log.h"

namespace {

IPXV_Inst* gInst = nullptr;

std::string Utf8(BSTR s) {
    if (!s) return {};
    int n = WideCharToMultiByte(CP_UTF8, 0, s, -1, nullptr, 0, nullptr, nullptr);
    std::string out(n > 0 ? n - 1 : 0, '\0');
    if (n > 1) WideCharToMultiByte(CP_UTF8, 0, s, -1, &out[0], n, nullptr, nullptr);
    return out;
}

// The document the selection belongs to: the event source, else the active document.
ComPtr<IPXV_Document> DocOf(IUnknown* from) {
    ComPtr<IPXV_Document> doc;
    if (from && SUCCEEDED(from->QueryInterface(__uuidof(IPXV_Document), reinterpret_cast<void**>(doc.Put())))) return doc;
    if (gInst) gInst->get_ActiveDoc(doc.Put());
    return doc;
}

void OnSelectionChanged(IUnknown* from) {
    if (HighlightJustChanged()) return;  // our own annotation churn, or the Inspect click's highlight
    ComPtr<IPXV_Document> doc = DocOf(from);
    if (!doc) return;
    ComPtr<IPXC_Document> core;
    if (FAILED(doc->get_CoreDoc(core.Put())) || !core || !FindModel(core.Get())) return;  // not enhanced

    ComPtr<IPXV_DocSelection> sel;
    ComPtr<IPXV_AnnotSelection> annots;
    ComPtr<IPXV_AnnotsList> items;
    ULONG_T count = 0;
    if (SUCCEEDED(doc->get_ActiveSel(sel.Put())) && sel && SUCCEEDED(sel.As(annots)) &&
        SUCCEEDED(annots->get_Items(items.Put())) && items)
        items->get_Count(&count);

    std::vector<sm::Box> boxes;
    int page = -1;
    for (ULONG_T i = 0; i < count; ++i) {
        ComPtr<IPXC_Annotation> annot;
        if (FAILED(items->get_Item(i, annot.Put())) || !annot) continue;
        BSTR name = nullptr;
        annot->get_Name(&name);
        std::string id = Utf8(name);
        if (name) SysFreeString(name);
        if (id.empty() || id == "smh-highlight") continue;
        ULONG_T pageIndex = 0;
        annot->get_PageIndex(&pageIndex);
        if (page < 0) page = static_cast<int>(pageIndex);
        if (static_cast<int>(pageIndex) != page) continue;  // one page at a time (the first selected one's)
        const sm::ElementMap& map = GetElementMap(core.Get(), page);
        for (int64_t elementId : LinkedElementIds(core.Get(), id)) {
            auto it = map.find(elementId);
            if (it != map.end()) boxes.push_back(it->second);
        }
    }
    if (boxes.empty()) {
        ClearHighlight();
        return;
    }
    LogLine("linked: %zu linked element(s) highlighted for %lu selected markup(s)", boxes.size(), count);
    ShowHighlights(doc.Get(), page, boxes);
}

}  // namespace

void RegisterLinkedHighlight(IPXV_Inst* inst) {
    if (!inst) return;
    gInst = inst;  // borrowed: the plug-in holds the instance for its whole lifetime
    // Name from the Editor's own registry (docs/pdfxchange-event-names-10.8.4.txt).
    Subscribe(inst, "e.docSelection.changed", [](IEvent*, IUnknown* from) {
        try {
            OnSelectionChanged(from);
        } catch (...) {
            LogLine("linked: selection handler threw");
        }
    });
}
