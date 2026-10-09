/// 홈 브리핑 — Confluence에서 나를 멘션한 문서·댓글(서버 /api/confluence/feed?kind=mentions). 본문은 받지 않는다(제목·공간·작성자·링크).
class ConfluenceMention {
  const ConfluenceMention({
    required this.title,
    required this.space,
    required this.by,
    required this.url,
  });
  final String title, space, by, url;
}

class ConfluenceBriefing {
  const ConfluenceBriefing({this.items = const []});
  final List<ConfluenceMention> items;
  static ConfluenceBriefing parse(dynamic raw) {
    final list = raw is Map && raw['items'] is List
        ? raw['items'] as List
        : const [];
    return ConfluenceBriefing(
      items: [
        for (final x in list)
          if (x is Map && x['title'] is String && x['url'] is String)
            ConfluenceMention(
              title: x['title'] as String,
              space: x['spaceName'] as String? ?? '',
              by: x['by'] as String? ?? '',
              url: x['url'] as String,
            ),
      ],
    );
  }
}
