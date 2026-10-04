import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/gw/gw_creds.dart';
import 'package:playground/gw/gw_sign.dart';

const creds = GwCreds(authToken: 'g|7|s', signKey: 'k');
GwClient client(MockClient m, {void Function()? onUnauthorized}) => GwClient(
      httpClient: m, creds: () => creds, now: () => DateTime.fromMillisecondsSinceEpoch(1700000000 * 1000), txId: () => 'f' * 32, onUnauthorized: onUnauthorized);
http.Response ok(Object data) => http.Response(jsonEncode({'resultCode': 0, 'resultMsg': 'SUCCESS', 'resultData': data}), 200, headers: {'content-type': 'application/json'});

void main() {
  test('서명 헤더 4종 + JSON 본문으로 POST하고 resultData를 돌려준다', () async {
    late http.Request seen;
    final c = client(MockClient((r) async { seen = r; return ok({'x': 1}); }));
    final d = await c.call('/eap/api/getMenuCountInfo', {'a': 1});
    expect(d, {'x': 1});
    expect(seen.url.toString(), 'https://gw.innogrid.com/eap/api/getMenuCountInfo');
    expect(seen.headers['Authorization'], 'Bearer g|7|s');
    expect(seen.headers['timestamp'], '1700000000');
    expect(seen.headers['transaction-id'], 'f' * 32);
    expect(seen.headers['wehago-sign'], wehagoSign(authToken: 'g|7|s', transactionId: 'f' * 32, timestamp: '1700000000', path: '/eap/api/getMenuCountInfo', signKey: 'k'));
    expect(seen.headers['Content-Type'], startsWith('application/json'));
    expect(jsonDecode(seen.body), {'a': 1});
  });
  test('resultCode가 문자열 "0"이나 200이어도 성공', () async {
    final c = client(MockClient((_) async => http.Response('{"resultCode":"0","resultData":{"ok":true}}', 200)));
    expect(await c.call('/p', {}), {'ok': true});
    final c2 = client(MockClient((_) async => http.Response('{"resultCode":200,"resultData":[]}', 200)));
    expect(await c2.call('/p', {}), []);
  });
  test('resultCode≠0이면 resultMsg를 담은 GwException', () async {
    final c = client(MockClient((_) async => http.Response('{"resultCode":999,"resultMsg":"nope"}', 200)));
    await expectLater(c.call('/p', {}), throwsA(isA<GwException>().having((e) => e.resultCode, 'code', 999).having((e) => e.message, 'msg', 'nope')));
  });
  test('HTTP 401은 GwUnauthorized + onUnauthorized 콜백, 메시지에 토큰 없음', () async {
    var called = 0;
    final c = client(MockClient((_) async => http.Response('{"resultCode":140,"resultMsg":"no token"}', 401)), onUnauthorized: () => called++);
    await expectLater(c.call('/p', {}), throwsA(isA<GwUnauthorized>().having((e) => e.message.contains('g|7|s'), 'leak', false)));
    expect(called, 1);
  });
  test('네트워크 예외는 GwException(status 0)', () async {
    final c = client(MockClient((_) async => throw http.ClientException('down')));
    await expectLater(c.call('/p', {}), throwsA(isA<GwException>().having((e) => e.status, 'status', 0)));
  });
  test('callForm은 x-www-form-urlencoded', () async {
    late http.Request seen;
    final c = client(MockClient((r) async { seen = r; return ok({}); }));
    await c.callForm('/gw/gw050A02', {'a10Domain': 'https://gw.innogrid.com'});
    expect(seen.headers['Content-Type'], startsWith('application/x-www-form-urlencoded'));
    expect(seen.body, 'a10Domain=https%3A%2F%2Fgw.innogrid.com');
  });
  test('session()은 gw050A02를 한 번만 부르고 10분 캐시, companyInfo 조립', () async {
    var calls = 0;
    final c = client(MockClient((_) async { calls++; return ok({'sessionInfo': {'ucUserInfo': {'compSeq': '10', 'deptSeq': '20', 'empName': '홍길동', 'emailAdd': 'hong', 'emailDomain': 'innogrid.com', 'erpEmpSeq': 'E1', 'erpDeptSeq': 'D1', 'erpCompSeq': 'C1'}}}); }));
    final s = await c.session();
    expect((s.empName, s.email, s.empCd, s.deptCd, s.coCd), ('홍길동', 'hong@innogrid.com', 'E1', 'D1', 'C1'));
    await c.session();
    expect(calls, 1);
    expect(await c.companyInfo(), {'compSeq': '10', 'groupSeq': 'g', 'deptSeq': '20', 'emailAddr': 'hong', 'emailDomain': 'innogrid.com'});
  });
  test('ucUserInfo가 없으면 GwException', () async {
    final c = client(MockClient((_) async => ok({'sessionInfo': {}})));
    await expectLater(c.session(), throwsA(isA<GwException>()));
  });
  test('asStr/asBool/asInt는 혼용 타입을 흡수한다', () {
    expect((asStr(1), asStr('a'), asStr(null), asStr(true)), ('1', 'a', '', 'true'));
    expect([asBool('Y'), asBool(1), asBool('1'), asBool(true), asBool('N'), asBool(0), asBool(null)], [true, true, true, true, false, false, false]);
    expect((asInt('3'), asInt(4), asInt('x', 9)), (3, 4, 9));
  });
}
