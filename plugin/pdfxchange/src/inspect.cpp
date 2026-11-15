// Click-to-inspect for PDF-XChange Editor.
//
// UI: Init runs before the main frame exists, so the toggle command is added to a command bar lazily:
// from the layout-customisation event (if the Editor knows one of the names below) and again whenever a
// document starts viewing. EnsureCommand() is idempotent.
// Clicks: "e.pagesView.mouse", Param1 = WM_LBUTTONDOWN, Param2 = IUIX_Event (device position in the view).
#include "inspect.h"

#include <atomic>
#include <string>

#include "com_ptr.h"
#include "doc_state.h"
#include "element_map.h"
#include "events.h"
#include "highlight.h"
#include "inspect_window.h"
#include "log.h"
#include "selftest.h"
#include "smartmarkup/inspect_rows.h"
#include "smartmarkup/linking.h"

namespace {

const wchar_t* kCmdId = L"TTACM:SmartMarkupInspect";

IPXV_Inst* gInst = nullptr;
bool gOn = false;
bool gInserted = false;
ComPtr<IUIX_Cmd> gCmd;

bool GetCmdManager(ComPtr<IPXV_MainFrame>& frame, ComPtr<IUIX_CmdManager>& mgr) {
    if (!gInst) return false;
    if (FAILED(gInst->get_ActiveMainFrm(frame.Put())) || !frame) return false;  // no frame yet
    ComPtr<IUIX_Obj> obj;
    ComPtr<IUIX_ThreadContext> ctx;
    return SUCCEEDED(frame->get_Obj(obj.Put())) && obj && SUCCEEDED(obj->get_ThreadCtx(ctx.Put())) && ctx &&
           SUCCEEDED(ctx->get_CmdManager(mgr.Put())) && mgr;
}

void RefreshCommand() {
    try {
        if (!gCmd) return;
        ComPtr<IPXV_MainFrame> frame;
        ComPtr<IUIX_CmdManager> mgr;
        if (!GetCmdManager(frame, mgr)) return;
        long id = 0;
        gCmd->get_ID(&id);
        mgr->UpdateCmdItems(UIX_CmdItemUpdate_State, id);
    } catch (...) {
        LogLine("inspect: refresh threw");
    }
}

class CmdHandler : public IUIX_CmdHandler {
public:
    HRESULT __stdcall QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown || riid == __uuidof(IUIX_CmdHandler)) {
            *ppv = static_cast<IUIX_CmdHandler*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;  // IUIX_CmdHandler2 (optional appearance hooks) is asked for and not needed
        return E_NOINTERFACE;
    }
    ULONG __stdcall AddRef() override { return ++refs_; }
    ULONG __stdcall Release() override {
        ULONG n = --refs_;
        if (n == 0) delete this;
        return n;
    }

