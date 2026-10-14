// 일정 캘린더(일간·주간·월간) 순수 모델 — 위젯·네트워크 없음. 아마란스(GwEvent)와 Dooray(브리지 items)를 한 모양(CalEvent)으로 맞춘다.
// 시각은 모두 "KST 벽시계 + UTC 플래그"(DateTime.utc, gw_models.dart kstOf와 같은 약속) — 기기 시간대·DST와 무관하게 날짜 산술이 맞는다.
import '../gw/gw_models.dart';

enum CalMode { day, week, month }

enum CalSource { gw, dooray }

class CalEvent {
  const CalEvent({required this.start, required this.end, required this.allDay, required this.title, this.sub = '', required this.source, this.mine = true});
  final DateTime start, end;
  final bool allDay, mine;
  final String title, sub;
  final CalSource source;

  /// [day](00:00~24:00)에 걸치는가. end가 start 이전·같은 행(종일 하루 등)은 start 하루로 본다. 다음 날 00:00에 끝나는 일정은 다음 날에 없다.
  bool on(DateTime day) {
    final d0 = DateTime.utc(day.year, day.month, day.day), d1 = d0.add(const Duration(days: 1));
    final e = end.isAfter(start) ? end : start.add(const Duration(minutes: 1));
    return start.isBefore(d1) && e.isAfter(d0);
  }

  String get timeLabel => allDay ? '종일' : '${_hm(start)}–${_hm(end)}';
}

String _hm(DateTime t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

/// [mode]에서 [day]가 속한 보기 범위(시작 포함, 끝 제외). 주는 월요일부터 7일, 달은 1일이 든 주의 월요일부터 6주(42일, 격자 고정).
(DateTime, DateTime) calRange(CalMode mode, DateTime day) {
  final d0 = DateTime.utc(day.year, day.month, day.day);
  switch (mode) {
    case CalMode.day:
      return (d0, d0.add(const Duration(days: 1)));
    case CalMode.week:
      final s = d0.subtract(Duration(days: d0.weekday - 1));
      return (s, s.add(const Duration(days: 7)));
    case CalMode.month:
      final first = DateTime.utc(d0.year, d0.month, 1);
      final s = first.subtract(Duration(days: first.weekday - 1));
      return (s, s.add(const Duration(days: 42)));
  }
}

/// 이전(-1)·다음(+1) 보기의 날짜 — 일간 ±1일, 주간 ±7일, 월간 ±1달(같은 '일'을 유지하되 말일을 넘지 않음).
DateTime calStep(CalMode mode, DateTime day, int dir) {
  final d0 = DateTime.utc(day.year, day.month, day.day);
  switch (mode) {
    case CalMode.day:
      return d0.add(Duration(days: dir));
    case CalMode.week:
      return d0.add(Duration(days: 7 * dir));
    case CalMode.month:
      final m = DateTime.utc(d0.year, d0.month + dir, 1);
      final last = DateTime.utc(m.year, m.month + 1, 0).day;
      return DateTime.utc(m.year, m.month, d0.day.clamp(1, last));
  }
}

const calWeekdays = ['월', '화', '수', '목', '금', '토', '일'];

/// 머리글 — 일간 "10월 11일 (일)", 주간 "10월 5일 – 11일"(달이 바뀌면 "10월 26일 – 11월 1일"), 월간 "2026년 10월".
String calLabel(CalMode mode, DateTime day) {
  switch (mode) {
    case CalMode.day:
      return '${day.month}월 ${day.day}일 (${calWeekdays[day.weekday - 1]})';
    case CalMode.week:
      final (s, e1) = calRange(mode, day);
      final e = e1.subtract(const Duration(days: 1));
      return '${s.month}월 ${s.day}일 – ${s.month == e.month ? '' : '${e.month}월 '}${e.day}일';
    case CalMode.month:
      return '${day.year}년 ${day.month}월';
  }
}

/// [day]의 일정 — 종일이 먼저, 그다음 시작 시각순.
List<CalEvent> calOn(List<CalEvent> events, DateTime day) => [for (final e in events) if (e.on(day)) e]
  ..sort((a, b) => a.allDay != b.allDay ? (a.allDay ? -1 : 1) : a.start.compareTo(b.start));

/// 'YYYYMMDD[HHmm…]' → KST 벽시계. 숫자가 8자리 미만이면 null.
DateTime? _gwTime(String s) {
  final d = s.replaceAll(RegExp(r'\D'), '');
  if (d.length < 8) return null;
  int at(int a, int b) => int.parse(d.substring(a, b));
  return DateTime.utc(at(0, 4), at(4, 6), at(6, 8), d.length >= 12 ? at(8, 10) : 0, d.length >= 12 ? at(10, 12) : 0);
}

CalEvent? calFromGw(GwEvent e) {
  final s = _gwTime(e.start);
  if (s == null) return null;
  return CalEvent(
    start: s, end: _gwTime(e.end) ?? s, allDay: e.allDay, title: e.title, source: CalSource.gw, mine: e.mine,
    sub: [e.calendar, if (e.place.isNotEmpty) e.place, if (!e.mine && e.createName.isNotEmpty) e.createName].where((x) => x.isNotEmpty).join(' · '),
  );
}

/// ISO 시각(시간대 포함) → KST 벽시계. 종일 일정은 '2026-03-01+09:00'(날짜+시간대, 시각 없음)로 오는데 DateTime.parse가 못 읽으므로 날짜만 읽는다.
DateTime? _kst(dynamic raw) {
  if (raw is! String) return null;
  final dateOnly = RegExp(r'^(\d{4}-\d{2}-\d{2})(?:Z|[+-]\d{2}:?\d{2})?$').firstMatch(raw);
  if (dateOnly != null) {
    final d = DateTime.tryParse(dateOnly[1]!);
    return d == null ? null : DateTime.utc(d.year, d.month, d.day);
  }
  final d = DateTime.tryParse(raw);
  if (d == null) return null;
  final k = d.toUtc().add(const Duration(hours: 9));
  return DateTime.utc(k.year, k.month, k.day, k.hour, k.minute);
}

/// Dooray 브리지 items 행(calendar_bridge.dart) → CalEvent. 제목·시작이 없으면 null. 출처는 위젯이 꼬리표로 보여 주므로 sub는 비우되,
/// 남이 공유해 준 캘린더(owner 아님)는 mine=false·캘린더 이름을 sub에 단다.
CalEvent? calFromDooray(Map e) {
  final s = _kst(e['startedAt']);
  if (s == null || e['subject'] is! String) return null;
  final mine = e['owner'] != false;
  return CalEvent(start: s, end: _kst(e['endedAt']) ?? s, allDay: e['wholeDayFlag'] == true, title: e['subject'] as String, source: CalSource.dooray, mine: mine, sub: mine ? '' : (e['calendar'] is String ? e['calendar'] as String : ''));
}
