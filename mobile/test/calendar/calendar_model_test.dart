import 'package:flutter_test/flutter_test.dart';
import 'package:playground/calendar/calendar_model.dart';
import 'package:playground/gw/gw_models.dart';

void main() {
  final sun = DateTime.utc(2026, 10, 11); // 일요일
  test('calRange: 일간은 그날 하루, 주간은 월요일부터 7일, 월간은 1일이 든 주의 월요일부터 6주', () {
    expect(calRange(CalMode.day, sun), (DateTime.utc(2026, 10, 11), DateTime.utc(2026, 10, 12)));
    expect(calRange(CalMode.week, sun), (DateTime.utc(2026, 10, 5), DateTime.utc(2026, 10, 12)));
    expect(calRange(CalMode.month, sun), (DateTime.utc(2026, 9, 28), DateTime.utc(2026, 11, 9))); // 10/1 목 → 9/28 월부터 42일
    expect(calRange(CalMode.month, DateTime.utc(2026, 6, 15)), (DateTime.utc(2026, 6, 1), DateTime.utc(2026, 7, 13))); // 6/1 월
  });
  test('calStep: 일 ±1, 주 ±7, 달 ±1(말일을 넘지 않음)', () {
    expect(calStep(CalMode.day, sun, 1), DateTime.utc(2026, 10, 12));
    expect(calStep(CalMode.week, sun, -1), DateTime.utc(2026, 10, 4));
    expect(calStep(CalMode.month, DateTime.utc(2026, 1, 31), 1), DateTime.utc(2026, 2, 28));
    expect(calStep(CalMode.month, DateTime.utc(2026, 12, 15), 1), DateTime.utc(2027, 1, 15));
  });
  test('calLabel: 일간 "10월 11일 (일)", 주간 "10월 5일 – 11일"(달이 바뀌면 둘 다 표시), 월간 "2026년 10월"', () {
    expect(calLabel(CalMode.day, sun), '10월 11일 (일)');
    expect(calLabel(CalMode.week, sun), '10월 5일 – 11일');
    expect(calLabel(CalMode.week, DateTime.utc(2026, 10, 28)), '10월 26일 – 11월 1일');
    expect(calLabel(CalMode.month, sun), '2026년 10월');
  });
  test('calFromGw: 12자리 시각·종일(8자리)·내 것 여부·보조 문구', () {
    final e = calFromGw(const GwEvent(schSeq: '1', title: '내 회의', start: '202610121000', end: '202610121130', allDay: false, calendar: '이노그리드', mcalSeq: '2', mine: true, createName: '홍', place: '3층'))!;
    expect((e.start, e.end, e.allDay, e.mine, e.source), (DateTime.utc(2026, 10, 12, 10), DateTime.utc(2026, 10, 12, 11, 30), false, true, CalSource.gw));
    expect(e.sub, '이노그리드 · 3층');
    expect(e.timeLabel, '10:00–11:30');
    final a = calFromGw(const GwEvent(schSeq: '2', title: '휴가', start: '20261013', end: '20261014', allDay: true, calendar: '', mcalSeq: '2', mine: false, createName: '김', place: ''))!;
    expect((a.start, a.allDay, a.sub, a.timeLabel), (DateTime.utc(2026, 10, 13), true, '김', '종일'));
    expect(calFromGw(const GwEvent(schSeq: '3', title: 'x', start: '', end: '', allDay: false, calendar: '', mcalSeq: '', mine: true, createName: '', place: '')), isNull);
  });
  test('calFromDooray: UTC 시각을 한국 시각으로, 종일 플래그, 깨진 행은 null', () {
    final e = calFromDooray({'subject': '기기 회의', 'startedAt': '2026-10-12T01:00:00Z', 'endedAt': '2026-10-12T02:00:00Z', 'wholeDayFlag': false})!;
    expect((e.start, e.end, e.source, e.sub, e.timeLabel), (DateTime.utc(2026, 10, 12, 10), DateTime.utc(2026, 10, 12, 11), CalSource.dooray, '', '10:00–11:00'));
    final w = calFromDooray({'subject': '워크샵', 'startedAt': '2026-10-13T00:00:00+09:00', 'endedAt': '2026-10-14T00:00:00+09:00', 'wholeDayFlag': true})!;
    expect((w.start, w.allDay), (DateTime.utc(2026, 10, 13), true));
    expect(calFromDooray({'subject': 1, 'startedAt': 'x'}), isNull);
    // 종일 일정의 startedAt/endedAt은 '2026-03-01+09:00'(날짜+시간대, 시각 없음) — Dart 파서가 못 읽어 조용히 빠지던 모양. 끝은 다음 날(끝 제외).
    final d = calFromDooray({'subject': '[파견] 티켓링크', 'startedAt': '2026-03-01+09:00', 'endedAt': '2027-01-01+09:00', 'wholeDayFlag': true, 'calendar': '클라우드개발본부', 'owner': true})!;
    expect((d.start, d.end, d.allDay, d.mine, d.sub), (DateTime.utc(2026, 3, 1), DateTime.utc(2027, 1, 1), true, true, ''));
    expect((d.on(DateTime.utc(2026, 10, 14)), d.on(DateTime.utc(2027, 1, 1))), (true, false));
    // 남이 공유한 개인 캘린더(owner 아님)는 내 것이 아니고 캘린더 이름을 꼬리에 단다
    final sh = calFromDooray({'subject': '[외근] 기술미팅', 'startedAt': '2026-10-15+09:00', 'endedAt': '2026-10-16+09:00', 'wholeDayFlag': true, 'calendar': '임원일정', 'owner': false})!;
    expect((sh.mine, sh.sub), (false, '임원일정'));
  });
  test('on·calOn: 며칠에 걸친 일정은 그 날들마다, 다음 날 00:00에 끝나면 다음 날엔 없음, 종일이 먼저·시간순', () {
    CalEvent ev(String t, DateTime s, DateTime e, {bool allDay = false}) => CalEvent(start: s, end: e, allDay: allDay, title: t, source: CalSource.gw);
    final trip = ev('출장', DateTime.utc(2026, 10, 12, 9), DateTime.utc(2026, 10, 14, 18));
    final whole = ev('휴가', DateTime.utc(2026, 10, 13), DateTime.utc(2026, 10, 14), allDay: true);
    final morning = ev('회의', DateTime.utc(2026, 10, 13, 9), DateTime.utc(2026, 10, 13, 10));
    final zero = ev('메모', DateTime.utc(2026, 10, 13, 15), DateTime.utc(2026, 10, 13, 15));
    expect([for (final d in [11, 12, 13, 14, 15]) trip.on(DateTime.utc(2026, 10, d))], [false, true, true, true, false]);
    expect([whole.on(DateTime.utc(2026, 10, 13)), whole.on(DateTime.utc(2026, 10, 14))], [true, false]);
    expect(zero.on(DateTime.utc(2026, 10, 13)), true);
    expect(calOn([zero, morning, trip, whole], DateTime.utc(2026, 10, 13)).map((e) => e.title).toList(), ['휴가', '출장', '회의', '메모']);
  });
}
