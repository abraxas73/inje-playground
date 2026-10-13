import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'gw_api.dart';
import 'gw_models.dart';
import 'mail_detail_screen.dart';
import 'mail_index.dart';
import 'mail_indexer.dart';

/// 메일 검색 — 기기 안 색인(`mail_index.dart`)을 검색식으로 찾는다. 결과를 누르면 본문 화면(열면 아마란스에서 읽음 처리).
class MailSearchScreen extends ConsumerStatefulWidget {
  const MailSearchScreen({super.key, required this.api});
  final GwApi api;
  @override
  ConsumerState<MailSearchScreen> createState() => _MailSearchScreenState();
}

class _MailSearchScreenState extends ConsumerState<MailSearchScreen> {
  final _ctl = TextEditingController();
  Timer? _debounce;
  List<MailHit> _hits = const [];
  bool _byRelevance = false;

  @override
  void initState() {
    super.initState();
    unawaited(ref.read(mailIndexProvider.notifier).ensureLoaded(widget.api).then((_) => _run()));
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _ctl.dispose();
    super.dispose();
  }

  void _run() {
    if (!mounted) return;
    setState(() => _hits = ref.read(mailIndexProvider.notifier).search(_ctl.text, byRelevance: _byRelevance));
  }

  void _changed(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 250), _run);
  }

  void _append(String token) {
    final t = _ctl.text.trimRight();
    if (t.split(' ').contains(token)) return;
    _ctl.text = t.isEmpty ? token : '$t $token';
    _ctl.selection = TextSelection.collapsed(offset: _ctl.text.length);
    _run();
  }

  Future<void> _open(MailDoc d) async {
    await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => MailDetailScreen(api: widget.api, item: d.toItem())));
    _run();
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(mailIndexProvider, (p, n) {
      if (p?.rev != n.rev) _run(); // 동기화로 색인이 바뀌면 결과 갱신
    });
    final st = ref.watch(mailIndexProvider);
    final notifier = ref.read(mailIndexProvider.notifier);
    final ym = kstNow();
    return Scaffold(
      appBar: BrandHeader(title: '메일 검색', showBack: true, actions: [SquareIconButton(icon: Icons.help_outline, tooltip: '검색 도움말', onPressed: () => showDialog<void>(context: context, builder: (_) => const AlertDialog(content: SingleChildScrollView(child: _SyntaxHelp()))))]),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
          child: TextField(
            controller: _ctl,
            autofocus: true,
            textInputAction: TextInputAction.search,
            onChanged: _changed,
            onSubmitted: (_) => _run(),
            decoration: InputDecoration(
              hintText: '검색어 · from:이름 subject:제목 after:2026-09',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _ctl.text.isEmpty ? null : IconButton(icon: const Icon(Icons.close), tooltip: '지우기', onPressed: () { _ctl.clear(); _run(); }),
            ),
          ),
        ),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Row(children: [
            for (final (label, token) in [('안 읽음', 'is:unread'), ('첨부', 'has:attach'), ('보낸 메일', 'in:sent'), ('이번 달', 'after:${ym.year}-${ym.month.toString().padLeft(2, '0')}')]) ...[
              ActionChip(label: Text(label), onPressed: () => _append(token), visualDensity: VisualDensity.compact),
              const SizedBox(width: 6),
            ],
            const SizedBox(width: 6),
            ChoiceChip(label: const Text('최신순'), selected: !_byRelevance, onSelected: (_) { setState(() => _byRelevance = false); _run(); }, visualDensity: VisualDensity.compact),
            const SizedBox(width: 6),
            ChoiceChip(label: const Text('관련도순'), selected: _byRelevance, onSelected: (_) { setState(() => _byRelevance = true); _run(); }, visualDensity: VisualDensity.compact),
          ]),
        ),
        _StatusBar(st, onSync: st.syncing ? null : () => notifier.sync(widget.api), onFull: () => notifier.sync(widget.api, full: true), onWipe: () async {
          final yes = await showDialog<bool>(context: context, builder: (c) => AlertDialog(title: const Text('색인 지우기'), content: const Text('이 기기에 저장된 메일 검색 색인을 지웁니다. 다음 동기화 때 다시 만듭니다.'), actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('취소')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('지우기'))]));
          if (yes == true) await notifier.wipe();
        }),
        Expanded(child: _body(st)),
      ]),
    );
  }

  Widget _body(MailIndexStatus st) {
    if (!st.available) return const Padding(padding: EdgeInsets.all(24), child: Text('이 기기에서는 색인을 저장할 수 없어 검색을 쓸 수 없습니다.', style: TextStyle(color: Brand.muted)));
    if (_ctl.text.trim().isEmpty) return ListView(padding: const EdgeInsets.fromLTRB(20, 8, 20, 24), children: const [Card(child: Padding(padding: EdgeInsets.all(16), child: _SyntaxHelp()))]);
    if (_hits.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: Column(children: [
          const Text('결과 없음', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          Text(st.syncing ? '동기화 중입니다 — 색인이 채워지면 결과가 바로 갱신됩니다.' : st.bodies < st.docs ? '본문은 이미 읽은 메일만 색인됩니다(안 읽은 메일은 제목·보낸 사람만). 검색식은 ? 도움말을 보세요.' : '검색식은 ? 도움말을 보세요.', style: const TextStyle(fontSize: 13, color: Brand.muted), textAlign: TextAlign.center),
        ]),
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
      itemCount: _hits.length + 1,
      separatorBuilder: (_, i) => i == 0 ? const SizedBox.shrink() : const Divider(height: 1),
      itemBuilder: (context, i) {
        if (i == 0) return Padding(padding: const EdgeInsets.only(bottom: 4), child: Text('${_hits.length}${_hits.length >= 300 ? '+' : ''}통', style: const TextStyle(fontSize: 12, color: Brand.muted)));
        final h = _hits[i - 1], d = h.doc;
        return ListTile(
          contentPadding: EdgeInsets.zero,
          onTap: () => _open(d),
          leading: InitialBadge(d.fromName.isEmpty ? d.fromEmail : d.fromName, size: 36, circle: true),
          title: RichText(maxLines: 1, overflow: TextOverflow.ellipsis, text: highlightSpan(d.subject.isEmpty ? '(제목 없음)' : d.subject, h.terms, TextStyle(fontSize: 15, fontWeight: d.seen ? FontWeight.w500 : FontWeight.w800, color: Colors.black87))),
          subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${d.box == 'SENT' ? '보낸 메일 · ${d.to.isEmpty ? '' : '받는 사람 ${d.to}'}' : d.from} · ${niceDate(d.date)}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: Brand.muted)),
            if (h.snippet.isNotEmpty) RichText(maxLines: 2, overflow: TextOverflow.ellipsis, text: highlightSpan(h.snippet, h.terms, const TextStyle(fontSize: 13, color: Colors.black87, height: 1.35))),
          ]),
          trailing: d.attach ? const Icon(Icons.attach_file, size: 16, color: Brand.faint) : null,
        );
      },
    );
  }
}

