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
  @override
  Future<String?> accessToken() async => 't';
  @override
  Future<String?> refreshToken() async => 't';
  @override
  Future<void> onUnauthorized() async {}
}

/// 가짜 비서 서버: /api/assistant/turn 응답을 순서대로 돌려주고, 받은 messages를 기록.
class _FlakyStore extends FakeGwStore {
  _FlakyStore() : super(testCreds);
  var _n = 0;
  @override
  Future<GwCreds?> load() async {
    if (_n++ == 0) throw StateError('boom');
    return creds;
  }
}

class Brain {
  Brain(this.turns);
  final List<Map<String, dynamic>> turns;
  final received = <List<dynamic>>[];
  final executed = <Map<String, dynamic>>[];
  ApiClient get client => ApiClient(
    httpClient: MockClient((r) async {
      final b = jsonDecode(r.body) as Map<String, dynamic>;
      Object out;
      if (r.url.path == '/api/assistant/turn') {
        received.add(b['messages'] as List);
        final head = turns.isEmpty ? null : turns.first;
        if (head != null && head['__status'] != null) {
          turns.removeAt(0);
          return http.Response.bytes(
            utf8.encode(jsonEncode({'error': '한도 초과'})),
            head['__status'] as int,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }
        if (head != null && head['__throw'] == true) {
          turns.removeAt(0);
          throw http.ClientException('net');
        }
        out = turns.isEmpty
            ? {
                'enabled': true,
                'message': {
                  'role': 'assistant',
                  'content': [
                    {'type': 'text', 'text': '(끝)'},
                  ],
                },
                'stop_reason': 'end_turn',
              }
            : turns.removeAt(0);
      } else {
        executed.add(b);
        out = b['tool'] == 'teams_chats'
            ? {
                'ok': true,
                'result': {
                  'chats': [
                    {'id': '19:a@thread.v2', 'name': '센터', 'type': 'group'},
                  ],
                },
              }
            : {
                'ok': true,
                'result': {'sent': true},
              };
      }
      return http.Response.bytes(
        utf8.encode(jsonEncode(out)),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    }),
    tokens: _Tokens(),
    baseUrl: 'http://x',
    userAgent: 't',
  );
}

Map<String, dynamic> say(String t) => {
  'enabled': true,
  'message': {
    'role': 'assistant',
    'content': [
      {'type': 'text', 'text': t},
    ],
  },
  'stop_reason': 'end_turn',
};
Map<String, dynamic> use(
  List<(String, String, Map<String, dynamic>)> calls, [
  String text = '',
]) => {
  'enabled': true,
  'stop_reason': 'tool_use',
  'message': {
    'role': 'assistant',
    'content': [
      if (text.isNotEmpty) {'type': 'text', 'text': text},
      for (final (id, name, input) in calls)
        {'type': 'tool_use', 'id': id, 'name': name, 'input': input},
    ],
  },
};

ProviderContainer scope(Brain brain, Gw gw, {GwCreds? creds = testCreds}) {
  final c = ProviderContainer(
    overrides: [
      apiClientProvider.overrideWithValue(brain.client),
      gwStoreProvider.overrideWithValue(FakeGwStore(creds)),
      gwHttpClientProvider.overrideWithValue(gw.client),
      assistantClockProvider.overrideWithValue(() => t0),
    ],
  );
  addTearDown(c.dispose);
  return c;
}

/// 테스트 시계(KST 벽시계 + UTC 플래그) — 실행 기록의 24시간 창이 날짜와 무관하게 결정적이도록.
final t0 = DateTime.utc(2026, 10, 5, 11);

List toolResults(List msgs) => [
  for (final b in (msgs.last['content'] as List))
    if (b['type'] == 'tool_result') b,
];

Gw scenarioGw() => Gw({
  ...base(),
  '/schres/rs121A06': (_) => {'seqNum': 77, 'resIdx': 1},
  '/schres/rs121A10': (_) => {'reqText': '회의', 'empSeq': '7'},
  '/schres/sc111A05': (_) => {'schSeq': '900'},
  '/schres/sc111A03': (_) => {
    'resultList': [
      {'schSeq': '900', 'schTitle': '회의', 'createSeq': '7', 'mcalSeq': '1'},
    ],
  },
});

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test(
    '대표 시나리오 — 조회는 바로, 예약+일정은 카드 하나로 묶어 대기, 실행하면 GW 쓰기 후 결과를 보내 마무리',
    () async {
      final brain = Brain([
        use([
          ('a', 'find_person', {'query': '강승억'}),
          ('b', 'find_person', {'query': '정선미'}),
        ], '참석자를 찾을게요.'),
        use([
          (
            'c',
            'find_free_rooms',
            {
              'date': '2026-10-05',
              'from': '12:00',
              'to': '18:00',
              'duration_min': 60,
            },
          ),
        ]),
        use([
          (
            'd',
            'reserve_room',
            {
              'res_seq': 'R2',
              'room_name': '회의실B',
              'start': '2026-10-05T16:00',
              'end': '2026-10-05T17:00',
              'title': '회의',
            },
          ),
          (
            'e',
            'create_event',
            {
              'title': '회의',
              'start': '2026-10-05T16:00',
              'end': '2026-10-05T17:00',
              'attendees': [
                {'emp_seq': '31', 'dept_seq': '20', 'name': '강승억'},
                {'emp_seq': '32', 'dept_seq': '30', 'name': '정선미'},
              ],
              'place': '회의실B',
            },
          ),
        ]),
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
      expect(st.items.last.lines.first, contains('회의실B'));
      expect(st.items.last.lines.last, contains('참석 강승억(클라우드팀), 정선미(경영지원팀)'));
      expect(gw.calls['/schres/rs121A06'], isNull, reason: '확인 전에는 쓰기 없음');
      expect(
        toolResults(brain.received[1]).map((b) => b['tool_use_id']),
        ['a', 'b'],
        reason: '조회 결과는 한 user 메시지로',
      );
      await s.confirm();
      expect(gw.calls['/schres/rs121A06'], hasLength(1));
      expect(gw.calls['/schres/sc111A05'], hasLength(1));
      final last = brain.received.last;
      expect(toolResults(last).map((b) => b['tool_use_id']), ['d', 'e']);
      expect(
        c.read(assistantSessionProvider).items.last.text,
        '16:00–17:00 회의실B를 예약하고 일정을 등록했습니다.',
      );
      expect(c.read(assistantSessionProvider).pending, isFalse);
      expect((await AssistantJournal.load()).undoable(5, now: t0).map((e) => e.tool), [
        'create_event',
        'reserve_room',
      ]);
    },
  );

  test('예약 성공·일정 실패 — 뒤 작업 실패를 그대로, 이미 된 예약은 결과에 남는다', () async {
    final brain = Brain([
      use([
        (
          'd',
          'reserve_room',
          {
            'res_seq': 'R2',
            'room_name': 'B',
            'start': '2026-10-05T16:00',
            'end': '2026-10-05T17:00',
            'title': '회의',
          },
        ),
        ('e', 'create_event', {'title': '회의', 'start': 'bad', 'end': 'bad'}),
        ('f', 'clock_out', {}),
      ]),
      say('예약은 됐고 일정은 실패했습니다.'),
    ]);
    final gw = scenarioGw();
    final c = scope(brain, gw);
    await c.read(assistantSessionProvider.notifier).send('잡아줘');
    await c.read(assistantSessionProvider.notifier).confirm();
    final rs = toolResults(brain.received.last);
    expect(jsonDecode(rs[0]['content'] as String)['ok'], isTrue);
    expect(rs[1]['is_error'], isTrue);
    expect(rs[2]['content'], contains('앞 작업이 실패해 실행하지 않았습니다'));
    expect(
      gw.calls['/human/common/judgeTimeManagement/getJudgeTimeManagement'],
      isNull,
    );
  });

  test('그만두기 → 모든 쓰기에 "사용자가 취소" 결과, 고쳐 줘 → 다음 입력과 같은 메시지로', () async {
    final w = use([
      (
        'd',
        'mail_send',
        {
          'to': ['a@x'],
          'subject': 's',
          'body': 'b',
        },
      ),
    ]);
    final brain = Brain([
      w,
      say('취소했습니다.'),
      use([
        (
          'g',
          'mail_send',
          {
            'to': ['a@x'],
            'subject': 's',
            'body': 'b',
          },
        ),
      ]),
      say('알겠습니다.'),
    ]);
    final gw = scenarioGw();
    final c = scope(brain, gw);
    final s = c.read(assistantSessionProvider.notifier);
    await s.send('메일 보내줘');
    expect(c.read(assistantSessionProvider).items.last.irreversible, isTrue);
    await s.dismiss();
    expect(
      toolResults(brain.received[1]).single['content'],
      contains('사용자가 취소'),
    );
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
    SharedPreferences.setMockInitialValues({
      'assistant.journal': jsonEncode([
        {
          'at': '2026-10-05T10:00',
          'tool': 'reserve_room',
          'summary': '회의실 예약 · …',
          'undo': {
            'tool': 'cancel_reservation',
            'args': {
              'res_seq': 'R2',
              'seq_num': 6,
              'res_idx': '1',
              'label': '10/5 회의실B',
            },
          },
        },
      ]),
    });
    var gone = false;
    final gw = Gw({
      ...base(),
      '/schres/rs121A10': (_) => gone
          ? http.Response('{"resultCode":1,"resultMsg":"x"}', 200)
          : {
              'reqText': '내 회의',
              'empSeq': '7',
              'resName': '회의실B',
              'startDate': '202610051500',
              'endDate': '202610051600',
            },
      '/schres/rs121A11': (_) {
        gone = true;
        return {};
      },
    });
    final brain = Brain([
      use([('u', 'undo_last', {})]),
      say('예약을 취소했습니다.'),
    ]);
    final c = scope(brain, gw);
    await c.read(assistantSessionProvider.notifier).send('방금 거 취소해줘');
    expect(
      c.read(assistantSessionProvider).items.last.lines.single,
      "예약 취소 · 10/5(월) 15:00–16:00 · 회의실B · '내 회의'",
    );
    await c.read(assistantSessionProvider.notifier).confirm();
    expect(gw.calls['/schres/rs121A11'], hasLength(1));
    expect(toolResults(brain.received.last).single['tool_use_id'], 'u');
    expect((await AssistantJournal.load()).undoable(5, now: t0), isEmpty);
  });

  test('되돌릴 게 없으면 바로 결과, 모르는 도구는 오류 결과로 이어감, 턴 상한 10', () async {
    final brain = Brain([
      use([('u', 'undo_last', {}), ('x', 'format_disk', {})]),
      ...List.generate(12, (i) => use([('r$i', 'list_rooms', {})])),
    ]);
    final c = scope(brain, scenarioGw());
    await c.read(assistantSessionProvider.notifier).send('되돌려');
    final first = toolResults(brain.received[1]);
    expect(first[0]['content'], contains('되돌릴 수 있는 최근 작업이 없습니다'));
    expect(first[1]['is_error'], isTrue);
    expect(brain.received.length, 10);
    expect(
      c.read(assistantSessionProvider).items.last.text,
      contains('요청이 너무 복잡합니다'),
    );
  });

  test('서버가 꺼져 있으면 안내, Teams 쓰기는 확인 후 /api/assistant/execute', () async {
    final off = Brain([
      {'enabled': false},
    ]);
    final c1 = scope(off, scenarioGw());
    await c1.read(assistantSessionProvider.notifier).send('안녕');
    expect(
      c1.read(assistantSessionProvider).items.last.text,
      '관리자가 비서를 꺼 두었습니다.',
    );
    final brain = Brain([
      use([
        (
          't',
          'teams_send',
          {'chat_id': '19:a@thread.v2', 'chat_name': '센터', 'text': '안녕하세요'},
        ),
      ]),
      say('보냈습니다.'),
    ]);
    final c = scope(brain, scenarioGw());
    await c.read(assistantSessionProvider.notifier).send('센터에 인사해줘');
    expect(brain.executed.map((e) => e['tool']), ['teams_chats'], reason: '확인 전엔 채팅방 확인(조회)만');
    await c.read(assistantSessionProvider.notifier).confirm();
    expect(brain.executed.last, {
      'tool': 'teams_send',
      'args': {'chat_id': '19:a@thread.v2', 'chat_name': '센터', 'text': '안녕하세요'},
    });
  });

  test('trimHistory — 오래된 교환을 user 텍스트 경계에서 잘라 40개 이하로', () {
    final m = <Map<String, dynamic>>[];
    for (var i = 0; i < 30; i++) {
      m.add({'role': 'user', 'content': 'q$i'});
      m.add({
        'role': 'assistant',
        'content': [
          {'type': 'tool_use', 'id': 't$i', 'name': 'list_rooms', 'input': {}},
        ],
      });
      m.add({
        'role': 'user',
        'content': [
          {'type': 'tool_result', 'tool_use_id': 't$i', 'content': '{}'},
        ],
      });
    }
    final t = trimHistory(m);
    expect(t.length, lessThanOrEqualTo(40));
    expect(t.first['content'], isA<String>());
    expect(t.last, m.last);
  });

  /// 요청 messages 유효성 — 모든 tool_result는 바로 앞 assistant의 tool_use와 짝, 모든 tool_use는 다음 user의 tool_result와 짝.
  void expectValid(List msgs) {
    expect(msgs.first['role'], 'user');
    for (var i = 0; i < msgs.length; i++) {
      final c = msgs[i]['content'];
      final ids = c is List
          ? [
              for (final b in c)
                if (b['type'] == 'tool_result') b['tool_use_id'],
            ]
          : [];
      final prev = i > 0 && msgs[i - 1]['content'] is List
          ? [
              for (final b in msgs[i - 1]['content'])
                if (b['type'] == 'tool_use') b['id'],
            ]
          : [];
      expect(ids, prev, reason: 'idx $i');
    }
    final lc = msgs.last['content'];
    expect(lc is String || (lc is List && lc.isNotEmpty), isTrue);
  }

  Map<String, dynamic> wr(String id) => use([
    (
      id,
      'mail_send',
      {
        'to': ['a@x'],
        'subject': 's',
        'body': 'b',
      },
    ),
  ]);

  test(
    '확인 뒤 다음 턴이 429로 실패 → tool_result 유지, 다음 입력과 한 메시지로, 고아 tool_use 없음',
    () async {
      final brain = Brain([
        wr('w1'),
        {'__status': 429},
        say('완료'),
      ]);
      final gw = scenarioGw();
      final c = scope(brain, gw);
      final s = c.read(assistantSessionProvider.notifier);
      await s.send('보내줘');
      await s.confirm();
      final st = c.read(assistantSessionProvider);
      expect(st.busy, isFalse);
      expect(st.awaitingFix, isTrue);
      expect(st.items.last.text, '한도 초과');
      await s.send('다시 시도');
      final msgs = brain.received.last;
      expectValid(msgs);
      final lastUser = msgs.last['content'] as List;
      expect(lastUser.first['tool_use_id'], 'w1');
      expect(lastUser.last, {'type': 'text', 'text': '다시 시도'});
    },
  );

  test('읽기 루프 중 네트워크 오류 → 같은 불변식', () async {
    final brain = Brain([
      use([('r1', 'list_rooms', {})]),
      {'__throw': true},
      say('ok'),
    ]);
    final c = scope(brain, scenarioGw());
    final s = c.read(assistantSessionProvider.notifier);
    await s.send('회의실');
    expect(c.read(assistantSessionProvider).busy, isFalse);
    expect(c.read(assistantSessionProvider).awaitingFix, isTrue);
    await s.send('다시');
    final msgs = brain.received.last;
    expectValid(msgs);
    expect((msgs.last['content'] as List).first['tool_use_id'], 'r1');
  });

  test('첫 턴 실패(문자열 user)는 메시지를 제거한다 — {enabled:false}', () async {
    final brain = Brain([
      {'enabled': false},
      say('ok'),
    ]);
    final c = scope(brain, scenarioGw());
    final s = c.read(assistantSessionProvider.notifier);
    await s.send('안녕');
    expect(c.read(assistantSessionProvider).awaitingFix, isFalse);
    await s.send('다시');
    expect(brain.received.last, hasLength(1));
    expectValid(brain.received.last);
  });

  test(
    'trimHistory — 고쳐 줘 사이클(tool_result+text) 25번 뒤에도 고아 tool_result가 없다',
    () {
      final m = <Map<String, dynamic>>[
        {'role': 'user', 'content': 'q'},
      ];
      for (var i = 0; i < 25; i++) {
        m.add({
          'role': 'assistant',
          'content': [
            {'type': 'tool_use', 'id': 't$i', 'name': 'mail_send', 'input': {}},
          ],
        });
        m.add({
          'role': 'user',
          'content': [
            {'type': 'tool_result', 'tool_use_id': 't$i', 'content': '{}'},
            {'type': 'text', 'text': 'fix$i'},
          ],
        });
      }
      final t = trimHistory(m);
      expect(t.length, lessThanOrEqualTo(40));
      expectValid(t);
      expect(t.last, m.last);
      // 컷 지점 없음 → 마지막 user만, tool_result 없이
      final only = trimHistory([
        for (var i = 0; i < 25; i++) ...[
          {
            'role': 'assistant',
            'content': [
              {'type': 'tool_use', 'id': 'a$i', 'name': 'x', 'input': {}},
            ],
          },
          {
            'role': 'user',
            'content': [
              {'type': 'tool_result', 'tool_use_id': 'a$i', 'content': '{}'},
            ],
          },
        ],
      ]);
      expect(only, hasLength(1));
      expect(only.single['role'], 'user');
      expect(only.single['content'], isEmpty);
    },
  );

  test('러너 생성이 예외 → 알림, busy 해제, 다음 입력은 유효한 메시지', () async {
    final brain = Brain([
      use([('r1', 'list_rooms', {})]),
      say('ok'),
    ]);
    final store = _FlakyStore();
    final c = ProviderContainer(
      overrides: [
        apiClientProvider.overrideWithValue(brain.client),
        gwStoreProvider.overrideWithValue(store),
        gwHttpClientProvider.overrideWithValue(scenarioGw().client),
      ],
    );
    addTearDown(c.dispose);
    final s = c.read(assistantSessionProvider.notifier);
    await s.send('회의실');
    final st = c.read(assistantSessionProvider);
    expect(st.busy, isFalse);
    expect(st.items.last.kind, ChatKind.notice);
    c.invalidate(gwProvider);
    await s.send('다시');
    expectValid(brain.received.last);
    expect(brain.received.last.last['content'], '다시');
  });

  test('카드 문장 생성이 예외 → 대기 카드가 남지 않아 confirm은 아무것도 실행하지 않는다', () async {
    final brain = Brain([
      use([('w1', 'create_event', {'title': 't', 'start': '2026-10-05T15:00', 'end': '2026-10-05T16:00', 'attendees': '강승억'})]),
      say('ok'),
    ]);
    final c = ProviderContainer(
      overrides: [
        apiClientProvider.overrideWithValue(brain.client),
        gwStoreProvider.overrideWithValue(FakeGwStore(testCreds)),
        gwHttpClientProvider.overrideWithValue(scenarioGw().client),
      ],
    );
    addTearDown(c.dispose);
    final s = c.read(assistantSessionProvider.notifier);
    await s.send('일정');
    expect(c.read(assistantSessionProvider).pending, isFalse);
    final sent = brain.received.length;
    await s.confirm();
    await s.dismiss();
    expect(brain.received.length, sent);
    await s.send('다시');
    expectValid(brain.received.last);
  });

  test('undo_last 두 번 → 대상 중복 제거, 결과는 되돌리기 대상만으로', () async {
    SharedPreferences.setMockInitialValues({
      'assistant.journal': jsonEncode([
        {
          'at': '2026-10-05T10:00',
          'tool': 'reserve_room',
          'summary': 's',
          'undo': {
            'tool': 'cancel_reservation',
            'args': {
              'res_seq': 'R2',
              'seq_num': 6,
              'res_idx': '1',
              'label': '10/5 회의실B',
            },
          },
        },
      ]),
    });
    final gw = Gw({
      ...base(),
      '/schres/rs121A10': (_) => {'reqText': '내 회의', 'empSeq': '7'},
      '/schres/rs121A11': (_) => {},
    });
    final brain = Brain([
      use([('u1', 'undo_last', {}), ('u2', 'undo_last', {})]),
      say('끝'),
    ]);
    final c = scope(brain, gw);
    final s = c.read(assistantSessionProvider.notifier);
    await s.send('취소해줘');
    expect(c.read(assistantSessionProvider).items.last.lines, hasLength(1));
    await s.confirm();
    expect(gw.calls['/schres/rs121A11'], hasLength(1));
    final rs = toolResults(brain.received.last);
    expect(rs.map((b) => b['tool_use_id']), ['u1', 'u2']);
    expectValid(brain.received.last);
  });

  test('busy 중 reset·send는 무시', () async {
    final brain = Brain([say('ok')]);
    final c = scope(brain, scenarioGw());
    final s = c.read(assistantSessionProvider.notifier);
    final f = s.send('안녕');
    s.reset();
    await s.send('두번째');
    await f;
    expect(brain.received, hasLength(1));
    expect(
      c
          .read(assistantSessionProvider)
          .items
          .where((i) => i.kind == ChatKind.user),
      hasLength(1),
    );
  });

  List<dynamic> resultsOf(List msgs) => [
    for (final b in toolResults(msgs)) jsonDecode(b['content'] as String),
  ];

  test('카드는 실제 대상 — 조직도에 없는 참석자는 카드 없이 ok:false, 이름이 틀려도 실제 사람(부서)을 보인다', () async {
    final brain = Brain([
      use([
        ('e', 'create_event', {'title': '회의', 'start': '2026-10-05T16:00', 'end': '2026-10-05T17:00', 'attendees': [{'emp_seq': '31', 'dept_seq': '20', 'name': '강승억'}, {'emp_seq': '404', 'dept_seq': '20', 'name': '정선미'}]}),
      ]),
      use([
        ('e2', 'create_event', {'title': '회의', 'start': '2026-10-05T16:00', 'end': '2026-10-05T17:00', 'attendees': [{'emp_seq': '33', 'dept_seq': '30', 'name': '김민준'}]}),
      ]),
    ]);
    final gw = scenarioGw();
    final c = scope(brain, gw);
    await c.read(assistantSessionProvider.notifier).send('회의 잡아줘');
    final first = resultsOf(brain.received[1]).single;
    expect(first, {'ok': false, 'error': '참석자를 조직도에서 찾지 못했습니다: 정선미(404)'});
    final st = c.read(assistantSessionProvider);
    expect(st.pending, isTrue, reason: '두 번째 응답은 카드');
    expect(st.items.where((i) => i.kind == ChatKind.card), hasLength(1));
    expect(st.items.last.lines.single, contains('참석 김민준(클라우드팀)'), reason: '모델이 dept_seq 30이라 써도 emp_seq 33의 실제 부서');
    expect(gw.calls['/schres/sc111A05'], isNull);
  });

  test('카드는 실제 대상 — 회의실 이름은 res_seq의 자원 목록에서, 모델이 쓴 room_name이 아니다', () async {
    final brain = Brain([
      use([('d', 'reserve_room', {'res_seq': 'R1', 'room_name': '회의실B', 'start': '2026-10-05T16:00', 'end': '2026-10-05T17:00', 'title': '회의'})]),
      use([('d2', 'reserve_room', {'res_seq': 'R404', 'room_name': '회의실B', 'start': '2026-10-05T16:00', 'end': '2026-10-05T17:00', 'title': '회의'})]),
    ]);
    final c = scope(brain, scenarioGw());
    final s = c.read(assistantSessionProvider.notifier);
    await s.send('잡아줘');
    expect(c.read(assistantSessionProvider).items.last.lines.single, "회의실 예약 · 10/5(월) 16:00–17:00 · 회의실A · '회의'");
    await s.dismiss();
    expect(resultsOf(brain.received.last).single['error'], startsWith('회의실을 찾지 못했습니다'));
    expect(c.read(assistantSessionProvider).pending, isFalse);
  });

  test('카드는 실제 대상 — 내 채팅 목록에 없는 chat_id의 teams_send는 거부, 있으면 실제 이름', () async {
    final brain = Brain([
      use([('t', 'teams_send', {'chat_id': '19:evil@thread.v2', 'chat_name': '센터', 'text': '안녕'})]),
      use([('t2', 'teams_send', {'chat_id': '19:a@thread.v2', 'chat_name': '사장님', 'text': '안녕'})]),
    ]);
    final c = scope(brain, scenarioGw());
    await c.read(assistantSessionProvider.notifier).send('보내줘');
    expect(resultsOf(brain.received[1]).single['error'], startsWith('채팅방을 찾지 못했습니다'));
    expect(c.read(assistantSessionProvider).items.last.lines.single, 'Teams 보내기 · 센터 · "안녕"');
    expect(brain.executed.where((e) => e['tool'] == 'teams_send'), isEmpty);
  });

  test('확인 정보를 못 가져오면(네트워크) 카드 없이 ok:false, 함께 온 다른 쓰기도 실행 안 함', () async {
    final brain = Brain([
      use([
        ('d', 'reserve_room', {'res_seq': 'R1', 'start': '2026-10-05T16:00', 'end': '2026-10-05T17:00', 'title': '회의'}),
        ('m', 'mail_save_draft', {'to': ['a@x'], 'subject': 's', 'body': 'b'}),
      ]),
    ]);
    final gw = Gw({...scenarioGw().routes, '/schres/rs121A01': (_) => http.Response('x', 500)});
    final c = scope(brain, gw);
    await c.read(assistantSessionProvider.notifier).send('잡아줘');
    final rs = resultsOf(brain.received[1]);
    expect(rs[0], {'ok': false, 'error': '확인에 필요한 정보를 가져오지 못했습니다'});
    expect(rs[1]['ok'], isFalse);
    expect(c.read(assistantSessionProvider).items.where((i) => i.kind == ChatKind.card), isEmpty);
    expect(gw.calls['/mail/mail014A14'], isNull);
  });

  test('카드 상태 — 실행 중… → 전부 성공 "실행했습니다", 뒤가 실패 "일부만", 첫 작업 실패 "실행하지 못했습니다"', () async {
    String cardText(ProviderContainer c) => c.read(assistantSessionProvider).items.lastWhere((i) => i.kind == ChatKind.card).text;
    Future<String> run(List<(String, String, Map<String, dynamic>)> calls, {List<String>? during}) async {
      late ProviderContainer c;
      final routes = {...scenarioGw().routes};
      final orig = routes['/schres/rs121A06']!;
      routes['/schres/rs121A06'] = (b) {
        during?.add(cardText(c));
        return orig(b);
      };
      c = scope(Brain([use(calls), say('끝')]), Gw(routes));
      await c.read(assistantSessionProvider.notifier).send('해줘');
      await c.read(assistantSessionProvider.notifier).confirm();
      return cardText(c);
    }
    const ok = ('d', 'reserve_room', {'res_seq': 'R2', 'start': '2026-10-05T16:00', 'end': '2026-10-05T17:00', 'title': '회의'});
    const bad = ('e', 'create_event', {'title': '회의', 'start': 'bad', 'end': 'bad'});
    final during = <String>[];
    expect(await run([ok], during: during), '실행했습니다');
    expect(during, ['실행 중…']);
    expect(await run([ok, bad]), '일부만 실행했습니다');
    expect(await run([bad, ok]), '실행하지 못했습니다');
  });

  test('서버가 {enabled:false}면 이노봇을 이번 실행 동안 숨긴다', () async {
    final c = scope(Brain([{'enabled': false}]), scenarioGw());
    expect(c.read(assistantAvailableProvider), isTrue);
    await c.read(assistantSessionProvider.notifier).send('안녕');
    expect(c.read(assistantAvailableProvider), isFalse);
    c.read(assistantSessionProvider.notifier).reset();
    expect(c.read(assistantAvailableProvider), isFalse);
  });
}
