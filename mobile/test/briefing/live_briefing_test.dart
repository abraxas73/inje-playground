import 'package:flutter_test/flutter_test.dart';
import 'package:playground/briefing/briefing_model.dart';
import 'package:playground/briefing/live_briefing.dart';
import 'briefing_model_test.dart' show ev, ap, mail, data, now;

void main() {
  test('다음 회의 — 끝난 회의·종일·근태는 건너뛰고, 시각은 KST 벽시계 → 실제 순간', () {
    final d = data(today: [
      ev('1', '아침 스탠드업', start: '202610050800', end: '202610050830'), // 08:40 기준 이미 끝남
      ev('2', '휴가', start: '202610050900', end: '202610051800'),
      ev('3', '창립기념일', allDay: true),
      ev('4', '주간회의', start: '202610051000', end: '202610051100'),
    ]);
    final l = liveBriefingFrom(d);
    expect(l.meetingTitle, '주간회의');
    expect(l.meetingStart, DateTime.utc(2026, 10, 5, 1)); // 10:00 KST = 01:00 UTC
    expect(l.meetingEnd, DateTime.utc(2026, 10, 5, 2));
  });

  test('건수 — 결재 전체, 오늘 안 읽은 메일, 연결된 Teams 멘션', () {
    final d = data(
      approvals: [ap('a'), ap('b')],
      inbox: [mail('x'), mail('y', seen: true), mail('z', tooltip: '2026-10-04 09:00:00')],
      mentions: const TeamsMentions(connected: true, items: [TeamsMention(chatId: 'c', topic: 't', from: 'f', text: 'x', at: '')]),
    );
    final l = liveBriefingFrom(d);
    expect((l.approvals, l.mails, l.mentions, l.notices), (2, 1, 1, 0));
    expect(l.countsLine, '결재 2 · Teams 1 · 메일 1');
  });

  test('못 받은 소스는 직전 값을 유지한다(백그라운드는 Teams를 수집하지 않음)', () {
    final prev = LiveBriefing(meetingTitle: '주간회의', meetingStart: DateTime.utc(2026, 10, 5, 1), approvals: 1, mentions: 3, mails: 2);
    final l = liveBriefingFrom(data(approvals: [ap('a'), ap('b')]), prev: prev);
    expect((l.approvals, l.mentions, l.mails), (2, 3, 2));
    expect(l.meetingTitle, '주간회의');
  });

  test('변경 알림 — 늘어난 항목만, 첫 표시·감소는 알리지 않는다', () {
    const a = LiveBriefing(approvals: 1, mails: 3);
    expect(liveAlert(null, a), isNull);
    expect(liveAlert(a, const LiveBriefing(approvals: 1, mails: 1)), isNull);
    expect(liveAlert(a, const LiveBriefing(approvals: 2, mails: 5, notices: 1)), '결재 1건, 메일 2통, 공지 1건 새로 도착');
  });

  test('JSON 왕복', () {
    final l = LiveBriefing(meetingTitle: '회의', meetingStart: DateTime.utc(2026, 10, 5, 1), approvals: 2, notices: 1);
    final r = LiveBriefing.fromJson(l.toJson())!;
    expect((r.meetingTitle, r.meetingStart, r.meetingEnd, r.approvals, r.notices), ('회의', l.meetingStart, null, 2, 1));
    expect(LiveBriefing.fromJson('x'), isNull);
  });

  test('표시 기간 — 평일 07:00~18:30', () {
    expect(inLiveWindow(now), isTrue); // 월 08:40
    expect(inLiveWindow(DateTime.utc(2026, 10, 5, 6, 59)), isFalse);
    expect(inLiveWindow(DateTime.utc(2026, 10, 5, 18, 30)), isFalse);
    expect(inLiveWindow(DateTime.utc(2026, 10, 10, 9)), isFalse); // 토
  });
}
