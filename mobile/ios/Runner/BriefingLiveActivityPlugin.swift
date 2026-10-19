import ActivityKit
import Flutter
import Foundation

/// Dart `lib/briefing/live_activity.dart`의 채널 `innogrid/live_activity` — `update`(없으면 시작)·`end`.
/// 앱 엔진과 workmanager 백그라운드 엔진 양쪽에 등록한다(AppDelegate). 새 액티비티는 앱이 화면에 있을 때만 시작할 수 있고(iOS 제약),
/// 백그라운드에서는 이미 떠 있는 것만 갱신된다.
final class BriefingLiveActivityPlugin: NSObject, FlutterPlugin {
  static func register(with registrar: FlutterPluginRegistrar) {
    let channel = FlutterMethodChannel(name: "innogrid/live_activity", binaryMessenger: registrar.messenger())
    registrar.addMethodCallDelegate(BriefingLiveActivityPlugin(), channel: channel)
  }

  func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    guard #available(iOS 16.2, *) else { return result(nil) }
    switch call.method {
    case "update":
      let args = call.arguments as? [String: Any] ?? [:]
      Task { await Self.update(args); result(nil) }
    case "end":
      Task {
        for activity in Activity<BriefingActivityAttributes>.activities {
          await activity.end(nil, dismissalPolicy: .immediate)
        }
        result(nil)
      }
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  @available(iOS 16.2, *)
  private static func update(_ a: [String: Any]) async {
    func date(_ key: String) -> Date? { (a[key] as? NSNumber).map { Date(timeIntervalSince1970: $0.doubleValue / 1000) } }
    let alert = a["alert"] as? String
    let state = BriefingActivityAttributes.ContentState(
      meetingTitle: a["meetingTitle"] as? String ?? "",
      meetingStart: date("meetingStart"),
      meetingEnd: date("meetingEnd"),
      countsLine: a["countsLine"] as? String ?? "",
      total: (a["total"] as? NSNumber)?.intValue ?? 0,
      alert: alert
    )
    // 2시간 넘게 갱신이 없으면 시스템이 낡은 정보로 표시한다
    let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(2 * 60 * 60))
    if let activity = Activity<BriefingActivityAttributes>.activities.first(where: { $0.activityState == .active }) {
      let alertConfig = alert.map { AlertConfiguration(title: "데일리 브리핑", body: "\($0)", sound: .default) }
      await activity.update(content, alertConfiguration: alertConfig)
    } else if ActivityAuthorizationInfo().areActivitiesEnabled {
      _ = try? Activity.request(attributes: BriefingActivityAttributes(), content: content, pushType: nil)
    }
  }
}
