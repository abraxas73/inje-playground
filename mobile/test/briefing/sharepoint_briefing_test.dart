import 'package:flutter_test/flutter_test.dart';
import 'package:playground/briefing/sharepoint_briefing.dart';

void main() {
  test(
    'SharePoint 자주 쓰는 문서 — 이름·링크가 있는 항목만, 위치·확장자는 없으면 빈 값, source 기본 used',
    () {
      final b = SharepointBriefing.parse({
        'kind': 'used',
        'source': 'recent',
        'items': [
          {
            'id': '1',
            'driveId': 'd',
            'name': '제안서.pptx',
            'url': 'https://x.sharepoint.com/a',
            'container': '영업본부 › 2026',
            'ext': 'pptx',
          },
          {'id': '2', 'name': '이름만'},
          'bad',
          {'name': '위치 없음', 'url': 'u'},
        ],
      });
      expect(b.source, 'recent');
      expect(b.items.map((x) => x.name), ['제안서.pptx', '위치 없음']);
      expect(b.items.first.container, '영업본부 › 2026');
      expect(b.items.last.container, '');
      expect(b.items.last.ext, '');
      expect(SharepointBriefing.parse(null).items, isEmpty);
      expect(SharepointBriefing.parse(null).source, 'used');
    },
  );
}
