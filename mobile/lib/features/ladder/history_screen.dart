import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'ladder_screen.dart' show resultColor;
import 'repository.dart';

String fmtDate(DateTime d) {
  final l = d.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${l.year}.${two(l.month)}.${two(l.day)} ${two(l.hour)}:${two(l.minute)}';
}

class LadderHistoryScreen extends ConsumerStatefulWidget {
  const LadderHistoryScreen({super.key});
  @override
  ConsumerState<LadderHistoryScreen> createState() => _LadderHistoryScreenState();
}

class _LadderHistoryScreenState extends ConsumerState<LadderHistoryScreen> {
  late Future<List<LadderSession>> _future = ref.read(ladderRepositoryProvider).list();
  Future<void> _refresh() async {
    setState(() => _future = ref.read(ladderRepositoryProvider).list());
    await _future;
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('사다리 이력')),
        body: RefreshIndicator(
          onRefresh: _refresh,
          child: FutureBuilder(
            future: _future,
            builder: (context, snap) {
              if (snap.hasError) return ListView(children: [Padding(padding: const EdgeInsets.all(24), child: Text('불러오지 못했습니다: ${snap.error}', style: const TextStyle(color: Colors.red)))]);
              final list = snap.data;
              if (list == null) return const Center(child: CircularProgressIndicator());
              if (list.isEmpty) return ListView(children: const [Padding(padding: EdgeInsets.all(32), child: Center(child: Text('저장된 사다리가 없습니다.', style: TextStyle(color: Colors.grey))))]);
              return ListView.separated(
                itemCount: list.length,
                separatorBuilder: (_, _) => const Divider(height: 1),
                itemBuilder: (context, i) {
                  final s = list[i];
                  return ExpansionTile(
                    title: Text(s.title ?? '${s.ladder.participants.length}명 사다리'),
                    subtitle: Text(fmtDate(s.createdAt)),
                    children: [
                      for (final m in s.mappings)
                        ListTile(
                          dense: true,
                          leading: CircleAvatar(radius: 5, backgroundColor: resultColor((m['result'] as Map?)?['type'] as String? ?? 'normal')),
                          title: Text('${m['participant']} → ${(m['result'] as Map?)?['text'] ?? ''}'),
                        ),
                    ],
                  );
                },
              );
            },
          ),
        ),
      );
}
