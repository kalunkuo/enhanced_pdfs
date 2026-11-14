#include "selftest.h"

#include <windows.h>

#include <cstdio>
#include <exception>
#include <sstream>
#include <utility>
#include <vector>

#include "log.h"

namespace {

std::vector<std::pair<std::string, SelfTestStep>>& Steps() {
    static std::vector<std::pair<std::string, SelfTestStep>> steps;
    return steps;
}

std::string gOutDir;
std::vector<std::string> gRequested;
PDDoc gDoc = nullptr;
bool gDone = false;
AVIdleProc gIdleProc = nullptr;

std::string Env(const char* name) {
    char buffer[4096] = {};
    DWORD n = GetEnvironmentVariableA(name, buffer, sizeof buffer);
    return (n > 0 && n < sizeof buffer) ? std::string(buffer, n) : std::string();
}

std::vector<std::string> Split(const std::string& text) {
    std::vector<std::string> parts;
    std::stringstream stream(text);
    std::string part;
    while (std::getline(stream, part, ','))
        if (!part.empty()) parts.push_back(part);
    return parts;
}

std::string RunStep(SelfTestStep step, PDDoc doc, bool& ok) {
    std::string result;
    std::string error;
    DURING
        try {
            result = step(doc, gOutDir);
        } catch (const std::exception& e) {
            error = e.what();
        } catch (...) {
            error = "unknown C++ exception";
        }
    HANDLER
        char message[256] = {};
        ASGetErrorString(ERRORCODE, message, sizeof message);
        error = std::string("Acrobat error: ") + message;
    END_HANDLER
    if (!error.empty()) {
        ok = false;
        return "{\"error\": " + JsonString(error) + "}";
    }
    return result.empty() ? "null" : result;
}

ACCB1 void ACCB2 RunOnIdle(void*) {
    if (gDone || !gDoc) return;
    gDone = true;

    bool ok = true;
    std::string steps;
    for (const auto& [name, step] : Steps()) {
        bool wanted = gRequested.empty();
        for (const auto& r : gRequested) wanted |= (r == name);
        if (!wanted) continue;
        LogLine("selftest: step %s", name.c_str());
        if (!steps.empty()) steps += ",\n  ";
        steps += JsonString(name) + ": " + RunStep(step, gDoc, ok);
    }
    for (const auto& r : gRequested) {
        bool known = false;
        for (const auto& s : Steps()) known |= (s.first == r);
        if (!known) {
            ok = false;
            if (!steps.empty()) steps += ",\n  ";
            steps += JsonString(r) + ": {\"error\": \"unknown step\"}";
        }
    }

    std::string json = std::string("{\"ok\": ") + (ok ? "true" : "false") + ",\n \"steps\": {\n  " + steps + "}}\n";
    std::string path = gOutDir + "\\selftest.json";
    std::string temp = path + ".tmp";
    if (FILE* f = fopen(temp.c_str(), "wb")) {
        fwrite(json.data(), 1, json.size(), f);
        fclose(f);
        MoveFileExA(temp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING);  // appear atomically
    }
    LogLine("selftest: wrote %s (ok=%d)", path.c_str(), ok ? 1 : 0);
}

ACCB1 void ACCB2 OnDocDidOpen(AVDoc doc, ASInt32 error, void*) {
    if (error || gDoc || !doc) return;
    gDoc = AVDocGetPDDoc(doc);
    LogLine("selftest: document opened, scheduling steps");
}

std::string Ping(PDDoc doc, const std::string&) {
    return "{\"pages\": " + std::to_string(PDDocGetNumPages(doc)) + "}";
}

}  // namespace

std::string JsonString(const std::string& value) {
    std::string out = "\"";
    for (unsigned char c : value) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) {
                    char buf[8];
                    snprintf(buf, sizeof buf, "\\u%04x", c);
                    out += buf;
                } else {
                    out += static_cast<char>(c);
                }
        }
    }
    return out + "\"";
}

void RegisterSelfTestStep(const char* name, SelfTestStep step) { Steps().emplace_back(name, step); }

void InitSelfTest() {
    gOutDir = Env("SMARTMARKUP_SELFTEST");
    if (gOutDir.empty()) return;
    gRequested = Split(Env("SMARTMARKUP_SELFTEST_STEPS"));
    RegisterSelfTestStep("ping", &Ping);
    AVAppRegisterNotification(AVDocDidOpenNSEL, gExtensionID,
                              (void*)ASCallbackCreateNotification(AVDocDidOpen, &OnDocDidOpen), nullptr);
    gIdleProc = ASCallbackCreateProto(AVIdleProc, &RunOnIdle);
    AVAppRegisterIdleProc(gIdleProc, nullptr, 500);
    LogLine("selftest: enabled, out=%s", gOutDir.c_str());
}
