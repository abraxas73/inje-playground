import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/app/brand.dart' show WidgetTitle;
import 'package:playground/app/theme.dart';
import 'package:playground/assistant/innobot_prefs.dart';
import 'package:playground/features/home/dashboard_view.dart';
import 'package:playground/features/home/home_dashboard.dart';
import 'package:playground/features/home/pinned_widgets.dart';
import 'package:playground/features/home/dashboard_style.dart';
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

  testWidgets('대시보드 타일 ⋮ 메뉴는 위젯 제목 바로 옆에(구석에 띄우면 위젯 자체 버튼을 가렸다), 제목 없는 위젯은 구석에', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1200, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(MaterialApp(theme: appTheme(), home: Scaffold(body: SingleChildScrollView(child: DashboardView(
      layout: const [DashboardTile('mails', 0, 0, 6, 3), DashboardTile('quick', 6, 0, 6, 3)],
      widgets: {
        'mails': DashboardWidgetDef('메일', Column(children: [Row(children: [const WidgetTitle('메일'), const Spacer(), TextButton(onPressed: () {}, child: const Text('더 보기'))]), const Text('메일 내용')])),
        'quick': DashboardWidgetDef('바로 가기', const Text('격자')),
      },
      editing: false,
      onChanged: (_) {},
      onPin: (_, _) {},
      isPinned: (_) => false,
    )))));
    await tester.pumpAndSettle();
    final mouse = await tester.createGesture(kind: PointerDeviceKind.mouse);
    await mouse.addPointer(location: tester.getCenter(find.text('메일 내용')));
    await tester.pumpAndSettle();
    final btn = find.byTooltip('위젯 옵션');
    expect(btn, findsOneWidget);
    expect(find.descendant(of: find.byType(WidgetTitle), matching: btn), findsOneWidget); // 제목 줄 안
    expect(tester.getCenter(btn).dx, lessThan(tester.getCenter(find.text('더 보기')).dx)); // '더 보기'를 가리지 않음
    await mouse.moveTo(tester.getCenter(find.text('격자')));
    await tester.pumpAndSettle();
    expect(find.descendant(of: find.byType(WidgetTitle), matching: find.byTooltip('위젯 옵션')), findsNothing); // 제목 없는 위젯은 구석
    expect(find.byTooltip('위젯 옵션'), findsOneWidget);
  });

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

  testWidgets('⋮ 메뉴 배경색: 고르면 onBg(번호), 위젯 영역은 테두리·바탕으로 보인다', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1200, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    (String, int?)? got;
    await tester.pumpWidget(MaterialApp(theme: appTheme(), home: Scaffold(body: SingleChildScrollView(child: DashboardView(
      layout: const [DashboardTile('mails', 0, 0, 6, 3)],
      widgets: {'mails': DashboardWidgetDef('메일', const Text('메일 내용'))},
      editing: false,
      onChanged: (_) {},
      onPin: (_, _) {},
      isPinned: (_) => false,
      bgOf: (_) => 1,
      onBg: (id, i) => got = (id, i),
    )))));
    await tester.pumpAndSettle();
    final box = tester.widget<Container>(find.ancestor(of: find.text('메일 내용'), matching: find.byType(Container)).first);
    expect((box.decoration as BoxDecoration).color, widgetBgChoices[1].$2); // 민트 바탕
    expect(Theme.of(tester.element(find.text('메일 내용'))).cardTheme.color, Colors.transparent); // 안쪽 카드는 투명 → 바탕색이 보인다
    final mouse = await tester.createGesture(kind: PointerDeviceKind.mouse);
    await mouse.addPointer(location: tester.getCenter(find.text('메일 내용')));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('위젯 옵션'));
    await tester.pumpAndSettle();
    expect(find.text('배경색'), findsOneWidget);
    await tester.tap(find.text('레몬'));
    await tester.pumpAndSettle();
    expect(got, ('mails', 4));
  });

  test('배경색은 계정별로 저장되고 기본으로 되돌릴 수 있다', () async {
    final c = ProviderContainer(overrides: [pinnedAccountProvider.overrideWithValue('a@innogrid.com')]);
    addTearDown(c.dispose);
    c.read(widgetBgProvider.notifier).set('mails', 2);
    await Future<void>.delayed(Duration.zero);
    expect((await SharedPreferences.getInstance()).getString('dashboard.bg.a@innogrid.com'), contains('"mails":2'));
    c.read(widgetBgProvider.notifier).set('mails', null);
    expect(c.read(widgetBgProvider), isEmpty);
  });
}
