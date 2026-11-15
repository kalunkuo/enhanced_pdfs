# SmartMarkup.pvp — the PDF-XChange Editor adapter. Built only with -DPDFXCHANGE=ON (see ../CMakeLists.txt).
set(PXV_TYPELIB "${PDFXCHANGE_DIR}/PDFXEditCore.x64.dll")
if(NOT EXISTS "${PXV_TYPELIB}")
  message(FATAL_ERROR "PDF-XChange Editor type library not found: ${PXV_TYPELIB}")
endif()
# #import needs a literal path: generate the one header that imports the type library.
configure_file("${CMAKE_CURRENT_SOURCE_DIR}/src/pxv.h.in" "${CMAKE_CURRENT_BINARY_DIR}/generated/pxv.h" @ONLY)

file(GLOB PXC_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp" "${HOSTUI_DIR}/*.cpp")
add_library(SmartMarkupPxc SHARED ${PXC_SOURCES})
set_target_properties(SmartMarkupPxc PROPERTIES OUTPUT_NAME "SmartMarkup" SUFFIX ".pvp")
target_include_directories(SmartMarkupPxc PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}/src" "${HOSTUI_DIR}" "${CMAKE_CURRENT_BINARY_DIR}/generated")
target_compile_definitions(SmartMarkupPxc PRIVATE _CRT_SECURE_NO_WARNINGS NOMINMAX WIN32_LEAN_AND_MEAN)
# 4192/4278: #import noise (standard COM types re-declared, CopyFile/EnumFonts macro clashes).
target_compile_options(SmartMarkupPxc PRIVATE /wd4192 /wd4278)
target_link_libraries(SmartMarkupPxc PRIVATE smartmarkup_core comctl32)
# The Editor finds plug-ins through this single export.
target_link_options(SmartMarkupPxc PRIVATE /EXPORT:PXCE_GetPlugin)
# The Editor does not search Plugins.x64 for a plug-in's imports: delay-load duckdb.dll and let
# PXCE_GetPlugin load it from the plug-in's own folder first (plugin.cpp).
target_link_options(SmartMarkupPxc PRIVATE /DELAYLOAD:duckdb.dll)
target_link_libraries(SmartMarkupPxc PRIVATE delayimp)

add_custom_command(TARGET SmartMarkupPxc POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_if_different "${DUCKDB_DIR}/duckdb.dll" "$<TARGET_FILE_DIR:SmartMarkupPxc>")