    HRESULT __stdcall OnCreateNewCtl(IUIX_Cmd*, IUIX_CmdBar*, IUIX_Obj** ctl) override {
        if (ctl) *ctl = nullptr;
        return S_FALSE;
    }
    HRESULT __stdcall OnGetCtlSizes(IUIX_CmdItem*, tagSIZE*, tagSIZE*, tagSIZE*) override { return S_FALSE; }
    HRESULT __stdcall OnGetItemState(IUIX_Cmd*, IUIX_CmdItem*, IUIX_Obj*, long* state) override {
        if (!state) return E_POINTER;
        *state = gOn ? UIX_CmdItemState_Checked : UIX_CmdItemState_Normal;
        return S_OK;
    }
    HRESULT __stdcall OnGetItemSubMenu(IUIX_CmdItem*, IUIX_CmdMenu** sub) override {
        if (sub) *sub = nullptr;
        return S_FALSE;
    }
    HRESULT __stdcall OnNotify(long code, IUIX_Cmd*, IUIX_CmdItem*, IUIX_Obj*, PARAM_T) override {
        try {
            // A toolbar button press arrives as UIX_Notify_Click (verified in Editor 10.8.4: codes 9 then 1
            // per click, never 37); ExecCmd is kept for menus/shortcuts.
            if (code == UIX_Notify_Click || code == UIX_Notify_ExecCmd) {
                gOn = !gOn;
                LogLine("inspect: %s", gOn ? "on" : "off");
                if (!gOn) ClearHighlight();
                RefreshCommand();
            }
        } catch (...) {
            LogLine("inspect: notify threw");
        }
        return S_OK;
    }
    // The command has no image, so draw a small "i" (info) badge: rounded-ish square with a dot and stem.
    HRESULT __stdcall OnDrawItemIcon(IUIX_RenderContext* rc, IUIX_CmdItem*, tagRECT* icon, tagRECT* clip) override {
        if (!rc || !icon) return S_FALSE;
        try {
            const long kBlue = 0x00B06A1F;   // dark blue/teal; channel order unverified, any dark tone reads well
            const long kWhite = 0x00FFFFFF;
            RECT box = *icon;
            int w = box.right - box.left, h = box.bottom - box.top;
            if (w < 6 || h < 6) return S_FALSE;
            int side = (w < h ? w : h) - 2;
            box.left += (w - side) / 2;
            box.top += (h - side) / 2;
            box.right = box.left + side;
            box.bottom = box.top + side;
            rc->FillSolidRect(&box, kBlue, VARIANT_FALSE);
            int cx = (box.left + box.right) / 2, unit = side / 8 > 0 ? side / 8 : 1;
            RECT dot{cx - unit, box.top + 2 * unit, cx + unit, box.top + 4 * unit};
            RECT stem{cx - unit, box.top + 5 * unit, cx + unit, box.bottom - unit};
            rc->FillSolidRect(&dot, kWhite, VARIANT_FALSE);
            rc->FillSolidRect(&stem, kWhite, VARIANT_FALSE);
            if (gOn) rc->DrawSolidBorder(&box, kWhite, 1, clip, VARIANT_FALSE);
            return S_OK;
        } catch (...) {
            return S_FALSE;
        }
    }

private:
    std::atomic<ULONG> refs_{1};
};

CmdHandler* gHandler = nullptr;

// Picks where the button goes: the quick-access bar in ribbon mode, else the last bar of the top pane.
bool FindTargetBar(IPXV_MainFrame* frame, ComPtr<IUIX_CmdBar>& bar) {
    ComPtr<IUIX_CmdPane> pane;
    ComPtr<IPXV_MainView> view;
    if (FAILED(frame->get_View(view.Put())) || !view) return false;
    if (FAILED(view->get_CmdPaneTop(pane.Put())) || !pane) return false;
    if (SUCCEEDED(pane->get_QABar(bar.Put())) && bar) {
        LogLine("inspect: using quick-access bar");
        return true;
    }
    ULONG lines = 0;
    pane->get_Count(&lines);
    for (ULONG li = lines; li > 0; --li) {
        ComPtr<IUIX_CmdLine> line;
        if (FAILED(pane->get_Item(li - 1, line.Put())) || !line) continue;
        ULONG bars = 0;
        line->get_Count(&bars);
        for (ULONG bi = bars; bi > 0; --bi) {
            ComPtr<IUIX_CmdBar> candidate;
            if (FAILED(line->get_Item(bi - 1, candidate.Put())) || !candidate) continue;
            long id = 0;
            candidate->get_ID(&id);
            LogLine("inspect: using top-pane bar id=%ld (line %lu, bar %lu of %lu lines)", id, li - 1, bi - 1, lines);
            bar.Attach(candidate.Get());
            return true;
        }
    }
    return false;
}

