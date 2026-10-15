import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/api/client.dart';
import 'package:playground/assistant/chat_api.dart';

class _Tokens implements TokenSource {
  @override
  Future<String?> accessToken() async => 't';
  @override
  Future<String?> refreshToken() async => 't';
  @override
  Future<void> onUnauthorized() async {}
}

ChatApi apiWith(Future<http.Response> Function(http.Request r) h) => ChatApi(ApiClient(httpClient: MockClient(h), tokens: _Tokens(), baseUrl: 'https://x.test', userAgent: 'UA'));
http.Response sse(List<Map<String, dynamic>> ev) => http.Response.bytes(utf8.encode(ev.map((e) => 'data: ${jsonEncode(e)}\n\n').join()), 200, headers: {'content-type': 'text/event-stream'});
http.Response json(Object o, [int s = 200]) => http.Response.bytes(utf8.encode(jsonEncode(o)), s, headers: {'content-type': 'application/json; charset=utf-8'});

void main() {
  test('turn — 텍스트 스트림·서버 도구 상태·needs_action을 모은다', () async {
    final deltas = <String>[];
    final tools = <String>[];
    final api = apiWith((r) async => sse([
      {'type': 'conversation', 'id': 'c1'},
      {'type': 'tool', 'id': 's1', 'tool': 'teams_chats', 'location': 'server', 'status': 'running'},
      {'type': 'tool', 'id': 's1', 'tool': 'teams_chats', 'location': 'server', 'status': 'ok', 'summary': '1건'},
      {'type': 'text', 'delta': '확인'},
      {'type': 'text', 'delta': '할게요'},
      {'type': 'needs_action', 'messageId': 'm2', 'calls': [
        {'id': 't1', 'tool': 'mail_list', 'input': {}, 'location': 'device', 'tier': 'read'},
        {'id': 't2', 'tool': 'teams_send', 'input': {'chat_id': '19:x', 'text': 'a'}, 'location': 'server', 'tier': 'write', 'target': '센터'},
      ]},
    ]));
    final o = await api.turn({'text': 'x'}, onText: deltas.add, onTool: (id, tool, s) => tools.add('$id:$s'));
    expect(o.conversationId, 'c1');
    expect(deltas.join(), '확인할게요');
    expect(tools, ['s1:running', 's1:ok']);
    expect(o.toolStatus, {'s1': 'ok'});
    expect(o.needsAction!.map((c) => '${c.id}/${c.name}/${c.location}/${c.tier}/${c.target}'), ['t1/mail_list/device/read/null', 't2/teams_send/server/write/센터']);
    expect(o.needsAction![1].onServer, isTrue);
    expect(o.error, isNull);
  });

  test('turn — done이면 needsAction null, error 이벤트는 문구, 꺼짐 403은 disabled', () async {
    expect((await apiWith((r) async => sse([{'type': 'conversation', 'id': 'c1'}, {'type': 'done', 'messageId': 'm1'}])).turn({'text': 'x'})).needsAction, isNull);
    final e = await apiWith((r) async => sse([{'type': 'conversation', 'id': 'c1'}, {'type': 'error', 'message': '이노봇이 답하지 못했습니다. 다시 시도해 주세요.', 'retryable': true}])).turn({'text': 'x'});
    expect(e.error, '이노봇이 답하지 못했습니다. 다시 시도해 주세요.');
    final off = await apiWith((r) async => json({'error': '관리자가 이노봇을 꺼 두었습니다.', 'code': 'assistant_disabled'}, 403)).turn({'text': 'x'});
    expect(off.disabled, isTrue);
    final limit = await apiWith((r) async => json({'error': '오늘 이노봇 사용 한도를 다 썼습니다. 내일 다시 이용해 주세요.'}, 429)).turn({'text': 'x'});
    expect(limit.error, '오늘 이노봇 사용 한도를 다 썼습니다. 내일 다시 이용해 주세요.');
    expect(limit.disabled, isFalse);
  });

  test('turn — 끝 이벤트 없이 스트림이 끝나면 오류', () async {
    final o = await apiWith((r) async => sse([{'type': 'conversation', 'id': 'c1'}, {'type': 'text', 'delta': '반'}])).turn({'text': 'x'});
    expect(o.error, isNotNull);
  });

  test('list·load — 목록, 본문은 사람이 읽을 말만', () async {
    final api = apiWith((r) async {
      if (r.url.path == '/api/chat/conversations') return json({'conversations': [{'id': 'c1', 'title': '주간보고', 'model': 'claude-sonnet-5-5', 'last_message_at': '2026-10-15T01:00:00Z'}]});
      return json({'conversation': {'id': 'c1'}, 'toolCalls': [], 'messages': [
        {'id': 'm1', 'role': 'user', 'status': 'ok', 'content': [{'type': 'text', 'text': '메일'}, {'type': 'attachment', 'id': 'a', 'name': 'x.pdf'}]},
        {'id': 'm2', 'role': 'assistant', 'status': 'ok', 'content': [{'type': 'tool_use', 'id': 't1', 'name': 'mail_list', 'input': {}}]},
        {'id': 'm3', 'role': 'user', 'status': 'ok', 'content': [{'type': 'tool_result', 'tool_use_id': 't1', 'content': '받은메일 목록 3건'}]},
        {'id': 'm4', 'role': 'assistant', 'status': 'ok', 'content': [{'type': 'text', 'text': '세 통입니다'}]},
        {'id': 'm5', 'role': 'assistant', 'status': 'failed', 'content': [{'type': 'text', 'text': ''}]},
      ]});
    });
    expect((await api.list()).single.title, '주간보고');
    expect(await api.load('c1'), [(role: 'user', text: '메일'), (role: 'assistant', text: '세 통입니다')]);
  });

  test('load — 404는 ApiException', () async {
    final api = apiWith((r) async => json({'error': '대화를 찾지 못했습니다.'}, 404));
    await expectLater(api.load('c9'), throwsA(isA<ApiException>().having((e) => e.status, 'status', 404)));
  });
}
