// mobile/lib/assistant/assistant_session.dart
import 'dart:convert';
import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/client.dart';
import '../gw/gw_api.dart';
import '../gw/gw_creds.dart';
import '../gw/gw_models.dart';
import '../gw/mail_indexer.dart';
import 'assistant_journal.dart';
import 'assistant_tools.dart';
import 'chat_api.dart';

/// 비서 대화 — 서버(/api/chat/turn)가 대화를 저장한다. 앱은 needs_action을 받아 앱 도구를 실행하고 확인 카드를 보인 뒤 actions로 회신한다.
/// 조회 도구는 바로 실행, 쓰기·되돌릴 수 없음은 확인 카드로 멈춘다. 서버 읽기는 서버가 실행하고, 서버 쓰기는 카드 확인 뒤 approve로 맡긴다.
/// tool = 도구 칩(id·status: running|ok|error|…, text = 진행 문구 또는 결과 요약), masked = "개인정보 N건 가림".
enum ChatKind { user, bot, progress, card, notice, tool, masked }

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
    this.id,
    this.status,
  });
  final ChatKind kind;
  final String? id, status;
  final String text;
  final List<String> lines;
  final bool irreversible, done;
  final List<ChoiceView> choices; // 비어 있지 않으면 선택지 카드(선택지마다 [실행])
  ChatItem copyWith({bool? done, String? text, String? status}) => ChatItem(
    kind,
    text ?? this.text,
    lines: lines,
    irreversible: irreversible,
    done: done ?? this.done,
    choices: choices,
    id: id,
    status: status ?? this.status,
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

/// 비서 시계(KST 벽시계 + UTC 플래그). 실행 기록 시각·24시간 되돌리기 창·빈 회의실의 "오늘"이 같은 시계를 쓴다(테스트에서 고정).
final assistantClockProvider = Provider<DateTime Function()>((_) => kstNow);

/// 서버가 비서를 꺼 두었다고 답하면(403 code assistant_disabled) 이번 앱 실행 동안 이노봇을 숨긴다(LLM 기능은 못 쓸 때 숨김 — 비활성 표시 금지).
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

/// 서버 한 요청(스트림) 대기 상한 — 서버 도구 왕복·데스크톱 중계 때문에 앱 도구(75초)보다 길다.
final assistantTurnTimeoutProvider = Provider<Duration>((_) => const Duration(seconds: 300));

class _Stopped implements Exception {}

class _Run {
  final stopped = Completer<void>();
}

class AssistantSession extends Notifier<AssistantState> {
  static const maxTurns = 10;
  String? _conversationId;
  String? get conversationId => _conversationId;
  final _approved = <String>{}; // confirm에서 승인한 서버 쓰기 id
  Map<String, PendingCall> _calls = {}; // 현재 needs_action 호출(id → 위치·등급)
  final _toolStatus = <String, String>{}; // 이번 _drive에서 서버가 알려 준 도구 결과(id → ok|error|…)
  final _guard = MailReadGuard();
  List<Map<String, dynamic>>? _unsent; // 서버에 닿지 못한 회신(오류·끊김·중지) — 다음 입력 전에 먼저 보낸다(그냥 텍스트를 보내면 서버가 대기 호출을 "취소됨"으로 닫는다)
  _Pending? _pending;
  AssistantJournal? _journal;
  _Run? _run;

  /// Riverpod 3는 invalidate(로그아웃) 뒤에도 노티파이어 인스턴스를 재사용한다 — 필드도 여기서 비운다.
  @override
  AssistantState build() {
    _run?.stopped.complete();
    _run = null;
    ref.onDispose(() {
      _run?.stopped.complete();
      _run = null;
    });
    _conversationId = null;
    _calls = {};
    _approved.clear();
    _toolStatus.clear();
    _unsent = null;
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
    final executing = state.items.where(
      (i) => i.kind == ChatKind.card && i.text.startsWith('실행 중'),
    );
    if (executing.isNotEmpty) _markCardDone('중지했습니다 · 실행 여부를 확인해 주세요', item: executing.last);
    _set(busy: false, pending: false, items: _settled(state.items));
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
      mailIndex: ref.read(mailIndexProvider.notifier),
    );
  }

  void reset() {
    if (state.busy) return;
    state = build();
  }

  /// 서버 대화 불러오기(🕘 기록). 실패하면 지금 대화를 그대로 두고 안내만.
  Future<void> open(String id) async {
    if (state.busy) return;
    try {
      final (:model, :lines) = await ref.read(chatApiProvider).load(id);
      if (state.busy) return; // 불러오는 사이 보내기가 시작됐다 — 진행 중인 대화를 덮지 않는다
      state = build();
      _conversationId = id;
      if (model != null) ref.read(assistantModelProvider.notifier).pick(model);
      final items = <ChatItem>[];
      for (final l in lines) {
        if (l.kind == 'files') {
          // 첨부 이름은 바로 앞 사용자 말풍선에 붙인다(글 없이 첨부만 보낸 말이면 빈 말풍선)
          final names = l.text.split('\n');
          if (items.lastOrNull case final u? when u.kind == ChatKind.user && u.lines.isEmpty) {
            items.last = ChatItem(ChatKind.user, u.text, lines: names);
          } else {
            items.add(ChatItem(ChatKind.user, '', lines: names));
          }
          continue;
        }
        items.add(switch (l.kind) {
          'user' => ChatItem(ChatKind.user, l.text),
          'tool' => ChatItem(ChatKind.tool, l.text, status: l.status),
          'masked' => ChatItem(ChatKind.masked, l.text),
          _ => ChatItem(ChatKind.bot, l.text),
        });
      }
      _set(items: [...items, if (lines.isEmpty) const ChatItem(ChatKind.bot, '무엇을 도와드릴까요?')]);
    } catch (_) {
      _add(const ChatItem(ChatKind.notice, '대화를 불러오지 못했습니다.'));
    }
  }

  /// 사용자 입력. 대기 카드는 그만두기로 닫는다 — 서버가 대기 호출을 "취소됨"으로 닫고 이 입력을 붙인다(고쳐 줘도 같은 길).
  /// 보내지 못한 회신이 있으면 먼저 보낸다 — 그 결과 확인 카드가 뜨면 이 입력은 보내지 않고 카드를 먼저 보인다.
  /// files: 올려 둔 첨부(id·이름) — 말풍선에 이름을 보이고 attachmentIds로 보낸다. 글 없이 첨부만 보내도 된다.
  Future<void> send(String text, {List<({String id, String name})> files = const []}) async {
    final t = text.trim();
    if ((t.isEmpty && files.isEmpty) || state.busy) return;
    if (state.pending) {
      _pending = null;
      _markCardDone('그만두었습니다');
    }
    _add(ChatItem(ChatKind.user, t, lines: [for (final f in files) f.name]));
    if (!state.awaitingFix) _guard.reset();
    _set(awaitingFix: false);
    if (_unsent case final u?) {
      if (!await _drive({'actions': u}, resend: true)) {
        if (state.pending) _add(const ChatItem(ChatKind.notice, '확인할 작업이 있어 먼저 보여 드립니다. 처리 후 다시 말씀해 주세요.'));
        return;
      }
    }
    await _drive({if (t.isNotEmpty) 'text': t, if (files.isNotEmpty) 'attachmentIds': [for (final f in files) f.id]});
  }

  /// 회신 목록 — 앱 호출은 결과(오류면 서버가 문자열로 읽으므로 JSON 문자열), 서버 쓰기는 승인 여부(confirm에서 승인한 것만 true), 서버 읽기는 서버가 실행하므로 뺀다.
  List<Map<String, dynamic>> _replies(Iterable<(String, Map<String, dynamic>)> rs) => [
    for (final (id, r) in rs)
      if (_calls[id] case final c? when c.onServer) ...[
        if (tierOf(c.name) != ToolTier.read) {'id': id, 'approve': _approved.contains(id)},
      ] else
        _reply(id, r),
  ];

  Map<String, dynamic> _reply(String id, Map<String, dynamic> r) {
    final v = slim(r, bodyKeys: const {'body', 'content'});
    return r['ok'] == false ? {'id': id, 'result': jsonEncode(v), 'isError': true} : {'id': id, 'result': v};
  }

  /// 서버로 이어 간다. done으로 끝나면 true(카드 대기·오류·중지는 false).
  /// resend: 보내지 못한 회신을 다시 보내는 중 — 서버가 입력 오류(이미 처리됨·처리 중)로 거절하면 조용히 true.
  Future<bool> _drive(Map<String, dynamic> first, {bool resend = false}) async {
    final run = _run = _Run();
    _set(busy: true);
    _toolStatus.clear();
    var body = first;
    try {
      for (var turn = 0; turn < maxTurns; turn++) {
        _add(const ChatItem(ChatKind.progress, '생각하는 중…'));
        var botIndex = -1;
        final sent = body['actions'] is List ? List<Map<String, dynamic>>.from(body['actions'] as List) : null;
        if (sent != null) _unsent = sent; // 결과를 받으면 비운다 — 오류·끊김·중지면 남아 다음 입력 전에 다시 보낸다(서버가 중복 실행을 막는다)
        TurnOutcome outcome;
        try {
          outcome = await _waitTurn(run, ref.read(chatApiProvider).turn(
            {...body, 'client': 'app', 'now': nowIso(), if (_conversationId != null) 'conversationId': _conversationId, 'model': ?ref.read(assistantModelProvider)},
            onText: (d) {
              if (!_active(run) || d.isEmpty) return;
              final items = [...state.items.where((x) => x.kind != ChatKind.progress)];
              if (botIndex < 0 || botIndex >= items.length) {
                items.add(ChatItem(ChatKind.bot, d));
                botIndex = items.length - 1;
              } else {
                items[botIndex] = items[botIndex].copyWith(text: items[botIndex].text + d);
              }
              _set(items: items);
            },
            onTool: (id, tool, status, summary) {
              if (!_active(run)) return;
              if (status == 'running') {
                botIndex = -1; // 도구 뒤 이어지는 답은 새 말풍선
                _add(ChatItem(ChatKind.tool, progressText(tool), id: id, status: status));
                return;
              }
              _toolStatus[id] = status; // 스트림이 뒤에 끊겨도 받은 결과는 남긴다
              _set(items: [
                for (final i in state.items)
                  if (i.kind == ChatKind.tool && i.id == id) i.copyWith(status: status, text: summary.isEmpty ? i.text : summary) else i,
              ]);
            },
            onMasked: (n) {
              if (!_active(run)) return;
              // 진행 표시 앞에 끼운다(아직 생각하는 중)
              final items = [...state.items];
              var at = items.length;
              while (at > 0 && items[at - 1].kind == ChatKind.progress) {
                at--;
              }
              items.insert(at, ChatItem(ChatKind.masked, maskedText(n)));
              _set(items: items);
            },
            abort: run.stopped.future,
          ));
        } on _Stopped {
          rethrow;
        } catch (_) {
          // ChatApi.turn은 ApiException만 결과로 바꾼다 — 연결 끊김 등은 여기로
          _add(const ChatItem(ChatKind.notice, '네트워크 연결을 확인하고 다시 시도해 주세요.'));
          return false;
        }
        if (outcome.conversationId != null) _conversationId = outcome.conversationId;
        if (resend && turn == 0 && outcome.rejected) {
          _unsent = null; // 서버가 이미 받았거나 처리 중 — 다시 보낼 것 없음
          return true;
        }
        if (outcome.disabled) {
          ref.read(assistantAvailableProvider.notifier).disable();
          _add(const ChatItem(ChatKind.notice, '관리자가 비서를 꺼 두었습니다.'));
          return false;
        }
        if (outcome.error != null) {
          _add(ChatItem(ChatKind.notice, outcome.error!));
          return false;
        }
        if (sent != null) _unsent = null;
        final calls = outcome.needsAction;
        if (calls == null) return true;
        List<Map<String, dynamic>>? replies;
        try {
          replies = await _handle(calls, run);
        } on _Stopped {
          rethrow;
        } catch (_) {
          // 보이지 않는 대기 카드는 버린다 — 다음 입력 때 서버가 대기 호출을 "취소됨"으로 닫는다
          _pending = null;
          _add(const ChatItem(ChatKind.notice, '처리하지 못했습니다. 다시 시도해 주세요.'));
          return false;
        }
        if (replies == null || replies.isEmpty) return false; // 확인 카드 대기(빈 회신은 서버가 받지 않는다)
        body = {'actions': replies};
      }
      _add(const ChatItem(ChatKind.notice, '요청이 너무 복잡합니다. 나눠서 다시 말씀해 주세요.'));
      return false;
    } on _Stopped {
      return false;
    } finally {
      if (_active(run)) {
        _run = null;
        _set(busy: false, items: _settled(state.items));
      }
    }
  }

  /// 진행 표시를 걷고, 결과를 못 받은 도구 칩은 unknown(실행 여부 미확인)으로 멈춘다.
  static List<ChatItem> _settled(List<ChatItem> items) => [
    for (final i in items)
      if (i.kind == ChatKind.progress)
        ...[]
      else if (i.kind == ChatKind.tool && i.status == 'running')
        i.copyWith(status: 'unknown')
      else
        i,
  ];

  /// 스트림 대기 — _wait와 같지만 시간 상한은 assistantTurnTimeoutProvider(서버 도구 왕복·중계 때문에 길다).
  Future<T> _waitTurn<T>(_Run run, Future<T> future) async {
    try {
      final result = await Future.any<T>([future, run.stopped.future.then<T>((_) => throw _Stopped())]).timeout(
        ref.read(assistantTurnTimeoutProvider),
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

  /// needs_action 처리. 회신 목록을 돌려주면 서버로 이어 가고, null이면 확인 카드 대기.
  Future<List<Map<String, dynamic>>?> _handle(List<PendingCall> pcs, _Run run) async {
    _calls = {for (final p in pcs) p.id: p};
    final calls = [
      for (final p in pcs)
        if (!(p.onServer && tierOf(p.name) == ToolTier.read)) ToolCall(p.id, p.name, p.input), // 서버 읽기는 서버가 실행
    ];
    if (calls.isEmpty) return const [];
    final runner = await _runner(run);
    if (calls.any((c) => tierOf(c.name) == ToolTier.choice)) {
      if (calls.length == 1) return _offerChoices(calls.single, runner, run);
      return _replies([
        for (final c in calls)
          (c.id, {
            'ok': false,
            'error': 'offer_choices는 다른 도구 없이 단독으로 불러야 합니다. 아무것도 실행하지 않았습니다',
          }),
      ]);
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
        return _replies(_resultsFor(p, {
          for (final w in writes)
            w.id:
                rejected[w.id] ??
                {'ok': false, 'error': '함께 요청한 다른 작업을 확인하지 못해 실행하지 않았습니다'},
        }));
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
      return null;
    }
    return _replies([for (final c in calls) (c.id, results[c.id]!)]);
  }

  /// 선택지 — 선택지마다 쓰기 호출을 실제 대상으로 확인해 카드로 보인다. 쓰기가 아닌 호출·확인 안 되는 대상이 든 선택지는 뺀다.
  /// 남는 게 없으면 카드 없이 오류 결과로 이어간다(회신 목록). 실행은 사용자가 고른 선택지의 [실행](confirm(choice:))뿐.
  Future<List<Map<String, dynamic>>?> _offerChoices(
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
      return _replies([
        (c.id, {
          'ok': false,
          'error': '제시한 선택지를 하나도 확인하지 못했습니다',
          'details': notes,
        }),
      ]);
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
    return null;
  }

  /// 카드 닫기 — item이 없으면 마지막 카드(대기 해제 포함), 있으면 그 카드만(뒤에 새로 뜬 카드의 대기는 그대로).
  void _markCardDone(String text, {ChatItem? item}) {
    final items = [...state.items];
    final i = item == null ? items.lastIndexWhere((x) => x.kind == ChatKind.card) : items.indexWhere((x) => identical(x, item));
    if (i >= 0) items[i] = items[i].copyWith(done: true, text: text);
    _set(items: items, pending: item == null ? false : null);
  }

  List<(String, Map<String, dynamic>)> _resultsFor(
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
          (id, undoResult!)
        else
          (
            id,
            p.results[id] ??
                writeResults[id] ??
                {'ok': false, 'error': '실행되지 않았습니다'},
          ),
    ];
  }

  /// 확인 카드 실행 — 순서대로, 앞 작업이 실패하면 뒤 작업은 건너뛴다. 서버 쓰기는 여기서 실행하지 않고 승인(approve)으로 서버에 맡긴다.
  /// 선택지 카드면 choice(0부터)가 있어야 하고 그 선택지의 쓰기만 실행한다(선택지 안의 서버 도구는 앱이 /api/assistant/execute로).
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
    _approved.clear();
    _markCardDone(picked == null ? '실행 중…' : '실행 중… — ${picked.lines.first}');
    final card = state.items.lastWhere((x) => x.kind == ChatKind.card);
    _set(busy: true);
    final out = <String, Map<String, dynamic>>{};
    var failed = false;
    String? started; // 실행을 시작한 앱 쓰기(결과 전)
    List<Map<String, dynamic>> replies(Map<String, Map<String, dynamic>> res) => _replies(_resultsFor(
      p,
      picked == null
          ? res
          : {
              p.choiceId!: {
                'ok': writes.every((w) => res[w.id]?['ok'] == true),
                'chosen': picked.label,
                'results': [
                  for (final (j, w) in writes.indexed)
                    {'action': picked.lines[j], 'result': res[w.id] ?? {'ok': false, 'error': '실행되지 않았습니다'}},
                ],
              },
            },
    ));
    try {
      final runner = await _runner(run);
      for (final w in writes) {
        if (failed) {
          out[w.id] = {'ok': false, 'error': '앞 작업이 실패해 실행하지 않았습니다'};
          continue;
        }
        if (_calls[w.id]?.onServer == true) {
          _approved.add(w.id); // 결과는 회신 스트림의 tool 이벤트로 받는다
          continue;
        }
        _add(
          ChatItem(
            ChatKind.progress,
            '${cardLine(w).split(' · ').first} 하는 중…',
          ),
        );
        started = w.id;
        final r = await _wait(run, runner.run(w)); // 취소·삭제 성공은 러너가 실행 기록에서 지운다
        out[w.id] = r;
        if (r['ok'] != true) failed = true;
      }
    } on _Stopped {
      // 지금은 보내지 않고 다음 입력 전에 회신한다 — 끝난 앱 쓰기는 실제 결과, 서버 쓰기는 미승인(그냥 텍스트를 보내면 서버가 "취소됨"으로 닫는다)
      _approved.clear();
      _unsent = replies({
        for (final w in writes)
          w.id: out[w.id] ??
              (w.id == started
                  ? {'ok': false, 'error': '응답 대기를 중지했습니다. 이미 요청한 작업은 실행되었을 수 있습니다. 다시 실행하지 말고 실행 여부를 조회하세요.'}
                  : {'ok': false, 'error': '중지되어 실행하지 않았습니다'}),
      });
      return;
    } catch (_) {
      for (final w in writes) {
        if (!_approved.contains(w.id)) out.putIfAbsent(w.id, () => {'ok': false, 'error': '실행되지 않았습니다'});
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
    bool ok(ToolCall w) => _approved.contains(w.id) ? _toolStatus[w.id] == 'ok' : out[w.id]?['ok'] == true;
    String status() {
      // 승인한 서버 쓰기의 결과를 못 받았으면(스트림 끊김 등) 판정하지 않는다
      if (writes.any((w) => _approved.contains(w.id) && _toolStatus[w.id] == null)) return '실행 여부를 확인해 주세요';
      final okCount = writes.where(ok).length;
      final s = okCount == writes.length
          ? '실행했습니다'
          : ok(writes.first)
          ? '일부만 실행했습니다'
          : '실행하지 못했습니다';
      return picked == null ? s : '$s — ${picked.lines.first}';
    }
    final onServer = writes.any((w) => _approved.contains(w.id));
    if (!onServer) _markCardDone(status(), item: card); // 결과를 이미 안다
    await _drive({'actions': replies(out)});
    // 서버 쓰기는 회신 스트림의 결과로 — 중지됐으면 stop()이 이미 "실행 여부를 확인해 주세요"로 바꿨다
    if (onServer && state.items.any((x) => identical(x, card))) _markCardDone(status(), item: card);
  }

  /// 그만두기 — 앱 쓰기에 "사용자가 취소" 결과, 서버 쓰기는 미승인으로 회신해 이어간다.
  /// silent면 회신하지 않고 카드만 닫는다(다음 입력 때 서버가 대기 호출을 "취소됨"으로 닫는다).
  Future<void> dismiss({bool silent = false}) async {
    final p = _pending;
    if (p == null || state.busy) return;
    _pending = null;
    _markCardDone('그만두었습니다');
    if (silent) return;
    _approved.clear();
    await _drive({'actions': _replies(_resultsFor(p, {
      for (final w in p.writes) w.id: {'ok': false, 'error': '사용자가 취소함'},
      if (p.choiceId != null) p.choiceId!: {'ok': false, 'error': '사용자가 취소함'},
    }))});
  }

  /// 고쳐 줘 — 실행하지 않고 카드를 닫는다. 다음 입력이 그대로 가고, 서버가 대기 호출을 "취소됨"으로 닫는다.
  void fix() {
    if (_pending == null || state.busy) return;
    _pending = null;
    _markCardDone('고칠 내용을 말씀해 주세요');
    _set(awaitingFix: true);
  }
}
