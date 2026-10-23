import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pasteboard/pasteboard.dart';
import '../app/theme.dart';
import 'messenger_api.dart';
import 'messenger_models.dart';
import 'messenger_provider.dart';

/// 메신저 첨부 — 대화의 그림·파일 보기/받기, 파일 고르기·붙여넣기로 보내기.
/// 규격은 메신저 앱 `DZChatItem.vue`(썸네일·받기)·`DZChatView.vue`(업로드·붙여넣기)와 같다.

typedef MsgUpload = ({String name, Uint8List bytes});

// ponytail: 썸네일은 메신저 세션(API) 동안 메모리에 쌓기만 한다 — 많아지면 LRU로
final _thumbCache = Expando<Map<String, Future<Uint8List>>>();

/// 대화 한 건의 첨부(그림은 미리보기, 그 밖은 이름·크기·받기).
class MsgAttachments extends ConsumerWidget {
  const MsgAttachments({super.key, required this.chat, required this.mine, required this.maxWidth});
  final MsgChat chat;
  final bool mine;
  final double maxWidth;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (chat.fileExpired) return _note('보관 기간이 지나 지워진 파일입니다.');
    final api = ref.read(messengerApiProvider);
    final images = [for (final f in chat.files) if (f.isImage) f];
    final others = [for (final f in chat.files) if (!f.isImage) f];
    return Column(crossAxisAlignment: mine ? CrossAxisAlignment.end : CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
      if (images.isNotEmpty)
        Wrap(spacing: 4, runSpacing: 4, alignment: mine ? WrapAlignment.end : WrapAlignment.start, children: [
          for (final f in images) _thumb(context, api, f, images.length == 1 ? maxWidth.clamp(80, 300).toDouble() : 120),
        ]),
      for (final f in others) _fileTile(context, api, f),
    ]);
  }

  Widget _note(String t) => Padding(padding: const EdgeInsets.symmetric(vertical: 4), child: Text(t, style: TextStyle(fontSize: 12, color: Brand.muted, fontStyle: FontStyle.italic)));

  Widget _thumb(BuildContext context, MessengerApi api, MsgFile f, double w) {
    final h = f.width > 0 && f.height > 0 ? (w * f.height / f.width).clamp(60, 400).toDouble() : 150.0;
    final thumbs = _thumbCache[api] ??= {};
    final bytes = thumbs.putIfAbsent('${chat.chatId}/${f.fileSn}', () => api.thumbnail(chat.chatId, f.fileSn))..catchError((_) {
      thumbs.remove('${chat.chatId}/${f.fileSn}'); // 실패는 다음에 다시
      return Uint8List(0);
    });
    return Tooltip(
      message: f.name,
      child: InkWell(
        onTap: () => showMsgImage(context, api, chat.chatId, f),
        borderRadius: BorderRadius.circular(10),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: SizedBox(
            width: w,
            height: h,
            child: FutureBuilder<Uint8List>(
              future: bytes,
              builder: (_, s) => s.hasData && s.data!.isNotEmpty
                  ? Image.memory(s.data!, fit: BoxFit.cover, gaplessPlayback: true, errorBuilder: (_, _, _) => _broken())
                  : s.hasError
                      ? _broken()
                      : ColoredBox(color: Brand.fill, child: const Center(child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)))),
            ),
          ),
        ),
      ),
    );
  }

  Widget _broken() => ColoredBox(color: Brand.fill, child: Center(child: Icon(Icons.broken_image_outlined, color: Brand.faint)));

  Widget _fileTile(BuildContext context, MessengerApi api, MsgFile f) => Container(
        margin: const EdgeInsets.symmetric(vertical: 2),
        constraints: BoxConstraints(maxWidth: maxWidth.clamp(200, 360).toDouble()),
        child: Material(
          color: Brand.surface,
          shape: RoundedRectangleBorder(side: BorderSide(color: Brand.line), borderRadius: BorderRadius.circular(12)),
          clipBehavior: Clip.antiAlias,
          child: ListTile(
            dense: true,
            leading: Icon(Icons.insert_drive_file_outlined, color: Brand.blue),
            title: Text(f.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
            subtitle: f.size > 0 ? Text(msgFileSize(f.size), style: TextStyle(fontSize: 11, color: Brand.muted)) : null,
            trailing: Icon(Icons.download_rounded, color: Brand.muted),
            onTap: () => saveMsgFile(context, api, chat.chatId, f),
          ),
        ),
      );
}

String msgFileSize(int b) => b >= 1048576 ? '${(b / 1048576).toStringAsFixed(1)}MB' : b >= 1024 ? '${(b / 1024).toStringAsFixed(0)}KB' : '${b}B';

/// 원본을 받아 저장 위치를 고르게 한다.
Future<void> saveMsgFile(BuildContext context, MessengerApi api, String chatId, MsgFile f, {Uint8List? bytes}) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    final data = bytes ?? await api.file(chatId, f.fileSn);
    final saved = await FilePicker.saveFile(fileName: f.name, bytes: data);
    if (saved != null) messenger.showSnackBar(SnackBar(content: Text('저장했습니다: ${f.name}')));
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text('받지 못했습니다: $e')));
  }
}

