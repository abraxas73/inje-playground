import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart' show JavaScriptMode, NavigationDecision;
import '../web/app_webview.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'gw_api.dart';
import 'gw_models.dart';
import 'mail_html.dart';
import 'mail_indexer.dart';

/// 메일 본문. 아래 고정 줄은 두지 않는다(2026-10-22 사용자 결정 — 본문 공간 우선, 안 읽음 되돌리기 없음). 첨부는 이름만, 누르면 아마란스에서 받으라고 안내.
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
  bool _loaded = false; // 본문을 다 읽은 뒤에만 삭제(늦게 끝난 색인 저장이 지운 메일을 되살리지 않게)
  bool? _headerOpen; // 머리 정보 펼침 — 처음엔 좁은 화면이면 접힘

  /// 읽은 본문은 검색 색인에도 넣는다(서버가 이미 읽음 처리한 메일이라 부작용 없음). 색인 실패는 화면에 영향 없음.
  Future<MailDetail> _load() async {
    final d = await widget.api.readMail(widget.item.muid);
    // 색인 저장이 끝난 뒤에야 삭제를 켠다 — 삭제 후 늦게 끝난 저장이 지운 메일을 되살리지 않게(본문 표시는 기다리지 않음)
    unawaited(ref.read(mailIndexProvider.notifier).putDetail(widget.api, widget.item, d).catchError((_) {}).whenComplete(() {
      if (mounted) setState(() => _loaded = true);
    }));
    return d;
  }

  /// 휴지통으로 이동 — 되돌리기는 아마란스 휴지통에서. 확인을 받은 뒤에만.
  Future<void> _delete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('이 메일을 삭제할까요?'),
        content: const Text('아마란스 휴지통으로 옮깁니다. 되살리려면 아마란스 메일의 휴지통에서 복원하세요.'),
        actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('취소')), FilledButton(style: FilledButton.styleFrom(backgroundColor: Brand.danger), onPressed: () => Navigator.pop(c, true), child: const Text('삭제'))],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await widget.api.deleteMail(widget.item.muid);
      unawaited(ref.read(mailIndexProvider.notifier).remove(widget.item.muid).catchError((_) {}));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('휴지통으로 옮겼습니다.')));
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('삭제하지 못했습니다: $e')));
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: BrandHeader(
          title: widget.item.subject.isEmpty ? '(제목 없음)' : widget.item.subject,
          showBack: true,
          actions: [SquareIconButton(icon: Icons.delete_outline, tooltip: '삭제(휴지통으로)', onPressed: _busy || !_loaded ? null : _delete)],
        ),
        body: FutureBuilder(
          future: _future,
          builder: (context, snap) {
            if (snap.hasError) {
              return Padding(padding: const EdgeInsets.all(24), child: Column(children: [Text('${snap.error}', style: const TextStyle(color: Brand.dangerText)), const SizedBox(height: 12), FilledButton(onPressed: () => setState(() { _future = _load(); }), child: const Text('다시 시도'))]));
            }
            if (!snap.hasData) return const Center(child: CircularProgressIndicator());
            final m = snap.data!;
            if (m.html.trim().isNotEmpty) {
              // 서식 있는 본문(아마란스 웹처럼 표·굵게·강조) — 머리 정보는 접을 수 있고(좁은 화면은 처음부터 접힘), 본문은 남은 높이를 다 쓴다.
              final open = _headerOpen ??= MediaQuery.sizeOf(context).width >= 600;
              return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                if (open)
                  ConstrainedBox(
                    constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.4),
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: _header(m)),
                    ),
                  ),
                _HeaderToggle(open: open, summary: _summary(m), onTap: () => setState(() => _headerOpen = !open)),
                Expanded(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 14), child: _MailHtmlView(html: m.html))),
              ]);
            }
            return ListView(padding: const EdgeInsets.fromLTRB(20, 8, 20, 32), children: [
              ..._header(m),
              const Divider(height: 28),
              SelectableText(m.body.isEmpty ? '(본문 없음)' : m.body, style: const TextStyle(fontSize: 15, height: 1.5)),
            ]);
          },
        ),
      );

  /// 접힌 머리 정보 한 줄 — 보낸 사람 이름 · 시각 · 첨부 수
  static String _summary(MailDetail m) {
    final from = m.from.replaceAll(RegExp(r'\s*<[^>]*>'), '').trim();
    return [if (from.isNotEmpty) from, niceDate(m.date), if (m.attachments.isNotEmpty) '첨부 ${m.attachments.length}'].join(' · ');
  }

  List<Widget> _header(MailDetail m) => [
        Text(m.subject.isEmpty ? '(제목 없음)' : m.subject, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
        const SizedBox(height: 8),
        _row('보낸 사람', m.from),
        _Recipients('받는 사람', m.to),
        if (m.cc.isNotEmpty) _Recipients('참조', m.cc),
        _row('시각', niceDate(m.date)),
        if (m.remoteImages > 0) Padding(padding: const EdgeInsets.only(top: 4), child: Text('외부 이미지 ${m.remoteImages}개는 표시하지 않습니다.', style: TextStyle(fontSize: 12, color: Brand.muted))),
        if (m.attachments.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Wrap(spacing: 6, runSpacing: 6, children: [
              for (final (name, size) in m.attachments) ActionChip(
                  avatar: const Icon(Icons.attach_file, size: 16),
                  label: Text(size > 0 ? '$name · ${_size(size)}' : name),
                  visualDensity: VisualDensity.compact,
                  onPressed: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('첨부 파일은 아마란스 메일에서 내려받아 주세요.'))),
                ),
            ]),
          ),
      ];

  Widget _row(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [SizedBox(width: 68, child: Text(k, style: TextStyle(fontSize: 12, color: Brand.muted))), Expanded(child: SelectableText(v, style: const TextStyle(fontSize: 13)))]),
      );

  static String _size(int n) => n >= 1024 * 1024 ? '${(n / 1024 / 1024).toStringAsFixed(1)}MB' : '${(n / 1024).ceil().clamp(1, 1 << 30)}KB';
}

