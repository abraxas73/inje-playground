#include <windows.h>
#include <winsparkle.h>
#include <string>

namespace {
HANDLE done = nullptr;
void __cdecl Finished() { SetEvent(done); }
}

int main(int argc, char** argv) {
  if (argc != 2 || std::string(argv[1]).rfind("http://127.0.0.1:", 0) != 0) return 2;
  done = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  win_sparkle_set_app_details(L"INNOGRID Tests", L"Updater transport probe", L"1.0.0");
  win_sparkle_set_registry_path("Software\\INNOGRID\\UpdaterTransportProbe");
  win_sparkle_set_automatic_check_for_updates(0);
  win_sparkle_set_appcast_url(argv[1]);
  win_sparkle_set_http_header("Authorization", "Bearer updater-test-fixture");
  win_sparkle_set_error_callback(Finished);
  win_sparkle_set_did_not_find_update_callback(Finished);
  win_sparkle_init();
  win_sparkle_check_update_with_ui_and_install();
  const DWORD result = WaitForSingleObject(done, 15000);
  win_sparkle_clear_http_headers();
  win_sparkle_cleanup();
  CloseHandle(done);
  return result == WAIT_OBJECT_0 ? 0 : 3;
}
