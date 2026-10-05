// mobile/lib/assistant/assistant_session.dart
import 'dart:convert';
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

class ChatItem {
  const ChatItem(
    this.kind,
    this.text, {
    this.lines = const [],
    this.irreversible = false,
    this.done = false,
  });
  final ChatKind kind;
  final String text;
  final List<String> lines;
  final bool irreversible, done;
  ChatItem copyWith({bool? done, String? text}) => ChatItem(
    kind,
    text ?? this.text,
    lines: lines,
    irreversible: irreversible,
    done: done ?? this.done,
  );
}

class _Pending {
  _Pending(
    this.order,
    this.results,
    this.writes,
    this.undoIds,
    this.undoWriteIds,
  );
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

final assistantSessionProvider =
    NotifierProvider<AssistantSession, AssistantState>(AssistantSession.new);

class AssistantSession extends Notifier<AssistantState> {
  static const maxTurns = 10;
  final _messages = <Map<String, dynamic>>[];
  final _guard = MailReadGuard();
  _Pending? _pending;
  AssistantJournal? _journal;

  @override
  AssistantState build() =>
      const AssistantState(items: [ChatItem(ChatKind.bot, '무엇을 도와드릴까요?')]);

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

  Future<AssistantToolRunner> _runner() async {
    await ref.read(gwProvider.future);
    _journal ??= await AssistantJournal.load();
    return AssistantToolRunner(
      gw: ref.read(gwApiProvider),
      api: ref.read(apiClientProvider),
      journal: _journal!,
      guard: _guard,
    );
  }

  void reset() {
    if (state.busy) return;
    _messages.clear();
    _pending = null;
    _guard.reset();
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
          res = await ref.read(apiClientProvider).postJson(
            '/api/assistant/turn',
            {'messages': _messages, 'now': nowIso()},
          );
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
          _add(const ChatItem(ChatKind.notice, '관리자가 비서를 꺼 두었습니다.'));
          _rollbackFailedTurn();
          return;
        }
        try {
          if (!await _handle(res)) return;
        } catch (_) {
          // 도구 호출은 쓰기를 실행하지 않으므로 assistant 메시지를 버리면 history가 유효하다
          if (_messages.isNotEmpty && _messages.last['role'] == 'assistant') {
            _messages.removeLast();
          }
          _rollbackFailedTurn();
          _add(const ChatItem(ChatKind.notice, '처리하지 못했습니다. 다시 시도해 주세요.'));
          return;
        }
      }
      _add(const ChatItem(ChatKind.notice, '요청이 너무 복잡합니다. 나눠서 다시 말씀해 주세요.'));
    } finally {
      _set(
        busy: false,
        items: [...state.items.where((x) => x.kind != ChatKind.progress)],
      );
    }
  }

  /// 응답 하나 처리. true면 다음 턴으로 계속, false면 멈춤(끝 또는 확인 대기).
  Future<bool> _handle(Map res) async {
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
    final runner = await _runner();
    final results = <String, Map<String, dynamic>>{};
    final writes = <ToolCall>[];
    final undoIds = <String>{}, undoWriteIds = <String>{}, seen = <String>{};
    for (final c in calls) {
      final tier = tierOf(c.name);
      if (tier == null) {
        results[c.id] = {'ok': false, 'error': '모르는 도구입니다: ${c.name}'};
      } else if (tier == ToolTier.read) {
        _add(ChatItem(ChatKind.progress, progressText(c.name)));
        results[c.id] = await runner.run(c);
      } else if (tier == ToolTier.meta) {
        final n = c.input['count'] is num
            ? (c.input['count'] as num).toInt().clamp(1, 5)
            : 1;
        final all = [
          for (final e in (_journal ?? await AssistantJournal.load()).undoable(
            n,
          ))
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
      _pending = _Pending(
        [for (final c in calls) c.id],
        results,
        writes,
        undoIds,
        undoWriteIds,
      );
      _add(
        ChatItem(
          ChatKind.card,
          '실행할까요?',
          lines: [for (final w in writes) cardLine(w)],
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
  Future<void> confirm() async {
    final p = _pending;
    if (p == null || state.busy) return;
    _pending = null;
    _markCardDone('실행했습니다');
    _set(busy: true);
    final out = <String, Map<String, dynamic>>{};
    var failed = false;
    try {
      final runner = await _runner();
      for (final w in p.writes) {
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
        final r = await runner.run(w);
        out[w.id] = r;
        if (r['ok'] != true) failed = true;
        if (p.undoWriteIds.contains(w.id) && r['ok'] == true) {
          final j = _journal ?? await AssistantJournal.load();
          for (final e in j.undoable(AssistantJournal.max)) {
            if (undoFor(e)?.call.id == w.id) await j.remove(e);
          }
        }
      }
    } catch (_) {
      for (final w in p.writes) {
        out.putIfAbsent(w.id, () => {'ok': false, 'error': '실행되지 않았습니다'});
      }
    } finally {
      _set(
        busy: false,
        items: [...state.items.where((x) => x.kind != ChatKind.progress)],
      );
    }
    _messages.add({'role': 'user', 'content': _resultsFor(p, out)});
    await _drive();
  }

  /// 그만두기 — 모든 쓰기에 "사용자가 취소" 결과를 붙여 이어간다(silent면 새 입력 직전 정리용, 턴을 돌리지 않음).
  Future<void> dismiss({bool silent = false}) async {
    final p = _pending;
    if (p == null) return;
    _pending = null;
    _markCardDone('그만두었습니다');
    _messages.add({
      'role': 'user',
      'content': _resultsFor(p, {
        for (final w in p.writes) w.id: {'ok': false, 'error': '사용자가 취소함'},
      }),
    });
    if (!silent) await _drive();
  }

  /// 고쳐 줘 — 실행하지 않고, 다음 입력을 미실행 결과와 함께 보낸다.
  void fix() {
    final p = _pending;
    if (p == null) return;
    _pending = null;
    _markCardDone('고칠 내용을 말씀해 주세요');
    _fixResults = _resultsFor(p, {
      for (final w in p.writes)
        w.id: {'ok': false, 'error': '사용자가 실행하지 않고 고칠 내용을 말함'},
    });
    _set(awaitingFix: true);
  }
}
