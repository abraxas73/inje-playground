import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'dart:async';
import 'messenger_api.dart';
import 'messenger_client.dart' show MessengerAuthException;
import 'messenger_models.dart';
import 'messenger_favorites.dart';
import 'messenger_files.dart';
import 'messenger_links.dart';
import 'messenger_mqtt.dart';
import 'messenger_provider.dart';
import 'messenger_search_screen.dart';
import 'messenger_ui.dart';

/// 아마란스 메신저 대화방 목록 — 저장된 아마란스 로그인으로 P076 세션을 만들어 조회한다.
/// 자격증명이 없거나 만료면 아마란스 연결로 안내. 토큰·비밀번호는 화면에 노출하지 않는다.
class MessengerChatScreen extends ConsumerStatefulWidget {
  const MessengerChatScreen({super.key, this.embedded = false});
  /// 대시보드 타일 안(스코프 Navigator)에 들어갈 때 true — 목록 화면의 '뒤로'를 숨긴다.
  final bool embedded;
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
    sortRoomsNewest(rooms); // 서버 순서는 시각만 보고 날짜가 섞였다 — 마지막 대화 날짜·시각으로 최신이 위
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
    setState(() { _future = _load(); });
    await _future.catchError((_) => <MsgRoom>[]);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: BrandHeader(compact: WidgetChrome.of(context), 
        title: '메신저',
        showBack: !widget.embedded,
        onRefresh: _refresh,
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
          if (snap.connectionState == ConnectionState.waiting && !snap.hasData) return const Center(child: CircularProgressIndicator());
          if (snap.hasError) return MessengerError(error: snap.error!, onRetry: _refresh);
          final rooms = snap.data ?? const [];
          if (rooms.isEmpty) {
            return RefreshIndicator(onRefresh: _refresh, child: ListView(children: [SizedBox(height: 120), Center(child: Text('대화방이 없습니다', style: TextStyle(color: Brand.muted)))]));
          }
          // 즐겨찾기한 방은 위 구역에 따로(구역 안 순서는 서버 순서 그대로)
          final favIds = ref.watch(messengerFavoritesProvider);
          final favs = [for (final r in rooms) if (favIds.contains(r.roomId)) r];
          final rest = [for (final r in rooms) if (!favIds.contains(r.roomId)) r];
          Widget section(String label) => Padding(padding: const EdgeInsets.fromLTRB(20, 14, 20, 6), child: Text(label, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Brand.muted)));
          List<Widget> tiles(List<MsgRoom> list) => [for (final (i, r) in list.indexed) ...[if (i > 0) const Divider(height: 1, indent: 72), _roomTile(context, r)]];
          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView(children: [
              if (favs.isNotEmpty) ...[section('즐겨찾기'), ...tiles(favs), section('대화방')],
              ...tiles(rest),
            ]),
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
      // 위젯 안에서는 다른 위젯과 같은 글꼴(제목 14·보조 12)
      dense: WidgetChrome.of(context),
      title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: WidgetChrome.of(context) ? const TextStyle(fontSize: 14, fontWeight: FontWeight.w600) : null),
      subtitle: Text(r.preview, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: Brand.muted, fontSize: WidgetChrome.of(context) ? 12 : null)),
      trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
        if (r.lastAt != null) Text(roomWhen(r.lastAt!), style: TextStyle(fontSize: 12, color: Brand.faint)),
        if (r.unreadCount > 0) ...[
          const SizedBox(height: 4),
          Container(padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2), decoration: BoxDecoration(color: Brand.botViolet, borderRadius: BorderRadius.circular(10)), child: Text('${r.unreadCount}', style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600))),
        ],
      ]),
      // 방에서 돌아오면 목록을 다시 읽어 안 읽음 수를 갱신
      onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => MessengerRoomScreen(room: r.withTitle(title)))).then((_) { if (mounted) _refresh(); }),
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
  bool _focused = false; // 검색에서 온 메시지로는 처음 한 번만 옮긴다(실시간 새로고침마다 끌어가지 않게)
  StreamSubscription? _rtSub;

  late final MessengerMqtt _mqtt; // dispose에서 ref를 못 쓰므로 미리 잡아 둔다
  String? _lastRead; // 마지막으로 읽음 처리한 chatId

  @override
  void initState() {
    super.initState();
    final mqtt = _mqtt = ref.read(messengerMqttProvider);
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
    // 검색에서 온 메시지가 최근 대화에 없으면 더 오래된 대화를 이어 읽는다(최대 10번 — 그 이전이면 방만 연다)
    final focus = widget.focusChatId;
    for (var i = 0; focus != null && !_focused && i < 10 && chats.isNotEmpty && !chats.any((c) => c.chatId == focus); i++) {
      final oldest = chats.map((c) => c.timeStamp).reduce((a, b) => a < b ? a : b);
      final more = await _api.chats(widget.room.roomId, timeStamp: '$oldest');
      final seen = {for (final c in chats) c.chatId};
      final fresh = [for (final c in more) if (!seen.contains(c.chatId)) c];
      if (fresh.isEmpty) break;
      chats.addAll(fresh);
    }
    chats.sort((a, b) => a.timeStamp.compareTo(b.timeStamp)); // 오래된→최신(화면은 reverse로 최신이 아래)
    // 방을 열어 본 것 = 읽음 — 가장 최신 대화까지 읽음 처리(P342). 실패해도 화면은 그대로.
    // 새 대화가 있을 때만 — 읽음 처리가 다시 실시간 신호를 부르고 그 신호가 또 새로고침하는 반복을 막는다.
    if (chats.isNotEmpty && chats.last.chatId != _lastRead) {
      _lastRead = chats.last.chatId;
      unawaited(_api.readChat(roomId: widget.room.roomId, chatId: _lastRead!).catchError((_) {}));
    }
    if (focus != null && !_focused) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final ctx = _focusKey.currentContext;
        if (ctx != null) {
          _focused = true;
          Scrollable.ensureVisible(ctx, alignment: 0.5, duration: const Duration(milliseconds: 300));
        }
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
    setState(() { _future = _load(); });
    await _future.catchError((_) => <MsgChat>[]);
  }

  @override
  void dispose() {
    _rtSub?.cancel();
    _mqtt.leaveRoom(widget.room.roomId);
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

  /// 파일·그림 보내기(첨부 버튼·붙여넣기 공용). 확인을 받은 뒤 보낸다.
  Future<void> _sendFiles(List<MsgUpload> files) async {
    if (files.isEmpty || _sending || !await confirmMsgUploads(context, files)) return;
    setState(() => _sending = true);
    try {
      await _api.sendFiles(roomId: widget.room.roomId, files: files);
      await _refresh();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('보내지 못했습니다: $e')));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _attach() async {
    try {
      await _sendFiles(await ref.read(msgFilePickerProvider)());
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('파일을 열지 못했습니다: $e')));
    }
  }

  /// ⌘V·Ctrl+V — 클립보드에 복사한 파일이나 그림이 있으면 보내기 확인, 글자면 평소대로 붙여넣기.
  Future<bool> _paste() async {
    final files = await ref.read(msgClipboardProvider)();
    if (files == null || files.isEmpty) return false;
    await _sendFiles(files);
    return true;
  }

  @override
  Widget build(BuildContext context) {
    final myEmpSeq = ref.read(messengerClientProvider).session?.empSeq ?? '';
    return Scaffold(
      appBar: BrandHeader(compact: WidgetChrome.of(context), 
        title: widget.room.title,
        showBack: true,
        onRefresh: _refresh,
        actions: [
          Builder(builder: (context) {
            final fav = ref.watch(messengerFavoritesProvider).contains(widget.room.roomId);
            return IconButton(
              tooltip: fav ? '즐겨찾기 해제' : '즐겨찾기',
              icon: Icon(fav ? Icons.star_rounded : Icons.star_outline_rounded, color: fav ? const Color(0xFFF5B400) : null),
              onPressed: () => ref.read(messengerFavoritesProvider.notifier).toggle(widget.room.roomId),
            );
          }),
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
        // 대화 글자 끌어 선택·복사 — 홈 위젯 안에서 앱 전체 선택(SelectAllText)으로는 끌어 선택이 안 됐다(데스크톱 실측), Teams 채팅처럼 직접 둔다
        Expanded(
          child: SelectionArea(child: FutureBuilder<List<MsgChat>>(
            future: _future,
            builder: (context, snap) {
              if (snap.connectionState == ConnectionState.waiting && !snap.hasData) return const Center(child: CircularProgressIndicator());
              if (snap.hasError) return Center(child: Padding(padding: const EdgeInsets.all(24), child: Text('불러오지 못했습니다: ${snap.error}', textAlign: TextAlign.center)));
              final chats = snap.data ?? const [];
              if (chats.isEmpty) return Center(child: Text('대화가 없습니다', style: TextStyle(color: Brand.muted)));
              // reverse:true → 맨 아래(최신)부터 보인다. i=0=최신, 올라갈수록 과거. chats는 오름차순이라 j로 뒤집어 읽는다.
              // 찾아갈 메시지가 있으면 모든 줄을 미리 그린다 — 화면 밖 줄은 그려지지 않아 그 자리로 옮길 수 없다
              Widget item(int i) {
                  final j = chats.length - 1 - i;
                  final c = chats[j];
                  final older = j == 0 ? null : chats[j - 1];
                  final showDate = older == null || !_sameDay(older.at, c.at); // 그날의 첫(가장 오래된) 메시지 위에 날짜
                  final focus = widget.focusChatId != null && c.chatId == widget.focusChatId;
                  return Column(key: focus ? _focusKey : null, children: [
                    if (showDate) _dateDivider(c.at),
                    DecoratedBox(
                      decoration: BoxDecoration(color: focus ? const Color(0xFFFFE58F) : null, borderRadius: BorderRadius.circular(8)), // 찾은 메시지는 형광 노랑
                      child: _bubble(c, c.sendEmpSeq == myEmpSeq),
                    ),
                  ]);
              }
              return widget.focusChatId != null
                  ? SingleChildScrollView(reverse: true, padding: const EdgeInsets.all(12), child: Column(children: [for (var i = chats.length - 1; i >= 0; i--) item(i)]))
                  : ListView.builder(reverse: true, padding: const EdgeInsets.all(12), itemCount: chats.length, itemBuilder: (_, i) => item(i));
            },
          )),
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
                if (snap.connectionState == ConnectionState.waiting && !snap.hasData) return const Center(child: CircularProgressIndicator());
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

  Widget _bubble(MsgChat c, bool mine) => LayoutBuilder(builder: (context, box) => _bubbleIn(c, mine, box.maxWidth * 0.8));

  Widget _bubbleIn(MsgChat c, bool mine, double maxW) {
    final text = c.deleted ? '삭제된 메시지입니다.' : c.displayContent;
    final name = _names[c.sendEmpSeq];
    final time = c.at == null ? '' : _hhmm(c.at!);
    final attach = !c.deleted && (c.files.isNotEmpty || c.fileExpired);
    final files = attach ? MsgAttachments(chat: c, mine: mine, maxWidth: maxW) : null;
    final bubble = files != null && text.isEmpty ? files : Container(
      margin: const EdgeInsets.symmetric(vertical: 2),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      // 대화 영역 실제 폭의 80%까지(고정 상한 없음) — 강제 줄바꿈이 아니면 한 줄로. 좌우 정렬로 내 것/상대 것 구분은 유지.
      constraints: BoxConstraints(maxWidth: maxW),
      decoration: BoxDecoration(color: mine ? Brand.botViolet : Brand.blueTint, borderRadius: BorderRadius.circular(14)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        ?files,
        if (text.isNotEmpty || files == null)
          LinkifiedText(text, style: TextStyle(color: mine ? Colors.white : Brand.navy, height: 1.4, fontStyle: c.deleted ? FontStyle.italic : FontStyle.normal), linkColor: mine ? Colors.white : Brand.blue),
      ]),
    );
    // 첫 주소 하나는 말풍선 아래 미리보기(텍스트 대화만, 비밀대화 제외 — 메신저 앱과 같음)
    final preview = c.contentType == '0' && !c.secret ? firstPreviewUrl(text) : null;
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
          if (preview != null) LinkPreviewCard(url: preview, maxWidth: maxW),
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
          IconButton(tooltip: '파일 보내기', onPressed: _sending ? null : _attach, icon: const Icon(Icons.attach_file)),
          Expanded(
            child: Actions(
              actions: {PasteTextIntent: MsgPasteAction(_paste)},
              child: TextField(
              controller: _input,
              minLines: 1,
              maxLines: 4,
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => _send(),
              onEditingComplete: () {}, // 보낸 뒤에도 입력창에 포커스 유지(이어서 입력) — 기본 동작은 포커스를 놓는다
              decoration: InputDecoration(hintText: '메시지 · 그림은 붙여넣기로', border: OutlineInputBorder(borderRadius: BorderRadius.circular(22)), contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10)),
            )),
          ),
          const SizedBox(width: 8),
          IconButton.filled(onPressed: _sending ? null : _send, icon: _sending ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.send, size: 20)),
        ]),
      ),
    );
  }
}

