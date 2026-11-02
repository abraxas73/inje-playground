import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/features/home/tips.dart';

void main() {
  test('팁은 30개 이상, 중복 없음', () {
    expect(appTips.length, greaterThanOrEqualTo(30));
    expect(appTips.toSet().length, appTips.length);
  });
  testWidgets('다음을 누르면 다음 팁, 끝에서 처음으로', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: TipLine(tips: ['가', '나'], start: 0))));
    expect(find.text('Tip!'), findsOneWidget);
    expect(find.text('가'), findsOneWidget);
    await tester.tap(find.text('다음'));
    await tester.pump();
    expect(find.text('나'), findsOneWidget);
    await tester.tap(find.text('다음'));
    await tester.pump();
    expect(find.text('가'), findsOneWidget);
  });
  testWidgets('좁은 폭에서도 넘치지 않는다', (tester) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: SizedBox(width: 260, child: TipLine(start: 0)))));
    expect(tester.takeException(), isNull);
  });
}
