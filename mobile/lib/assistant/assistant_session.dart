// mobile/lib/assistant/assistant_session.dart
import 'dart:convert';
import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/client.dart';
import '../gw/gw_api.dart';
import '../gw/gw_creds.dart';
import '../gw/gw_models.dart';
import 'assistant_journal.dart';
import 'assistant_tools.dart';

/// 비서 대화 — 턴 루프. 서버(/api/assistant/turn)는 무상태 중계라 대화(Claude 형식 messages)는 여기 메모리에만 있다(앱이 켜져 있는 동안).
/// 조회 도구는 바로 실행, 쓰기·되돌릴 수 없음은 확인 카드로 멈춘다. 모든 tool_use에는 같은 순서로 tool_result를 짝지어 보낸다.
enum ChatKind { user, bot, progress, card, notice }

/// 선택지 카드의 한 선택지(화면용) — lines는 실제 대상으로 만든 카드 문장.
class ChoiceView {
  const ChoiceView(this.label, this.lines, this.irreversible);
  final String label;
  final List<String> lines;
  final bool irreversible;
}

class ChatItem {
  const ChatItem(
    this.kind,
    this.text, {
    this.lines = const [],
    this.irreversible = false,
    this.done = false,
    this.choices = const [],
  });
  final ChatKind kind;
  final String text;
  final List<String> lines;
  final bool irreversible, done;
  final List<ChoiceView> choices; // 비어 있지 않으면 선택지 카드(선택지마다 [실행])
  ChatItem copyWith({bool? done, String? text}) => ChatItem(
    kind,
    text ?? this.text,
    lines: lines,
    irreversible: irreversible,
    done: done ?? this.done,
    choices: choices,
  );
}

class _Choice {
  _Choice(this.label, this.writes, this.lines, this.irreversible);
  final String label;
  final List<ToolCall> writes;
  final List<String> lines;
  final bool irreversible;
}

class _Pending {
  _Pending(
    this.order,
    this.results,
    this.writes,
    this.undoIds,
    this.undoWriteIds, {
    this.choiceId,
    this.choices = const [],
  });
  final String? choiceId; // offer_choices의 tool_use id(선택지 카드일 때)
  final List<_Choice> choices;
  final List<String> order; // 응답의 tool_use id 순서
  final Map<String, Map<String, dynamic>> results; // 이미 정해진 결과(조회 등)
  final List<ToolCall> writes; // 확인 대상(되돌리기면 반대 작업)
  final Set<String> undoIds; // undo_last의 tool_use id들(같은 결과를 각각에 붙임)
  final Set<String> undoWriteIds; // 되돌리기 대상 쓰기의 id
}

class AssistantState {
  const AssistantState({
    this.items = const [],
    this.busy = false,
    this.pending = false,
    this.awaitingFix = false,
  });
  final List<ChatItem> items;
  final bool busy, pending, awaitingFix;
}

String nowIso() {
  final n = kstNow();
  String two(int v) => v.toString().padLeft(2, '0');
  return '${n.year}-${two(n.month)}-${two(n.day)}T${two(n.hour)}:${two(n.minute)}+09:00';
}

/// 오래된 교환을 잘라 max개 이하로 — 잘린 뒤 첫 메시지는 반드시 사용자 텍스트(문자열 content)여야 tool_use/result 짝이 깨지지 않는다.
List<Map<String, dynamic>> trimHistory(
  List<Map<String, dynamic>> m, {
  int max = 40,
}) {
  if (m.length <= max) return m;
  for (var i = m.length - max; i < m.length; i++) {
    if (m[i]['role'] != 'user') continue;
    final c = m[i]['content'];
    if (c is String) return m.sublist(i);
    if (c is List && c.any((b) => b is Map && b['type'] == 'text')) {
      // 앞의 tool_result는 잘린 tool_use의 짝이므로 버린다
      final head = {
        ...m[i],
        'content': [
          for (final b in c)
            if (!(b is Map && b['type'] == 'tool_result')) b,
        ],
      };
      return [head, ...m.sublist(i + 1)];
    }
  }
  // 컷 지점이 없으면 마지막 user만 — 고아 tool_result는 절대 남기지 않는다
  final u = m.lastWhere(
    (x) => x['role'] == 'user',
    orElse: () => {'role': 'user', 'content': <dynamic>[]},
  );
  final c = u['content'];
  final text = c is List
      ? [
          for (final b in c)
            if (b is Map && b['type'] == 'text') '${b['text']}',
        ].join('\n')
      : null;
  return [
    {
      'role': 'user',
      'content': c is String
          ? c
          : (text != null && text.isNotEmpty ? text : <dynamic>[]),
    },
  ];
}

