import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/client.dart';
import '../app/theme.dart';
import 'assistant_session.dart';
import 'chat_api.dart';

/// 🕘 대화 기록 — 서버에 저장된 내 대화(웹 /chat과 같은 목록). 고른 대화 id를 돌려준다.
Future<String?> showConversationList(BuildContext context) => showModalBottomSheet<String>(
  context: context,
  isScrollControlled: true,
  backgroundColor: Brand.ground,
  builder: (_) => const FractionallySizedBox(heightFactor: 0.7, child: _ConversationList()),
);

class _ConversationList extends ConsumerStatefulWidget {
  const _ConversationList();
  @override
  ConsumerState<_ConversationList> createState() => _ConversationListState();
}

class _ConversationListState extends ConsumerState<_ConversationList> {
  late Future<List<ConversationSummary>> _items = ref.read(chatApiProvider).list();

  void _reload() => setState(() {
    _items = ref.read(chatApiProvider).list();
  });

  void _fail(Object e, String fallback) {
    if (mounted) ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : fallback)));
  }

  Future<void> _rename(ConversationSummary c) async {
    final input = TextEditingController(text: c.title); // 닫히는 애니메이션이 아직 쓰므로 해제하지 않는다(리스너 없음 — GC)
    final title = await showDialog<String>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('이름 바꾸기'),
        content: TextField(controller: input, autofocus: true, maxLength: 80, onSubmitted: (v) => Navigator.of(d).pop(v)),
        actions: [
          TextButton(onPressed: () => Navigator.of(d).pop(), child: const Text('취소')),
          FilledButton(onPressed: () => Navigator.of(d).pop(input.text), child: const Text('저장')),
        ],
      ),
    );
    final t = title?.trim() ?? '';
    if (t.isEmpty || t == c.title) return;
    try {
      await ref.read(chatApiProvider).rename(c.id, t);
      _reload();
    } catch (e) {
      _fail(e, '이름을 바꾸지 못했습니다.');
    }
  }

  Future<void> _delete(ConversationSummary c) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('대화 삭제'),
        content: Text('"${c.title.isEmpty ? '새 대화' : c.title}" 대화를 지웁니다. 되돌릴 수 없습니다.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(d).pop(false), child: const Text('취소')),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: Brand.danger), onPressed: () => Navigator.of(d).pop(true), child: const Text('삭제')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(chatApiProvider).delete(c.id);
      ref.read(assistantSessionProvider.notifier).forget(c.id);
      _reload();
    } catch (e) {
      _fail(e, '삭제하지 못했습니다.');
    }
  }

  String _when(String iso) {
    final d = DateTime.tryParse(iso)?.toUtc().add(const Duration(hours: 9));
    if (d == null) return '';
    String two(int v) => v.toString().padLeft(2, '0');
    return '${d.month}/${d.day} ${two(d.hour)}:${two(d.minute)}';
  }

  @override
  Widget build(BuildContext context) => Column(
    children: [
      Padding(padding: EdgeInsets.fromLTRB(16, 16, 16, 8), child: Align(alignment: Alignment.centerLeft, child: Text('대화 기록', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Brand.navy)))),
      Expanded(
        child: FutureBuilder<List<ConversationSummary>>(
          future: _items,
          builder: (context, s) {
            if (s.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
            if (s.hasError) return const Center(child: Text('대화 기록을 불러오지 못했습니다.'));
            final items = s.data ?? const [];
            if (items.isEmpty) return const Center(child: Text('저장된 대화가 없습니다.'));
            return ListView(children: [
              for (final c in items)
                ListTile(
                  title: Text(c.title.isEmpty ? '새 대화' : c.title, maxLines: 1, overflow: TextOverflow.ellipsis),
                  subtitle: Text(_when(c.lastMessageAt)),
                  onTap: () => Navigator.of(context).pop(c.id),
                  trailing: PopupMenuButton<String>(
                    tooltip: '대화 메뉴',
                    onSelected: (v) => v == 'rename' ? _rename(c) : _delete(c),
                    itemBuilder: (_) => const [
                      PopupMenuItem(value: 'rename', child: Text('이름 바꾸기')),
                      PopupMenuItem(value: 'delete', child: Text('삭제', style: TextStyle(color: Brand.dangerText))),
                    ],
                  ),
                ),
            ]);
          },
        ),
      ),
    ],
  );
}
