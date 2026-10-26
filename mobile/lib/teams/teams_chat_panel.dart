import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../api/client.dart';
import '../app/brand.dart';
import '../app/theme.dart';

/// 홈 대시보드 'Teams 채팅' 위젯 — 아마란스 메신저(대화) 위젯처럼 목록 → 대화방까지 위젯 안에서.
/// 서버 /api/teams/chat·/messages(본인 Microsoft 위임 토큰, 웹 /teams/chat과 같은 API)만 쓴다.
class TeamsChatPanel extends StatelessWidget {
  const TeamsChatPanel({super.key});
  @override
  Widget build(BuildContext context) => ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: Material(
          color: Brand.surface,
          child: WidgetChrome(child: HeroControllerScope.none(child: Navigator(onGenerateRoute: (_) => MaterialPageRoute(builder: (_) => const TeamsChatList())))),
        ),
      );
}

class TeamsChat {
  const TeamsChat(this.id, this.topic, this.group, this.at, {this.members = const []});
  final String id, topic;
  final bool group;
  final DateTime? at;
  final List<String> members; // 검색(대화방 이름·구성원)용
}

/// 메시지 검색 한 건 — 서버 /api/teams/chat/search(Microsoft Search 요약만, 본문 아님)
class TeamsHit {
  const TeamsHit(this.id, this.chatId, this.from, this.snippet, this.at);
  final String id, chatId, from, snippet;
  final DateTime? at;
}

/// 메시지 반응(종류별 묶음) — type은 Graph 원래 값(떼기에 그대로), emoji는 표시용. 서버 lib/teams/chat.ts normalizeReactions와 같은 모양
class TeamsReaction {
  const TeamsReaction(this.type, this.emoji, this.userIds, this.names);
  final String type, emoji;
  final List<String> userIds, names;
}

/// 고르는 반응 — 웹·서버와 같은 12개(Teams 기본 6 + 자주 쓰는 6, 조직 스티커는 Graph가 붙이기를 받지 않음)
const teamsReactionChoices = ['👍', '❤️', '😆', '😮', '😢', '😡', '👀', '👏', '🙌', '🔥', '🎉', '🙏'];

/// 내 반응 하나를 붙이거나 뗀 결과(응답 전에 먼저 보여 주고 5초 폴링이 실제 상태로 맞춘다)
List<TeamsReaction> toggleTeamsReaction(List<TeamsReaction> list, String type, String emoji, String me, bool on) {
  final out = [
    for (final r in list)
      if (r.type == type) TeamsReaction(r.type, r.emoji, [for (final u in r.userIds) if (u != me) u], [for (var i = 0; i < r.userIds.length; i++) if (r.userIds[i] != me) r.names[i]]) else r,
  ];
  if (on) {
    final i = out.indexWhere((r) => r.type == type);
    if (i >= 0) {
      out[i] = TeamsReaction(type, out[i].emoji, [...out[i].userIds, me], [...out[i].names, '나']);
    } else {
      out.add(TeamsReaction(type, emoji, [me], const ['나']));
    }
  }
  return [for (final r in out) if (r.userIds.isNotEmpty) r];
}

