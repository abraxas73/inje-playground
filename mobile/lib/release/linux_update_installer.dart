import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import 'linux_update_key.dart';

typedef LinuxUpdateProgress = void Function(String phase, double? progress);
typedef ProcessRunner =
    Future<ProcessResult> Function(String exe, List<String> args);

sealed class LinuxUpdateResult {
  const LinuxUpdateResult();
}

class LinuxUpdateDone extends LinuxUpdateResult {
  const LinuxUpdateDone();
}

class LinuxUpdateCancelled extends LinuxUpdateResult {
  const LinuxUpdateCancelled();
}

class LinuxUpdateFailed extends LinuxUpdateResult {
  const LinuxUpdateFailed(this.reason, this.code);

  /// download | length | signature | auth | install | launch
  final String reason;

  /// 종료 코드 또는 HTTP 상태(0~255로 줄이지 않은 원값, 없으면 0).
  final int code;
}

const _artifactBase =
    'https://innocrew.innogrid.com/api/desktop/update/artifact/linux';

/// `$XDG_CACHE_HOME/INNOGRID/update`, 없거나 상대 경로면 `~/.cache/INNOGRID/update`.
String defaultLinuxUpdateDir({Map<String, String>? env}) {
  final e = env ?? Platform.environment;
  final xdg = e['XDG_CACHE_HOME'];
  if (xdg != null && xdg.startsWith('/')) return '$xdg/INNOGRID/update';
  return '${e['HOME'] ?? ''}/.cache/INNOGRID/update';
}

final _versionPattern = RegExp(r'^\d+\.\d+\.\d+$');

/// Linux .deb 업데이트: 고정 주소 내려받기 → 길이·Ed25519 서명 확인 → pkexec 설치 → 재실행.
class LinuxUpdateInstaller {
  LinuxUpdateInstaller({
    required this.client,
    required this.run,
    Future<Directory> Function()? workDir,
    required this.publicKeyRaw,
    this.exitApp,
    Future<void> Function(String exe, List<String> args)? startDetached,
  }) : workDir = workDir ?? (() async => Directory(defaultLinuxUpdateDir())),
       _startDetached = startDetached ?? _defaultStartDetached;

  final http.Client client;
  final ProcessRunner run;
  final Future<Directory> Function() workDir;
  final String publicKeyRaw;
  final void Function()? exitApp;
  final Future<void> Function(String exe, List<String> args) _startDetached;

  bool _cancelled = false;
  bool _running = false;
  Directory? _dir;

  static Future<void> _defaultStartDetached(String exe, List<String> args) =>
      Process.start(exe, args, mode: ProcessStartMode.detached);

  Future<LinuxUpdateResult> install({
    required String version,
    required int expectedBytes,
    required String edSignature,
    required String accessToken,
    required LinuxUpdateProgress onProgress,
  }) async {
    // 같은 작업 폴더·파일 이름을 두 번째 호출이 덮어쓰지 못하게 막는다.
    if (_running) return const LinuxUpdateFailed('download', 0);
    _running = true;
    try {
      return await _install(
        version: version,
        expectedBytes: expectedBytes,
        edSignature: edSignature,
        accessToken: accessToken,
        onProgress: onProgress,
      );
    } finally {
      _running = false;
    }
  }

