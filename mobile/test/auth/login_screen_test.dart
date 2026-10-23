import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/auth/login_screen.dart';
import 'package:playground/auth/session.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'fake_auth.dart';

void main() {
  late FakeAuth auth;
  late List<bool> records;
  Object? fetchError;

  setUp(() {
    auth = FakeAuth();
    records = [];
    fetchError = null;
  });

  Future<ProviderContainer> pumpLogin(WidgetTester t) async {
    final c = ProviderContainer(overrides: [
      authClientProvider.overrideWithValue(auth),
      closeAuthBrowserProvider.overrideWithValue(() async {}),
      sessionFetcherProvider.overrideWithValue((token, {required record}) async {
        records.add(record);
        if (fetchError != null) throw fetchError!;
        return AppSession(email: 'tester@example.com', role: 'user', permissions: const {});
      }),
    ]);
    addTearDown(c.dispose);
    await t.pumpWidget(UncontrolledProviderScope(container: c, child: const MaterialApp(home: LoginScreen())));
    await t.pumpAndSettle();
    return c;
  }

  Future<void> fillAndSubmit(WidgetTester t) async {
    await t.tap(find.text('테스트 계정으로 로그인'));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('testPassword')), findsOneWidget);
    await t.enterText(find.byKey(const Key('testEmail')), ' tester@example.com ');
    await t.enterText(find.byKey(const Key('testPassword')), 'pw-1234');
    await t.testTextInput.receiveAction(TextInputAction.done); // 엔터 제출
    await t.pumpAndSettle();
  }

  testWidgets('링크 → 폼 → 엔터로 제출하면 signInWithPassword 후 로그인 기록(POST) 한 번', (t) async {
    final c = await pumpLogin(t);
    expect(find.byKey(const Key('testEmail')), findsNothing);
    await fillAndSubmit(t);
    expect(auth.passwordLogins, ['tester@example.com']);
    expect(records, [true], reason: 'signedIn 이벤트로 중복 기록하지 않는다');
    expect(c.read(sessionProvider).asData?.value?.role, 'user');
  });

  testWidgets('403 email_login_not_allowed면 Supabase 로그아웃하고 서버 문구를 보인다', (t) async {
    fetchError = const LoginFailure(notAllowedMessage);
    final c = await pumpLogin(t);
    await fillAndSubmit(t);
    expect(auth.signOuts, 1);
    expect(auth.currentSession, isNull);
    expect(c.read(sessionProvider).asData?.value, isNull);
    expect(find.text(notAllowedMessage), findsOneWidget);
  });

  testWidgets('잘못된 비밀번호는 한국어 안내, 비밀번호 칸은 가림', (t) async {
    auth.passwordError = const AuthApiException('Invalid login credentials', statusCode: '400', code: 'invalid_credentials');
    await pumpLogin(t);
    await fillAndSubmit(t);
    expect(find.text('이메일 또는 비밀번호가 올바르지 않습니다.'), findsOneWidget);
    expect(records, isEmpty);
    expect(t.widget<TextField>(find.byKey(const Key('testPassword'))).obscureText, isTrue);
  });

  test('passwordErrorMessage — 네트워크·기타 오류', () {
    expect(passwordErrorMessage(AuthRetryableFetchException(message: 'x')), contains('네트워크'));
    expect(passwordErrorMessage(Exception('socket')), contains('네트워크'));
    expect(passwordErrorMessage(const AuthApiException('x', statusCode: '500')), contains('로그인에 실패'));
  });
}
