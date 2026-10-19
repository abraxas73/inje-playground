import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/main.dart' show SelectAllText;

Widget _app(String text) => MaterialApp(
      locale: const Locale('ko'),
      supportedLocales: const [Locale('ko')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      builder: (context, child) => SelectAllText(child: child!),
      home: Scaffold(body: Center(child: Text(text))),
    );

void main() {
  testWidgets('앱 전체 글자 — 길게 눌러 고르고 복사하면 클립보드에 들어간다, 화면이 바뀌면 새 글자를 그린다', (tester) async {
    String? copied;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') copied = (call.arguments as Map)['text'] as String?;
      return null;
    });
    addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));

    await tester.pumpWidget(_app('회의실예약번호'));
    expect(find.byType(SelectionArea), findsOneWidget);
    await tester.longPress(find.text('회의실예약번호'));
    await tester.pumpAndSettle();
    expect(find.text('전체 선택'), findsOneWidget); // 메뉴가 한국어
    await tester.tap(find.text('복사'));
    await tester.pumpAndSettle();
    expect(copied, '회의실예약번호');

    await tester.pumpWidget(_app('바뀐 화면'));
    expect(find.text('바뀐 화면'), findsOneWidget);
  });
}
