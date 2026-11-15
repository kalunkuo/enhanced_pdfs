// duckdb.dll is delay-loaded (CMakeLists.txt): Windows does not search Acrobat's plug_ins folder for a
// plug-in's imports, so PreloadDuckDb loads it by full path from SmartMarkup.api's own folder.
#pragma once

// Called once, as early as possible (PIHandshake). Never throws or raises.
void PreloadDuckDb();

// False if the preload failed. Then no DuckDB call may happen: the delay-load helper would raise an SEH
// exception that catch(...) does not catch, taking Acrobat down.
bool DuckDbAvailable();
