#include "overlay.h"

#include <windows.h>

#include <algorithm>

#include "log.h"

namespace {

constexpr int kLineWidth = 3;
constexpr int kPad = kLineWidth + 2;

AVDoc gDoc = nullptr;
int gPage = -1;
std::vector<sm::Box> gBoxes;
ULONGLONG gChangedAt = 0;
AVPageViewDrawProc gDrawCb = nullptr;

void ToDevice(AVPageView pv, const sm::Box& b, AVDevRect* out) {
    ASFixedRect r;
    r.left = ASFloatToFixed((float)b.x0);
    r.right = ASFloatToFixed((float)b.x1);
    r.bottom = ASFloatToFixed((float)b.y0);
    r.top = ASFloatToFixed((float)b.y1);
    AVPageViewRectToDevice(pv, &r, out);
    // Device y grows downwards; normalise so top <= bottom.
    if (out->top > out->bottom) std::swap(out->top, out->bottom);
    if (out->left > out->right) std::swap(out->left, out->right);
}

ACCB1 void ACCB2 DrawProc(AVPageView pv, AVDevRect*, void*) {
    try {
        DURING
            if (gDoc && !gBoxes.empty() && AVPageViewGetAVDoc(pv) == gDoc && (int)AVPageViewGetPageNum(pv) == gPage) {
                PDColorValueRec color;
                color.space = PDDeviceRGB;
                color.value[0] = ASFloatToFixed(1.0f);
                color.value[1] = ASFloatToFixed(0.45f);
                color.value[2] = ASFloatToFixed(0.0f);
                color.value[3] = 0;
                AVPageViewSetColor(pv, &color);
                for (size_t i = 0; i < gBoxes.size(); ++i) {
                    AVDevRect r;
                    ToDevice(pv, gBoxes[i], &r);
                    AVPageViewDrawRectOutline(pv, &r, kLineWidth, nullptr, 0);
                }
            }
        HANDLER
            LogLine("overlay: draw failed (error %d)", (int)ERRORCODE);
        END_HANDLER
    } catch (...) {
        LogLine("overlay: draw threw");
    }
}

void EnsureRegistered() {
    if (gDrawCb) return;
    DURING
        gDrawCb = ASCallbackCreateProto(AVPageViewDrawProc, &DrawProc);
        AVAppRegisterForPageViewDrawing(gDrawCb, nullptr);
    HANDLER
        LogLine("overlay: registration failed (error %d)", (int)ERRORCODE);
        gDrawCb = nullptr;
    END_HANDLER
}

// Repaint the current boxes (padded) on every page view of gDoc showing gPage.
void InvalidateCurrent() {
    if (!gDoc || gBoxes.empty()) return;
    try {
        DURING
            ASCount n = AVDocGetNumPageViews(gDoc);
            for (ASCount v = 0; v < n; ++v) {
                AVPageView pv = AVDocGetNthPageView(gDoc, v);
                if (!pv || (int)AVPageViewGetPageNum(pv) != gPage) continue;
                for (size_t i = 0; i < gBoxes.size(); ++i) {
                    AVDevRect r;
                    ToDevice(pv, gBoxes[i], &r);
                    r.left -= kPad;
                    r.top -= kPad;
                    r.right += kPad;
                    r.bottom += kPad;
                    AVPageViewInvalidateRect(pv, &r);
                }
            }
        HANDLER
            LogLine("overlay: invalidate failed (error %d)", (int)ERRORCODE);
        END_HANDLER
    } catch (...) {
        LogLine("overlay: invalidate threw");
    }
}

}  // namespace

void ShowOverlay(AVDoc doc, int pageIndex, const std::vector<sm::Box>& boxes) {
    if (!doc) return;
    EnsureRegistered();
    InvalidateCurrent();  // erase the old highlight
    gDoc = doc;
    gPage = pageIndex;
    gBoxes = boxes;
    gChangedAt = GetTickCount64();
    InvalidateCurrent();  // paint the new one
}

void ClearOverlay() {
    if (!gDoc && gBoxes.empty()) return;
    InvalidateCurrent();
    gDoc = nullptr;
    gPage = -1;
    gBoxes.clear();
    gChangedAt = GetTickCount64();
}

void ForgetOverlay(AVDoc doc) {
    if (doc != gDoc) return;
    gDoc = nullptr;
    gPage = -1;
    gBoxes.clear();
}

bool OverlayJustChanged() { return gChangedAt != 0 && GetTickCount64() - gChangedAt < 400; }

size_t OverlayBoxCount() { return gBoxes.size(); }

void ShutdownOverlay() {
    ClearOverlay();
    DURING
        if (gDrawCb) AVAppUnregisterForPageViewDrawing(gDrawCb);
    HANDLER
        LogLine("overlay: unregister failed (error %d)", (int)ERRORCODE);
    END_HANDLER
    gDrawCb = nullptr;
}
