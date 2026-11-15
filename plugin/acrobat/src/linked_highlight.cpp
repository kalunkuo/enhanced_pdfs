#include "linked_highlight.h"

#include <windows.h>

#include <cstring>
#include <string>
#include <vector>

#include "element_map.h"
#include "linked_ids.h"
#include "log.h"
#include "overlay.h"

namespace {

// Selection type of an annotation (SDK "Selection Types" table); selData is a PDAnnot*.
const char* kAnnotSelType = "Annotation";

// Finds the annotation's /NM and its 0-based page by scanning the pages the document's views show.
// Plain-data in/out only: an Acrobat raise longjmps past destructors.
bool LocateAnnot(AVDoc avDoc, PDAnnot annot, char* nm, size_t nmSize, int* page) {
    bool found = false;
    nm[0] = 0;
    PDPage pg = nullptr;
    DURING
        PDDoc pdDoc = AVDocGetPDDoc(avDoc);
        CosObj target = PDAnnotGetCosObj(annot);
        ASCount views = AVDocGetNumPageViews(avDoc);
        for (ASCount v = 0; v < views && !found; ++v) {
            AVPageView pv = AVDocGetNthPageView(avDoc, v);
            if (!pv) continue;
            int first = (int)AVPageViewGetFirstVisiblePageNum(pv);
            int last = (int)AVPageViewGetLastVisiblePageNum(pv);
            if (first < 0) continue;
            for (int p = first; p <= last && !found; ++p) {
                pg = PDDocAcquirePage(pdDoc, p);
                ASInt32 count = PDPageGetNumAnnots(pg);
                for (ASInt32 i = 0; i < count && !found; ++i) {
                    PDAnnot a = PDPageGetAnnot(pg, i);
                    if (CosObjEqual(PDAnnotGetCosObj(a), target)) {
                        found = true;
                        *page = p;
                    }
                }
                PDPageRelease(pg);
                pg = nullptr;
            }
        }
        if (found) {
            CosObj name = CosDictGetKeyString(target, "NM");
            if (CosObjGetType(name) == CosString) {
                ASTCount n = 0;
                const char* s = CosStringValue(name, &n);
                if (s && n > 0 && (size_t)n < nmSize) {
                    std::memcpy(nm, s, n);
                    nm[n] = 0;
                }
            }
        }
    HANDLER
        LogLine("linked: locate failed (error %d)", (int)ERRORCODE);
        found = false;
    END_HANDLER
    if (pg) {
        DURING
            PDPageRelease(pg);
        HANDLER
        END_HANDLER
    }
    return found && nm[0];
}

void HighlightSelection(AVDoc avDoc, void* selData) {
    PDAnnot* annot = static_cast<PDAnnot*>(selData);
    char nm[256];
    int page = -1;
    if (!annot || !LocateAnnot(avDoc, *annot, nm, sizeof nm, &page)) {
        ClearOverlay();
        return;
    }
    PDDoc pdDoc = AVDocGetPDDoc(avDoc);
    std::vector<int64_t> ids = LinkedElementIds(pdDoc, nm);
    std::vector<sm::Box> boxes;
    if (!ids.empty()) {
        const sm::ElementMap& map = GetElementMap(pdDoc, page);
        for (int64_t id : ids) {
            auto it = map.find(id);
            if (it != map.end()) boxes.push_back(it->second);
        }
    }
    if (boxes.empty()) ClearOverlay();
    else ShowOverlay(avDoc, page, boxes);
}

ACCB1 void ACCB2 DidSetSelection(AVDoc doc, ASAtom selType, void* selData, void*) {
    try {
        if (InspectModeOn() || !doc) return;
        if (selType == ASAtomFromString(kAnnotSelType)) HighlightSelection(doc, selData);
        else ClearOverlay();
    } catch (...) {
        LogLine("linked: DidSetSelection threw");
    }
}

ACCB1 void ACCB2 WillClearSelection(AVDoc, ASAtom, void*, void*) {
    try {
        if (InspectModeOn() || OverlayJustChanged()) return;
        ClearOverlay();
    } catch (...) {
        LogLine("linked: WillClearSelection threw");
    }
}

ACCB1 void ACCB2 WillClose(AVDoc doc, void*) {
    try {
        ForgetOverlay(doc);
    } catch (...) {
        LogLine("linked: WillClose threw");
    }
}

void* gSetCb = nullptr;
void* gClearCb = nullptr;
void* gCloseCb = nullptr;

}  // namespace

void RegisterLinkedHighlight() {
    DURING
        gSetCb = (void*)ASCallbackCreateNotification(AVDocDidSetSelection, &DidSetSelection);
        gClearCb = (void*)ASCallbackCreateNotification(AVDocWillClearSelection, &WillClearSelection);
        gCloseCb = (void*)ASCallbackCreateNotification(AVDocWillClose, &WillClose);
        AVAppRegisterNotification(AVDocDidSetSelectionNSEL, gExtensionID, gSetCb, nullptr);
        AVAppRegisterNotification(AVDocWillClearSelectionNSEL, gExtensionID, gClearCb, nullptr);
        AVAppRegisterNotification(AVDocWillCloseNSEL, gExtensionID, gCloseCb, nullptr);
    HANDLER
        LogLine("linked: registration failed (error %d)", (int)ERRORCODE);
    END_HANDLER
}

void UnregisterLinkedHighlight() {
    DURING
        if (gSetCb) AVAppUnregisterNotification(AVDocDidSetSelectionNSEL, gExtensionID, gSetCb, nullptr);
        if (gClearCb) AVAppUnregisterNotification(AVDocWillClearSelectionNSEL, gExtensionID, gClearCb, nullptr);
        if (gCloseCb) AVAppUnregisterNotification(AVDocWillCloseNSEL, gExtensionID, gCloseCb, nullptr);
    HANDLER
        LogLine("linked: unregister failed (error %d)", (int)ERRORCODE);
    END_HANDLER
    gSetCb = gClearCb = gCloseCb = nullptr;
    ShutdownOverlay();
}
