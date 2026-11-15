// Append-only diagnostics: %LOCALAPPDATA%\SmartMarkup\smartmarkup.log (+ OutputDebugString).
// The plug-in never shows errors to the contractor; everything goes here.
#pragma once

void LogLine(const char* format, ...);
