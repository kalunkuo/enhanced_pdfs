// Silent linking + table sync (spec "Lifecycle"): catch-up on open, in-memory re-link on markup changes,
// annotations.parquet / annotation-links.parquet written into the attachments on save.
#include <windows.h>

#include <algorithm>
#include <exception>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

#include "attachments.h"
#include "doc_state.h"
#include "duckdb_load.h"
#include "element_map.h"
#include "hooks.h"
#include "log.h"
#include "markups.h"
#include "sdk_call.h"
#include "selftest.h"
#include "smartmarkup/reconcile.h"
#include "smartmarkup/tables.h"

namespace {

struct DocState {
    bool inert = true;      // nothing is done for this document (not enhanced, or something failed)
    bool enhanced = false;  // has elements.parquet
    CosDoc cos = nullptr;
    sm::ModelData model;
    sm::AnnotationState persisted;  // what the PDF's attachments hold (as read on open / last written)
    sm::AnnotationState current;    // latest in-memory reconcile
    std::map<int, sm::ElementMap> pages;  // 1-based page -> element boxes, filled on demand
    size_t openMarkups = 0;
    bool saveHandled = false;  // WillSaveEx and WillSave both fire; act once per save
};

std::map<PDDoc, DocState> gDocs;
bool gBusy = false;            // set while we modify annotations ourselves
bool gFaultNextWrite = false;  // self-test: next table write throws sm::TableError
bool gFaultHit = false;

// Runs fn; errors are logged and reported as false, never escape into Acrobat. No DURING here: every SDK
// call below goes through Sdk() (sdk_call.h), so an Acrobat raise arrives as AcroError and C++ objects are
// destroyed normally on the way out.
template <class F>
bool Guarded(const char* what, F&& fn) {
    try {
        fn();
        return true;
    } catch (const std::exception& e) {
        LogLine("lifecycle: %s failed: %s", what, e.what());
    } catch (...) {
        LogLine("lifecycle: %s failed: unknown C++ exception", what);
    }
    return false;
}

// Marks our own annotation / attachment edits so the change notifications they cause are ignored.
struct BusyScope {
    BusyScope() { gBusy = true; }
    ~BusyScope() { gBusy = false; }
    BusyScope(const BusyScope&) = delete;
    BusyScope& operator=(const BusyScope&) = delete;
};

DocState* Find(PDDoc doc) {
    auto it = gDocs.find(doc);
    return (it == gDocs.end() || it->second.inert) ? nullptr : &it->second;
}

DocState* FindByCos(CosDoc cos) {
    for (auto& [doc, state] : gDocs)
        if (state.cos == cos && !state.inert) return &state;
    return nullptr;
}

PDDoc DocOf(const DocState* state) {
    for (auto& [doc, s] : gDocs)
        if (&s == state) return doc;
    return nullptr;
}

sm::ReconcileResult RunReconcile(PDDoc doc, DocState& s, const CollectedMarkups& c) {
    for (const auto& m : c.markups)
        if (!s.pages.count(m.page)) s.pages.emplace(m.page, GetElementMap(doc, m.page - 1));
    sm::ReconcileInput in;
    in.pages = &s.pages;
    in.model = &s.model;
    in.markups = c.markups;
    in.existing = s.persisted;
    in.nowUtc = NowUtc();
    return sm::Reconcile(in);
}

// Writes the ids Reconcile assigned into the annotations' /NM (the only change we make to a markup).
void ApplyIds(const CollectedMarkups& c, const sm::ReconcileResult& r, CosDoc cos) {
    BusyScope busy;
    for (const auto& [index, id] : r.assignedIds)
        Sdk(CosDictPutKeyString, c.annots[index], "NM",
            Sdk(CosNewString, cos, static_cast<ASBool>(false), id.data(), static_cast<ASTArraySize>(id.size())));
}

ASUns32 DocFlags(PDDoc doc) { return static_cast<ASUns32>(Sdk(PDDocGetFlags, doc)); }

void MakeInert(PDDoc doc) {
    auto it = gDocs.find(doc);
    if (it != gDocs.end()) it->second.inert = true;
}

void OpenDoc(PDDoc doc) {
    DocState& s = gDocs[doc];
    s = DocState{};  // inert until the open completes
    if (!DuckDbAvailable()) {  // no DuckDB: never touch the tables (a call would crash Acrobat)
        LogLine("lifecycle: duckdb.dll unavailable, document left alone");
        return;
    }
    s.cos = Sdk(PDDocGetCosDoc, doc);
    sm::Attachments files = ReadAttachments(doc);
    s.enhanced = sm::IsEnhanced(files);
    if (!s.enhanced) {
        LogLine("lifecycle: not an enhanced PDF, staying inert");
        return;
    }
    s.model = sm::ReadModel(files);
    s.persisted = sm::ReadAnnotations(files);

    bool wasDirty = (DocFlags(doc) & PDDocNeedsSave) != 0;
    CollectedMarkups c = CollectMarkups(doc);
    sm::ReconcileResult r = RunReconcile(doc, s, c);
    ApplyIds(c, r, s.cos);
    s.current = r.state;
    s.openMarkups = c.markups.size();
    s.inert = false;
    if (r.changed)
        Sdk(PDDocSetFlags, doc, static_cast<ASInt32>(PDDocNeedsSave));
    else if (!wasDirty)
        Sdk(PDDocClearFlags, doc, static_cast<ASInt32>(PDDocNeedsSave));  // reading must never prompt "Save changes?"
    LogLine("lifecycle: open: %zu markups, %zu rows, %zu links, %zu new ids, changed=%d", c.markups.size(),
            r.state.annotations.size(), r.state.links.size(), r.assignedIds.size(), r.changed ? 1 : 0);
}

void Recompute(PDDoc doc, DocState& s) {
    CollectedMarkups c = CollectMarkups(doc);
    sm::ReconcileResult r = RunReconcile(doc, s, c);  // ids for markups without /NM are assigned on save
    s.current = r.state;
    LogLine("lifecycle: recompute: %zu markups, %zu rows, %zu links", c.markups.size(), r.state.annotations.size(),
            r.state.links.size());
}

void SaveDoc(PDDoc doc, DocState& s) {
    CollectedMarkups c = CollectMarkups(doc);
    sm::ReconcileResult r = RunReconcile(doc, s, c);
    ApplyIds(c, r, s.cos);
    s.current = r.state;
    if (!r.changed) {
        LogLine("lifecycle: save: tables unchanged, attachments left as they are");
        return;
    }
    if (gFaultNextWrite) {
        gFaultNextWrite = false;
        gFaultHit = true;
        throw sm::TableError("injected table-write fault (self-test)");
    }
    sm::Attachments out;
    out["annotations.parquet"] = sm::WriteAnnotationsParquet(r.state.annotations);
    out["annotation-links.parquet"] = sm::WriteLinksParquet(r.state.links);
    {
        BusyScope busy;
        WriteAttachments(doc, out);
    }
    s.persisted = r.state;
    LogLine("lifecycle: save: wrote %zu rows, %zu links", r.state.annotations.size(), r.state.links.size());
}

// Failure policy: only a failure while opening makes a document inert. A recompute or save failure is
// logged and the next change or save retries: one transient error must not silently stop all later
// table writes.
void OnChangedDoc(PDDoc doc, const char* what) {
    if (gBusy || !doc) return;
    DocState* s = Find(doc);
    if (!s) return;
    Guarded(what, [&] { Recompute(doc, *s); });
}

void OnWillSave(PDDoc doc) {
    DocState* s = Find(doc);
    if (!s || s->saveHandled) return;
    s->saveHandled = true;
    Guarded("save", [&] { SaveDoc(doc, *s); });  // the save itself proceeds either way
}

// --- Acrobat notifications -------------------------------------------------------------------------

ACCB1 void ACCB2 DidOpen(AVDoc avDoc, ASInt32 error, void*) {
    if (error || !avDoc) return;
    PDDoc doc = nullptr;
    Guarded("open", [&] {
        doc = Sdk(AVDocGetPDDoc, avDoc);
        if (doc && !gDocs.count(doc)) OpenDoc(doc);
    });
    if (doc && !Find(doc)) MakeInert(doc);
    gBusy = false;
}

ACCB1 void ACCB2 WillClose(AVDoc avDoc, void*) {
    Guarded("close", [&] {
        PDDoc doc = Sdk(AVDocGetPDDoc, avDoc);
        if (!doc) return;
        gDocs.erase(doc);
        ForgetElementMaps(doc);
    });
}

ACCB1 void ACCB2 DidAddAnnot(PDPage page, PDAnnot, ASInt32 error, void*) {
    if (error || gBusy) return;
    PDDoc doc = nullptr;
    Guarded("add-annot", [&] { doc = Sdk(PDPageGetDoc, page); });
    OnChangedDoc(doc, "add-annot");
}

ACCB1 void ACCB2 DidChangeAnnot(PDAnnot annot, ASAtom, ASInt32 error, void*) {
    if (error || gBusy) return;
    PDDoc doc = nullptr;
    Guarded("change-annot", [&] {
        if (DocState* s = FindByCos(Sdk(CosObjGetDoc, Sdk(PDAnnotGetCosObj, annot)))) doc = DocOf(s);
    });
    OnChangedDoc(doc, "change-annot");
}

ACCB1 void ACCB2 DidRemoveAnnot(PDPage page, ASInt32, ASInt32 error, void*) {
    if (error || gBusy) return;
    PDDoc doc = nullptr;
    Guarded("remove-annot", [&] { doc = Sdk(PDPageGetDoc, page); });
    OnChangedDoc(doc, "remove-annot");
}

ACCB1 void ACCB2 WillSaveEx(PDDoc doc, PDDocSaveParams, void*) { OnWillSave(doc); }

ACCB1 void ACCB2 WillSave(PDDoc doc, void*) { OnWillSave(doc); }

ACCB1 void ACCB2 DidSave(PDDoc doc, ASInt32, void*) {
    auto it = gDocs.find(doc);
    if (it != gDocs.end()) it->second.saveHandled = false;
}

// --- Self-test steps -------------------------------------------------------------------------------

DocState& StateFor(PDDoc doc) {
    auto it = gDocs.find(doc);
    if (it == gDocs.end()) throw std::runtime_error("no lifecycle state for document");
    return it->second;
}

std::string Bool(bool v) { return v ? "true" : "false"; }

bool FileExists(const std::string& path) { return GetFileAttributesA(path.c_str()) != INVALID_FILE_ATTRIBUTES; }

// Full save to a new path. Returns false (never raises) if Acrobat reports an error.
bool SaveTo(PDDoc doc, const std::string& path) {
    DeleteFileA(path.c_str());
    volatile bool ok = true;
    ASFileSys fs = Sdk(ASGetDefaultFileSys);
    ASPathName name = Sdk(ASFileSysCreatePathName, fs, Sdk(ASAtomFromString, "Cstring"),
                          static_cast<const void*>(path.c_str()), static_cast<const void*>(nullptr));
    const char* pathText = path.c_str();
    DURING  // plain values only inside (sdk_call.h)
        PDDocSave(doc, static_cast<PDSaveFlags>(PDSaveFull | PDSaveCollectGarbage), name, fs, nullptr, nullptr);
    HANDLER
        ok = false;
        LogLine("selftest: save to %s failed (error %d)", pathText, (int)ERRORCODE);
    END_HANDLER
    SdkNoThrow(ASFileSysReleasePath, fs, name);
    return ok && FileExists(path);
}

ASFixedRect FixedRect(double x0, double y0, double x1, double y1) {
    ASFixedRect r;
    r.left = FloatToASFixed(x0);
    r.right = FloatToASFixed(x1);
    r.bottom = FloatToASFixed(y0);
    r.top = FloatToASFixed(y1);
    return r;
}

void PutString(PDAnnot annot, const char* key, const std::string& value, CosDoc cos) {
    Sdk(CosDictPutKeyString, Sdk(PDAnnotGetCosObj, annot), key,
        Sdk(CosNewString, cos, static_cast<ASBool>(false), value.data(), static_cast<ASTArraySize>(value.size())));
}

PDAnnot AddAnnot(PDPage page, const char* subtype, const ASFixedRect& rect) {
    return Sdk(PDPageAddNewAnnot, page, static_cast<ASInt32>(-1), Sdk(ASAtomFromString, subtype), &rect);
}

const sm::Box& BoxOf(PDDoc doc, int64_t id) {
    const sm::ElementMap& map = GetElementMap(doc, 0);
    auto it = map.find(id);
    if (it == map.end()) throw std::runtime_error("element " + std::to_string(id) + " not in page 1 element map");
    return it->second;
}

std::string StepOpen(PDDoc doc, const std::string&) {
    const DocState& s = StateFor(doc);
    bool dirty = (DocFlags(doc) & PDDocNeedsSave) != 0;
    return "{\"enhanced\": " + Bool(s.enhanced) + ", \"markups\": " + std::to_string(s.openMarkups) +
           ", \"annotations\": " + std::to_string(s.current.annotations.size()) +
           ", \"links\": " + std::to_string(s.current.links.size()) + ", \"dirty\": " + Bool(dirty) + "}";
}

std::string StepAddMarkup(PDDoc doc, const std::string& outDir) {
    CosDoc cos = Sdk(PDDocGetCosDoc, doc);
    sm::Box wall = BoxOf(doc, 676281);
    sm::Box door = BoxOf(doc, 745963);
    double cx = (door.x0 + door.x1) / 2, cy = (door.y0 + door.y1) / 2;

    PDPage page = Sdk(PDDocAcquirePage, doc, static_cast<ASInt32>(0));
    ASFixedRect squareRect = FixedRect(wall.x0 - 40, wall.y0 - 40, wall.x1 + 40, wall.y1 + 40);
    PDAnnot square = AddAnnot(page, "Square", squareRect);
    PutString(square, "Contents", "Confirm 2 HR rating; see 745963", cos);
    PutString(square, "T", "SmartMarkup self-test", cos);
    ASFixedRect noteRect = FixedRect(cx, cy - 20, cx + 20, cy);  // anchor (x0, y1) = door centre
    PDAnnot note = AddAnnot(page, "Text", noteRect);
    PutString(note, "Contents", "Door check", cos);
    PutString(note, "T", "SmartMarkup self-test", cos);
    Sdk(PDPageRelease, page);

    std::string path = outDir + "\\saved.pdf";
    bool saved = SaveTo(doc, path);
    const DocState& s = StateFor(doc);
    return "{\"saved\": " + (saved ? JsonString(path) : std::string("null")) +
           ", \"annotations\": " + std::to_string(s.persisted.annotations.size()) +
           ", \"links\": " + std::to_string(s.persisted.links.size()) + ", \"inert\": " + Bool(s.inert) + "}";
}

std::string StepFaultDuckDb(PDDoc doc, const std::string& outDir) {
    // A fresh markup guarantees the tables change, so the save really attempts a table write.
    PDPage page = Sdk(PDDocAcquirePage, doc, static_cast<ASInt32>(0));
    ASFixedRect rect = FixedRect(0, 0, 60, 60);
    PDAnnot square = AddAnnot(page, "Square", rect);
    PutString(square, "Contents", "fault-duckdb self-test", Sdk(PDDocGetCosDoc, doc));
    Sdk(PDPageRelease, page);

    gFaultHit = false;
    gFaultNextWrite = true;
    bool saved = SaveTo(doc, outDir + "\\fault.pdf");
    gFaultNextWrite = false;
    return "{\"saved\": " + Bool(saved) + ", \"faultHit\": " + Bool(gFaultHit) + "}";
}

struct RegisterSteps {
    RegisterSteps() {
        RegisterSelfTestStep("lifecycle-open", &StepOpen);
        RegisterSelfTestStep("addmarkup", &StepAddMarkup);
        RegisterSelfTestStep("fault-duckdb", &StepFaultDuckDb);
    }
} gRegisterSteps;

}  // namespace

