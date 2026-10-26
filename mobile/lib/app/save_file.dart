import 'dart:io';
import 'dart:typed_data';
import 'package:file_picker/file_picker.dart';
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