void EnsureCommand() {
    try {
        if (!gInst || gInserted) return;
        ComPtr<IPXV_MainFrame> frame;
        ComPtr<IUIX_CmdManager> mgr;
        if (!GetCmdManager(frame, mgr)) return;
        if (!gCmd) {
            if (!gHandler) gHandler = new CmdHandler();
            BSTR id = SysAllocString(kCmdId);
            BSTR text = SysAllocString(L"Inspect elements");
            BSTR tip = SysAllocString(L"Click a building element in the drawing to see its properties");
            HRESULT hr = mgr->CreateNewCmd(id, text, gHandler, nullptr, tip, 0, gCmd.Put());
            SysFreeString(id);
            SysFreeString(text);
            SysFreeString(tip);
            if (FAILED(hr) || !gCmd) {
                LogLine("inspect: CreateNewCmd failed (hr=0x%08lx)", (unsigned long)hr);
                gCmd.Reset();
                return;
            }
        }
        ComPtr<IUIX_CmdBar> bar;
        if (!FindTargetBar(frame.Get(), bar)) {
            LogLine("inspect: no command bar to add the button to");
            return;
        }
        long cmdId = 0;
        gCmd->get_ID(&cmdId);
        ComPtr<IUIX_CmdItem> existing;
        if (SUCCEEDED(bar->FindFirstItemByCmdID(cmdId, existing.Put())) && existing) {
            gInserted = true;
            return;
        }
        ULONG count = 0;
        bar->FlatGetItemsCount(&count);
        ComPtr<IUIX_CmdItem> item;
        HRESULT hr = bar->FlatInsertItem(gCmd.Get(), (long)count, 0, 0, item.Put());
        LogLine("inspect: FlatInsertItem hr=0x%08lx (cmd %ld at %lu)", (unsigned long)hr, cmdId, count);
        if (SUCCEEDED(hr)) {
            gInserted = true;
            bar->Update();
        }
    } catch (...) {
        LogLine("inspect: EnsureCommand threw");
    }
}

// Resolves the click to {editor doc, core doc, page index, page-space point}. False when not on a page.
bool ResolveClick(IUnknown* from, IUIX_Event* ev, ComPtr<IPXV_Document>& doc, ComPtr<IPXC_Document>& core,
                  int& pageIndex, PXC_Point& pt) {
    ComPtr<IPXV_PagesView> view;
    if (!from || FAILED(from->QueryInterface(__uuidof(IPXV_PagesView), reinterpret_cast<void**>(view.Put()))))
        return false;
    tagPOINT dev = {};
    if (FAILED(ev->get_Pos(&dev))) return false;
    ComPtr<IPXV_PagesLayoutManager> layout;
    if (FAILED(view->get_Layout(layout.Put())) || !layout) return false;
    PXC_Point unused = {};
    long page = -1;
    if (FAILED(layout->HitTest(&dev, &unused, &page)) || page < 0) return false;
    if (FAILED(layout->DevicePointToPagePoint((ULONG)page, &dev, VARIANT_TRUE, &pt))) return false;
    if (FAILED(view->get_Doc(doc.Put())) || !doc) return false;
    if (FAILED(doc->get_CoreDoc(core.Put())) || !core) return false;
    pageIndex = (int)page;
    return true;
}

bool gSwallowUp = false;  // the mouse-down was ours: also swallow its mouse-up (the Editor selects on up)

void Consume(IEvent* event, IUIX_Event* uixEvent) {
    event->put_Handled(VARIANT_TRUE);
    uixEvent->put_Handled(VARIANT_TRUE);
    uixEvent->put_Result(1);
}

