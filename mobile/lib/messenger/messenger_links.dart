import 'dart:async';
import 'dart:convert';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:html/parser.dart' as html_parser;
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';
import '../app/theme.dart';

/// 메신저 대화 본문의 링크 — 주소는 눌러 열고, 첫 주소 하나는 말풍선 아래 미리보기 카드(제목·설명·그림).
/// 메신저 앱 `DZChatItem.vue`·`useOgPreview.js`와 같은 규칙: 텍스트 대화만, 비밀대화 제외, 루프백·링크로컬 주소 제외.

final _urlRe = RegExp(r'https?://[^\s<>"]+', caseSensitive: false);

/// 본문 → (글, 주소) 조각. 주소 끝의 문장부호·닫는 괄호(짝 없는)는 주소에서 뺀다.
List<({String text, bool url})> splitLinks(String s) {
  final out = <({String text, bool url})>[];
  var at = 0;
  for (final m in _urlRe.allMatches(s)) {
    var u = m.group(0)!;
    while (u.isNotEmpty && '.,;:!?\'"'.contains(u[u.length - 1]) || (u.endsWith(')') && '('.allMatches(u).length < ')'.allMatches(u).length)) {
      u = u.substring(0, u.length - 1);
    }
    if (m.start > at) out.add((text: s.substring(at, m.start), url: false));
    out.add((text: u, url: true));
    at = m.start + u.length;
  }
  if (at < s.length) out.add((text: s.substring(at), url: false));
  return out;
}

/// 미리보기를 만들 첫 주소(없으면 null).
String? firstPreviewUrl(String s) {
  for (final p in splitLinks(s)) {
    if (p.url && isPreviewableUrl(p.text)) return p.text;
  }
  return null;
}

bool isPreviewableUrl(String url) {
  final h = Uri.tryParse(url)?.host.toLowerCase() ?? '';
  if (h.isEmpty) return false;
  return !(h == 'localhost' || h.endsWith('.localhost') || h.startsWith('127.') || h.startsWith('169.254.') || h == '0.0.0.0' || h == '[::1]' || h == '::1');
}

Future<void> openLink(String url) async {
  final u = Uri.tryParse(url);
  if (u != null) await launchUrl(u, mode: LaunchMode.externalApplication);
}

/// 주소에 밑줄·눌러 열기를 건 본문(끌어 선택·복사는 그대로).
class LinkifiedText extends StatefulWidget {
  const LinkifiedText(this.text, {super.key, required this.style, required this.linkColor});
  final String text;
  final TextStyle style;
  final Color linkColor;
  @override
  State<LinkifiedText> createState() => _LinkifiedTextState();
}

class _LinkifiedTextState extends State<LinkifiedText> {
  final _taps = <TapGestureRecognizer>[];

  void _clear() {
    for (final t in _taps) {
      t.dispose();
    }
    _taps.clear();
  }

  @override
  void dispose() {
    _clear();
    super.dispose();
  }

  TapGestureRecognizer _tap(String url) {
    final t = TapGestureRecognizer()..onTap = () => openLink(url);
    _taps.add(t);
    return t;
  }

  @override
  Widget build(BuildContext context) {
    final parts = splitLinks(widget.text);
    if (!parts.any((p) => p.url)) return Text(widget.text, style: widget.style);
    _clear();
    return Text.rich(TextSpan(style: widget.style, children: [
      for (final p in parts)
        p.url
            ? TextSpan(
                text: p.text,
                style: TextStyle(color: widget.linkColor, decoration: TextDecoration.underline, decorationColor: widget.linkColor),
                mouseCursor: SystemMouseCursors.click,
                recognizer: _tap(p.text),
              )
            : TextSpan(text: p.text),
    ]));
  }
}

typedef LinkMeta = ({String title, String description, String? image, String site});

// ponytail: 미리보기는 앱이 켜져 있는 동안 주소별로 한 번만 받는다 — 많아지면 LRU로
final _previews = <String, Future<LinkMeta?>>{};

/// 페이지를 받아 og:·twitter:·<title>로 미리보기 정보. 실패·HTML 아님·제목 없음이면 null.
Future<LinkMeta?> fetchLinkMeta(String url, {http.Client? client}) => _previews.putIfAbsent(url, () async {
      final c = client ?? http.Client();
      try {
        final res = await c.get(Uri.parse(url), headers: {'User-Agent': 'Mozilla/5.0 (compatible; INNOCREW link preview)', 'Accept': 'text/html'}).timeout(const Duration(seconds: 8));
        if (res.statusCode >= 400 || !(res.headers['content-type'] ?? 'text/html').contains('html')) return null;
        final body = res.bodyBytes.length > 512 * 1024 ? res.bodyBytes.sublist(0, 512 * 1024) : res.bodyBytes;
        return parseLinkMeta(utf8.decode(body, allowMalformed: true), Uri.parse(url));
      } catch (_) {
        return null;
      } finally {
        if (client == null) c.close();
      }
    });

/// HTML → 미리보기 정보(순수 함수).
LinkMeta? parseLinkMeta(String html, Uri base) {
  final doc = html_parser.parse(html);
  String meta(List<String> keys) {
    for (final k in keys) {
      final e = doc.querySelector('meta[property="$k"]') ?? doc.querySelector('meta[name="$k"]');
      final v = e?.attributes['content']?.trim() ?? '';
      if (v.isNotEmpty) return v;
    }
    return '';
  }
  final title = meta(['og:title', 'twitter:title']).isNotEmpty ? meta(['og:title', 'twitter:title']) : (doc.querySelector('title')?.text.trim() ?? '');
  if (title.isEmpty) return null;
  final img = meta(['og:image', 'og:image:url', 'twitter:image']);
  return (
    title: title,
    description: meta(['og:description', 'twitter:description', 'description']),
    image: img.isEmpty ? null : base.resolve(img).toString(),
    site: meta(['og:site_name']).isNotEmpty ? meta(['og:site_name']) : base.host,
  );
}

/// 말풍선 아래 미리보기 카드 — 받는 중·실패면 아무것도 그리지 않는다.
class LinkPreviewCard extends StatelessWidget {
  const LinkPreviewCard({super.key, required this.url, required this.maxWidth});
  final String url;
  final double maxWidth;

  @override
  Widget build(BuildContext context) => FutureBuilder<LinkMeta?>(
        future: fetchLinkMeta(url),
        builder: (context, s) {
          final m = s.data;
          if (m == null) return const SizedBox.shrink();
          return Container(
            margin: const EdgeInsets.only(top: 4),
            constraints: BoxConstraints(maxWidth: maxWidth.clamp(200, 360).toDouble()),
            child: Material(
              color: Brand.surface,
              shape: RoundedRectangleBorder(side: BorderSide(color: Brand.line), borderRadius: BorderRadius.circular(12)),
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: () => openLink(url),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
                  if (m.image != null)
                    AspectRatio(aspectRatio: 1.91, child: Image.network(m.image!, fit: BoxFit.cover, errorBuilder: (_, _, _) => const SizedBox.shrink())),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(m.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Brand.navy)),
                      if (m.description.isNotEmpty)
                        Padding(padding: const EdgeInsets.only(top: 2), child: Text(m.description, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, color: Brand.muted))),
                      Padding(padding: const EdgeInsets.only(top: 4), child: Text(m.site, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 11, color: Brand.faint))),
                    ]),
                  ),
                ]),
              ),
            ),
          );
        },
      );
}
