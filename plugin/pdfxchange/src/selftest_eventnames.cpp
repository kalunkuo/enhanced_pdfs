// Self-test step `eventnames`: dumps every registered event name ("e.*") to <out>/eventnames.txt by
// reverse-mapping ids with IPXV_Inst::ID2Str. The SDK docs are incomplete; this is the ground truth.
#include <cstdio>
#include <cwchar>
#include <string>

#include "lifecycle.h"
#include "selftest.h"

namespace {

std::string EventNamesStep(IPXV_Document*, const std::string& outDir) {
    std::string path = outDir + "\\eventnames.txt";
    FILE* f = fopen(path.c_str(), "wb");
    if (!f) return "{\"error\": \"cannot write eventnames.txt\"}";
    int found = 0;
    for (long id = 1; id < 40000; ++id) {
        BSTR name = nullptr;
        if (SUCCEEDED(PxvInst()->ID2Str(id, &name)) && name) {
            if (std::wcsncmp(name, L"e.", 2) == 0) {
                char narrow[256] = {};
                WideCharToMultiByte(CP_UTF8, 0, name, -1, narrow, sizeof narrow - 1, nullptr, nullptr);
                fprintf(f, "%ld %s\n", id, narrow);
                ++found;
            }
            SysFreeString(name);
        }
    }
    fclose(f);
    return "{\"events\": " + std::to_string(found) + ", \"file\": " + JsonString(path) + "}";
}

struct RegisterSteps {
    RegisterSteps() { RegisterSelfTestStep("eventnames", &EventNamesStep); }
} gRegisterSteps;

}  // namespace
