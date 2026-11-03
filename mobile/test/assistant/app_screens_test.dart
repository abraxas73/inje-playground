import 'package:flutter_test/flutter_test.dart';
import 'package:playground/assistant/app_screens.dart';
import 'package:playground/auth/session.dart';

AppSession _s({String role = 'user', Map<String, bool> perms = const {}}) => AppSession(email: 'a@x', role: role, permissions: perms);

void main() {
  test('화면 키 → 경로: 탭·네이티브·Dooray·WebView, 권한·로그인·모르는 키는 이유', () {
    final s = _s();
    expect(screenPath('home', s).path, '/home');
    expect(screenPath('food', s).path, '/food');
    expect(screenPath('gw_mail', s).path, '/gw/mail');
    expect(screenPath('todo', s).path, '/todo');
    expect(screenPath('todo_matrix', s).path, '/todo/matrix');
    expect(screenPath('dooray', s).path, '/dooray/calendar');
    expect(screenPath('jira', s).path, '/web?path=%2Fjira');
    expect(screenPath('manual', s).path, '/web?path=%2Fmanual');
    expect(screenPath('admin_users', s).error, '사용자 관리 화면 권한이 없습니다');
    expect(screenPath('admin_users', _s(role: 'admin')).path, '/web?path=%2Fadmin%2Fusers');
    expect(screenPath('gw_mail', _s(perms: {'gw_mail': false})).error, '메일 화면 권한이 없습니다');
    expect(screenPath('todo_review', _s(perms: {'todo': false})).error, '할 일 권한이 없습니다');
    expect(screenPath('nope', s).error, '모르는 화면입니다: nope');
    expect(screenPath('home', null).error, '로그인이 필요합니다');
  });
}
