import 'package:flutter_test/flutter_test.dart';
import 'package:playground/briefing/briefing_model.dart';
import 'package:playground/briefing/live_briefing.dart';
import 'briefing_model_test.dart' show ev, ap, mail, data, now;

void main() {
  test('회의 — 지금(08:40) 기준 10분 전 이후 시작만, 종일·근태 제외, 최대 2건, 건수 줄은 전체 일정 수', () {
    final d = data(today: [
      ev('1', '아침 스탠드업', start: '202610050800', end: '202610050900'), // 40분 전 시작 — 진행 중이어도 뺀다
      ev('2', '휴가', start: '202610050900', end: '202610051800'),
      ev('3', '창립기념일', allDay: true),
      ev('4', '데일리', start: '202610050830', end: '202610050845'), // 정확히 10분 전 — 남긴다
      ev('5', '주간회의', start: '202610051000', end: '202610051100'),
      ev('6', '고객 미팅', start: '202610051400', end: '202610051500'),
    ]);
    final l = liveBriefingFrom(d);
    expect(l.meetings.map((m) => m.title), ['데일리', '주간회의']);
    expect(l.meetingCount, 3);
    expect(l.meetingStart, DateTime.utc(2026, 10, 4, 23, 30)); // 08:30 KST = 전날 23:30 UTC
    expect(l.meetings[1].end, DateTime.utc(2026, 10, 5, 2)); // 11:00 KST
    expect(liveBriefingFrom(data(today: [ev('1', '아침', start: '202610050829', end: '202610051000')])).meetings, isEmpty); // 11분 전
  });

  test('잠금 화면 줄 — 회의·결재·메일 각 2건, 전체 5줄(셋 다 2건이면 마지막 메일이 빠짐), 메일은 오늘 안 읽은 것만', () {
    final d = data(
      today: [ev('a', '주간회의'), ev('b', '고객 미팅', start: '202610051400', end: '202610051500'), ev('c', '회고', start: '202610051600', end: '202610051700')],
      approvals: [ap('출장비'), ap('구매'), ap('휴가')],
      inbox: [mail('견적 요청'), mail('읽음', seen: true), mail('회의록'), mail('어제', tooltip: '2026-10-04 09:00:00'), mail('세 번째')],
    );
    final l = liveBriefingFrom(d);
    expect(l.lockItems.map((i) => '${i['kind']}:${i['title']}'), ['meeting:주간회의', 'meeting:고객 미팅', 'approval:출장비', 'approval:구매', 'mail:견적 요청']);
    expect(l.lockLines, ['📅 10:00 주간회의', '📅 14:00 고객 미팅', '✅ 출장비 · 이서연', '✅ 구매 · 이서연', '✉️ 견적 요청 · 박지훈']);
    expect(l.countsLine, '일정 3 · 결재 3 · 메일 3');
    final few = liveBriefingFrom(data(approvals: [ap('출장비')], inbox: [mail('견적 요청')]));
    expect(few.lockItems.map((i) => i['kind']), ['approval', 'mail']); // 있는 만큼만
  });

  test('건수 — 결재 전체, 오늘 안 읽은 메일, 연결된 Teams 멘션', () {
    final d = data(
      approvals: [ap('a'), ap('b')],
      inbox: [mail('x'), mail('y', seen: true), mail('z', tooltip: '2026-10-04 09:00:00')],
      mentions: const TeamsMentions(connected: true, items: [TeamsMention(chatId: 'c', topic: 't', from: 'f', text: 'x', at: '')]),
    );
    final l = liveBriefingFrom(d);
    expect((l.approvals, l.mails, l.mentions, l.notices), (2, 1, 1, 0));
    expect(l.countsLine, '결재 2 · Teams 1 · 메일 1'); // 오늘 일정을 못 받았으면 일정 항목 없음
  });

  test('못 받은 소스는 직전 값을 유지한다(백그라운드는 Teams를 수집하지 않음)', () {
    final prev = LiveBriefing(meetings: [LiveItem('주간회의', start: DateTime.utc(2026, 10, 5, 1))], meetingCount: 1, mailItems: const [LiveItem('견적', sub: '박지훈')], approvals: 1, mentions: 3, mails: 2);
    final l = liveBriefingFrom(data(approvals: [ap('a'), ap('b')]), prev: prev);
    expect((l.approvals, l.mentions, l.mails, l.meetingCount), (2, 3, 2, 1));
    expect(l.meetingTitle, '주간회의');
    expect(l.mailItems.single.title, '견적');
    expect(l.approvalItems.map((a) => a.title), ['a', 'b']);
  });

  test('변경 알림 — 늘어난 항목만, 첫 표시·감소는 알리지 않는다', () {
    const a = LiveBriefing(approvals: 1, mails: 3);
    expect(liveAlert(null, a), isNull);
    expect(liveAlert(a, const LiveBriefing(approvals: 1, mails: 1)), isNull);
    expect(liveAlert(a, const LiveBriefing(approvals: 2, mails: 5, notices: 1)), '결재 1건, 메일 2통, 공지 1건 새로 도착');
  });

  test('JSON 왕복', () {
    final l = LiveBriefing(meetings: [LiveItem('회의', start: DateTime.utc(2026, 10, 5, 1))], meetingCount: 2, approvalItems: const [LiveItem('출장비', sub: '이서연')], approvals: 2, notices: 1);
    final r = LiveBriefing.fromJson(l.toJson())!;
    expect((r.meetingTitle, r.meetingStart, r.meetingEnd, r.meetingCount, r.approvals, r.notices), ('회의', l.meetingStart, null, 2, 2, 1));
    expect((r.approvalItems.single.title, r.approvalItems.single.sub), ('출장비', '이서연'));
    expect(LiveBriefing.fromJson('x'), isNull);
  });

  test('표시 기간 — 평일 07:00~18:30', () {
    expect(inLiveWindow(now), isTrue); // 월 08:40
    expect(inLiveWindow(DateTime.utc(2026, 10, 5, 6, 59)), isFalse);
    expect(inLiveWindow(DateTime.utc(2026, 10, 5, 18, 30)), isFalse);
    expect(inLiveWindow(DateTime.utc(2026, 10, 10, 9)), isFalse); // 토
  });
}
