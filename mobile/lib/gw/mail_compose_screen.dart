import 'dart:typed_data';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import '../directory/org_directory.dart';
import '../messenger/messenger_api.dart' show fileExt;
import '../messenger/messenger_files.dart' show msgClipboardProvider, MsgPasteAction;
import '../messenger/messenger_models.dart' show msgImageExts;
import 'gw_api.dart';
import 'mail_compose.dart';

/// 메일 쓰기·답장·전체답장·전달 화면. 보내기는 확인을 받은 뒤에만(되돌릴 수 없음).
/// 받는 사람 칸은 쉼표로 여럿, 이름을 치면 사내 명부에서 고를 수 있다.
/// 복사한 그림·파일(⌘V·Ctrl+V)은 첨부로 붙는다(그림은 미리보기 칩). 글자만 있으면 평소 붙여넣기.

typedef MailContact = ({String name, String email, String dept});

/// 메일 주소록 = 사내 명부(주소 있는 사람). 테스트에서 override.
final mailContactsProvider = FutureProvider.autoDispose<List<MailContact>>((ref) async => [
      for (final p in await ref.watch(orgPeopleProvider.future))
        if (p.email.contains('@')) (name: p.name, email: p.email, dept: p.dept),
    ]);

/// 새로 붙일 파일 고르기. 테스트에서 override.
final mailFilePickerProvider = Provider<Future<List<({String name, List<int> bytes})>> Function()>((_) => () async {
  final files = await FilePicker.pickFiles();
  return [for (final f in files) (name: f.name, bytes: await f.readAsBytes())];
});

class MailComposeScreen extends ConsumerStatefulWidget {
  const MailComposeScreen({super.key, required this.api, this.kind = MailKind.plain, this.muid = '', this.mailTo = '', this.mbox = 'INBOX', this.initialTo = ''});
  final GwApi api;
  final MailKind kind;
  final String muid, mailTo, mbox;

  /// 새 메일의 받는 사람 미리 채우기(조직도에서 고른 사람 등).
  final String initialTo;
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
    _to.text = p.to.isEmpty ? widget.initialTo : p.to;
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

  /// 붙여넣기 — 클립보드의 파일·그림이면 첨부로(true), 글자면 평소 붙여넣기(false).
  Future<bool> _paste() async {
    final files = await ref.read(msgClipboardProvider)();
    if (files == null || files.isEmpty || !mounted) return false;
    setState(() => _newFiles.addAll(files));
    return true;
  }

  Widget _fileChip(({String name, List<int> bytes}) f) {
    final img = msgImageExts.contains(fileExt(f.name));
    return InputChip(
      avatar: img ? ClipRRect(borderRadius: BorderRadius.circular(3), child: Image.memory(Uint8List.fromList(f.bytes), width: 24, height: 24, fit: BoxFit.cover, errorBuilder: (_, _, _) => const Icon(Icons.image, size: 16))) : const Icon(Icons.upload_file, size: 16),
      label: Text(f.name),
      onDeleted: () => setState(() => _newFiles.remove(f)),
    );
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
            return Actions(actions: {PasteTextIntent: MsgPasteAction(_paste)}, child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
              _AddressField(label: '받는 사람', controller: _to, trailing: _showBcc ? null : TextButton(onPressed: () => setState(() => _showBcc = true), child: const Text('숨은 참조'))),
              _AddressField(label: '참조', controller: _cc),
              if (_showBcc) _AddressField(label: '숨은 참조', controller: _bcc),
              TextField(controller: _subject, decoration: const InputDecoration(labelText: '제목')),
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                  ActionChip(avatar: const Icon(Icons.attach_file, size: 16), label: const Text('파일 첨부'), onPressed: _sending ? null : _attach),
                  for (final f in _original) InputChip(avatar: const Icon(Icons.attach_file, size: 16), label: Text(f.name), onDeleted: () => setState(() => _original = [..._original]..remove(f))),
                  for (final f in _newFiles) _fileChip(f),
                ]),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _body,
                minLines: 10,
                maxLines: null,
                keyboardType: TextInputType.multiline,
                decoration: const InputDecoration(hintText: '내용', helperText: '복사한 그림·파일은 붙여넣기(⌘V·Ctrl+V)로 첨부됩니다', border: OutlineInputBorder()),
              ),
              if (mailSignatureHtml(_form).trim().isNotEmpty)
                CheckboxListTile(dense: true, contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading, value: _signature, onChanged: (v) => setState(() => _signature = v ?? true), title: const Text('서명 넣기')),
              if (_quote.isNotEmpty)
                Padding(padding: const EdgeInsets.only(top: 4), child: Text('원본 메일이 본문 아래에 붙습니다.', style: TextStyle(fontSize: 12, color: Brand.muted))),
            ]));
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
