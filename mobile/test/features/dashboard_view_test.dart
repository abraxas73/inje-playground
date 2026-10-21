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
}
