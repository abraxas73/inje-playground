import 'package:flutter/material.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'gw_api.dart';
import 'gw_gate.dart';
import 'gw_models.dart';

class MailScreen extends StatelessWidget {
  const MailScreen({super.key});
  @override
  Widget build(BuildContext context) => GwGate(title: '메일', builder: (_, api) => _Body(api));
}

class _Body extends StatefulWidget {
  const _Body(this.api);
  final GwApi api;
  @override
  State<_Body> createState() => _BodyState();
}

class _BodyState extends State<_Body> {
  late Future<(MailSummary, List<MailItem>)> _future = _load();
  Future<(MailSummary, List<MailItem>)> _load() async {
    // 레코드 .wait는 실패를 ParallelWaitError로 감싸 영어 클래스 이름이 화면에 나온다 → 순서대로
    final s = await widget.api.mailSummary();
    final (_, items) = await widget.api.inbox();
    return (s, items);
  }

  Future<void> _refresh() async {
    setState(() => _future = _load());
    await _future.catchError((_) => (const MailSummary(unread: 0, toMe: 0, total: 0), <MailItem>[]));
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: const BrandHeader(title: '메일', showBack: true),
        body: RefreshIndicator(
          onRefresh: _refresh,
          child: FutureBuilder(
            future: _future,
            builder: (context, snap) {
              if (snap.hasError) return ListView(children: [Padding(padding: const EdgeInsets.all(24), child: Column(children: [Text('${snap.error}', style: const TextStyle(color: Brand.dangerText)), const SizedBox(height: 12), FilledButton(onPressed: _refresh, child: const Text('다시 시도'))]))]);
              if (!snap.hasData) return const Center(child: CircularProgressIndicator());
              final (s, items) = snap.data!;
              return ListView(padding: const EdgeInsets.fromLTRB(20, 4, 20, 24), children: [
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
                              onTap: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('본문은 아마란스에서 확인하세요(앱에서 열면 읽음 처리됩니다).'))),
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
                const Text('본문은 열지 않습니다 — 앱에서 열면 아마란스에서 읽음으로 바뀌기 때문입니다.', style: TextStyle(fontSize: 12, color: Brand.muted), textAlign: TextAlign.center),
              ]);
            },
          ),
        ),
      );
}
