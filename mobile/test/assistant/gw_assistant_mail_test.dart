// mobile/test/assistant/gw_assistant_mail_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:playground/gw/gw_client.dart';
import 'package:playground/assistant/gw_assistant_api.dart';
import 'gw_assistant_api_test.dart' show Gw, base;

const init = {'email': 'hong@innogrid.com', 'filedir': 'D1', 'sessionKey': 'SK', 'externalSendLimit': 'N', 'bigFileDay': '7', 'insideDomainArray': ['innogrid.com'], 'groupMailOption': {'groupMailAddr': 'GA', 'groupMailIntedAddr': 'GI', 'groupMailOrg': 'GO'}, 'mailkey': 'MK'};

void main() {
  test('textToHtml — 이스케이프 + 줄바꿈 <br>', () {
    expect(textToHtml('안녕하세요\n<회의> & 자료'), '안녕하세요<br>&lt;회의&gt; &amp; 자료');
  });
  test('composeFields — A01 값으로 발송 폼(inno-creed ComposeForm), body authToken은 로그인ID|토큰', () {
    final f = composeFields(init, fromName: '홍길동', bodyAuth: 'hong|g|7|s', to: 'a@x,b@y', cc: '', subject: '제목', html: '<p>본문</p>');
    expect((f['from'], f['email'], f['fromName'], f['to'], f['subject'], f['htmlContents']), ('hong@innogrid.com', 'hong@innogrid.com', '홍길동', 'a@x,b@y', '제목', '<p>본문</p>'));
    expect((f['fileDir'], f['sessionKey'], f['bigFileDay'], f['bigFileCnt'], f['muid'], f['mail_kind'], f['authToken']), ('D1', 'SK', '7', '0', '0', 'plain', 'hong|g|7|s'));
    expect(f['insideDomainArray'], '["innogrid.com"]');
    expect((f['neobizaddr'], f['neobizIntedAddr'], f['neobizOrg']), ('GA', 'GI', 'GO'));
    expect(f['immediately'], 'false');
  });
  test('mailRead — mail002A01, 평문 우선, 8000자 절단', () async {
    final gw = Gw({...base(), '/mail/mail002A01': (_) => {'decodeMime': {'subject': '견적 요청', 'from': '박지훈 &lt;p@x&gt;', 'date': '2026-10-05 09:12'}, 'mime': {'body': {'plain': '', 'html': '<p>${'가' * 9000}</p>'}}}});
    final r = await gw.api().mailRead('M1');
    expect(gw.calls['/mail/mail002A01']!.single, {'uid': 'M1'});
    expect((r['muid'], r['subject'], r['from'], r['date']), ('M1', '견적 요청', '박지훈 <p@x>', '2026-10-05 09:12'));
    expect((r['body'] as String).length, 8001);
  });
  test('mailSend — A01 → A04(multipart), resultData.result로 판정; 실패면 예외', () async {
    final gw = Gw({...base(), '/mail/mail014A01': (_) => init, '/mail/mail014A04': (_) => {'result': true, 'muid': 9}});
    final r = await gw.api().mailSend(to: ['a@x', 'b@y'], cc: ['c@z'], subject: '회의록', body: '첫 줄\n둘째 줄');
    expect(r, {'ok': true, 'sent': true, 'to': 'a@x,b@y', 'cc': 'c@z', 'subject': '회의록'});
    final raw = gw.rawBodies['/mail/mail014A04']!;
    for (final w in ['name="to"', 'a@x,b@y', 'name="cc"', 'c@z', '첫 줄<br>둘째 줄', 'name="authToken"', 'hong|g|7|s']) {
      expect(raw, contains(w), reason: w);
    }
    final bad = Gw({...base(), '/mail/mail014A01': (_) => init, '/mail/mail014A04': (_) => {'result': false}});
    await expectLater(bad.api().mailSend(to: ['a@x'], subject: 's', body: 'b'), throwsA(anything));
  });
  test('mailSaveDraft — A14 + 임시저장 필드, autoMUID 반환', () async {
    final gw = Gw({...base(), '/mail/mail014A01': (_) => init, '/mail/mail014A14': (_) => {'autoMUID': 'D9'}});
    expect(await gw.api().mailSaveDraft(to: ['a@x'], subject: '초안', body: '내용'), {'ok': true, 'draftMuid': 'D9', 'subject': '초안'});
    final raw = gw.rawBodies['/mail/mail014A14']!;
    for (final w in ['name="draftType"', 'name="isFirst"', 'name="beforeMailType"']) {
      expect(raw, contains(w));
    }
    final none = Gw({...base(), '/mail/mail014A01': (_) => init, '/mail/mail014A14': (_) => {'autoMUID': ''}});
    await expectLater(none.api().mailSaveDraft(to: ['a@x'], subject: 's', body: 'b'), throwsA(anything));
  });
  test('search — gw018A02 {header, body}, 모듈별 정규화(다국어 객체는 kr)', () async {
    final gw = Gw({...base(), '/gw/APIHandler/gw018A02': (b) {
      final bt = (b['body'] as Map)['boardType'];
      return switch (bt) {
        '0' => {'totalcount': 1, 'resultgrid': [{'muid': 'M1', 'subject': '연차 안내', 'rfc822date': '2026-10-01', 'fromAddrName': '인사팀'}]},
        '6' => {'totalcount': 1, 'resultgrid': [{'docId': 'D1', 'formId': 'F1', 'docTitle': '연차 신청', 'rep_dt': '2026-10-02', 'userNm': {'kr': '이서연', 'en': 'Lee'}}]},
        _ => {'totalcount': 0, 'resultgrid': []},
      };
    }});
    final r = await gw.api().search('연차');
    expect(r['total'], 2);
    final items = r['items'] as List;
    expect(items.map((e) => '${e['module']}|${e['title']}|${e['who']}'), ['메일|연차 안내|인사팀', '결재|연차 신청|이서연']);
    expect(items.first['muid'], 'M1');
    expect((items[1]['docId'], items[1]['formId']), ('D1', 'F1'));
    final b0 = gw.calls['/gw/APIHandler/gw018A02']!.first;
    expect(b0['header'], {});
    expect(((b0['body'] as Map)['tsearchKeyword'], (b0['body'] as Map)['dateDiv']), ('연차', ''));
    expect(gw.calls['/gw/APIHandler/gw018A02']!.length, 6, reason: '전체 = 6개 모듈');
    final one = Gw({...base(), '/gw/APIHandler/gw018A02': (_) => {'totalcount': 0, 'resultgrid': []}});
    await one.api().search('x', scope: '게시판');
    expect(((one.calls['/gw/APIHandler/gw018A02']!.single['body']) as Map)['boardType'], '9');
  });
  test('search — 인증 만료는 다시 던지고, 모든 모듈이 실패하면 예외(빈 결과로 위장 금지)', () async {
    final unauth = Gw({...base(), '/gw/APIHandler/gw018A02': (_) => http.Response('', 401)});
    await expectLater(unauth.api().search('x'), throwsA(isA<GwUnauthorized>()));
    final down = Gw({...base(), '/gw/APIHandler/gw018A02': (_) => http.Response('{"resultCode":999,"resultMsg":"x"}', 200)});
    await expectLater(down.api().search('x'), throwsA(isA<GwException>()));
  });
}
