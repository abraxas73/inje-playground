import 'dart:async';
// mobile/lib/assistant/assistant_sheet.dart
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../app/theme.dart';
import 'assistant_session.dart';
import 'assistant_voice.dart';

Future<void> showAssistantSheet(BuildContext context) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Brand.ground,
      builder: (_) => FractionallySizedBox(
        heightFactor: 0.9,
        child: const AssistantSheet(),
      ),
    );

/// 고품질 음성 설치 안내는 앱 실행당 한 번.
class _VoiceTipSeen extends Notifier<bool> {
  @override
  bool build() => false;
  void seen() => state = true;
}

final _voiceTipSeenProvider = NotifierProvider<_VoiceTipSeen, bool>(
  _VoiceTipSeen.new,
);

String _voiceTip() => defaultTargetPlatform == TargetPlatform.iOS
    ? '더 자연스러운 목소리로 들으려면 설정 > 손쉬운 사용 > 읽기 및 말하기 > 음성 > 한국어에서 "유나(향상됨)" 또는 "유나(프리미엄)"를 내려받으세요. 내려받으면 바로 그 음성으로 읽습니다.'
    : '더 자연스러운 목소리로 들으려면 설정에서 "텍스트 음성 변환"을 찾아 기본 엔진을 Google로 두고, 엔진 설정 > 음성 데이터 설치 > 한국어에서 고품질 음성을 내려받으세요.';

const _examples = [
  '오늘 오후 빈 회의실 1시간 잡아줘',
  '오늘 오후 빈 회의실 1시간 잡고, 그에 맞는 일정을 등록해줘, 회의명은 내부회의, 참석자는 우리팀 전원. 캘린더는 이노그리드로 해줘',
  '안 읽은 메일 요약해줘',
  '오늘 내 일정 알려줘',
  'Confluence에서 보안 점검 가이드 찾아서 요약해줘',
  '오늘 오후 회의 회의록 Confluence에 만들어줘',
  'SharePoint에서 최근 제안서 찾아서 요약해줘',
];

/// 비서 대화 시트 — 말풍선·진행 표시·확인 카드·입력창. 상태는 assistantSessionProvider(앱이 켜져 있는 동안 유지).
class AssistantSheet extends ConsumerStatefulWidget {
  const AssistantSheet({super.key});
  @override
  ConsumerState<AssistantSheet> createState() => _AssistantSheetState();
}

