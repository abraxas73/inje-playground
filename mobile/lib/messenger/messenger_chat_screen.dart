import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'dart:async';
import 'messenger_api.dart';
import 'messenger_models.dart';
import 'messenger_mqtt.dart';
import 'messenger_provider.dart';
import 'messenger_search_screen.dart';
import 'messenger_ui.dart';

/// 아마란스 메신저 대화방 목록 — 저장된 아마란스 로그인으로 P076 세션을 만들어 조회한다.
/// 자격증명이 없거나 만료면 아마란스 연결로 안내. 토큰·비밀번호는 화면에 노출하지 않는다.
class MessengerChatScreen extends ConsumerStatefulWidget {
  const MessengerChatScreen({super.key});
  @override
  ConsumerState<MessengerChatScreen> createState() => _MessengerChatScreenState();
}

class _MessengerChatScreenState extends ConsumerState<MessengerChatScreen> {
  late Future<List<MsgRoom>> _future = _load();
  Map<String, String> _names = const {}; // empSeq → 이름(제목 표시용)
  Map<String, MsgClientState> _states = const {}; // empSeq → 접속 상태(1:1 방 점)
  StreamSubscription? _rtSub;
  Timer? _rtDebounce;

  @override
  void initState() {
    super.initState();
    ensureMessengerRealtime(ref);
    _rtSub = ref.read(messengerMqttProvider).events.listen(_onRealtime);
  }

  void _onRealtime(MessengerMqttEvent e) {
    if (e.isState && e.empSeq.isNotEmpty && e.stateCode.isNotEmpty) {
      // 접속 상태 실시간 갱신
      final s = MsgClientState.fromRow(e.raw);
      if (mounted) setState(() => _states = {..._states, e.empSeq: s});
    }
    if (e.isChat) {
      // 대화/대화방 갱신 — 목록 새로고침(짧게 debounce해 연속 신호 묶기)
      _rtDebounce?.cancel();
      _rtDebounce = Timer(const Duration(milliseconds: 500), () { if (mounted) _refresh(); });
    }
  }

  @override
  void dispose() {
    _rtSub?.cancel();
    _rtDebounce?.cancel();
    super.dispose();
  }

  Future<List<MsgRoom>> _load() async {
    final api = ref.read(messengerApiProvider);
    final rooms = await api.rooms();
    final myEmpSeq = ref.read(messengerClientProvider).session?.empSeq ?? '';
    // 방 응답에 이름이 안 온 참여자만 한 번에 해석(실패해도 목록은 그대로 보여 준다)
    final needing = {for (final r in rooms) if (r.roomType != '7' && r.rawTitle.isEmpty) ...r.unresolvedSeqs(myEmpSeq)};
    if (needing.isNotEmpty) {
      try {
        final names = await api.userNames(needing.toList());
        if (mounted) setState(() => _names = {..._names, ...names});
      } catch (_) {
        // 이름 해석 실패는 치명적이지 않다 — 기본 제목 유지
      }
    }
    // 1:1 방 상대의 접속 상태(실패해도 무시)
    final oneToOne = {for (final r in rooms) if (r.roomType != '7' && r.receiverSeqs.where((s) => s != myEmpSeq).length == 1) ...r.receiverSeqs.where((s) => s != myEmpSeq)};
    if (oneToOne.isNotEmpty) {
      try {
        final states = await api.clientStates(oneToOne.toList());
        if (mounted) setState(() => _states = {..._states, for (final s in states) s.empSeq: s});
      } catch (_) {}
    }
    return rooms;
  }

  Future<void> _refresh() async {
    setState(() => _future = _load());
    await _future.catchError((_) => <MsgRoom>[]);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: BrandHeader(
        title: '메신저',
        showBack: true,
        actions: [
          IconButton(
            icon: const Icon(Icons.search),
            tooltip: '검색',
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const MessengerSearchScreen())),
          ),
        ],
      ),
      body: FutureBuilder<List<MsgRoom>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) return const Center(child: CircularProgressIndicator());
          if (snap.hasError) return MessengerError(error: snap.error!, onRetry: _refresh);
          final rooms = snap.data ?? const [];
          if (rooms.isEmpty) {
            return RefreshIndicator(onRefresh: _refresh, child: ListView(children: [SizedBox(height: 120), Center(child: Text('대화방이 없습니다', style: TextStyle(color: Brand.muted)))]));
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
    final myEmpSeq = ref.read(messengerClientProvider).session?.empSeq ?? '';
    final title = r.titleWith(_names, myEmpSeq);
    final others = r.receiverSeqs.where((s) => s != myEmpSeq).toList();
    final state = (r.roomType != '7' && others.length == 1) ? _states[others.first] : null;
    return ListTile(
      leading: Stack(clipBehavior: Clip.none, children: [
        InitialBadge(title),
        if (state != null)
          Positioned(
            right: -1,
            bottom: -1,
            child: Container(
              width: 12,
              height: 12,
              decoration: BoxDecoration(
                color: state.online ? const Color(0xFF34C759) : (state.code == '-1' ? Brand.faint : const Color(0xFFFF9500)),
                shape: BoxShape.circle,
                border: Border.all(color: Brand.surface, width: 2),
              ),
            ),
          ),
      ]),
      title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text(r.preview, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: Brand.muted)),
      trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
        if (r.lastAt != null) Text(_hhmm(r.lastAt!), style: TextStyle(fontSize: 12, color: Brand.faint)),
        if (r.unreadCount > 0) ...[
          const SizedBox(height: 4),
          Container(padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2), decoration: BoxDecoration(color: Brand.botViolet, borderRadius: BorderRadius.circular(10)), child: Text('${r.unreadCount}', style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600))),
        ],
      ]),
      onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => MessengerRoomScreen(room: r))),
    );
  }

}

