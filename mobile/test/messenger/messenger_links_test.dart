import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/messenger/messenger_links.dart';

void main() {
  test('본문에서 주소를 가른다 — 끝 문장부호·짝 없는 괄호는 빼고, 줄바꿈 뒤 글은 글로', () {
    final p = splitLinks('https://ipipeline.vercel.app/\n(사업기획실 3명 부탁드립니다~)');
    expect(p.first, (text: 'https://ipipeline.vercel.app/', url: true));
    expect(p.last.url, isFalse);
    expect(splitLinks('보세요 (https://a.com/x).').where((e) => e.url).single.text, 'https://a.com/x');
    expect(splitLinks('위키 https://ko.wikipedia.org/wiki/A_(B) 참고').where((e) => e.url).single.text, 'https://ko.wikipedia.org/wiki/A_(B)');
    expect(splitLinks('주소 없음').single.url, isFalse);
  });

  test('미리보기는 첫 주소 하나, 루프백·링크로컬은 제외', () {
    expect(firstPreviewUrl('http://localhost:3000 그리고 https://b.com'), 'https://b.com');
    expect(firstPreviewUrl('http://169.254.1.1/x'), isNull);
    expect(firstPreviewUrl('글만'), isNull);
  });

  test('og 메타 → 제목·설명·그림(상대 주소 풀기), 없으면 <title>', () {
    final m = parseLinkMeta('<html><head><meta property="og:title" content="파이프라인"><meta name="description" content="영업 현황"><meta property="og:image" content="/og.png"></head></html>', Uri.parse('https://ipipeline.vercel.app/'))!;
    expect(m.title, '파이프라인');
    expect(m.description, '영업 현황');
    expect(m.image, 'https://ipipeline.vercel.app/og.png');
    expect(m.site, 'ipipeline.vercel.app');
    expect(parseLinkMeta('<title> 그냥 제목 </title>', Uri.parse('https://x.com'))!.title, '그냥 제목');
    expect(parseLinkMeta('<p>no title</p>', Uri.parse('https://x.com')), isNull);
  });

  test('페이지 받기 실패·HTML 아님이면 카드 없음', () async {
    expect(await fetchLinkMeta('https://t1.example/', client: MockClient((_) async => http.Response('x', 404))), isNull);
    expect(await fetchLinkMeta('https://t2.example/a.pdf', client: MockClient((_) async => http.Response('%PDF', 200, headers: {'content-type': 'application/pdf'}))), isNull);
    final ok = await fetchLinkMeta('https://t3.example/', client: MockClient((_) async => http.Response('<meta property="og:title" content="좋음">', 200, headers: {'content-type': 'text/html; charset=utf-8'})));
    expect(ok?.title, '좋음');
  });

  testWidgets('말풍선 글의 주소에 밑줄·누르기가 걸린다', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: LinkifiedText('https://a.com/ 보세요', style: TextStyle(), linkColor: Colors.blue))));
    TextSpan? link;
    tester.widget<RichText>(find.byType(RichText)).text.visitChildren((s) {
      if (s is TextSpan && s.text == 'https://a.com/') link = s;
      return link == null;
    });
    expect(link!.recognizer, isA<TapGestureRecognizer>());
    expect(link!.style!.decoration, TextDecoration.underline);
  });
}
