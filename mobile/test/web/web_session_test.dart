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
}