/// 한 대화방 — 최근 대화를 읽고, 보내기. 내 메시지는 오른쪽 정렬(세션 empSeq 기준).
class MessengerRoomScreen extends ConsumerStatefulWidget {
  const MessengerRoomScreen({super.key, required this.room, this.focusChatId});
  final MsgRoom room;

  /// 검색에서 넘어온 경우: 이 메시지로 스크롤·강조.
  final String? focusChatId;
  @override
  ConsumerState<MessengerRoomScreen> createState() => _MessengerRoomScreenState();
}

class _MessengerRoomScreenState extends ConsumerState<MessengerRoomScreen> {
  final _input = TextEditingController();
  late Future<List<MsgChat>> _future = _load();
  Map<String, String> _names = const {}; // sendEmpSeq → 이름
  bool _sending = false;

  MessengerApi get _api => ref.read(messengerApiProvider);

  final _focusKey = GlobalKey();
  StreamSubscription? _rtSub;

  @override
  void initState() {
    super.initState();
    final mqtt = ref.read(messengerMqttProvider);
    mqtt.enterRoom(widget.room.roomId);
    _rtSub = mqtt.events.listen((e) {
      // 이 방 대화가 오면 새로고침(맨 아래로 이어진다)
      if (e.isChat && (e.roomId == widget.room.roomId || e.roomId.isEmpty)) {
        if (mounted) _refresh();
      }
    });
  }

