import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:webview_flutter/webview_flutter.dart';
import '../config.dart';

class AppSession {
  AppSession({required this.email, required this.role, required this.permissions});
  final String? email;
  final String role; // guest | user | admin
  final Map<String, bool> permissions;
  bool get isGuest => role == 'guest';
  bool get isAdmin => role == 'admin';

  factory AppSession.fromJson(Map<String, dynamic> j) => AppSession(
        email: j['email'] as String?,
        role: (j['role'] as String?) ?? 'guest',
        permissions: {for (final e in ((j['permissions'] as Map?) ?? const {}).entries) if (e.value is bool) e.key as String: e.value as bool},
      );
}

/// 라우터 redirect 규칙(순수 함수). null = 이동 없음.
String? redirectFor(AsyncValue<AppSession?> session, String location) {
  if (session.isLoading) return null;
  final s = session.asData?.value;
  if (s == null) return location == '/login' ? null : '/login';
  if (s.isGuest) return location == '/guest' ? null : '/guest';
  if (location == '/login' || location == '/guest') return '/food';
  return null;
}

class SessionNotifier extends AsyncNotifier<AppSession?> {
  GoTrueClient get _auth => Supabase.instance.client.auth;
  StreamSubscription<AuthState>? _sub;

  @override
  Future<AppSession?> build() async {
    _sub ??= _auth.onAuthStateChange.listen((e) {
      if (e.event == AuthChangeEvent.signedIn) reload();
      if (e.event == AuthChangeEvent.signedOut) state = const AsyncValue.data(null);
    });
    ref.onDispose(() => _sub?.cancel());
    if (_auth.currentSession == null) return null;
    return _fetchSession();
  }

  /// POST /api/mobile/login — 로그인 기록 + 역할·권한. 실패하면 예외를 올려 로그인 화면이 "다시 시도"를 보여 준다.
  Future<AppSession> _fetchSession() async {
    final token = _auth.currentSession?.accessToken;
    if (token == null) throw StateError('세션이 없습니다.');
    final res = await http.post(Uri.parse('${Config.apiBase}/api/mobile/login'),
        headers: {'Authorization': 'Bearer $token', 'User-Agent': Config.userAgent(defaultTargetPlatform.name)});
    if (res.statusCode != 200) throw Exception('로그인 확인 실패(${res.statusCode})');
    return AppSession.fromJson(jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>);
  }

  Future<void> reload() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(_fetchSession);
  }

  Future<void> signIn() async {
    await _auth.signInWithOAuth(OAuthProvider.azure, redirectTo: Config.loginRedirect, scopes: 'email openid profile');
    // 돌아오면 onAuthStateChange(signedIn) → reload()
  }

  Future<void> signOut() async {
    try { await WebViewCookieManager().clearCookies(); } catch (_) {}
    await _auth.signOut();
    state = const AsyncValue.data(null);
  }
}

final sessionProvider = AsyncNotifierProvider<SessionNotifier, AppSession?>(SessionNotifier.new);

/// go_router refreshListenable — 세션 상태가 바뀔 때마다 redirect 재평가.
class SessionListenable extends ChangeNotifier {
  SessionListenable(Ref ref) {
    ref.listen(sessionProvider, (_, _) => notifyListeners());
  }
}

final sessionListenableProvider = Provider<SessionListenable>(SessionListenable.new);
