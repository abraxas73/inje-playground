// 메일 본문 HTML → 앱 웹뷰에 그릴 안전한 문서. 아마란스 웹처럼 표·굵게·형광펜 서식을 살리되,
// 신뢰할 수 없는 내용이라 스크립트·프레임·폼·자동 이동·외부 리소스는 없앤다(웹뷰는 JavaScript도 끈다).
import 'dart:convert';
import 'package:html/parser.dart' as html_parser;

const _dropTags = 'script, noscript, iframe, frame, frameset, object, embed, applet, form, input, button, select, textarea, base, link, meta, title, svg, math';

/// 회사 이미지는 [mailInlineImages]가 미리 data:로 바꿔 둔다. 그 밖의 외부·본문 첨부(cid:) 이미지는 표시하지 않는다(CSP img-src data:만). 깨진 그림 대신 숨긴다.
String mailHtmlDocument(String html, {double zoom = 1}) {
  final doc = html_parser.parse(html);
  for (final e in doc.querySelectorAll(_dropTags)) {
    e.remove();
  }
  for (final e in doc.querySelectorAll('*')) {
    e.attributes.removeWhere((k, v) {
      final name = k.toString().toLowerCase();
      final value = v.trim().toLowerCase();
      return name.startsWith('on') || ((name == 'href' || name == 'src' || name == 'action') && value.startsWith('javascript:'));
    });
    if (e.localName == 'img' && !(e.attributes['src'] ?? '').trim().toLowerCase().startsWith('data:')) e.attributes['data-blocked'] = '1';
    if (e.localName == 'a') e.attributes['target'] = '_self';
  }
  final style = doc.head?.querySelectorAll('style').map((s) => s.outerHtml).join() ?? '';
  final body = doc.body?.innerHtml ?? '';
  return '<!doctype html><html><head><meta charset="utf-8">'
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; font-src data:; form-action \'none\'; base-uri \'none\'">'
      '<meta name="viewport" content="width=device-width, initial-scale=1">'
      '<style>html,body{margin:0;padding:0;background:#fff}body{padding:4px 2px 24px;font-family:-apple-system,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif;font-size:15px;line-height:1.6;color:#0B1A3A;word-break:break-word;overflow-wrap:anywhere}'
      'img[data-blocked]{display:none}table{border-collapse:collapse;max-width:100%}td,th{vertical-align:top}pre{white-space:pre-wrap}a{color:#0441FF}'
      '${zoom == 1 ? '' : 'html{zoom:${zoom.toStringAsFixed(2)}}'}</style>'
      '$style</head><body>$body</body></html>';
}

/// 웹뷰가 문서 안에서 가도 되는 주소 — 처음 그리는 빈 문서만. 링크는 시스템 브라우저로 연다(mailHtmlExternal).
bool mailHtmlInitial(String url) => url == 'about:blank' || url.startsWith('data:') || url.isEmpty;
Uri? mailHtmlExternal(String url) {
  final u = Uri.tryParse(url);
  return u != null && (u.scheme == 'https' || u.scheme == 'http' || u.scheme == 'mailto') ? u : null;
}

/// 본문 그림 중 회사 호스트(innogrid.com·그 하위 — 아마란스 mail002A30 본문 그림, 홈페이지 서명 그림) 것만 받아 data:로 바꾼다.
/// 웹뷰는 data:만 그리고(CSP) 외부 호스트는 받지 않는다(수신 확인 픽셀). 상대 경로는 [base] 기준. 바꾼 게 없으면 null.
/// [fetch]는 (Content-Type, 바이트)나 실패 시 null. 그림 하나 8MB·합계 30MB까지.
Future<String?> mailInlineImages(String html, Uri base, Future<(String, List<int>)?> Function(Uri) fetch) async {
  final doc = html_parser.parse(html);
  final targets = <Uri, List<dynamic>>{};
  for (final img in doc.querySelectorAll('img')) {
    final src = (img.attributes['src'] ?? '').trim();
    if (src.isEmpty || src.startsWith('data:') || src.startsWith('cid:')) continue;
    final u = Uri.tryParse(src);
    if (u == null) continue;
    final abs = base.resolveUri(u);
    if (!const {'http', 'https'}.contains(abs.scheme) || !(abs.host == 'innogrid.com' || abs.host.endsWith('.innogrid.com'))) continue;
    (targets[abs] ??= []).add(img);
  }
  if (targets.isEmpty) return null;
  var total = 0, changed = false;
  final got = await Future.wait([for (final u in targets.keys) fetch(u).catchError((_) => null)]);
  for (final (i, u) in targets.keys.indexed) {
    final r = got[i];
    if (r == null || !r.$1.startsWith('image/') || r.$2.length > 8 << 20 || (total += r.$2.length) > 30 << 20) continue;
    final uri = 'data:${r.$1.split(';').first.trim()};base64,${base64Encode(r.$2)}';
    for (final img in targets[u]!) {
      img.attributes['src'] = uri;
    }
    changed = true;
  }
  return changed ? doc.outerHtml : null;
}