/// 대화방 목록 최신 순(마지막 대화 시각, 날짜 포함).
void sortRoomsNewest(List<MsgRoom> rooms) => rooms.sort((a, b) => b.lastChatTimeStamp.compareTo(a.lastChatTimeStamp));

/// 목록의 시각 — 오늘은 HH:mm, 어제는 '어제', 그 전은 M/D(KST). 시각만 보이면 어제 것이 오늘 것보다 늦어 보여 순서가 틀려 보였다.
String roomWhen(DateTime t, {DateTime? now}) {
  final k = t.toUtc().add(const Duration(hours: 9));
  final n = (now ?? DateTime.now()).toUtc().add(const Duration(hours: 9));
  final day = DateTime.utc(k.year, k.month, k.day), today = DateTime.utc(n.year, n.month, n.day);
  final diff = today.difference(day).inDays;
  if (diff <= 0) return _hhmm(t);
  if (diff == 1) return '어제';
  return '${k.month}/${k.day}';
}

String _hhmm(DateTime t) {
  final k = t.toUtc().add(const Duration(hours: 9));
  return '${k.hour.toString().padLeft(2, '0')}:${k.minute.toString().padLeft(2, '0')}';
}

/// 홈 대시보드용 아마란스 메신저 카드 — 안 읽은 방 우선, 상위 몇 개를 간단히 보여 주고 누르면 그 방으로.
/// 자격증명·세션 실패는 조용히 안내만 한다(토큰·비밀번호 노출 금지).
class MessengerDashboardCard extends ConsumerStatefulWidget {
  const MessengerDashboardCard({super.key, required this.onMore});
  final VoidCallback onMore; // '메신저 열기' → /gw/messenger
  @override
  ConsumerState<MessengerDashboardCard> createState() => _MessengerDashboardCardState();
}

