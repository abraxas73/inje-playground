import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/gw/gw_api.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/gw/gw_creds.dart';
import 'package:playground/gw/gw_models.dart';

const _creds = GwCreds(authToken: 'g|7|s', signKey: 'k');
final _now = DateTime(2026, 10, 11, 10);

void main() {
  test('mail002A01 원본 → 본문 모델(plain 우선, 첨부 이름·크기, 외부 이미지 수)', () {
    final m = MailDetail.fromRaw('101', {
      'decodeMime': {'subject': '회의 &amp; 안내', 'from': '김 &lt;k@x.com&gt;', 'to': '나', 'cc': '', 'date': '2026-10-11 09:00:00'},
      'mime': {
        'body': {'plain': '  10시 회의실 A\r\n\r\n\r\n\r\n참석 바랍니다 ', 'html': '<p>10시</p><img src="https://cdn.example.com/a.png"><img src="cid:inline1"><img src="https://gw.innogrid.com/x.png">'},
        'fileList': [{'originalFileName': 'agenda.pdf', 'fileSize': 4000}, {'originalFileName': '', 'fileSize': 1}],
      },
    });
    expect((m.subject, m.from, m.to, m.date), ('회의 & 안내', '김 <k@x.com>', '나', '2026-10-11 09:00:00'));
    expect(m.body, '10시 회의실 A\n\n참석 바랍니다');
    expect(m.attachments, [('agenda.pdf', 3000)]);
    expect(m.remoteImages, 1);
    expect(MailDetail.fromRaw('1', {'mime': {'body': {'html': '<b>본문</b><br>둘째 줄'}}}).body, contains('본문'));
    expect(MailDetail.fromRaw('1', const {}).body, '');
  });

  test('plain 본문의 HTML 엔티티(&nbsp;·&lt;·숫자 참조)를 글자로 되돌린다 — 아마란스 plain은 태그만 벗긴 채 엔티티를 남긴다', () {
    final m = MailDetail.fromRaw('1', {'mime': {'body': {'plain': '&nbsp;대표님, 박창원입니다.\r\n&nbsp;메일로&nbsp;\r\n&lt;a@x.com&gt; &amp;lt; &#39;따옴표&#x27; &#8203;끝', 'html': '<p>&nbsp;대표님</p>'}}});
    expect(m.body, '대표님, 박창원입니다.\n메일로\n<a@x.com> &lt; \'따옴표\' \u200b끝');
    expect(mailBodyText({'plain': '', 'html': '<p>&nbsp;둘째</p>'}), '둘째');
    expect(mailBodyText({'plain': 'a &lt; b'}), 'a &lt; b', reason: 'html 부분이 없는 순수 텍스트 메일은 글자 그대로');
  });

  test('표가 있는 HTML 메일은 html에서 변환 — 행마다 한 줄, 칸은 " | "; head·style·주석은 버린다(아마란스 plain은 칸마다 빈 줄로 벌어진다)', () {
    const html = '<html><head><title>t</title><style>td{color:red}</style></head><body><!--[if mso]>x<![endif]--><p>안녕하세요.</p>\n<table>\n <tr>\n  <th>구분</th>\n  <th>기사 제목</th>\n </tr>\n <tr>\n  <td>MS</td>\n  <td>자체 AI칩 &#39;마이아&#39; 공개</td>\n  <td></td>\n </tr>\n</table>\n<p>감사합니다.</p></body></html>';
    const plain = '\n \n \n  안녕하세요.\n  \n   \n    구분\n    \n    기사 제목\n   \n   \n    MS\n    \n    자체 AI칩 &#39;마이아&#39; 공개\n  \n  감사합니다.\n';
    expect(mailBodyText({'plain': plain, 'html': html}), '안녕하세요.\n구분 | 기사 제목\nMS | 자체 AI칩 \'마이아\' 공개\n감사합니다.');
    expect(htmlToText('<TABLE><TR><TD>a</TD><td>b<br>c</td></TR></TABLE>'), 'a | b\nc', reason: '칸 안의 br은 줄을 나누되 칸 구분은 유지');
    expect(mailBodyText({'plain': '  10시\r\n', 'html': '<p>10시</p>'}), '10시', reason: '표가 없으면 종전대로 plain');
  });

  test('splitRecipients — 쉼표로 나누되 따옴표·<주소> 안의 쉼표는 지킨다', () {
    expect(splitRecipients('김 <k@x.com>,양<y@x.com>, "박, 지연" <p@x.com> ,,head_dep<h@x.com>'), ['김 <k@x.com>', '양<y@x.com>', '"박, 지연" <p@x.com>', 'head_dep<h@x.com>']);
    expect(splitRecipients(''), isEmpty);
  });

  test('readMail·markMailUnread 호출 경로·인자', () async {
    final calls = <(String, Map<String, dynamic>)>[];
    final api = GwApi(GwClient(httpClient: MockClient((r) async {
      calls.add((r.url.path, jsonDecode(r.body) as Map<String, dynamic>));
      final data = r.url.path.endsWith('mail002A01') ? {'decodeMime': {'subject': 's'}, 'mime': {'body': {'plain': 'b'}}} : {};
      return http.Response(jsonEncode({'resultCode': 0, 'resultData': data}), 200, headers: {'content-type': 'application/json'});
    }), creds: () => _creds, now: () => _now), now: () => _now);
    final m = await api.readMail('77');
    expect((m.muid, m.subject, m.body), ('77', 's', 'b'));
    await api.markMailUnread('77');
    expect(calls.map((c) => c.$1).toList(), ['/mail/mail002A01', '/mail/mail002A15']);
    expect(calls[0].$2['uid'], '77');
    expect(calls[1].$2, containsPair('uids', '77'));
    expect(calls[1].$2, containsPair('type', 'unseen'));
  });
}
