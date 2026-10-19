import ActivityKit
import Foundation

/// 잠금 화면 브리핑 라이브 액티비티의 상태 — Runner(BriefingLiveActivityPlugin)와 위젯 확장 양쪽 타깃에 들어간다.
/// 값은 Dart `LiveBriefing`(lib/briefing/live_briefing.dart)에서 온다. 메일 제목·본문은 싣지 않는다(건수·회의 제목만).
@available(iOS 16.1, *)
struct BriefingActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var meetingTitle: String
    var meetingStart: Date?
    var meetingEnd: Date?
    var countsLine: String
    var total: Int
    /// 직전보다 늘어난 항목("결재 1건 새로 도착") — 있을 때만 다이내믹 아일랜드를 펼친다
    var alert: String?
  }
}
