import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/app/copy_selection_area.dart';

void main() {
  late List<String> copied;
  setUp(() {
    copied = [];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') copied.add((call.arguments as Map)['text'] as String);
      if (call.method == 'Clipboard.hasStrings') return {'value': false};
      return null;
    });
  });

  Widget app() => const MaterialApp(home: Scaffold(body: CopySelectionArea(child: Center(child: Text('회의는 세 시입니다')))));

  testWidgets('데스크톱 — 끌어서 고르면 클립보드 아이콘이 뜨고, 누르면 복사·아이콘 닫힘', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.macOS;
    await tester.pumpWidget(app());
    final text = find.text('회의는 세 시입니다');
    final g = await tester.startGesture(tester.getTopLeft(text) + const Offset(1, 5), kind: PointerDeviceKind.mouse);
    await tester.pump();
    await g.moveTo(tester.getCenter(text));
    await tester.pump();
    await g.moveTo(tester.getTopRight(text) + const Offset(-1, 5));
    await tester.pump();
    await g.up();
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.content_paste_rounded), findsOneWidget);
    // 아이콘만 감싼 작은 단추가 선택 맨 뒤 글자 바로 옆, 같은 줄 높이에
    final chip = tester.getRect(find.ancestor(of: find.byIcon(Icons.content_paste_rounded), matching: find.byType(Material)).first);
    final line = tester.getRect(text);
    expect(chip.width, lessThanOrEqualTo(30));
    expect(chip.left, inInclusiveRange(line.right - 4, line.right + 12));
    expect(chip.center.dy, closeTo(line.center.dy, 6));
    await tester.tap(find.byIcon(Icons.content_paste_rounded));
    await tester.pump();
    expect(find.byIcon(Icons.check_rounded), findsOneWidget); // 잠깐 ✓
    await tester.pump(const Duration(milliseconds: 700));
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.check_rounded), findsNothing);
    expect(copied, ['회의는 세 시입니다']);
    expect(find.byIcon(Icons.content_paste_rounded), findsNothing);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('데스크톱 — 두 번 클릭으로 단어를 골라도 아이콘이 뜬다, 다른 곳을 누르면 닫힘', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    await tester.pumpWidget(app());
    final at = tester.getTopLeft(find.text('회의는 세 시입니다')) + const Offset(5, 5);
    final g = await tester.startGesture(at, kind: PointerDeviceKind.mouse);
    await g.up();
    await tester.pump(const Duration(milliseconds: 50));
    await g.down(at);
    await g.up();
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.content_paste_rounded), findsOneWidget);
    await tester.tapAt(const Offset(10, 590), kind: PointerDeviceKind.mouse); // 글자 밖 빈 곳
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.content_paste_rounded), findsNothing);
    expect(copied, isEmpty);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('데스크톱 — 오른쪽 클릭은 기존처럼 메뉴 하나(아이콘 겹침 없음)', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.macOS;
    await tester.pumpWidget(app());
    await tester.tapAt(tester.getTopLeft(find.text('회의는 세 시입니다')) + const Offset(5, 5), buttons: kSecondaryMouseButton, kind: PointerDeviceKind.mouse);
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.content_paste_rounded), findsOneWidget);
    await tester.tap(find.byIcon(Icons.content_paste_rounded));
    await tester.pump();
    expect(find.byIcon(Icons.check_rounded), findsOneWidget); // 잠깐 ✓
    await tester.pump(const Duration(milliseconds: 700));
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.check_rounded), findsNothing);
    expect(copied, ['회의는']);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('모바일 — 길게 눌러 고르면 기본 메뉴 대신 클립보드 아이콘 하나', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    await tester.pumpWidget(app());
    await tester.longPressAt(tester.getTopLeft(find.text('회의는 세 시입니다')) + const Offset(5, 5));
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.content_paste_rounded), findsOneWidget);
    expect(find.text('Select all'), findsNothing);
    await tester.tap(find.byIcon(Icons.content_paste_rounded));
    await tester.pump();
    expect(find.byIcon(Icons.check_rounded), findsOneWidget); // 잠깐 ✓
    await tester.pump(const Duration(milliseconds: 700));
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.check_rounded), findsNothing);
    expect(copied, ['회의는']);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('데스크톱 — 영역 밖(다른 단추)을 누르거나 새 화면을 띄우면 아이콘이 닫힌다', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.macOS;
    final nav = GlobalKey<NavigatorState>();
    await tester.pumpWidget(MaterialApp(navigatorKey: nav, home: Scaffold(body: Column(children: [
      const SizedBox(height: 100),
      const CopySelectionArea(child: Text('회의는 세 시입니다')),
      const SizedBox(height: 100),
      TextButton(onPressed: () {}, child: const Text('바깥 단추')),
    ]))));
    Future<void> pick() async {
      final at = tester.getTopLeft(find.text('회의는 세 시입니다')) + const Offset(5, 5);
      final g = await tester.startGesture(at, kind: PointerDeviceKind.mouse);
      await g.up();
      await tester.pump(const Duration(milliseconds: 50));
      await g.down(at);
      await g.up();
      await tester.pumpAndSettle();
      expect(find.byIcon(Icons.content_paste_rounded), findsOneWidget);
    }
    await pick();
    await tester.tap(find.text('바깥 단추'), kind: PointerDeviceKind.mouse);
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.content_paste_rounded), findsNothing);
    expect(copied, isEmpty, reason: '밖 클릭');

    await tester.pump(const Duration(seconds: 1));
    await pick();
    nav.currentState!.push(MaterialPageRoute<void>(builder: (_) => const Scaffold(body: Text('새 화면'))));
    await tester.pumpAndSettle();
    expect(find.text('새 화면'), findsOneWidget);
    expect(find.byIcon(Icons.content_paste_rounded), findsNothing);
    expect(copied, isEmpty);
    debugDefaultTargetPlatformOverride = null;
  });
}
