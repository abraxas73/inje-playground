import 'package:flutter_test/flutter_test.dart';
import 'package:playground/web/web_session.dart';

void main() {
  final origin = Uri.parse('https://inje-playground.vercel.app');
  test('Microsoft 연결은 동일 오리진에서만 별도 브라우저 세션으로 시작한다', () {
    expect(WebNavPolicy.decide(origin.resolve('/api/ms/connect?returnTo=%2Fsettings'), appOrigin: origin), NavAction.microsoftConnect);
    expect(WebNavPolicy.decide(origin.resolve('/api/ms/callback?code=x'), appOrigin: origin), NavAction.inApp);
    for (final url in ['https://other.test/api/ms/connect', 'http://inje-playground.vercel.app/api/ms/connect', 'https://inje-playground.vercel.app:444/api/ms/connect']) {
      expect(WebNavPolicy.decide(Uri.parse(url), appOrigin: origin), NavAction.external);
    }
    final next = Uri(path: '/api/ms/connect', query: 'returnTo=%2Fteams%2Fchat').toString();
    final bootstrap = Uri.parse(bootstrapUrl(apiBase: origin.toString(), nextPath: next, tokenHash: 'once'));
    expect(bootstrap.queryParameters['next'], '/api/ms/connect?returnTo=%2Fteams%2Fchat');
    expect(bootstrap.fragment, 'token=once');
  });
  test('같은 오리진 페이지는 앱 안, /login은 세션 부트스트랩 신호, 다른 도메인·파일은 외부', () {
    expect(WebNavPolicy.decide(Uri.parse('https://inje-playground.vercel.app/ppt/abc'), appOrigin: origin), NavAction.inApp);
    expect(WebNavPolicy.decide(Uri.parse('https://inje-playground.vercel.app/login?next=/ppt'), appOrigin: origin), NavAction.loginRedirect);
    expect(WebNavPolicy.decide(Uri.parse('https://place.map.kakao.com/123'), appOrigin: origin), NavAction.external);
    expect(WebNavPolicy.decide(Uri.parse('https://avooqcxehfeurjhqqgui.supabase.co/storage/v1/object/sign/ppt/x.pptx?token=1'), appOrigin: origin), NavAction.external);
    expect(WebNavPolicy.decide(Uri.parse('https://inje-playground.vercel.app/api/ppt/decks/1/versions/1/file'), appOrigin: origin), NavAction.external);
    expect(WebNavPolicy.decide(Uri.parse('tel:021234567'), appOrigin: origin), NavAction.external);
  });
  test('부트스트랩 URL은 next를 쿼리에, 토큰을 조각에 넣는다', () {
    expect(bootstrapUrl(apiBase: 'https://inje-playground.vercel.app', nextPath: '/admin/settings?tab=ppt', tokenHash: 'h1'),
        'https://inje-playground.vercel.app/auth/mobile?next=%2Fadmin%2Fsettings%3Ftab%3Dppt#token=h1');
  });
  test('BootstrapGuard — /login으로 두 번째 튕기면 멈추고, 사용자가 다시 시도할 때만 초기화된다', () {
    final g = BootstrapGuard();
    expect(g.tryBegin(), true); // 첫 /login → 부트스트랩
    expect(g.tryBegin(), false); // 부트스트랩 뒤 또 /login → 오류 상태
    expect(g.tryBegin(), false);
    g.reset();
    expect(g.tryBegin(), true);
  });
  test('isSessionBoundary — /login·/auth/mobile(우리 오리진)만 세션 시작점, 다른 페이지·다른 호스트는 아니다', () {
    expect(isSessionBoundary('https://inje-playground.vercel.app/login', appOrigin: origin), true);
    expect(isSessionBoundary('https://inje-playground.vercel.app/login?next=%2Fsettings', appOrigin: origin), true);
    expect(isSessionBoundary('https://inje-playground.vercel.app/auth/mobile?next=%2Fsettings', appOrigin: origin), true);
    expect(isSessionBoundary('https://inje-playground.vercel.app/settings', appOrigin: origin), false);
    expect(isSessionBoundary('https://login.microsoftonline.com/x', appOrigin: origin), false);
    expect(isSessionBoundary(null, appOrigin: origin), false);
  });
  test('BackTracker — 뒤로 가기 직후(3초 안) 첫 페이지 시작만 "뒤로 가는 중"으로 판정하고, 오래됐거나 이미 소비했으면 아니다', () {
    var t = DateTime(2026, 10, 5, 9);
    final b = BackTracker(now: () => t);
    expect(b.consume(), false); // 뒤로 간 적 없음
    b.begin();
    expect(b.consume(), true);
    expect(b.consume(), false); // 한 번만
    b.begin();
    t = t.add(const Duration(seconds: 4));
    expect(b.consume(), false); // 오래됨
  });
  test('취소된 내비게이션 오류(-999·Frame load interrupted 102·cancelled)는 오류로 보여 주지 않는다', () {
    expect(isIgnorableWebError(code: -999, description: 'cancelled'), true);
    expect(isIgnorableWebError(code: 102, description: 'Frame load interrupted'), true);
    expect(isIgnorableWebError(code: -1, description: 'The operation was cancelled'), true);
    expect(isIgnorableWebError(code: -1009, description: 'The Internet connection appears to be offline.'), false);
    expect(isIgnorableWebError(code: -2, description: 'net::ERR_NAME_NOT_RESOLVED'), false);
  });
  test('머리 제목: 페이지 제목 > 로딩 중 > 경로', () {
    expect(webTitleFor(title: '설정', loading: true, path: '/settings'), '설정');
    expect(webTitleFor(title: '', loading: true, path: '/settings'), '로딩 중…');
    expect(webTitleFor(title: '', loading: false, path: '/settings'), '/settings');
  });
}
