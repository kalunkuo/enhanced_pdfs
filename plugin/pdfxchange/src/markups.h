// Reads a document's in-scope markup annotations into sm::Markup (geometry, text, identity).
#pragma once

#include <string>
#include <vector>

#include "com_ptr.h"
#include "pxv.h"
#include "smartmarkup/model.h"

struct CollectedMarkups {
    std::vector<sm::Markup> markups;
    std::vector<ComPtr<IPXS_PDFVariant>> annots;  // parallel to markups: the annotation's PDF dictionary
};

// All Square/Circle/Polygon/PolyLine/Line/Ink/FreeText/Text annotations, page order. Caller holds a read lock.
CollectedMarkups CollectMarkups(IPXC_Document* doc);

// Writes /NM (the only change ever made to a markup). Caller holds the exclusive lock.
void SetAnnotationId(IPXS_PDFVariant* annot, const std::string& id);

// "D:YYYYMMDDHHmmSS+HH'mm'" -> "YYYY-MM-DDTHH:MM:SSZ"; "" if not parseable (needs at least YYYYMMDD).
std::string PdfDateToUtc(const std::string& pdfDate);

// Current time, "YYYY-MM-DDTHH:MM:SSZ".
std::string NowUtc();

// UTF-8 <-> UTF-16 helpers.
std::string Utf8(const wchar_t* s);
std::wstring Wide(const std::string& s);
