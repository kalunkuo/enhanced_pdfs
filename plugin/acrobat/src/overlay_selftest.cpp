// Self-test step "overlay": show/clear the overlay and prove the document is not dirtied.
#include <string>

#include "element_map.h"
#include "overlay.h"
#include "selftest.h"

namespace {

std::string SelfTestOverlay(PDDoc doc, const std::string&) {
    const sm::ElementMap& map = GetElementMap(doc, 0);
    auto it = map.find(676281);
    if (it == map.end()) return "{\"error\": \"element 676281 not on page 1\"}";
    AVDoc avDoc = AVDocFromPDDoc(doc);
    if (!avDoc) return "{\"error\": \"no AVDoc\"}";
    const bool dirtyBefore = (PDDocGetFlags(doc) & PDDocNeedsSave) != 0;
    ShowOverlay(avDoc, 0, {it->second});
    const size_t shown = OverlayBoxCount();
    const bool dirtyAfter = (PDDocGetFlags(doc) & PDDocNeedsSave) != 0;
    ClearOverlay();
    const size_t cleared = OverlayBoxCount();
    return "{\"boxes\": " + std::to_string(shown) + ", \"cleared\": " + std::to_string(cleared) +
           ", \"dirtyChanged\": " + ((dirtyBefore != dirtyAfter) ? "true" : "false") + "}";
}

struct RegisterSteps {
    RegisterSteps() { RegisterSelfTestStep("overlay", &SelfTestOverlay); }
} gRegisterSteps;

}  // namespace
