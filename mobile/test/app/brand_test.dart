import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/app/brand.dart';

void main() {
  testWidgets('BrandHeader(showBack)는 뒤로 버튼을 그리고 누르면 pop된다', (tester) async {
    await tester.pumpWidget(MaterialApp(home: Builder(builder: (context) => Scaffold(body: Center(child: TextButton(
      onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const Scaffold(appBar: BrandHeader(title: '메일', showBack: true), body: Text('BODY')))),
      child: const Text('열기'),
    ))))));
    await tester.tap(find.text('열기'));
    await tester.pumpAndSettle();
    expect(find.text('BODY'), findsOneWidget);
    expect(find.byTooltip('뒤로'), findsOneWidget);
    await tester.tap(find.byTooltip('뒤로'));
    await tester.pumpAndSettle();
    expect(find.text('BODY'), findsNothing);
  });
  testWidgets('기본 BrandHeader(탭 화면)에는 뒤로 버튼이 없다', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(appBar: BrandHeader(title: '홈'))));
    expect(find.byTooltip('뒤로'), findsNothing);
  });
}
