import 'package:flutter_test/flutter_test.dart';
import 'package:playground/more/catalog.dart';
import 'package:playground/web/web_session.dart';

void main() {
  final origin = Uri.parse('https://innocrew.innogrid.com');
  test('웹 즐겨찾기 경로: 우리 오리진의 경로+쿼리만, 로그인 경유 주소는 제외', () {
    expect(pagePathOf('https://innocrew.innogrid.com/ppt?all=1', appOrigin: origin), '/ppt?all=1');
    expect(pagePathOf('https://innocrew.innogrid.com/jira', appOrigin: origin), '/jira');
    expect(pagePathOf('https://evil.test/ppt', appOrigin: origin), isNull);
    expect(pagePathOf('https://innocrew.innogrid.com/login?next=/ppt', appOrigin: origin), isNull);
    expect(pagePathOf('https://innocrew.innogrid.com/auth/mobile?t=x', appOrigin: origin), isNull);
    expect(pagePathOf(null, appOrigin: origin), isNull);
  });
  test('즐겨찾기 이름은 가장 길게 맞는 메뉴 이름(웹 문서 제목은 모두 "이노그리드")', () {
    expect(pageLabelFor('/ppt'), 'PPT 만들기');
    expect(pageLabelFor('/ppt/abc?x=1'), 'PPT 만들기');
    expect(pageLabelFor('/manual'), '사용자 매뉴얼');
    expect(pageLabelFor('/no-such-page'), isNull);
  });
}
