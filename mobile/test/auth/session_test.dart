import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/auth/session.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'fake_auth.dart';

void main() {
  test('AppSession.fromJson — 역할·권한 파싱, 빈 권한', () {
    final s = AppSession.fromJson({'email': 'a@innogrid.com', 'role': 'user', 'permissions': {'marketing': true}});
    expect(s.email, 'a@innogrid.com');
    expect(s.isGuest, false);
    expect(s.permissions['marketing'], true);
    expect(AppSession.fromJson({'email': null, 'role': 'guest', 'permissions': {}}).isGuest, true);
    expect(AppSession.fromJson({'role': 'admin'}).isAdmin, true);
  });

  test('redirectFor — 로딩 중엔 /splash, 로그아웃은 /login, guest는 /guest, 로그인 직후는 /home(웰컴), 그 외 그대로', () {
    expect(redirectFor(const AsyncValue.loading(), '/food'), '/splash');
    expect(redirectFor(const AsyncValue.loading(), '/splash'), null);
    expect(redirectFor(const AsyncValue.data(null), '/food'), '/login');
    expect(redirectFor(const AsyncValue.data(null), '/splash'), '/login');
    expect(redirectFor(const AsyncValue.data(null), '/login'), null);
    final guest = AppSession(email: 'g@x', role: 'guest', permissions: const {});
    expect(redirectFor(AsyncValue.data(guest), '/food'), '/guest');
    expect(redirectFor(AsyncValue.data(guest), '/guest'), null);
    final user = AppSession(email: 'u@x', role: 'user', permissions: const {});
    expect(redirectFor(AsyncValue.data(user), '/food'), null);
    expect(redirectFor(AsyncValue.data(user), '/login'), '/home');
    expect(redirectFor(AsyncValue.data(user), '/splash'), '/home');
  });

  group('SessionNotifier', () {
    late FakeAuth auth;
    final calls = <({String token, bool record})>[];
    var browserCloses = 0;
    late ProviderContainer c;
    setUp(() {
      auth = FakeAuth();
      calls.clear();
      browserCloses = 0;
      c = ProviderContainer(overrides: [
        authClientProvider.overrideWithValue(auth),
        closeAuthBrowserProvider.overrideWithValue(() async => browserCloses++),
        sessionFetcherProvider.overrideWithValue((token, {required record}) async {
          calls.add((token: token, record: record));
          return AppSession(email: 'u@innogrid.com', role: 'user', permissions: const {});
        }),
      ]);
      addTearDown(c.dispose);
      addTearDown(auth.ctrl.close);
    });

    test('재빌드(invalidate) 뒤에도 signedIn 구독이 살아 있고, 로그인 때만 기록(POST)한다', () async {
      expect(await c.read(sessionProvider.future), isNull);
      c.invalidate(sessionProvider);
      expect(await c.read(sessionProvider.future), isNull);
      auth.current = session(expired: false);
      auth.ctrl.add(AuthState(AuthChangeEvent.signedIn, auth.current));
      await pump();
      expect(calls.length, 1);
      expect(calls.single.record, true);
      expect(browserCloses, 1, reason: 'OAuth 콜백 뒤 인앱 브라우저(SFSafariViewController)를 닫아야 한다 — supabase_flutter는 닫지 않는다');
      expect(c.read(sessionProvider).asData?.value?.role, 'user');
      auth.ctrl.add(const AuthState(AuthChangeEvent.signedOut, null));
      await pump();
      expect(c.read(sessionProvider).asData?.value, isNull);
    });

    test('콜드 스타트: 만료된 세션은 먼저 갱신하고, 역할 조회는 기록 없이(GET)', () async {
      auth.current = session(expired: true);
      final s = await c.read(sessionProvider.future);
      expect(auth.refreshes, 1);
      expect(calls.length, 1);
      expect(calls.single.record, false);
      expect(calls.single.token, auth.current!.accessToken);
      expect(s?.role, 'user');
    });
  });
}
