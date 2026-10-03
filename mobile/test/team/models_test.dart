import 'package:flutter_test/flutter_test.dart';
import 'package:playground/features/team/models.dart';

void main() {
  test('parseMemberRows — GET /api/users/members는 {members: [...]}로 온다(배열이 아님)', () {
    final rows = parseMemberRows({
      'members': [
        {'name': '홍길동', 'email': 'h@innogrid.com', 'is_card_holder': true, 'sort_order': 0},
        {'name': '김철수', 'email': null, 'is_card_holder': false, 'sort_order': 1},
      ],
    });
    expect(rows.map((r) => r.name), ['홍길동', '김철수']);
    expect(rows.first.isCardHolder, true);
    expect(parseMemberRows({'members': []}), isEmpty);
    expect(parseMemberRows(const <String, dynamic>{}), isEmpty);
  });
  test('attended — 출석 기본값은 웹 TeamHistory와 같이 false', () {
    expect(attended({'a': true}, 'a'), true);
    expect(attended({'a': false}, 'a'), false);
    expect(attended({}, 'b'), false);
  });
  test('notifyResultMessage — /api/team-notify 응답 {webhook_sent}로만 성공을 판단한다', () {
    expect(notifyResultMessage({'webhook_sent': true}), '알림을 보냈습니다.');
    expect(notifyResultMessage({'webhook_sent': false}), '알림 채널이 설정되지 않았거나 전송에 실패했습니다.');
    expect(notifyResultMessage({}), '알림 채널이 설정되지 않았거나 전송에 실패했습니다.');
  });
}
