import 'package:flutter/material.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'gw_api.dart';
import 'gw_gate.dart';
import 'gw_models.dart';

class ApprovalsScreen extends StatelessWidget {
  const ApprovalsScreen({super.key});
  @override
  Widget build(BuildContext context) => GwGate(title: '미결 결재', builder: (_, api) => _Body(api));
}

class _Body extends StatefulWidget {
  const _Body(this.api);
  final GwApi api;
  @override
  State<_Body> createState() => _BodyState();
}

class _BodyState extends State<_Body> {
  late Future<(int, List<PendingApproval>)> _future = widget.api.pendingApprovals();
  Future<void> _refresh() async {
    setState(() => _future = widget.api.pendingApprovals());
    await _future.catchError((_) => (0, <PendingApproval>[]));
  }

  Future<void> _open(PendingApproval p) async {
    final detail = widget.api.approvalDetail(p.docId, p.formId);
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.7,
        builder: (_, ctl) => FutureBuilder(
          future: detail,
          builder: (context, snap) {
            if (snap.hasError) return Padding(padding: const EdgeInsets.all(24), child: Text('불러오지 못했습니다: ${snap.error}'));
            final d = snap.data;
            if (d == null) return const Center(child: CircularProgressIndicator());
            final theme = Theme.of(context);
            return ListView(controller: ctl, padding: const EdgeInsets.fromLTRB(20, 8, 20, 32), children: [
              Text(d.title, style: theme.textTheme.headlineSmall),
              const SizedBox(height: 6),
              Text([d.form, d.status, if (d.repDt.isNotEmpty) d.repDt].where((s) => s.isNotEmpty).join(' · '), style: theme.textTheme.bodySmall),
              const SizedBox(height: 4),
              Text('기안 ${d.drafter}${d.dept.isEmpty ? '' : ' (${d.dept})'}${d.currentApprover.isEmpty ? '' : ' · 현재 결재자 ${d.currentApprover}'}${d.attachCount > 0 ? ' · 첨부 ${d.attachCount}' : ''}', style: theme.textTheme.bodySmall),
              const Divider(height: 24),
              Text(d.content.isEmpty ? '(본문 없음)' : d.content, style: const TextStyle(fontSize: 15, height: 1.6, color: Brand.navy)),
              const SizedBox(height: 20),
              Container(padding: const EdgeInsets.all(12), decoration: BoxDecoration(color: Brand.blueTint, borderRadius: BorderRadius.circular(12)), child: Text('승인·반려는 아마란스에서 처리하세요. 여기서는 열람 처리도 하지 않습니다.', style: theme.textTheme.bodySmall?.copyWith(color: Brand.navy))),
            ]);
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final today = DateTime.now();
    return Scaffold(
      appBar: const BrandHeader(title: '미결 결재'),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder(
          future: _future,
          builder: (context, snap) {
            if (snap.hasError) return ListView(children: [Padding(padding: const EdgeInsets.all(24), child: Column(children: [Text('${snap.error}', style: const TextStyle(color: Brand.dangerText)), const SizedBox(height: 12), FilledButton(onPressed: _refresh, child: const Text('다시 시도'))]))]);
            if (!snap.hasData) return const Center(child: CircularProgressIndicator());
            final (total, docs) = snap.data!;
            if (docs.isEmpty) return ListView(children: const [Padding(padding: EdgeInsets.all(40), child: Center(child: Text('미결 문서가 없습니다', style: TextStyle(color: Brand.muted))))]);
            return ListView.separated(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
              itemCount: docs.length + 1,
              separatorBuilder: (_, _) => const SizedBox(height: 8),
              itemBuilder: (context, i) {
                if (i == 0) return Padding(padding: const EdgeInsets.only(left: 4, bottom: 4), child: CountTitle('미결', total));
                final p = docs[i - 1];
                final days = p.waitingDays(today);
                return Card(
                  child: ListTile(
                    onTap: () => _open(p),
                    leading: InitialBadge(p.drafter, size: 40),
                    title: Row(children: [
                      if (p.unread) const Padding(padding: EdgeInsets.only(right: 6), child: CircleAvatar(radius: 4, backgroundColor: Brand.blue)),
                      Expanded(child: Text(p.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: p.unread ? FontWeight.w800 : FontWeight.w600))),
                    ]),
                    subtitle: Text('${p.form} · ${p.drafter}${p.dept.isEmpty ? '' : ' (${p.dept})'}${days == null ? '' : ' · ${days == 0 ? '오늘' : '$days일째'}'}', maxLines: 1, overflow: TextOverflow.ellipsis),
                    trailing: const Icon(Icons.chevron_right, color: Brand.faint),
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }
}
