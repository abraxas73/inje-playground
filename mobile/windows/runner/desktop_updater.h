#ifndef INNOCREW_DESKTOP_UPDATER_H_
#define INNOCREW_DESKTOP_UPDATER_H_
#include <windows.h>
#include <flutter/binary_messenger.h>
#include <flutter/method_channel.h>
#include <flutter/encodable_value.h>
#include <atomic>
#include <deque>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include "desktop_update_policy.h"
#include "local_update_feed.h"

class DesktopUpdater {
 public:
  DesktopUpdater(flutter::BinaryMessenger* messenger, HWND window);
  ~DesktopUpdater();
  std::optional<LRESULT> HandleMessage(UINT message, WPARAM wparam);
 private:
  /// reason: fixed step name of a terminal installer failure (never remote text); win_error: GetLastError; attempts: tries made.
  struct Event { std::string id, version, phase, reason; uint32_t win_error = 0; int attempts = 0; };
  bool Install(const innocrew::UpdateRequest& request);
  void Cleanup();
  void PostStatus(const char* phase);
  void PostFailure(const char* reason, uint32_t win_error, int attempts);
  void DrainEvents();
  int RunInstaller(const wchar_t* filename);
  static void __cdecl Failed();
  static void __cdecl Canceled();
  static int __cdecl CanShutdown();
  static void __cdecl Shutdown();
  static int __cdecl InstallPayload(const wchar_t* filename);
  static std::atomic<DesktopUpdater*> instance_;
  HWND window_;
  std::unique_ptr<flutter::MethodChannel<flutter::EncodableValue>> channel_;
  innocrew::UpdateLifecycle lifecycle_;
  innocrew::LocalUpdateFeed local_feed_;
  std::mutex events_mutex_;
  std::deque<Event> events_;
  bool initialized_ = false;
  std::wstring install_directory_;
};
#endif