  Future<LinuxUpdateResult> _install({
    required String version,
    required int expectedBytes,
    required String edSignature,
    required String accessToken,
    required LinuxUpdateProgress onProgress,
  }) async {
    _cancelled = false;
    if (!_versionPattern.hasMatch(version)) {
      return const LinuxUpdateFailed('download', 0);
    }
    final pem = linuxUpdatePublicKeyPem(publicKeyRaw);
    final sig = _decodeSignature(edSignature);
    if (pem == null || sig == null) {
      return const LinuxUpdateFailed('signature', 0);
    }

    final Directory dir;
    try {
      dir = await _prepareDir();
    } on Object {
      return const LinuxUpdateFailed('download', 0);
    }
    if (!dir.absolute.path.startsWith('/')) {
      return const LinuxUpdateFailed('download', 0);
    }
    final deb = File(
      '${dir.absolute.path}/INNOGRID-Linux-${version}_amd64.deb',
    );
    var succeeded = false;
    try {
      final failure = await _download(
        version,
        deb,
        expectedBytes,
        accessToken,
        onProgress,
      );
      if (_cancelled) return const LinuxUpdateCancelled();
      if (failure != null) return failure;

      onProgress('verifying', null);
      final ProcessResult verify;
      try {
        final sigFile = File('${deb.path}.sig')..writeAsBytesSync(sig);
        final keyFile = File('${dir.absolute.path}/key.pem')
          ..writeAsStringSync(pem);
        verify = await run('openssl', [
          'pkeyutl',
          '-verify',
          '-pubin',
          '-inkey',
          keyFile.path,
          '-rawin',
          '-in',
          deb.path,
          '-sigfile',
          sigFile.path,
        ]);
      } on Object {
        return const LinuxUpdateFailed('signature', 0);
      }
      if (verify.exitCode != 0) {
        return const LinuxUpdateFailed('signature', 0);
      }
      if (_cancelled) return const LinuxUpdateCancelled();

      onProgress('installing', null);
      final ProcessResult apt;
      try {
        apt = await run('pkexec', [
          '/usr/bin/apt-get',
          'install',
          '-y',
          deb.path,
        ]);
      } on Object {
        return const LinuxUpdateFailed('install', 0);
      }
      if (apt.exitCode == 126 || apt.exitCode == 127) {
        return const LinuxUpdateCancelled();
      }
      if (apt.exitCode != 0) return LinuxUpdateFailed('install', apt.exitCode);

      try {
        await _startDetached('/bin/sh', [
          '-c',
          'sleep 1; exec /usr/bin/innocrew',
        ]);
      } on Object {
        return const LinuxUpdateFailed('launch', 0);
      }
      succeeded = true;
      exitApp?.call();
      return const LinuxUpdateDone();
    } finally {
      if (!succeeded) _clear(dir);
    }
  }

  Future<void> cancel() async {
    _cancelled = true;
    final dir = _dir;
    if (dir != null) _clear(dir);
  }

  List<int>? _decodeSignature(String value) {
    try {
      final bytes = base64Decode(value);
      return bytes.length == 64 ? bytes : null;
    } on FormatException {
      return null;
    }
  }

  Future<Directory> _prepareDir() async {
    final dir = await workDir();
    await dir.create(recursive: true);
    // 토큰·키 파일이 다른 사용자에게 보이지 않게 소유자만 접근한다.
    final chmod = await Process.run('chmod', ['700', dir.absolute.path]);
    if (chmod.exitCode != 0) throw const FileSystemException('chmod');
    _clear(dir);
    _dir = dir;
    return dir;
  }

  void _clear(Directory dir) {
    try {
      if (!dir.existsSync()) return;
      for (final entity in dir.listSync()) {
        entity.deleteSync(recursive: true);
      }
    } on FileSystemException {
      // 지우지 못해도 다음 실행이 다시 비운다.
    }
  }

  Future<LinuxUpdateFailed?> _download(
    String version,
    File target,
    int expectedBytes,
    String accessToken,
    LinuxUpdateProgress onProgress,
  ) async {
    final request = http.Request('GET', Uri.parse('$_artifactBase/$version'))
      ..followRedirects = false
      ..headers['Authorization'] = 'Bearer $accessToken';
    onProgress('downloading', 0);
    IOSink? sink;
    try {
      final response = await client.send(request);
      if (response.statusCode != 200) {
        return LinuxUpdateFailed('download', response.statusCode);
      }
      sink = target.openWrite();
      var received = 0;
      await for (final chunk in response.stream) {
        if (_cancelled) return null;
        received += chunk.length;
        if (received > expectedBytes) {
          return const LinuxUpdateFailed('length', 0);
        }
        sink.add(chunk);
        onProgress(
          'downloading',
          expectedBytes > 0 ? received / expectedBytes : null,
        );
      }
      if (received != expectedBytes) {
        return const LinuxUpdateFailed('length', 0);
      }
      return null;
    } on Object {
      return const LinuxUpdateFailed('download', 0);
    } finally {
      await sink?.close();
    }
  }
}
