// Reads a document's in-scope markup annotations into sm::Markup (geometry, text, identity).
#pragma once

#include <string>
#include <vector>

#include "PIHeaders.h"
#include "smartmarkup/model.h"

struct CollectedMarkups {
    std::vector<sm::Markup> markups;
    std::vector<CosObj> annots;  // parallel to markups: the annotation's Cos dict
};

// All Square/Circle/Polygon/PolyLine/Line/Ink/FreeText/Text annotations, page order. Raises on Cos errors.
CollectedMarkups CollectMarkups(PDDoc doc);

// "D:YYYYMMDDHHmmSS+HH'mm'" -> "YYYY-MM-DDTHH:MM:SSZ"; "" if not parseable (needs at least YYYYMMDD).
std::string PdfDateToUtc(const std::string& pdfDate);

// PDF text string (UTF-16BE with BOM, UTF-8 with BOM, else PDFDocEncoding ~ Latin-1) -> UTF-8.
std::string PdfTextToUtf8(const std::string& bytes);

// Current time, "YYYY-MM-DDTHH:MM:SSZ".
std::string NowUtc();
