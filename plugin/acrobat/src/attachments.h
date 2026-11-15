// Document-level attachments: the catalog's /Names /EmbeddedFiles name tree, read and written via Cos.
#pragma once

#include "PIHeaders.h"
#include "smartmarkup/tables.h"

// Name-tree key (raw string bytes) -> decoded /EF /F stream bytes. Walks /Kids and /Names. Throws (C++,
// never raises) on Cos errors and when the tree cannot be carried over exactly (caps hit, non-dict node,
// non-string or duplicate key).
sm::Attachments ReadAttachments(PDDoc doc);

// Replaces or adds the given files and rebuilds /EmbeddedFiles as one flat /Names array sorted byte-wise by
// key. Untouched names keep their existing filespec (stream data is never re-encoded). Refuses (throws)
// when the existing tree cannot be carried over exactly; throws on Cos errors.
void WriteAttachments(PDDoc doc, const sm::Attachments& replaceOrAdd);
