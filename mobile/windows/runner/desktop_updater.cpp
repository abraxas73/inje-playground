#include "desktop_updater.h"
#include <flutter/standard_method_codec.h>
#include <winsparkle.h>
#include <shellapi.h>
#include <filesystem>
#include <vector>

#ifndef INNOCREW_UPDATE_PUBLIC_KEY
#define INNOCREW_UPDATE_PUBLIC_KEY ""
#endif

namespace {
constexpr UINT kStatusMessage = WM_APP + 0x174;
constexpr UINT kAboutCommand = 0x1F10;
constexpr UINT kCheckCommand = 0x1F20;
using Value = flutter::EncodableValue;
using Map = flutter::EncodableMap;

std::string StringAt(const Map& values, const char* key) {
  const auto found = values.find(Value(key));
  if (found == values.end()) return {};
  const auto value = std::get_if<std::string>(&found->second);
  return value ? *value : std::string{};
}

bool InstallerVersionMatches(const wchar_t* path, const std::string& version) {
  std::array<uint32_t, 3> expected{};
  if (!innocrew::ParseUpdateVersion(version, expected)) return false;
  DWORD ignored = 0;
  const DWORD size = GetFileVersionInfoSizeW(path, &ignored);
  if (!size || size > 1024 * 1024) return false;
  std::vector<BYTE> data(size);
  if (!GetFileVersionInfoW(path, 0, size, data.data())) return false;
  VS_FIXEDFILEINFO* info = nullptr; UINT length = 0;
  if (!VerQueryValueW(data.data(), L"\\", reinterpret_cast<void**>(&info), &length) ||
      length < sizeof(VS_FIXEDFILEINFO) || info->dwSignature != 0xFEEF04BD) return false;
  return HIWORD(info->dwFileVersionMS) == expected[0] && LOWORD(info->dwFileVersionMS) == expected[1] &&
    HIWORD(info->dwFileVersionLS) == expected[2];
}
}

std::atomic<DesktopUpdater*> DesktopUpdater::instance_{nullptr};

DesktopUpdater::DesktopUpdater(flutter::BinaryMessenger* messenger, HWND window) : window_(window) {
  instance_.store(this);
  std::vector<wchar_t> module(32768);
  const DWORD length = GetModuleFileNameW(nullptr, module.data(), static_cast<DWORD>(module.size()));
  if (length && length < module.size()) install_directory_ = std::filesystem::path(module.data()).parent_path().wstring();
  HMENU menu = GetSystemMenu(window, FALSE);
  AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
  AppendMenuW(menu, MF_STRING, kAboutCommand, L"About 이노크루");
  AppendMenuW(menu, MF_STRING, kCheckCommand, L"업데이트 확인…");
  channel_ = std::make_unique<flutter::MethodChannel<Value>>(messenger, "com.innogrid.playground/updater", &flutter::StandardMethodCodec::GetInstance());
  channel_->SetMethodCallHandler([this](const auto& call, auto result) {
    const auto* args = call.arguments() ? std::get_if<Map>(call.arguments()) : nullptr;
    if (call.method_name() == "install") {
      if (!args || !Install({StringAt(*args, "feedUrl"), StringAt(*args, "accessToken"), StringAt(*args, "expectedVersion"), StringAt(*args, "sessionId"), StringAt(*args, "edSignature")})) {
        result->Error("update_unavailable", "업데이트를 시작하지 못했습니다."); return;
      }
      result->Success();
    } else if (call.method_name() == "cancel") {
      const auto id = args ? StringAt(*args, "sessionId") : std::string{};
      if (id == lifecycle_.Identity().first && !id.empty()) {
        if (!lifecycle_.Cancel(id)) { result->Error("installation_started", "설치가 이미 시작되었습니다."); return; }
        Cleanup();
      }
      result->Success();
    } else { result->NotImplemented(); }
  });
}

DesktopUpdater::~DesktopUpdater() {
  instance_.store(nullptr);
  channel_->SetMethodCallHandler(nullptr);
  Cleanup();
}

