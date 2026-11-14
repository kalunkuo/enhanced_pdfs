# SmartMarkup.api — the Acrobat adapter. Built only when ACROBAT_SDK is set (see ../CMakeLists.txt).
set(SDK_HEADERS "${ACROBAT_SDK}/PluginSupport/Headers")
if(NOT EXISTS "${SDK_HEADERS}/API/PIMain.c")
  message(FATAL_ERROR "ACROBAT_SDK does not look like the SDK 'Version 1' folder: ${ACROBAT_SDK}")
endif()

file(GLOB PLUGIN_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp" "${HOSTUI_DIR}/*.cpp")
add_library(SmartMarkup SHARED ${PLUGIN_SOURCES} "${SDK_HEADERS}/API/PIMain.c")
set_target_properties(SmartMarkup PROPERTIES SUFFIX ".api")
target_include_directories(SmartMarkup PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}/src" "${HOSTUI_DIR}"
  "${SDK_HEADERS}" "${SDK_HEADERS}/SDK" "${SDK_HEADERS}/ADM" "${SDK_HEADERS}/API")
# Same defines as the SDK samples (vcxproj + Samples/AcroDspOptions.rsp, x64).
target_compile_definitions(SmartMarkup PRIVATE WIN_PLATFORM _WINDOWS WIN_ENV ACRO_SDK_LEVEL=0x000A0000
  PI_ACROCOLOR_VERSION=0x00060000 PDMETADATA_HFT=1 PLUGIN=1 _CRT_SECURE_NO_WARNINGS NOMINMAX)
# Acrobat finds plug-ins through this export; without it the .api is silently skipped.
target_link_options(SmartMarkup PRIVATE /EXPORT:PlugInMain)
target_compile_options(SmartMarkup PRIVATE /wd4267 /wd4244 /wd4996 /wd4828)  # 4828: non-UTF-8 byte in an SDK header
target_link_libraries(SmartMarkup PRIVATE smartmarkup_core comctl32)

# duckdb.dll must sit next to SmartMarkup.api.
add_custom_command(TARGET SmartMarkup POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_if_different "${DUCKDB_DIR}/duckdb.dll" "$<TARGET_FILE_DIR:SmartMarkup>")
