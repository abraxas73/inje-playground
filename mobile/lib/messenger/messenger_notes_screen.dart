import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import '../gw/gw_client.dart' show asStr;
import 'messenger_models.dart';
import 'messenger_provider.dart';
import 'messenger_ui.dart';

/// 아마란스 쪽지 — 받은 목록(P245) + 상세(P246). 보내기는 후속(수신자 선택 필요).
class MessengerNotesScreen extends ConsumerStatefulWidget {
  const MessengerNotesScreen({super.key});
  @override
  ConsumerState<MessengerNotesScreen> createState() => _MessengerNotesScreenState();
}

class _MessengerNotesScreenState extends ConsumerState<MessengerNotesScreen> {
  late Future<List<MsgNote>> _future = ref.read(messengerApiProvider).notes();

  Future<void> _refresh() async {
    setState(() => _future = ref.read(messengerApiProvider).notes());
    await _future.catchError((_) => <MsgNote>[]);
  }

  Future<void> _open(MsgNote n) async {
    final api = ref.read(messengerApiProvider);
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.7,
        builder: (_, ctl) => FutureBuilder<Map>(
          future: api.noteDetail(n.msgId),
          builder: (context, snap) {
            if (snap.hasError) return Padding(padding: const EdgeInsets.all(24), child: Text('불러오지 못했습니다: ${snap.error}'));
            if (!snap.hasData) return const Center(child: Padding(padding: EdgeInsets.all(40), child: CircularProgressIndicator()));
            final d = snap.data!;
            final content = asStr(d['content']).isNotEmpty ? asStr(d['content']) : n.content;
            return ListView(controller: ctl, padding: const EdgeInsets.fromLTRB(20, 12, 20, 32), children: [
              Text(n.title.isEmpty ? '(제목 없음)' : n.title, style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 6),
              Text('${n.sender}${n.recvDate.isEmpty ? '' : ' · ${n.recvDate}'}', style: const TextStyle(color: Brand.muted, fontSize: 13)),
              const Divider(height: 24),
              Text(content.isEmpty ? '(내용 없음)' : content, style: const TextStyle(fontSize: 15, height: 1.6, color: Brand.navy)),
            ]);
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: BrandHeader(title: '쪽지', showBack: true),
      body: FutureBuilder<List<MsgNote>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) return const Center(child: CircularProgressIndicator());
          if (snap.hasError) return MessengerError(error: snap.error!, onRetry: _refresh);
          final notes = snap.data ?? const [];
          if (notes.isEmpty) {
            return RefreshIndicator(onRefresh: _refresh, child: ListView(children: const [SizedBox(height: 120), Center(child: Text('받은 쪽지가 없습니다', style: TextStyle(color: Brand.muted)))]));
          }
          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView.separated(
              itemCount: notes.length,
              separatorBuilder: (_, _) => const Divider(height: 1, indent: 16),
              itemBuilder: (_, i) {
                final n = notes[i];
                return ListTile(
                  leading: InitialBadge(n.sender.isEmpty ? '쪽지' : n.sender),
                  title: Text(n.title.isEmpty ? '(제목 없음)' : n.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: n.read ? FontWeight.w400 : FontWeight.w700)),
                  subtitle: Text('${n.sender}${n.recvDate.isEmpty ? '' : ' · ${n.recvDate}'}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Brand.muted)),
                  onTap: () => _open(n),
                );
              },
            ),
          );
        },
      ),
    );
  }
}
