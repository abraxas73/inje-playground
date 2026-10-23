#include "flutter_window.h"

#include <optional>
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>
#include <shobjidl.h>
#include <flutter/standard_method_codec.h>

#include "flutter/generated_plugin_registrant.h"

FlutterWindow::FlutterWindow(const flutter::DartProject& project)
    : project_(project) {}

FlutterWindow::~FlutterWindow() {}

namespace {

// 작은 아이콘 크기의 빨간 원 + 흰 숫자(99 초과는 "99+") 겹침 아이콘. 호출한 쪽이 DestroyIcon.
HICON MakeBadgeIcon(int n) {
  const int s = GetSystemMetrics(SM_CXSMICON);
  BITMAPINFO bi = {};
  bi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  bi.bmiHeader.biWidth = s;
  bi.bmiHeader.biHeight = -s;  // 위에서 아래로
  bi.bmiHeader.biPlanes = 1;
  bi.bmiHeader.biBitCount = 32;
  bi.bmiHeader.biCompression = BI_RGB;
  HDC screen = GetDC(nullptr);
  void* bits = nullptr;
  HBITMAP color = CreateDIBSection(screen, &bi, DIB_RGB_COLORS, &bits, nullptr, 0);
  HDC dc = CreateCompatibleDC(screen);
  ReleaseDC(nullptr, screen);
  if (!color || !dc) {
    if (color) DeleteObject(color);
    if (dc) DeleteDC(dc);
    return nullptr;
  }
  auto* px = static_cast<uint32_t*>(bits);
  std::vector<uint8_t> alpha(static_cast<size_t>(s) * s);
  const double r = s / 2.0;
  for (int y = 0; y < s; ++y) {
    for (int x = 0; x < s; ++x) {
      const double d = std::hypot(x + 0.5 - r, y + 0.5 - r);
      const double a = std::fmax(0.0, std::fmin(1.0, r - d));
      const auto A = static_cast<uint32_t>(a * 255 + 0.5);
      alpha[static_cast<size_t>(y) * s + x] = static_cast<uint8_t>(A);
      // 미리 곱한(premultiplied) #FF3B30
      px[y * s + x] = (A << 24) | (((0xFF * A) / 255) << 16) | (((0x3B * A) / 255) << 8) | ((0x30 * A) / 255);
    }
  }
  const std::wstring text = n > 99 ? L"99+" : std::to_wstring(n);
  const int height = text.size() == 1 ? s * 4 / 5 : text.size() == 2 ? s * 3 / 5 : s / 2;
  HFONT font = CreateFontW(-height, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                           ANTIALIASED_QUALITY, DEFAULT_PITCH | FF_SWISS, L"Segoe UI");
  HGDIOBJ old_bitmap = SelectObject(dc, color);
  HGDIOBJ old_font = SelectObject(dc, font);
  SetBkMode(dc, TRANSPARENT);
  SetTextColor(dc, RGB(255, 255, 255));
  RECT rc = {0, 0, s, s};
  DrawTextW(dc, text.c_str(), -1, &rc, DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
  GdiFlush();
  // GDI 글자는 알파를 지우므로 원의 알파를 되돌린다
  for (size_t i = 0; i < alpha.size(); ++i) px[i] = (px[i] & 0x00FFFFFF) | (static_cast<uint32_t>(alpha[i]) << 24);
  SelectObject(dc, old_font);
  SelectObject(dc, old_bitmap);
  DeleteObject(font);
  DeleteDC(dc);
  HBITMAP mask = CreateBitmap(s, s, 1, 1, nullptr);
  ICONINFO ii = {TRUE, 0, 0, mask, color};
  HICON icon = CreateIconIndirect(&ii);
  DeleteObject(mask);
  DeleteObject(color);
  return icon;
}

}  // namespace

void FlutterWindow::ApplyBadge() {
  ITaskbarList3* taskbar = nullptr;
  if (FAILED(CoCreateInstance(CLSID_TaskbarList, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&taskbar)))) return;
  if (SUCCEEDED(taskbar->HrInit())) {
    HICON icon = badge_count_ > 0 ? MakeBadgeIcon(badge_count_) : nullptr;
    const std::wstring desc = badge_count_ > 0 ? L"\uC54C\uB9BC " + std::to_wstring(badge_count_) : L"";  // "알림 N"
    taskbar->SetOverlayIcon(GetHandle(), icon, desc.c_str());
    if (icon) DestroyIcon(icon);
  }
  taskbar->Release();
}