void RegisterLifecycle() {
    AVAppRegisterNotification(AVDocDidOpenNSEL, gExtensionID,
                              (void*)ASCallbackCreateNotification(AVDocDidOpen, &DidOpen), nullptr);
    AVAppRegisterNotification(AVDocWillCloseNSEL, gExtensionID,
                              (void*)ASCallbackCreateNotification(AVDocWillClose, &WillClose), nullptr);
    AVAppRegisterNotification(PDPageDidAddAnnotNSEL, gExtensionID,
                              (void*)ASCallbackCreateNotification(PDPageDidAddAnnot, &DidAddAnnot), nullptr);
    AVAppRegisterNotification(PDAnnotDidChangeNSEL, gExtensionID,
                              (void*)ASCallbackCreateNotification(PDAnnotDidChange, &DidChangeAnnot), nullptr);
    AVAppRegisterNotification(PDPageDidRemoveAnnotNSEL, gExtensionID,
                              (void*)ASCallbackCreateNotification(PDPageDidRemoveAnnot, &DidRemoveAnnot), nullptr);
    AVAppRegisterNotification(PDDocWillSaveExNSEL, gExtensionID,
                              (void*)ASCallbackCreateNotification(PDDocWillSaveEx, &WillSaveEx), nullptr);
    AVAppRegisterNotification(PDDocWillSaveNSEL, gExtensionID,
                              (void*)ASCallbackCreateNotification(PDDocWillSave, &WillSave), nullptr);
    AVAppRegisterNotification(PDDocDidSaveNSEL, gExtensionID,
                              (void*)ASCallbackCreateNotification(PDDocDidSave, &DidSave), nullptr);
    LogLine("lifecycle: registered");
}

const sm::ModelData* FindModel(PDDoc doc) {
    DocState* s = Find(doc);
    return s ? &s->model : nullptr;
}

std::vector<int64_t> LinkedElementIds(PDDoc doc, const std::string& annotationId) {
    std::vector<int64_t> ids;
    DocState* s = Find(doc);
    if (!s) return ids;
    for (const auto& link : s->current.links)  // both "linked" and "referenced"
        if (link.annotationId == annotationId) ids.push_back(link.elementId);
    std::sort(ids.begin(), ids.end());
    ids.erase(std::unique(ids.begin(), ids.end()), ids.end());
    return ids;
}
