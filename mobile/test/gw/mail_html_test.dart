import 'package:flutter_test/flutter_test.dart';
import 'package:playground/gw/gw_models.dart';
import 'package:playground/gw/mail_html.dart';

void main() {
  test('mailHtmlDocument — 서식(표·굵게·형광펜)은 두고, 스크립트·프레임·폼·자동 이동·이벤트·javascript: 링크는 없앤다', () {
    final doc = mailHtmlDocument('<html><head><style>.hl{background:#ccff66}</style><meta http-equiv="refresh" content="0;url=https://evil.test"><script>alert(1)</script></head>'
        '<body onload="x()"><p>현재 정책서의 <span class="hl"><b>1 CPU</b></span></p><table border="1"><tr><td>구분</td></tr></table>'
        '<iframe src="https://evil.test"></iframe><form action="https://evil.test"><input name="p"></form><a href="javascript:alert(1)">나쁨</a><a href="https://ok.test/a">링크</a>'
        '<img src="https://cdn.example.com/a.png" onerror="x()"><img src="cid:inline1"><img src="data:image/png;base64,AAAA"></body></html>');
    expect(doc, contains('<span class="hl"><b>1 CPU</b></span>'));
    expect(doc, contains('<table border="1">'));
    expect(doc, contains('.hl{background:#ccff66}'));
    for (final bad in ['<script', 'alert(1)</script>', '<iframe', '<form', '<input', 'onload', 'onerror', 'javascript:', 'http-equiv="refresh"', 'evil.test']) {
      expect(doc, isNot(contains(bad)), reason: bad);
    }
    expect(doc, contains("default-src 'none'; img-src data:"));
    expect(RegExp(r'<img data-blocked="1"|<img [^>]*data-blocked="1"').allMatches(doc).length, 2); // 외부·cid 이미지는 숨김
    expect(doc, contains('src="data:image/png;base64,AAAA"'));
    expect(doc, contains('href="https://ok.test/a"'));
  });

  test('웹뷰 이동 — 처음 빈 문서만 허용, 링크는 http(s)·mailto만 브라우저로', () {
    expect(mailHtmlInitial('about:blank'), isTrue);
    expect(mailHtmlInitial('https://ok.test'), isFalse);
    expect(mailHtmlExternal('https://ok.test/a')?.host, 'ok.test');
    expect(mailHtmlExternal('mailto:a@innogrid.com')?.scheme, 'mailto');
    expect(mailHtmlExternal('file:///etc/passwd'), isNull);
    expect(mailHtmlExternal('javascript:alert(1)'), isNull);
  });

  test('MailDetail은 원본 HTML을 보관한다(상세 화면이 서식째 그림)', () {
    final m = MailDetail.fromRaw('1', {'mime': {'body': {'html': '<b>본문</b>', 'plain': '본문'}}});
    expect(m.html, '<b>본문</b>');
    expect(m.body, '본문');
  });
}
