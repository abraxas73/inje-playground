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
    final masked = <int>[];
    final api = apiWith((r) async => sse([
      {'type': 'conversation', 'id': 'c1'},
      {'type': 'tool', 'id': 's1', 'tool': 'teams_chats', 'location': 'server', 'status': 'running'},
      {'type': 'tool', 'id': 's1', 'tool': 'teams_chats', 'location': 'server', 'status': 'ok', 'summary': '1건'},
      {'type': 'masked', 'count': 2},
      {'type': 'text', 'delta': '확인'},
      {'type': 'text', 'delta': '할게요'},
      {'type': 'needs_action', 'messageId': 'm2', 'calls': [
        {'id': 't1', 'tool': 'mail_list', 'input': {}, 'location': 'device', 'tier': 'read'},
        {'id': 't2', 'tool': 'teams_send', 'input': {'chat_id': '19:x', 'text': 'a'}, 'location': 'server', 'tier': 'write', 'target': '센터'},
      ]},
    ]));
    final o = await api.turn({'text': 'x'}, onText: deltas.add, onTool: (id, tool, s, sum) => tools.add('$id:$s:$sum'), onMasked: masked.add);
    expect(o.conversationId, 'c1');
    expect(deltas.join(), '확인할게요');
    expect(tools, ['s1:running:', 's1:ok:1건']);
    expect(masked, [2]);
    expect(o.toolStatus, {'s1': 'ok'});
    expect(o.needsAction!.map((c) => '${c.id}/${c.name}/${c.location}/${c.tier}/${c.target}'), ['t1/mail_list/device/read/null', 't2/teams_send/server/write/센터']);
    expect(o.needsAction![1].onServer, isTrue);
    expect(o.error, isNull);
  });

  test('turn — done이면 needsAction null, error 이벤트는 문구, 꺼짐 403은 disabled', () async {
    expect((await apiWith((r) async => sse([{'type': 'conversation', 'id': 'c1'}, {'type': 'done', 'messageId': 'm1'}])).turn({'text': 'x'})).needsAction, isNull);
    final e = await apiWith((r) async => sse([{'type': 'conversation', 'id': 'c1'}, {'type': 'error', 'message': '이노봇이 답하지 못했습니다. 다시 시도해 주세요.', 'retryable': true}])).turn({'text': 'x'});
    expect(e.error, '이노봇이 답하지 못했습니다. 다시 시도해 주세요.');
    expect(e.rejected, isFalse);
    final bad = await apiWith((r) async => sse([{'type': 'error', 'message': '처리할 작업이 없습니다.', 'retryable': false}])).turn({'actions': []});
    expect((bad.error, bad.rejected), ('처리할 작업이 없습니다.', true), reason: '입력 오류(retryable:false)는 거절로 구분');
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

  test('list·load — 목록, 본문은 사람이 읽을 말·기록된 도구 칩·가린 건수', () async {
    final api = apiWith((r) async {
      if (r.url.path == '/api/chat/conversations') return json({'conversations': [{'id': 'c1', 'title': '주간보고', 'model': 'claude-sonnet-5-5', 'last_message_at': '2026-10-15T01:00:00Z'}]});
      if (r.url.path == '/api/chat/config') return json({'enabled': true, 'models': ['claude-sonnet-5-5', 'claude-opus-5-5'], 'defaultModel': 'claude-sonnet-5-5'});
      return json({'conversation': {'id': 'c1', 'model': 'claude-opus-5-5'}, 'toolCalls': [{'message_id': 'm2', 'tool_use_id': 't1', 'tool': 'mail_list', 'status': 'ok', 'summary': '받은메일 목록 3건'}], 'messages': [
        {'id': 'm1', 'role': 'user', 'status': 'ok', 'masked_count': 1, 'content': [{'type': 'text', 'text': '메일'}, {'type': 'attachment', 'id': 'a', 'name': 'x.pdf'}]},
        {'id': 'm2', 'role': 'assistant', 'status': 'ok', 'content': [{'type': 'tool_use', 'id': 't1', 'name': 'mail_list', 'input': {}}]},
        {'id': 'm3', 'role': 'user', 'status': 'ok', 'content': [{'type': 'tool_result', 'tool_use_id': 't1', 'content': '받은메일 목록 3건'}]},
        {'id': 'm4', 'role': 'assistant', 'status': 'ok', 'content': [{'type': 'text', 'text': '세 통입니다'}]},
        {'id': 'm5', 'role': 'assistant', 'status': 'failed', 'content': [{'type': 'text', 'text': ''}]},
      ]});
    });
    expect((await api.list()).single.title, '주간보고');
    final cfg = await api.config();
    expect(cfg.models, ['claude-sonnet-5-5', 'claude-opus-5-5']);
    expect(cfg.defaultModel, 'claude-sonnet-5-5');
    final loaded = await api.load('c1');
    expect(loaded.model, 'claude-opus-5-5');
    expect(loaded.lines, [
      (kind: 'user', text: '메일', status: null),
      (kind: 'files', text: 'x.pdf', status: null),
      (kind: 'masked', text: '개인정보 1건 가림', status: null),
      (kind: 'tool', text: '받은메일 목록 3건', status: 'ok'),
      (kind: 'assistant', text: '세 통입니다', status: null),
    ]);
  });

  test('upload — multipart file 파트로 올리고 id·이름·경고를 받는다, 거절은 서버 문구', () async {
    late http.Request seen;
    final api = apiWith((r) async {
      seen = r;
      return json({'id': 'a1', 'name': '보고서.pdf', 'kind': 'pdf', 'warning': '이미지·스캔 문서 안의 개인정보는 가려지지 않습니다.'});
    });
    final u = await api.upload('보고서.pdf', utf8.encode('%PDF'));
    expect((u.id, u.name, u.warning), ('a1', '보고서.pdf', '이미지·스캔 문서 안의 개인정보는 가려지지 않습니다.'));
    expect(seen.url.path, '/api/chat/attachments');
    expect(seen.headers['content-type'], startsWith('multipart/form-data'));
    expect(seen.headers['authorization'], 'Bearer t');
    final raw = latin1.decode(seen.bodyBytes);
    expect(raw, contains('name="file"'));
    expect(raw, contains('%PDF'));
    final bad = apiWith((r) async => json({'error': 'exe 파일은 첨부할 수 없는 형식입니다.'}, 415));
    await expectLater(bad.upload('a.exe', [1]), throwsA(isA<ApiException>().having((e) => e.message, 'message', 'exe 파일은 첨부할 수 없는 형식입니다.')));
  });

  test('load — 첨부는 이름 줄(files)로', () async {
    final api = apiWith((r) async => json({'conversation': {'id': 'c1'}, 'toolCalls': [], 'messages': [
      {'id': 'm1', 'role': 'user', 'status': 'ok', 'content': [{'type': 'text', 'text': '요약해 줘'}, {'type': 'attachment', 'id': 'a', 'name': 'x.pdf'}, {'type': 'attachment', 'id': 'b', 'name': 'y.docx'}]},
    ]}));
    expect((await api.load('c1')).lines, [(kind: 'user', text: '요약해 줘', status: null), (kind: 'files', text: 'x.pdf\ny.docx', status: null)]);
  });

  test('load — 404는 ApiException', () async {
    final api = apiWith((r) async => json({'error': '대화를 찾지 못했습니다.'}, 404));
    await expectLater(api.load('c9'), throwsA(isA<ApiException>().having((e) => e.status, 'status', 404)));
  });
}
