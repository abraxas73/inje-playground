// mobile/test/assistant/assistant_tools_test.dart
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/api/client.dart';
import 'package:playground/assistant/assistant_journal.dart';
import 'package:playground/assistant/assistant_tools.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'gw_assistant_api_test.dart' show Gw, base;

class _Tokens implements TokenSource {
  @override Future<String?> accessToken() async => 't';
  @override Future<String?> refreshToken() async => 't';
  @override Future<void> onUnauthorized() async {}
}
ApiClient app(Map<String, Object> routes, [List<Map<String, dynamic>>? sent]) => ApiClient(httpClient: MockClient((r) async {
      if (r.body.isNotEmpty) sent?.add(jsonDecode(r.body) as Map<String, dynamic>);
      return http.Response.bytes(utf8.encode(jsonEncode(routes[r.url.path] ?? {'error': 'no'})), routes.containsKey(r.url.path) ? 200 : 404, headers: {'content-type': 'application/json; charset=utf-8'});
    }), tokens: _Tokens(), baseUrl: 'http://x', userAgent: 't');

// 서버 assistant-tools.test.ts의 NAMES와 같은 목록.
const names = ['approval_counts', 'approval_read', 'approvals_pending', 'attendance_today', 'cancel_reservation', 'clock_in', 'clock_out', 'create_event', 'delete_event', 'find_free_rooms', 'find_person', 'list_calendars', 'list_events', 'list_rooms', 'mail_list', 'mail_read', 'mail_save_draft', 'mail_send', 'my_reservations', 'notice_read', 'notices_list', 'reserve_room', 'search', 'teams_chats', 'teams_mentions', 'teams_send', 'undo_last'];

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('등급 표 — 서버와 같은 이름, 모르는 도구는 null(실행하지 않음)', () {
    expect((assistantToolTiers.keys.toList()..sort()), names);
    expect(tierOf('reserve_room'), ToolTier.write);
    expect(tierOf('mail_send'), ToolTier.irreversible);
    expect(tierOf('find_person'), ToolTier.read);
    expect(tierOf('undo_last'), ToolTier.meta);
    expect(tierOf('rm_rf'), isNull);
    expect(serverToolNames, {'teams_chats', 'teams_mentions', 'teams_send'});
  });

  test('cardLine — 앱이 인자로 만든 문장(참석자 부서, 메일 전문·경고)', () {
    expect(cardLine(const ToolCall('1', 'reserve_room', {'res_seq': 'R1', 'room_name': '회의실A', 'start': '2026-10-05T14:00', 'end': '2026-10-05T15:00', 'title': '주간회의'})), '회의실 예약 · 10/5(월) 14:00–15:00 · 회의실A · \'주간회의\'');
    expect(cardLine(const ToolCall('2', 'create_event', {'title': '주간회의', 'start': '2026-10-05T14:00', 'end': '2026-10-05T15:00', 'attendees': [{'emp_seq': '31', 'dept_seq': '20', 'name': '강승억', 'dept_name': '클라우드팀'}, {'emp_seq': '32', 'dept_seq': '30', 'name': '정선미'}], 'place': '회의실A'})), '일정 등록 · 10/5(월) 14:00–15:00 · \'주간회의\' · 참석 강승억, 정선미 · 장소 회의실A');
    expect(cardLine(const ToolCall('3', 'mail_send', {'to': ['a@x'], 'subject': '회의록', 'body': '첫 줄\n둘째 줄'})), '메일 발송(되돌릴 수 없음) · 받는 사람 a@x · 제목 \'회의록\'\n첫 줄\n둘째 줄');
    expect(cardLine(const ToolCall('4', 'teams_send', {'chat_id': 'c', 'chat_name': '센터', 'text': '안녕하세요'})), 'Teams 보내기 · 센터 · "안녕하세요"');
    expect(cardLine(const ToolCall('5', 'clock_in', {'notify_teams': true, 'extra': '화이팅'})), '출근 기록 · Teams 알림(+화이팅)');
    expect(cardLine(const ToolCall('6', 'cancel_reservation', {'res_seq': 'R1', 'seq_num': 7, 'res_idx': '1', 'label': '10/5 회의실A 주간회의'})), '예약 취소 · 10/5 회의실A 주간회의');
  });

  test('slim — 문자열 500자·목록 20개·깊이 제한', () {
    final v = slim({'a': 'x' * 600, 'list': List.generate(30, (i) => i), 'n': {'deep': {'deeper': {'deepest': {'x': 1}}}}});
    expect((v['a'] as String).length, 501);
    expect((v['list'] as List).length, 21, reason: '20개 + "…외 10개"');
    expect(v['list'].last, '…외 10개');
    expect(slim({'body': 'y' * 9000}, bodyKeys: const {'body'})['body'].length, 9000, reason: '메일 본문은 호출부가 이미 8000으로 자름 — body 키 예외');
  });

  test('MailReadGuard — 같은 요청의 목록·검색 muid만, 5통까지', () {
    final g = MailReadGuard();
    expect(g.tryUse('M1'), isFalse);
    g.allowFrom({'items': [{'muid': 'M1'}, {'muid': 'M2'}]});
    g.allowFrom([for (var i = 3; i < 10; i++) {'muid': 'M$i'}]);
    expect(g.tryUse('M1'), isTrue);
    expect(g.tryUse('X'), isFalse);
    for (final m in ['M2', 'M3', 'M4', 'M5']) { expect(g.tryUse(m), isTrue); }
    expect(g.tryUse('M6'), isFalse, reason: '요청당 5통');
    g.reset();
    expect(g.tryUse('M2'), isFalse);
  });

  test('실행기 — 조회·쓰기 디스패치, 쓰기 성공은 실행 기록(되돌리기 인자), 오류는 {ok:false,error}', () async {
    final gw = Gw({...base(), '/schres/rs121A06': (_) => {'seqNum': 77, 'resIdx': 1}, '/schres/rs121A10': (_) => {'reqText': '주간회의', 'empSeq': '7'}});
    final journal = await AssistantJournal.load();
    final runner = AssistantToolRunner(gw: gw.api(), api: app({}), journal: journal, guard: MailReadGuard());
    final found = await runner.run(const ToolCall('1', 'find_person', {'query': '정선미'}));
    expect((found['people'] as List).single['empSeq'], '32');
    final res = await runner.run(const ToolCall('2', 'reserve_room', {'res_seq': 'R1', 'room_name': '회의실A', 'start': '2026-10-05T14:00', 'end': '2026-10-05T15:00', 'title': '주간회의'}));
    expect(res['ok'], isTrue);
    expect(gw.calls['/schres/rs121A06']!.single['startDate'], '202610051400');
    final u = journal.undoable(1).single;
    expect(u.tool, 'reserve_room');
    expect(undoFor(u)!.call.name, 'cancel_reservation');
    expect(undoFor(u)!.call.input, {'res_seq': 'R1', 'seq_num': 77, 'res_idx': '1', 'label': '10/5(월) 14:00 회의실A \'주간회의\''});
    expect(await runner.run(const ToolCall('3', 'reserve_room', {'res_seq': 'R1', 'start': '14:00'})), {'ok': false, 'error': '시각 형식이 올바르지 않습니다(YYYY-MM-DDTHH:mm)'});
    expect((await runner.run(const ToolCall('4', 'mail_read', {'muid': 'M1'})))['ok'], isFalse, reason: '목록에서 받지 않은 muid');
    expect(await runner.run(const ToolCall('5', 'nope', {})), {'ok': false, 'error': '모르는 도구입니다: nope'});
    expect((await AssistantJournal.load()).undoable(5).length, 1, reason: '기록은 기기에 저장');
  });

  test('실행기 — 아마란스 미연결이면 GW 도구는 안내, Teams 도구는 /api/assistant/execute', () async {
    final sent = <Map<String, dynamic>>[];
    final runner = AssistantToolRunner(gw: null, api: app({'/api/assistant/execute': {'ok': true, 'result': {'chats': []}}}, sent), journal: await AssistantJournal.load(), guard: MailReadGuard());
    expect(await runner.run(const ToolCall('1', 'find_person', {'query': 'a'})), {'ok': false, 'error': '아마란스가 연결되어 있지 않습니다. 더보기 > 아마란스에서 연결하세요.'});
    expect(await runner.run(const ToolCall('2', 'teams_chats', {})), {'ok': true, 'result': {'chats': []}});
    expect(sent.single, {'tool': 'teams_chats', 'args': {}});
  });

  test('실행 기록 — 최근 20건, 되돌릴 수 없는 것은 undoable에서 빠짐, remove', () async {
    final j = await AssistantJournal.load();
    for (var i = 0; i < 22; i++) {
      await j.add(JournalEntry(at: '2026-10-05T10:${i.toString().padLeft(2, '0')}', tool: i.isEven ? 'create_event' : 'mail_send', summary: 's$i', undo: i.isEven ? {'tool': 'delete_event', 'args': {'sch_seq': '$i', 'date': '2026-10-05', 'label': 's$i'}} : null));
    }
    final again = await AssistantJournal.load();
    expect(again.all.length, 20);
    expect(again.undoable(2).map((e) => e.summary), ['s20', 's18']);
    await again.remove(again.undoable(1).single);
    expect((await AssistantJournal.load()).undoable(1).single.summary, 's18');
  });

  test('실행기 — 서버 {enabled:false}·이상 응답은 정규화, 받는 사람 없는 메일은 GW 호출 전에 거부', () async {
    final off = AssistantToolRunner(gw: null, api: app({'/api/assistant/execute': {'enabled': false}}), journal: await AssistantJournal.load(), guard: MailReadGuard());
    expect(await off.run(const ToolCall('1', 'teams_chats', {})), {'ok': false, 'error': '비서 기능이 꺼져 있습니다'});
    final odd = AssistantToolRunner(gw: null, api: app({'/api/assistant/execute': {'x': 1}}), journal: await AssistantJournal.load(), guard: MailReadGuard());
    expect(await odd.run(const ToolCall('2', 'teams_chats', {})), {'ok': false, 'error': '서버 응답이 올바르지 않습니다'});
    final gw = Gw(base());
    final r = AssistantToolRunner(gw: gw.api(), api: app({}), journal: await AssistantJournal.load(), guard: MailReadGuard());
    for (final t in ['mail_send', 'mail_save_draft']) {
      expect(await r.run(ToolCall('3', t, {'to': [], 'subject': 's', 'body': 'b'})), {'ok': false, 'error': '받는 사람이 없습니다'});
    }
    expect(gw.calls, isEmpty);
  });
}
