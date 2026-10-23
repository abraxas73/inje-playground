import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'gw_api.dart';
import 'gw_client.dart' show asStr;
import 'gw_mcp_api.dart';
import 'mail_compose.dart';

/// 메일 쓰기·답장·전체답장·전달 화면. 보내기는 확인을 받은 뒤에만(되돌릴 수 없음).
/// 받는 사람 칸은 쉼표로 여럿, 이름을 치면 사내 명부에서 고를 수 있다.

typedef MailContact = ({String name, String email, String dept});

/// 사내 명부 → 메일 주소록(emailAddr은 아이디만 오므로 emailDomain을 붙인다). 테스트에서 override.
final mailContactsProvider = FutureProvider.autoDispose<List<MailContact>>((ref) async {
  final api = ref.watch(gwApiProvider);
  if (api == null) return const [];
  final rows = await api.rosterRows();
  return [
    for (final r in rows)
      if (asStr(r['emailAddr']).isNotEmpty && asStr(r['empName']).trim().isNotEmpty)
        (
          name: asStr(r['empName']).trim(),
          email: asStr(r['emailAddr']).contains('@') ? asStr(r['emailAddr']) : '${asStr(r['emailAddr'])}@${asStr(r['emailDomain']).isEmpty ? 'innogrid.com' : asStr(r['emailDomain'])}',
          dept: asStr(r['deptName']),
        ),
  ];
});

/// 새로 붙일 파일 고르기. 테스트에서 override.
final mailFilePickerProvider = Provider<Future<List<({String name, List<int> bytes})>> Function()>((_) => () async {
  final files = await FilePicker.pickFiles();
  return [for (final f in files) (name: f.name, bytes: await f.readAsBytes())];
});

class MailComposeScreen extends ConsumerStatefulWidget {
  const MailComposeScreen({super.key, required this.api, this.kind = MailKind.plain, this.muid = '', this.mailTo = '', this.mbox = 'INBOX'});
  final GwApi api;
  final MailKind kind;
  final String muid, mailTo, mbox;
  @override
  ConsumerState<MailComposeScreen> createState() => _MailComposeScreenState();
}

class _MailComposeScreenState extends ConsumerState<MailComposeScreen> {
  final _to = TextEditingController(), _cc = TextEditingController(), _bcc = TextEditingController(), _subject = TextEditingController(), _body = TextEditingController();
  late final Future<Map> _init = _load();
  Map _form = const {};
  String _quote = '';
  List<({String sn, String name})> _original = const []; // 전달할 원본 첨부(빼면 안 보냄)
  final _newFiles = <({String name, List<int> bytes})>[];
  bool _signature = true, _showBcc = false, _sending = false;

  String get _title => switch (widget.kind) { MailKind.plain => '메일 쓰기', MailKind.reply => '답장', MailKind.replyAll => '전체 답장', MailKind.forward => '전달' };

  Future<Map> _load() async {
    final init = await widget.api.mailComposeInit(widget.kind, muid: widget.muid, mailTo: widget.mailTo, mbox: widget.mbox);
    final me = (await widget.api.client.session()).email;
    final p = mailPrefill(widget.kind, init, myEmail: me);
    _form = init;
    _to.text = p.to;
    _cc.text = p.cc;
    _subject.text = p.subject;
    _quote = p.quote;
    _original = p.originalFiles;
    return init;
  }

  @override
  void dispose() {
    for (final c in [_to, _cc, _bcc, _subject, _body]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _attach() async {
    try {
      final picked = await ref.read(mailFilePickerProvider)();
      if (mounted) setState(() => _newFiles.addAll(picked));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('파일을 열지 못했습니다: $e')));
    }
  }

