import 'package:flutter/material.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'gw_api.dart';
import 'gw_models.dart';

/// 메일 본문(서식 없는 텍스트). 열면 아마란스에서 읽음 처리되므로 '안 읽음으로 되돌리기'를 둔다. 첨부는 이름만(내려받기는 아마란스에서).
class MailDetailScreen extends StatefulWidget {
  const MailDetailScreen({super.key, required this.api, required this.item});
  final GwApi api;
  final MailItem item;
  @override
  State<MailDetailScreen> createState() => _MailDetailScreenState();
}

class _MailDetailScreenState extends State<MailDetailScreen> {
  late Future<MailDetail> _future = widget.api.readMail(widget.item.muid);
  bool _busy = false;

  Future<void> _unread() async {
    setState(() => _busy = true);
    try {
      await widget.api.markMailUnread(widget.item.muid);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('안 읽음으로 되돌렸습니다.')));
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('안 읽음으로 되돌리지 못했습니다: $e')));
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: BrandHeader(title: widget.item.subject.isEmpty ? '(제목 없음)' : widget.item.subject, showBack: true),
        body: FutureBuilder(
          future: _future,
          builder: (context, snap) {
            if (snap.hasError) {
              return Padding(padding: const EdgeInsets.all(24), child: Column(children: [Text('${snap.error}', style: const TextStyle(color: Brand.dangerText)), const SizedBox(height: 12), FilledButton(onPressed: () => setState(() => _future = widget.api.readMail(widget.item.muid)), child: const Text('다시 시도'))]));
            }
            if (!snap.hasData) return const Center(child: CircularProgressIndicator());
            final m = snap.data!;
            return ListView(padding: const EdgeInsets.fromLTRB(20, 8, 20, 32), children: [
              Text(m.subject.isEmpty ? '(제목 없음)' : m.subject, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
              const SizedBox(height: 8),
              _row('보낸 사람', m.from),
              _row('받는 사람', m.to),
              if (m.cc.isNotEmpty) _row('참조', m.cc),
              _row('시각', niceDate(m.date)),
              if (m.attachments.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: Wrap(spacing: 6, runSpacing: 6, children: [
                    for (final (name, size) in m.attachments) Chip(avatar: const Icon(Icons.attach_file, size: 16), label: Text(size > 0 ? '$name · ${_size(size)}' : name), visualDensity: VisualDensity.compact),
                  ]),
                ),
              const Divider(height: 28),
              SelectableText(m.body.isEmpty ? '(본문 없음)' : m.body, style: const TextStyle(fontSize: 15, height: 1.5)),
              const SizedBox(height: 20),
              Text('서식 없는 텍스트로 보여 줍니다${m.remoteImages > 0 ? ' · 외부 이미지 ${m.remoteImages}개는 표시하지 않습니다' : ''}. 첨부 내려받기는 아마란스에서 하세요.', style: const TextStyle(fontSize: 12, color: Brand.muted)),
              const SizedBox(height: 12),
              OutlinedButton.icon(onPressed: _busy ? null : _unread, icon: const Icon(Icons.mark_email_unread_outlined), label: const Text('안 읽음으로 되돌리기')),
            ]);
          },
        ),
      );

  Widget _row(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [SizedBox(width: 68, child: Text(k, style: const TextStyle(fontSize: 12, color: Brand.muted))), Expanded(child: SelectableText(v, style: const TextStyle(fontSize: 13)))]),
      );

  static String _size(int n) => n >= 1024 * 1024 ? '${(n / 1024 / 1024).toStringAsFixed(1)}MB' : '${(n / 1024).ceil().clamp(1, 1 << 30)}KB';
}
