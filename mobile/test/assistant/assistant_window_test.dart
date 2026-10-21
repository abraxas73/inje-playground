import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/assistant/assistant_window.dart';
import 'package:shared_preferences/shared_preferences.dart';

var behindTaps = 0;
Widget _host(Widget window) => MaterialApp(home: Scaffold(body: Stack(children: [
      Align(alignment: Alignment.bottomLeft, child: TextButton(onPressed: () => behindTaps++, child: const Text('뒤 화면'))),
      Positioned.fill(child: window),
    ])));

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('clampWindow — 저장값이 없으면 오른쪽 위, 화면 밖으로는 못 나간다', () {
    const screen = Size(1200, 800), win = Size(440, 680);
    expect(clampWindow(null, screen, win), const Offset(1200 - 440 - 16, 56));
    expect(clampWindow(const Offset(-500, -500), screen, win), const Offset(16, 16));
    expect(clampWindow(const Offset(5000, 5000), screen, win), const Offset(1200 - 440 - 16, 800 - 680 - 16));
  });

  testWidgets('머리글을 끌면 창이 따라 움직이고 위치를 기억하며, 창 밖(뒤 화면)은 그대로 눌린다', (tester) async {
    tester.view.physicalSize = const Size(1200, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    var closed = 0;
    await tester.pumpWidget(_host(AssistantWindow(onClose: () => closed++, body: const Center(child: Text('대화')))));
    await tester.pumpAndSettle();
    final win = find.byKey(const ValueKey('innobot-window'));
    final before = tester.getTopLeft(win);
    expect(before, const Offset(1200 - 440 - 16, 56));
    await tester.drag(find.byKey(const ValueKey('innobot-window-drag')), const Offset(-500, 60));
    await tester.pumpAndSettle();
    expect((tester.getTopLeft(win) - (before + const Offset(-500, 60))).distance, lessThan(0.5));
    expect((await SharedPreferences.getInstance()).getStringList('innobot.window.pos'), ['244', '116']);
    behindTaps = 0;
    await tester.tap(find.text('뒤 화면'));
    expect(behindTaps, 1);
    await tester.tap(find.byTooltip('닫기'));
    expect(closed, 1);
  });

  test('clampWindowSize — 기본 440×680, 최소 340×420, 화면(여백 16) 밖으로는 안 커진다', () {
    const screen = Size(1200, 800);
    expect(clampWindowSize(null, screen), const Size(440, 680));
    expect(clampWindowSize(const Size(100, 100), screen), const Size(340, 420));
    expect(clampWindowSize(const Size(5000, 5000), screen), const Size(1168, 768));
  });

  testWidgets('오른쪽 아래 모서리를 끌면 크기가 바뀌고 기억하며, 최소 크기보다 작아지지 않는다', (tester) async {
    tester.view.physicalSize = const Size(1200, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    SharedPreferences.setMockInitialValues({'innobot.window.pos': ['100', '100']});
    await tester.pumpWidget(_host(AssistantWindow(onClose: () {}, body: const SizedBox())));
    await tester.pumpAndSettle();
    final win = find.byKey(const ValueKey('innobot-window'));
    await tester.drag(find.byKey(const ValueKey('innobot-window-resize')), const Offset(200, 100));
    await tester.pumpAndSettle();
    expect(tester.getSize(win), const Size(640, 780));
    expect(tester.getTopLeft(win), const Offset(100, 100));
    expect((await SharedPreferences.getInstance()).getStringList('innobot.window.size'), ['640', '780']);
    await tester.drag(find.byKey(const ValueKey('innobot-window-resize')), const Offset(-1000, -1000));
    await tester.pumpAndSettle();
    expect(tester.getSize(win), const Size(340, 420));
  });

  testWidgets('기억한 크기로 다시 열린다', (tester) async {
    tester.view.physicalSize = const Size(1200, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    SharedPreferences.setMockInitialValues({'innobot.window.pos': ['100', '120'], 'innobot.window.size': ['500', '600']});
    await tester.pumpWidget(_host(AssistantWindow(onClose: () {}, body: const SizedBox())));
    await tester.pumpAndSettle();
    expect(tester.getSize(find.byKey(const ValueKey('innobot-window'))), const Size(500, 600));
  });

  testWidgets('기억한 위치에서 다시 열린다', (tester) async {
    tester.view.physicalSize = const Size(1200, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    SharedPreferences.setMockInitialValues({'innobot.window.pos': ['100', '120']});
    await tester.pumpWidget(_host(AssistantWindow(onClose: () {}, body: const SizedBox())));
    await tester.pumpAndSettle();
    expect(tester.getTopLeft(find.byKey(const ValueKey('innobot-window'))), const Offset(100, 120));
  });
}