/// 비서 시계(KST 벽시계 + UTC 플래그). 실행 기록 시각·24시간 되돌리기 창·빈 회의실의 "오늘"이 같은 시계를 쓴다(테스트에서 고정).
final assistantClockProvider = Provider<DateTime Function()>((_) => kstNow);

/// 서버가 비서를 꺼 두었다고 답하면({enabled:false}) 이번 앱 실행 동안 이노봇을 숨긴다(LLM 기능은 못 쓸 때 숨김 — 비활성 표시 금지).
final assistantAvailableProvider = NotifierProvider<AssistantAvailable, bool>(
  AssistantAvailable.new,
);

class AssistantAvailable extends Notifier<bool> {
  @override
  bool build() => true;
  void disable() => state = false;
}

final assistantSessionProvider =
    NotifierProvider<AssistantSession, AssistantState>(AssistantSession.new);

final assistantWaitTimeoutProvider = Provider<Duration>(
  (_) => const Duration(seconds: 75),
);

class _Stopped implements Exception {}

class _Run {
  final stopped = Completer<void>();
  List<Map<String, dynamic>> Function()? interruptedResults;
}

class AssistantSession extends Notifier<AssistantState> {
  static const maxTurns = 10;
  final _messages = <Map<String, dynamic>>[];
  final _guard = MailReadGuard();
  _Pending? _pending;
  AssistantJournal? _journal;
  _Run? _run;

  /// Riverpod 3는 invalidate(로그아웃) 뒤에도 노티파이어 인스턴스를 재사용한다 — 필드도 여기서 비운다.
  @override
  AssistantState build() {
    _run?.stopped.complete();
    _run = null;
    _fixResults = null;
    ref.onDispose(() {
      _run?.stopped.complete();
      _run = null;
    });
    _messages.clear();
    _pending = null;
    _guard.reset();
    _journal = null;
    return const AssistantState(items: [ChatItem(ChatKind.bot, '무엇을 도와드릴까요?')]);
  }

  void _set({
    List<ChatItem>? items,
    bool? busy,
    bool? pending,
    bool? awaitingFix,
  }) => state = AssistantState(
    items: items ?? state.items,
    busy: busy ?? state.busy,
    pending: pending ?? state.pending,
    awaitingFix: awaitingFix ?? state.awaitingFix,
  );
  void _add(ChatItem i) => _set(
    items: [...state.items.where((x) => x.kind != ChatKind.progress), i],
  );

  bool _active(_Run run) => ref.mounted && identical(_run, run);

  Future<T> _wait<T>(_Run run, Future<T> future) async {
    try {
      final result =
          await Future.any<T>([
            future,
            run.stopped.future.then<T>((_) => throw _Stopped()),
          ]).timeout(
            ref.read(assistantWaitTimeoutProvider),
            onTimeout: () {
              if (_active(run)) stop(timedOut: true);
              throw _Stopped();
            },
          );
      if (!_active(run)) throw _Stopped();
      return result;
    } catch (_) {
      if (!_active(run)) throw _Stopped();
      rethrow;
    }
  }

