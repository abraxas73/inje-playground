import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../app/theme.dart';
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
  late final Future<List<ConversationSummary>> _items = ref.read(chatApiProvider).list();

  String _when(String iso) {
    final d = DateTime.tryParse(iso)?.toUtc().add(const Duration(hours: 9));
    if (d == null) return '';
    String two(int v) => v.toString().padLeft(2, '0');
    return '${d.month}/${d.day} ${two(d.hour)}:${two(d.minute)}';
  }

  @override
  Widget build(BuildContext context) => Column(
    children: [
      const Padding(padding: EdgeInsets.fromLTRB(16, 16, 16, 8), child: Align(alignment: Alignment.centerLeft, child: Text('대화 기록', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Brand.navy)))),
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
                ListTile(title: Text(c.title.isEmpty ? '새 대화' : c.title, maxLines: 1, overflow: TextOverflow.ellipsis), subtitle: Text(_when(c.lastMessageAt)), onTap: () => Navigator.of(context).pop(c.id)),
            ]);
          },
        ),
      ),
    ],
  );
}
