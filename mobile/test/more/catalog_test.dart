import 'package:flutter_test/flutter_test.dart';
import 'package:playground/auth/session.dart';
import 'package:playground/more/catalog.dart';

AppSession s(String role, [Map<String, bool> p = const {}]) => AppSession(email: 'x@innogrid.com', role: role, permissions: p);

void main() {
  test('guest는 일상 항목만, 숨김 항목(guide)은 아무도 못 본다', () {
    final keys = visiblePages(s('guest')).map((e) => e.key).toList();
    expect(keys, ['food', 'ladder', 'team', 'survey']);
    expect(pages.any((e) => e.key == 'guide'), false);
  });
  test('user는 마케팅을 제외한 전부, 권한이 있으면 마케팅도', () {
    final keys = visiblePages(s('user')).map((e) => e.key);
    expect(keys, containsAll(['usage_code', 'usage_chat', 'usage_perf', 'rfp', 'ppt', 'people_news']));
    expect(keys, isNot(contains('marketing')));
    expect(visiblePages(s('user', {'marketing': true})).map((e) => e.key), contains('marketing'));
    expect(visiblePages(s('user', {'rfp': false})).map((e) => e.key), isNot(contains('rfp')));
  });
  test('admin은 전부 + 관리자 메뉴', () {
    expect(visiblePages(s('admin')).length, pages.length);
    expect(visibleAdminPages(s('admin')).map((e) => e.href), contains('/admin/ppt'));
    expect(visibleAdminPages(s('user')), isEmpty);
  });
}
