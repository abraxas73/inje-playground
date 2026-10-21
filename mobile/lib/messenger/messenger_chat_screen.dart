import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'messenger_api.dart';
import 'messenger_client.dart';
import 'messenger_models.dart';
import 'messenger_provider.dart';

/// 아마란스 메신저 대화방 목록 — 저장된 아마란스 로그인으로 P076 세션을 만들어 조회한다.
/// 자격증명이 없거나 만료면 아마란스 연결로 안내. 토큰·비밀번호는 화면에 노출하지 않는다.
class MessengerChatScreen extends ConsumerStatefulWidget {
  const MessengerChatScreen({super.key});
  @override
  ConsumerState<MessengerChatScreen> createState() => _MessengerChatScreenState();
}

class _MessengerChatScreenState extends ConsumerState<MessengerChatScreen> {
  late Future<List<MsgRoom>> _future = ref.read(messengerApiProvider).rooms();

  Future<void> _refresh() async {
    setState(() => _future = ref.read(messengerApiProvider).rooms());
    await _future.catchError((_) => <MsgRoom>[]);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: BrandHeader(title: '메신저', showBack: true),
      body: FutureBuilder<List<MsgRoom>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) return const Center(child: CircularProgressIndicator());
          if (snap.hasError) return _error(context, snap.error!);
          final rooms = snap.data ?? const [];
          if (rooms.isEmpty) {
            return RefreshIndicator(onRefresh: _refresh, child: ListView(children: const [SizedBox(height: 120), Center(child: Text('대화방이 없습니다', style: TextStyle(color: Brand.muted)))]));
          }
          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView.separated(
              itemCount: rooms.length,
              separatorBuilder: (_, _) => const Divider(height: 1, indent: 72),
              itemBuilder: (_, i) => _roomTile(context, rooms[i]),
            ),
          );
        },
      ),
    );
  }

  Widget _roomTile(BuildContext context, MsgRoom r) {
    return ListTile(
      leading: InitialBadge(r.title),
      title: Text(r.title, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text(r.preview, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Brand.muted)),
      trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
        if (r.lastAt != null) Text(_hhmm(r.lastAt!), style: const TextStyle(fontSize: 12, color: Brand.faint)),
        if (r.unreadCount > 0) ...[
          const SizedBox(height: 4),
          Container(padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2), decoration: BoxDecoration(color: Brand.botViolet, borderRadius: BorderRadius.circular(10)), child: Text('${r.unreadCount}', style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600))),
        ],
      ]),
      onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => MessengerRoomScreen(room: r))),
    );
  }

  Widget _error(BuildContext context, Object e) {
    // 저장된 자격증명 자체가 없을 때만 '연결' 안내. 로그인은 됐는데 서버가 거부하면 실제 코드·메시지를 보여 준다.
    final noCreds = e is MessengerAuthException && e.noCreds;
    final detail = switch (e) {
      MessengerAuthException a => '메신저 로그인 거부 (코드 ${a.resultCode})\n${a.message}',
      MessengerException m => '메신저 오류 (코드 ${m.resultCode})\n${m.message}',
      _ => '$e',
    };
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          TintIcon(noCreds ? Icons.apartment_outlined : Icons.error_outline, size: 56),
          const SizedBox(height: 16),
          Text(noCreds ? '아마란스를 연결하면 메신저를 씁니다' : '메신저를 불러오지 못했습니다', style: Theme.of(context).textTheme.titleMedium, textAlign: TextAlign.center),
          const SizedBox(height: 6),
          Text(noCreds ? '자동 로그인에 저장된 아이디·비밀번호로 메신저에 로그인합니다. 토큰은 이 기기에만 저장됩니다.' : detail, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Brand.muted), textAlign: TextAlign.center),
          const SizedBox(height: 20),
          if (noCreds)
            FilledButton.icon(onPressed: () => context.push('/gw/connect'), icon: const Icon(Icons.login, size: 18), label: const Text('아마란스 연결하기'))
          else
            OutlinedButton.icon(onPressed: _refresh, icon: const Icon(Icons.refresh, size: 18), label: const Text('다시 시도')),
        ]),
      ),
    );
  }
}

