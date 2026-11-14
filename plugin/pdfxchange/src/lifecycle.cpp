// Silent linking + table sync (spec "Lifecycle"): catch-up on open, in-memory re-link on markup changes,
// annotations.parquet / annotation-links.parquet written into the attachments on save.
// Events (confirmed at runtime, all from IPXV_Document): e.document.viewingStarted, e.annots.*,
// e.document.beforeSave / afterSave, e.document.beforeClose / closed.
#include "lifecycle.h"

#include <cstdio>
#include <exception>
#include <map>
#include <stdexcept>
#include <string>

#include "attachments.h"
#include "com_ptr.h"
#include "doc_state.h"
#include "element_map.h"
#include "events.h"
#include "log.h"
#include "markups.h"
#include "smartmarkup/reconcile.h"
#include "smartmarkup/tables.h"

namespace {

struct DocState {
    bool inert = true;      // nothing is done for this document (not enhanced, or something failed)
    bool enhanced = false;  // has elements.parquet
    ComPtr<IPXC_Document> core;  // keeps the key alive while state exists
    sm::ModelData model;
    sm::AnnotationState persisted;  // what the PDF's attachments hold (as read on open / last written)
    sm::AnnotationState current;    // latest in-memory reconcile
    std::map<int, sm::ElementMap> pages;  // 1-based page -> element boxes, filled on demand
    size_t openMarkups = 0;
};

IPXV_Inst* gInst = nullptr;
IPXS_Inst* gPxs = nullptr;
std::map<IPXC_Document*, DocState> gDocs;
bool gBusy = false;            // set while we modify the document ourselves
bool gFaultNextWrite = false;  // self-test: next table write throws sm::TableError
bool gFaultHit = false;

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

// Holds the document's read lock or exclusive lock for a scope. The exclusive lock is polled without
// waiting (bounded), so a lock held elsewhere fails this operation instead of hanging the Editor.
class DocLock {
public:
    DocLock(IPXC_Document* doc, bool exclusive) : exclusive_(exclusive) {
        if (FAILED(doc->get_CosDocument(cos_.Put())) || !cos_) throw std::runtime_error("no cos document");
        HRESULT hr = E_FAIL;
        if (!exclusive) {
            hr = cos_->LockDocument(VARIANT_TRUE);
        } else {
            DWORD started = GetTickCount();
            for (;;) {
                hr = cos_->LockDocumentExclusive(VARIANT_FALSE);
                if (hr == S_OK || GetTickCount() - started > 3000) break;
                Sleep(10);
            }
        }
        if (hr != S_OK) {
            char buf[96];
            snprintf(buf, sizeof buf, "could not take the %s lock (hr=0x%08lx)", exclusive ? "exclusive" : "read",
                     static_cast<unsigned long>(hr));
            throw std::runtime_error(buf);
        }
    }
    ~DocLock() {
        if (exclusive_)
            cos_->UnlockDocumentExclusive();
        else
            cos_->UnlockDocument();
    }
    DocLock(const DocLock&) = delete;
    DocLock& operator=(const DocLock&) = delete;

private:
    ComPtr<IPXS_Document> cos_;
    bool exclusive_;
};

ComPtr<IPXV_Document> AsDoc(IUnknown* from) {
    ComPtr<IPXV_Document> doc;
    if (from) from->QueryInterface(__uuidof(IPXV_Document), reinterpret_cast<void**>(doc.Put()));
    return doc;
}

ComPtr<IPXC_Document> CoreOf(IPXV_Document* doc) {
    ComPtr<IPXC_Document> core;
    if (doc) doc->get_CoreDoc(core.Put());
    return core;
}

DocState* Find(IPXC_Document* core) {
    auto it = gDocs.find(core);
    return (it == gDocs.end() || it->second.inert) ? nullptr : &it->second;
}

void MakeInert(IPXC_Document* core) {
    auto it = gDocs.find(core);
    if (it != gDocs.end()) it->second.inert = true;
}

CollectedMarkups Collect(IPXC_Document* core) {
    DocLock lock(core, false);
    return CollectMarkups(core);
}

sm::ReconcileResult RunReconcile(IPXC_Document* core, DocState& s, const CollectedMarkups& c) {
    for (const auto& m : c.markups)  // element maps take their own read lock: build them outside ours
        if (!s.pages.count(m.page)) s.pages.emplace(m.page, GetElementMap(core, m.page - 1));
    sm::ReconcileInput in;
    in.pages = &s.pages;
    in.model = &s.model;
    in.markups = c.markups;
    in.existing = s.persisted;
    in.nowUtc = NowUtc();
    return sm::Reconcile(in);
}

// Writes the ids Reconcile assigned into the annotations' /NM. Caller holds the exclusive lock.
void ApplyIds(const CollectedMarkups& c, const sm::ReconcileResult& r) {
    for (const auto& [index, id] : r.assignedIds) SetAnnotationId(c.annots[index].Get(), id);
}

bool IsModified(IPXV_Document* doc) {
    VARIANT_BOOL v = VARIANT_FALSE;
    doc->get_Modified(&v);
    return v != VARIANT_FALSE;
}

void OpenDoc(IPXV_Document* doc, IPXC_Document* core) {
    gDocs.erase(core);
    DocState& s = gDocs[core];
    s.core.Attach(core);
    sm::Attachments files;
    {
        DocLock lock(core, false);
        files = ReadAttachments(core);
    }
    s.enhanced = sm::IsEnhanced(files);
    if (!s.enhanced) {
        LogLine("lifecycle: not an enhanced PDF, staying inert");
        return;
    }
    s.model = sm::ReadModel(files);
    s.persisted = sm::ReadAnnotations(files);

    bool wasDirty = IsModified(doc);
    CollectedMarkups c = Collect(core);
    sm::ReconcileResult r = RunReconcile(core, s, c);
    if (!r.assignedIds.empty()) {
        DocLock lock(core, true);
        ApplyIds(c, r);
    }
    s.current = r.state;
    s.openMarkups = c.markups.size();
    s.inert = false;
    if (r.changed)
        doc->put_Modified(VARIANT_TRUE);  // catch-up changed the tables: the next save writes them
    else if (!wasDirty)
        doc->put_Modified(VARIANT_FALSE);  // reading must never cause a "Save changes?" prompt
    LogLine("lifecycle: open: %zu markups, %zu rows, %zu links, %zu new ids, changed=%d, modified=%d",
            c.markups.size(), r.state.annotations.size(), r.state.links.size(), r.assignedIds.size(),
            r.changed ? 1 : 0, IsModified(doc) ? 1 : 0);
}

void Recompute(IPXC_Document* core, DocState& s) {
    CollectedMarkups c = Collect(core);
    sm::ReconcileResult r = RunReconcile(core, s, c);  // ids for markups without /NM are assigned on save
    s.current = r.state;
    LogLine("lifecycle: recompute: %zu markups, %zu rows, %zu links", c.markups.size(), r.state.annotations.size(),
            r.state.links.size());
}

void SaveDoc(IPXC_Document* core, DocState& s) {
    CollectedMarkups c = Collect(core);
    sm::ReconcileResult r = RunReconcile(core, s, c);
    s.current = r.state;
    if (!r.assignedIds.empty()) {
        DocLock lock(core, true);
        ApplyIds(c, r);
    }
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
        DocLock lock(core, true);
        WriteAttachments(core, gPxs, out);
    }
    s.persisted = r.state;
    LogLine("lifecycle: save: wrote %zu rows, %zu links (%zu new ids)", r.state.annotations.size(),
            r.state.links.size(), r.assignedIds.size());
}

