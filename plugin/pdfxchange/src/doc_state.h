// Per-document state shared between features. The real implementation comes from the link task.
#pragma once

#include "pxv.h"
#include "smartmarkup/model.h"

// The Revit model loaded for `doc`, or nullptr if the document has none.
const sm::ModelData* FindModel(IPXC_Document* doc);
