import 'dart:async';
import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/auth/session.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// exp 클레임만 있는 서명 없는 JWT — gotrue Session.expiresAt은 액세스 토큰의 exp를 읽는다.
String jwt(int exp) => 'eyJhbGciOiJub25lIn0.${base64Url.encode(utf8.encode(jsonEncode({'exp': exp, 'sub': 'u1'}))).replaceAll('=', '')}.sig';
Session session({required bool expired}) => Session.fromJson({
      'access_token': jwt(expired ? 1 : DateTime.now().millisecondsSinceEpoch ~/ 1000 + 3600),
      'token_type': 'bearer',
      'refresh_token': 'r',
      'user': <String, dynamic>{'id': 'u1', 'app_metadata': <String, dynamic>{}, 'user_metadata': <String, dynamic>{}, 'aud': 'authenticated', 'created_at': '2026-01-01T00:00:00Z'},
    })!;

class FakeAuth implements GoTrueClient {
  final ctrl = StreamController<AuthState>.broadcast();
  Session? current;
  int refreshes = 0, signOuts = 0;
  @override
  Stream<AuthState> get onAuthStateChange => ctrl.stream;
  @override
  Session? get currentSession => current;
  @override
  Future<AuthResponse> refreshSession([String? refreshToken]) async {
    refreshes++;
    current = session(expired: false);
    return AuthResponse(session: current);
  }
  @override
  Future<void> signOut({SignOutScope scope = SignOutScope.local}) async {
    signOuts++;
    current = null;
    ctrl.add(const AuthState(AuthChangeEvent.signedOut, null));
  }
  @override
  dynamic noSuchMethod(Invocation i) => throw UnimplementedError('${i.memberName}');
}

Future<void> pump([int n = 5]) async {
  for (var i = 0; i < n; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

void main() {
  test('AppSession.fromJson — 역할·권한 파싱, 빈 권한', () {
    final s = AppSession.fromJson({'email': 'a@innogrid.com', 'role': 'user', 'permissions': {'marketing': true}});
    expect(s.email, 'a@innogrid.com');
    expect(s.isGuest, false);
    expect(s.permissions['marketing'], true);
    expect(AppSession.fromJson({'email': null, 'role': 'guest', 'permissions': {}}).isGuest, true);
    expect(AppSession.fromJson({'role': 'admin'}).isAdmin, true);
  });

  test('redirectFor — 로딩 중엔 /splash, 로그아웃은 /login, guest는 /guest, 로그인 사용자는 그대로', () {
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
    expect(redirectFor(AsyncValue.data(user), '/login'), '/food');
    expect(redirectFor(AsyncValue.data(user), '/splash'), '/food');
  });

  group('SessionNotifier', () {
    late FakeAuth auth;
    final calls = <({String token, bool record})>[];
    late ProviderContainer c;
    setUp(() {
      auth = FakeAuth();
      calls.clear();
      c = ProviderContainer(overrides: [
        authClientProvider.overrideWithValue(auth),
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
