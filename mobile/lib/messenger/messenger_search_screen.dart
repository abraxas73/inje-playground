import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'messenger_models.dart';
import 'messenger_provider.dart';
import 'messenger_chat_screen.dart';
import 'messenger_ui.dart';

/// 메신저 검색 — 대화방 이름(P326)과 대화 내용(P081)을 함께 찾는다.
class MessengerSearchScreen extends ConsumerStatefulWidget {
  const MessengerSearchScreen({super.key});
  @override
  ConsumerState<MessengerSearchScreen> createState() => _MessengerSearchScreenState();
}

class _MessengerSearchScreenState extends ConsumerState<MessengerSearchScreen> {
  final _q = TextEditingController();
  Future<(List<MsgRoom>, List<MsgChat>)>? _future;
  Map<String, String> _names = const {};

  @override
  void dispose() {
    _q.dispose();
    super.dispose();
  }

  void _run() {
    final word = _q.text.trim();
    if (word.isEmpty) return;
    setState(() { _future = _search(word); });
  }

  Future<(List<MsgRoom>, List<MsgChat>)> _search(String word) async {
    final api = ref.read(messengerApiProvider);
    // 방·대화 동시에(한쪽 실패해도 다른 쪽은 보여 준다)
    final rooms = await api.searchRooms(word).catchError((_) => <MsgRoom>[]);
    final chats = await api.searchChats(word).catchError((_) => <MsgChat>[]);
    final myEmpSeq = ref.read(messengerClientProvider).session?.empSeq ?? '';
    final seqs = <String>{
      for (final r in rooms) if (r.roomType != '7' && r.rawTitle.isEmpty) ...r.unresolvedSeqs(myEmpSeq),
      for (final c in chats) if (c.sendEmpSeq != myEmpSeq) c.sendEmpSeq,
    };
    if (seqs.isNotEmpty) {
      try {
        final names = await api.userNames(seqs.toList());
        if (mounted) setState(() => _names = {..._names, ...names});
      } catch (_) {}
    }
    return (rooms, chats);
  }

  @override
  Widget build(BuildContext context) {
    final myEmpSeq = ref.read(messengerClientProvider).session?.empSeq ?? '';
    return Scaffold(
      appBar: BrandHeader(title: '메신저 검색', showBack: true),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: TextField(
            controller: _q,
            autofocus: true,
            textInputAction: TextInputAction.search,
            onSubmitted: (_) => _run(),
            decoration: InputDecoration(
              hintText: '대화방 이름 · 대화 내용',
              prefixIcon: const Icon(Icons.search),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(22)),
              suffixIcon: IconButton(icon: const Icon(Icons.arrow_forward), onPressed: _run),
            ),
          ),
        ),
        Expanded(child: _results(myEmpSeq)),
      ]),
    );
  }

  Widget _results(String myEmpSeq) {
    final f = _future;
    if (f == null) return Center(child: Text('검색어를 입력하세요', style: TextStyle(color: Brand.muted)));
    return FutureBuilder<(List<MsgRoom>, List<MsgChat>)>(
      future: f,
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting && !snap.hasData) return const Center(child: CircularProgressIndicator());
        if (snap.hasError) return MessengerError(error: snap.error!, onRetry: () async => _run());
        final (rooms, chats) = snap.data ?? (const <MsgRoom>[], const <MsgChat>[]);
        if (rooms.isEmpty && chats.isEmpty) return Center(child: Text('결과가 없습니다', style: TextStyle(color: Brand.muted)));
        return ListView(children: [
          if (rooms.isNotEmpty) ...[
            _header('대화방 ${rooms.length}'),
            for (final r in rooms)
              ListTile(
                leading: InitialBadge(r.titleWith(_names, myEmpSeq)),
                title: Text(r.titleWith(_names, myEmpSeq), maxLines: 1, overflow: TextOverflow.ellipsis),
                subtitle: Text(r.preview, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: Brand.muted)),
                onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => MessengerRoomScreen(room: r))),
              ),
          ],
          if (chats.isNotEmpty) ...[
            _header('대화 내용 ${chats.length}'),
            for (final c in chats)
              ListTile(
                leading: Icon(Icons.chat_bubble_outline, color: Brand.faint),
                title: Text(c.content, maxLines: 2, overflow: TextOverflow.ellipsis),
                subtitle: Text([if (_names[c.sendEmpSeq] != null) _names[c.sendEmpSeq]!, if (c.at != null) '${c.at!.toUtc().add(const Duration(hours: 9))}'.substring(0, 16)].join(' · '), style: TextStyle(color: Brand.muted)),
                onTap: c.roomId.isEmpty
                    ? null
                    : () => Navigator.of(context).push(MaterialPageRoute(
                          builder: (_) => MessengerRoomScreen(room: MsgRoom.minimal(c.roomId, title: _names[c.sendEmpSeq] ?? '대화'), focusChatId: c.chatId),
                        )),
              ),
          ],
        ]);
      },
    );
  }

  Widget _header(String t) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
        child: Text(t, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Brand.muted)),
      );
}