class TeamsMsg {
  const TeamsMsg(this.id, this.fromId, this.fromName, this.text, this.at, this.files, [this.reactions = const [], this.markdown = '']);
  final String id, fromId, fromName, text;
  /// 원문 서식(문단·굵게·목록·링크·멘션) — 서버가 Teams HTML을 이스케이프한 마크다운으로 바꿔 준다. 비면 text
  final String markdown;
  final DateTime? at;
  final List<(String, String?)> files; // (이름, 주소)
  final List<TeamsReaction> reactions;
  TeamsMsg withReactions(List<TeamsReaction> r) => TeamsMsg(id, fromId, fromName, text, at, files, r, markdown);
  static TeamsMsg? fromJson(Object? j) {
    if (j is! Map || j['id'] == null) return null;
    final from = j['from'];
    return TeamsMsg(
      '${j['id']}',
      from is Map ? '${from['id'] ?? ''}' : '',
      from is Map ? '${from['name'] ?? ''}' : '',
      '${j['text'] ?? ''}'.trim(),
      DateTime.tryParse('${j['createdAt'] ?? ''}'),
      [for (final a in j['attachments'] is List ? j['attachments'] as List : const []) if (a is Map) ('${a['name'] ?? '첨부'}', a['url'] is String ? a['url'] as String : null)],
      [
        for (final r in j['reactions'] is List ? j['reactions'] as List : const [])
          if (r is Map && r['type'] is String)
            TeamsReaction('${r['type']}', '${r['emoji'] ?? r['type']}', [for (final u in r['users'] is List ? r['users'] as List : const []) if (u is Map) '${u['id'] ?? ''}'], [for (final u in r['users'] is List ? r['users'] as List : const []) if (u is Map) '${u['name'] ?? ''}']),
      ],
      j['markdown'] is String ? (j['markdown'] as String).trim() : '',
    );
  }
}

String _kst(DateTime t, {bool dateIfOld = false}) {
  final k = t.toUtc().add(const Duration(hours: 9));
  final now = DateTime.now().toUtc().add(const Duration(hours: 9));
  final hm = '${k.hour.toString().padLeft(2, '0')}:${k.minute.toString().padLeft(2, '0')}';
  if (!dateIfOld || (k.year == now.year && k.month == now.month && k.day == now.day)) return hm;
  return '${k.month}/${k.day}';
}

String _err(Object e) => e is ApiException ? e.message : '$e';

class TeamsChatList extends ConsumerStatefulWidget {
  const TeamsChatList({super.key});
  @override
  ConsumerState<TeamsChatList> createState() => _TeamsChatListState();
}

class _TeamsChatListState extends ConsumerState<TeamsChatList> {
  late Future<({String? meId, List<TeamsChat> chats, bool ready})> _future = _load();

  Future<({String? meId, List<TeamsChat> chats, bool ready})> _load() async {
    final j = await ref.read(apiClientProvider).getJson('/api/teams/chat');
    if (j is! Map || j['hasChatScope'] != true) return (meId: null, chats: <TeamsChat>[], ready: false);
    final chats = [
      for (final x in j['chats'] is List ? j['chats'] as List : const [])
        if (x is Map) TeamsChat('${x['id']}', '${x['topic'] ?? ''}', x['type'] == 'group', DateTime.tryParse('${x['lastUpdated'] ?? ''}'), members: [for (final n in x['members'] is List ? x['members'] as List : const []) '$n']),
    ];
    return (meId: j['meId'] as String?, chats: chats, ready: true);
  }

  Future<void> _refresh() async {
    setState(() { _future = _load(); });
    await _future.catchError((_) => (meId: null, chats: <TeamsChat>[], ready: true));
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: BrandHeader(compact: WidgetChrome.of(context), title: 'Teams 채팅', onRefresh: _refresh, actions: [
          // 앱 메신저 위젯과 같은 자리·같은 검색 화면 구성
          IconButton(
            icon: const Icon(Icons.search),
            tooltip: '검색',
            onPressed: () async {
              final d = await _future.catchError((_) => (meId: null, chats: <TeamsChat>[], ready: false));
              if (!context.mounted) return;
              await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => TeamsSearchScreen(chats: d.chats, meId: d.meId ?? '')));
              if (mounted) await _refresh();
            },
          ),
        ]),
        body: FutureBuilder(
          future: _future,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting && !snap.hasData) return const Center(child: CircularProgressIndicator());
            if (snap.hasError) return Center(child: Padding(padding: const EdgeInsets.all(24), child: Text('불러오지 못했습니다: ${_err(snap.error!)}', textAlign: TextAlign.center)));
            final d = snap.data!;
            if (!d.ready) return Center(child: Padding(padding: const EdgeInsets.all(24), child: Text('웹 설정에서 Microsoft 계정을 연결(채팅 권한 포함)하면 Teams 채팅을 볼 수 있습니다.', textAlign: TextAlign.center, style: TextStyle(color: Brand.muted))));
            if (d.chats.isEmpty) return Center(child: Text('채팅이 없습니다', style: TextStyle(color: Brand.muted)));
            return ListView.separated(
              itemCount: d.chats.length,
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (_, i) {
                final c = d.chats[i];
                return ListTile(
                  dense: true, // 다른 위젯과 같은 글꼴
                  leading: Icon(c.group ? Icons.groups_outlined : Icons.person_outline, color: Brand.faint),
                  title: Text(c.topic.isEmpty ? '(제목 없음)' : c.topic, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                  trailing: c.at == null ? null : Text(_kst(c.at!, dateIfOld: true), style: TextStyle(fontSize: 12, color: Brand.muted)),
                  onTap: () async {
                    await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => TeamsChatRoom(chat: c, meId: d.meId ?? '')));
                    if (mounted) await _refresh(); // 보낸 대화가 위로 오도록
                  },
                );
              },
            );
          },
        ),
      );
}

