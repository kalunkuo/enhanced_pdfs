cmake_minimum_required(VERSION 3.20)
project(SmartMarkup C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# Static CRT, as in the Acrobat SDK samples.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
add_compile_options(/utf-8 /W3)

# DuckDB C API (fetched by scripts/Get-DuckDb.ps1 into third_party/duckdb).
set(DUCKDB_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/duckdb")
if(NOT EXISTS "${DUCKDB_DIR}/duckdb.h")
  message(FATAL_ERROR "DuckDB missing: run plugin/scripts/Get-DuckDb.ps1")
endif()
add_library(duckdb SHARED IMPORTED)
set_target_properties(duckdb PROPERTIES
  IMPORTED_LOCATION "${DUCKDB_DIR}/duckdb.dll"
  IMPORTED_IMPLIB "${DUCKDB_DIR}/duckdb.lib"
  INTERFACE_INCLUDE_DIRECTORIES "${DUCKDB_DIR}")

# Host-independent core. New source/test files are picked up by glob: no CMake edits needed.
file(GLOB CORE_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/core/src/*.cpp")
add_library(smartmarkup_core STATIC ${CORE_SOURCES})
target_include_directories(smartmarkup_core PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/core/include")
target_link_libraries(smartmarkup_core PUBLIC duckdb)

file(GLOB TEST_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/core/tests/*.cpp")
add_executable(core_tests ${TEST_SOURCES})
target_link_libraries(core_tests PRIVATE smartmarkup_core)
target_compile_definitions(core_tests PRIVATE SM_FIXTURES_DIR="${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures")
add_custom_command(TARGET core_tests POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_if_different "${DUCKDB_DIR}/duckdb.dll" "$<TARGET_FILE_DIR:core_tests>")

enable_testing()
add_test(NAME core_tests COMMAND core_tests)

# Host-neutral Windows helpers shared by the adapters (log, inspect window).
set(HOSTUI_DIR "${CMAKE_CURRENT_SOURCE_DIR}/hostui")

# Acrobat adapter: only when the SDK path is given.
set(ACROBAT_SDK "" CACHE PATH "Acrobat SDK 'Version 1' folder")
if(ACROBAT_SDK)
  add_subdirectory(acrobat)
endif()

# PDF-XChange Editor adapter: types come from the installed Editor's type library.
option(PDFXCHANGE "Build the PDF-XChange Editor adapter (SmartMarkup.pvp)" OFF)
set(PDFXCHANGE_DIR "C:/Program Files/Tracker Software/PDF Editor" CACHE PATH "PDF-XChange Editor install folder")
if(PDFXCHANGE)
  add_subdirectory(pdfxchange)
endif()
