import 'package:flutter_test/flutter_test.dart';
import 'package:playground/web/web_session.dart';

void main() {
  final origin = Uri.parse('https://inje-playground.vercel.app');
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