/// 일치 구간을 노란 바탕·굵게.
TextSpan highlightSpan(String text, List<MailTerm> terms, TextStyle base) {
  final ranges = matchRanges(text, terms);
  if (ranges.isEmpty) return TextSpan(text: text, style: base);
  final spans = <TextSpan>[];
  var at = 0;
  for (final (s, e) in ranges) {
    if (s > at) spans.add(TextSpan(text: text.substring(at, s)));
    spans.add(TextSpan(text: text.substring(s, e), style: const TextStyle(fontWeight: FontWeight.w800, backgroundColor: Color(0xFFFFF0A8))));
    at = e;
  }
  if (at < text.length) spans.add(TextSpan(text: text.substring(at)));
  return TextSpan(style: base, children: spans);
}

class _StatusBar extends StatelessWidget {
  const _StatusBar(this.st, {required this.onSync, required this.onFull, required this.onWipe});
  final MailIndexStatus st;
  final VoidCallback? onSync, onFull, onWipe;
  @override
  Widget build(BuildContext context) {
    final last = st.lastSync;
    final text = !st.available ? '색인 사용 불가' : st.syncing ? '색인 ${st.docs}통 · 본문 ${st.bodies}통 · ${st.phase}' : '색인 ${st.docs}통 · 본문 ${st.bodies}통 · ${st.error != null ? '동기화 실패: ${st.error}' : last == null ? '아직 동기화 전' : '동기화 ${last.hour.toString().padLeft(2, '0')}:${last.minute.toString().padLeft(2, '0')}'}';
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 6, 12, 0),
      child: Row(children: [
        if (st.syncing) const Padding(padding: EdgeInsets.only(right: 8), child: SizedBox(width: 12, height: 12, child: CircularProgressIndicator(strokeWidth: 2))),
        Expanded(child: Text(text, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, color: st.error != null ? Brand.dangerText : Brand.muted))),
        TextButton(onPressed: onSync, child: const Text('동기화')),
        PopupMenuButton<String>(
          tooltip: '색인 메뉴',
          onSelected: (v) => switch (v) { 'full' => onFull?.call(), 'wipe' => onWipe?.call(), _ => null },
          itemBuilder: (_) => const [PopupMenuItem(value: 'full', child: Text('전체 다시 색인')), PopupMenuItem(value: 'wipe', child: Text('색인 지우기'))],
        ),
      ]),
    );
  }
}

class _SyntaxHelp extends StatelessWidget {
  const _SyntaxHelp();
  static const rows = [
    ('결산 회의', '두 단어가 모두 들어간 메일(제목·보낸 사람·받는 사람·첨부 이름·본문)'),
    ('"10월 결산"', '띄어쓰기까지 그대로 들어간 구문'),
    ('결산 -취소', '취소가 들어간 메일은 제외'),
    ('결산 OR 정산', '둘 중 하나'),
    ('from:홍길동 · to:김철수', '보낸 사람 · 받는 사람(참조 포함). 이메일 일부도 됨: from:@innogrid.com'),
    ('subject:보고 · body:지연 · file:pdf', '제목만 · 본문만 · 첨부 파일 이름만'),
    ('after:2026-09 · before:2026-10-05', '그 날짜부터 · 그 날짜 전까지(연·연-월·연-월-일)'),
    ('has:attach · is:unread · in:sent', '첨부 있음 · 안 읽음 · 보낸 메일함'),
    ('제목: 본문: 보낸사람: 받는사람: 첨부: 이후: 이전:', '한글 접두어도 같은 뜻'),
  ];
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        const Text('검색식', style: TextStyle(fontWeight: FontWeight.w800)),
        const SizedBox(height: 8),
        for (final (ex, desc) in rows)
          Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(ex, style: const TextStyle(fontFamily: 'monospace', fontSize: 13, fontWeight: FontWeight.w700)), Text(desc, style: const TextStyle(fontSize: 12, color: Brand.muted))])),
        const SizedBox(height: 8),
        const Text('색인은 이 기기 안에만 저장됩니다. 본문은 이미 읽은 메일만 담고, 안 읽은 메일은 열지 않습니다(열면 아마란스에서 읽음 처리되기 때문). 메일 화면을 열 때 10분마다 자동으로 동기화합니다.', style: TextStyle(fontSize: 12, color: Brand.muted)),
      ]);
}
