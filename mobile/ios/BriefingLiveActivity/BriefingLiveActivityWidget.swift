import ActivityKit
import SwiftUI
import WidgetKit

private let brand = Color(red: 0x04 / 255, green: 0x41 / 255, blue: 0xFF / 255)

@main
struct BriefingLiveActivityBundle: WidgetBundle {
  var body: some Widget { BriefingLiveActivity() }
}

/// 잠금 화면: 다음 회의(시작까지 카운트다운) + 건수 한 줄. 다이내믹 아일랜드: 평소엔 아이콘·숫자만,
/// 변경이 있으면 앱이 AlertConfiguration으로 펼친다(펼친 화면에 무엇이 늘었는지).
struct BriefingLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: BriefingActivityAttributes.self) { ctx in
      VStack(alignment: .leading, spacing: 8) {
        HStack {
          Label("데일리 브리핑", systemImage: "sun.max.fill").font(.caption.bold()).foregroundStyle(brand)
          Spacer()
          if let alert = ctx.state.alert { Text(alert).font(.caption2).lineLimit(1) }
        }
        MeetingLine(state: ctx.state)
        CountsLine(state: ctx.state)
      }
      .padding(16)
      .activityBackgroundTint(brand.opacity(0.08))
    } dynamicIsland: { ctx in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) { Image(systemName: "sun.max.fill").foregroundStyle(brand) }
        DynamicIslandExpandedRegion(.trailing) { if ctx.state.total > 0 { Text("\(ctx.state.total)").bold() } }
        DynamicIslandExpandedRegion(.center) { Text(ctx.state.alert ?? "데일리 브리핑").font(.subheadline).lineLimit(1) }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 6) {
            MeetingLine(state: ctx.state)
            CountsLine(state: ctx.state)
          }
        }
      } compactLeading: {
        Image(systemName: "sun.max.fill").foregroundStyle(brand)
      } compactTrailing: {
        if ctx.state.total > 0 { Text("\(ctx.state.total)").font(.caption2.bold()) }
      } minimal: {
        Image(systemName: "sun.max.fill").foregroundStyle(brand)
      }
    }
  }
}

private struct MeetingLine: View {
  let state: BriefingActivityAttributes.ContentState
  var body: some View {
    if state.meetingTitle.isEmpty {
      Text("오늘 남은 회의 없음").font(.subheadline).foregroundStyle(.secondary)
    } else {
      HStack(spacing: 6) {
        Image(systemName: "calendar")
        Text(state.meetingTitle).font(.subheadline.weight(.semibold)).lineLimit(1)
        Spacer(minLength: 4)
        if let start = state.meetingStart, start > Date() {
          // 앱이 다시 갱신하지 않아도 시스템이 줄여 준다
          Text(timerInterval: Date()...start, countsDown: true).monospacedDigit().font(.subheadline).frame(maxWidth: 64, alignment: .trailing)
        } else if let end = state.meetingEnd {
          Text("~\(end, style: .time)").font(.caption).foregroundStyle(.secondary)
        }
      }
    }
  }
}

private struct CountsLine: View {
  let state: BriefingActivityAttributes.ContentState
  var body: some View {
    Text(state.countsLine.isEmpty ? "지금 확인할 항목이 없습니다" : state.countsLine).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
  }
}
