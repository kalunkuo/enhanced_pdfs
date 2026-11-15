// Runs every registered TEST. Optional argv[1]: only run tests whose name contains it.
#include <cstring>
#include <exception>

#include "check.h"

int main(int argc, char** argv) {
    const char* filter = argc > 1 ? argv[1] : nullptr;
    int run = 0;
    for (const auto& test : check::Registry()) {
        if (filter && !std::strstr(test.name, filter)) continue;
        ++run;
        int before = check::Failures();
        try {
            test.fn();
        } catch (const std::exception& e) {
            std::printf("  FAIL %s threw: %s\n", test.name, e.what());
            ++check::Failures();
        } catch (...) {
            std::printf("  FAIL %s threw an unknown exception\n", test.name);
            ++check::Failures();
        }
        std::printf("%s %s\n", check::Failures() == before ? "ok  " : "FAIL", test.name);
    }
    std::printf("%d tests, %d failed checks\n", run, check::Failures());
    return check::Failures() == 0 ? 0 : 1;
}
