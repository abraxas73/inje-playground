import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'gw_api.dart';
import 'gw_gate.dart';
import 'gw_models.dart';
import 'mail_detail_screen.dart';
import 'mail_indexer.dart';
import 'mail_search_screen.dart';

class MailScreen extends StatelessWidget {
  const MailScreen({super.key});
  @override
  Widget build(BuildContext context) => GwGate(title: '메일', builder: (_, api) => _Body(api));
}

class _Body extends ConsumerStatefulWidget {
  const _Body(this.api);
  final GwApi api;
  @override
  ConsumerState<_Body> createState() => _BodyState();
}

class _BodyState extends ConsumerState<_Body> {
  late Future<(MailSummary, List<MailItem>)> _future = _load();
  Future<(MailSummary, List<MailItem>)> _load() async {
    // 레코드 .wait는 실패를 ParallelWaitError로 감싸 영어 클래스 이름이 화면에 나온다 → 순서대로
    final s = await widget.api.mailSummary();
    final (_, items) = await widget.api.inbox();
    unawaited(ref.read(mailIndexProvider.notifier).syncIfStale(widget.api)); // 검색 색인(10분마다, 결과를 기다리지 않음)
    return (s, items);
  }

  Future<void> _refresh() async {
    setState(() { _future = _load(); }); // 화살표 함수는 Future를 돌려줘 디버그 빌드에서 setState 단언에 걸린다
    await _future.catchError((_) => (const MailSummary(unread: 0, toMe: 0, total: 0), <MailItem>[]));
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: const BrandHeader(title: '메일', showBack: true, favoritePath: '/gw/mail'),
        body: RefreshIndicator(
          onRefresh: _refresh,
          child: FutureBuilder(
            future: _future,
            builder: (context, snap) {
              if (snap.hasError) return ListView(children: [Padding(padding: const EdgeInsets.all(24), child: Column(children: [Text('${snap.error}', style: const TextStyle(color: Brand.dangerText)), const SizedBox(height: 12), FilledButton(onPressed: _refresh, child: const Text('다시 시도'))]))]);
              if (!snap.hasData) return const Center(child: CircularProgressIndicator());
              final (s, items) = snap.data!;
              return ListView(padding: const EdgeInsets.fromLTRB(20, 4, 20, 24), children: [
                InkWell(
                  onTap: () => Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => MailSearchScreen(api: widget.api))),
                  borderRadius: BorderRadius.circular(12),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: Brand.line)),
                    child: const Row(children: [Icon(Icons.search, color: Brand.faint), SizedBox(width: 8), Text('메일 검색 · 제목·보낸 사람·본문', style: TextStyle(color: Brand.muted))]),
                  ),
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: Brand.navy, borderRadius: BorderRadius.circular(16)),
                  child: Text('미읽음 ${s.unread} · 나에게 온 것 ${s.toMe} · 전체 ${s.total}', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Colors.white)),
                ),
                const SizedBox(height: 12),
                Card(
                  child: items.isEmpty
                      ? const Padding(padding: EdgeInsets.all(20), child: Center(child: Text('받은 메일이 없습니다', style: TextStyle(color: Brand.muted))))
                      : Column(children: [
                          for (final (i, m) in items.indexed) ...[
                            if (i > 0) const Divider(height: 1),
                            ListTile(
                              onTap: () async {
                                // 본문을 열면 아마란스가 읽음 처리하므로 돌아온 뒤 목록·미읽음 수를 다시 읽는다
                                await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => MailDetailScreen(api: widget.api, item: m)));
                                if (mounted) await _refresh();
                              },
                              leading: InitialBadge(m.fromName.isEmpty ? m.fromEmail : m.fromName, size: 36, circle: true),
                              title: Text(m.subject.isEmpty ? '(제목 없음)' : m.subject, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: m.seen ? FontWeight.w500 : FontWeight.w800)),
                              subtitle: Text(m.fromName.isEmpty ? m.fromEmail : m.fromName, maxLines: 1, overflow: TextOverflow.ellipsis),
                              trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                                Text(m.date, style: const TextStyle(fontSize: 12, color: Brand.muted)),
                                if (m.attach) const Icon(Icons.attach_file, size: 14, color: Brand.faint),
                              ]),
                            ),
                          ],
                        ]),
                ),
                const SizedBox(height: 10),
                const Text('메일을 열면 아마란스에서도 읽음으로 바뀝니다. 본문 화면에서 안 읽음으로 되돌릴 수 있습니다.', style: TextStyle(fontSize: 12, color: Brand.muted), textAlign: TextAlign.center),
              ]);
            },
          ),
        ),
      );
}
