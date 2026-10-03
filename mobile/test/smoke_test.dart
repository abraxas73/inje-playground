import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/app/router.dart';
import 'package:playground/auth/session.dart';
import 'auth/fake_auth.dart';

void main() {
  testWidgets('탭 셸이 하단 바(홈·그룹·더보기)를 그린다 — 세션 없음이면 그룹 없이 홈·더보기만', (tester) async {
    final router = buildRouter(refresh: ValueNotifier(0), redirect: (_, _) => null);
    final auth = FakeAuth(); // 홈 화면이 세션(이름·권한)을 읽는다
    addTearDown(auth.ctrl.close);
    await tester.pumpWidget(ProviderScope(overrides: [authClientProvider.overrideWithValue(auth)], child: MaterialApp.router(routerConfig: router)));
    await tester.pumpAndSettle();
    for (final label in ['홈', '더보기']) {
      expect(find.text(label), findsWidgets);
    }
  });
}
