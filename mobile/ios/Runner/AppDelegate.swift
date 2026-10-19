import Flutter
import UIKit
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
  }

  private static func registerLiveActivity(_ registry: FlutterPluginRegistry) {
    if let registrar = registry.registrar(forPlugin: "BriefingLiveActivityPlugin") {
      BriefingLiveActivityPlugin.register(with: registrar)
    }
  }
}
