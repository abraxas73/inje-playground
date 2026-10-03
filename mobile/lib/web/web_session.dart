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