class TeamsChatRoom extends ConsumerStatefulWidget {
  const TeamsChatRoom({super.key, required this.chat, required this.meId, this.focusMsgId});
  final TeamsChat chat;
  final String meId;
  final String? focusMsgId; // 검색에서 고른 메시지 — 처음 한 번 그 자리로 옮기고 형광 노랑
  @override
  ConsumerState<TeamsChatRoom> createState() => _TeamsChatRoomState();
}

class _TeamsChatRoomState extends ConsumerState<TeamsChatRoom> {
  final _input = TextEditingController();
  List<TeamsMsg>? _msgs; // 오래된 것부터
  Object? _error;
  bool _sending = false;
  Timer? _poll;
  final _focusKey = GlobalKey();
  bool _focused = false;

  ApiClient get _api => ref.read(apiClientProvider);

  @override
  void initState() {
    super.initState();
    _load();
    _poll = Timer.periodic(const Duration(seconds: 5), (_) => _load(since: true)); // 웹 /teams/chat과 같은 5초 폴링
  }

  @override
  void dispose() {
    _poll?.cancel();
    _input.dispose();
    super.dispose();
  }

  Future<void> _load({bool since = false}) async {
    final last = since ? _msgs?.map((m) => m.at).whereType<DateTime>().fold<DateTime?>(null, (a, b) => a == null || b.isAfter(a) ? b : a) : null;
    if (since && last == null) since = false; // 빈 채팅·첫 로드 실패면 기준이 없으니 전체를 다시 읽는다(첫 메시지·복구도 반영)
    try {
      final j = await _api.getJson('/api/teams/chat/messages', query: {'chat': widget.chat.id, if (last != null) 'since': last.toUtc().toIso8601String()});
      final got = [for (final x in j is Map && j['messages'] is List ? j['messages'] as List : const []) ?TeamsMsg.fromJson(x)];
      if (!mounted) return;
      setState(() {
        _error = null;
        if (!since) {
          _msgs = got;
        } else if (got.isNotEmpty) {
          final byId = {for (final m in _msgs ?? const <TeamsMsg>[]) m.id: m, for (final m in got) m.id: m}; // 수정된 메시지는 갈아끼움
          _msgs = byId.values.toList()..sort((a, b) => (a.at ?? DateTime(0)).compareTo(b.at ?? DateTime(0)));
        }
      });
      if (widget.focusMsgId != null && !_focused) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          final ctx = _focusKey.currentContext;
          if (ctx != null) {
            _focused = true;
            Scrollable.ensureVisible(ctx, alignment: 0.5, duration: const Duration(milliseconds: 300));
          }
        });
      }
    } catch (e) {
      if (mounted && !since) setState(() => _error = e); // 폴링 실패는 조용히(다음 회차에 다시)
    }
  }

  /// 반응 붙이기·떼기 — 먼저 화면에 반영하고, 실패하면 되돌린다
  Future<void> _react(TeamsMsg m, String type, String emoji, bool on) async {
    // 실패하면 요청 전 상태로(뒤집기 대신 — 그사이 폴링으로 바뀐 상태를 틀지 않게)
    final before = (_msgs ?? const <TeamsMsg>[]).where((x) => x.id == m.id).firstOrNull?.reactions ?? const <TeamsReaction>[];
    void set(List<TeamsReaction> Function(TeamsMsg x) f) => setState(() {
          _msgs = [for (final x in _msgs ?? const <TeamsMsg>[]) x.id == m.id ? x.withReactions(f(x)) : x];
        });
    set((x) => toggleTeamsReaction(x.reactions, type, emoji, widget.meId, on));
    try {
      await _api.postJson('/api/teams/chat/reaction', {'chat': widget.chat.id, 'message': m.id, 'reaction': type, 'on': on});
    } catch (e) {
      if (!mounted) return;
      set((_) => before);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('반응을 ${on ? '붙이지' : '떼지'} 못했습니다: ${_err(e)}')));
    }
  }

  /// 😊+ 단추 바로 옆에 붙는 작은 고르기 창(6칸 × 2줄, 칸 28px) — 아래 시트는 위젯에서 너무 컸다
  Future<void> _pickReaction(TeamsMsg m, BuildContext anchor) async {
    final box = anchor.findRenderObject() as RenderBox?;
    final screen = MediaQuery.sizeOf(context);
    final at = box == null ? Offset.zero : box.localToGlobal(Offset.zero);
    const cell = 28.0, w = cell * 6 + 8, h = cell * 2 + 8;
    final left = (at.dx + (box?.size.width ?? 0) / 2 - w / 2).clamp(4.0, screen.width - w - 4);
    final top = at.dy - h - 2 < 4 ? at.dy + (box?.size.height ?? 0) + 2 : at.dy - h - 2; // 위에 붙이고, 자리가 없으면 아래
    final picked = await showDialog<String>(
      context: context,
      barrierColor: Colors.transparent,
      builder: (ctx) => Stack(children: [
        Positioned(
          left: left,
          top: top,
          child: Material(
            elevation: 4,
            color: Brand.surface,
            borderRadius: BorderRadius.circular(8),
            child: Padding(
              padding: const EdgeInsets.all(4),
              child: SizedBox(
                width: cell * 6,
                child: Wrap(children: [
                  for (final e in teamsReactionChoices)
                    InkWell(
                      borderRadius: BorderRadius.circular(6),
                      onTap: () => Navigator.of(ctx).pop(e),
                      child: SizedBox(width: cell, height: cell, child: Center(child: Text(e, style: const TextStyle(fontSize: 17)))),
                    ),
                ]),
              ),
            ),
          ),
        ),
      ]),
    );
    if (picked == null || !mounted) return;
    // 같은 그림이 옛 이름(like)·유니코드 두 묶음일 수 있다 — 떼기는 내가 붙인 묶음의 값으로
    final same = [for (final r in m.reactions) if (r.emoji == picked && r.type != 'custom') r];
    final mine = same.where((r) => r.userIds.contains(widget.meId)).firstOrNull;
    await _react(m, (mine ?? same.firstOrNull)?.type ?? picked, picked, mine == null);
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await _api.postJson('/api/teams/chat/messages', {'chat': widget.chat.id, 'text': text});
      _input.clear();
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('보내지 못했습니다: ${_err(e)}')));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final msgs = _msgs;
    return Scaffold(
      appBar: BrandHeader(compact: WidgetChrome.of(context), title: widget.chat.topic.isEmpty ? '(제목 없음)' : widget.chat.topic, showBack: true, onRefresh: _load),
      body: Column(children: [
        Expanded(
          child: _error != null && msgs == null
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text('불러오지 못했습니다: ${_err(_error!)}', textAlign: TextAlign.center)))
              : msgs == null
                  ? const Center(child: CircularProgressIndicator())
                  : msgs.isEmpty
                      ? Center(child: Text('대화가 없습니다', style: TextStyle(color: Brand.muted)))
                      : SelectionArea(child: _list(msgs)),
        ),
        _composer(),
      ]),
    );
  }

  /// 맨 아래(최신)부터. 찾아갈 메시지가 있으면 모든 줄을 미리 그린다 — 화면 밖 줄은 그려지지 않아 그 자리로 옮길 수 없다(메신저와 같은 방식)
  Widget _list(List<TeamsMsg> msgs) {
    Widget item(int i) {
      final m = msgs[msgs.length - 1 - i];
      final prev = msgs.length - 2 - i < 0 ? null : msgs[msgs.length - 2 - i];
      final mine = m.fromId.isNotEmpty && m.fromId == widget.meId;
      final sameAuthor = prev != null && prev.fromId == m.fromId;
      final focus = widget.focusMsgId != null && m.id == widget.focusMsgId;
      final row = LayoutBuilder(builder: (context, box) => _bubble(m, mine, !mine && !sameAuthor, box.maxWidth * 0.8));
      return focus ? DecoratedBox(key: _focusKey, decoration: BoxDecoration(color: const Color(0xFFFFE58F), borderRadius: BorderRadius.circular(8)), child: row) : row;
    }
    return widget.focusMsgId != null
        ? SingleChildScrollView(reverse: true, padding: const EdgeInsets.all(12), child: Column(children: [for (var i = msgs.length - 1; i >= 0; i--) item(i)]))
        : ListView.builder(reverse: true, padding: const EdgeInsets.all(12), itemCount: msgs.length, itemBuilder: (_, i) => item(i));
  }

  /// 원문 서식 — 글 선택은 바깥 SelectionArea가 맡는다. 이미지는 불러오지 않고, 링크는 http(s)·mailto만 바깥 앱으로
  Widget _markdown(String data, Color fg) {
    final base = TextStyle(color: fg, height: 1.4, fontSize: 14);
    return MarkdownBody(
      data: data,
      styleSheet: MarkdownStyleSheet(
        p: base,
        listBullet: base,
        strong: const TextStyle(fontWeight: FontWeight.w700),
        code: base.copyWith(fontFamily: 'monospace', fontSize: 13, backgroundColor: fg.withValues(alpha: 0.12)),
        codeblockDecoration: BoxDecoration(color: fg.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(6)),
        a: base.copyWith(decoration: TextDecoration.underline),
        blockSpacing: 6,
      ),
      imageBuilder: (_, _, alt) => Text('[이미지${alt == null || alt.isEmpty ? '' : ': $alt'}]', style: base),
      onTapLink: (_, href, _) {
        final u = href == null ? null : Uri.tryParse(href);
        if (u != null && (u.scheme == 'https' || u.scheme == 'http' || u.scheme == 'mailto')) launchUrl(u, mode: LaunchMode.externalApplication);
      },
    );
  }

  Widget _bubble(TeamsMsg m, bool mine, bool showName, double maxW) {
    final fg = mine ? Colors.white : Brand.navy;
    final bubble = Container(
      margin: const EdgeInsets.symmetric(vertical: 2),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      constraints: BoxConstraints(maxWidth: maxW),
      decoration: BoxDecoration(color: mine ? Brand.botViolet : Brand.blueTint, borderRadius: BorderRadius.circular(14)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        if (m.markdown.isNotEmpty) _markdown(m.markdown, fg) else if (m.text.isNotEmpty) Text(m.text, style: TextStyle(color: fg, height: 1.4)),
        for (final (name, url) in m.files)
          InkWell(
            onTap: url == null ? null : () => launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication),
            child: Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Icon(Icons.attach_file, size: 14, color: fg),
                Flexible(child: Text(name, style: TextStyle(color: fg, decoration: url == null ? null : TextDecoration.underline))),
              ]),
            ),
          ),
        if (m.text.isEmpty && m.files.isEmpty) Text('(내용 없음)', style: TextStyle(color: fg, fontStyle: FontStyle.italic)),
      ]),
    );
    final stamp = Column(mainAxisSize: MainAxisSize.min, children: [
      // 반응 붙이기 — 글자 선택(SelectionArea)과 겹치지 않게 길게 누르기 대신 작은 단추
      Builder(builder: (anchor) => IconButton(
        onPressed: () => _pickReaction(m, anchor),
        tooltip: '반응 붙이기',
        iconSize: 16,
        padding: EdgeInsets.zero,
        constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
        icon: Icon(Icons.add_reaction_outlined, color: Brand.faint),
      )),
      Padding(padding: const EdgeInsets.only(bottom: 2), child: Text(m.at == null ? '' : _kst(m.at!, dateIfOld: true), style: TextStyle(fontSize: 10, color: Brand.faint))),
    ]);
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Column(crossAxisAlignment: mine ? CrossAxisAlignment.end : CrossAxisAlignment.start, children: [
        if (showName && m.fromName.isNotEmpty) Padding(padding: const EdgeInsets.only(left: 4, top: 6), child: Text(m.fromName, style: TextStyle(fontSize: 11, color: Brand.muted))),
        Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: mine ? [stamp, const SizedBox(width: 4), Flexible(child: bubble)] : [Flexible(child: bubble), const SizedBox(width: 4), stamp],
        ),
        if (m.reactions.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 2, bottom: 4),
            child: Wrap(spacing: 4, runSpacing: 4, children: [
              for (final r in m.reactions) _reactionChip(m, r),
            ]),
          ),
      ]),
    );
  }

  Widget _reactionChip(TeamsMsg m, TeamsReaction r) {
    final minePick = r.userIds.contains(widget.meId);
    final names = [for (var i = 0; i < r.userIds.length; i++) r.userIds[i] == widget.meId ? '나' : r.names[i]].where((n) => n.isNotEmpty).join(', ');
    final chip = InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: r.type == 'custom' ? null : () => _react(m, r.type, r.emoji, !minePick), // 남의 반응을 누르면 같이 붙이고, 내 것이면 뗀다(Teams와 같다). 조직 사용자 정의 반응은 보기만
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(
          color: minePick ? Brand.blueTint : Brand.surface,
          border: Border.all(color: minePick ? Brand.blue : Brand.line),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text('${r.emoji} ${r.userIds.length}', style: TextStyle(fontSize: 12, color: Brand.navy)),
      ),
    );
    return Semantics(button: r.type != 'custom', label: '${r.emoji} ${r.userIds.length}명', child: names.isEmpty ? chip : Tooltip(message: names, child: chip));
  }

  Widget _composer() => SafeArea(
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
                onEditingComplete: () {}, // 보낸 뒤에도 입력창 포커스 유지
                decoration: InputDecoration(hintText: '메시지', border: OutlineInputBorder(borderRadius: BorderRadius.circular(22)), contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10)),
              ),
            ),
            const SizedBox(width: 8),
            IconButton.filled(onPressed: _sending ? null : _send, icon: _sending ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.send, size: 20)),
          ]),
        ),
      );
}

