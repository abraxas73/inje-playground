import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/app/theme.dart';
import 'package:playground/assistant/innobot_prefs.dart';
import 'package:playground/features/home/dashboard_view.dart';
import 'package:playground/features/home/home_dashboard.dart';
import 'package:playground/features/home/pinned_widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('clampPinned: 화면 밖 위치·너무 작은 크기를 앱 영역 안으로', () {
    final (p, s) = clampPinned(const Offset(100000, -50), const Size(10, 10), const Size(1200, 800));
    expect(s, pinnedMinSize);
    expect(p.dx, lessThanOrEqualTo(1200 - s.width));
    expect(p.dy, greaterThanOrEqualTo(0));
  });

  testWidgets('Always On 창: 모든 화면 위에 떠서 홈 위젯 내용을 그리고, X로 끈다(기기에 기억)', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1200, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final container = ProviderContainer(overrides: [innobotSignedInProvider.overrideWithValue(true), pinnedAccountProvider.overrideWithValue('a@innogrid.com')]);
    addTearDown(container.dispose);
    container.read(dashboardDefsProvider.notifier).publish({'mails': DashboardWidgetDef('메일', const Text('메일 내용'))});
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp(theme: appTheme(), builder: (c, child) => Stack(children: [child!, const Positioned.fill(child: PinnedWidgetsHost())]), home: const Scaffold(body: Text('다른 화면'))),
    ));
    await tester.pumpAndSettle();
    expect(find.text('메일 내용'), findsNothing);
    container.read(pinnedWidgetsProvider.notifier).pin('mails', const Size(400, 300));
    await tester.pumpAndSettle();
    expect(find.text('다른 화면'), findsOneWidget);
    expect(find.text('메일 내용'), findsOneWidget); // 다른 화면 위에 떠 있음
    expect((await SharedPreferences.getInstance()).getString('dashboard.pinned.a@innogrid.com'), contains('mails'));
    // 머리줄을 끌면 옮겨진다
    final before = tester.getTopLeft(find.text('메일 내용'));
    await tester.drag(find.text('메일'), const Offset(-200, 100));
    await tester.pumpAndSettle();
    expect(tester.getTopLeft(find.text('메일 내용')).dx, lessThan(before.dx - 150));
    await tester.tap(find.byIcon(Icons.close));
    await tester.pumpAndSettle();
    expect(find.text('메일 내용'), findsNothing);
    expect((await SharedPreferences.getInstance()).getString('dashboard.pinned.a@innogrid.com'), '[]');
  }, variant: TargetPlatformVariant.only(TargetPlatform.macOS));

  testWidgets('대시보드 타일 ⋮ 메뉴: 마우스를 올리면 보이고 Always On을 고르면 onPin(타일 크기)', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1200, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    String? pinned;
    Size? size;
    await tester.pumpWidget(MaterialApp(theme: appTheme(), home: Scaffold(body: SingleChildScrollView(child: DashboardView(
      layout: const [DashboardTile('mails', 0, 0, 6, 3)],
      widgets: {'mails': DashboardWidgetDef('메일', const Text('메일 내용'))},
      editing: false,
      onChanged: (_) {},
      onPin: (id, s) { pinned = id; size = s; },
      isPinned: (_) => false,
    )))));
    await tester.pumpAndSettle();
    expect(find.byTooltip('위젯 옵션'), findsNothing); // 평소엔 숨김
    final mouse = await tester.createGesture(kind: PointerDeviceKind.mouse);
    await mouse.addPointer(location: tester.getCenter(find.text('메일 내용')));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('위젯 옵션'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Always On'));
    await tester.pumpAndSettle();
    expect(pinned, 'mails');
    expect(size!.width, greaterThan(500));
  });

  test('계정이 바뀌면 이전 계정의 위젯 정의를 버리고 고정 목록도 그 계정 것만', () async {
    SharedPreferences.setMockInitialValues({'dashboard.pinned.b@innogrid.com': '[{"id":"teams","x":10,"y":10,"w":300,"h":200}]'});
    final c = ProviderContainer(overrides: [pinnedAccountProvider.overrideWithValue('a@innogrid.com')]);
    addTearDown(c.dispose);
    c.read(dashboardDefsProvider.notifier).publish({'mails': DashboardWidgetDef('메일', const Text('x'))});
    c.read(pinnedWidgetsProvider.notifier).pin('mails', const Size(300, 200));
    expect(c.read(pinnedWidgetsProvider).map((t) => t.id), ['mails']);
    c.updateOverrides([pinnedAccountProvider.overrideWithValue('b@innogrid.com')]);
    expect(c.read(dashboardDefsProvider), isEmpty);
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);
    expect(c.read(pinnedWidgetsProvider).map((t) => t.id), ['teams']);
  });
}
