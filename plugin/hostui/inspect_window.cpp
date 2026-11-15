#include "inspect_window.h"

#include <commctrl.h>

#include <string>

#include "log.h"

namespace {

const wchar_t* kClass = L"TTACM_SmartMarkup_Inspect";
HWND gWnd = nullptr;
HWND gList = nullptr;
bool gClassRegistered = false;

std::wstring Wide(const std::string& s) {
    if (s.empty()) return std::wstring();
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
    std::wstring w(n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), &w[0], n);
    return w;
}

LRESULT CALLBACK WndProc(HWND h, UINT msg, WPARAM w, LPARAM l) {
    switch (msg) {
        case WM_SIZE:
            if (gList) MoveWindow(gList, 0, 0, LOWORD(l), HIWORD(l), TRUE);
            return 0;
        case WM_CLOSE:
            ShowWindow(h, SW_HIDE);  // keep it for reuse
            return 0;
        case WM_DESTROY:
            if (h == gWnd) {
                gWnd = nullptr;
                gList = nullptr;
            }
            return 0;
    }
    return DefWindowProcW(h, msg, w, l);
}

void AddColumn(HWND list, int index, const wchar_t* title, int width) {
    LVCOLUMNW c = {};
    c.mask = LVCF_TEXT | LVCF_WIDTH;
    c.pszText = const_cast<wchar_t*>(title);
    c.cx = width;
    SendMessageW(list, LVM_INSERTCOLUMNW, index, (LPARAM)&c);
}

bool EnsureWindow(HWND parent) {
    if (gWnd) return true;
    HINSTANCE inst = GetModuleHandleW(nullptr);
    if (!gClassRegistered) {
        INITCOMMONCONTROLSEX icc = {sizeof icc, ICC_LISTVIEW_CLASSES};
        InitCommonControlsEx(&icc);
        WNDCLASSW wc = {};
        wc.lpfnWndProc = &WndProc;
        wc.hInstance = inst;
        wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
        wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
        wc.lpszClassName = kClass;
        if (!RegisterClassW(&wc)) return false;
        gClassRegistered = true;
    }
    gWnd = CreateWindowExW(WS_EX_TOOLWINDOW, kClass, L"Element", WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT,
                           560, 480, parent, nullptr, inst, nullptr);
    if (!gWnd) return false;
    gList = CreateWindowExW(0, WC_LISTVIEWW, L"", WS_CHILD | WS_VISIBLE | LVS_REPORT | LVS_SINGLESEL, 0, 0, 100,
                            100, gWnd, nullptr, inst, nullptr);
    if (!gList) {
        DestroyWindow(gWnd);
        gWnd = nullptr;
        return false;
    }
    SendMessageW(gList, LVM_SETEXTENDEDLISTVIEWSTYLE, 0, LVS_EX_FULLROWSELECT | LVS_EX_GRIDLINES);
    AddColumn(gList, 0, L"Section", 80);
    AddColumn(gList, 1, L"Name", 190);
    AddColumn(gList, 2, L"Value", 260);
    RECT rc;
    GetClientRect(gWnd, &rc);
    MoveWindow(gList, 0, 0, rc.right, rc.bottom, TRUE);
    return true;
}

}  // namespace

void ShowInspectWindow(HWND parent, int64_t elementId, const std::vector<sm::InspectRow>& rows) {
    if (!EnsureWindow(parent)) {
        LogLine("inspect: could not create window");
        return;
    }
    SetWindowTextW(gWnd, (L"Element " + std::to_wstring(elementId)).c_str());
    SendMessageW(gList, LVM_DELETEALLITEMS, 0, 0);
    int i = 0;
    for (const auto& r : rows) {
        std::wstring s = Wide(r.section), n = Wide(r.name), v = Wide(r.value);
        LVITEMW item = {};
        item.mask = LVIF_TEXT;
        item.iItem = i;
        item.pszText = &s[0];
        SendMessageW(gList, LVM_INSERTITEMW, 0, (LPARAM)&item);
        item.iSubItem = 1;
        item.pszText = &n[0];
        SendMessageW(gList, LVM_SETITEMTEXTW, i, (LPARAM)&item);
        item.iSubItem = 2;
        item.pszText = &v[0];
        SendMessageW(gList, LVM_SETITEMTEXTW, i, (LPARAM)&item);
        ++i;
    }
    ShowWindow(gWnd, IsWindowVisible(gWnd) ? SW_SHOWNA : SW_SHOWNOACTIVATE);
}

void DestroyInspectWindow() {
    if (gWnd) DestroyWindow(gWnd);
    gWnd = nullptr;
    gList = nullptr;
    if (gClassRegistered) {
        UnregisterClassW(kClass, GetModuleHandleW(nullptr));
        gClassRegistered = false;
    }
}
