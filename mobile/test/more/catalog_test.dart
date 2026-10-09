import 'package:flutter_test/flutter_test.dart';
import 'package:playground/auth/session.dart';
import 'package:playground/more/catalog.dart';

AppSession s(String role, [Map<String, bool> p = const {}]) => AppSession(email: 'x@innogrid.com', role: role, permissions: p);

void main() {
  test('Jira는 업무 메뉴에 있고 권한으로 숨길 수 있다', () {
    final work = visibleGroups(s('user')).firstWhere((g) => g.$1.id == 'work');
    expect(work.$2.any((p) => p.key == 'jira' && p.href == '/jira'), true);
    expect(work.$2.any((p) => p.key == 'confluence' && p.href == '/confluence'), true);
    expect(visiblePages(s('user', {'jira': false})).any((p) => p.key == 'jira'), false);
  });

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
  test('앱 전용 항목(appPages)은 그룹에는 나오지만 웹 서비스 목록(visiblePages)에는 섞이지 않는다', () {
    expect(visiblePages(s('user')).any((p) => p.group == 'gw'), false);
    final groups = visibleGroups(s('user'));
    expect(groups.map((g) => g.$1.id), ['daily', 'ai', 'work', 'gw']);
    expect(groups.last.$2.map((p) => p.href), ['/gw/approvals', '/gw/attendance', '/gw/today', '/gw/mail', '/gw/board']);
  });
}
