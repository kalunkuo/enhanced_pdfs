// DuckDB-backed reading/writing of the exporter's parquet attachments and our annotation tables.
#pragma once

#include <cstdint>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

#include "smartmarkup/model.h"

namespace sm {

// Attachment file name -> bytes.
using Attachments = std::map<std::string, std::vector<uint8_t>>;

struct TableError : std::runtime_error {
    using std::runtime_error::runtime_error;
};

// True iff the attachments contain "elements.parquet".
bool IsEnhanced(const Attachments& attachments);

// Reads elements/parameters/appearances/drawings. Throws TableError on any failure.
ModelData ReadModel(const Attachments& attachments);

// Reads annotations.parquet / annotation-links.parquet (each optional; PoC schema accepted).
// Throws TableError on corrupt data.
AnnotationState ReadAnnotations(const Attachments& attachments);

// Serialise to parquet (gzip). Empty strings become NULL. Throws TableError on failure.
std::vector<uint8_t> WriteAnnotationsParquet(const std::vector<AnnotationRow>& rows);
std::vector<uint8_t> WriteLinksParquet(const std::vector<LinkRow>& rows);

}  // namespace sm
