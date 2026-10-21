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

  testWidgets('편집 모드: 삭제하면 그 타일이 빠지고, 팔레트에서 추가하면 맨 아래 붙는다', (tester) async {
    List<DashboardTile>? out;
    await _pump(tester, editing: true,
      layout: const [DashboardTile('briefing', 0, 0, 8, 4)],
      onChanged: (t) => out = t);
    // briefing만 배치됨 → 팔레트에 mails·teams
    expect(find.widgetWithText(ActionChip, '메일'), findsOneWidget);
    expect(find.widgetWithText(ActionChip, 'Teams'), findsOneWidget);

    // 추가
    await tester.tap(find.widgetWithText(ActionChip, '메일'));
    await tester.pumpAndSettle();
    expect(out, isNotNull);
    expect(out!.map((t) => t.id), containsAll(['briefing', 'mails']));
    final mails = out!.firstWhere((t) => t.id == 'mails');
    expect(mails.y, greaterThanOrEqualTo(4)); // briefing(h4) 아래에 놓인다

    // 삭제(✕)
    out = null;
    await tester.tap(find.byIcon(Icons.close).first);
    await tester.pumpAndSettle();
    expect(out, isNotNull);
    expect(out!.any((t) => t.id == 'briefing'), isFalse);
  });
}
