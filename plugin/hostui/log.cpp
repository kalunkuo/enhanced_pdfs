#include "log.h"

#include <windows.h>

#include <cstdarg>
#include <cstdio>
#include <mutex>
#include <string>

namespace {

std::string LogPath() {
    char base[MAX_PATH] = {};
    DWORD n = GetEnvironmentVariableA("LOCALAPPDATA", base, MAX_PATH);
    std::string dir = (n > 0 && n < MAX_PATH) ? std::string(base) + "\\SmartMarkup" : ".";
    CreateDirectoryA(dir.c_str(), nullptr);
    return dir + "\\smartmarkup.log";
}

std::mutex gLogMutex;

}  // namespace

void LogLine(const char* format, ...) {
    char message[2048];
    va_list args;
    va_start(args, format);
    vsnprintf(message, sizeof message, format, args);
    va_end(args);

    SYSTEMTIME t;
    GetSystemTime(&t);
    char line[2200];
    snprintf(line, sizeof line, "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ %s\n", t.wYear, t.wMonth, t.wDay, t.wHour,
             t.wMinute, t.wSecond, t.wMilliseconds, message);

    OutputDebugStringA(line);
    std::lock_guard<std::mutex> lock(gLogMutex);
    static const std::string path = LogPath();
    if (FILE* f = fopen(path.c_str(), "a")) {
        fputs(line, f);
        fclose(f);
    }
}
