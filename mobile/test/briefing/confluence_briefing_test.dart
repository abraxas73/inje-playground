import 'package:flutter_test/flutter_test.dart';
import 'package:playground/briefing/confluence_briefing.dart';

void main() {
  test('Confluence 멘션 — 제목·링크가 있는 항목만, 공간·작성자는 없으면 빈 값', () {
    final b = ConfluenceBriefing.parse({
      'items': [
        {'id': '1', 'title': '주간회의', 'url': 'https://pms-innogrid.atlassian.net/wiki/x', 'spaceName': '개발', 'by': '홍길동'},
        {'id': '2', 'title': '제목만'},
        'bad',
        {'title': '공간 없음', 'url': 'u'},
      ],
    });
    expect(b.items.map((x) => x.title), ['주간회의', '공간 없음']);
    expect(b.items.last.space, '');
    expect(ConfluenceBriefing.parse(null).items, isEmpty);
  });
}