class _AssistantSheetState extends ConsumerState<AssistantSheet> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  late final VoiceInput _voice = ref.read(voiceInputProvider);
  late final Speaker _speaker = ref.read(speakerProvider);
  bool _listening = false;
  int _listenSeq = 0; // 듣기 회차 — 멈춘 뒤 늦게 오는 인식 결과를 버린다
  String _heard = ''; // 이번 말하기에서 확정된 앞부분(이어 들은 것을 붙인다)
  Timer? _grace; // 명령 어미 없이 끝났을 때 보내기 전 기다림
  static const _graceDelay = Duration(seconds: 2);
  int? _speaking; // 읽는 중인 말풍선(items 인덱스)
  String? _voiceNote;
  bool _showVoiceTip = false;

  @override
  void initState() {
    super.initState();
    _voice;
    _speaker;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _scroll.hasClients) {
        _scroll.jumpTo(_scroll.position.maxScrollExtent);
      }
    });
  }

  @override
  void dispose() {
    _grace?.cancel();
    if (_listening) _voice.stop();
    if (_speaking != null) _speaker.stop();
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  /// 말하기 — 듣는 동안 입력칸에 문장을 채우고, 인식이 끝나면 그대로 보낸다(보낸 문장은 말풍선으로 남아 "고쳐 줘"로 바로잡을 수 있다).
  Future<void> _stopListening() async {
    _grace?.cancel();
    _listenSeq++;
    setState(() => _listening = false);
    await _voice.stop();
  }

  /// 말하기 — 듣는 동안 입력칸에 문장을 채운다. 인식이 끝났을 때 명시적 명령 어미(~줘·~주세요·~실행)면 바로 보내고,
  /// 아니면 이어서 듣다가 2초 동안 새 말이 없으면 보낸다(그 사이 말하면 붙이고 다시 판단).
  Future<void> _toggleListen() async {
    if (_listening) return _stopListening();
    await _stopSpeaking(); // 읽어 주는 소리를 인식하지 않게
    _heard = '';
    setState(() {
      _listening = true;
      _voiceNote = null;
    });
    if (!await _listenOnce() && mounted) {
      setState(() {
        _listening = false;
        _voiceNote = '마이크·음성 인식 권한이 필요합니다. 휴대폰 설정에서 허용해 주세요.';
      });
    }
  }

  Future<bool> _listenOnce() {
    final seq = ++_listenSeq;
    return _voice.start(
      (text, done) {
        if (!mounted || seq != _listenSeq) return;
        _grace?.cancel(); // 다시 말하기 시작 — 보내기 미룸
        final full = [_heard, text.trim()].where((x) => x.isNotEmpty).join(' ');
        _input.text = full;
        if (!done) return;
        _heard = full;
        if (isCommandEnd(full)) return _finishListening();
        _grace = Timer(_graceDelay, () {
          if (mounted && _listening) _finishListening();
        });
        _listenOnce(); // 이어서 듣기(실패해도 타이머가 보낸다)
      },
      () {
        if (!mounted || seq != _listenSeq || !_listening) return;
        if (_grace?.isActive ?? false) return; // 기다리는 중의 무음 종료는 타이머가 처리
        final heard = _input.text.trim();
        if (heard.isEmpty) return setState(() => _listening = false);
        if (isCommandEnd(heard)) return _finishListening();
        // 종료가 최종 결과보다 먼저 올 수 있다 — 부분 문장을 바로 보내지 않고 2초 기다린다(그 사이 온 최종 결과가 이 타이머를 대신한다).
        _grace = Timer(_graceDelay, () {
          if (mounted && _listening) _finishListening();
        });
      },
    );
  }

  void _finishListening() {
    _grace?.cancel();
    _listenSeq++;
    setState(() => _listening = false);
    _voice.stop();
    _send();
  }

  /// 읽어 주기 — 누를 때만 읽는다(자동 읽기 없음). 같은 말풍선을 다시 누르면 멈춘다.
  Future<void> _stopSpeaking() async {
    if (_speaking == null) return;
    setState(() => _speaking = null);
    await _speaker.stop();
  }

  Future<void> _toggleSpeak(int i, String text) async {
    if (_speaking == i) return _stopSpeaking();
    await _stopSpeaking();
    setState(() => _speaking = i);
    await _speaker.prepare();
    if (mounted &&
        _speaker.usingBasicVoice &&
        !ref.read(_voiceTipSeenProvider)) {
      ref.read(_voiceTipSeenProvider.notifier).seen();
      setState(() => _showVoiceTip = true);
    }
    try {
      await _speaker.speak(text);
    } finally {
      if (mounted && _speaking == i) setState(() => _speaking = null);
    }
  }

  Future<void> _send([String? text]) async {
    if (_listening) await _stopListening();
    final t = (text ?? _input.text).trim();
    if (t.isEmpty) return;
    _input.clear();
    await ref.read(assistantSessionProvider.notifier).send(t);
  }

  @override
  Widget build(BuildContext context) {
    final st = ref.watch(assistantSessionProvider);
    final s = ref.read(assistantSessionProvider.notifier);
    ref.listen(
      assistantSessionProvider,
      (_, _) => WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) {
          _scroll.animateTo(
            _scroll.position.maxScrollExtent,
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
          );
        }
      }),
    );
    final onlyGreeting = st.items.length == 1;
    return Material(
      color: Brand.ground,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 8, 4),
            child: Row(
              children: [
                Image.asset('assets/brand/innobot.png', width: 32, height: 32),
                const SizedBox(width: 8),
                const Text(
                  '이노봇',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: Brand.navy,
                  ),
                ),
                const Spacer(),
                IconButton(
                  tooltip: '새 대화',
                  icon: const Icon(Icons.refresh),
                  onPressed: st.busy
                      ? null
                      : () {
                          _stopSpeaking();
                          s.reset();
                        },
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              controller: _scroll,
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
              children: [
                for (final (i, it) in st.items.indexed)
                  _Bubble(
                    it,
                    pending:
                        st.pending &&
                        !st.busy &&
                        it.kind == ChatKind.card &&
                        !it.done,
                    speaking: _speaking == i,
                    onSpeak: () => _toggleSpeak(i, it.text),
                    onRun: (choice) => s.confirm(choice: choice),
                    onFix: s.fix,
                    onDismiss: s.dismiss,
                  ),
                if (onlyGreeting)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final e in _examples)
                          ActionChip(
                            label: Text(e),
                            onPressed: st.busy ? null : () => _send(e),
                          ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          if (_showVoiceTip)
            Container(
              margin: const EdgeInsets.fromLTRB(12, 0, 12, 6),
              padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding: EdgeInsets.only(top: 2, right: 8),
                    child: Icon(
                      Icons.record_voice_over_outlined,
                      size: 18,
                      color: Brand.blue,
                    ),
                  ),
                  Expanded(
                    child: Text(
                      _voiceTip(),
                      style: const TextStyle(
                        fontSize: 13,
                        height: 1.45,
                        color: Brand.navy,
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: '안내 닫기',
                    icon: const Icon(Icons.close, size: 18),
                    onPressed: () => setState(() => _showVoiceTip = false),
                  ),
                ],
              ),
            ),
          if (_voiceNote != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
              child: Text(
                _voiceNote!,
                style: const TextStyle(fontSize: 13, color: Brand.dangerText),
              ),
            ),
          SafeArea(
            top: false,
            child: Padding(
              padding: EdgeInsets.fromLTRB(
                12,
                6,
                8,
                8 + MediaQuery.of(context).viewInsets.bottom,
              ),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _input,
                      enabled: !st.busy,
                      minLines: 1,
                      maxLines: 4,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _send(),
                      decoration: InputDecoration(
                        hintText: _listening
                            ? '듣고 있어요…'
                            : st.awaitingFix
                            ? '어떻게 고칠까요?'
                            : '이노봇에게 부탁하기',
                        isDense: true,
                        filled: true,
                        fillColor: Colors.white,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(20),
                          borderSide: BorderSide.none,
                        ),
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: _listening ? '듣기 멈추기' : '말하기',
                    icon: Icon(
                      _listening ? Icons.stop_circle : Icons.mic,
                      color: _listening ? Brand.danger : Brand.blue,
                    ),
                    // 대기 카드가 있으면 끔 — 잘못 들은 말이 카드를 조용히 그만두게 하지 않도록
                    onPressed: st.busy || (st.pending && !_listening)
                        ? null
                        : _toggleListen,
                  ),
                  IconButton(
                    tooltip: st.busy ? '응답 중지' : '보내기',
                    icon: Icon(
                      st.busy ? Icons.stop_circle_outlined : Icons.send,
                      color: Brand.blue,
                    ),
                    onPressed: st.busy ? s.stop : _send,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble(
    this.it, {
    required this.pending,
    required this.speaking,
    required this.onSpeak,
    required this.onRun,
    required this.onFix,
    required this.onDismiss,
  });
  final ChatItem it;
  final bool pending, speaking;
  final VoidCallback onSpeak, onFix, onDismiss;
  final void Function(int? choice) onRun;
  @override
  Widget build(BuildContext context) {
    switch (it.kind) {
      case ChatKind.user:
        return Align(
          alignment: Alignment.centerRight,
          child: _box(it.text, Brand.navy, Colors.white),
        );
      case ChatKind.bot:
        return Align(
          alignment: Alignment.centerLeft,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Flexible(child: _box(it.text, Colors.white, Brand.navy)),
              IconButton(
                tooltip: speaking ? '그만 읽기' : '읽어 주기',
                icon: Icon(
                  speaking
                      ? Icons.stop_circle_outlined
                      : Icons.volume_up_outlined,
                  size: 20,
                  color: Brand.muted,
                ),
                onPressed: onSpeak,
              ),
            ],
          ),
        );
      case ChatKind.progress:
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(
            children: [
              const SizedBox(
                width: 14,
                height: 14,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              const SizedBox(width: 8),
              Text(
                it.text,
                style: const TextStyle(fontSize: 13, color: Brand.muted),
              ),
            ],
          ),
        );
      case ChatKind.notice:
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Text(
            it.text,
            style: const TextStyle(fontSize: 13, color: Brand.dangerText),
          ),
        );
      case ChatKind.card when it.choices.isNotEmpty:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 6, bottom: 2),
              child: Text(
                it.text,
                style: const TextStyle(
                  fontWeight: FontWeight.w700,
                  color: Brand.navy,
                ),
              ),
            ),
            for (final (i, c) in it.choices.indexed)
              Card(
                margin: const EdgeInsets.symmetric(vertical: 4),
                shape: c.irreversible
                    ? RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                        side: const BorderSide(color: Brand.danger, width: 1.5),
                      )
                    : null,
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            for (final l in c.lines)
                              Padding(
                                padding: const EdgeInsets.only(top: 4),
                                child: Text(
                                  '• $l',
                                  style: const TextStyle(
                                    fontSize: 13,
                                    height: 1.4,
                                  ),
                                ),
                              ),
                            Padding(
                              padding: const EdgeInsets.only(top: 4),
                              child: Text(
                                c.label,
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: Brand.muted,
                                ),
                              ),
                            ),
                            if (c.irreversible)
                              const Padding(
                                padding: EdgeInsets.only(top: 4),
                                child: Text(
                                  '보내면 되돌릴 수 없습니다',
                                  style: TextStyle(
                                    color: Brand.dangerText,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                      if (pending) ...[
                        const SizedBox(width: 8),
                        FilledButton(
                          onPressed: () => onRun(i),
                          child: const Text('실행'),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            if (pending)
              Wrap(
                spacing: 8,
                children: [
                  OutlinedButton(onPressed: onFix, child: const Text('고쳐 줘')),
                  TextButton(onPressed: onDismiss, child: const Text('그만두기')),
                ],
              ),
          ],
        );
      case ChatKind.card:
        return Card(
          margin: const EdgeInsets.symmetric(vertical: 6),
          shape: it.irreversible
              ? RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                  side: const BorderSide(color: Brand.danger, width: 1.5),
                )
              : null,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  it.done ? it.text : '실행할까요?',
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    color: Brand.navy,
                  ),
                ),
                const SizedBox(height: 8),
                for (final l in it.lines)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: Text(
                      '• $l',
                      style: const TextStyle(fontSize: 14, height: 1.45),
                    ),
                  ),
                if (it.irreversible)
                  const Padding(
                    padding: EdgeInsets.only(top: 2, bottom: 6),
                    child: Text(
                      '보내면 되돌릴 수 없습니다',
                      style: TextStyle(
                        color: Brand.dangerText,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                if (pending)
                  Wrap(
                    spacing: 8,
                    children: [
                      FilledButton(
                        onPressed: () => onRun(null),
                        child: const Text('실행'),
                      ),
                      OutlinedButton(
                        onPressed: onFix,
                        child: const Text('고쳐 줘'),
                      ),
                      TextButton(
                        onPressed: onDismiss,
                        child: const Text('그만두기'),
                      ),
                    ],
                  ),
              ],
            ),
          ),
        );
    }
  }

  Widget _box(String t, Color bg, Color fg) => Container(
    margin: const EdgeInsets.symmetric(vertical: 4),
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
    constraints: const BoxConstraints(maxWidth: 300),
    decoration: BoxDecoration(
      color: bg,
      borderRadius: BorderRadius.circular(16),
    ),
    child: SelectableText(
      t,
      style: TextStyle(color: fg, fontSize: 15, height: 1.5),
    ),
  );
}
