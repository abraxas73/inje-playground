cmake_minimum_required(VERSION 3.14)
project(innocrew_updater_tests LANGUAGES CXX)
include(../cmake/winsparkle.cmake)
add_executable(winsparkle_redirect_probe winsparkle_redirect_probe.cpp)
target_link_libraries(winsparkle_redirect_probe PRIVATE WinSparkle)
target_compile_features(winsparkle_redirect_probe PRIVATE cxx_std_17)
add_custom_command(TARGET winsparkle_redirect_probe POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_if_different $<TARGET_FILE:WinSparkle> $<TARGET_FILE_DIR:winsparkle_redirect_probe>)
