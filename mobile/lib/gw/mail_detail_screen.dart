import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'gw_api.dart';
import 'gw_models.dart';
import 'mail_indexer.dart';

/// 메일 본문(서식 없는 텍스트). 열면 아마란스에서 읽음 처리되므로 '안 읽음으로 되돌리기'를 둔다. 첨부는 이름만(내려받기는 아마란스에서).
class MailDetailScreen extends ConsumerStatefulWidget {
  const MailDetailScreen({super.key, required this.api, required this.item});
  final GwApi api;
  final MailItem item;
  @override
  ConsumerState<MailDetailScreen> createState() => _MailDetailScreenState();
}

class _MailDetailScreenState extends ConsumerState<MailDetailScreen> {
  late Future<MailDetail> _future = _load();
  bool _busy = false;

  /// 읽은 본문은 검색 색인에도 넣는다(서버가 이미 읽음 처리한 메일이라 부작용 없음). 색인 실패는 화면에 영향 없음.
  Future<MailDetail> _load() async {
    final d = await widget.api.readMail(widget.item.muid);
    unawaited(ref.read(mailIndexProvider.notifier).putDetail(widget.api, widget.item, d).catchError((_) {}));
    return d;
  }

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
              return Padding(padding: const EdgeInsets.all(24), child: Column(children: [Text('${snap.error}', style: const TextStyle(color: Brand.dangerText)), const SizedBox(height: 12), FilledButton(onPressed: () => setState(() => _future = _load()), child: const Text('다시 시도'))]));
            }
            if (!snap.hasData) return const Center(child: CircularProgressIndicator());
            final m = snap.data!;
            return ListView(padding: const EdgeInsets.fromLTRB(20, 8, 20, 32), children: [
              Text(m.subject.isEmpty ? '(제목 없음)' : m.subject, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
              const SizedBox(height: 8),
              _row('보낸 사람', m.from),
              _Recipients('받는 사람', m.to),
              if (m.cc.isNotEmpty) _Recipients('참조', m.cc),
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

/// 받는 사람·참조 — 2명까지만 보이고 나머지는 "외 N명 더보기"로 펼친다.
class _Recipients extends StatefulWidget {
  const _Recipients(this.label, this.value);
  final String label, value;
  @override
  State<_Recipients> createState() => _RecipientsState();
}

class _RecipientsState extends State<_Recipients> {
  static const _shown = 2;
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final all = splitRecipients(widget.value);
    final list = _open ? all : all.take(_shown).toList();
    final more = all.length - _shown;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(width: 68, child: Text(widget.label, style: const TextStyle(fontSize: 12, color: Brand.muted))),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SelectableText(list.isEmpty ? widget.value : list.join('\n'), style: const TextStyle(fontSize: 13)),
            if (more > 0)
              InkWell(
                onTap: () => setState(() => _open = !_open),
                child: Padding(padding: const EdgeInsets.symmetric(vertical: 2), child: Text(_open ? '접기' : '외 $more명 더보기', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Theme.of(context).colorScheme.primary))),
              ),
          ]),
        ),
      ]),
    );
  }
}
