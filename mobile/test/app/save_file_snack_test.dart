import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/app/save_file.dart';

void main() {
  Future<ScaffoldMessengerState> host(WidgetTester t) async {
    final key = GlobalKey<ScaffoldMessengerState>();
    await t.pumpWidget(MaterialApp(scaffoldMessengerKey: key, home: const Scaffold()));
    return key.currentState!;
  }

  testWidgets('데스크톱 파일 저장 — 알림을 누르거나 [열기]로 그 파일을 연다, 못 열면 안내', (t) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.macOS;
    final m = await host(t);
    final opened = <Uri>[];
    var result = true;
    final file = Uri.file('/tmp/보고서.pdf');
    showSavedFileSnack(m, '보고서.pdf', file, open: (u) async { opened.add(u); return result; });
    await t.pumpAndSettle();
    await t.tap(find.text('저장했습니다: 보고서.pdf — 눌러서 열기'));
    await t.pumpAndSettle();
    expect(opened, [file]);
    expect(find.text('저장했습니다: 보고서.pdf — 눌러서 열기'), findsNothing);
    result = false;
    showSavedFileSnack(m, '보고서.pdf', file, open: (u) async { opened.add(u); return result; });
    await t.pumpAndSettle();
    await t.tap(find.text('열기'));
    await t.pumpAndSettle();
    expect(opened, [file, file]);
    expect(find.text('파일을 열지 못했습니다. 저장한 폴더에서 열어 주세요'), findsOneWidget);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('휴대폰이거나 파일 주소가 아니면 글자만', (t) async {
    final m = await host(t); // 테스트 기본 android
    showSavedFileSnack(m, 'a.pdf', Uri.file('/x/a.pdf'));
    await t.pumpAndSettle();
    expect(find.text('저장했습니다: a.pdf'), findsOneWidget);
    expect(find.text('열기'), findsNothing);
    m.hideCurrentSnackBar();
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    showSavedFileSnack(m, 'b.pdf', 'C:/x/b.pdf'); // Uri 아님
    await t.pumpAndSettle();
    expect(find.text('열기'), findsNothing);
    debugDefaultTargetPlatformOverride = null;
  });
}