// --- Event handlers (each is wrapped: nothing ever propagates into the Editor) ---------------------

void OnOpen(IUnknown* from) {
    ComPtr<IPXV_Document> doc = AsDoc(from);
    ComPtr<IPXC_Document> core = CoreOf(doc.Get());
    if (!core || gDocs.count(core.Get())) return;
    gBusy = true;
    if (!Guarded("open", [&] { OpenDoc(doc.Get(), core.Get()); })) MakeInert(core.Get());
    gBusy = false;
}

void OnAnnots(IUnknown* from, const char* what) {
    if (gBusy) return;
    ComPtr<IPXC_Document> core = CoreOf(AsDoc(from).Get());
    DocState* s = core ? Find(core.Get()) : nullptr;
    if (!s) return;
    if (!Guarded(what, [&] { Recompute(core.Get(), *s); })) MakeInert(core.Get());
}

void OnBeforeSave(IUnknown* from) {
    ComPtr<IPXC_Document> core = CoreOf(AsDoc(from).Get());
    DocState* s = core ? Find(core.Get()) : nullptr;
    if (!s) return;
    gBusy = true;
    if (!Guarded("save", [&] { SaveDoc(core.Get(), *s); })) MakeInert(core.Get());
    gBusy = false;
}

void OnAfterSave(IEvent* event, IUnknown* from) {
    ComPtr<IPXC_Document> core = CoreOf(AsDoc(from).Get());
    if (!core || !gDocs.count(core.Get())) return;
    PARAM_T hr = 0;
    if (event) event->get_Param1(&hr);
    LogLine("lifecycle: afterSave hr=0x%08lx", static_cast<unsigned long>(hr));
}