bool FlutterWindow::OnCreate() {
  if (!Win32Window::OnCreate()) {
    return false;
  }

  RECT frame = GetClientArea();

  // The size here must match the window dimensions to avoid unnecessary surface
  // creation / destruction in the startup path.
  flutter_controller_ = std::make_unique<flutter::FlutterViewController>(
      frame.right - frame.left, frame.bottom - frame.top, project_);
  // Ensure that basic setup of the controller was successful.
  if (!flutter_controller_->engine() || !flutter_controller_->view()) {
    return false;
  }
  RegisterPlugins(flutter_controller_->engine());
  desktop_updater_ = std::make_unique<DesktopUpdater>(flutter_controller_->engine()->messenger(), GetHandle());
  badge_channel_ = std::make_unique<flutter::MethodChannel<flutter::EncodableValue>>(
      flutter_controller_->engine()->messenger(), "com.innogrid.playground/badge", &flutter::StandardMethodCodec::GetInstance());
  badge_channel_->SetMethodCallHandler([this](const auto& call, auto result) {
    if (call.method_name() != "set") {
      result->NotImplemented();
      return;
    }
    int n = 0;
    if (const auto* v = call.arguments() ? std::get_if<int32_t>(call.arguments()) : nullptr) n = *v;
    else if (const auto* v64 = call.arguments() ? std::get_if<int64_t>(call.arguments()) : nullptr) n = static_cast<int>(*v64);
    badge_count_ = n < 0 ? 0 : n;
    ApplyBadge();
    result->Success();
  });
  SetChildContent(flutter_controller_->view()->GetNativeWindow());

  flutter_controller_->engine()->SetNextFrameCallback([&]() {
    this->Show();
  });

  // Flutter can complete the first frame before the "show window" callback is
  // registered. The following call ensures a frame is pending to ensure the
  // window is shown. It is a no-op if the first frame hasn't completed yet.
  flutter_controller_->ForceRedraw();

  return true;
}

void FlutterWindow::OnDestroy() {
  badge_channel_.reset();
  desktop_updater_.reset();
  if (flutter_controller_) {
    flutter_controller_ = nullptr;
  }

  Win32Window::OnDestroy();
}

LRESULT
FlutterWindow::MessageHandler(HWND hwnd, UINT const message,
                              WPARAM const wparam,
                              LPARAM const lparam) noexcept {
  if (desktop_updater_) {
    auto result = desktop_updater_->HandleMessage(message, wparam);
    if (result) return *result;
  }
  // Give Flutter, including plugins, an opportunity to handle window messages.
  if (flutter_controller_) {
    std::optional<LRESULT> result =
        flutter_controller_->HandleTopLevelWindowProc(hwnd, message, wparam,
                                                      lparam);
    if (result) {
      return *result;
    }
  }

  // 탐색기가 다시 시작되면 작업 표시줄 단추가 새로 생겨 겹침 아이콘이 사라진다 — 다시 건다
  static const UINT taskbar_created = RegisterWindowMessageW(L"TaskbarButtonCreated");
  if (message == taskbar_created && badge_count_ > 0) ApplyBadge();

  switch (message) {
    case WM_FONTCHANGE:
      flutter_controller_->engine()->ReloadSystemFonts();
      break;
  }

  return Win32Window::MessageHandler(hwnd, message, wparam, lparam);
}
