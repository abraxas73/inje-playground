import '../api/client.dart';

enum NavAction { inApp, external, loginRedirect, oauthConnect }

/// WebView 내비게이션 정책(순수). 같은 오리진 페이지만 앱 안에서, /login으로 가면 세션이 없다는 뜻, 파일·다른 도메인·tel 등은 시스템으로.
class WebNavPolicy {
  static const _fileExt = ['.pptx', '.xlsx', '.docx', '.pdf', '.zip', '.csv', '.yaml'];
  static NavAction decide(Uri target, {required Uri appOrigin}) {
    if (target.scheme != 'http' && target.scheme != 'https') return NavAction.external;
    if (target.origin != appOrigin.origin) return NavAction.external;
    final p = target.path;
    if (p == '/api/ms/connect' || p == '/api/jira/connect') return NavAction.oauthConnect;
    if (p == '/login' || p.startsWith('/login/')) return NavAction.loginRedirect;
    if (p.endsWith('/file') || p.endsWith('/xlsx') || _fileExt.any((e) => p.toLowerCase().endsWith(e))) return NavAction.external;
    return NavAction.inApp;
  }
}

String bootstrapUrl({required String apiBase, required String nextPath, required String tokenHash}) =>
    '$apiBase/auth/mobile?next=${Uri.encodeComponent(nextPath)}#token=$tokenHash';

/// POST /api/mobile/web-token → 부트스트랩 URL. 호출자는 이걸 WebView에 로드한다.
Future<String> webBootstrapUrl(ApiClient api, String apiBase, String nextPath) async {
  final j = await api.postJson('/api/mobile/web-token') as Map<String, dynamic>;
  return bootstrapUrl(apiBase: apiBase, nextPath: nextPath, tokenHash: j['tokenHash'] as String);
}

/// 지금 보이는 페이지가 /auth/mobile(부트스트랩 페이지)인가. 조각 토큰은 페이지가 바로 지우므로 여기서 reload하면 토큰 없이 다시 열린다 — 새로고침은 재부트스트랩으로.
bool isAuthBootstrapPage(String? currentUrl, {required Uri appOrigin}) {
  final u = currentUrl == null ? null : Uri.tryParse(currentUrl);
  return u != null && u.host == appOrigin.host && u.path == '/auth/mobile';
}

/// 세션 부트스트랩 루프 방지. /login으로 처음 튕기면 1회 부트스트랩, 그 뒤 또 튕기면 멈춘다(오류 상태). 사용자가 "다시 시도"할 때만 초기화.
class BootstrapGuard {
  int _attempts = 0;
  bool tryBegin() {
    if (_attempts >= 1) return false;
    _attempts++;
    return true;
  }
  void reset() => _attempts = 0;
}

/// 우리가 내비게이션을 가로채(/login → 부트스트랩) 다시 로드할 때 WKWebView가 내는 "취소됨" 오류.
/// NSURLErrorCancelled(-999)·WebKit Frame load interrupted(102)·설명에 cancel/interrupt — 진짜 실패가 아니라 보여 주지 않는다.
bool isIgnorableWebError({required int code, required String description}) {
  if (code == -999 || code == 102) return true;
  final d = description.toLowerCase();
  return d.contains('cancel') || d.contains('interrupt');
}

/// 머리 제목: 페이지 제목이 있으면 그것, 로딩 중이면 "로딩 중…", 아니면 경로.
String webTitleFor({required String title, required bool loading, required String path}) => title.isNotEmpty ? title : (loading ? '로딩 중…' : path);

/// 뒤로 가다가 닿으면 "세션 시작점을 지난 것"인 페이지 — /login(세션 없음)·/auth/mobile(부트스트랩). 여기 닿으면 WebView 안에서 더 뒤로 갈 곳이 없으니 화면을 닫는다.
/// Android WebView는 첫 로드에서 가로챈(/settings → 307 /login) 내비게이션을 히스토리에 남겨 canGoBack()이 true가 되고, goBack()은 그 /login을 실제로 연다(실기기 실측 2026-10-04).
bool isSessionBoundary(String? url, {required Uri appOrigin}) {
  final u = url == null ? null : Uri.tryParse(url);
  if (u == null || u.host != appOrigin.host) return false;
  return u.path == '/login' || u.path.startsWith('/login/') || u.path == '/auth/mobile';
}

/// "방금 뒤로 가기를 눌렀다"를 다음 페이지 시작 한 번에만 전달한다. 히스토리 이동(goBack)은 onNavigationRequest를 거치지 않으므로 onPageStarted에서 쓴다.
class BackTracker {
  BackTracker({DateTime Function()? now}) : _now = now ?? DateTime.now;
  final DateTime Function() _now;
  static const window = Duration(seconds: 3);
  DateTime? _at;
  void begin() => _at = _now();
  bool consume() {
    final at = _at;
    _at = null;
    return at != null && _now().difference(at) <= window;
  }
}

/// Only same-origin HTTP(S) destinations may receive an authenticated bootstrap.
String? browserSessionPath(Uri target, {required Uri appOrigin}) {
  if ((target.scheme != 'http' && target.scheme != 'https') ||
      target.origin != appOrigin.origin) {
    return null;
  }
  if (isSessionBoundary(target.toString(), appOrigin: appOrigin)) return null;
  return Uri(path: target.path, query: target.hasQuery ? target.query : null,
      fragment: target.hasFragment ? target.fragment : null).toString();
}
