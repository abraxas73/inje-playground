// mobile/test/assistant/chat_brain.dart
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/api/client.dart';
import 'package:playground/assistant/assistant_tools.dart';

class BrainTokens implements TokenSource {
  @override
  Future<String?> accessToken() async => 't';
  @override
  Future<String?> refreshToken() async => 't';
  @override
  Future<void> onUnauthorized() async {}
}

/// 가짜 /api/chat/turn — turns는 옛 /api/assistant/turn 응답 형식({message, stop_reason} | {__status} | {__throw} | {enabled:false}).
/// 서버처럼: 서버 읽기만 든 응답은 직접 실행하고 다음 턴으로 이어 가며, 앱 호출·쓰기가 있으면 needs_action으로 멈춘다.
/// 거절(__status·__throw·꺼짐)은 진짜 서버처럼 대화를 바꾸기 전에 일어난다(대기 호출은 그대로 남는다).
/// received: 각 Claude 호출 직전의 대화(옛 messages 형식), executed: 서버에서 실행된 도구 {tool, args}(선택지·카드 확인용 /api/assistant/execute 포함),
/// viaExecute: /api/assistant/execute로 불린 도구 이름, bodies: /api/chat/turn 요청 본문.
class ChatBrain {
  ChatBrain(this.turns, {this.waitForTurn});
  final List<Map<String, dynamic>> turns;
  Future<void>? waitForLoad; // GET 대화 불러오기가 이걸 기다린 뒤 답한다
  Future<void>? waitForTurn; // 요청마다 이걸 기다린 뒤 답한다(테스트가 중간에 바꿀 수 있음)
  final received = <List<dynamic>>[];
  final executed = <Map<String, dynamic>>[];
  final viaExecute = <String>[];
  final bodies = <Map<String, dynamic>>[];
  final history = <Map<String, dynamic>>[];
  final saved = <String, List<Map<String, dynamic>>>{}; // GET /api/chat/conversations/{id}가 돌려줄 메시지 행
  List<Map<String, dynamic>> _pending = [];
  var conversations = 0;

  ApiClient get client => ApiClient(httpClient: MockClient(_handle), tokens: BrainTokens(), baseUrl: base, userAgent: 'test');
  static const base = 'https://brain.test';

  Map<String, dynamic> _serverRun(String name, Map input, bool approved) {
    final tier = tierOf(name);
    if (tier != ToolTier.read && !approved) return {'ok': false, 'error': '사용자가 취소했습니다.'};
    executed.add({'tool': name, 'args': input});
    return name == 'teams_chats'
        ? {'ok': true, 'result': {'chats': [{'id': '19:a@thread.v2', 'name': '센터', 'type': 'group'}]}}
        : {'ok': true, 'result': {'sent': true}};
  }

