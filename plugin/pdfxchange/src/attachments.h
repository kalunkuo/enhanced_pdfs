// Document-level attachments: the catalog's /Names /EmbeddedFiles name tree, read and written through the
// raw object layer (IPXS_*). Same contract and safety bounds as the Acrobat adapter.
#pragma once

#include "pxv.h"
#include "smartmarkup/tables.h"

// Name-tree key (raw string bytes) -> decoded /EF /F stream bytes, for our six tables only and only when
// the document has elements.parquet. Walks /Kids and /Names (first occurrence of a key wins). Throws on
// errors, on a name tree beyond the walk limits, and on oversized attachments. Caller holds a read lock.
sm::Attachments ReadAttachments(IPXC_Document* doc);

// Replaces or adds the given files and rebuilds /EmbeddedFiles as one flat /Names array sorted byte-wise
// by key. Untouched names keep their existing filespec (stream data is never re-encoded). Throws on
// errors. Caller holds the exclusive lock.
void WriteAttachments(IPXC_Document* doc, IPXS_Inst* pxs, const sm::Attachments& replaceOrAdd);
