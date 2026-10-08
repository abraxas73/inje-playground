import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';
import '../web/app_webview.dart';
import '../assistant/assistant_session.dart';
import '../briefing/briefing_provider.dart';
import '../briefing/summary_provider.dart';
import '../config.dart';
import '../gw/gw_creds.dart';
import '../gw/gw_login_store.dart';

class AppSession {
  AppSession({
    required this.email,
    this.name,
    required this.role,
    required this.permissions,
  });
  final String? email;
  final String? name; // 홈 인사말용(user_profiles.display_name → Azure full_name)
  final String role; // guest | user | admin
  final Map<String, bool> permissions;
  bool get isGuest => role == 'guest';
  bool get isAdmin => role == 'admin';

  factory AppSession.fromJson(Map<String, dynamic> j) => AppSession(
    email: j['email'] as String?,
    name: j['name'] as String?,
    role: (j['role'] as String?) ?? 'guest',
    permissions: {
      for (final e in ((j['permissions'] as Map?) ?? const {}).entries)
        if (e.value is bool) e.key as String: e.value as bool,
    },
  );
}

/// 라우터 redirect 규칙(순수 함수). null = 이동 없음. 로그인 직후 첫 화면은 홈(웰컴). 세션 확인 중에는 /splash에 머물러 탭 화면(위치 권한·API 호출)이 먼저 뜨지 않게 한다.
String? redirectFor(AsyncValue<AppSession?> session, String location) {
  if (session.isLoading) return location == '/splash' ? null : '/splash';
  final s = session.asData?.value;
  if (s == null) return location == '/login' ? null : '/login';
  if (s.isGuest) return location == '/guest' ? null : '/guest';
  if (location == '/login' || location == '/guest' || location == '/splash') {
    return '/home';
  }
  return null;
}

/// 역할·권한 조회. record=true면 POST /api/mobile/login(login_history 기록), false면 GET(기록 없음).
typedef SessionFetcher =
    Future<AppSession> Function(String accessToken, {required bool record});

final authClientProvider = Provider<GoTrueClient>(
  (_) => Supabase.instance.client.auth,
);

/// OAuth 인앱 브라우저 닫기. supabase_flutter는 딥링크로 세션만 복구하고 iOS SFSafariViewController는 그대로 둔다(Microsoft 마지막 화면이 앱을 덮음).
final closeAuthBrowserProvider = Provider<Future<void> Function()>(
  (_) => closeInAppWebView,
);

final sessionFetcherProvider = Provider<SessionFetcher>(
  (_) => (token, {required record}) async {
    final uri = Uri.parse('${Config.apiBase}/api/mobile/login');
    final headers = {
      'Authorization': 'Bearer $token',
      'User-Agent': Config.userAgent(defaultTargetPlatform.name),
    };
    final res = record
        ? await http.post(uri, headers: headers)
        : await http.get(uri, headers: headers);
    if (res.statusCode != 200) throw Exception('로그인 확인 실패(${res.statusCode})');
    return AppSession.fromJson(
      jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>,
    );
  },
);

class SessionNotifier extends AsyncNotifier<AppSession?> {
  GoTrueClient get _auth => ref.read(authClientProvider);

  @override
  Future<AppSession?> build() async {
    // Riverpod 3는 노티파이어 인스턴스를 재빌드(실패 재시도·invalidate) 사이에 재사용한다 — 구독은 빌드마다 새로 걸고 그 빌드의 dispose에 끊는다.
    final sub = _auth.onAuthStateChange.listen((e) {
      if (e.event == AuthChangeEvent.signedIn) {
        ref
            .read(closeAuthBrowserProvider)()
            .catchError((_) {}); // Android 커스텀 탭 등 닫을 게 없으면 무시
        _afterSignIn();
      }
      if (e.event == AuthChangeEvent.signedOut) {
        state = const AsyncValue.data(null);
      }
    });
    ref.onDispose(sub.cancel);
    if (_auth.currentSession == null) return null;
    return _fetch(record: false);
  }

  /// 콜드 스타트에서 supabase_flutter는 만료된 세션을 먼저 올리고 갱신은 기다리지 않는다 — 만료면 갱신부터.
  Future<AppSession> _fetch({required bool record}) async {
    var session = _auth.currentSession;
    if (session == null) throw StateError('세션이 없습니다.');
    if (session.isExpired) {
      session = (await _auth.refreshSession()).session ?? session;
    }
    return ref.read(sessionFetcherProvider)(
      session.accessToken,
      record: record,
    );
  }

  Future<void> _afterSignIn() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(() => _fetch(record: true));
  }

  /// 역할·권한 다시 조회(기록 없음) — guest "다시 확인", 오류 뒤 "다시 시도".
  Future<void> reload() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(() => _fetch(record: false));
  }

  Future<void> signIn() async {
    await _auth.signInWithOAuth(
      OAuthProvider.azure,
      redirectTo: Config.loginRedirect,
      scopes: 'email openid profile',
    );
    // 돌아오면 onAuthStateChange(signedIn) → _afterSignIn()
  }

  /// 앱 세션 종료 + WebView 쿠키·localStorage 정리(같은 기기에서 다른 계정이 이전 사용자의 웹 세션·설정을 보지 않게).
  Future<void> signOut() async {
    try {
      await AppWebController.clearSession();
    } catch (_) {}
    await _clearUserData();
    await _auth.signOut();
    state = const AsyncValue.data(null);
  }

  /// 사람에 묶인 기기 데이터 — 다음에 로그인하는 다른 계정이 이전 사용자의 아마란스 연결·비서 대화·되돌리기 기록을 쓰지 않게.
  /// 기기 설정(이노봇 버튼 위치 등)은 남긴다.
  static const _userPrefPrefixes = [
    'gw.',
    'assistant.journal',
    'clockin.',
    'briefing.',
  ];
  Future<void> _clearUserData() async {
    try {
      final p = await SharedPreferences.getInstance();
      for (final k
          in p
              .getKeys()
              .where((k) => _userPrefPrefixes.any(k.startsWith))
              .toList()) {
        await p.remove(k);
      }
    } catch (_) {}
    try {
      await ref.read(gwLoginStoreProvider).clear();
    } catch (_) {}
    ref.invalidate(gwProvider);
    ref.invalidate(gwLoginProvider);
    ref.invalidate(assistantSessionProvider);
    ref.invalidate(summaryProvider);
    ref.invalidate(briefingProvider);
  }
}

final sessionProvider = AsyncNotifierProvider<SessionNotifier, AppSession?>(
  SessionNotifier.new,
);

/// go_router refreshListenable — 세션 상태가 바뀔 때마다 redirect 재평가.
class SessionListenable extends ChangeNotifier {
  SessionListenable(Ref ref) {
    ref.listen(sessionProvider, (_, _) => notifyListeners());
  }
}

final sessionListenableProvider = Provider<SessionListenable>(
  SessionListenable.new,
);
