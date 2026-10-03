import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/auth/session.dart';

void main() {
  test('AppSession.fromJson — 역할·권한 파싱, 빈 권한', () {
    final s = AppSession.fromJson({'email': 'a@innogrid.com', 'role': 'user', 'permissions': {'marketing': true}});
    expect(s.email, 'a@innogrid.com');
    expect(s.isGuest, false);
    expect(s.permissions['marketing'], true);
    expect(AppSession.fromJson({'email': null, 'role': 'guest', 'permissions': {}}).isGuest, true);
    expect(AppSession.fromJson({'role': 'admin'}).isAdmin, true);
  });
  test('redirectFor — 로그아웃은 /login, guest는 /guest, 로그인 사용자는 그대로, 로딩 중엔 이동 안 함', () {
    expect(redirectFor(const AsyncValue.data(null), '/food'), '/login');
    expect(redirectFor(const AsyncValue.data(null), '/login'), null);
    final guest = AppSession(email: 'g@x', role: 'guest', permissions: const {});
    expect(redirectFor(AsyncValue.data(guest), '/food'), '/guest');
    expect(redirectFor(AsyncValue.data(guest), '/guest'), null);
    final user = AppSession(email: 'u@x', role: 'user', permissions: const {});
    expect(redirectFor(AsyncValue.data(user), '/food'), null);
    expect(redirectFor(AsyncValue.data(user), '/login'), '/food');
    expect(redirectFor(const AsyncValue.loading(), '/food'), null);
  });
}
