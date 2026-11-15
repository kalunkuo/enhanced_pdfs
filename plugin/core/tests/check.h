// Minimal test harness: TEST(name) { CHECK(cond); } — tests self-register; main.cpp runs them.
#pragma once

#include <cstdio>
#include <string>
#include <vector>

namespace check {

struct Test {
    const char* name;
    void (*fn)();
};

inline std::vector<Test>& Registry() {
    static std::vector<Test> tests;
    return tests;
}

inline int& Failures() {
    static int failures = 0;
    return failures;
}

struct Registrar {
    Registrar(const char* name, void (*fn)()) { Registry().push_back({name, fn}); }
};

inline std::string FixturePath(const char* file) { return std::string(SM_FIXTURES_DIR) + "/" + file; }

}  // namespace check

#define TEST(name)                                                  \
    static void name();                                             \
    static ::check::Registrar name##_registrar(#name, &name);       \
    static void name()

#define CHECK(cond)                                                                   \
    do {                                                                              \
        if (!(cond)) {                                                                \
            std::printf("  FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);            \
            ++::check::Failures();                                                    \
        }                                                                             \
    } while (0)