/// 머리 정보 접기·펼치기 줄 — 접혀 있으면 요약 한 줄을 보인다.
class _HeaderToggle extends StatelessWidget {
  const _HeaderToggle({required this.open, required this.summary, required this.onTap});
  final bool open;
  final String summary;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.fromLTRB(20, 8, 12, 8),
          decoration: BoxDecoration(border: Border(top: open ? BorderSide(color: Brand.line) : BorderSide.none, bottom: BorderSide(color: Brand.line))),
          child: Row(children: [
            Expanded(child: Text(open ? '머리 정보 접기' : summary, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, color: Brand.muted))),
            Icon(open ? Icons.expand_less : Icons.expand_more, size: 20, color: Brand.muted),
          ]),
        ),
      );
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
        SizedBox(width: 68, child: Text(widget.label, style: TextStyle(fontSize: 12, color: Brand.muted))),
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

/// 메일 본문 HTML 웹뷰 — JavaScript 끔, 처음 그리는 빈 문서 밖으로는 이동하지 않고 링크는 시스템 브라우저로.
class _MailHtmlView extends StatefulWidget {
  const _MailHtmlView({required this.html});
  final String html;
  @override
  State<_MailHtmlView> createState() => _MailHtmlViewState();
}

class _MailHtmlViewState extends State<_MailHtmlView> {
  final _c = AppWebController(javaScript: false);

  @override
  void initState() {
    super.initState();
    unawaited(() async {
      await _c.setJavaScriptMode(JavaScriptMode.disabled);
      await _c.setNavigationDelegate(AppNavigationDelegate(onNavigationRequest: (r) {
        if (mailHtmlInitial(r.url)) return NavigationDecision.navigate;
        final u = mailHtmlExternal(r.url);
        if (u != null) unawaited(launchUrl(u, mode: LaunchMode.externalApplication));
        return NavigationDecision.prevent;
      }));
      await _c.loadHtmlString(mailHtmlDocument(widget.html));
    }());
  }

  @override
  Widget build(BuildContext context) => _c.build(context);
}