  Future<List<MsgChat>> _load() async {
    final chats = await _api.chats(widget.room.roomId);
    chats.sort((a, b) => a.timeStamp.compareTo(b.timeStamp)); // 오래된→최신(화면은 reverse로 최신이 아래)
    if (widget.focusChatId != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final ctx = _focusKey.currentContext;
        if (ctx != null) Scrollable.ensureVisible(ctx, alignment: 0.5, duration: const Duration(milliseconds: 300));
      });
    }
    final myEmpSeq = ref.read(messengerClientProvider).session?.empSeq ?? '';
    final seqs = {for (final c in chats) if (c.sendEmpSeq != myEmpSeq) c.sendEmpSeq};
    if (seqs.isNotEmpty) {
      try {
        final names = await _api.userNames(seqs.toList());
        if (mounted) setState(() => _names = {..._names, ...names});
      } catch (_) {}
    }
    return chats;
  }

  Future<void> _refresh() async {
    setState(() => _future = _load());
    await _future.catchError((_) => <MsgChat>[]);
  }

  @override
  void dispose() {
    _rtSub?.cancel();
    ref.read(messengerMqttProvider).leaveRoom(widget.room.roomId);
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
      appBar: BrandHeader(
        title: widget.room.title,
        showBack: true,
        actions: [
          PopupMenuButton<String>(
            icon: const Icon(Icons.more_vert),
            onSelected: (v) {
              if (v == 'notice') _openRoomSheet(title: '공지', loader: () => _api.roomNotices(widget.room.roomId), build: _noticeTile);
              if (v == 'files') _openRoomSheet(title: '파일함', loader: () => _api.roomFiles(widget.room.roomId), build: _fileTile);
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'notice', child: Text('공지')),
              PopupMenuItem(value: 'files', child: Text('파일함')),
            ],
          ),
        ],
      ),
      body: Column(children: [
        Expanded(
          child: FutureBuilder<List<MsgChat>>(
            future: _future,
            builder: (context, snap) {
              if (snap.connectionState == ConnectionState.waiting) return const Center(child: CircularProgressIndicator());
              if (snap.hasError) return Center(child: Padding(padding: const EdgeInsets.all(24), child: Text('불러오지 못했습니다: ${snap.error}', textAlign: TextAlign.center)));
              final chats = snap.data ?? const [];
              if (chats.isEmpty) return Center(child: Text('대화가 없습니다', style: TextStyle(color: Brand.muted)));
              // reverse:true → 맨 아래(최신)부터 보인다. i=0=최신, 올라갈수록 과거. chats는 오름차순이라 j로 뒤집어 읽는다.
              return ListView.builder(
                reverse: true,
                padding: const EdgeInsets.all(12),
                itemCount: chats.length,
                itemBuilder: (_, i) {
                  final j = chats.length - 1 - i;
                  final c = chats[j];
                  final older = j == 0 ? null : chats[j - 1];
                  final showDate = older == null || !_sameDay(older.at, c.at); // 그날의 첫(가장 오래된) 메시지 위에 날짜
                  final focus = widget.focusChatId != null && c.chatId == widget.focusChatId;
                  return Column(key: focus ? _focusKey : null, children: [
                    if (showDate) _dateDivider(c.at),
                    DecoratedBox(
                      decoration: BoxDecoration(color: focus ? Brand.blueTint.withValues(alpha: 0.6) : null, borderRadius: BorderRadius.circular(8)),
                      child: _bubble(c, c.sendEmpSeq == myEmpSeq),
                    ),
                  ]);
                },
              );
            },
          ),
        ),
        _composer(),
      ]),
    );
  }

  /// 공지·파일함 공용 바텀시트(목록 로드 → 타일).
  Future<void> _openRoomSheet<T>({required String title, required Future<List<T>> Function() loader, required Widget Function(T) build}) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.6,
        builder: (_, ctl) => Column(children: [
          Padding(padding: const EdgeInsets.fromLTRB(20, 16, 20, 8), child: Row(children: [Text(title, style: Theme.of(context).textTheme.titleLarge)])),
          Expanded(
            child: FutureBuilder<List<T>>(
              future: loader(),
              builder: (context, snap) {
                if (snap.connectionState == ConnectionState.waiting) return const Center(child: CircularProgressIndicator());
                if (snap.hasError) return Padding(padding: const EdgeInsets.all(24), child: Text('불러오지 못했습니다: ${snap.error}'));
                final items = snap.data ?? const [];
                if (items.isEmpty) return Center(child: Text('$title가 없습니다', style: TextStyle(color: Brand.muted)));
                return ListView(controller: ctl, children: [for (final it in items) build(it)]);
              },
            ),
          ),
        ]),
      ),
    );
  }

  Widget _noticeTile(MsgRoomNotice n) => ListTile(
        leading: Icon(Icons.campaign_outlined, color: Brand.faint),
        title: Text(n.content),
        subtitle: n.empName.isEmpty ? null : Text(n.empName, style: TextStyle(color: Brand.muted)),
      );

  Widget _fileTile(MsgRoomFile f) => ListTile(
        leading: Icon(Icons.insert_drive_file_outlined, color: Brand.faint),
        title: Text(f.name, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Text([if (f.empName.isNotEmpty) f.empName, if (f.size > 0) _fileSize(f.size)].join(' · '), style: TextStyle(color: Brand.muted)),
      );

  String _fileSize(int b) => b >= 1048576 ? '${(b / 1048576).toStringAsFixed(1)}MB' : b >= 1024 ? '${(b / 1024).toStringAsFixed(0)}KB' : '${b}B';

  Widget _bubble(MsgChat c, bool mine) {
    final text = c.deleted ? '삭제된 메시지입니다.' : c.content;
    final name = _names[c.sendEmpSeq];
    final time = c.at == null ? '' : _hhmm(c.at!);
    final bubble = Container(
      margin: const EdgeInsets.symmetric(vertical: 2),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      constraints: const BoxConstraints(maxWidth: 280),
      decoration: BoxDecoration(color: mine ? Brand.botViolet : Brand.blueTint, borderRadius: BorderRadius.circular(14)),
      child: Text(text, style: TextStyle(color: mine ? Colors.white : Brand.navy, height: 1.4, fontStyle: c.deleted ? FontStyle.italic : FontStyle.normal)),
    );
    final stamp = Padding(padding: const EdgeInsets.only(bottom: 2), child: Text(time, style: TextStyle(fontSize: 10, color: Brand.faint)));
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Column(
        crossAxisAlignment: mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
        children: [
          if (!mine && name != null && name.isNotEmpty)
            Padding(padding: const EdgeInsets.only(left: 4, top: 4), child: Text(name, style: TextStyle(fontSize: 11, color: Brand.muted))),
          // 시각은 말풍선 바깥쪽 아래(내 것은 왼쪽, 상대는 오른쪽)
          Row(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: mine ? [stamp, const SizedBox(width: 4), Flexible(child: bubble)] : [Flexible(child: bubble), const SizedBox(width: 4), stamp],
          ),
        ],
      ),
    );
  }

  Widget _dateDivider(DateTime? at) {
    if (at == null) return const SizedBox.shrink();
    final k = at.toUtc().add(const Duration(hours: 9));
    final label = '${k.year}년 ${k.month}월 ${k.day}일';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Row(children: [
        Expanded(child: Divider(color: Brand.faint)),
        Padding(padding: const EdgeInsets.symmetric(horizontal: 10), child: Text(label, style: TextStyle(fontSize: 11, color: Brand.muted))),
        Expanded(child: Divider(color: Brand.faint)),
      ]),
    );
  }

  bool _sameDay(DateTime? a, DateTime? b) {
    if (a == null || b == null) return a == b;
    final ka = a.toUtc().add(const Duration(hours: 9)), kb = b.toUtc().add(const Duration(hours: 9));
    return ka.year == kb.year && ka.month == kb.month && ka.day == kb.day;
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
