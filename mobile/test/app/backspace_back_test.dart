import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:playground/app/backspace_back.dart';

void main() {
  testWidgets('Backspace는 뒤로 가기, 글 입력·WebView 안이거나 보조 키를 누르면 아니다', (t) async {
    final router = GoRouter(routes: [
      GoRoute(path: '/', builder: (_, _) => const Text('홈')),
      GoRoute(path: '/b', builder: (_, _) => const Scaffold(body: Column(children: [TextField(), KeepBackspace(child: Focus(child: Text('웹')))]))),
    ]);
    bool onKey(KeyEvent e) => handleBackspaceBack(e, router.routerDelegate);
    HardwareKeyboard.instance.addHandler(onKey);
    addTearDown(() => HardwareKeyboard.instance.removeHandler(onKey));
    await t.pumpWidget(MaterialApp.router(routerConfig: router));

    router.push('/b');
    await t.pumpAndSettle();
    await t.tap(find.byType(TextField));
    await t.sendKeyEvent(LogicalKeyboardKey.backspace);
    await t.pumpAndSettle();
    expect(find.byType(TextField), findsOneWidget); // 입력 중엔 글자 지우기

    Focus.of(t.element(find.text('웹'))).requestFocus();
    await t.pump();
    await t.sendKeyEvent(LogicalKeyboardKey.backspace);
    await t.pumpAndSettle();
    expect(find.byType(TextField), findsOneWidget); // WebView 안(KeepBackspace)도 그대로

    FocusManager.instance.primaryFocus?.unfocus();
    await t.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
    await t.sendKeyEvent(LogicalKeyboardKey.backspace);
    await t.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
    await t.pumpAndSettle();
    expect(find.byType(TextField), findsOneWidget);

    await t.sendKeyEvent(LogicalKeyboardKey.backspace);
    await t.pumpAndSettle();
    expect(find.text('홈'), findsOneWidget);
  });
}
