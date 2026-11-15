#include "highlight.h"

#include <cwchar>

#include "com_ptr.h"
#include "lifecycle.h"
#include "log.h"

namespace {

IPXV_Document* gDoc = nullptr;  // document currently showing a highlight (owned reference)

// Restores the document's modified flag after we add/remove our temporary annotation.
class KeepModified {
public:
    explicit KeepModified(IPXV_Document* doc) : doc_(doc) { doc_->get_Modified(&was_); }
    ~KeepModified() { doc_->put_Modified(was_); }

private:
    IPXV_Document* doc_;
    VARIANT_BOOL was_ = VARIANT_FALSE;
};

bool IsOurs(IPXC_Annotation* annot) {
    BSTR name = nullptr;
    bool ours = SUCCEEDED(annot->get_Name(&name)) && name && std::wcscmp(name, kHighlightName) == 0;
    if (name) SysFreeString(name);
    return ours;
}

void RemoveFrom(IPXV_Document* doc) {
    KeepModified keep(doc);
    ComPtr<IPXC_Document> core;
    ComPtr<IPXC_Pages> pages;
    if (FAILED(doc->get_CoreDoc(core.Put())) || FAILED(core->get_Pages(pages.Put()))) return;
    ULONG_T pageCount = 0;
    pages->get_Count(&pageCount);
    for (ULONG_T p = 0; p < pageCount; ++p) {
        ComPtr<IPXC_Page> page;
        if (FAILED(pages->get_Item(p, page.Put())) || !page) continue;
        ULONG_T count = 0;
        page->GetAnnotsCount(&count);
        for (ULONG_T i = count; i > 0; --i) {
            ComPtr<IPXC_Annotation> annot;
            if (FAILED(page->GetAnnot(i - 1, annot.Put())) || !annot || !IsOurs(annot.Get())) continue;
            doc->FireAnnotDeletedEvent(annot.Get());
            page->RemoveAnnots(i - 1, 1);
        }
    }
}

ComPtr<IColor> Rgb(float r, float g, float b) {
    ComPtr<IColor> color;
    ComPtr<IUnknown> ext;
    BSTR aux = SysAllocString(L"AUX");
    HRESULT hr = PxvInst()->GetExtension(aux, ext.Put());
    SysFreeString(aux);
    ComPtr<IAUX_Inst> auxInst;
    if (SUCCEEDED(hr) && SUCCEEDED(ext.As(auxInst)) && SUCCEEDED(auxInst->CreateColor(ColorType_RGB, color.Put())))
        color->SetRGB(r, g, b);
    return color;
}

}  // namespace

void ShowHighlight(IPXV_Document* doc, int pageIndex, const sm::Box& box) {
    if (!doc) return;
    try {
        ClearHighlight();
        KeepModified keep(doc);
        ComPtr<IPXC_Document> core;
        ComPtr<IPXC_Pages> pages;
        ComPtr<IPXC_Page> page;
        if (FAILED(doc->get_CoreDoc(core.Put())) || FAILED(core->get_Pages(pages.Put())) ||
            FAILED(pages->get_Item(pageIndex, page.Put())) || !page)
            return;
        ULONG_T square = 0;
        if (FAILED(PxsInst()->StrToAtom(const_cast<LPWSTR>(L"Square"), &square))) return;

        const double pad = 2.0;  // a little breathing room around thin elements
        PXC_Rect rect{box.x0 - pad, box.y0 - pad, box.x1 + pad, box.y1 + pad};
        ULONG_T count = 0;
        page->GetAnnotsCount(&count);
        ComPtr<IPXC_Annotation> annot;
        if (FAILED(page->InsertNewAnnot(square, &rect, count, annot.Put())) || !annot) return;

        BSTR name = SysAllocString(kHighlightName);
        annot->put_Name(name);
        SysFreeString(name);

        ComPtr<IPXC_AnnotData> data;
        ComPtr<IPXC_AnnotData_SquareCircle> sq;
        if (SUCCEEDED(annot->get_Data(data.Put())) && SUCCEEDED(data.As(sq))) {
            ComPtr<IColor> fill = Rgb(1.0f, 0.86f, 0.0f), stroke = Rgb(0.95f, 0.55f, 0.0f);
            if (fill) sq->put_FColor(fill.Get());
            if (stroke) sq->put_SColor(stroke.Get());
            sq->put_Opacity(0.35);
            PXC_AnnotBorder border{};
            sq->get_Border(&border);
            border.nStyle = ABS_Solid;
            border.nEffect = ABE_Standard;
            border.nWidth = 1.5f;
            border.nDashCount = 0;
            sq->put_Border(&border);
            annot->put_Data(data.Get());
        }
        // Re-applying the rect regenerates the appearance at full size (without it the Editor kept the
        // default-size appearance from InsertNewAnnot: only a small box at one corner was filled).
        annot->put_Rect(&rect);
        // Not selectable/movable by the user: ReadOnly (64) | Locked (128).
        annot->put_Flags(64 | 128);
        doc->FireAnnotInsertedEvent(annot.Get());  // lets the Editor redraw; our collector skips the name

        doc->AddRef();
        gDoc = doc;
    } catch (...) {
        LogLine("highlight: show threw");
    }
}

void ClearHighlight() {
    if (!gDoc) return;
    IPXV_Document* doc = gDoc;
    gDoc = nullptr;
    try {
        RemoveFrom(doc);
    } catch (...) {
        LogLine("highlight: clear threw");
    }
    doc->Release();
}

void ClearHighlightIn(IPXV_Document* doc) {
    if (doc && doc == gDoc) ClearHighlight();
}

void ForgetHighlight(IPXV_Document* doc) {
    if (doc && doc == gDoc) {
        gDoc->Release();
        gDoc = nullptr;
    }
}
