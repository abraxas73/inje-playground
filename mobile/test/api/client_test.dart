import 'dart:async';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/api/client.dart';

class FakeTokens implements TokenSource {
  FakeTokens(this.token, {this.next});
  String? token;
  final String? next;
  int refreshes = 0;
  int unauthorized = 0;
  @override
  Future<String?> accessToken() async => token;
  @override
  Future<String?> refreshToken() async { refreshes++; token = next; return next; }
  @override
  Future<void> onUnauthorized() async { unauthorized++; }
}

ApiClient client(http.Client h, FakeTokens t) => ApiClient(httpClient: h, tokens: t, baseUrl: 'https://x.test', userAgent: 'InnogridApp/t (test)');

void main() {
  test('응답 대기 중 취소하면 실제 HTTP 요청을 종료한다', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final transport = http.Client();
    addTearDown(() async { transport.close(); await server.close(force: true); });
    final received = Completer<void>();
    server.listen((request) { received.complete(); });
    final api = ApiClient(httpClient: transport, tokens: FakeTokens('t'),
      baseUrl: 'http://127.0.0.1:${server.port}', userAgent: 'test');
    final abort = Completer<void>();
    final pending = api.postJsonAbortable('/turn', {}, abort.future);
    final expectation = expectLater(pending, throwsA(isA<http.RequestAbortedException>()));
    await received.future;
    abort.complete();
    await expectation;
  });

  test('Bearer·User-Agent·쿼리를 붙이고 JSON을 돌려준다', () async {
    late http.Request seen;
    final c = client(MockClient((r) async { seen = r; return http.Response('{"ok":1}', 200); }), FakeTokens('tok'));
    expect(await c.getJson('/api/a', query: {'q': '한글'}), {'ok': 1});
    expect(seen.headers['Authorization'], 'Bearer tok');
    expect(seen.headers['User-Agent'], 'InnogridApp/t (test)');
    expect(seen.url.toString(), 'https://x.test/api/a?q=%ED%95%9C%EA%B8%80');
  });
  test('401이면 갱신 후 한 번만 재시도한다', () async {
    var calls = 0;
    final t = FakeTokens('old', next: 'new');
    final c = client(MockClient((r) async { calls++; return r.headers['Authorization'] == 'Bearer new' ? http.Response('{"ok":true}', 200) : http.Response('{"error":"x"}', 401); }), t);
    expect(await c.postJson('/api/b', {'a': 1}), {'ok': true});
    expect(calls, 2);
    expect(t.refreshes, 1);
    expect(t.unauthorized, 0);
  });
  test('재시도도 401이면 onUnauthorized 후 ApiException(401)', () async {
    var calls = 0;
    final t = FakeTokens('old', next: 'still-bad');
    final c = client(MockClient((r) async { calls++; return http.Response('{"error":"인증이 필요합니다."}', 401, headers: {'content-type': 'application/json; charset=utf-8'}); }), t);
    await expectLater(c.getJson('/api/c'), throwsA(isA<ApiException>().having((e) => e.status, 'status', 401)));
    expect(calls, 2);
    expect(t.unauthorized, 1);
  });
  test('그 외 오류는 {error} 메시지를 그대로, 본문이 JSON이 아니면 상태 코드', () async {
    final c = client(MockClient((r) async => http.Response('{"error":"장소와 구성원이 필요합니다"}', 400, headers: {'content-type': 'application/json; charset=utf-8'})), FakeTokens('t'));
    await expectLater(c.postJson('/api/d'), throwsA(isA<ApiException>().having((e) => e.message, 'message', '장소와 구성원이 필요합니다')));
    final c2 = client(MockClient((r) async => http.Response('<html>', 502)), FakeTokens('t'));
    await expectLater(c2.getJson('/api/e'), throwsA(isA<ApiException>().having((e) => e.message, 'message', contains('502'))));
  });
  test('204·빈 본문은 null', () async {
    final c = client(MockClient((r) async => http.Response('', 204)), FakeTokens('t'));
    expect(await c.deleteJson('/api/f', query: {'place_id': '1'}), isNull);
  });
}
