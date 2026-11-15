// Screen-only highlight: boxes drawn over a page view by a page-view drawing proc. Never an annotation,
// never touches the PDF, never marks the document dirty.
#pragma once

#include <vector>

#include "PIHeaders.h"
#include "smartmarkup/model.h"

// Boxes are in PDF user space on 0-based pageIndex of `doc`. Replaces any previous highlight.
void ShowOverlay(AVDoc doc, int pageIndex, const std::vector<sm::Box>& boxes);
void ClearOverlay();
void ForgetOverlay(AVDoc doc);  // doc is closing: drop state without touching its views
bool OverlayJustChanged();      // true for 400 ms after a change (ignore selection churn)
size_t OverlayBoxCount();       // self-test
void ShutdownOverlay();         // unregister the drawing proc (plug-in unload)

bool InspectModeOn();  // inspect.cpp: "Inspect elements" toggle state
