import 'package:flutter/material.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'gw_api.dart';
import 'gw_gate.dart';
import 'gw_models.dart';

/// 게시판: 전 게시판 공지·새 글 집계 목록(검색·더 보기) → 본문·댓글. 읽기 전용.
class BoardScreen extends StatelessWidget {
  const BoardScreen({super.key, this.initialArt});

  /// 홈 공지 카드에서 바로 열 글 번호.
  final String? initialArt;
  @override
  Widget build(BuildContext context) => GwGate(title: '게시판', builder: (_, api) => _Body(api, initialArt: initialArt));
}

class _Body extends StatefulWidget {
  const _Body(this.api, {this.initialArt});
  final GwApi api;
  final String? initialArt;
  @override
  State<_Body> createState() => _BodyState();
}

class _BodyState extends State<_Body> {
  final _items = <GwNotice>[];
  final _search = TextEditingController();
  int _total = 0, _page = 0;
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load(reset: true);
    final art = widget.initialArt;
    if (art != null && art.isNotEmpty) WidgetsBinding.instance.addPostFrameCallback((_) => _openDetail(art, title: ''));
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load({required bool reset}) async {
    if (_loading) return;
    setState(() { _loading = true; _error = null; if (reset) { _items.clear(); _page = 0; } });
    try {
      final (total, list) = await widget.api.notices(page: _page + 1, pageSize: 20, search: _search.text.trim());
      if (!mounted) return;
      setState(() { _total = total; _page += 1; _items.addAll(list); });
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _openDetail(String artSeqNo, {required String title}) {
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => _DetailPage(widget.api, artSeqNo: artSeqNo, fallbackTitle: title)));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: const BrandHeader(title: '게시판', showBack: true),
      body: RefreshIndicator(
        onRefresh: () => _load(reset: true),
        child: ListView(padding: const EdgeInsets.fromLTRB(20, 4, 20, 24), children: [
          TextField(
            controller: _search,
            decoration: InputDecoration(hintText: '제목·본문·작성자 검색', prefixIcon: const Icon(Icons.search, size: 20), suffixIcon: _search.text.isEmpty ? null : IconButton(icon: const Icon(Icons.close, size: 18), onPressed: () { _search.clear(); _load(reset: true); })),
            textInputAction: TextInputAction.search,
            onSubmitted: (_) => _load(reset: true),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 10),
          Padding(padding: const EdgeInsets.only(left: 4, bottom: 6), child: CountTitle('글', _total)),
          if (_error != null) Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(children: [Text(_error!, style: const TextStyle(color: Brand.dangerText)), const SizedBox(height: 8), FilledButton(onPressed: () => _load(reset: true), child: const Text('다시 시도'))])))
          else if (_items.isEmpty && _loading) const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator()))
          else if (_items.isEmpty) const Padding(padding: EdgeInsets.all(40), child: Center(child: Text('글이 없습니다', style: TextStyle(color: Brand.muted))))
          else ...[
            for (final n in _items) Card(child: ListTile(
              onTap: () => _openDetail(n.artSeqNo, title: n.title),
              title: Row(children: [
                Container(padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2), decoration: BoxDecoration(color: Brand.tintFor(n.board), borderRadius: BorderRadius.circular(6)), child: Text(n.board.isEmpty ? '게시판' : n.board, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Brand.navy))),
                const SizedBox(width: 8),
                Expanded(child: Text(n.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: n.read ? FontWeight.w600 : FontWeight.w800))),
                if (n.fileCnt > 0) const Icon(Icons.attach_file, size: 14, color: Brand.faint),
              ]),
              subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                if (n.preview.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Text(n.preview, maxLines: 1, overflow: TextOverflow.ellipsis)),
                Padding(padding: const EdgeInsets.only(top: 2), child: Text([n.writer, if (n.dept.isNotEmpty) n.dept, n.writeDate, '조회 ${n.readCnt}'].where((s) => s.isNotEmpty).join(' · '), style: theme.textTheme.bodySmall?.copyWith(fontSize: 11))),
              ]),
            )),
            if (_items.length < _total) Padding(padding: const EdgeInsets.only(top: 8), child: OutlinedButton(onPressed: _loading ? null : () => _load(reset: false), child: Text(_loading ? '불러오는 중…' : '더 보기 (${_items.length}/$_total)'))),
          ],
        ]),
      ),
    );
  }
}

class _DetailPage extends StatelessWidget {
  const _DetailPage(this.api, {required this.artSeqNo, required this.fallbackTitle});
  final GwApi api;
  final String artSeqNo, fallbackTitle;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: const BrandHeader(title: '게시글', showBack: true),
      body: FutureBuilder(
        future: api.notice(artSeqNo),
        builder: (context, snap) {
          if (snap.hasError) return Center(child: Padding(padding: const EdgeInsets.all(24), child: Text('불러오지 못했습니다: ${snap.error}', style: const TextStyle(color: Brand.dangerText))));
          final d = snap.data;
          if (d == null) return const Center(child: CircularProgressIndicator());
          return ListView(padding: const EdgeInsets.fromLTRB(20, 4, 20, 32), children: [
            if (d.board.isNotEmpty) Text(d.board, style: theme.textTheme.bodySmall?.copyWith(color: Brand.blue, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text(d.title.isEmpty ? fallbackTitle : d.title, style: theme.textTheme.headlineSmall),
            const SizedBox(height: 6),
            Text([d.writer, if (d.dept.isNotEmpty) d.dept, d.writeDate, '조회 ${d.readCnt}', if (d.fileCnt > 0) '첨부 ${d.fileCnt}'].where((s) => s.isNotEmpty).join(' · '), style: theme.textTheme.bodySmall),
            const Divider(height: 24),
            SelectableText(d.content.isEmpty ? '(본문 없음)' : d.content, style: const TextStyle(fontSize: 15, height: 1.65, color: Brand.navy)),
            if (d.fileCnt > 0) Padding(padding: const EdgeInsets.only(top: 16), child: Container(padding: const EdgeInsets.all(12), decoration: BoxDecoration(color: Brand.blueTint, borderRadius: BorderRadius.circular(12)), child: Text('첨부 ${d.fileCnt}건은 아마란스에서 내려받으세요.', style: theme.textTheme.bodySmall?.copyWith(color: Brand.navy)))),
            if (d.comments.isNotEmpty) ...[
              const SizedBox(height: 20),
              CountTitle('댓글', d.comments.length),
              const SizedBox(height: 8),
              Card(child: Column(children: [
                for (final (i, c) in d.comments.indexed) ...[
                  if (i > 0) const Divider(height: 1),
                  ListTile(dense: true, leading: InitialBadge(c.writer, size: 32, circle: true), title: Text(c.content), subtitle: Text('${c.writer}${c.writeDate.isEmpty ? '' : ' · ${c.writeDate}'}')),
                ],
              ])),
            ],
          ]);
        },
      ),
    );
  }
}