  Future<http.Response> _handle(http.Request r) async {
    if (r.method == 'GET') {
      if (waitForLoad != null) await waitForLoad;
      final rows = saved[Uri.decodeComponent(r.url.pathSegments.last)];
      return rows == null ? _json({'error': '대화를 찾지 못했습니다.'}, 404) : _json({'messages': rows});
    }
    if (r.url.path != '/api/chat/turn') {
      // 선택지 안의 서버 쓰기·카드용 대상 확인은 앱이 기존 /api/assistant/execute로 부른다
      final b = jsonDecode(r.body) as Map<String, dynamic>;
      viaExecute.add('${b['tool']}');
      return _json(_serverRun('${b['tool']}', b['args'] as Map? ?? const {}, true));
    }
    final body = jsonDecode(r.body) as Map<String, dynamic>;
    bodies.add(body);
    if (waitForTurn != null) await waitForTurn;
    final head = turns.isEmpty ? null : turns.first;
    if (head != null && head['__status'] != null) {
      turns.removeAt(0);
      return _json({'error': '한도 초과'}, head['__status'] as int);
    }
    if (head != null && head['__throw'] == true) {
      turns.removeAt(0);
      throw http.ClientException('net');
    }
    if (head != null && head['enabled'] == false) {
      turns.removeAt(0);
      return _json({'error': '관리자가 이노봇을 꺼 두었습니다.', 'code': 'assistant_disabled'}, 403);
    }
    // 진짜 서버의 입력 검사 — 작업 응답은 대화 id와 대기 호출이 있어야 한다
    if (body['actions'] is List && (body['conversationId'] == null || _pending.isEmpty || (body['actions'] as List).isEmpty)) {
      return _json({'error': '처리할 작업이 없습니다.'}, 400);
    }
    final events = <Map<String, dynamic>>[];
    if (body['conversationId'] == null) conversations++;
    events.add({'type': 'conversation', 'id': body['conversationId'] ?? 'c$conversations'});
    if (body['actions'] is List) {
      final replies = {for (final a in (body['actions'] as List).whereType<Map>()) '${a['id']}': a};
      final results = <Map<String, dynamic>>[];
      for (final c in _pending) {
        final id = '${c['id']}';
        events.add({'type': 'tool', 'id': id, 'tool': c['tool'], 'location': c['location'], 'status': 'running'});
        final Map<String, dynamic> block;
        if (c['location'] == 'server') {
          block = _toolResult(id, _serverRun('${c['tool']}', c['input'] as Map, replies[id]?['approve'] == true));
        } else if (replies[id] case final a? when a.containsKey('result')) {
          final res = a['result'];
          block = {'type': 'tool_result', 'tool_use_id': id, 'content': res is String ? res : jsonEncode(res), if (a['isError'] == true) 'is_error': true};
        } else {
          block = {'type': 'tool_result', 'tool_use_id': id, 'content': '앱 응답 없음', 'is_error': true};
        }
        results.add(block);
        events.add({'type': 'tool', 'id': id, 'tool': c['tool'], 'location': c['location'], 'status': block['is_error'] == true ? 'error' : 'ok'});
      }
      history.add({'role': 'user', 'content': results});
      _pending = [];
    } else {
      if (_pending.isNotEmpty) {
        history.add({'role': 'user', 'content': [for (final c in _pending) {'type': 'tool_result', 'tool_use_id': '${c['id']}', 'content': '취소됨(사용자가 다른 요청을 함)', 'is_error': true}]});
        _pending = [];
      }
      if (body['text'] != null) history.add({'role': 'user', 'content': body['text']});
    }
    for (var round = 0; round < 12; round++) {
      received.add(List.of(history));
      final t = turns.isEmpty ? {'message': {'role': 'assistant', 'content': [{'type': 'text', 'text': '(끝)'}]}, 'stop_reason': 'end_turn'} : turns.removeAt(0);
      final msg = Map<String, dynamic>.from(t['message'] as Map);
      history.add(msg);
      final blocks = (msg['content'] as List).whereType<Map>().toList();
      for (final b in blocks.where((b) => b['type'] == 'text')) {
        events.add({'type': 'text', 'delta': '${b['text']}'});
      }
      final uses = blocks.where((b) => b['type'] == 'tool_use').toList();
      if (uses.isEmpty) {
        events.add({'type': 'done', 'messageId': 'm${history.length}'});
        return _sse(events);
      }
      final calls = [
        for (final u in uses)
          {'id': '${u['id']}', 'tool': '${u['name']}', 'input': u['input'] ?? {}, 'location': serverToolNames.contains(u['name']) ? 'server' : 'device', 'tier': (tierOf('${u['name']}') ?? ToolTier.write).name},
      ];
      final auto = calls.every((c) => c['location'] == 'server' && c['tier'] == 'read');
      if (!auto) {
        _pending = calls;
        events.add({'type': 'needs_action', 'messageId': 'm${history.length}', 'calls': calls});
        return _sse(events);
      }
      history.add({'role': 'user', 'content': [for (final c in calls) _toolResult('${c['id']}', _serverRun('${c['tool']}', c['input'] as Map, false))]});
      for (final c in calls) {
        events.add({'type': 'tool', 'id': c['id'], 'tool': c['tool'], 'location': 'server', 'status': 'running'});
        events.add({'type': 'tool', 'id': c['id'], 'tool': c['tool'], 'location': 'server', 'status': 'ok'});
      }
    }
    events.add({'type': 'done', 'messageId': 'last'});
    return _sse(events);
  }

  Map<String, dynamic> _toolResult(String id, Map<String, dynamic> r) => {'type': 'tool_result', 'tool_use_id': id, 'content': jsonEncode(r), if (r['ok'] == false) 'is_error': true};
  http.Response _sse(List<Map<String, dynamic>> ev) => sseResponse(ev);
  http.Response _json(Object o, [int status = 200]) => http.Response.bytes(utf8.encode(jsonEncode(o)), status, headers: {'content-type': 'application/json; charset=utf-8'});
}

/// SSE 응답 하나(이벤트 목록 그대로).
http.Response sseResponse(List<Map<String, dynamic>> ev) => http.Response.bytes(utf8.encode(ev.map((e) => 'data: ${jsonEncode(e)}\n\n').join()), 200, headers: {'content-type': 'text/event-stream; charset=utf-8'});

/// 텍스트 한 번 답하고 끝나는 SSE 응답.
http.Response sseSay(String text) => sseResponse([
  {'type': 'conversation', 'id': 'c1'},
  {'type': 'text', 'delta': text},
  {'type': 'done', 'messageId': 'm'},
]);
