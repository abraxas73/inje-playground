import 'dart:async';
import 'dart:convert';
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

