// mobile/test/assistant/assistant_session_test.dart
import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/api/client.dart';
import 'package:playground/assistant/assistant_session.dart';
import 'package:playground/assistant/assistant_journal.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/gw/gw_creds.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../gw/fakes.dart';
import 'gw_assistant_api_test.dart' show Gw, base;

class _Tokens implements TokenSource {
  @override Future<String?> accessToken() async => 't';
  @override Future<String?> refreshToken() async => 't';
  @override Future<void> onUnauthorized() async {}
}

/// 가짜 비서 서버: /api/assistant/turn 응답을 순서대로 돌려주고, 받은 messages를 기록.
class Brain {
  Brain(this.turns);
  final List<Map<String, dynamic>> turns;
  final received = <List<dynamic>>[];
  final executed = <Map<String, dynamic>>[];
  ApiClient get client => ApiClient(httpClient: MockClient((r) async {
        final b = jsonDecode(r.body) as Map<String, dynamic>;
        Object out;
        if (r.url.path == '/api/assistant/turn') {
          received.add(b['messages'] as List);
          out = turns.isEmpty ? {'enabled': true, 'message': {'role': 'assistant', 'content': [{'type': 'text', 'text': '(끝)'}]}, 'stop_reason': 'end_turn'} : turns.removeAt(0);
        } else {
          executed.add(b);
          out = {'ok': true, 'result': {'sent': true}};
        }
        return http.Response.bytes(utf8.encode(jsonEncode(out)), 200, headers: {'content-type': 'application/json; charset=utf-8'});
      }), tokens: _Tokens(), baseUrl: 'http://x', userAgent: 't');
}
Map<String, dynamic> say(String t) => {'enabled': true, 'message': {'role': 'assistant', 'content': [{'type': 'text', 'text': t}]}, 'stop_reason': 'end_turn'};
Map<String, dynamic> use(List<(String, String, Map<String, dynamic>)> calls, [String text = '']) => {'enabled': true, 'stop_reason': 'tool_use', 'message': {'role': 'assistant', 'content': [if (text.isNotEmpty) {'type': 'text', 'text': text}, for (final (id, name, input) in calls) {'type': 'tool_use', 'id': id, 'name': name, 'input': input}]}};

ProviderContainer scope(Brain brain, Gw gw, {GwCreds? creds = testCreds}) {
  final c = ProviderContainer(overrides: [apiClientProvider.overrideWithValue(brain.client), gwStoreProvider.overrideWithValue(FakeGwStore(creds)), gwHttpClientProvider.overrideWithValue(gw.client)]);
  addTearDown(c.dispose);
  return c;
}
List toolResults(List msgs) => [for (final b in (msgs.last['content'] as List)) if (b['type'] == 'tool_result') b];

