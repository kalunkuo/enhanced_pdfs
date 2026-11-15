#include "duckdb_load.h"

#include <windows.h>

#include <cwchar>

#include "log.h"

namespace {
bool gDuckDbLoaded = false;
}

void PreloadDuckDb() {
    if (gDuckDbLoaded) return;
    HMODULE self = nullptr;
    wchar_t path[MAX_PATH] = {};
    if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                            reinterpret_cast<LPCWSTR>(&PreloadDuckDb), &self)) {
        LogLine("init: could not find the plug-in module (error %lu); linking disabled", GetLastError());
        return;
    }
    DWORD n = GetModuleFileNameW(self, path, MAX_PATH);
    if (n == 0 || n >= MAX_PATH) {
        LogLine("init: plug-in path unavailable or too long; linking disabled");
        return;
    }
    wchar_t* slash = wcsrchr(path, L'\\');
    if (!slash || static_cast<size_t>(slash + 1 - path) + wcslen(L"duckdb.dll") >= MAX_PATH) {
        LogLine("init: plug-in path unusable; linking disabled");
        return;
    }
    wcscpy_s(slash + 1, MAX_PATH - (slash + 1 - path), L"duckdb.dll");
    gDuckDbLoaded = LoadLibraryExW(path, nullptr, LOAD_WITH_ALTERED_SEARCH_PATH) != nullptr;
    if (gDuckDbLoaded)
        LogLine("init: duckdb.dll loaded from the plug-in folder");
    else
        LogLine("init: could not load duckdb.dll next to the plug-in (error %lu); linking disabled", GetLastError());
}

bool DuckDbAvailable() { return gDuckDbLoaded; }