void OnClose(IUnknown* from, const char* what) {
    Guarded(what, [&] {
        ComPtr<IPXC_Document> core = CoreOf(AsDoc(from).Get());
        if (!core) return;
        if (gDocs.erase(core.Get())) LogLine("lifecycle: %s: state dropped", what);
        ForgetElementMaps(core.Get());
    });
}

}  // namespace

void RegisterLifecycle(IPXV_Inst* inst) {
    if (!inst) return;
    inst->AddRef();
    gInst = inst;
    BSTR name = SysAllocString(L"PXS");
    ComPtr<IUnknown> ext;
    if (SUCCEEDED(inst->GetExtension(name, ext.Put())) && ext)
        ext->QueryInterface(__uuidof(IPXS_Inst), reinterpret_cast<void**>(&gPxs));
    SysFreeString(name);
    if (!gPxs) LogLine("lifecycle: no PXS extension; table writes will fail");

    Subscribe(inst, "e.document.viewingStarted", [](IEvent*, IUnknown* from) { OnOpen(from); });
    Subscribe(inst, "e.annots.inserted", [](IEvent*, IUnknown* from) { OnAnnots(from, "annots.inserted"); });
    Subscribe(inst, "e.annots.changed", [](IEvent*, IUnknown* from) { OnAnnots(from, "annots.changed"); });
    Subscribe(inst, "e.annots.deleted", [](IEvent*, IUnknown* from) { OnAnnots(from, "annots.deleted"); });
    Subscribe(inst, "e.document.beforeSave", [](IEvent*, IUnknown* from) { OnBeforeSave(from); });
    Subscribe(inst, "e.document.afterSave", [](IEvent* e, IUnknown* from) { OnAfterSave(e, from); });
    Subscribe(inst, "e.document.beforeClose", [](IEvent*, IUnknown* from) { OnClose(from, "beforeClose"); });
    Subscribe(inst, "e.document.closed", [](IEvent*, IUnknown* from) { OnClose(from, "closed"); });
    LogLine("lifecycle: registered");
}

void UnregisterLifecycle() {
    gDocs.clear();
    if (gPxs) {
        gPxs->Release();
        gPxs = nullptr;
    }
    if (gInst) {
        gInst->Release();
        gInst = nullptr;
    }
}

IPXV_Inst* PxvInst() { return gInst; }
IPXS_Inst* PxsInst() { return gPxs; }

LifecycleInfo GetLifecycleInfo(IPXV_Document* doc) {
    LifecycleInfo info;
    ComPtr<IPXC_Document> core = CoreOf(doc);
    if (!core) return info;
    if (!gDocs.count(core.Get())) OnOpen(doc);
    auto it = gDocs.find(core.Get());
    if (it == gDocs.end()) return info;
    const DocState& s = it->second;
    info.known = true;
    info.inert = s.inert;
    info.enhanced = s.enhanced;
    info.openMarkups = s.openMarkups;
    info.currentRows = s.current.annotations.size();
    info.currentLinks = s.current.links.size();
    info.persistedRows = s.persisted.annotations.size();
    info.persistedLinks = s.persisted.links.size();
    return info;
}

void SetFaultNextWrite(bool on) {
    gFaultNextWrite = on;
    if (on) gFaultHit = false;
}

bool FaultHit() { return gFaultHit; }

const sm::ModelData* FindModel(IPXC_Document* doc) {
    DocState* s = Find(doc);
    return s ? &s->model : nullptr;
}
