// mobile/lib/assistant/assistant_sheet.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../app/theme.dart';
import 'assistant_session.dart';

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

const _examples = ['오늘 오후 빈 회의실 1시간 잡아줘', '안 읽은 메일 요약해줘', '오늘 내 일정 알려줘'];

/// 비서 대화 시트 — 말풍선·진행 표시·확인 카드·입력창. 상태는 assistantSessionProvider(앱이 켜져 있는 동안 유지).
class AssistantSheet extends ConsumerStatefulWidget {
  const AssistantSheet({super.key});
  @override
  ConsumerState<AssistantSheet> createState() => _AssistantSheetState();
}

class _AssistantSheetState extends ConsumerState<AssistantSheet> {
  final _input = TextEditingController();
  final _scroll = ScrollController();

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _send([String? text]) async {
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
                  onPressed: st.busy ? null : s.reset,
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              controller: _scroll,
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
              children: [
                for (final it in st.items)
                  _Bubble(
                    it,
                    pending: st.pending && it.kind == ChatKind.card && !it.done,
                    onRun: s.confirm,
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
                        hintText: st.awaitingFix ? '어떻게 고칠까요?' : '이노봇에게 부탁하기',
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
                    tooltip: '보내기',
                    icon: const Icon(Icons.send, color: Brand.blue),
                    onPressed: st.busy ? null : _send,
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
    required this.onRun,
    required this.onFix,
    required this.onDismiss,
  });
  final ChatItem it;
  final bool pending;
  final VoidCallback onRun, onFix, onDismiss;
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
          child: _box(it.text, Colors.white, Brand.navy),
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
                      FilledButton(onPressed: onRun, child: const Text('실행')),
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