/// Teams 검색 — 앱 메신저 검색(MessengerSearchScreen)과 같은 구성: 대화방(이름·구성원, 내 최근 채팅 목록에서) + 대화 내용(서버 Microsoft 검색).
/// 대화 내용은 2자부터. 검색 권한이 없는 연결이면 서버가 '다시 연결' 안내 문구를 돌려준다(웹 설정 → Microsoft 계정 다시 연결).
class TeamsSearchScreen extends ConsumerStatefulWidget {
  const TeamsSearchScreen({super.key, required this.chats, required this.meId});
  final List<TeamsChat> chats;
  final String meId;
  @override
  ConsumerState<TeamsSearchScreen> createState() => _TeamsSearchScreenState();
}

class _TeamsSearchScreenState extends ConsumerState<TeamsSearchScreen> {
  final _q = TextEditingController();
  String? _word;
  Future<List<TeamsHit>>? _future;

  @override
  void dispose() {
    _q.dispose();
    super.dispose();
  }

  void _run() {
    final word = _q.text.trim();
    if (word.isEmpty) return;
    setState(() {
      _word = word;
      _future = word.length < 2 ? Future.value(const <TeamsHit>[]) : _search(word);
    });
  }

  Future<List<TeamsHit>> _search(String word) async {
    final j = await ref.read(apiClientProvider).getJson('/api/teams/chat/search', query: {'q': word});
    return [
      for (final x in j is Map && j['hits'] is List ? j['hits'] as List : const [])
        if (x is Map) TeamsHit('${x['id'] ?? ''}', '${x['chatId'] ?? ''}', '${x['from'] ?? ''}', '${x['snippet'] ?? ''}', DateTime.tryParse('${x['createdAt'] ?? ''}')),
    ];
  }

