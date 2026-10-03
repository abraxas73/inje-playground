import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/app/router.dart';

void main() {
  testWidgets('탭 셸이 4개 탭을 그린다', (tester) async {
    final router = buildRouter(refresh: ValueNotifier(0), redirect: (_, _) => null);
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    await tester.pumpAndSettle();
    for (final label in ['뭐 먹지', '사다리', '커피 타임', '더보기']) {
      expect(find.text(label), findsWidgets);
    }
  });
}
