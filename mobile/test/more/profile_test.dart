import 'package:flutter_test/flutter_test.dart';
import 'package:playground/more/profile.dart';

void main() {
  test('조직도 이름 우선, 계정 이름 대체, 빈 이름은 사용자', () {
    expect(profileDisplayName(organizationName: ' 강승욱 ', accountName: 'Seunguk Kang'), '강승욱');
    expect(profileDisplayName(organizationName: ' ', accountName: 'Seunguk Kang'), 'Seunguk Kang');
    expect(profileDisplayName(accountName: ' '), '사용자');
    expect(profileDisplayName(), '사용자');
  });
}
