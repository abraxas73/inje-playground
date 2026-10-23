import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/gw/gw_api.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/gw/mail_compose.dart';
import 'fakes.dart';

http.Response _ok(Object? data) => http.Response.bytes(utf8.encode(jsonEncode({'resultCode': 0, 'resultData': data})), 200, headers: {'content-type': 'application/json; charset=utf-8'});

/// multipart 본문 → 칸 이름: 값.
Map<String, String> _fields(String raw) => {
      for (final m in RegExp(r'name="([^"]+)"\r\n(?:[^\r\n]+\r\n)*\r\n(.*?)\r\n--', dotAll: true).allMatches(raw)) m[1]!: m[2]!,
    };

final _init = {
  'email': 'me@innogrid.com', 'sessionKey': 'S', 'signature': '<html><head><title>x</title></head><body><b>서명</b></body></html>',
  'mailInfo': {
    'muid': '777',
    'decodeMime': {'from': '김철수 &lt;kim@innogrid.com&gt;', 'to': '나 &lt;me@innogrid.com&gt;, 박영희 &lt;park@innogrid.com&gt;', 'cc': '이민수 &lt;lee@innogrid.com&gt;', 'subject': '주간 보고', 'date': '2026-10-23 09:00'},
    'mime': {
      'header': {'message-id': '<abc@x>'},
      'body': {'html': '<p>원문</p>'},
      'fileList': [{'fileSn': '0', 'originalFileName': '보고서.pdf'}],
    },
  },
};

void main() {
  test('답장 — 보낸 사람에게, Re: 제목, 웹과 같은 인용 머리 + 원문', () {
    final p = mailPrefill(MailKind.reply, _init, myEmail: 'me@innogrid.com');
    expect(p.to, '김철수 <kim@innogrid.com>');
    expect(p.subject, 'Re: 주간 보고');
    expect(p.quote, contains('<hr dze_content_sep />'));
    expect(p.quote, contains("<p style='color: rgb(0, 0, 0);'>보내는사람: 김철수"));
    expect(p.quote, contains('받는사람 : '));
    expect(p.quote, contains('참조 : '));
    expect(p.quote, endsWith('<p>원문</p>'));
    expect(p.originalFiles, isEmpty);
  });

  test('전체 답장 — 보낸 사람 + 받는 사람(나 제외), 참조 유지', () {
    final p = mailPrefill(MailKind.replyAll, _init, myEmail: 'me@innogrid.com');
    expect(p.to, '김철수 <kim@innogrid.com>, 박영희 <park@innogrid.com>');
    expect(p.cc, '이민수 <lee@innogrid.com>');
  });

  test('전달 — 받는 사람 비움, FW: 제목, 원본 첨부 목록', () {
    final p = mailPrefill(MailKind.forward, _init, myEmail: 'me@innogrid.com');
    expect((p.to, p.subject), ('', 'FW: 주간 보고'));
    expect(p.originalFiles, [(sn: '0', name: '보고서.pdf')]);
  });

  test('본문 = 내 글(줄바꿈) + 서명 + 인용, 서명은 html·head 껍데기 제거', () {
    expect(mailSignatureHtml(_init), '<b>서명</b>');
    expect(mailBodyHtml('안녕\n하세요', signature: '<b>서명</b>', quote: '<Q>'), '안녕<br>하세요<br/><br/><b>서명</b><Q>');
  });

  test('전달 보내기 — mail_kind fw·원본 muid·mimeHeader·원본 첨부(A08)+새 파일(A06)을 uidAuthList로', () async {
    final raws = <String, String>{};
    final client = MockClient((r) async {
      raws[r.url.path] = r.body;
      return switch (r.url.path) {
        '/gw/gw050A02' => _ok({'sessionInfo': {'ucUserInfo': {'compSeq': '10', 'deptSeq': '20', 'empName': '나', 'emailAdd': 'me', 'emailDomain': 'innogrid.com'}}}),
        '/mail/mail014A08' => _ok({'list': [{'fileId': 'F1', 'originalFileName': '보고서.pdf', 'fileExtsn': 'pdf', 'fileSize': 2048, 'filePath': '/a'}]}),
        '/mail/mail014A06' => _ok({'list': [{'fileId': 'N1', 'originalFileName': '새파일.txt', 'fileExtsn': 'txt', 'fileSize': 3, 'filePath': '/b'}]}),
        '/mail/mail014A04' => _ok({'result': true}),
        _ => http.Response('{"resultCode":999}', 200),
      };
    });
    final api = GwApi(GwClient(httpClient: client, creds: () => testCreds));
    await api.mailSendComposed(kind: MailKind.forward, init: _init, to: 'a@x.com', subject: 'FW: 주간 보고', html: '<p>보세요</p>', keepFiles: ['0'], newFiles: [(name: '새파일.txt', bytes: utf8.encode('abc'))]);
    final f = _fields(raws['/mail/mail014A04']!);
    expect((f['mail_kind'], f['muid'], f['fwFile'], f['to'], f['bigFileCnt']), ('fw', '777', '보고서.pdf', 'a@x.com', '2'));
    expect(jsonDecode(f['mimeHeader']!), {'message-id': '<abc@x>'});
    final uid = (jsonDecode(f['uidAuthList']!) as List).cast<Map>();
    expect([for (final u in uid) u['fileId']], ['N1', 'F1']); // 새 파일 먼저(웹과 같음)
    expect((uid[1]['serverFile'], uid[1]['fileSn'], uid[1]['moduleGbn']), ('Y', '0', 'MAIL'));
    expect(jsonDecode(uid[1]['authKeyMap'] as String)['muid'], '777');
  });

  test('새 메일 보내기 — mail_kind plain·muid 0·mimeHeader 빈 값, 실패 응답은 오류', () async {
    String? raw;
    var result = true;
    final client = MockClient((r) async {
      if (r.url.path == '/mail/mail014A04') {
        raw = r.body;
        return _ok({'result': result});
      }
      return _ok({'sessionInfo': {'ucUserInfo': {'empName': '나', 'emailAdd': 'me', 'emailDomain': 'innogrid.com'}}});
    });
    final api = GwApi(GwClient(httpClient: client, creds: () => testCreds));
    final init = {'email': 'me@innogrid.com'};
    await api.mailSendComposed(kind: MailKind.plain, init: init, to: 'a@x.com', subject: '', html: 'hi');
    final f = _fields(raw!);
    expect((f['mail_kind'], f['muid'], f['mimeHeader'], f['subject']), ('plain', '0', '', '(제목없음)'));
    result = false;
    await expectLater(api.mailSendComposed(kind: MailKind.plain, init: init, to: 'a@x.com', subject: 's', html: 'hi'), throwsA(isA<GwException>()));
  });
}
