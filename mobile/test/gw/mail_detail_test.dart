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
