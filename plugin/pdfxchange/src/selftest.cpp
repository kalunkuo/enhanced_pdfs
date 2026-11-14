#include "selftest.h"

#include <cstdio>
#include <exception>
#include <sstream>
#include <utility>
#include <vector>

#include "com_ptr.h"
#include "events.h"
#include "log.h"

namespace {

std::vector<std::pair<std::string, SelfTestStep>>& Steps() {
    static std::vector<std::pair<std::string, SelfTestStep>> steps;
    return steps;
}

std::string gOutDir;
std::vector<std::string> gRequested;
bool gDone = false;

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

void Run(IPXV_Document* doc) {
    bool ok = true;
    std::string steps;
    auto append = [&](const std::string& name, const std::string& json) {
        if (!steps.empty()) steps += ",\n  ";
        steps += JsonString(name) + ": " + json;
    };
    for (const auto& [name, step] : Steps()) {
        bool wanted = gRequested.empty();
        for (const auto& r : gRequested) wanted |= (r == name);
        if (!wanted) continue;
        LogLine("selftest: step %s", name.c_str());
        std::string result, error;
        try {
            result = step(doc, gOutDir);
        } catch (const std::exception& e) {
            error = e.what();
        } catch (...) {
            error = "unknown C++ exception";
        }
        if (!error.empty()) ok = false;
        append(name, error.empty() ? (result.empty() ? "null" : result) : "{\"error\": " + JsonString(error) + "}");
    }
    for (const auto& r : gRequested) {
        bool known = false;
        for (const auto& s : Steps()) known |= (s.first == r);
        if (!known) {
            ok = false;
            append(r, "{\"error\": \"unknown step\"}");
        }
    }
    std::string json = std::string("{\"ok\": ") + (ok ? "true" : "false") + ",\n \"steps\": {\n  " + steps + "}}\n";
    std::string path = gOutDir + "\\selftest.json", temp = path + ".tmp";
    if (FILE* f = fopen(temp.c_str(), "wb")) {
        fwrite(json.data(), 1, json.size(), f);
        fclose(f);
        MoveFileExA(temp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING);  // appear atomically
    }
    LogLine("selftest: wrote %s (ok=%d)", path.c_str(), ok ? 1 : 0);
}

std::string Ping(IPXV_Document* doc, const std::string&) {
    ComPtr<IPXC_Document> core;
    ComPtr<IPXC_Pages> pages;
    ULONG_T count = 0;
    if (SUCCEEDED(doc->get_CoreDoc(core.Put())) && SUCCEEDED(core->get_Pages(pages.Put()))) pages->get_Count(&count);
    return "{\"pages\": " + std::to_string(count) + "}";
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

void InitSelfTest(IPXV_Inst* inst) {
    gOutDir = Env("SMARTMARKUP_SELFTEST");
    if (gOutDir.empty()) return;
    gRequested = Split(Env("SMARTMARKUP_SELFTEST_STEPS"));
    RegisterSelfTestStep("ping", &Ping);
    Subscribe(inst, "e.document.viewingStarted", [](IEvent*, IUnknown* from) {
        if (gDone || !from) return;
        ComPtr<IPXV_Document> doc;
        if (FAILED(from->QueryInterface(__uuidof(IPXV_Document), reinterpret_cast<void**>(doc.Put())))) return;
        gDone = true;
        Run(doc.Get());
    });
    LogLine("selftest: enabled, out=%s", gOutDir.c_str());
}
