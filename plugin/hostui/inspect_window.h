// One reused modeless window listing the rows for the inspected element.
#pragma once

#include <cstdint>
#include <vector>

#include <windows.h>
#include "smartmarkup/inspect_rows.h"

// Shows (or refreshes) the window. `parent` may be null.
void ShowInspectWindow(HWND parent, int64_t elementId, const std::vector<sm::InspectRow>& rows);
void DestroyInspectWindow();