/// 그림 원본 크게 보기(확대·저장).
Future<void> showMsgImage(BuildContext context, MessengerApi api, String chatId, MsgFile f) {
  final original = api.file(chatId, f.fileSn);
  return showDialog<void>(
    context: context,
    builder: (ctx) => Dialog(
      insetPadding: const EdgeInsets.all(24),
      clipBehavior: Clip.antiAlias,
      child: FutureBuilder<Uint8List>(
        future: original,
        builder: (ctx, s) => Column(mainAxisSize: MainAxisSize.min, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
            child: Row(children: [
              Expanded(child: Text(f.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700))),
              IconButton(tooltip: '저장', onPressed: s.hasData ? () => saveMsgFile(ctx, api, chatId, f, bytes: s.data) : null, icon: const Icon(Icons.download_rounded)),
              IconButton(tooltip: '닫기', onPressed: () => Navigator.of(ctx).pop(), icon: const Icon(Icons.close)),
            ]),
          ),
          Flexible(
            child: s.hasData
                ? InteractiveViewer(maxScale: 5, child: Image.memory(s.data!))
                : Padding(padding: const EdgeInsets.all(48), child: s.hasError ? Text('불러오지 못했습니다: ${s.error}') : const CircularProgressIndicator()),
          ),
        ]),
      ),
    ),
  );
}

/// 파일 골라 보내기용 — 고른 파일들의 이름·내용. 취소면 빈 목록. 테스트에서 override.
final msgFilePickerProvider = Provider<Future<List<MsgUpload>> Function()>((_) => () async {
  final files = await FilePicker.pickFiles();
  return [for (final f in files) (name: f.name, bytes: await f.readAsBytes())];
});

/// 붙여넣기에서 보낼 것 고르기. 테스트에서 override.
final msgClipboardProvider = Provider<Future<List<MsgUpload>?> Function()>((_) => clipboardUploads);

/// 클립보드에서 보낼 것 — 복사한 파일(데스크톱 탐색기·Finder) 또는 그림. 글자만 있으면 null(평소 붙여넣기).
/// 글자가 함께 있으면 글자를 우선한다(문서 앱은 글자를 복사해도 그림 표현을 같이 올려 둔다).
Future<List<MsgUpload>?> clipboardUploads() async {
  try {
    final paths = await Pasteboard.files();
    if (paths.isNotEmpty) {
      return [for (final p in paths) if (File(p).existsSync()) (name: p.split(Platform.pathSeparator).last, bytes: await File(p).readAsBytes())];
    }
  } catch (_) {}
  final text = (await Clipboard.getData(Clipboard.kTextPlain))?.text ?? '';
  if (text.isNotEmpty) return null;
  try {
    final img = await Pasteboard.image;
    if (img != null && img.isNotEmpty) return [(name: '${captureName(DateTime.now())}.${imageExtOf(img)}', bytes: img)];
  } catch (_) {}
  return null;
}

/// 붙여넣은 그림 이름 — 메신저 앱과 같은 YYYYMMDD_HH_mm_ss.
String captureName(DateTime t) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${t.year}${two(t.month)}${two(t.day)}_${two(t.hour)}_${two(t.minute)}_${two(t.second)}';
}

/// 그림 바이트의 형식 — macOS 클립보드는 PNG, Windows는 BMP로 준다.
String imageExtOf(Uint8List b) {
  if (b.length > 3 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E) return 'png';
  if (b.length > 2 && b[0] == 0xFF && b[1] == 0xD8) return 'jpg';
  if (b.length > 2 && b[0] == 0x42 && b[1] == 0x4D) return 'bmp';
  if (b.length > 3 && b[0] == 0x47 && b[1] == 0x49 && b[2] == 0x46) return 'gif';
  return 'png';
}

/// 입력창의 붙여넣기(⌘V·Ctrl+V)를 가로챈다 — [onPaste]가 true면 처리 끝, false면 평소 글자 붙여넣기.
class MsgPasteAction extends Action<PasteTextIntent> {
  MsgPasteAction(this.onPaste);
  final Future<bool> Function() onPaste;
  @override
  Object? invoke(PasteTextIntent intent) {
    final fallback = callingAction;
    onPaste().then((handled) {
      if (!handled) fallback?.invoke(intent);
    });
    return null;
  }
}

/// 보내기 전 확인 — 붙여넣은 그림은 미리보기, 파일은 이름 목록.
Future<bool> confirmMsgUploads(BuildContext context, List<MsgUpload> files) async {
  final single = files.length == 1 && msgImageExts.contains(fileExt(files.first.name)) ? files.first : null;
  return await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(single != null ? '그림 보내기' : '파일 ${files.length}개 보내기'),
          content: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420, maxHeight: 360),
            child: single != null
                ? Image.memory(single.bytes, fit: BoxFit.contain)
                : SingleChildScrollView(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      for (final f in files) Padding(padding: const EdgeInsets.symmetric(vertical: 2), child: Text('${f.name} · ${msgFileSize(f.bytes.length)}')),
                    ]),
                  ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('취소')),
            FilledButton(autofocus: true, onPressed: () => Navigator.of(ctx).pop(true), child: const Text('보내기')),
          ],
        ),
      ) ??
      false;
}
