// mobile/test/assistant/assistant_tools_test.dart
import 'dart:convert';
import 'dart:io';
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
const names = ['approval_counts', 'approval_read', 'approvals_pending', 'attendance_today', 'cancel_reservation', 'clock_in', 'clock_out', 'create_event', 'delete_event', 'find_free_rooms', 'find_person', 'list_calendars', 'list_events', 'list_rooms', 'mail_list', 'mail_read', 'mail_save_draft', 'mail_send', 'my_reservations', 'my_team', 'notice_read', 'notices_list', 'offer_choices', 'reserve_room', 'search', 'teams_chats', 'teams_mentions', 'teams_send', 'undo_last'];

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('등급 표 — 서버와 같은 이름, 모르는 도구는 null(실행하지 않음)', () {
    expect((assistantToolTiers.keys.toList()..sort()), names);
    expect(tierOf('reserve_room'), ToolTier.write);
    expect(tierOf('mail_send'), ToolTier.irreversible);
    expect(tierOf('find_person'), ToolTier.read);
    expect(tierOf('undo_last'), ToolTier.meta);
    expect(tierOf('offer_choices'), ToolTier.choice);
    expect(tierOf('rm_rf'), isNull);
    expect(serverToolNames, {'teams_chats', 'teams_mentions', 'teams_send'});
  });

  test('cardLine — 앱이 인자로 만든 문장(참석자 부서, 메일 전문·경고)', () {
    expect(cardLine(const ToolCall('1', 'reserve_room', {'res_seq': 'R1', 'room_name': '회의실A', 'start': '2026-10-05T14:00', 'end': '2026-10-05T15:00', 'title': '주간회의'})), '회의실 예약 · 10/5(월) 14:00–15:00 · 회의실A · \'주간회의\'');
    // 참석자·회의실·채팅방·예약/일정 제목은 resolve()가 실행에 쓰일 id로 다시 읽은 값(모델이 쓴 이름이 아님)
    expect(cardLine(const ToolCall('2', 'create_event', {'title': '주간회의', 'start': '2026-10-05T14:00', 'end': '2026-10-05T15:00', 'attendees': [{'emp_seq': '31', 'dept_seq': '20', 'name': '김아무개'}, {'emp_seq': '32', 'dept_seq': '30', 'name': '정선미'}], 'place': '회의실A'}), {'attendees': ['강승억(부서명)', '정선미(경영지원팀)']}), '일정 등록 · 10/5(월) 14:00–15:00 · \'주간회의\' · 참석 강승억(부서명), 정선미(경영지원팀) · 장소 회의실A');
    expect(cardLine(const ToolCall('7', 'reserve_room', {'res_seq': 'R1', 'room_name': '대회의실', 'start': '2026-10-05T14:00', 'end': '2026-10-05T15:00', 'title': 't'}), {'room_name': '회의실A'}), '회의실 예약 · 10/5(월) 14:00–15:00 · 회의실A · \'t\'');
    expect(cardLine(const ToolCall('8', 'teams_send', {'chat_id': 'c', 'chat_name': '사장님', 'text': '안녕'}), {'chat_name': '센터'}), 'Teams 보내기 · 센터 · "안녕"');
    expect(cardLine(const ToolCall('9', 'cancel_reservation', {'res_seq': 'R1', 'label': '가짜'}), {'title': '내 회의', 'start': '2026-10-05T15:00', 'end': '2026-10-05T16:00', 'room_name': '회의실B'}), '예약 취소 · 10/5(월) 15:00–16:00 · 회의실B · \'내 회의\'');
    expect(cardLine(const ToolCall('10', 'delete_event', {'sch_seq': '900', 'label': '가짜'}), {'title': '주간회의', 'start': '2026-10-05T14:00', 'end': '2026-10-05T15:00'}), '일정 삭제 · 10/5(월) 14:00–15:00 · \'주간회의\'');
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
    final now = DateTime.utc(2026, 10, 5, 12);
    expect(again.undoable(2, now: now).map((e) => e.summary), ['s20', 's18']);
    final top = again.undoable(1, now: now).single;
    await again.removeWhere((e) => identical(e, top));
    expect((await AssistantJournal.load()).undoable(1, now: now).single.summary, 's18');
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

  test('서버 도구 — 예외 없이 {ok:false}, teams_send는 전송 결과 불명 문구', () async {
    final boom = ApiClient(httpClient: MockClient((r) async => throw const SocketException('x')), tokens: _Tokens(), baseUrl: 'http://x', userAgent: 't');
    final runner = AssistantToolRunner(gw: null, api: boom, journal: await AssistantJournal.load(), guard: MailReadGuard());
    final a = await runner.run(const ToolCall('1', 'teams_chats', {}));
    expect(a['ok'], isFalse);
    expect(a['error'], startsWith('처리하지 못했습니다'));
    expect(await runner.run(const ToolCall('2', 'teams_send', {'chat_id': 'c', 'text': 't'})), {'ok': false, 'error': '전송 결과를 확인할 수 없습니다. Teams에서 확인한 뒤 다시 보내세요'});
  });

  test('되돌리기 — 허용 도구만, 예약 번호 없으면 기록하되 undo 없음', () {
    JournalEntry e(String t) => JournalEntry(at: 'a', tool: 'x', summary: 's', undo: {'tool': t, 'args': {}});
    expect(undoFor(e('cancel_reservation')), isNotNull);
    expect(undoFor(e('delete_event')), isNotNull);
    expect(undoFor(e('mail_send')), isNull);
    expect(undoFor(e('teams_send')), isNull);
    expect(reserveUndo({'resSeq': 'R1', 'seqNum': 7, 'resIdx': '1'}, 'l'), isNotNull);
    expect(reserveUndo({'resSeq': 'R1', 'resIdx': '1'}, 'l'), isNull);
    expect(reserveUndo({'resSeq': 'R1', 'seqNum': 7, 'resIdx': ''}, 'l'), isNull);
  });

  test('resolve — 실행 id로 실제 대상을 읽어 카드 값을 만든다, 못 찾으면 error', () async {
    final gw = Gw({...base(),
      '/schres/rs121A10': (b) => b['resSeq'] == 'R2' ? {'reqText': '내 회의', 'empSeq': '7', 'resName': '회의실B', 'startDate': '202610051500', 'endDate': '202610051600'} : {'reqText': '남의 것', 'empSeq': '99'},
      '/schres/sc111A03': (_) => {'resultList': [{'schSeq': '900', 'schTitle': '주간회의', 'createSeq': '7', 'mcalSeq': '1', 'startDate': '202610051400', 'endDate': '202610051500'}, {'schSeq': '901', 'schTitle': '남의 일정', 'createSeq': '99', 'mcalSeq': '9'}]},
    });
    final runner = AssistantToolRunner(gw: gw.api(), api: app({'/api/assistant/execute': {'ok': true, 'result': {'chats': [{'id': '19:a@thread.v2', 'name': '센터', 'type': 'group'}]}}}), journal: await AssistantJournal.load(), guard: MailReadGuard());
    Future<({Map<String, dynamic> facts, String? error})> r(String n, Map<String, dynamic> i) => runner.resolve(ToolCall('x', n, i));
    expect((await r('create_event', {'title': 't', 'start': '2026-10-05T14:00', 'end': '2026-10-05T15:00', 'attendees': [{'emp_seq': '34', 'name': '김민준'}]})).facts['attendees'], ['김민준(경영지원팀)']);
    expect((await r('create_event', {'attendees': [{'emp_seq': '31', 'name': '강승억'}, {'emp_seq': '404', 'name': '유령'}]})).error, '참석자를 조직도에서 찾지 못했습니다: 유령(404)');
    expect((await r('reserve_room', {'res_seq': 'R2', 'room_name': '대회의실'})).facts['room_name'], '회의실B');
    expect((await r('reserve_room', {'res_seq': 'R9'})).error, startsWith('회의실을 찾지 못했습니다'));
    expect((await r('cancel_reservation', {'res_seq': 'R2', 'seq_num': 6, 'res_idx': '1'})).facts, {'title': '내 회의', 'start': '2026-10-05T15:00', 'end': '2026-10-05T16:00', 'room_name': '회의실B'});
    expect((await r('cancel_reservation', {'res_seq': 'R1', 'seq_num': 5, 'res_idx': '1'})).error, contains('본인 예약이 아니'));
    expect((await r('delete_event', {'sch_seq': '900', 'date': '2026-10-05'})).facts['title'], '주간회의');
    expect((await r('delete_event', {'sch_seq': '901', 'date': '2026-10-05'})).error, contains('내가 등록한 일정이 아니'));
    expect((await r('delete_event', {'sch_seq': '902', 'date': '2026-10-05'})).error, contains('찾지 못했습니다'));
    expect((await r('teams_send', {'chat_id': '19:a@thread.v2', 'chat_name': '가짜', 'text': 'x'})).facts['chat_name'], '센터');
    expect((await r('teams_send', {'chat_id': '19:zz@thread.v2', 'text': 'x'})).error, startsWith('채팅방을 찾지 못했습니다'));
    expect((await r('mail_send', {'to': ['a@x']})).error, isNull);
    final down = AssistantToolRunner(gw: Gw({...base(), '/schres/rs121A01': (_) => http.Response('x', 500)}).api(), api: app({}), journal: await AssistantJournal.load(), guard: MailReadGuard());
    expect((await down.resolve(const ToolCall('x', 'reserve_room', {'res_seq': 'R2'}))).error, '확인에 필요한 정보를 가져오지 못했습니다');
  });

  test('find_free_rooms — 오늘이면 지난 시각은 빼고 다음 10분 단위부터', () async {
    final runner = AssistantToolRunner(gw: Gw(base()).api(), api: app({}), journal: await AssistantJournal.load(), guard: MailReadGuard(), now: () => DateTime.utc(2026, 10, 5, 14, 3));
    final r = await runner.run(const ToolCall('1', 'find_free_rooms', {'date': '2026-10-05', 'from': '12:00', 'to': '18:00', 'duration_min': 30}));
    final slots = [for (final room in r['rooms'] as List) for (final s in room['freeSlots'] as List) '${room['resName']}:${s['from']}-${s['to']}'];
    expect(slots, ['회의실B:14:10-15:00', '회의실B:16:00-18:00', '회의실A:16:00-18:00']);
    final tomorrow = await runner.run(const ToolCall('2', 'find_free_rooms', {'date': '2026-10-06', 'from': '12:00', 'to': '13:00', 'duration_min': 30}));
    expect(((tomorrow['rooms'] as List).first['freeSlots'] as List).first['from'], '12:00');
  });

  test('실행 기록 — 24시간 지난 항목은 되돌리기 후보가 아니다', () async {
    final j = await AssistantJournal.load();
    Map<String, dynamic> u(String s) => {'tool': 'delete_event', 'args': {'sch_seq': s, 'date': '2026-10-05'}};
    await j.add(JournalEntry(at: '2026-10-04T09:00:00.000Z', tool: 'create_event', summary: 'old', undo: u('1')));
    await j.add(JournalEntry(at: '2026-10-04T11:00:00.000Z', tool: 'create_event', summary: 'fresh', undo: u('2')));
    expect(j.undoable(5, now: DateTime.utc(2026, 10, 5, 10)).map((e) => e.summary), ['fresh']);
  });

  test('취소·삭제가 성공하면(직접이든 되돌리기든) 같은 대상의 실행 기록을 지운다', () async {
    var gone = false, deleted = false;
    final gw = Gw({...base(),
      '/schres/rs121A10': (_) => gone ? http.Response('{"resultCode":1,"resultMsg":"x"}', 200) : {'reqText': '내 회의', 'empSeq': '7'},
      '/schres/rs121A11': (_) { gone = true; return {}; },
      '/schres/sc111A03': (_) => {'resultList': deleted ? [] : [{'schSeq': '900', 'schTitle': 't', 'createSeq': '7', 'mcalSeq': '1'}]},
      '/schres/sc111A06': (_) { deleted = true; return {}; },
    });
    final j = await AssistantJournal.load();
    final now = DateTime.utc(2026, 10, 5, 10);
    await j.add(JournalEntry(at: '2026-10-05T09:00:00.000Z', tool: 'reserve_room', summary: 'r', undo: {'tool': 'cancel_reservation', 'args': {'res_seq': 'R2', 'seq_num': 6, 'res_idx': '1'}}));
    await j.add(JournalEntry(at: '2026-10-05T09:01:00.000Z', tool: 'reserve_room', summary: 'other', undo: {'tool': 'cancel_reservation', 'args': {'res_seq': 'R2', 'seq_num': 7, 'res_idx': '1'}}));
    await j.add(JournalEntry(at: '2026-10-05T09:02:00.000Z', tool: 'create_event', summary: 'e', undo: {'tool': 'delete_event', 'args': {'sch_seq': '900', 'date': '2026-10-05'}}));
    final runner = AssistantToolRunner(gw: gw.api(), api: app({}), journal: j, guard: MailReadGuard(), now: () => now);
    expect((await runner.run(const ToolCall('1', 'cancel_reservation', {'res_seq': 'R2', 'seq_num': '6', 'res_idx': '1'})))['ok'], isTrue);
    expect((await runner.run(const ToolCall('2', 'delete_event', {'sch_seq': '900', 'date': '2026-10-05'})))['ok'], isTrue);
    expect((await AssistantJournal.load()).undoable(5, now: now).map((e) => e.summary), ['other']);
  });
}
