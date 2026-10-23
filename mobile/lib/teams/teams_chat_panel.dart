import 'dart:async';
import 'package:flutter/material.dart';
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
  const TeamsChat(this.id, this.topic, this.group, this.at);
  final String id, topic;
  final bool group;
  final DateTime? at;
}

class TeamsMsg {
  const TeamsMsg(this.id, this.fromId, this.fromName, this.text, this.at, this.files);
  final String id, fromId, fromName, text;
  final DateTime? at;
  final List<(String, String?)> files; // (이름, 주소)
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
        if (x is Map) TeamsChat('${x['id']}', '${x['topic'] ?? ''}', x['type'] == 'group', DateTime.tryParse('${x['lastUpdated'] ?? ''}')),
    ];
    return (meId: j['meId'] as String?, chats: chats, ready: true);
  }

  Future<void> _refresh() async {
    setState(() { _future = _load(); });
    await _future.catchError((_) => (meId: null, chats: <TeamsChat>[], ready: true));
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: BrandHeader(compact: WidgetChrome.of(context), title: 'Teams 채팅', onRefresh: _refresh),
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
  const TeamsChatRoom({super.key, required this.chat, required this.meId});
  final TeamsChat chat;
  final String meId;
  @override
  ConsumerState<TeamsChatRoom> createState() => _TeamsChatRoomState();
}

class _TeamsChatRoomState extends ConsumerState<TeamsChatRoom> {
  final _input = TextEditingController();
  List<TeamsMsg>? _msgs; // 오래된 것부터
  Object? _error;
  bool _sending = false;
  Timer? _poll;

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
    } catch (e) {
      if (mounted && !since) setState(() => _error = e); // 폴링 실패는 조용히(다음 회차에 다시)
    }
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
                      : SelectionArea(
                          child: ListView.builder(
                            reverse: true, // 맨 아래(최신)부터
                            padding: const EdgeInsets.all(12),
                            itemCount: msgs.length,
                            itemBuilder: (_, i) {
                              final m = msgs[msgs.length - 1 - i];
                              final prev = msgs.length - 2 - i < 0 ? null : msgs[msgs.length - 2 - i];
                              final mine = m.fromId.isNotEmpty && m.fromId == widget.meId;
                              final sameAuthor = prev != null && prev.fromId == m.fromId;
                              return LayoutBuilder(builder: (context, box) => _bubble(m, mine, !mine && !sameAuthor, box.maxWidth * 0.8));
                            },
                          ),
                        ),
        ),
        _composer(),
      ]),
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
        if (m.text.isNotEmpty) Text(m.text, style: TextStyle(color: fg, height: 1.4)),
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
    final stamp = Padding(padding: const EdgeInsets.only(bottom: 2), child: Text(m.at == null ? '' : _kst(m.at!, dateIfOld: true), style: TextStyle(fontSize: 10, color: Brand.faint)));
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Column(crossAxisAlignment: mine ? CrossAxisAlignment.end : CrossAxisAlignment.start, children: [
        if (showName && m.fromName.isNotEmpty) Padding(padding: const EdgeInsets.only(left: 4, top: 6), child: Text(m.fromName, style: TextStyle(fontSize: 11, color: Brand.muted))),
        Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: mine ? [stamp, const SizedBox(width: 4), Flexible(child: bubble)] : [Flexible(child: bubble), const SizedBox(width: 4), stamp],
        ),
      ]),
    );
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