  /// 후속 작업과 응답 대기를 중지한다. 이미 전송된 쓰기 요청을 되돌리지는 않는다.
  void stop({bool timedOut = false}) {
    final run = _run;
    if (run == null) return;
    _run = null;
    run.stopped.complete();
    _pending = null;
    if (_messages.isNotEmpty && _messages.last['role'] == 'assistant') {
      final blocks = _messages.last['content'];
      final calls = blocks is List
          ? blocks.whereType<Map>().where((b) => b['type'] == 'tool_use')
          : const <Map>[];
      if (calls.isNotEmpty) {
        _messages.add({
          'role': 'user',
          'content':
              run.interruptedResults?.call() ??
              [
                for (final c in calls)
                  _result('${c['id']}', {
                    'ok': false,
                    'error':
                        '응답 대기를 중지했습니다. 이미 요청한 작업은 실행되었을 수 있습니다. 다시 실행하지 말고 실행 여부를 조회하세요.',
                  }),
              ],
        });
      }
    }
    _rollbackFailedTurn();
    final executing = state.items.any(
      (i) => i.kind == ChatKind.card && i.text.startsWith('실행 중'),
    );
    if (executing) _markCardDone('중지했습니다 · 실행 여부를 확인해 주세요');
    _set(busy: false, pending: false);
    _add(
      ChatItem(
        ChatKind.notice,
        timedOut
            ? '응답 시간이 초과되어 중지했습니다. 이미 실행된 작업은 유지됩니다. 실행 중이던 작업은 실행 여부를 확인해 주세요.'
            : '중지했습니다. 이미 실행된 작업은 유지됩니다. 실행 중이던 작업은 실행 여부를 확인해 주세요.',
      ),
    );
  }

  Future<AssistantToolRunner> _runner(_Run run) async {
    await _wait(run, ref.read(gwProvider.future));
    _journal ??= await _wait(run, AssistantJournal.load());
    return AssistantToolRunner(
      gw: ref.read(gwApiProvider),
      api: ref.read(apiClientProvider),
      journal: _journal!,
      guard: _guard,
      isActive: () => _active(run),
      now: ref.read(assistantClockProvider),
    );
  }

  void reset() {
    if (state.busy) return;
    state = build();
  }

  /// 사용자 입력. 고쳐 줘 대기 중이면 미실행 결과와 함께 같은 메시지로 보낸다.
  Future<void> send(String text) async {
    final t = text.trim();
    if (t.isEmpty || state.busy) return;
    if (state.pending) {
      await dismiss(silent: true);
      _fixResults = (_messages.removeLast()['content'] as List)
          .cast<Map<String, dynamic>>();
      _set(awaitingFix: true);
    }
    _add(ChatItem(ChatKind.user, t));
    final fixing = state.awaitingFix ? _fixResults : null;
    _fixResults = null;
    if (fixing == null) _guard.reset();
    _messages.add({
      'role': 'user',
      'content': fixing == null
          ? t
          : [
              ...fixing,
              {'type': 'text', 'text': t},
            ],
    });
    _set(awaitingFix: false);
    await _drive();
  }

  List<Map<String, dynamic>>? _fixResults;

  Map<String, dynamic> _result(String id, Map<String, dynamic> r) => {
    'type': 'tool_result',
    'tool_use_id': id,
    'content': jsonEncode(slim(r, bodyKeys: const {'body', 'content'})),
    if (r['ok'] == false) 'is_error': true,
  };

  /// 실패한 턴 뒤 history 정리 — 문자열 user는 버리고(다시 입력), tool_result가 든 user는 결과만 남겨 다음 입력과 합친다.
  void _rollbackFailedTurn() {
    if (_messages.isEmpty || _messages.last['role'] != 'user') return;
    final c = _messages.removeLast()['content'];
    if (c is! List) return;
    final results = [
      for (final b in c)
        if (b is Map && b['type'] == 'tool_result')
          Map<String, dynamic>.from(b),
    ];
    if (results.isEmpty) return;
    _fixResults = results;
    _set(awaitingFix: true);
  }

