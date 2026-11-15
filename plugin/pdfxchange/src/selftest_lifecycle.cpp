// Self-test steps for the lifecycle (X2): lifecycle-open, addmarkup, fault-duckdb.
// Steps that change the document clear its modified flag at the end, so the script's gentle close is not
// blocked by a "Save changes?" prompt (self-test only; the source PDF is never saved).
#include <cstdio>
#include <stdexcept>
#include <string>

#include "com_ptr.h"
#include "element_map.h"
#include "highlight.h"
#include "lifecycle.h"
#include "log.h"
#include "markups.h"
#include "selftest.h"

namespace {

std::string Bool(bool v) { return v ? "true" : "false"; }

bool FileExists(const std::string& path) { return GetFileAttributesA(path.c_str()) != INVALID_FILE_ATTRIBUTES; }

void Check(HRESULT hr, const char* what) {
    if (FAILED(hr)) {
        char buf[160];
        snprintf(buf, sizeof buf, "%s failed (hr=0x%08lx)", what, static_cast<unsigned long>(hr));
        throw std::runtime_error(buf);
    }
}

ComPtr<IPXC_Document> Core(IPXV_Document* doc) {
    ComPtr<IPXC_Document> core;
    Check(doc->get_CoreDoc(core.Put()), "get_CoreDoc");
    return core;
}

bool Modified(IPXV_Document* doc) {
    VARIANT_BOOL v = VARIANT_FALSE;
    doc->get_Modified(&v);
    return v != VARIANT_FALSE;
}

// Saves a copy through the Editor (so e.document.beforeSave / afterSave fire). False if the Editor fails.
bool SaveCopy(IPXV_Document* doc, const std::string& path) {
    DeleteFileA(path.c_str());
    ComPtr<IUnknown> ext;
    BSTR afs = SysAllocString(L"AFS");
    HRESULT hr = PxvInst()->GetExtension(afs, ext.Put());
    SysFreeString(afs);
    Check(hr, "GetExtension(AFS)");
    ComPtr<IAFS_Inst> fsInst;
    Check(ext.As(fsInst), "QI IAFS_Inst");
    ComPtr<IAFS_FileSys> fs;
    Check(fsInst->get_DefaultFileSys(fs.Put()), "get_DefaultFileSys");
    std::wstring wide = Wide(path);
    ComPtr<IAFS_Name> name;
    Check(fs->StringToName(const_cast<LPWSTR>(wide.c_str()), 0, nullptr, name.Put()), "StringToName");
    long flags = PXV_DocSave_Copy | PXV_DocSave_NoProgress | PXV_DocSave_NoErrorMsg | PXV_DocSave_Sync |
                 PXV_DocSave_NonIncremental | PXV_DocSave_NoOverwritePrompt;
    hr = doc->Save(name.Get(), flags, nullptr, nullptr, nullptr, nullptr, nullptr, 0);
    LogLine("selftest: save copy to %s hr=0x%08lx", path.c_str(), static_cast<unsigned long>(hr));
    return SUCCEEDED(hr) && FileExists(path);
}

ULONG_T Atom(const wchar_t* s) {
    ULONG_T atom = 0;
    Check(PxsInst()->StrToAtom(const_cast<LPWSTR>(s), &atom), "StrToAtom");
    return atom;
}

// Adds an annotation of `type` at `rect` on page 1 with /Contents and /T, and fires the Editor's
// annots-inserted event (as the Editor's own tools would).
// With withoutId, /NM is removed (the Editor assigns one) so the plug-in's own id assignment is exercised.
void AddAnnot(IPXV_Document* doc, const wchar_t* type, double x0, double y0, double x1, double y1,
              const wchar_t* contents, bool withoutId = false) {
    ComPtr<IPXC_Document> core = Core(doc);
    ComPtr<IPXC_Pages> pages;
    ComPtr<IPXC_Page> page;
    Check(core->get_Pages(pages.Put()), "get_Pages");
    Check(pages->get_Item(0, page.Put()), "get page 1");
    ULONG_T count = 0;
    page->GetAnnotsCount(&count);
    PXC_Rect rect{};
    rect.left = x0;
    rect.bottom = y0;
    rect.right = x1;
    rect.top = y1;
    ComPtr<IPXC_Annotation> annot;
    Check(page->InsertNewAnnot(Atom(type), &rect, count, annot.Put()), "InsertNewAnnot");
    ComPtr<IPXS_PDFVariant> dict;
    Check(annot->get_PDFObject(dict.Put()), "get_PDFObject");
    Check(dict->Dict_SetString(const_cast<LPWSTR>(L"Contents"), const_cast<LPWSTR>(contents)), "set /Contents");
    Check(dict->Dict_SetString(const_cast<LPWSTR>(L"T"), const_cast<LPWSTR>(L"SmartMarkup self-test")), "set /T");
    if (withoutId) dict->Dict_RemoveKey(const_cast<LPWSTR>(L"NM"));
    doc->FireAnnotInsertedEvent(annot.Get());
}

sm::Box BoxOf(IPXV_Document* doc, int64_t id) {
    const sm::ElementMap& map = GetElementMap(Core(doc).Get(), 0);
    auto it = map.find(id);
    if (it == map.end()) throw std::runtime_error("element " + std::to_string(id) + " not in page 1 element map");
    return it->second;
}

// Smallest element whose box contains (x, y), as the point-like linking rule picks it; -1 if none.
int64_t SmallestAt(const sm::ElementMap& map, double x, double y) {
    int64_t best = -1;
    double bestArea = 0;
    for (const auto& [id, b] : map) {
        if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
        double area = (b.x1 - b.x0) * (b.y1 - b.y0);
        if (best < 0 || area < bestArea) best = id, bestArea = area;
    }
    return best;
}

// A point inside element `id`'s box, nearest its centre, where `id` is the smallest element (the door's
// centre is covered by its door tag, a smaller element).
void AnchorOn(IPXV_Document* doc, int64_t id, double& x, double& y) {
    const sm::ElementMap& map = GetElementMap(Core(doc).Get(), 0);
    sm::Box b = BoxOf(doc, id);
    double bestDist = -1;
    for (int i = 1; i < 20; ++i)
        for (int j = 1; j < 20; ++j) {
            double px = b.x0 + (b.x1 - b.x0) * i / 20, py = b.y0 + (b.y1 - b.y0) * j / 20;
            double dx = px - (b.x0 + b.x1) / 2, dy = py - (b.y0 + b.y1) / 2, d = dx * dx + dy * dy;
            if (SmallestAt(map, px, py) == id && (bestDist < 0 || d < bestDist)) x = px, y = py, bestDist = d;
        }
    if (bestDist < 0) throw std::runtime_error("no point where element " + std::to_string(id) + " is smallest");
}

std::string StepOpen(IPXV_Document* doc, const std::string&) {
    LifecycleInfo s = GetLifecycleInfo(doc);
    bool dirty = Modified(doc);
    doc->put_Modified(VARIANT_FALSE);
    return "{\"enhanced\": " + Bool(s.enhanced) + ", \"markups\": " + std::to_string(s.openMarkups) +
           ", \"annotations\": " + std::to_string(s.currentRows) + ", \"links\": " + std::to_string(s.currentLinks) +
           ", \"dirty\": " + Bool(dirty) + "}";
}

std::string StepAddMarkup(IPXV_Document* doc, const std::string& outDir) {
    GetLifecycleInfo(doc);
    sm::Box wall = BoxOf(doc, 676281);
    double ax = 0, ay = 0;
    AnchorOn(doc, 745963, ax, ay);
    AddAnnot(doc, L"Square", wall.x0 - 40, wall.y0 - 40, wall.x1 + 40, wall.y1 + 40,
             L"Confirm 2 HR rating; see 745963");
    AddAnnot(doc, L"Text", ax, ay - 20, ax + 20, ay, L"Door check", true);  // anchor (x0, y1) on the door

    std::string path = outDir + "\\saved.pdf";
    bool saved = SaveCopy(doc, path);
    LifecycleInfo s = GetLifecycleInfo(doc);
    doc->put_Modified(VARIANT_FALSE);
    return "{\"saved\": " + (saved ? JsonString(path) : std::string("null")) +
           ", \"annotations\": " + std::to_string(s.persistedRows) + ", \"links\": " + std::to_string(s.persistedLinks) +
           ", \"inert\": " + Bool(s.inert) + ", \"noteAnchor\": [" + std::to_string(ax) + ", " +
           std::to_string(ay) + "]}";
}

std::string StepFaultDuckDb(IPXV_Document* doc, const std::string& outDir) {
    GetLifecycleInfo(doc);
    // A fresh markup guarantees the tables change, so the save really attempts a table write.
    AddAnnot(doc, L"Square", 0, 0, 60, 60, L"fault-duckdb self-test");
    SetFaultNextWrite(true);
    bool saved = SaveCopy(doc, outDir + "\\fault.pdf");
    SetFaultNextWrite(false);
    doc->put_Modified(VARIANT_FALSE);
    return "{\"saved\": " + Bool(saved) + ", \"faultHit\": " + Bool(FaultHit()) + "}";
}

// Review finding 1: a highlight showing at save time must never reach the file. Shows the inspect
// highlight on wall 676281 and saves a copy; the caller checks hl.pdf has no smh-highlight annotation.
std::string StepHighlightSave(IPXV_Document* doc, const std::string& outDir) {
    sm::Box box = BoxOf(doc, 676281);
    ShowHighlight(doc, 0, box);
    std::string path = outDir + "\\hl.pdf";
    bool saved = SaveCopy(doc, path);
    doc->put_Modified(VARIANT_FALSE);  // keep the scripted close prompt-free
    return std::string("{\"saved\": ") + (saved ? "true" : "false") + ", \"file\": " + JsonString(path) + "}";
}

struct RegisterSteps {
    RegisterSteps() {
        RegisterSelfTestStep("lifecycle-open", &StepOpen);
        RegisterSelfTestStep("addmarkup", &StepAddMarkup);
        RegisterSelfTestStep("fault-duckdb", &StepFaultDuckDb);
        RegisterSelfTestStep("highlight-save", &StepHighlightSave);
    }
} gRegisterSteps;

}  // namespace
