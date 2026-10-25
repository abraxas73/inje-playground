import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/app/theme.dart';
import 'package:playground/features/home/home_dashboard.dart';
import 'package:playground/features/home/dashboard_view.dart';

Widget _box(String s) => Container(color: const Color(0xFFEEEEEE), child: Text(s));

Future<void> _pump(WidgetTester tester, {required bool editing, required List<DashboardTile> layout, required void Function(List<DashboardTile>) onChanged}) async {
  final widgets = {
    'briefing': DashboardWidgetDef('브리핑', _box('briefing')),
    'mails': DashboardWidgetDef('메일', _box('mails')),
    'teams': DashboardWidgetDef('Teams', _box('teams'), defaultW: 6, defaultH: 3),
  };
  await tester.binding.setSurfaceSize(const Size(1200, 900));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(MaterialApp(
    theme: appTheme(),
    home: Scaffold(body: SingleChildScrollView(child: DashboardView(
      layout: layout,
      widgets: widgets,
      editing: editing,
      onChanged: onChanged,
    ))),
  ));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('뷰 모드: 배치된 위젯만 그리고 편집 조작(손잡이·삭제·팔레트)은 없다', (tester) async {
    await _pump(tester, editing: false,
      layout: const [DashboardTile('briefing', 0, 0, 8, 4), DashboardTile('mails', 8, 0, 4, 3)],
      onChanged: (_) {});
    expect(find.text('briefing'), findsOneWidget);
    expect(find.text('mails'), findsOneWidget);
    expect(find.text('Teams'), findsNothing); // 배치 안 됨
    expect(find.text('추가할 위젯'), findsNothing); // 편집 아닐 땐 팔레트 없음
    expect(find.byIcon(Icons.drag_indicator), findsNothing);
  });

  testWidgets('편집 모드: ✕로 삭제하면 그 타일이 빠진다(배치는 그대로)', (tester) async {
    List<DashboardTile>? out;
    await _pump(tester, editing: true,
      layout: const [DashboardTile('briefing', 0, 0, 8, 4), DashboardTile('mails', 8, 0, 4, 3)],
      onChanged: (t) => out = t);
    await tester.tap(find.byIcon(Icons.close).first);
    await tester.pumpAndSettle();
    expect(out, isNotNull);
    expect(out!.any((t) => t.id == 'briefing'), isFalse);
    // 남은 타일은 위치 그대로
    final mails = out!.firstWhere((t) => t.id == 'mails');
    expect((mails.x, mails.y, mails.w, mails.h), (8, 0, 4, 3));
  });

  testWidgets('팔레트: 배치 안 된 위젯을 칩으로 보여 주고 누르면 맨 아래에 추가', (tester) async {
    final widgets = {
      'briefing': DashboardWidgetDef('브리핑', _box('briefing')),
      'mails': DashboardWidgetDef('메일', _box('mails')),
      'teams': DashboardWidgetDef('Teams', _box('teams')),
    };
    const layout = [DashboardTile('briefing', 0, 0, 8, 4)];
    List<DashboardTile>? added;
    await tester.pumpWidget(MaterialApp(theme: appTheme(), home: Scaffold(body: DashboardPalette(
      widgets: widgets,
      layout: layout,
      onDone: () {},
      onAdd: (id) {
        final maxY = layout.fold<int>(0, (m, t) => t.y + t.h > m ? t.y + t.h : m);
        added = [...layout, DashboardTile(id, 0, maxY, widgets[id]!.defaultW, widgets[id]!.defaultH)];
      },
    ))));
    await tester.pumpAndSettle();
    // briefing은 이미 배치됨 → 메일·Teams만 팔레트에
    expect(find.widgetWithText(ActionChip, '메일'), findsOneWidget);
    expect(find.widgetWithText(ActionChip, 'Teams'), findsOneWidget);
    expect(find.widgetWithText(ActionChip, '브리핑'), findsNothing);

    await tester.tap(find.widgetWithText(ActionChip, '메일'));
    await tester.pumpAndSettle();
    expect(added, isNotNull);
    expect(added!.map((t) => t.id), containsAll(['briefing', 'mails']));
    expect(added!.firstWhere((t) => t.id == 'mails').y, 4); // briefing(h4) 아래
  });

  test('겹침 해소: 옮긴 타일은 그 자리, 겹친 타일만 아래로 — 나머지는 그대로', () {
    // mails를 briefing 자리(0,0)로 옮김 → briefing만 아래로, 겹치지 않는 teams는 그대로
    final out = resolveCollisions(const [
      DashboardTile('briefing', 0, 0, 6, 3),
      DashboardTile('teams', 6, 0, 6, 3),
      DashboardTile('mails', 0, 0, 6, 2),
    ], pinned: 'mails');
    final by = {for (final t in out) t.id: t};
    expect((by['mails']!.x, by['mails']!.y), (0, 0));
    expect(by['briefing']!.y, 2);
    expect((by['teams']!.x, by['teams']!.y), (6, 0));
  });

  test('자동 배열: 칼럼·크기 유지, 빈 줄 없이 위로 끌어올림', () {
    final out = autoArrange(const [
      DashboardTile('a', 0, 3, 6, 2),
      DashboardTile('b', 6, 10, 6, 3),
      DashboardTile('c', 0, 9, 12, 2),
    ]);
    final by = {for (final t in out) t.id: t};
    expect((by['a']!.x, by['a']!.y, by['a']!.w, by['a']!.h), (0, 0, 6, 2));
    expect(by['c']!.y, 2); // a 아래
    expect(by['b']!.y, 4); // c(전체 폭) 아래
  });

  testWidgets('툴바: 자동 배열 버튼과 머리줄 끌기', (tester) async {
    var arranged = 0;
    Offset moved = Offset.zero;
    await tester.pumpWidget(MaterialApp(theme: appTheme(), home: Scaffold(body: Center(child: DashboardPalette(
      widgets: {'a': DashboardWidgetDef('A', _box('a'))},
      layout: const [],
      onAdd: (_) {},
      onDone: () {},
      onArrange: () => arranged++,
      onDrag: (d) => moved += d,
    )))));
    await tester.tap(find.text('자동 배열'));
    expect(arranged, 1);
    await tester.drag(find.text('위젯 추가'), const Offset(-60, -40));
    expect(moved.dx, lessThan(0));
    expect(moved.dy, lessThan(0));
  });

  testWidgets('편집 모드: 끄는 동안 놓을 자리 점선 안내, 놓으면 그 칸에 배치', (tester) async {
    List<DashboardTile>? out;
    await _pump(tester, editing: true,
      layout: const [DashboardTile('briefing', 0, 0, 6, 3), DashboardTile('mails', 6, 0, 6, 3)],
      onChanged: (t) => out = t);
    // 1200폭 → 칸 폭 = (1200+12)/12 = 101. 브리핑 손잡이를 오른쪽 6칸·아래 3줄만큼 끈다(mails 바로 아래).
    final g = await tester.startGesture(tester.getCenter(find.text('브리핑')));
    await g.moveBy(const Offset(20, 0)); // 끌기 시작 판정
    await g.moveBy(const Offset(606 - 20, 3 * 84));
    await tester.pump();
    final guide = find.byWidgetPredicate((w) => w is CustomPaint && w.painter.runtimeType.toString() == '_DashedRectPainter');
    expect(guide, findsOneWidget);
    await g.up();
    await tester.pumpAndSettle();
    expect(guide, findsNothing);
    final b = out!.firstWhere((t) => t.id == 'briefing');
    expect((b.x, b.y), (6, 3));
    final m = out!.firstWhere((t) => t.id == 'mails');
    expect((m.x, m.y), (6, 0)); // 안 겹친 타일은 그대로
  });

  testWidgets('편집해도 지금 안 보이는 타일(정의 없음)은 배치에 그대로 남는다', (tester) async {
    List<DashboardTile>? out;
    await _pump(tester, editing: true,
      layout: const [DashboardTile('briefing', 0, 0, 6, 3), DashboardTile('mails', 6, 0, 6, 3), DashboardTile('services', 0, 3, 12, 3)],
      onChanged: (t) => out = t);
    await tester.tap(find.byIcon(Icons.close).first); // briefing 삭제
    await tester.pumpAndSettle();
    final s = out!.firstWhere((t) => t.id == 'services');
    expect((s.x, s.y, s.w, s.h), (0, 3, 12, 3));
  });

  testWidgets('아래로 멀리 끌어 놓아도 다른 타일 바로 아래까지만', (tester) async {
    List<DashboardTile>? out;
    await _pump(tester, editing: true,
      layout: const [DashboardTile('briefing', 0, 0, 6, 3), DashboardTile('mails', 6, 0, 6, 3)],
      onChanged: (t) => out = t);
    final g = await tester.startGesture(tester.getCenter(find.text('브리핑')));
    await g.moveBy(const Offset(0, 20));
    await g.moveBy(const Offset(0, 3000));
    await g.up();
    await tester.pumpAndSettle();
    expect(out!.firstWhere((t) => t.id == 'briefing').y, 3); // mails(h3) 바로 아래
  });

  testWidgets('끌기가 취소되면 안내선·이동 상태가 풀린다', (tester) async {
    await _pump(tester, editing: true,
      layout: const [DashboardTile('briefing', 0, 0, 6, 3)],
      onChanged: (_) {});
    final g = await tester.startGesture(tester.getCenter(find.text('브리핑')));
    await g.moveBy(const Offset(40, 40));
    await tester.pump();
    final guide = find.byWidgetPredicate((w) => w is CustomPaint && w.painter.runtimeType.toString() == '_DashedRectPainter');
    expect(guide, findsOneWidget);
    await g.cancel();
    await tester.pump();
    expect(guide, findsNothing);
  });

  test('자동 배열: visible만 배열하고 안 보이는 타일은 그대로', () {
    final out = autoArrange(const [DashboardTile('a', 0, 5, 6, 2), DashboardTile('hidden', 0, 0, 12, 4)], visible: {'a'});
    final by = {for (final t in out) t.id: t};
    expect(by['a']!.y, 0);
    expect((by['hidden']!.y, by['hidden']!.h), (0, 4));
  });
  testWidgets('빈 위젯 자리에도 제목 줄 오른쪽 링크(메일 → 메일 목록), 링크가 없으면 제목만', (tester) async {
    var opened = 0;
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: SizedBox(width: 500, height: 260, child: DashboardPlaceholder(title: '메일', message: '안 읽은 메일이 없습니다', onMore: () => opened++, moreLabel: '메일')))));
    await tester.tap(find.widgetWithText(TextButton, '메일'));
    expect(opened, 1);
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: SizedBox(width: 500, height: 260, child: DashboardPlaceholder(title: '메일', message: '아마란스에 연결하면 표시됩니다')))));
    expect(find.byType(TextButton), findsNothing);
  });
}
