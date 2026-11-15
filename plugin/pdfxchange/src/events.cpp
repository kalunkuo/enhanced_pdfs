#include "events.h"

#include <atomic>
#include <cstdio>
#include <exception>
#include <map>
#include <vector>

#include "log.h"

namespace {

// One handler object per subscription; the Editor holds a reference while registered.
class Handler : public IEventHandler {
public:
    Handler(std::string name, EventCallback callback) : name_(std::move(name)), callback_(std::move(callback)) {}

    HRESULT __stdcall QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown || riid == IID_IDispatch || riid == __uuidof(IEventHandler)) {
            *ppv = static_cast<IEventHandler*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }
    ULONG __stdcall AddRef() override { return ++refs_; }
    ULONG __stdcall Release() override {
        ULONG n = --refs_;
        if (n == 0) delete this;
        return n;
    }
    // IDispatch: native handlers are called through OnEvent only.
    HRESULT __stdcall GetTypeInfoCount(UINT* n) override { if (n) *n = 0; return S_OK; }
    HRESULT __stdcall GetTypeInfo(UINT, LCID, ITypeInfo**) override { return E_NOTIMPL; }
    HRESULT __stdcall GetIDsOfNames(REFIID, LPOLESTR*, UINT, LCID, DISPID*) override { return E_NOTIMPL; }
    HRESULT __stdcall Invoke(DISPID, REFIID, LCID, WORD, DISPPARAMS*, VARIANT*, EXCEPINFO*, UINT*) override {
        return E_NOTIMPL;
    }

    HRESULT __stdcall OnEvent(long, IEvent* event, IUnknown* from) override {
        try {
            callback_(event, from);
        } catch (const std::exception& e) {
            LogLine("event %s: handler threw: %s", name_.c_str(), e.what());
        } catch (...) {
            LogLine("event %s: handler threw", name_.c_str());
        }
        return S_OK;  // never let a failure reach the Editor
    }

private:
    std::atomic<ULONG> refs_{1};
    std::string name_;
    EventCallback callback_;
};

struct Subscription {
    long id;
    Handler* handler;
};

IEventServer* gServer = nullptr;
std::vector<Subscription> gSubscriptions;

const char* SourceKind(IUnknown* from) {
    if (!from) return "null";
    IUnknown* probe = nullptr;
    if (SUCCEEDED(from->QueryInterface(__uuidof(IPXV_Document), reinterpret_cast<void**>(&probe)))) {
        probe->Release();
        return "IPXV_Document";
    }
    if (SUCCEEDED(from->QueryInterface(__uuidof(IPXV_PagesView), reinterpret_cast<void**>(&probe)))) {
        probe->Release();
        return "IPXV_PagesView";
    }
    return "other";
}

}  // namespace

bool Subscribe(IPXV_Inst* inst, const char* eventName, EventCallback callback) {
    if (!inst) return false;
    if (!gServer && FAILED(inst->get_EventServer(&gServer))) {
        LogLine("events: no event server");
        return false;
    }
    std::wstring wide(eventName, eventName + strlen(eventName));
    BSTR name = SysAllocString(wide.c_str());
    long id = 0;
    HRESULT hr = inst->Str2ID(name, VARIANT_FALSE, &id);
    SysFreeString(name);
    if (FAILED(hr) || id == 0) {
        LogLine("events: unknown event name %s (hr=0x%08lx)", eventName, (unsigned long)hr);
        return false;
    }
    auto* handler = new Handler(eventName, std::move(callback));
    hr = gServer->RegisterNativeEventHandler(id, handler, 0);
    if (FAILED(hr)) {
        LogLine("events: register %s failed (hr=0x%08lx)", eventName, (unsigned long)hr);
        handler->Release();
        return false;
    }
    gSubscriptions.push_back({id, handler});
    LogLine("events: subscribed %s (id=%ld)", eventName, id);
    return true;
}

void UnsubscribeAll() {
    for (const auto& s : gSubscriptions) {
        if (gServer) gServer->UnregisterNativeEventHandler(s.id, s.handler);
        s.handler->Release();
    }
    gSubscriptions.clear();
    if (gServer) {
        gServer->Release();
        gServer = nullptr;
    }
}

void SubscribeProbe(IPXV_Inst* inst) {
    static const char* kCandidates[] = {
        "e.document.initialized", "e.document.viewingStarted", "e.document.activated",
        "e.document.beforeSave",  "e.document.afterSave",      "e.document.savePerformed",
        "e.document.beforeClose", "e.document.closed",         "e.annots.inserted",
        "e.annots.changed",       "e.annots.deleted",          "e.pagesView.mouse",
    };
    for (const char* name : kCandidates) {
        std::string label = name;
        Subscribe(inst, name, [label](IEvent* event, IUnknown* from) {
            PARAM_T p1 = 0, p2 = 0;
            if (event) {
                event->get_Param1(&p1);
                event->get_Param2(&p2);
            }
            if (label == "e.pagesView.mouse" && p1 != WM_LBUTTONDOWN) return;  // only clicks, not every move
            LogLine("probe: %s p1=0x%llx p2=0x%llx from=%s", label.c_str(), (unsigned long long)p1,
                    (unsigned long long)p2, SourceKind(from));
        });
    }
}
