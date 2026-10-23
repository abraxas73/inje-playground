#ifndef RUNNER_FLUTTER_WINDOW_H_
#define RUNNER_FLUTTER_WINDOW_H_

#include <flutter/dart_project.h>
#include <flutter/flutter_view_controller.h>
#include <flutter/method_channel.h>
#include <flutter/encodable_value.h>

#include <memory>

#include "win32_window.h"
#include "desktop_updater.h"

// A window that does nothing but host a Flutter view.
class FlutterWindow : public Win32Window {
 public:
  // Creates a new FlutterWindow hosting a Flutter view running |project|.
  explicit FlutterWindow(const flutter::DartProject& project);
  virtual ~FlutterWindow();

 protected:
  // Win32Window:
  bool OnCreate() override;
  void OnDestroy() override;
  LRESULT MessageHandler(HWND window, UINT const message, WPARAM const wparam,
                         LPARAM const lparam) noexcept override;

 private:
  // The project to run.
  flutter::DartProject project_;

  // The Flutter instance hosted by this window.
  std::unique_ptr<flutter::FlutterViewController> flutter_controller_;
  std::unique_ptr<DesktopUpdater> desktop_updater_;

  // 앱 아이콘 배지(lib/notifications/app_badge.dart) — 작업 표시줄 단추에 빨간 숫자 겹침 아이콘.
  std::unique_ptr<flutter::MethodChannel<flutter::EncodableValue>> badge_channel_;
  int badge_count_ = 0;
  void ApplyBadge();
};

#endif  // RUNNER_FLUTTER_WINDOW_H_