  Future<void> _drive() async {
    final run = _run = _Run();
    _set(busy: true);
    try {
      for (var turn = 0; turn < maxTurns; turn++) {
        _add(const ChatItem(ChatKind.progress, '생각하는 중…'));
        final trimmed = trimHistory(_messages);
        if (trimmed.length != _messages.length) {
          _messages
            ..clear()
            ..addAll(trimmed);
        }
        dynamic res;
        try {
          res = await _wait(
            run,
            ref.read(apiClientProvider).postJsonAbortable(
              '/api/assistant/turn',
              {'messages': _messages, 'now': nowIso()},
              run.stopped.future,
            ),
          );
        } on _Stopped {
          rethrow;
        } on ApiException catch (e) {
          _add(ChatItem(ChatKind.notice, e.message));
          _rollbackFailedTurn();
          return;
        } catch (_) {
          _add(const ChatItem(ChatKind.notice, '네트워크 연결을 확인하고 다시 시도해 주세요.'));
          _rollbackFailedTurn();
          return;
        }
        if (res is! Map || res['enabled'] != true) {
          if (res is Map && res['enabled'] == false) {
            ref.read(assistantAvailableProvider.notifier).disable();
          }
          _add(const ChatItem(ChatKind.notice, '관리자가 비서를 꺼 두었습니다.'));
          _rollbackFailedTurn();
          return;
        }
        try {
          if (!await _handle(res, run)) return;
        } on _Stopped {
          rethrow;
        } catch (_) {
          // 도구 호출은 쓰기를 실행하지 않으므로 assistant 메시지를 버리면 history가 유효하다. 보이지 않는 대기 카드도 버린다.
          _pending = null;
          if (_messages.isNotEmpty && _messages.last['role'] == 'assistant') {
            _messages.removeLast();
          }
          _rollbackFailedTurn();
          _add(const ChatItem(ChatKind.notice, '처리하지 못했습니다. 다시 시도해 주세요.'));
          return;
        }
      }
      _add(const ChatItem(ChatKind.notice, '요청이 너무 복잡합니다. 나눠서 다시 말씀해 주세요.'));
    } on _Stopped {
      return;
    } finally {
      if (_active(run)) {
        _run = null;
        _set(
          busy: false,
          items: [...state.items.where((x) => x.kind != ChatKind.progress)],
        );
      }
    }
  }

