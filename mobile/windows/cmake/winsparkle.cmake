include(FetchContent)
if(POLICY CMP0135)
  cmake_policy(SET CMP0135 NEW)
endif()
FetchContent_Declare(winsparkle
  URL https://github.com/vslavik/winsparkle/releases/download/v0.9.4/WinSparkle-0.9.4.zip
  URL_HASH SHA256=6037df37fc263bd1650a1c4949681a9d40ffe991d01f35892a406cb5d103c976
)
FetchContent_MakeAvailable(winsparkle)
set(WINSPARKLE_ROOT "${winsparkle_SOURCE_DIR}")
if(NOT EXISTS "${WINSPARKLE_ROOT}/include/winsparkle.h")
  set(WINSPARKLE_ROOT "${winsparkle_SOURCE_DIR}/WinSparkle-0.9.4")
endif()
if(NOT EXISTS "${WINSPARKLE_ROOT}/x64/Release/WinSparkle.dll" OR NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
  message(FATAL_ERROR "Verified WinSparkle 0.9.4 x64 package is required")
endif()
add_library(WinSparkle SHARED IMPORTED GLOBAL)
set_target_properties(WinSparkle PROPERTIES
  IMPORTED_IMPLIB "${WINSPARKLE_ROOT}/x64/Release/WinSparkle.lib"
  IMPORTED_LOCATION "${WINSPARKLE_ROOT}/x64/Release/WinSparkle.dll"
  INTERFACE_INCLUDE_DIRECTORIES "${WINSPARKLE_ROOT}/include"
)
