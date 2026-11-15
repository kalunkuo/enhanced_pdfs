// Temporary on-page highlight of the element being inspected: a translucent yellow box drawn as a Square
// annotation named kHighlightName. It is never saved (removed before every save), never linked (the
// markup collector skips it) and never marks the document modified.
#pragma once

#include "pxv.h"
#include "smartmarkup/model.h"

constexpr const wchar_t* kHighlightName = L"smh-highlight";

// Replaces any current highlight with one around `box` (PDF user space) on page `pageIndex` (0-based).
void ShowHighlight(IPXV_Document* doc, int pageIndex, const sm::Box& box);

// Removes the highlight from whichever document shows it (no-op if none).
void ClearHighlight();

// Removes the highlight if it is on `doc` / forgets it without touching the document.
void ClearHighlightIn(IPXV_Document* doc);
void ForgetHighlight(IPXV_Document* doc);

// Before save: removes EVERY annotation named kHighlightName from `doc`, whether or not we still track it.
void RemoveAllHighlights(IPXV_Document* doc);
