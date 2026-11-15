// Acrobat handshake and init for SmartMarkup.api (adapted from the SDK's BasicPlugin sample).
#include "PIHeaders.h"

#include "hooks.h"
#include "linked_highlight.h"
#include "log.h"
#include "selftest.h"

namespace {

const char* kExtensionName = "TTACM:SmartMarkup";
AVMenuItem gAboutItem = nullptr;
AVMenu gMenu = nullptr;

ACCB1 void ACCB2 ShowAbout(void*) {
    AVAlertNote(
        "Smart Markup links your comments and markups to the building elements under them.\n\n"
        "Keep working as usual: the links are saved with the PDF.");
}

ACCB1 ASBool ACCB2 AlwaysEnabled(void*) { return true; }

void AddMenu() {
    AVMenubar menubar = AVAppGetMenubar();
    if (!menubar) return;
    DURING
        gMenu = AVMenuNew("Smart Markup", "TTACM:SmartMarkupMenu", gExtensionID);
        gAboutItem = AVMenuItemNew("About Smart Markup...", "TTACM:SmartMarkupAbout", nullptr, true, NO_SHORTCUT,
                                   0, nullptr, gExtensionID);
        AVMenuItemSetExecuteProc(gAboutItem, ASCallbackCreateProto(AVExecuteProc, &ShowAbout), nullptr);
        AVMenuItemSetComputeEnabledProc(gAboutItem, ASCallbackCreateProto(AVComputeEnabledProc, &AlwaysEnabled),
                                        nullptr);
        AVMenuAddMenuItem(gMenu, gAboutItem, APPEND_MENUITEM);
        AVMenubarAddMenu(menubar, gMenu, APPEND_MENU);
    HANDLER
        LogLine("init: could not add menu (error %d)", (int)ERRORCODE);
    END_HANDLER
}

ACCB1 void ACCB2 LogDocOpen(AVDoc doc, ASInt32 error, void*) {
    LogLine("AVDocDidOpen error=%d pages=%d", (int)error,
            (doc && !error) ? (int)PDDocGetNumPages(AVDocGetPDDoc(doc)) : -1);
}

}  // namespace

ACCB1 ASBool ACCB2 PluginExportHFTs(void) { return true; }

ACCB1 ASBool ACCB2 PluginImportReplaceAndRegister(void) { return true; }

ACCB1 ASBool ACCB2 PluginInit(void) {
    LogLine("init: SmartMarkup loading");
    AddMenu();
    AVAppRegisterNotification(AVDocDidOpenNSEL, gExtensionID,
                              (void*)ASCallbackCreateNotification(AVDocDidOpen, &LogDocOpen), nullptr);
    RegisterLifecycle();
    RegisterInspect();
    RegisterLinkedHighlight();
    InitSelfTest();
    LogLine("init: SmartMarkup ready");
    return true;  // never block Acrobat from starting
}

ACCB1 ASBool ACCB2 PluginUnload(void) {
    UnregisterLinkedHighlight();
    UnregisterInspect();
    if (gAboutItem) AVMenuItemRemove(gAboutItem);
    if (gMenu) AVMenuRemove(gMenu);
    LogLine("unload: SmartMarkup");
    return true;
}

ACCB1 ASBool ACCB2 PIHandshake(Uns32 handshakeVersion, void* handshakeData) {
    if (handshakeVersion != HANDSHAKE_V0200) return false;
    auto* hs = static_cast<PIHandshakeData_V0200*>(handshakeData);
    hs->extensionName = ASAtomFromString(kExtensionName);
    hs->exportHFTsCallback = (void*)ASCallbackCreateProto(PIExportHFTsProcType, &PluginExportHFTs);
    hs->importReplaceAndRegisterCallback =
        (void*)ASCallbackCreateProto(PIImportReplaceAndRegisterProcType, &PluginImportReplaceAndRegister);
    hs->initCallback = (void*)ASCallbackCreateProto(PIInitProcType, &PluginInit);
    hs->unloadCallback = (void*)ASCallbackCreateProto(PIUnloadProcType, &PluginUnload);
    return true;
}

AVMenu SmartMarkupMenu() { return gMenu; }
