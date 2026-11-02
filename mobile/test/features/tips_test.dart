import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/features/home/tips.dart';

void main() {
  test('응답 해석: 빈 글·가중치 0 이하·형식 틀린 항목은 뺀다', () {
    expect(parseTips({'items': [{'text': ' 가 ', 'weight': 2}, {'text': '나', 'weight': 0}, {'text': '', 'weight': 1}, {'text': '다'}, 'x']}), [(text: '가', weight: 2)]);
    expect(parseTips(null), isEmpty);
  });
  test('가중치 비례로 뽑고, not은 피한다', () {
    final tips = [(text: '가', weight: 3), (text: '나', weight: 1)];
    final r = math.Random(1), n = [0, 0];
    for (var k = 0; k < 4000; k++) {
      n[pickTip(tips, r)]++;
    }
    expect(n[0] / 4000, closeTo(0.75, 0.04));
    for (var k = 0; k < 50; k++) {
      expect(pickTip(tips, r, not: 0), 1);
    }
    expect(pickTip([(text: '가', weight: 1)], r, not: 0), 0);
  });
  Widget host(List<AppTip> tips) => ProviderScope(
        key: UniqueKey(),
        overrides: [appTipsProvider.overrideWith((ref) async => tips)],
        child: MaterialApp(home: Scaffold(body: SizedBox(width: 260, child: TipLine(random: math.Random(0))))),
      );
  testWidgets('다음을 누르면 다른 팁, 좁은 폭에서도 넘치지 않음', (tester) async {
    await tester.pumpWidget(host([(text: '가', weight: 1), (text: '나', weight: 1)]));
    await tester.pump();
    expect(find.text('Tip!'), findsOneWidget);
    final first = (tester.widget<Text>(find.byKey(const ValueKey('tip-text')))).data;
    await tester.tap(find.text('다음'));
    await tester.pump();
    expect(tester.widget<Text>(find.byKey(const ValueKey('tip-text'))).data, isNot(first));
    expect(tester.takeException(), isNull);
  });
  testWidgets('목록이 비면 아무것도 안 그린다, 하나면 다음 버튼 없음', (tester) async {
    await tester.pumpWidget(host(const []));
    await tester.pump();
    expect(find.text('Tip!'), findsNothing);
    await tester.pumpWidget(host([(text: '가', weight: 1)]));
    await tester.pump();
    expect(find.text('가'), findsOneWidget);
    expect(find.text('다음'), findsNothing);
  });
}