bool DesktopUpdater::Install(const innocrew::UpdateRequest& request) {
  if (initialized_ || install_directory_.empty() || !innocrew::ValidateUpdateRequest(request, FLUTTER_VERSION)) return false;
  const std::string key = INNOCREW_UPDATE_PUBLIC_KEY;
  if (key.empty() || !win_sparkle_set_eddsa_public_key(key.c_str())) return false;
  if (!lifecycle_.Begin(request.session_id, request.version)) return false;
  if (!local_feed_.Start(request.version, request.signature)) { lifecycle_.Reset(); return false; }
  const std::string version = innocrew::MarketingVersion(FLUTTER_VERSION);
  const std::wstring wide_version(version.begin(), version.end());
  win_sparkle_set_app_details(L"INNOGRID", L"이노크루", wide_version.c_str());
  win_sparkle_set_automatic_check_for_updates(0);
  // Remote appcasts can redirect and introduce a new credential-bearing request.
  // Our exclusively owned loopback feed contains only the fixed official URL.
  win_sparkle_set_appcast_url(local_feed_.URL().c_str());
  win_sparkle_set_http_header("Authorization", ("Bearer " + request.token).c_str());
  win_sparkle_set_error_callback(Failed);
  win_sparkle_set_did_not_find_update_callback(Failed);
  win_sparkle_set_update_cancelled_callback(Canceled);
  win_sparkle_set_can_shutdown_callback(CanShutdown);
  win_sparkle_set_shutdown_request_callback(Shutdown);
  win_sparkle_set_user_run_installer_callback(InstallPayload);
  initialized_ = true;
  win_sparkle_init();
  win_sparkle_check_update_with_ui_and_install();
  return true;
}

void DesktopUpdater::Cleanup() {
  if (initialized_) {
    // Worker callbacks only enqueue; never wait on the UI thread. This lets
    // cleanup join them without a cross-thread SendMessage deadlock.
    win_sparkle_clear_http_headers();
    win_sparkle_cleanup(); initialized_ = false;
    win_sparkle_clear_http_headers();
  }
  local_feed_.Stop();
  lifecycle_.Reset();
  std::lock_guard<std::mutex> lock(events_mutex_); events_.clear();
}

void DesktopUpdater::PostStatus(const char* phase) {
  const auto identity = lifecycle_.Identity();
  if (identity.first.empty()) return;
  { std::lock_guard<std::mutex> lock(events_mutex_); events_.push_back({identity.first, identity.second, phase}); }
  PostMessageW(window_, kStatusMessage, 0, 0);
}
void DesktopUpdater::PostFailure(const char* reason, uint32_t win_error, int attempts) {
  const auto identity = lifecycle_.Identity();
  if (identity.first.empty()) return;
  { std::lock_guard<std::mutex> lock(events_mutex_); events_.push_back({identity.first, identity.second, "error", reason, win_error, attempts}); }
  PostMessageW(window_, kStatusMessage, 0, 0);
}
void DesktopUpdater::DrainEvents() {
  std::deque<Event> events;
  { std::lock_guard<std::mutex> lock(events_mutex_); events.swap(events_); }
  for (const auto& event : events) {
    if (event.id != lifecycle_.Identity().first) continue;
    if (event.phase == "error" || event.phase == "cancelled") {
      if (lifecycle_.Committed()) continue;
      lifecycle_.Cancel(event.id); Cleanup();
    }
    Map status{{Value("sessionId"), Value(event.id)}, {Value("version"), Value(event.version)}, {Value("phase"), Value(event.phase)}};
    if (!event.reason.empty()) {
      status[Value("reason")] = Value(event.reason);
      status[Value("winError")] = Value(static_cast<int64_t>(event.win_error));
      status[Value("attempts")] = Value(event.attempts);
    }
    channel_->InvokeMethod("status", std::make_unique<Value>(std::move(status)));
  }
}