class _MessengerDashboardCardState extends ConsumerState<MessengerDashboardCard> {
  late Future<List<MsgRoom>> _future;
  Map<String, String> _names = const {};

  @override
  void initState() {
    super.initState();
    ensureMessengerRealtime(ref);
    _future = _load();
  }

  Future<List<MsgRoom>> _load() async {
    final api = ref.read(messengerApiProvider);
    final rooms = await api.rooms();
    final my = ref.read(messengerClientProvider).session?.empSeq ?? '';
    final needing = {for (final r in rooms) if (r.roomType != '7' && r.rawTitle.isEmpty) ...r.unresolvedSeqs(my)};
    if (needing.isNotEmpty) {
      try {
        final names = await api.userNames(needing.toList());
        if (mounted) setState(() => _names = {..._names, ...names});
      } catch (_) {}
    }
    final favs = ref.read(messengerFavoritesProvider);
    rooms.sort((a, b) {
      final fa = favs.contains(a.roomId) ? 1 : 0, fb = favs.contains(b.roomId) ? 1 : 0; // 즐겨찾기 먼저
      if (fa != fb) return fb - fa;
      return b.lastChatTimeStamp.compareTo(a.lastChatTimeStamp); // 그다음 최신 대화(날짜까지) — 안 읽은 방도 시간 순서 안에서(빨간 숫자로 구분)
    });
    return rooms;
  }

