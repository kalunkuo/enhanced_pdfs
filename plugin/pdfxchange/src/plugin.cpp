// SmartMarkup.pvp entry point: IPXV_Plugin implementation for PDF-XChange Editor.
#include <atomic>
#include <cstdio>

#include "events.h"
#include "inspect.h"
#include "lifecycle.h"
#include "log.h"
#include "pxv.h"
#include "selftest.h"

namespace {

HRESULT Str(BSTR* out, const wchar_t* s) {
    if (!out) return E_POINTER;
    *out = SysAllocString(s);
    return *out ? S_OK : E_OUTOFMEMORY;
}

class SmartMarkupPlugin : public IPXV_Plugin {
public:
    HRESULT __stdcall QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown || riid == __uuidof(IPXV_Plugin)) {
            *ppv = static_cast<IPXV_Plugin*>(this);
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

    HRESULT __stdcall get__GUID(GUID* g) override {
        // {B7E3C1D0-5A42-4F8E-9C6B-2D1E0F3A7B59}
        static const GUID kGuid = {0xb7e3c1d0, 0x5a42, 0x4f8e, {0x9c, 0x6b, 0x2d, 0x1e, 0x0f, 0x3a, 0x7b, 0x59}};
        if (!g) return E_POINTER;
        *g = kGuid;
        return S_OK;
    }
    HRESULT __stdcall get_Name(BSTR* s) override { return Str(s, L"Smart Markup"); }
    HRESULT __stdcall get_CopyrightInfo(BSTR* s) override { return Str(s, L"Smart Markup PoC"); }
    HRESULT __stdcall get_version(ULONG_T* v) override { if (!v) return E_POINTER; *v = 1u << 16; return S_OK; }
    HRESULT __stdcall get_VendorID(ULONG_T* v) override { if (!v) return E_POINTER; *v = 0; return S_OK; }
    HRESULT __stdcall get_Description(BSTR* s) override {
        return Str(s, L"Links your comments and markups to the building elements under them.");
    }
    HRESULT __stdcall get_LegalInfo(BSTR* s) override { return Str(s, L"Hackathon proof of concept"); }
    HRESULT __stdcall get_Publisher(BSTR* s) override { return Str(s, L"Smart Markup PoC"); }
    HRESULT __stdcall get_Features(ULONG_T* v) override { if (!v) return E_POINTER; *v = 0; return S_OK; }
    HRESULT __stdcall get_PresetsCollectionsNames(BSTR* s) override { return Str(s, L""); }

    HRESULT __stdcall Setup(IPXV_Inst* inst) override {
        if (inst) {
            inst->AddRef();
            inst_ = inst;
        }
        LogLine("pxc: setup");
        return S_OK;
    }
    HRESULT __stdcall RegisterExts() override { return S_OK; }
    HRESULT __stdcall FinalizeRegistering() override { return S_OK; }
    HRESULT __stdcall Init() override {
        LogLine("pxc: init");
        char probe[8] = {};
        if (GetEnvironmentVariableA("SMARTMARKUP_PROBE", probe, sizeof probe) > 0) SubscribeProbe(inst_);
        RegisterLifecycle(inst_);
        InitSelfTest(inst_);
        RegisterInspect(inst_);
        return S_OK;
    }
    HRESULT __stdcall Unload() override {
        UnregisterInspect();
        UnsubscribeAll();
        UnregisterLifecycle();
        if (inst_) {
            inst_->Release();
            inst_ = nullptr;
        }
        LogLine("pxc: unload");
        return S_OK;
    }
    HRESULT __stdcall ShowPrefsDlg(HANDLE_T) override { return S_OK; }
    HRESULT __stdcall ImportAdditionalData(IAFS_Name*, IAFS_Name*) override { return S_OK; }
    HRESULT __stdcall ExportAdditionalData(IAFS_Name*, IAFS_Name*) override { return S_OK; }
    HRESULT __stdcall ResetSettings(ULONG_T) override { return S_OK; }

private:
    std::atomic<ULONG> refs_{1};
    IPXV_Inst* inst_ = nullptr;
};

}  // namespace

namespace {
bool gDuckDbLoaded = false;
}

// duckdb.dll is delay-loaded (CMakeLists.txt): load it from this plug-in's folder so the delay-load
// helper finds it already in the process. If that fails, the delay-load helper would raise an SEH
// exception on the first DuckDB call (not catchable by catch(...)), so the lifecycle checks
// DuckDbAvailable() and stays inert instead.
void PreloadDuckDb() {
    HMODULE self = nullptr;
    wchar_t path[MAX_PATH] = {};
    if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                            reinterpret_cast<LPCWSTR>(&PreloadDuckDb), &self) ||
        !GetModuleFileNameW(self, path, MAX_PATH))
        return;
    wchar_t* slash = wcsrchr(path, L'\\');
    if (!slash) return;
    wcscpy_s(slash + 1, MAX_PATH - (slash + 1 - path), L"duckdb.dll");
    gDuckDbLoaded = LoadLibraryExW(path, nullptr, LOAD_WITH_ALTERED_SEARCH_PATH) != nullptr;
    if (!gDuckDbLoaded)
        LogLine("pxc: could not load duckdb.dll next to the plug-in (error %lu); linking disabled", GetLastError());
}

bool DuckDbAvailable() { return gDuckDbLoaded; }

extern "C" HRESULT __stdcall PXCE_GetPlugin(ULONG apiVersion, void*, IPXV_Plugin** plugin) {
    LogLine("pxc: PXCE_GetPlugin api=0x%08lx", apiVersion);
    PreloadDuckDb();
    if (!plugin) return E_POINTER;
    *plugin = new SmartMarkupPlugin();
    return S_OK;
}
