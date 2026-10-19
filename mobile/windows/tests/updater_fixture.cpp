#include <windows.h>
#include <filesystem>
#include <fstream>
#include <string>
#include <winsparkle.h>
#include <shellapi.h>
#include "../runner/desktop_update_policy.h"
#include "../runner/local_update_feed.h"

#ifndef FIXTURE_VERSION
#define FIXTURE_VERSION 1
#endif
namespace {
std::filesystem::path state;
HWND fixture_window = nullptr;
innocrew::UpdateLifecycle lifecycle;
std::filesystem::path install_directory;
void __cdecl UpdateError() { std::ofstream(state / "update-error") << "failed"; }
int __cdecl CanShutdown() { return lifecycle.CanInstall() ? 1 : 0; }
void __cdecl Shutdown() {
  if (lifecycle.ConsumeShutdown()) PostMessageW(fixture_window, WM_CLOSE, 0, 0);
}
int __cdecl RunInstaller(const wchar_t* path) {
  if (!path || std::filesystem::path(path).filename() != L"INNOGRID-Windows-9.0.2-Setup.exe") {
    UpdateError(); return -1;
  }
  if (!lifecycle.BeginInstall()) return -1;
  const auto args = innocrew::InstallerArguments(install_directory.wstring(), GetCurrentProcessId());
  SHELLEXECUTEINFOW execute{}; execute.cbSize = sizeof(execute);
  execute.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
  execute.lpVerb = L"open"; execute.lpFile = path; execute.lpParameters = args.c_str(); execute.nShow = SW_SHOWNORMAL;
  const bool success = ShellExecuteExW(&execute) != FALSE;
  if (execute.hProcess) CloseHandle(execute.hProcess);
  lifecycle.InstallerResult(success);
  if (success) std::ofstream(state / "installer-launched") << "verified";
  return success ? 1 : -1;
}
LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wp, LPARAM lp) {
  if (message == WM_CLOSE && std::filesystem::exists(state / "ignore-close")) return 0;
  if (message == WM_DESTROY) { PostQuitMessage(0); return 0; }
  return DefWindowProcW(window, message, wp, lp);
}
}
int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
  wchar_t module[32768]{};
  GetModuleFileNameW(nullptr, module, 32768);
  install_directory = std::filesystem::path(module).parent_path();
  state = install_directory.parent_path() / "state";
  std::filesystem::create_directories(state);
  std::ofstream log(state / "launches.log", std::ios::app);
  log << FIXTURE_VERSION << " " << GetCurrentProcessId() << std::endl;
  log.close();
  WNDCLASSW wc{}; wc.lpfnWndProc = WindowProc; wc.hInstance = instance; wc.lpszClassName = L"InnocrewUpdaterFixture";
  RegisterClassW(&wc);
  HWND window = CreateWindowW(wc.lpszClassName, L"Isolated updater fixture", WS_OVERLAPPEDWINDOW,
    0, 0, 300, 100, nullptr, nullptr, instance, nullptr);
  ShowWindow(window, SW_SHOW);
  fixture_window = window;
  bool updating = false;
  innocrew::LocalUpdateFeed local_feed;
  if (FIXTURE_VERSION == 1 && std::filesystem::exists(state / "update-config")) {
    std::ifstream config(state / "update-config"); std::string feed, key, signature, artifact;
    std::getline(config, feed); std::getline(config, key);
    std::getline(config, signature); std::getline(config, artifact);
    if (!local_feed.StartForTesting("9.0.2", signature, artifact)) return 11;
    if (!win_sparkle_set_eddsa_public_key(key.c_str())) return 10;
    lifecycle.Begin("isolated-test", "9.0.2");
    win_sparkle_set_app_details(L"INNOGRID-Tests", L"Isolated Updater Fixture", L"9.0.1");
    win_sparkle_set_registry_path("Software\\InnoCrew\\IsolatedUpdaterFixture");
    win_sparkle_set_automatic_check_for_updates(0);
    win_sparkle_set_appcast_url(local_feed.URL().c_str());
    win_sparkle_set_http_header("Authorization", "Bearer isolated-upgrade-fixture");
    win_sparkle_set_error_callback(UpdateError);
    win_sparkle_set_can_shutdown_callback(CanShutdown);
    win_sparkle_set_shutdown_request_callback(Shutdown);
    win_sparkle_set_user_run_installer_callback(RunInstaller);
    win_sparkle_init(); updating = true;
    win_sparkle_check_update_with_ui_and_install();
  }
  MSG message{};
  while (GetMessageW(&message, nullptr, 0, 0) > 0) { TranslateMessage(&message); DispatchMessageW(&message); }
  if (updating) { win_sparkle_clear_http_headers(); win_sparkle_cleanup(); }
  local_feed.Stop();
  return 0;
}