  /// 응답 하나 처리. true면 다음 턴으로 계속, false면 멈춤(끝 또는 확인 대기).
  Future<bool> _handle(Map res, _Run run) async {
    final msg = Map<String, dynamic>.from(res['message'] as Map);
    _messages.add(msg);
    final blocks = (msg['content'] as List? ?? const [])
        .whereType<Map>()
        .toList();
    final text = [
      for (final b in blocks)
        if (b['type'] == 'text') '${b['text']}',
    ].join('\n').trim();
    if (text.isNotEmpty) _add(ChatItem(ChatKind.bot, text));
    final calls = [
      for (final b in blocks)
        if (b['type'] == 'tool_use')
          ToolCall(
            '${b['id']}',
            '${b['name']}',
            Map<String, dynamic>.from(b['input'] as Map? ?? const {}),
          ),
    ];
    if (res['stop_reason'] != 'tool_use' || calls.isEmpty) {
      _set(items: [...state.items.where((x) => x.kind != ChatKind.progress)]);
      return false;
    }
    final runner = await _runner(run);
    if (calls.any((c) => tierOf(c.name) == ToolTier.choice)) {
      if (calls.length == 1) return _offerChoices(calls.single, runner, run);
      _messages.add({
        'role': 'user',
        'content': [
          for (final c in calls)
            _result(c.id, {
              'ok': false,
              'error': 'offer_choices는 다른 도구 없이 단독으로 불러야 합니다. 아무것도 실행하지 않았습니다',
            }),
        ],
      });
      return true;
    }
    final results = <String, Map<String, dynamic>>{};
    final writes = <ToolCall>[];
    final undoIds = <String>{}, undoWriteIds = <String>{}, seen = <String>{};
    for (final c in calls) {
      final tier = tierOf(c.name);
      if (tier == null) {
        results[c.id] = {'ok': false, 'error': '모르는 도구입니다: ${c.name}'};
      } else if (tier == ToolTier.read) {
        _add(ChatItem(ChatKind.progress, progressText(c.name)));
        results[c.id] = await _wait(run, runner.run(c));
      } else if (tier == ToolTier.meta) {
        final n = c.input['count'] is num
            ? (c.input['count'] as num).toInt().clamp(1, 5)
            : 1;
        final all = [
          for (final e
              in (_journal ??
                      await _wait<AssistantJournal>(
                        run,
                        AssistantJournal.load(),
                      ))
                  .undoable(n, now: ref.read(assistantClockProvider)()))
            ?undoFor(e),
        ];
        final targets = [
          for (final t in all)
            if (seen.add(t.call.id)) t.call,
        ];
        if (all.isEmpty) {
          results[c.id] = {'ok': false, 'error': '되돌릴 수 있는 최근 작업이 없습니다'};
        } else {
          undoIds.add(c.id);
          undoWriteIds.addAll(targets.map((t) => t.id));
          writes.addAll(targets);
        }
      } else {
        writes.add(c);
      }
    }
    if (writes.isNotEmpty) {
      final p = _Pending(
        [for (final c in calls) c.id],
        results,
        writes,
        undoIds,
        undoWriteIds,
      );
      // 카드는 유일한 안전장치 — 실행에 쓰일 id로 실제 대상을 다시 읽어 그 값으로 만든다. 하나라도 못 찾으면 카드 없이 결과로 돌려준다.
      _add(const ChatItem(ChatKind.progress, '확인할 내용 보는 중…'));
      final lines = <String>[];
      final rejected = <String, Map<String, dynamic>>{};
      for (final w in writes) {
        final r = await _wait(run, runner.resolve(w));
        if (r.error != null) {
          rejected[w.id] = {'ok': false, 'error': r.error};
        } else {
          lines.add(cardLine(w, r.facts));
        }
      }
      if (rejected.isNotEmpty) {
        _messages.add({
          'role': 'user',
          'content': _resultsFor(p, {
            for (final w in writes)
              w.id:
                  rejected[w.id] ??
                  {'ok': false, 'error': '함께 요청한 다른 작업을 확인하지 못해 실행하지 않았습니다'},
          }),
        });
        return true;
      }
      _pending = p;
      _add(
        ChatItem(
          ChatKind.card,
          '실행할까요?',
          lines: lines,
          irreversible: writes.any(
            (w) => tierOf(w.name) == ToolTier.irreversible,
          ),
        ),
      );
      _set(pending: true);
      return false;
    }
    _messages.add({
      'role': 'user',
      'content': [for (final c in calls) _result(c.id, results[c.id]!)],
    });
    return true;
  }