void OnMouse(IEvent* event, IUnknown* from) {
    if (!gOn || !event) return;
    PARAM_T p1 = 0, p2 = 0;
    event->get_Param1(&p1);
    if (p1 != WM_LBUTTONDOWN && p1 != WM_LBUTTONUP) return;
    event->get_Param2(&p2);
    auto* uixEvent = reinterpret_cast<IUIX_Event*>(p2);  // borrowed: owned by the Editor for this call
    if (!uixEvent) return;
    if (p1 == WM_LBUTTONUP) {
        if (gSwallowUp) Consume(event, uixEvent);
        gSwallowUp = false;
        return;
    }
    gSwallowUp = false;

    ComPtr<IPXV_Document> doc;
    ComPtr<IPXC_Document> core;
    int pageIndex = 0;
    PXC_Point pt = {};
    if (!ResolveClick(from, uixEvent, doc, core, pageIndex, pt)) return;

    const sm::ElementMap& map = GetElementMap(core.Get(), pageIndex);
    auto hit = sm::ElementAt(map, pt.x, pt.y);
    if (!hit) {
        ClearHighlight();  // clicked empty paper: drop the previous highlight
        return;
    }
    const sm::ModelData* model = FindModel(core.Get());
    if (!model) {
        LogLine("inspect: element %lld hit but document has no model", (long long)*hit);
        return;
    }
    auto rows = sm::InspectRows(*model, *hit);
    if (rows.empty()) return;
    ShowHighlight(doc.Get(), pageIndex, map.at(*hit));
    ShowInspectWindow(GetActiveWindow(), *hit, rows);
    Consume(event, uixEvent);
    gSwallowUp = true;
}

std::string SelfTestInspect(IPXV_Document* doc, const std::string&) {
    ComPtr<IPXC_Document> core;
    if (FAILED(doc->get_CoreDoc(core.Put())) || !core) return "{\"error\": \"no core document\"}";
    const sm::ElementMap& map = GetElementMap(core.Get(), 0);
    const int64_t id = 676281;
    auto it = map.find(id);
    if (it == map.end()) return "{\"error\": \"element 676281 not on page 1\"}";
    const sm::Box& b = it->second;
    auto hit = sm::ElementAt(map, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    const sm::ModelData* model = FindModel(core.Get());
    if (!model) return "{\"error\": \"no model\"}";
    // A smaller element may sit on top of the centre; report both the hit and the target's rows.
    std::string json = "{\"element\": " + std::to_string(id) + ", \"hit\": " + std::to_string(hit ? *hit : -1) +
                       ", \"rows\": [";
    bool first = true;
    for (const auto& r : sm::InspectRows(*model, id)) {
        if (!first) json += ", ";
        first = false;
        json += "[" + JsonString(r.section) + ", " + JsonString(r.name) + ", " + JsonString(r.value) + "]";
    }
    return json + "]}";
}

struct RegisterSteps {
    RegisterSteps() { RegisterSelfTestStep("inspect", &SelfTestInspect); }
} gRegisterSteps;

}  // namespace

void RegisterInspect(IPXV_Inst* inst) {
    try {
        gInst = inst;
        if (!inst) return;
        // Whichever of these the Editor knows fires when the command layout is (re)built.
        for (const char* name : {"e.customizeCmdLayout", "e.cmdLayout.customize", "e.mainFrame.customizeCmdLayout"})
            Subscribe(inst, name, [](IEvent*, IUnknown*) { EnsureCommand(); });
        // Fallback: a document starting to view means the frame exists.
        Subscribe(inst, "e.document.viewingStarted", [](IEvent*, IUnknown*) { EnsureCommand(); });
        Subscribe(inst, "e.pagesView.mouse", OnMouse);
        // Selection changes (clear / show linked elements) are handled in linked_highlight.cpp.
        EnsureCommand();  // usually too early (no frame yet); harmless
    } catch (...) {
        LogLine("inspect: registration threw");
    }
}

void UnregisterInspect() {
    try {
        gOn = false;
        if (gCmd) {
            ComPtr<IPXV_MainFrame> frame;
            ComPtr<IUIX_CmdManager> mgr;
            ComPtr<IUIX_CmdCollection> cmds;
            if (GetCmdManager(frame, mgr) && SUCCEEDED(mgr->get_Cmds(cmds.Put())) && cmds) cmds->Delete(gCmd.Get());
        }
    } catch (...) {
        LogLine("inspect: unregister threw");
    }
    gCmd.Reset();
    if (gHandler) {
        gHandler->Release();
        gHandler = nullptr;
    }
    gInserted = false;
    gInst = nullptr;
    DestroyInspectWindow();
}
