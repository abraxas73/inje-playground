import 'package:flutter_test/flutter_test.dart';
import 'package:playground/web/web_session.dart';

void main() {
  test('새로고침 버튼: /auth/mobile(조각 토큰은 이미 지워짐)에 있으면 재부트스트랩, 다른 페이지면 그냥 reload', () {
    final origin = Uri.parse('https://inje-playground.vercel.app');
    expect(isAuthBootstrapPage('https://inje-playground.vercel.app/auth/mobile?next=%2Fsettings', appOrigin: origin), true);
    expect(isAuthBootstrapPage('https://inje-playground.vercel.app/settings', appOrigin: origin), false);
    expect(isAuthBootstrapPage('https://other.example.com/auth/mobile', appOrigin: origin), false);
    expect(isAuthBootstrapPage(null, appOrigin: origin), false);
  });
}