  /// 선택지 — 선택지마다 쓰기 호출을 실제 대상으로 확인해 카드로 보인다. 쓰기가 아닌 호출·확인 안 되는 대상이 든 선택지는 뺀다.
  /// 남는 게 없으면 카드 없이 오류 결과로 이어간다(true = 다음 턴). 실행은 사용자가 고른 선택지의 [실행](confirm(choice:))뿐.
  Future<bool> _offerChoices(
    ToolCall c,
    AssistantToolRunner runner,
    _Run run,
  ) async {
    final raw = c.input['options'];
    final opts = raw is List
        ? raw.whereType<Map>().take(4).toList()
        : const <Map>[];
    _add(const ChatItem(ChatKind.progress, '선택지 확인하는 중…'));
    final good = <_Choice>[];
    final notes = <String>[];
    for (final (k, o) in opts.indexed) {
      final label = '${o['label'] ?? ''}'.trim();
      final cs = o['calls'];
      final ws = <ToolCall>[];
      var bad = label.isEmpty || cs is! List || cs.isEmpty || cs.length > 5;
      if (!bad) {
        for (final (j, x) in cs.indexed) {
          final t = x is Map ? tierOf('${x['name']}') : null;
          if (x is! Map ||
              x['input'] is! Map ||
              (t != ToolTier.write && t != ToolTier.irreversible)) {
            bad = true;
            break;
          }
          ws.add(
            ToolCall(
              '${c.id}#$k.$j',
              '${x['name']}',
              Map<String, dynamic>.from(x['input'] as Map),
            ),
          );
        }
      }
      if (bad) {
        notes.add(
          '${label.isEmpty ? '(이름 없음)' : label}: 선택지에는 쓰기 도구 호출만 넣을 수 있습니다',
        );
        continue;
      }
      final lines = <String>[];
      String? err;
      for (final w in ws) {
        final r = await _wait(run, runner.resolve(w));
        if (r.error != null) {
          err = r.error;
          break;
        }
        lines.add(cardLine(w, r.facts));
      }
      if (err != null) {
        notes.add('$label: $err');
        continue;
      }
      good.add(
        _Choice(
          label,
          ws,
          lines,
          ws.any((w) => tierOf(w.name) == ToolTier.irreversible),
        ),
      );
    }
    if (good.isEmpty) {
      _messages.add({
        'role': 'user',
        'content': [
          _result(c.id, {
            'ok': false,
            'error': '제시한 선택지를 하나도 확인하지 못했습니다',
            'details': notes,
          }),
        ],
      });
      return true;
    }
    _pending = _Pending(
      [c.id],
      {},
      const [],
      {},
      {},
      choiceId: c.id,
      choices: good,
    );
    final q = '${c.input['question'] ?? ''}'.trim();
    _add(
      ChatItem(
        ChatKind.card,
        q.isEmpty ? '어느 것으로 실행할까요?' : q,
        choices: [
          for (final g in good) ChoiceView(g.label, g.lines, g.irreversible),
        ],
      ),
    );
    _set(pending: true);
    return false;
  }

  void _markCardDone(String text) {
    final items = [...state.items];
    final i = items.lastIndexWhere((x) => x.kind == ChatKind.card);
    if (i >= 0) items[i] = items[i].copyWith(done: true, text: text);
    _set(items: items, pending: false);
  }

  List<Map<String, dynamic>> _resultsFor(
    _Pending p,
    Map<String, Map<String, dynamic>> writeResults,
  ) {
    final undoWrites = [
      for (final w in p.writes)
        if (p.undoWriteIds.contains(w.id)) w,
    ];
    final undoResult = p.undoIds.isEmpty
        ? null
        : {
            'ok': undoWrites.every((w) => writeResults[w.id]?['ok'] == true),
            'undone': [
              for (final w in undoWrites)
                {'action': cardLine(w), 'result': writeResults[w.id]},
            ],
          };
    return [
      for (final id in p.order)
        if (p.undoIds.contains(id))
          _result(id, undoResult!)
        else
          _result(
            id,
            p.results[id] ??
                writeResults[id] ??
                {'ok': false, 'error': '실행되지 않았습니다'},
          ),
    ];
  }

