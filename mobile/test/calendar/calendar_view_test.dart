import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/calendar/calendar_model.dart';
import 'package:playground/calendar/calendar_view.dart';

final today = DateTime.utc(2026, 10, 11); // 일요일
CalEvent ev(String t, DateTime s, DateTime e, {CalSource source = CalSource.gw, bool allDay = false, bool mine = true}) =>
    CalEvent(start: s, end: e, allDay: allDay, title: t, sub: source == CalSource.gw ? '이노그리드' : '', source: source, mine: mine);
final events = [
  ev('월요 회의', DateTime.utc(2026, 10, 12, 10), DateTime.utc(2026, 10, 12, 11)),
  ev('기기 회의', DateTime.utc(2026, 10, 12, 14), DateTime.utc(2026, 10, 12, 15), source: CalSource.dooray),
  ev('수요 점검', DateTime.utc(2026, 10, 14, 9), DateTime.utc(2026, 10, 14, 10)),
  ev('다음 주', DateTime.utc(2026, 10, 20, 9), DateTime.utc(2026, 10, 20, 10)),
];

class _Host extends StatefulWidget {
  const _Host({required this.mode, required this.day, this.events = const [], this.loading = false, this.error, this.width = 390, this.actions = const [], this.onMode, this.onDay, this.onPickDay});
  final CalMode mode;
  final DateTime day;
  final List<CalEvent> events;
  final bool loading;
  final String? error;
  final double width;
  final List<Widget> actions;
  final ValueChanged<CalMode>? onMode;
  final ValueChanged<DateTime>? onDay, onPickDay;
  @override
  State<_Host> createState() => _HostState();
}

class _HostState extends State<_Host> {
  @override
  Widget build(BuildContext context) => MaterialApp(
        home: Scaffold(
          body: Center(
            child: SizedBox(
              width: widget.width,
              child: ListView(children: [
                CalendarView(mode: widget.mode, day: widget.day, today: today, events: widget.events, loading: widget.loading, error: widget.error, actions: widget.actions, onMode: widget.onMode ?? (_) {}, onDay: widget.onDay ?? (_) {}, onPickDay: widget.onPickDay ?? (_) {}),
              ]),
            ),
          ),
        ),
      );
}