  Future<void> _send() async {
    if (_sending) return;
    final to = _to.text.trim();
    if (to.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('받는 사람을 입력하세요.')));
      return;
    }
    final files = _original.length + _newFiles.length;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('메일을 보낼까요?'),
        content: Text([
          '받는 사람: $to',
          if (_cc.text.trim().isNotEmpty) '참조: ${_cc.text.trim()}',
          if (_bcc.text.trim().isNotEmpty) '숨은 참조: ${_bcc.text.trim()}',
          '제목: ${_subject.text.trim().isEmpty ? '(제목없음)' : _subject.text.trim()}',
          if (files > 0) '첨부 $files개',
          '\n보낸 뒤에는 되돌릴 수 없습니다.',
        ].join('\n')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('취소')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('보내기')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _sending = true);
    try {
      await widget.api.mailSendComposed(
        kind: widget.kind,
        init: _form,
        to: to,
        cc: _cc.text.trim(),
        bcc: _bcc.text.trim(),
        subject: _subject.text,
        html: mailBodyHtml(_body.text, signature: _signature ? mailSignatureHtml(_form) : '', quote: _quote),
        keepFiles: [for (final f in _original) f.sn],
        newFiles: _newFiles,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('메일을 보냈습니다.')));
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _sending = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('보내지 못했습니다: $e')));
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: BrandHeader(
          title: _title,
          showBack: true,
          actions: [
            IconButton(tooltip: '파일 첨부', onPressed: _sending ? null : _attach, icon: const Icon(Icons.attach_file)),
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: FilledButton.icon(
                onPressed: _sending ? null : _send,
                icon: _sending ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send, size: 18),
                label: const Text('보내기'),
              ),
            ),
          ],
        ),
        body: FutureBuilder<Map>(
          future: _init,
          builder: (context, snap) {
            if (snap.hasError) return Center(child: Padding(padding: const EdgeInsets.all(24), child: Text('작성 화면을 열지 못했습니다: ${snap.error}', textAlign: TextAlign.center)));
            if (!snap.hasData) return const Center(child: CircularProgressIndicator());
            return ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
              _AddressField(label: '받는 사람', controller: _to, trailing: _showBcc ? null : TextButton(onPressed: () => setState(() => _showBcc = true), child: const Text('숨은 참조'))),
              _AddressField(label: '참조', controller: _cc),
              if (_showBcc) _AddressField(label: '숨은 참조', controller: _bcc),
              TextField(controller: _subject, decoration: const InputDecoration(labelText: '제목')),
              if (_original.isNotEmpty || _newFiles.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: Wrap(spacing: 6, runSpacing: 6, children: [
                    for (final f in _original) InputChip(avatar: const Icon(Icons.attach_file, size: 16), label: Text(f.name), onDeleted: () => setState(() => _original = [..._original]..remove(f))),
                    for (final f in _newFiles) InputChip(avatar: const Icon(Icons.upload_file, size: 16), label: Text(f.name), onDeleted: () => setState(() => _newFiles.remove(f))),
                  ]),
                ),
              const SizedBox(height: 12),
              TextField(
                controller: _body,
                minLines: 10,
                maxLines: null,
                keyboardType: TextInputType.multiline,
                decoration: const InputDecoration(hintText: '내용', border: OutlineInputBorder()),
              ),
              if (mailSignatureHtml(_form).trim().isNotEmpty)
                CheckboxListTile(dense: true, contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading, value: _signature, onChanged: (v) => setState(() => _signature = v ?? true), title: const Text('서명 넣기')),
              if (_quote.isNotEmpty)
                Padding(padding: const EdgeInsets.only(top: 4), child: Text('원본 메일이 본문 아래에 붙습니다.', style: TextStyle(fontSize: 12, color: Brand.muted))),
            ]);
          },
        ),
      );
}

/// 주소 칸 — 쉼표로 여럿. 마지막 항목을 치는 동안 명부에서 이름·주소가 맞는 사람을 보여 주고, 고르면 "이름 <주소>"로 바꾼다.
class _AddressField extends ConsumerStatefulWidget {
  const _AddressField({required this.label, required this.controller, this.trailing});
  final String label;
  final TextEditingController controller;
  final Widget? trailing;
  @override
  ConsumerState<_AddressField> createState() => _AddressFieldState();
}

class _AddressFieldState extends ConsumerState<_AddressField> {
  final _focus = FocusNode();

  @override
  void dispose() {
    _focus.dispose();
    super.dispose();
  }

  static String _last(String v) => v.split(',').last.trim();

  @override
  Widget build(BuildContext context) {
    final contacts = ref.watch(mailContactsProvider).value ?? const [];
    final controller = widget.controller;
    return RawAutocomplete<MailContact>(
      textEditingController: controller,
      focusNode: _focus,
      displayStringForOption: (c) => '${c.name} <${c.email}>',
      optionsBuilder: (v) {
        final q = _last(v.text).toLowerCase();
        if (q.isEmpty || q.contains('>')) return const [];
        return contacts.where((c) => c.name.toLowerCase().contains(q) || c.email.toLowerCase().startsWith(q)).take(8);
      },
      onSelected: (c) {
        final parts = controller.text.split(',')..removeLast();
        final text = [...parts.map((s) => s.trim()).where((s) => s.isNotEmpty), '${c.name} <${c.email}>'].join(', ');
        controller.value = TextEditingValue(text: '$text, ', selection: TextSelection.collapsed(offset: text.length + 2));
      },
      fieldViewBuilder: (context, c, f, onSubmit) => TextField(controller: c, focusNode: f, decoration: InputDecoration(labelText: widget.label, suffixIcon: widget.trailing)),
      optionsViewBuilder: (context, onSelected, options) => Align(
        alignment: Alignment.topLeft,
        child: Material(
          elevation: 4,
          borderRadius: BorderRadius.circular(8),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 280, maxWidth: 420),
            child: ListView(shrinkWrap: true, padding: EdgeInsets.zero, children: [
              for (final o in options)
                ListTile(dense: true, title: Text('${o.name} · ${o.dept}'), subtitle: Text(o.email, style: TextStyle(color: Brand.muted)), onTap: () => onSelected(o)),
            ]),
          ),
        ),
      ),
    );
  }
}