  /// 확인 카드 실행 — 순서대로, 앞 작업이 실패하면 뒤 작업은 건너뛴다.
  /// 선택지 카드면 choice(0부터)가 있어야 하고 그 선택지의 쓰기만 실행한다.
  Future<void> confirm({int? choice}) async {
    final p = _pending;
    if (p == null || state.busy) return;
    final picked = p.choices.isEmpty
        ? null
        : (choice != null && choice >= 0 && choice < p.choices.length
              ? p.choices[choice]
              : null);
    if (p.choices.isNotEmpty && picked == null) return;
    final run = _run = _Run();
    final writes = picked?.writes ?? p.writes;
    _pending = null;
    _markCardDone(picked == null ? '실행 중…' : '실행 중… — ${picked.lines.first}');
    _set(busy: true);
    final out = <String, Map<String, dynamic>>{};
    final started = <String>{};
    run.interruptedResults = () {
      final results = {
        for (final w in writes)
          w.id:
              out[w.id] ??
              {
                'ok': false,
                'error': started.contains(w.id)
                    ? '응답 대기 중지. 실행 여부를 조회하세요. 자동으로 다시 실행하지 마세요.'
                    : '중지되어 실행하지 않았습니다',
              },
      };
      return _resultsFor(
        p,
        picked == null
            ? results
            : {
                p.choiceId!: {
                  'ok': false,
                  'chosen': picked.label,
                  'results': [
                    for (final (j, w) in writes.indexed)
                      {'action': picked.lines[j], 'result': results[w.id]},
                  ],
                },
              },
      );
    };
    var failed = false;
    try {
      final runner = await _runner(run);
      for (final w in writes) {
        if (failed) {
          out[w.id] = {'ok': false, 'error': '앞 작업이 실패해 실행하지 않았습니다'};
          continue;
        }
        _add(
          ChatItem(
            ChatKind.progress,
            '${cardLine(w).split(' · ').first} 하는 중…',
          ),
        );
        started.add(w.id);
        final r = await _wait(run, runner.run(w)); // 취소·삭제 성공은 러너가 실행 기록에서 지운다
        out[w.id] = r;
        if (r['ok'] != true) failed = true;
      }
    } on _Stopped {
      return;
    } catch (_) {
      for (final w in writes) {
        out.putIfAbsent(w.id, () => {'ok': false, 'error': '실행되지 않았습니다'});
      }
    } finally {
      if (_active(run)) {
        _run = null;
        _set(
          busy: false,
          items: [...state.items.where((x) => x.kind != ChatKind.progress)],
        );
      }
    }
    final okCount = writes.where((w) => out[w.id]?['ok'] == true).length;
    final status = okCount == writes.length
        ? '실행했습니다'
        : out[writes.first.id]?['ok'] == true
        ? '일부만 실행했습니다'
        : '실행하지 못했습니다';
    _markCardDone(picked == null ? status : '$status — ${picked.lines.first}');
    _messages.add({
      'role': 'user',
      'content': _resultsFor(
        p,
        picked == null
            ? out
            : {
                p.choiceId!: {
                  'ok': okCount == writes.length,
                  'chosen': picked.label,
                  'results': [
                    for (final (j, w) in writes.indexed)
                      {
                        'action': picked.lines[j],
                        'result':
                            out[w.id] ?? {'ok': false, 'error': '실행되지 않았습니다'},
                      },
                  ],
                },
              },
      ),
    });
    await _drive();
  }

  /// 그만두기 — 모든 쓰기에 "사용자가 취소" 결과를 붙여 이어간다(silent면 새 입력 직전 정리용, 턴을 돌리지 않음).
  Future<void> dismiss({bool silent = false}) async {
    final p = _pending;
    if (p == null || state.busy) return;
    _pending = null;
    _markCardDone('그만두었습니다');
    _messages.add({
      'role': 'user',
      'content': _resultsFor(p, {
        for (final w in p.writes) w.id: {'ok': false, 'error': '사용자가 취소함'},
        if (p.choiceId != null) p.choiceId!: {'ok': false, 'error': '사용자가 취소함'},
      }),
    });
    if (!silent) await _drive();
  }

  /// 고쳐 줘 — 실행하지 않고, 다음 입력을 미실행 결과와 함께 보낸다.
  void fix() {
    final p = _pending;
    if (p == null || state.busy) return;
    _pending = null;
    _markCardDone('고칠 내용을 말씀해 주세요');
    _fixResults = _resultsFor(p, {
      for (final w in p.writes)
        w.id: {'ok': false, 'error': '사용자가 실행하지 않고 고칠 내용을 말함'},
      if (p.choiceId != null)
        p.choiceId!: {'ok': false, 'error': '사용자가 고르지 않고 고칠 내용을 말함'},
    });
    _set(awaitingFix: true);
  }
}
