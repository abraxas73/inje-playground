import ActivityKit
import Foundation

/// 잠금 화면 브리핑 라이브 액티비티의 상태 — Runner(BriefingLiveActivityPlugin)와 위젯 확장 양쪽 타깃에 들어간다.
/// 값은 Dart `LiveBriefing`(lib/briefing/live_briefing.dart)에서 온다. 메일은 제목·보낸 사람만(본문 없음).
@available(iOS 16.1, *)
struct BriefingActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// 잠금 화면 한 줄 — kind: meeting(제목·시작·끝)·approval(제목·기안자)·mail(제목·보낸 사람)
    struct Item: Codable, Hashable {
      var kind: String
      var title: String
      var sub: String
      var start: Date?
      var end: Date?
    }
    /// 회의·결재·메일 각 최대 2건, 전체 최대 5줄(Dart가 자른다)
    var items: [Item]
    var meetingTitle: String
    var meetingStart: Date?
    var meetingEnd: Date?
    var countsLine: String
    var total: Int
    /// 직전보다 늘어난 항목("결재 1건 새로 도착") — 있을 때만 다이내믹 아일랜드를 펼친다
    var alert: String?
  }
}
