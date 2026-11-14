// Click-to-inspect: a toggle in the Smart Markup menu; while on, clicking an element shows its properties.
#include <windows.h>

#include <string>

#include "doc_state.h"
#include "element_map.h"
#include "hooks.h"
#include "inspect_window.h"
#include "log.h"
#include "selftest.h"
#include "smartmarkup/inspect_rows.h"
#include "smartmarkup/linking.h"

namespace {

bool gOn = false;
AVMenuItem gItem = nullptr;
AVPageViewClickProc gClickCb = nullptr;

ACCB1 ASBool ACCB2 AlwaysEnabled(void*) { return true; }
ACCB1 ASBool ACCB2 IsMarked(void*) { return gOn; }
ACCB1 void ACCB2 Toggle(void*) { gOn = !gOn; }

ACCB1 ASBool ACCB2 OnPageClick(AVPageView pageView, AVDevCoord x, AVDevCoord y, AVFlagBits16, AVTCount, void*) {
    if (!gOn) return false;
    bool consumed = false;
    try {
        DURING
            AVDoc avDoc = AVPageViewGetAVDoc(pageView);
            PDDoc pdDoc = avDoc ? AVDocGetPDDoc(avDoc) : nullptr;
            if (pdDoc) {
                ASFixedPoint pt;
                AVPageViewDevicePointToPage(pageView, x, y, &pt);
                int pageIndex = (int)AVPageViewGetPageNum(pageView);
                const sm::ElementMap& map = GetElementMap(pdDoc, pageIndex);
                auto hit = sm::ElementAt(map, pt.h / 65536.0, pt.v / 65536.0);
                if (hit) {
                    const sm::ModelData* model = FindModel(pdDoc);
                    if (!model) {
                        LogLine("inspect: element %lld hit but document has no model", (long long)*hit);
                    } else {
                        auto rows = sm::InspectRows(*model, *hit);
                        if (!rows.empty()) {
                            ShowInspectWindow(WinAppGetModalParent(avDoc), *hit, rows);
                            consumed = true;
                        }
                    }
                }
            }
        HANDLER
            LogLine("inspect: click failed (error %d)", (int)ERRORCODE);
            consumed = false;
        END_HANDLER
    } catch (...) {
        LogLine("inspect: click threw");
        consumed = false;
    }
    return consumed;
}

std::string SelfTestInspect(PDDoc doc, const std::string&) {
    const sm::ElementMap& map = GetElementMap(doc, 0);
    const int64_t id = 676281;
    auto it = map.find(id);
    if (it == map.end()) return "{\"error\": \"element 676281 not on page 1\"}";
    const sm::Box& b = it->second;
    auto hit = sm::ElementAt(map, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    const sm::ModelData* model = FindModel(doc);
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

void RegisterInspect() {
    DURING
        AVMenu menu = SmartMarkupMenu();
        if (menu) {
            gItem = AVMenuItemNew("Inspect elements", "TTACM:SmartMarkupInspect", nullptr, true, NO_SHORTCUT, 0,
                                  nullptr, gExtensionID);
            AVMenuItemSetExecuteProc(gItem, ASCallbackCreateProto(AVExecuteProc, &Toggle), nullptr);
            AVMenuItemSetComputeEnabledProc(gItem, ASCallbackCreateProto(AVComputeEnabledProc, &AlwaysEnabled),
                                            nullptr);
            AVMenuItemSetComputeMarkedProc(gItem, ASCallbackCreateProto(AVComputeMarkedProc, &IsMarked), nullptr);
            AVMenuAddMenuItem(menu, gItem, APPEND_MENUITEM);
        }
        gClickCb = ASCallbackCreateProto(AVPageViewClickProc, &OnPageClick);
        AVAppRegisterForPageViewClicks(gClickCb, nullptr);
    HANDLER
        LogLine("inspect: registration failed (error %d)", (int)ERRORCODE);
    END_HANDLER
}

void UnregisterInspect() {
    DURING
        if (gClickCb) AVAppUnregisterForPageViewClicks(gClickCb);
        gClickCb = nullptr;
        if (gItem) AVMenuItemRemove(gItem);
        gItem = nullptr;
    HANDLER
        LogLine("inspect: unregister failed (error %d)", (int)ERRORCODE);
    END_HANDLER
    gOn = false;
    DestroyInspectWindow();
}
