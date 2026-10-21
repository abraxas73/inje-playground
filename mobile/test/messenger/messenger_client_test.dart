import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/messenger/messenger_client.dart';
import 'package:playground/messenger/messenger_crypto.dart';

http.Response _json(Object o) => http.Response(jsonEncode(o), 200, headers: {'content-type': 'application/json'});

/// 프로토콜 표 + get_token + P076 로그인 + 임의 호출을 흉내 내는 서버.
MockClient fakeServer({required Map<String, Object?> onLoginData, Map<String, Object?> Function(String pid, Map body)? onCall}) {
  return MockClient((r) async {
    final path = r.url.path;
    if (path == '/get_token/') return _json({'token': 'tok', 'cur_date': '20261021'});
    if (path == '/proxymgw/proxymgw01A01') {
      return _json({'resultCode': 0, 'resultData': {'protocolList': [
        {'protocolId': 'P076', 'protocolUrl': 'https://gw.innogrid.com/proxymgw/proxymgw17A14'},
        {'protocolId': 'P077', 'protocolUrl': 'https://gw.innogrid.com/proxymgw/proxymgw29A39'},
      ]}});
    }
    final env = jsonDecode(r.body) as Map;
    final pid = (env['header'] as Map)['pid'];
    if (pid == 'P076') return _json({'resultCode': 0, 'resultData': onLoginData});
    final data = onCall?.call(pid as String, env['body'] as Map) ?? {'resultCode': 0, 'resultData': {}};
    return _json(data);
  });
}

MessengerClient client(MockClient m, {String id = 'u', String pw = 'p'}) => MessengerClient(
      httpClient: m,
      loadCreds: () async => (id: id, pw: pw),
      now: () => DateTime.fromMillisecondsSinceEpoch(1700000000000),
      txId: () => 'f' * 32,
    );

void main() {
  group('로그인 암호화(AES-256-CBC, 키표)', () {
    test('모든 kNum에서 라운드트립이 원문을 복원한다', () {
      for (var k = 0; k < 10; k++) {
        const plain = 'seunguk.kang@INNOGRID!한글';
        expect(decryptLoginData(encryptLoginData(plain, k), k), plain, reason: 'kNum=$k');
      }
    });
    test('같은 입력·키는 항상 같은 암호문(IV 고정) — 서버가 재현 가능', () {
      expect(encryptLoginData('abc', 3), encryptLoginData('abc', 3));
    });
    test('loginKeyIndex는 0~9', () {
      for (var i = 0; i < 50; i++) {
        final k = loginKeyIndex();
        expect(k, inInclusiveRange(0, 9));
      }
    });
  });

  group('MessengerClient', () {
    test('P076로 로그인하고 token·hashKey·companyInfo를 세운다', () async {
      final c = client(fakeServer(onLoginData: {
        'token': 'MTOK', 'hashKey': 'HK', 'groupSeq': '1', 'empSeq': '7', 'compSeq': 'C', 'bizSeq': 'B', 'deptSeq': 'D',
        'companyList': [{'compSeq': 'C', 'bizSeq': 'B', 'deptSeq': 'D', 'emailAddr': 'me', 'emailDomain': 'innogrid.com'}],
        'mqttInfo': {'ip': '1.2.3.4', 'port': 1883},
      }));
      final d = await c.callCo('P077', {'pageSize': '3'});
      expect(d, {});
      final s = c.session!;
      expect(s.token, 'MTOK');
      expect(s.empSeq, '7');
      expect(s.companyInfo['emailDomain'], 'innogrid.com');
      expect(s.mqtt['port'], 1883);
    });

    test('호출은 메신저 hashKey로 서명하고 {header,body} 봉투로 보낸다', () async {
      late http.Request seen;
      final c = client(fakeServer(
        onLoginData: {'token': 'MTOK', 'hashKey': 'HK', 'groupSeq': '1', 'empSeq': '7', 'companyList': []},
        onCall: (pid, body) { return {'resultCode': 0, 'resultData': {'ok': 1}}; },
      ));
      // 호출 가로채기: send를 다시 감싸 마지막 요청을 본다
      final m = MockClient((r) async {
        if (r.url.path == '/proxymgw/proxymgw29A39') seen = r;
        // 위 fakeServer 로직 재사용 불가하므로 최소 응답
        if (r.url.path == '/get_token/') return _json({'token': 'tok', 'cur_date': '20261021'});
        if (r.url.path == '/proxymgw/proxymgw01A01') {
          return _json({'resultCode': 0, 'resultData': {'protocolList': [
            {'protocolId': 'P076', 'protocolUrl': 'https://gw.innogrid.com/proxymgw/proxymgw17A14'},
            {'protocolId': 'P077', 'protocolUrl': 'https://gw.innogrid.com/proxymgw/proxymgw29A39'},
          ]}});
        }
        final env = jsonDecode(r.body) as Map;
        if ((env['header'] as Map)['pid'] == 'P076') {
          return _json({'resultCode': 0, 'resultData': {'token': 'MTOK', 'hashKey': 'HK', 'empSeq': '7', 'companyList': []}});
        }
        return _json({'resultCode': 0, 'resultData': {'ok': 1}});
      });
      final c2 = client(m);
      await c2.call('P077', {'a': 1});
      expect(seen.headers['Authorization'], 'Bearer MTOK');
      expect(seen.headers['wehago-sign'], isNotEmpty);
      final env = jsonDecode(seen.body) as Map;
      expect((env['header'] as Map)['pid'], 'P077');
      expect((env['header'] as Map)['token'], 'MTOK');
      expect(env['body'], {'a': 1});
      // c 미사용 경고 방지
      expect(c.runtimeType, MessengerClient);
    });

    test('11008이면 재로그인 1회 후 재시도', () async {
      var logins = 0;
      var p077 = 0;
      final m = MockClient((r) async {
        if (r.url.path == '/get_token/') return _json({'token': 'tok', 'cur_date': '20261021'});
        if (r.url.path == '/proxymgw/proxymgw01A01') {
          return _json({'resultCode': 0, 'resultData': {'protocolList': [
            {'protocolId': 'P076', 'protocolUrl': 'https://gw.innogrid.com/proxymgw/proxymgw17A14'},
            {'protocolId': 'P077', 'protocolUrl': 'https://gw.innogrid.com/proxymgw/proxymgw29A39'},
          ]}});
        }
        final env = jsonDecode(r.body) as Map;
        if ((env['header'] as Map)['pid'] == 'P076') { logins++; return _json({'resultCode': 0, 'resultData': {'token': 'T$logins', 'hashKey': 'HK', 'companyList': []}}); }
        p077++;
        if (p077 == 1) return _json({'resultCode': 11008, 'resultMsg': 'expired'});
        return _json({'resultCode': 0, 'resultData': {'ok': 1}});
      });
      final c = client(m);
      final d = await c.call('P077', {});
      expect(d, {'ok': 1});
      expect(logins, 2); // 최초 + 재로그인
    });

    test('자격증명 없으면 MessengerAuthException', () async {
      final c = MessengerClient(httpClient: fakeServer(onLoginData: const {}), loadCreds: () async => null);
      await expectLater(c.call('P077', {}), throwsA(isA<MessengerAuthException>()));
    });
  });
}
