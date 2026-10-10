/// 홈 브리핑 — 자주 쓰는 SharePoint 문서(서버 /api/sharepoint/feed?kind=used, 인사이트가 꺼진 조직이면 최근 연 문서). 본문은 받지 않는다(이름·위치·링크).
class SharepointDoc {
  const SharepointDoc({
    required this.name,
    required this.container,
    required this.url,
    this.ext = '',
  });
  final String name, container, url, ext;
}

class SharepointBriefing {
  const SharepointBriefing({this.items = const [], this.source = 'used'});
  final List<SharepointDoc> items;

  /// 'used' 또는 'recent'(인사이트 꺼짐 — 화면 제목이 달라진다)
  final String source;
  static SharepointBriefing parse(dynamic raw) {
    final list = raw is Map && raw['items'] is List
        ? raw['items'] as List
        : const [];
    return SharepointBriefing(
      source: raw is Map && raw['source'] is String
          ? raw['source'] as String
          : 'used',
      items: [
        for (final x in list)
          if (x is Map && x['name'] is String && x['url'] is String)
            SharepointDoc(
              name: x['name'] as String,
              container: x['container'] as String? ?? '',
              url: x['url'] as String,
              ext: x['ext'] as String? ?? '',
            ),
      ],
    );
  }
}