  TeamsChat? _chat(String id) {
    for (final c in widget.chats) {
      if (c.id == id) return c;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: BrandHeader(compact: WidgetChrome.of(context), title: 'Teams 검색', showBack: true),
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
          Expanded(child: _results()),
        ]),
      );

  Widget _results() {
    final word = _word;
    final f = _future;
    if (word == null || f == null) return Center(child: Text('검색어를 입력하세요', style: TextStyle(color: Brand.muted)));
    final needle = word.toLowerCase();
    final rooms = [for (final c in widget.chats) if (c.topic.toLowerCase().contains(needle) || c.members.any((n) => n.toLowerCase().contains(needle))) c];
    return FutureBuilder<List<TeamsHit>>(
      future: f,
      builder: (context, snap) {
        final waiting = snap.connectionState == ConnectionState.waiting && !snap.hasData;
        final hits = snap.data ?? const <TeamsHit>[];
        if (!waiting && !snap.hasError && rooms.isEmpty && hits.isEmpty) {
          return Center(child: Text(word.length < 2 ? '결과가 없습니다 (대화 내용은 2자 이상으로 찾습니다)' : '결과가 없습니다', style: TextStyle(color: Brand.muted)));
        }
        return ListView(children: [
          if (rooms.isNotEmpty) ...[
            _header('대화방 ${rooms.length}'),
            for (final c in rooms)
              _row(
                title: c.topic.isEmpty ? '(제목 없음)' : c.topic,
                body: Text(c.group ? '${c.members.length}명 · ${c.members.join(', ')}' : '1:1', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13, color: Brand.muted)),
                onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => TeamsChatRoom(chat: c, meId: widget.meId))),
              ),
          ],
          if (waiting) const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())),
          if (snap.hasError) Padding(padding: const EdgeInsets.fromLTRB(16, 16, 16, 4), child: Text(_err(snap.error!), style: TextStyle(fontSize: 13, color: Brand.danger))),
          if (hits.isNotEmpty) ...[
            _header('대화 내용 ${hits.length}'),
            for (final h in hits)
              _row(
                title: _chat(h.chatId)?.topic ?? '최근 50개 밖의 대화',
                body: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                  Text(h.snippet.isEmpty ? '(요약 없음)' : h.snippet, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13)),
                  Text([if (h.from.isNotEmpty) h.from, if (h.at != null) '${h.at!.toUtc().add(const Duration(hours: 9))}'.substring(0, 16), if (_chat(h.chatId) == null) 'Teams에서 확인'].join(' · '), style: TextStyle(fontSize: 11, color: Brand.muted)),
                ]),
                onTap: _chat(h.chatId) == null ? null : () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => TeamsChatRoom(chat: _chat(h.chatId)!, meId: widget.meId, focusMsgId: h.id))),
              ),
          ],
        ]);
      },
    );
  }

  /// 결과 한 줄 — 왼쪽 칸 방 제목(고정 폭), 오른쪽 칸 내용(메신저 검색과 같다)
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