/// 한 대화방 — 최근 대화를 읽고, 보내기. 내 메시지는 오른쪽 정렬(세션 empSeq 기준).
class MessengerRoomScreen extends ConsumerStatefulWidget {
  const MessengerRoomScreen({super.key, required this.room});
  final MsgRoom room;
  @override
  ConsumerState<MessengerRoomScreen> createState() => _MessengerRoomScreenState();
}

class _MessengerRoomScreenState extends ConsumerState<MessengerRoomScreen> {
  final _input = TextEditingController();
  late Future<List<MsgChat>> _future = _load();
  bool _sending = false;

  MessengerApi get _api => ref.read(messengerApiProvider);

  Future<List<MsgChat>> _load() => _api.chats(widget.room.roomId);

  Future<void> _refresh() async {
    setState(() => _future = _load());
    await _future.catchError((_) => <MsgChat>[]);
  }

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await _api.sendChat(roomId: widget.room.roomId, content: text, uuid: DateTime.now().microsecondsSinceEpoch.toString());
      _input.clear();
      await _refresh();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('보내지 못했습니다: $e')));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final myEmpSeq = ref.read(messengerClientProvider).session?.empSeq ?? '';
    return Scaffold(
      appBar: BrandHeader(title: widget.room.title, showBack: true),
      body: Column(children: [
        Expanded(
          child: FutureBuilder<List<MsgChat>>(
            future: _future,
            builder: (context, snap) {
              if (snap.connectionState == ConnectionState.waiting) return const Center(child: CircularProgressIndicator());
              if (snap.hasError) return Center(child: Padding(padding: const EdgeInsets.all(24), child: Text('불러오지 못했습니다: ${snap.error}', textAlign: TextAlign.center)));
              final chats = snap.data ?? const [];
              if (chats.isEmpty) return const Center(child: Text('대화가 없습니다', style: TextStyle(color: Brand.muted)));
              return RefreshIndicator(
                onRefresh: _refresh,
                child: ListView.builder(
                  reverse: true,
                  padding: const EdgeInsets.all(12),
                  itemCount: chats.length,
                  itemBuilder: (_, i) => _bubble(chats[chats.length - 1 - i], chats[chats.length - 1 - i].sendEmpSeq == myEmpSeq),
                ),
              );
            },
          ),
        ),
        _composer(),
      ]),
    );
  }

  Widget _bubble(MsgChat c, bool mine) {
    final text = c.deleted ? '삭제된 메시지입니다.' : c.content;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        constraints: const BoxConstraints(maxWidth: 280),
        decoration: BoxDecoration(
          color: mine ? Brand.botViolet : Brand.blueTint,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Text(text, style: TextStyle(color: mine ? Colors.white : Brand.navy, height: 1.4, fontStyle: c.deleted ? FontStyle.italic : FontStyle.normal)),
      ),
    );
  }

  Widget _composer() {
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 6, 12, 6),
        child: Row(children: [
          Expanded(
            child: TextField(
              controller: _input,
              minLines: 1,
              maxLines: 4,
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => _send(),
              decoration: InputDecoration(hintText: '메시지', border: OutlineInputBorder(borderRadius: BorderRadius.circular(22)), contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10)),
            ),
          ),
          const SizedBox(width: 8),
          IconButton.filled(onPressed: _sending ? null : _send, icon: _sending ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.send, size: 20)),
        ]),
      ),
    );
  }
}

String _hhmm(DateTime t) {
  final k = t.toUtc().add(const Duration(hours: 9));
  return '${k.hour.toString().padLeft(2, '0')}:${k.minute.toString().padLeft(2, '0')}';
}
