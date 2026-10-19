#include <windows.h>
#include <filesystem>
#include <fstream>
#include <string>

#ifndef FIXTURE_VERSION
#define FIXTURE_VERSION 1
#endif
namespace {
std::filesystem::path state;
LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wp, LPARAM lp) {
  if (message == WM_CLOSE && std::filesystem::exists(state / "ignore-close")) return 0;
  if (message == WM_DESTROY) { PostQuitMessage(0); return 0; }
  return DefWindowProcW(window, message, wp, lp);
}
}
int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
  wchar_t module[32768]{};
  GetModuleFileNameW(nullptr, module, 32768);
  state = std::filesystem::path(module).parent_path().parent_path() / "state";
  std::filesystem::create_directories(state);
  std::ofstream log(state / "launches.log", std::ios::app);
  log << FIXTURE_VERSION << " " << GetCurrentProcessId() << std::endl;
  log.close();
  WNDCLASSW wc{}; wc.lpfnWndProc = WindowProc; wc.hInstance = instance; wc.lpszClassName = L"InnocrewUpdaterFixture";
  RegisterClassW(&wc);
  HWND window = CreateWindowW(wc.lpszClassName, L"Isolated updater fixture", WS_OVERLAPPEDWINDOW,
    0, 0, 300, 100, nullptr, nullptr, instance, nullptr);
  ShowWindow(window, SW_SHOW);
  MSG message{};
  while (GetMessageW(&message, nullptr, 0, 0) > 0) { TranslateMessage(&message); DispatchMessageW(&message); }
  return 0;
}
