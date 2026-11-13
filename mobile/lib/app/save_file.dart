import 'dart:io';
import 'dart:typed_data';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'platform.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _lastDirKey = 'save_file_last_dir';

/// 저장 위치를 고르게 해 저장(취소면 null). 데스크톱은 지난번 저장한 폴더에서 대화상자를 연다 — 없으면 macOS가 홈을 연다(2026-10-26).
Future<Uri?> saveFileRememberingDir(String name, Uint8List bytes) async {
  final prefs = await SharedPreferences.getInstance();
  final last = prefs.getString(_lastDirKey);
  final saved = await FilePicker.saveFile(fileName: name, bytes: bytes, initialDirectory: last != null && Directory(last).existsSync() ? last : null);
  if (saved != null && saved.scheme == 'file') await prefs.setString(_lastDirKey, File.fromUri(saved).parent.path);
  return saved;
}

/// 저장 완료 알림 — 데스크톱에서 파일로 저장됐으면 알림(또는 [열기])을 눌러 기본 앱으로 연다.
/// 휴대폰은 저장 결과가 content:// 등이라 url_launcher로 못 열어 글자만(2026-11-13).
void showSavedFileSnack(ScaffoldMessengerState messenger, String name, Object? saved, {Future<bool> Function(Uri)? open}) {
  final uri = saved is Uri && saved.scheme == 'file' && isDesktopPlatform ? saved : null;
  if (uri == null) {
    messenger.showSnackBar(SnackBar(content: Text('저장했습니다: $name')));
    return;
  }
  Future<void> openIt({bool hide = false}) async {
    if (hide) messenger.hideCurrentSnackBar(); // [열기] 버튼은 스스로 닫힌다
    var ok = false;
    try {
      ok = await (open ?? launchUrl)(uri);
    } catch (_) {}
    if (!ok) messenger.showSnackBar(const SnackBar(content: Text('파일을 열지 못했습니다. 저장한 폴더에서 열어 주세요')));
  }
  messenger.showSnackBar(SnackBar(
    duration: const Duration(seconds: 8),
    content: MouseRegion(
      cursor: SystemMouseCursors.click,
      child: GestureDetector(behavior: HitTestBehavior.opaque, onTap: () => openIt(hide: true), child: Text('저장했습니다: $name — 눌러서 열기')),
    ),
    action: SnackBarAction(label: '열기', onPressed: openIt),
  ));
}
