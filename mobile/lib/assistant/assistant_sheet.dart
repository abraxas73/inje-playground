import 'dart:async';
// mobile/lib/assistant/assistant_sheet.dart
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../api/client.dart';
import '../app/theme.dart';
import 'assistant_session.dart';
import 'assistant_window.dart';
import 'assistant_voice.dart';
import 'chat_api.dart';
import 'conversation_list_sheet.dart';

/// [seed]가 있으면 시트가 열리자마자 그 문장을 보낸다(예: 일정 화면 "추가" → "… 아마란스 일정 등록해줘"). 말풍선으로 남아 "고쳐 줘"로 바로잡을 수 있다.
/// 데스크톱(macOS·Windows)은 끌어서 옮길 수 있는 떠 있는 창(assistant_window.dart), 휴대폰은 아래 시트.
Future<void> showAssistantSheet(BuildContext context, {String? seed}) => assistantUsesWindow
    ? showAssistantWindow(seed: seed)
    : showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Brand.ground,
      builder: (_) => FractionallySizedBox(
        heightFactor: 0.9,
        child: AssistantSheet(seed: seed),
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

/// 읽어 주기용 글 — 이노봇 답(마크다운)에서 기호를 뺀다. 표는 칸을 쉼표로 잇고 구분 줄은 버린다.
String speakableText(String md) => md
    .split('\n')
    .where((l) => !RegExp(r'^\s*\|?\s*:?-{2,}').hasMatch(l))
    .map((l) {
      var t = l.replaceAll(RegExp(r'^\s*#{1,6}\s+'), '').replaceAll(RegExp(r'^\s*[-*+]\s+'), '');
      if (t.trim().startsWith('|')) t = t.trim().replaceAll(RegExp(r'^\||\|$'), '').split('|').map((c) => c.trim()).join(', ');
      return t.replaceAllMapped(RegExp(r'\[([^\]]+)\]\([^)]*\)'), (m) => m[1]!).replaceAll(RegExp(r'\*\*|__|`'), '');
    })
    .join('\n');

/// 비서 대화 시트 — 말풍선·진행 표시·확인 카드·입력창. 상태는 assistantSessionProvider(앱이 켜져 있는 동안 유지).
class AssistantSheet extends ConsumerStatefulWidget {
  const AssistantSheet({super.key, this.seed});
  /// 열리자마자 보낼 첫 문장(showAssistantSheet 참고).
  final String? seed;
  @override
  ConsumerState<AssistantSheet> createState() => _AssistantSheetState();
}

/// 입력창에 올려 둔 첨부 하나 — id가 생기면 올리기 완료, error면 거절(빼기 전까지 칩으로 남는다).
class _Upload {
  _Upload(this.name);
  String name;
  String? id, error, warning;
}

class _AssistantSheetState extends ConsumerState<AssistantSheet> {
  final _files = <_Upload>[];
  String? _fileNote;
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
    final seed = widget.seed?.trim();
    if (seed != null && seed.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _send(seed);
      });
    }
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
    final ready = [for (final u in _files) if (u.id != null) (id: u.id!, name: u.name)];
    if ((t.isEmpty && ready.isEmpty) || ref.read(assistantSessionProvider).busy) return;
    if (_files.any((u) => u.id == null && u.error == null)) return; // 올리는 중
    _input.clear();
    setState(() {
      _files.clear();
      _fileNote = null;
    });
    await ref.read(assistantSessionProvider.notifier).send(t, files: ready);
  }

  /// 파일 고르기 → 하나씩 바로 올린다(웹 /chat과 같은 상한: 5개·10MB).
  Future<void> _pick() async {
    final picked = await ref.read(attachmentPickerProvider)();
    if (!mounted || picked.isEmpty) return;
    final room = (attachMaxFiles - _files.length).clamp(0, attachMaxFiles);
    setState(() => _fileNote = picked.length > room ? '첨부는 $attachMaxFiles개까지입니다.' : null);
    for (final f in picked.take(room)) {
      final u = _Upload(f.name);
      setState(() => _files.add(u));
      if (f.size > attachMaxBytes) {
        setState(() => u.error = '파일은 10MB까지 첨부할 수 있습니다.');
        continue;
      }
      try {
        final r = await ref.read(chatApiProvider).upload(f.name, await f.read());
        u
          ..id = r.id
          ..name = r.name
          ..warning = r.warning;
      } catch (e) {
        u.error = e is ApiException ? e.message : '올리지 못했습니다.';
      }
      if (mounted) setState(() {});
    }
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
                Text(
                  '이노봇',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: Brand.navy,
                  ),
                ),
                const Spacer(),
                if (ref.watch(chatConfigProvider).value case final cfg? when cfg.models.length > 1)
                  PopupMenuButton<String>(
                    tooltip: '모델 고르기',
                    enabled: !st.busy,
                    initialValue: ref.watch(assistantModelProvider) ?? cfg.defaultModel,
                    onSelected: ref.read(assistantModelProvider.notifier).pick,
                    itemBuilder: (_) => [for (final m in cfg.models) PopupMenuItem(value: m, child: Text(modelLabel(m)))],
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(modelLabel(ref.watch(assistantModelProvider) ?? cfg.defaultModel), style: TextStyle(fontSize: 13, color: Brand.muted)),
                          Icon(Icons.arrow_drop_down, size: 18, color: Brand.muted),
                        ],
                      ),
                    ),
                  ),
                IconButton(
                  tooltip: '대화 기록',
                  icon: const Icon(Icons.history),
                  onPressed: st.busy
                      ? null
                      : () async {
                          final id = await showConversationList(context);
                          if (id != null) {
                            _stopSpeaking();
                            await s.open(id);
                          }
                        },
                ),
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
                    onSpeak: () => _toggleSpeak(i, speakableText(it.text)),
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
                color: Brand.surface,
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
                      style: TextStyle(
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
          if (_files.isNotEmpty || _fileNote != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    children: [
                      for (final u in _files)
                        InputChip(
                          avatar: u.id == null && u.error == null
                              ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                              : Icon(u.error == null ? Icons.attach_file : Icons.error_outline, size: 16, color: u.error == null ? Brand.muted : Brand.danger),
                          label: Text(u.error == null ? u.name : '${u.name} — ${u.error}', style: TextStyle(fontSize: 12.5, color: u.error == null ? Brand.navy : Brand.dangerText)),
                          deleteButtonTooltipMessage: '${u.name} 빼기',
                          onDeleted: () => setState(() {
                            _files.remove(u);
                            _fileNote = null;
                          }),
                          visualDensity: VisualDensity.compact,
                        ),
                    ],
                  ),
                  if (_fileNote != null) Text(_fileNote!, style: TextStyle(fontSize: 12, color: Brand.muted)),
                  if (_files.any((u) => u.warning != null))
                    const Text('이미지·스캔 문서 안의 개인정보는 가려지지 않습니다.', style: TextStyle(fontSize: 12, color: Brand.cardBadgeFg)),
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
                  IconButton(
                    tooltip: '파일 첨부',
                    icon: Icon(Icons.attach_file, color: Brand.muted),
                    onPressed: st.busy || _files.length >= attachMaxFiles ? null : _pick,
                  ),
                  Expanded(
                    child: TextField(
                      controller: _input,
                      // 답을 기다리는 동안에도 비활성화하지 않는다(비활성화하면 포커스를 잃는다) — 보내기는 _send가 busy로 막는다
                      minLines: 1,
                      maxLines: 4,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _send(),
                      onEditingComplete: () {}, // 보낸 뒤에도 입력창에 포커스 유지(이어서 입력) — 기본 동작은 포커스를 놓는다
                      decoration: InputDecoration(
                        hintText: _listening
                            ? '듣고 있어요…'
                            : st.awaitingFix
                            ? '어떻게 고칠까요?'
                            : '이노봇에게 부탁하기',
                        isDense: true,
                        filled: true,
                        fillColor: Brand.surface,
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
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              for (final f in it.lines)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.attach_file, size: 14, color: Brand.muted),
                      Flexible(child: Text(f, style: TextStyle(fontSize: 13, color: Brand.muted), overflow: TextOverflow.ellipsis)),
                    ],
                  ),
                ),
              if (it.text.isNotEmpty) _box(it.text, Brand.navy, Brand.surface),
            ],
          ),
        );
      case ChatKind.bot:
        return Align(
          alignment: Alignment.centerLeft,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Flexible(child: _markdown(context, it.text)),
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
                style: TextStyle(fontSize: 13, color: Brand.muted),
              ),
            ],
          ),
        );
      case ChatKind.tool:
        final (icon, color) = switch (it.status) {
          'ok' => (Icons.check_circle, Brand.success),
          'running' => (null, Brand.muted),
          'unknown' => (Icons.help_outline, Brand.muted),
          _ => (Icons.error_outline, Brand.danger),
        };
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 3),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(color: Brand.surface, borderRadius: BorderRadius.circular(14), border: Border.all(color: Brand.line)),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (icon == null)
                  const SizedBox(width: 13, height: 13, child: CircularProgressIndicator(strokeWidth: 2))
                else
                  Icon(icon, size: 15, color: color),
                const SizedBox(width: 6),
                Flexible(
                  child: Text(
                    it.status == 'unknown' ? '${it.text} · 결과를 받지 못했습니다' : it.text,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 12.5, color: Brand.muted),
                  ),
                ),
              ],
            ),
          ),
        );
      case ChatKind.masked:
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.shield_outlined, size: 14, color: Brand.muted),
              const SizedBox(width: 4),
              Text(it.text, style: TextStyle(fontSize: 12, color: Brand.muted)),
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
                style: TextStyle(
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
                                style: TextStyle(
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
                  style: TextStyle(
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

  /// 이노봇 답 — 웹 /chat과 같은 마크다운(표는 가로로 밀어 본다, 링크는 바깥 브라우저).
  Widget _markdown(BuildContext context, String t) {
    final base = Theme.of(context).textTheme.bodyMedium!.copyWith(color: Brand.navy, fontSize: 15, height: 1.5);
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 4),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.8),
      decoration: BoxDecoration(color: Brand.surface, borderRadius: BorderRadius.circular(16)),
      child: MarkdownBody(
        data: t, // 글자 선택은 바깥 CopySelectionArea가 맡는다(selectable을 켜면 따로 놀고 기본 메뉴가 뜬다)
        softLineBreak: true, // 한 줄 바꿈도 줄을 바꾼다(앱의 기존 말풍선과 같게)
        styleSheet: MarkdownStyleSheet(
          p: base,
          listBullet: base,
          strong: const TextStyle(fontWeight: FontWeight.w700),
          h1: base.copyWith(fontSize: 17, fontWeight: FontWeight.w700),
          h2: base.copyWith(fontSize: 16, fontWeight: FontWeight.w700),
          h3: base.copyWith(fontWeight: FontWeight.w700),
          code: base.copyWith(fontFamily: 'monospace', fontSize: 13, backgroundColor: Brand.ground),
          codeblockDecoration: BoxDecoration(color: Brand.ground, borderRadius: BorderRadius.circular(8)),
          tableHead: base.copyWith(fontSize: 13, fontWeight: FontWeight.w700),
          tableBody: base.copyWith(fontSize: 13),
          tableBorder: TableBorder.all(color: Brand.line),
          tableColumnWidth: const IntrinsicColumnWidth(),
          tableCellsPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          a: base.copyWith(color: Brand.blue, decoration: TextDecoration.underline),
        ),
        // 이미지는 불러오지 않는다 — 메일·문서에 심은 지시로 모델이 ![](https://외부?q=대화내용)을 쓰면 그리기만 해도 외부로 샌다
        imageBuilder: (_, _, alt) => Text('[이미지${alt == null || alt.isEmpty ? '' : ': $alt'}]', style: base.copyWith(color: Brand.muted)),
        onTapLink: (_, href, _) {
          final u = href == null ? null : Uri.tryParse(href);
          if (u != null && (u.scheme == 'https' || u.scheme == 'http')) launchUrl(u, mode: LaunchMode.externalApplication);
        },
      ),
    );
  }

  Widget _box(String t, Color bg, Color fg) => Container(
    margin: const EdgeInsets.symmetric(vertical: 4),
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
    constraints: const BoxConstraints(maxWidth: 300),
    decoration: BoxDecoration(
      color: bg,
      borderRadius: BorderRadius.circular(16),
    ),
    child: Text(
      t,
      style: TextStyle(color: fg, fontSize: 15, height: 1.5),
    ),
  );
}