  @override
  Widget build(BuildContext context) {
    final my = ref.read(messengerClientProvider).session?.empSeq ?? '';
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 6, 8),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            const WidgetTitle('아마란스 메신저'),
            const Spacer(),
            TextButton(onPressed: widget.onMore, child: const Text('메신저 열기', style: TextStyle(fontSize: 12))),
          ]),
          FutureBuilder<List<MsgRoom>>(
            future: _future,
            builder: (context, snap) {
              if (snap.connectionState != ConnectionState.done) {
                return const Padding(padding: EdgeInsets.all(16), child: Center(child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))));
              }
              if (snap.hasError) {
                final noCreds = snap.error is MessengerAuthException && (snap.error as MessengerAuthException).noCreds;
                return Padding(
                  padding: const EdgeInsets.fromLTRB(2, 10, 10, 10),
                  child: Text(noCreds ? '아마란스 연결이 필요합니다' : '메신저를 불러오지 못했습니다', style: TextStyle(fontSize: 12, color: Brand.faint)),
                );
              }
              final rooms = (snap.data ?? const []).take(6).toList();
              if (rooms.isEmpty) {
                return Padding(padding: const EdgeInsets.fromLTRB(2, 10, 10, 10), child: Text('대화가 없습니다', style: TextStyle(fontSize: 12, color: Brand.faint)));
              }
              return Column(children: [
                for (final r in rooms)
                  ListTile(
                    dense: true,
                    contentPadding: const EdgeInsets.only(right: 10),
                    leading: InitialBadge(r.titleWith(_names, my), size: 34, circle: true),
                    title: Text(r.titleWith(_names, my), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                    subtitle: Text(r.preview, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, color: Brand.muted)),
                    trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                      if (r.lastAt != null) Text(roomWhen(r.lastAt!), style: TextStyle(fontSize: 11, color: Brand.faint)),
                      if (r.unreadCount > 0) ...[
                        const SizedBox(height: 3),
                        Container(padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1), decoration: BoxDecoration(color: Brand.botViolet, borderRadius: BorderRadius.circular(9)), child: Text('${r.unreadCount}', style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w600))),
                      ],
                    ]),
                    onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => MessengerRoomScreen(room: r.withTitle(r.titleWith(_names, my))))).then((_) { if (mounted) setState(() { _future = _load(); }); }),
                  ),
              ]);
            },
          ),
        ]),
      ),
    );
  }
}

/// 홈 대시보드용 "상세" 메신저 패널 — 타일 안에 스코프 Navigator를 두어 대화방 목록 → 대화방까지
/// 위젯 안에서 오간다(전체 화면으로 안 나감). 간략 카드(MessengerDashboardCard)와 함께 제공.
class MessengerPanel extends StatelessWidget {
  const MessengerPanel({super.key});
  @override
  Widget build(BuildContext context) => ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: Material(
          color: Brand.surface,
          child: WidgetChrome(
            child: Navigator(
              onGenerateRoute: (_) => MaterialPageRoute(builder: (_) => const MessengerChatScreen(embedded: true)),
            ),
          ),
        ),
      );
}
