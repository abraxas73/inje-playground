import 'package:flutter_test/flutter_test.dart';
import 'package:playground/directory/org_directory.dart';

void main() {
  test('서버 조직도 응답 → 사람 목록(이름 없는 항목은 버림)', () {
    final people = parseOrgPeople({
      'people': [
        {'empSeq': '11', 'name': ' 박석현 ', 'email': 'park@innogrid.com', 'deptName': '플랫폼팀', 'duty': '팀장'},
        {'empSeq': '12', 'name': '', 'email': 'x@innogrid.com'},
        'bad',
      ],
    });
    expect(people, [(empSeq: '11', name: '박석현', email: 'park@innogrid.com', dept: '플랫폼팀', duty: '팀장')]);
    expect(parseOrgPeople(null), isEmpty);
  });
}