std::optional<LRESULT> DesktopUpdater::HandleMessage(UINT message, WPARAM wparam) {
  if (message == kStatusMessage) { DrainEvents(); return 0; }
  if (message == WM_SYSCOMMAND) {
    const auto command = static_cast<UINT>(wparam & 0xFFF0);
    if (command == kCheckCommand) {
      ShowWindow(window_, SW_RESTORE); SetForegroundWindow(window_);
      channel_->InvokeMethod("checkForUpdates", nullptr); return 0;
    }
    if (command == kAboutCommand) {
      const std::string version = FLUTTER_VERSION;
      const std::wstring text = L"이노크루\n버전 " + std::wstring(version.begin(), version.end());
      MessageBoxW(window_, text.c_str(), L"About 이노크루", MB_OK | MB_ICONINFORMATION); return 0;
    }
  }
  return std::nullopt;
}

void __cdecl DesktopUpdater::Failed() { if (auto* self = instance_.load()) self->PostStatus("error"); }
void __cdecl DesktopUpdater::Canceled() { if (auto* self = instance_.load()) self->PostStatus("cancelled"); }
int __cdecl DesktopUpdater::CanShutdown() { auto* self = instance_.load(); return self && self->lifecycle_.CanInstall() ? 1 : 0; }
void __cdecl DesktopUpdater::Shutdown() {
  if (auto* self = instance_.load(); self && self->lifecycle_.ConsumeShutdown()) {
    // Only our HWND, never taskkill/process-name enumeration or unrelated apps.
    PostMessageW(self->window_, WM_CLOSE, 0, 0);
  }
}
int __cdecl DesktopUpdater::InstallPayload(const wchar_t* filename) {
  auto* self = instance_.load(); return self ? self->RunInstaller(filename) : -1;
}

int DesktopUpdater::RunInstaller(const wchar_t* filename) {
  // WinSparkle invokes this only after Ed25519 verification (pinned 0.9.4).
  // Never return 0: that would allow remote appcast installerArguments to run.
  if (!filename) { PostFailure("file", 0, 1); return -1; }
  const auto identity = lifecycle_.Identity();
  const std::string expected = "INNOGRID-Windows-" + identity.second + "-Setup.exe";
  const std::wstring expected_wide(expected.begin(), expected.end());
  const auto basename = std::filesystem::path(filename).filename().wstring();
  const auto args = innocrew::InstallerArguments(install_directory_, GetCurrentProcessId());
  if (args.empty()) { PostFailure("arguments", 0, 1); return -1; }
  if (CompareStringOrdinal(basename.c_str(), -1, expected_wide.c_str(), -1, TRUE) != CSTR_EQUAL) { PostFailure("name", 0, 1); return -1; }
  // Bounded retries only for "file briefly held" errors (policy header). A readable file with
  // the wrong version reports ERROR_SUCCESS and fails at once.
  for (int attempt = 1;; ++attempt) {
    SetLastError(ERROR_SUCCESS);
    if (InstallerVersionMatches(filename, identity.second)) break;
    const DWORD code = GetLastError();
    if (!innocrew::ShouldRetryLaunch(attempt, code)) { PostFailure("version", code, attempt); return -1; }
    Sleep(innocrew::LaunchRetryDelayMs(attempt));
  }
  if (!lifecycle_.BeginInstall()) { PostFailure("session", 0, 1); return -1; }
  bool success = false; DWORD code = ERROR_SUCCESS; int attempt = 1;
  for (;; ++attempt) {
    SHELLEXECUTEINFOW execute{};
    execute.cbSize = sizeof(execute);
    execute.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
    execute.hwnd = window_; execute.lpVerb = L"open"; execute.lpFile = filename;
    execute.lpParameters = args.c_str(); execute.lpDirectory = install_directory_.c_str(); execute.nShow = SW_SHOWNORMAL;
    // FALSE means no process was created, so another try cannot start a second installer.
    success = ShellExecuteExW(&execute) != FALSE;
    code = success ? ERROR_SUCCESS : GetLastError();
    if (execute.hProcess) CloseHandle(execute.hProcess);
    if (success || !innocrew::ShouldRetryLaunch(attempt, code)) break;
    Sleep(innocrew::LaunchRetryDelayMs(attempt));
  }
  lifecycle_.InstallerResult(success);
  if (success) PostStatus("installing"); else PostFailure("launch", code, attempt);
  return success ? 1 : -1;
}
