import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/api/client.dart';
import 'package:playground/api/sse.dart';

class _Tokens implements TokenSource {
  var refreshed = 0, unauthorized = 0;
  @override
  Future<String?> accessToken() async => 'old';
  @override
  Future<String?> refreshToken() async { refreshed++; return 'new'; }
  @override
  Future<void> onUnauthorized() async { unauthorized++; }
}

String sse(List<Map<String, dynamic>> events) => events.map((e) => 'data: ${jsonEncode(e)}\n\n').join();

void main() {
  test('SseDecoder — 조각난 청크·CRLF를 이어 붙여 이벤트 단위로', () {
    final got = <Map<String, dynamic>>[];
    final d = SseDecoder(got.add);
    d.add('data: {"type":"text","de');
    d.add('lta":"가"}\r\n\r\ndata: {"type":"done","messageId":"m1"}\n');
    expect(got, [{'type': 'text', 'delta': '가'}]);
    d.add('\n');
    expect(got.last, {'type': 'done', 'messageId': 'm1'});
    d.add('data: {깨짐}\n\n');
    expect(got, hasLength(2));
  });

  test('SseDecoder — onEvent 예외는 삼키지 않고 던진다', () {
    final d = SseDecoder((_) => throw StateError('boom'));
    expect(() => d.add('data: {"type":"text"}\n\n'), throwsStateError);
  });

  test('SseDecoder — \\r과 \\n\\r\\n으로 갈라진 청크도 이벤트 하나', () {
    final got = <Map<String, dynamic>>[];
    final d = SseDecoder(got.add);
    d.add('data: {"type":"text"}\r');
    d.add('\n\r');
    d.add('\n');
    expect(got, hasLength(1));
  });

  test('postSse — 이벤트를 차례로, Bearer·Accept, 본문 JSON', () async {
    late http.BaseRequest seen;
    final api = ApiClient(httpClient: MockClient((r) async { seen = r; return http.Response.bytes(utf8.encode(sse([{'type': 'conversation', 'id': 'c1'}, {'type': 'text', 'delta': '안녕'}, {'type': 'done', 'messageId': 'm1'}])), 200, headers: {'content-type': 'text/event-stream; charset=utf-8'}); }), tokens: _Tokens(), baseUrl: 'https://x.test', userAgent: 'UA');
    final got = <Map<String, dynamic>>[];
    await api.postSse('/api/chat/turn', {'text': '안녕'}, got.add);
    expect(got.map((e) => e['type']), ['conversation', 'text', 'done']);
    expect(seen.headers['Authorization'], 'Bearer old');
    expect(seen.headers['Accept'], 'text/event-stream');
    expect(jsonDecode((seen as http.Request).body), {'text': '안녕'});
  });

  test('postSse — 401이면 갱신 후 1회 재시도, 거절 JSON은 ApiException(status, message, code)', () async {
    final tokens = _Tokens();
    var n = 0;
    final api = ApiClient(httpClient: MockClient((r) async {
      n++;
      if (r.headers['Authorization'] == 'Bearer old') return http.Response.bytes(utf8.encode('{"error":"만료"}'), 401);
      return http.Response.bytes(utf8.encode(jsonEncode({'error': '관리자가 이노봇을 꺼 두었습니다.', 'code': 'assistant_disabled'})), 403, headers: {'content-type': 'application/json; charset=utf-8'});
    }), tokens: tokens, baseUrl: 'https://x.test', userAgent: 'UA');
    await expectLater(api.postSse('/api/chat/turn', {}, (_) {}), throwsA(isA<ApiException>().having((e) => e.status, 'status', 403).having((e) => e.code, 'code', 'assistant_disabled').having((e) => e.message, 'message', '관리자가 이노봇을 꺼 두었습니다.')));
    expect(n, 2);
    expect(tokens.refreshed, 1);
  });

  test('postSse — 갱신해도 401이면 onUnauthorized 후 401', () async {
    final tokens = _Tokens();
    final api = ApiClient(httpClient: MockClient((r) async => http.Response.bytes(utf8.encode('{"error":"인증이 필요합니다."}'), 401)), tokens: tokens, baseUrl: 'https://x.test', userAgent: 'UA');
    await expectLater(api.postSse('/api/chat/turn', {}, (_) {}), throwsA(isA<ApiException>().having((e) => e.status, 'status', 401)));
    expect(tokens.unauthorized, 1);
  });
}