void main() {
  testWidgets('일간: 그날 일정만 시간·출처와 함께, 이전·다음 날·오늘 버튼', (tester) async {
    final days = <DateTime>[];
    await tester.pumpWidget(_Host(mode: CalMode.day, day: DateTime.utc(2026, 10, 12), events: events, onDay: days.add));
    expect(find.text('10월 12일 (월)'), findsOneWidget);
    expect(find.text('월요 회의'), findsOneWidget);
    expect(find.text('10:00–11:00'), findsOneWidget);
    expect(find.text('기기 회의'), findsOneWidget);
    expect(find.text('Dooray'), findsOneWidget); // 출처 표시(보조 문구가 아니라 꼬리표)
    expect(find.text('수요 점검'), findsNothing);
    expect(find.text('일정 2'), findsOneWidget);
    await tester.tap(find.byTooltip('이전 날'));
    await tester.tap(find.widgetWithText(TextButton, '오늘'));
    expect(days, [DateTime.utc(2026, 10, 11), today]);
  });
  testWidgets('일간: 일정이 없으면 안내, 오늘이면 오늘 버튼 없음, 보기 전환 콜백', (tester) async {
    final modes = <CalMode>[];
    await tester.pumpWidget(_Host(mode: CalMode.day, day: today, onMode: modes.add));
    expect(find.text('일정이 없습니다'), findsOneWidget);
    expect(find.widgetWithText(TextButton, '오늘'), findsNothing);
    await tester.tap(find.text('주간'));
    await tester.tap(find.text('월간'));
    expect(modes, [CalMode.week, CalMode.month]);
  });
  testWidgets('주간: 월~일 7일 머리글 아래 그날 일정, 없는 날은 "일정 없음", 이전·다음 주', (tester) async {
    final days = <DateTime>[];
    await tester.pumpWidget(_Host(mode: CalMode.week, day: DateTime.utc(2026, 10, 14), events: events, onDay: days.add));
    expect(find.text('10월 12일 – 18일'), findsOneWidget);
    for (final h in ['12일 (월)', '13일 (화)', '14일 (수)', '18일 (일)']) {
      expect(find.text(h), findsOneWidget);
    }
    expect(find.text('월요 회의'), findsOneWidget);
    expect(find.text('수요 점검'), findsOneWidget);
    expect(find.text('다음 주'), findsNothing);
    expect(find.text('일정 없음'), findsNWidgets(5)); // 화·목·금·토·일
    expect(find.text('일정 3'), findsOneWidget);
    await tester.tap(find.byTooltip('다음 주'));
    expect(days, [DateTime.utc(2026, 10, 21)]);
  });
  testWidgets('주간 넓은 폭: 월 | 화 | … | 일 7칸 열, 일정을 누르면 아래로 펼침', (tester) async {
    tester.view.physicalSize = const Size(1200, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(_Host(mode: CalMode.week, day: DateTime.utc(2026, 10, 14), events: events, width: 1000));
    for (var i = 0; i < 7; i++) {
      expect(find.byKey(ValueKey('cal-week-col-$i')), findsOneWidget);
    }
    final mon = tester.getCenter(find.text('12일 (월)')), sun = tester.getCenter(find.text('18일 (일)'));
    expect(mon.dy, sun.dy); // 한 줄에 나란히
    expect(mon.dx < sun.dx, isTrue);
    expect(find.descendant(of: find.byKey(const ValueKey('cal-week-col-0')), matching: find.text('월요 회의')), findsOneWidget);
    expect(find.descendant(of: find.byKey(const ValueKey('cal-week-col-2')), matching: find.text('수요 점검')), findsOneWidget);
    await tester.tap(find.text('수요 점검'));
    await tester.pumpAndSettle();
    expect(find.text('일시'), findsOneWidget); // 아래로 펼침(창 아님)
    expect(find.byType(AlertDialog), findsNothing);
    expect(find.descendant(of: find.byKey(const ValueKey('cal-week-col-2')), matching: find.text('일시')), findsOneWidget);
    await tester.tap(find.text('수요 점검'));
    await tester.pumpAndSettle();
    expect(find.text('일시'), findsNothing);
  });
  testWidgets('오늘 버튼은 날짜 바로 옆(다음 버튼보다 왼쪽)', (tester) async {
    await tester.pumpWidget(_Host(mode: CalMode.day, day: DateTime.utc(2026, 10, 14)));
    final label = tester.getRect(find.text('10월 14일 (수)')), todayBtn = tester.getRect(find.widgetWithText(TextButton, '오늘')), next = tester.getRect(find.byTooltip('다음 날'));
    expect(todayBtn.left >= label.right, isTrue);
    expect(todayBtn.right <= next.left, isTrue);
  });
  testWidgets('월간: 6주 격자(앞뒤 달 포함), 날짜를 누르면 onPickDay, 폰 폭은 점·넓은 폭은 제목', (tester) async {
    final picked = <DateTime>[];
    await tester.pumpWidget(_Host(mode: CalMode.month, day: DateTime.utc(2026, 10, 11), events: events, onPickDay: picked.add));
    expect(find.text('2026년 10월'), findsOneWidget);
    expect(find.text('28'), findsNWidgets(2)); // 9/28, 10/28
    expect(find.text('8'), findsNWidgets(2)); // 10/8, 11/8
    expect(find.text('9'), findsNWidgets(1)); // 11/9는 격자 밖(42일)
    expect(find.text('월요 회의'), findsNothing); // 폰 폭: 점만
    expect(find.byWidgetPredicate((w) => w.key is ValueKey && '${(w.key as ValueKey).value}'.startsWith('cal-dot-2026-10-12')), findsNWidgets(2));
    await tester.tap(find.byKey(const ValueKey('cal-cell-2026-10-15')));
    expect(picked, [DateTime.utc(2026, 10, 15)]);
    expect(find.byTooltip('이전 달'), findsOneWidget);
    tester.view.physicalSize = const Size(1200, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(_Host(mode: CalMode.month, day: DateTime.utc(2026, 10, 11), events: events, width: 1000));
    expect(find.text('월요 회의'), findsOneWidget);
    expect(find.text('기기 회의'), findsOneWidget);
  });
  testWidgets('불러오는 중·오류 표시, 머리글 오른쪽에 추가 버튼 같은 동작을 둘 수 있다', (tester) async {
    await tester.pumpWidget(_Host(mode: CalMode.day, day: today, loading: true, actions: const [Text('추가')]));
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.text('추가'), findsOneWidget);
    await tester.pumpWidget(_Host(mode: CalMode.week, day: today, error: '세션이 끊겼습니다'));
    expect(find.text('세션이 끊겼습니다'), findsOneWidget);
  });

  testWidgets('일정을 누르면 아코디언으로 상세(일시·캘린더·장소·참석자·내용)가 펼쳐지고, 다시 누르면 접힌다', (tester) async {
    final detailed = CalEvent(start: DateTime.utc(2026, 10, 12, 10), end: DateTime.utc(2026, 10, 12, 11), allDay: false, title: '월요 회의', sub: '이노그리드', source: CalSource.gw,
        details: const [('캘린더', '이노그리드'), ('장소', '3층 회의실'), ('참석자', '강승욱, 김민준'), ('내용', '안건 1\n안건 2')]);
    await tester.pumpWidget(_Host(mode: CalMode.day, day: DateTime.utc(2026, 10, 12), events: [detailed, ev('기기 회의', DateTime.utc(2026, 10, 12, 14), DateTime.utc(2026, 10, 12, 15), source: CalSource.dooray)]));
    expect(find.text('3층 회의실'), findsNothing);
    await tester.tap(find.text('월요 회의'));
    await tester.pumpAndSettle();
    expect(find.text('10월 12일 (월) 10:00–11:00'), findsOneWidget);
    expect(find.text('3층 회의실'), findsOneWidget);
    expect(find.text('강승욱, 김민준'), findsOneWidget);
    expect(find.text('안건 1\n안건 2'), findsOneWidget);
    await tester.tap(find.text('월요 회의'));
    await tester.pumpAndSettle();
    expect(find.text('3층 회의실'), findsNothing);
  });
}
