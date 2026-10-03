import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/app/router.dart';
import 'package:playground/auth/session.dart';
import 'auth/fake_auth.dart';

void main() {
  testWidgets('로그아웃 → 다시 로그인(/login → /splash → /food)에서 탭 셸이 다시 그려진다', (tester) async {
    final user = AppSession(email: 'u@innogrid.com', role: 'user', permissions: const {});
    final session = ValueNotifier<AsyncValue<AppSession?>>(AsyncValue.data(user));
    final router = buildRouter(refresh: session, redirect: (_, s) => redirectFor(session.value, s.matchedLocation));
    final auth = FakeAuth();
    addTearDown(auth.ctrl.close);
    await tester.pumpWidget(ProviderScope(overrides: [
      authClientProvider.overrideWithValue(auth),
      sessionFetcherProvider.overrideWithValue((_, {required record}) async => user),
    ], child: MaterialApp.router(routerConfig: router)));
    await tester.pumpAndSettle();
    expect(find.text('뭐 먹지'), findsWidgets);

    session.value = const AsyncValue.data(null); // 로그아웃
    await tester.pumpAndSettle();
    expect(find.text('Microsoft 계정으로 로그인'), findsOneWidget);

    session.value = const AsyncValue.loading(); // signedIn → 역할 조회 중(/splash는 진행 표시가 계속 돌아 settle 불가)
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    session.value = AsyncValue.data(user); // 조회 완료
    await tester.pumpAndSettle();
    expect(find.text('뭐 먹지'), findsWidgets);
    expect(tester.takeException(), isNull);
  });
}