Gw scenarioGw() => Gw({...base(), '/schres/rs121A06': (_) => {'seqNum': 77, 'resIdx': 1}, '/schres/rs121A10': (_) => {'reqText': '회의', 'empSeq': '7'}, '/schres/sc111A05': (_) => {'schSeq': '900'}, '/schres/sc111A03': (_) => {'resultList': [{'schSeq': '900', 'schTitle': '회의', 'createSeq': '7', 'mcalSeq': '1'}]}});

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('대표 시나리오 — 조회는 바로, 예약+일정은 카드 하나로 묶어 대기, 실행하면 GW 쓰기 후 결과를 보내 마무리', () async {
    final brain = Brain([
      use([('a', 'find_person', {'query': '강승억'}), ('b', 'find_person', {'query': '정선미'})], '참석자를 찾을게요.'),
      use([('c', 'find_free_rooms', {'date': '2026-10-05', 'from': '12:00', 'to': '18:00', 'duration_min': 60})]),
      use([('d', 'reserve_room', {'res_seq': 'R2', 'room_name': '회의실B', 'start': '2026-10-05T16:00', 'end': '2026-10-05T17:00', 'title': '회의'}), ('e', 'create_event', {'title': '회의', 'start': '2026-10-05T16:00', 'end': '2026-10-05T17:00', 'attendees': [{'emp_seq': '31', 'dept_seq': '20', 'name': '강승억'}, {'emp_seq': '32', 'dept_seq': '30', 'name': '정선미'}], 'place': '회의실B'})]),
      say('16:00–17:00 회의실B를 예약하고 일정을 등록했습니다.'),
    ]);
    final gw = scenarioGw();
    final c = scope(brain, gw);
    final s = c.read(assistantSessionProvider.notifier);
    await s.send('오늘 오후 빈 회의실 1시간 잡고 일정 등록해줘. 참석자는 강승억, 정선미');
    final st = c.read(assistantSessionProvider);
    expect(st.pending, isTrue);
    expect(st.items.last.kind, ChatKind.card);
    expect(st.items.last.lines, hasLength(2));
    expect(st.items.last.lines.last, contains('참석 강승억, 정선미'));
    expect(gw.calls['/schres/rs121A06'], isNull, reason: '확인 전에는 쓰기 없음');
    expect(toolResults(brain.received[1]).map((b) => b['tool_use_id']), ['a', 'b'], reason: '조회 결과는 한 user 메시지로');
    await s.confirm();
    expect(gw.calls['/schres/rs121A06'], hasLength(1));
    expect(gw.calls['/schres/sc111A05'], hasLength(1));
    final last = brain.received.last;
    expect(toolResults(last).map((b) => b['tool_use_id']), ['d', 'e']);
    expect(c.read(assistantSessionProvider).items.last.text, '16:00–17:00 회의실B를 예약하고 일정을 등록했습니다.');
    expect(c.read(assistantSessionProvider).pending, isFalse);
    expect((await AssistantJournal.load()).undoable(5).map((e) => e.tool), ['create_event', 'reserve_room']);
  });

  test('예약 성공·일정 실패 — 뒤 작업 실패를 그대로, 이미 된 예약은 결과에 남는다', () async {
    final brain = Brain([use([('d', 'reserve_room', {'res_seq': 'R2', 'room_name': 'B', 'start': '2026-10-05T16:00', 'end': '2026-10-05T17:00', 'title': '회의'}), ('e', 'create_event', {'title': '회의', 'start': 'bad', 'end': 'bad'}), ('f', 'clock_out', {})]), say('예약은 됐고 일정은 실패했습니다.')]);
    final gw = scenarioGw();
    final c = scope(brain, gw);
    await c.read(assistantSessionProvider.notifier).send('잡아줘');
    await c.read(assistantSessionProvider.notifier).confirm();
    final rs = toolResults(brain.received.last);
    expect(jsonDecode(rs[0]['content'] as String)['ok'], isTrue);
    expect(rs[1]['is_error'], isTrue);
    expect(rs[2]['content'], contains('앞 작업이 실패해 실행하지 않았습니다'));
    expect(gw.calls['/human/common/judgeTimeManagement/getJudgeTimeManagement'], isNull);
  });

  test('그만두기 → 모든 쓰기에 "사용자가 취소" 결과, 고쳐 줘 → 다음 입력과 같은 메시지로', () async {
    final w = use([('d', 'mail_send', {'to': ['a@x'], 'subject': 's', 'body': 'b'})]);
    final brain = Brain([w, say('취소했습니다.'), use([('g', 'mail_send', {'to': ['a@x'], 'subject': 's', 'body': 'b'})]), say('알겠습니다.')]);
    final gw = scenarioGw();
    final c = scope(brain, gw);
    final s = c.read(assistantSessionProvider.notifier);
    await s.send('메일 보내줘');
    expect(c.read(assistantSessionProvider).items.last.irreversible, isTrue);
    await s.dismiss();
    expect(toolResults(brain.received[1]).single['content'], contains('사용자가 취소'));
    await s.send('다시');
    s.fix();
    expect(c.read(assistantSessionProvider).awaitingFix, isTrue);
    await s.send('제목을 회의록으로');
    final lastUser = brain.received.last.last['content'] as List;
    expect(lastUser.first['type'], 'tool_result');
    expect(lastUser.first['content'], contains('실행하지 않'));
    expect(lastUser.last, {'type': 'text', 'text': '제목을 회의록으로'});
    expect(gw.calls['/mail/mail014A04'], isNull);
  });

  test('되돌리기 — undo_last는 실행 기록에서 반대 작업 카드를 만들고, 실행하면 기록에서 지운다', () async {
    SharedPreferences.setMockInitialValues({'assistant.journal': jsonEncode([{'at': '2026-10-05T10:00', 'tool': 'reserve_room', 'summary': '회의실 예약 · …', 'undo': {'tool': 'cancel_reservation', 'args': {'res_seq': 'R2', 'seq_num': 6, 'res_idx': '1', 'label': '10/5 회의실B'}}}])});
    var gone = false;
    final gw = Gw({...base(), '/schres/rs121A10': (_) => gone ? http.Response('{"resultCode":1,"resultMsg":"x"}', 200) : {'reqText': '내 회의', 'empSeq': '7'}, '/schres/rs121A11': (_) { gone = true; return {}; }});
    final brain = Brain([use([('u', 'undo_last', {})]), say('예약을 취소했습니다.')]);
    final c = scope(brain, gw);
    await c.read(assistantSessionProvider.notifier).send('방금 거 취소해줘');
    expect(c.read(assistantSessionProvider).items.last.lines.single, '예약 취소 · 10/5 회의실B');
    await c.read(assistantSessionProvider.notifier).confirm();
    expect(gw.calls['/schres/rs121A11'], hasLength(1));
    expect(toolResults(brain.received.last).single['tool_use_id'], 'u');
    expect((await AssistantJournal.load()).undoable(5), isEmpty);
  });

  test('되돌릴 게 없으면 바로 결과, 모르는 도구는 오류 결과로 이어감, 턴 상한 10', () async {
    final brain = Brain([use([('u', 'undo_last', {}), ('x', 'format_disk', {})]), ...List.generate(12, (i) => use([('r$i', 'list_rooms', {})]))]);
    final c = scope(brain, scenarioGw());
    await c.read(assistantSessionProvider.notifier).send('되돌려');
    final first = toolResults(brain.received[1]);
    expect(first[0]['content'], contains('되돌릴 수 있는 최근 작업이 없습니다'));
    expect(first[1]['is_error'], isTrue);
    expect(brain.received.length, 10);
    expect(c.read(assistantSessionProvider).items.last.text, contains('요청이 너무 복잡합니다'));
  });

  test('서버가 꺼져 있으면 안내, Teams 쓰기는 확인 후 /api/assistant/execute', () async {
    final off = Brain([{'enabled': false}]);
    final c1 = scope(off, scenarioGw());
    await c1.read(assistantSessionProvider.notifier).send('안녕');
    expect(c1.read(assistantSessionProvider).items.last.text, '관리자가 비서를 꺼 두었습니다.');
    final brain = Brain([use([('t', 'teams_send', {'chat_id': '19:a@thread.v2', 'chat_name': '센터', 'text': '안녕하세요'})]), say('보냈습니다.')]);
    final c = scope(brain, scenarioGw());
    await c.read(assistantSessionProvider.notifier).send('센터에 인사해줘');
    expect(brain.executed, isEmpty);
    await c.read(assistantSessionProvider.notifier).confirm();
    expect(brain.executed.single, {'tool': 'teams_send', 'args': {'chat_id': '19:a@thread.v2', 'chat_name': '센터', 'text': '안녕하세요'}});
  });

  test('trimHistory — 오래된 교환을 user 텍스트 경계에서 잘라 40개 이하로', () {
    final m = <Map<String, dynamic>>[];
    for (var i = 0; i < 30; i++) {
      m.add({'role': 'user', 'content': 'q$i'});
      m.add({'role': 'assistant', 'content': [{'type': 'tool_use', 'id': 't$i', 'name': 'list_rooms', 'input': {}}]});
      m.add({'role': 'user', 'content': [{'type': 'tool_result', 'tool_use_id': 't$i', 'content': '{}'}]});
    }
    final t = trimHistory(m);
    expect(t.length, lessThanOrEqualTo(40));
    expect(t.first['content'], isA<String>());
    expect(t.last, m.last);
  });
}
