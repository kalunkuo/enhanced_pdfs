// Where each Revit element is drawn: ElementId -> union bbox of its /Element<id> marked content.
#pragma once

#include "pxv.h"
#include "smartmarkup/model.h"

// Built on first use per (document, page) and cached; pageIndex is 0-based.
const sm::ElementMap& GetElementMap(IPXC_Document* doc, int pageIndex);

// Drop cached maps for a document (call when it closes).
void ForgetElementMaps(IPXC_Document* doc);
