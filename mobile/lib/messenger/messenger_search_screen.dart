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
  Map<String, MsgRoom> _roomsById = const {}; // 대화 내용 결과의 방 제목·열기용(내 대화방 목록)

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
    final all = chats.isEmpty ? const <MsgRoom>[] : await api.rooms().catchError((_) => <MsgRoom>[]);
    if (mounted) setState(() => _roomsById = {for (final r in [...all, ...rooms]) r.roomId: r});
    final myEmpSeq = ref.read(messengerClientProvider).session?.empSeq ?? '';
    final seqs = <String>{
      for (final r in all) if (r.roomType != '7' && r.rawTitle.isEmpty) ...r.unresolvedSeqs(myEmpSeq),
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
      appBar: BrandHeader(compact: WidgetChrome.of(context), title: '메신저 검색', showBack: true),
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
        // 첫 칸은 방 제목, 둘째 칸은 대화방(마지막 대화) / 대화 내용(보낸 사람·시각·내용). 방을 누르면 그 방, 대화를 누르면 그 메시지로.
        String roomTitle(String roomId, {String fallback = '대화'}) {
          final r = _roomsById[roomId];
          final t = r?.titleWith(_names, myEmpSeq) ?? '';
          return t.isEmpty ? fallback : t;
        }
        return ListView(children: [
          if (rooms.isNotEmpty) ...[
            _header('대화방 ${rooms.length}'),
            for (final r in rooms)
              _row(
                title: r.titleWith(_names, myEmpSeq),
                body: Text(r.preview.isEmpty ? '대화방' : r.preview, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13, color: Brand.muted)),
                onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => MessengerRoomScreen(room: r.withTitle(r.titleWith(_names, myEmpSeq))))),
              ),
          ],
          if (chats.isNotEmpty) ...[
            _header('대화 내용 ${chats.length}'),
            for (final c in chats)
              _row(
                title: roomTitle(c.roomId, fallback: _names[c.sendEmpSeq] ?? '대화'),
                body: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                  Text(c.content, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13)),
                  Text([if (_names[c.sendEmpSeq] != null) _names[c.sendEmpSeq]!, if (c.at != null) '${c.at!.toUtc().add(const Duration(hours: 9))}'.substring(0, 16)].join(' · '), style: TextStyle(fontSize: 11, color: Brand.muted)),
                ]),
                onTap: c.roomId.isEmpty
                    ? null
                    : () => Navigator.of(context).push(MaterialPageRoute(
                          builder: (_) => MessengerRoomScreen(
                            room: (_roomsById[c.roomId] ?? MsgRoom.minimal(c.roomId, title: '대화')).withTitle(roomTitle(c.roomId, fallback: _names[c.sendEmpSeq] ?? '대화')),
                            focusChatId: c.chatId,
                          ),
                        )),
              ),
          ],
        ]);
      },
    );
  }

  /// 결과 한 줄 — 왼쪽 칸 방 제목(고정 폭), 오른쪽 칸 내용.
  Widget _row({required String title, required Widget body, VoidCallback? onTap}) => InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SizedBox(width: 150, child: Text(title, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Brand.navy))),
            const SizedBox(width: 12),
            Expanded(child: body),
          ]),
        ),
      );

  Widget _header(String t) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
        child: Text(t, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Brand.muted)),
      );
}
