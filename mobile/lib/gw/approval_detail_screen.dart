import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'approvals_screen.dart' show approvalWebUrl;
import 'gw_api.dart';
import 'gw_client.dart';
import 'gw_models.dart';
import 'mail_detail_screen.dart' show MailHtmlView;

/// 미결 결재 상세(전체 화면) — 제목·기안·결재선·본문(표 서식 그대로, 안전한 웹뷰)·첨부 수, 아래에 '바로 승인'·'아마란스에서 열기'.
/// 열람 처리는 하지 않는다(setReadYn N). 승인하면 true로 닫힌다(목록·홈 위젯이 다시 읽도록).
class ApprovalDetailScreen extends StatefulWidget {
  const ApprovalDetailScreen({super.key, required this.api, required this.docId, required this.formId, this.title = ''});
  final GwApi api;
  final String docId, formId, title;
  @override
  State<ApprovalDetailScreen> createState() => _ApprovalDetailScreenState();
}

class _ApprovalDetailScreenState extends State<ApprovalDetailScreen> {
  late Future<ApprovalDetail> _future = widget.api.approvalDetail(widget.docId, widget.formId);
  bool _busy = false;

  Future<void> _refresh() async {
    setState(() { _future = widget.api.approvalDetail(widget.docId, widget.formId); });
    await _future.catchError((_) => const ApprovalDetail(title: '', form: '', status: '', drafter: '', dept: '', repDt: '', attachCount: 0, currentApprover: '', content: ''));
  }

  Future<void> _approve(ApprovalDetail d) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        icon: const Icon(Icons.warning_amber_rounded, color: Brand.danger, size: 40),
        title: const Text('바로 승인'),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(d.title, style: const TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          const Text('바로 승인 처리가 됩니다. 진행하시겠습니까?', style: TextStyle(color: Brand.dangerText, fontWeight: FontWeight.w700, fontSize: 16)),
          const SizedBox(height: 6),
          Text('아마란스에 실제 결재로 반영되며 되돌리려면 아마란스에서 결재취소해야 합니다.', style: TextStyle(fontSize: 13, color: Brand.muted)),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('취소')),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: Brand.danger), onPressed: () => Navigator.pop(c, true), child: const Text('승인')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = true);
    try {
      final after = await widget.api.approve(d);
      if (!mounted) return;
      if (after.canApprove) {
        // 다시 읽었는데 아직 내 차례로 남아 있으면 성공이라 하지 않는다(read-back)
        setState(() { _future = Future.value(after); });
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('승인 요청은 보냈지만 아직 반영되지 않았습니다. 아마란스에서 확인해 주세요.')));
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('승인했습니다.')));
      Navigator.of(context).pop(true);
    } on GwException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('승인하지 못했습니다: $e')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _openInGw() => launchUrl(Uri.parse(approvalWebUrl(widget.docId, widget.formId)), mode: LaunchMode.externalApplication);

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: BrandHeader(title: '결재 문서', showBack: true, onRefresh: _refresh),
        body: FutureBuilder<ApprovalDetail>(
          future: _future,
          builder: (context, snap) {
            if (snap.hasError) {
              final e = snap.error;
              return Center(child: Padding(padding: const EdgeInsets.all(24), child: Text('불러오지 못했습니다: ${e is GwException ? e.message : e}', textAlign: TextAlign.center)));
            }
            final d = snap.data;
            if (d == null) return const Center(child: CircularProgressIndicator());
            final theme = Theme.of(context);
            return Column(children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(d.title.isEmpty ? widget.title : d.title, style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 4),
                  Text([d.form, d.status, if (d.docNo.isNotEmpty) d.docNo].where((s) => s.isNotEmpty).join(' · '), style: TextStyle(fontSize: 13, color: Brand.muted)),
                  Text('기안 ${d.drafter}${d.dept.isEmpty ? '' : ' (${d.dept})'}${d.repDt.isEmpty ? '' : ' · ${_when(d.repDt)}'}${d.attachCount > 0 ? ' · 첨부 ${d.attachCount}개(아마란스에서 받기)' : ''}', style: TextStyle(fontSize: 13, color: Brand.muted)),
                  if (d.lines.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    Wrap(spacing: 6, runSpacing: 6, children: [for (final l in d.lines) _step(l)]),
                  ],
                ]),
              ),
              const Divider(height: 1),
              Expanded(
                child: d.html.trim().isNotEmpty
                    ? Padding(padding: const EdgeInsets.symmetric(horizontal: 14), child: MailHtmlView(key: ValueKey(d.docId), html: d.html))
                    : SingleChildScrollView(padding: const EdgeInsets.all(20), child: Text(d.content.isEmpty ? '(본문 없음)' : d.content, style: TextStyle(fontSize: 15, height: 1.6, color: Brand.navy))),
              ),
              SafeArea(
                top: false,
                child: Container(
                  padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                  decoration: BoxDecoration(color: Brand.surface, border: Border(top: BorderSide(color: Brand.line))),
                  child: Row(children: [
                    Expanded(child: OutlinedButton.icon(onPressed: _openInGw, icon: const Icon(Icons.open_in_new, size: 18), label: const Text('아마란스에서 열기'))),
                    if (d.canApprove) ...[
                      const SizedBox(width: 10),
                      Expanded(
                        child: FilledButton.icon(
                          style: FilledButton.styleFrom(backgroundColor: Brand.danger),
                          onPressed: _busy ? null : () => _approve(d),
                          icon: _busy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.check_circle_outline, size: 18),
                          label: const Text('바로 승인'),
                        ),
                      ),
                    ],
                  ]),
                ),
              ),
            ]);
          },
        ),
      );

  Widget _step(ApprovalLineStep l) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(color: l.done ? Brand.blueTint : Brand.fill, borderRadius: BorderRadius.circular(10), border: Border.all(color: l.done ? Brand.blue.withValues(alpha: 0.3) : Brand.line)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          Text('${l.role.isEmpty ? '결재' : l.role} · ${l.name}${l.duty.isEmpty ? '' : ' ${l.duty}'}', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Brand.navy)),
          Text(l.done ? _when(l.actionTime) : '대기', style: TextStyle(fontSize: 11, color: l.done ? Brand.blue : Brand.muted)),
        ]),
      );
}

/// 'YYYYMMDDHHmm(ss)' → 'MM-DD HH:mm'. 다른 꼴은 그대로.
String _when(String s) => s.length >= 12 && int.tryParse(s.substring(0, 12)) != null ? '${s.substring(4, 6)}-${s.substring(6, 8)} ${s.substring(8, 10)}:${s.substring(10, 12)}' : s;
