// Converts Acrobat raises into C++ exceptions at each SDK call.
//
// DURING/HANDLER is setjmp/longjmp: a raise jumps straight to the handler and skips the destructors of
// every C++ object created inside the DURING block (leaks, half-updated containers, held locks). So C++
// code never runs inside DURING here: each SDK call goes through Sdk(), whose DURING block holds only the
// call and plain values, and an Acrobat error resurfaces after END_HANDLER as AcroError.
//
//   CosObj names = Sdk(CosDictGetKeyString, root, "Names");
//
// Every SDK "function" is a macro naming an HFT function pointer, so it can be passed as `fn`. Arguments
// are copied by value (SDK argument types are handles, ints and plain pointers).
#pragma once

#include <stdexcept>
#include <string>
#include <type_traits>

#include "PIHeaders.h"

class AcroError : public std::runtime_error {
public:
    AcroError(ASErrorCode code, const std::string& message) : std::runtime_error(message), code_(code) {}
    ASErrorCode code() const { return code_; }

private:
    ASErrorCode code_;
};

namespace sdk_detail {

// "Acrobat error <code>: <text>". No C++ objects live inside the DURING block.
inline void ErrorText(ASErrorCode code, char* buffer, ASTArraySize size) {
    buffer[0] = '\0';
    DURING
        ASGetErrorString(code, buffer, size);
    HANDLER
        buffer[0] = '\0';
    END_HANDLER
    buffer[size - 1] = '\0';
}

[[noreturn]] inline void Throw(ASErrorCode code) {
    char text[256];
    ErrorText(code, text, sizeof text);
    throw AcroError(code, "Acrobat error " + std::to_string(static_cast<long long>(code)) + ": " + text);
}

}  // namespace sdk_detail

template <class R, class... P, class... A>
R Sdk(R (*fn)(P...), A... args) {
    static_assert(std::is_trivially_destructible_v<R>, "SDK results are plain values");
    R result{};
    volatile bool raised = false;
    ASErrorCode code = 0;
    DURING
        result = fn(args...);
    HANDLER
        raised = true;
        code = ERRORCODE;
    END_HANDLER
    if (raised) sdk_detail::Throw(code);
    return result;
}

template <class... P, class... A>
void Sdk(void (*fn)(P...), A... args) {
    volatile bool raised = false;
    ASErrorCode code = 0;
    DURING
        fn(args...);
    HANDLER
        raised = true;
        code = ERRORCODE;
    END_HANDLER
    if (raised) sdk_detail::Throw(code);
}

// For cleanup paths (destructors, after an error): runs the call, logs nothing, never raises or throws.
template <class R, class... P, class... A>
void SdkNoThrow(R (*fn)(P...), A... args) noexcept {
    DURING
        fn(args...);
    HANDLER
    END_HANDLER
}
