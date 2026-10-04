import '../api/client.dart';

enum NavAction { inApp, external, loginRedirect }

/// WebView 내비게이션 정책(순수). 같은 오리진 페이지만 앱 안에서, /login으로 가면 세션이 없다는 뜻, 파일·다른 도메인·tel 등은 시스템으로.
class WebNavPolicy {
  static const _fileExt = ['.pptx', '.xlsx', '.docx', '.pdf', '.zip', '.csv', '.yaml'];
  static NavAction decide(Uri target, {required Uri appOrigin}) {
    if (target.scheme != 'http' && target.scheme != 'https') return NavAction.external;
    if (target.host != appOrigin.host) return NavAction.external;
    final p = target.path;
    if (p == '/login' || p.startsWith('/login/')) return NavAction.loginRedirect;
    if (p.endsWith('/file') || _fileExt.any((e) => p.toLowerCase().endsWith(e))) return NavAction.external;
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
