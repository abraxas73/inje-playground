import Flutter
import UIKit
import UserNotifications
import workmanager_apple

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // 잠금 화면 브리핑 백그라운드 갱신(lib/briefing/live_background.dart) — 백그라운드 엔진에도 플러그인과 라이브 액티비티 채널을 붙인다
    WorkmanagerPlugin.setPluginRegistrantCallback { registry in
      GeneratedPluginRegistrant.register(with: registry)
      AppDelegate.registerLiveActivity(registry)
    }
    WorkmanagerPlugin.registerPeriodicTask(withIdentifier: "com.innogrid.playground.briefing", earliestBeginInSeconds: NSNumber(value: 15 * 60))
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    Self.registerLiveActivity(engineBridge.pluginRegistry)
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "AppBadgePlugin") {
      AppBadgePlugin.register(with: registrar)
    }
  }

  private static func registerLiveActivity(_ registry: FlutterPluginRegistry) {
    if let registrar = registry.registrar(forPlugin: "BriefingLiveActivityPlugin") {
      BriefingLiveActivityPlugin.register(with: registrar)
    }
  }
}

/// Dart `lib/notifications/app_badge.dart`의 채널 `com.innogrid.playground/badge` — `set`(숫자, 0이면 지움).
/// 홈 화면 아이콘 배지는 알림 권한(배지)이 있어야 보인다 — 처음 숫자가 생길 때 한 번 묻는다.
final class AppBadgePlugin: NSObject, FlutterPlugin {
  static func register(with registrar: FlutterPluginRegistrar) {
    let channel = FlutterMethodChannel(name: "com.innogrid.playground/badge", binaryMessenger: registrar.messenger())
    registrar.addMethodCallDelegate(AppBadgePlugin(), channel: channel)
  }

  func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    guard call.method == "set" else { return result(FlutterMethodNotImplemented) }
    let n = max(0, (call.arguments as? NSNumber)?.intValue ?? 0)
    let center = UNUserNotificationCenter.current()
    let apply = {
      if #available(iOS 16.0, *) {
        center.setBadgeCount(n)
      } else {
        DispatchQueue.main.async { UIApplication.shared.applicationIconBadgeNumber = n }
      }
    }
    if n == 0 {
      apply()
    } else {
      center.requestAuthorization(options: [.badge]) { granted, _ in if granted { apply() } }
    }
    result(nil)
  }
}
