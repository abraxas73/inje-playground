import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:playground/release/linux_update_installer.dart';

const _rawKey = 'wjo0pJqYzJPCKdMg9nLwe9HfABRkLrerT+vtggDaqZs=';
final _sig = base64Encode(List.filled(64, 7));
const _url =
    'https://innocrew.innogrid.com/api/desktop/update/artifact/linux/1.8.0';

class _FakeClient extends http.BaseClient {
  _FakeClient(this.status, this.body);
  final int status;
  final List<int> body;
  final requests = <http.BaseRequest>[];

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    requests.add(request);
    return http.StreamedResponse(
      Stream.value(body),
      status,
      contentLength: body.length,
    );
  }
}

class _GatedClient extends _FakeClient {
  _GatedClient(this.gate, List<int> body) : super(200, body);
  final Future<void> gate;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    requests.add(request);
    await gate;
    return http.StreamedResponse(Stream.value(body), 200);
  }
}

class _Runs {
  final calls = <List<String>>[];
  final inPaths = <String>[];
  int openssl = 0;
  int pkexec = 0;
  Future<ProcessResult> run(String exe, List<String> args) async {
    calls.add([exe, ...args]);
    if (exe == 'openssl') {
      inPaths.add(args[args.indexOf('-in') + 1]);
      return ProcessResult(0, openssl, '', '');
    }
    if (exe == 'pkexec') return ProcessResult(0, pkexec, '', '');
    return ProcessResult(0, 0, '', '');
  }

  bool ran(String exe) => calls.any((c) => c.first == exe);
}

void main() {
  late Directory dir;
  late _Runs runs;
  late List<String> started;
  late int exits;

  setUp(() {
    dir = Directory.systemTemp.createTempSync('linux_installer_test');
    runs = _Runs();
    started = [];
    exits = 0;
  });
  tearDown(() => dir.deleteSync(recursive: true));

  LinuxUpdateInstaller make(
    http.Client client, {
    String key = _rawKey,
    ProcessRunner? run,
    Future<void> Function(String, List<String>)? start,
  }) => LinuxUpdateInstaller(
    client: client,
    run: run ?? runs.run,
    workDir: () async => dir,
    publicKeyRaw: key,
    exitApp: () => exits++,
    startDetached:
        start ??
        (exe, args) async {
          started.add([exe, ...args].join(' '));
        },
  );

  Future<LinuxUpdateResult> go(
    LinuxUpdateInstaller i, {
    int bytes = 3,
    String version = '1.8.0',
    String? sig,
    String token = 't',
  }) => i.install(
    version: version,
    expectedBytes: bytes,
    edSignature: sig ?? _sig,
    accessToken: token,
    onProgress: (_, _) {},
  );

  test('다운로드는 고정 주소에 Bearer로, 리다이렉트를 따르지 않는다', () async {
    final client = _FakeClient(302, const []);
    final result = await go(make(client));
    final req = client.requests.single as http.Request;
    expect(req.url.toString(), _url);
    expect(req.headers['Authorization'], 'Bearer t');
    expect(req.followRedirects, isFalse);
    expect(result, isA<LinuxUpdateFailed>());
    final failed = result as LinuxUpdateFailed;
    expect(failed.reason, 'download');
    expect(failed.code, 302);
  });

  test('길이가 다르면 verify·install을 부르지 않는다', () async {
    final result = await go(make(_FakeClient(200, [1, 2, 3])), bytes: 5);
    expect((result as LinuxUpdateFailed).reason, 'length');
    expect(runs.ran('openssl'), isFalse);
    expect(runs.ran('pkexec'), isFalse);
    expect(dir.listSync(), isEmpty);
  });

  test('서명이 틀리면 설치하지 않는다', () async {
    runs.openssl = 1;
    final result = await go(make(_FakeClient(200, [1, 2, 3])));
    expect((result as LinuxUpdateFailed).reason, 'signature');
    expect(runs.ran('pkexec'), isFalse);
    expect(dir.listSync(), isEmpty);
  });

  test('install은 verify를 통과한 경로만 넘긴다', () async {
    await go(make(_FakeClient(200, [1, 2, 3])));
    final pk = runs.calls.firstWhere((c) => c.first == 'pkexec');
    expect(pk.sublist(1), [
      '/usr/bin/apt-get',
      'install',
      '-y',
      runs.inPaths.single,
    ]);
    expect(runs.inPaths.single, startsWith('/'));
    expect(runs.inPaths.single, endsWith('INNOGRID-Linux-1.8.0_amd64.deb'));
  });

  test('pkexec 취소는 cancelled로 끝난다', () async {
    for (final code in [126, 127]) {
      runs = _Runs()..pkexec = code;
      final result = await go(make(_FakeClient(200, [1, 2, 3])));
      expect(result, isA<LinuxUpdateCancelled>());
      expect(dir.listSync(), isEmpty);
    }
  });

  test('pkexec 그 밖의 실패는 install', () async {
    runs.pkexec = 100;
    final result = await go(make(_FakeClient(200, [1, 2, 3])));
    final failed = result as LinuxUpdateFailed;
    expect(failed.reason, 'install');
    expect(failed.code, 100);
    expect(dir.listSync(), isEmpty);
  });

  test('성공하면 재실행 후 exitApp', () async {
    final result = await go(make(_FakeClient(200, [1, 2, 3])));
    expect(result, isA<LinuxUpdateDone>());
    expect(started, ['/bin/sh -c sleep 1; exec /usr/bin/innocrew']);
    expect(exits, 1);
  });

  test('재실행이 실패하면 launch', () async {
    final result = await go(
      make(
        _FakeClient(200, [1, 2, 3]),
        start: (_, _) async => throw const ProcessException('sh', []),
      ),
    );
    expect((result as LinuxUpdateFailed).reason, 'launch');
    expect(exits, 0);
  });

  test('키가 없으면 내려받지 않는다', () async {
    final client = _FakeClient(200, [1, 2, 3]);
    final result = await go(make(client, key: ''));
    final failed = result as LinuxUpdateFailed;
    expect(failed.reason, 'signature');
    expect(failed.code, 0);
    expect(client.requests, isEmpty);
  });

  test('버전 형식이 틀리면 요청 없이 download', () async {
    final client = _FakeClient(200, [1, 2, 3]);
    final result = await go(make(client), version: '1.8.0/../x');
    expect((result as LinuxUpdateFailed).reason, 'download');
    expect(client.requests, isEmpty);
  });

  test('토큰은 어떤 실행 인자·파일에도 없다', () async {
    // 성공 경로에서 파일이 남도록 pkexec를 가로채 작업 폴더를 읽는다.
    final seen = StringBuffer();
    Future<ProcessResult> spy(String exe, List<String> args) async {
      if (exe == 'pkexec') {
        for (final f in dir.listSync().whereType<File>()) {
          seen.write(latin1.decode(f.readAsBytesSync()));
        }
      }
      return runs.run(exe, args);
    }

    await go(
      make(_FakeClient(200, [1, 2, 3]), run: spy),
      token: 'tok-SECRET-9',
    );
    final args = runs.calls.expand((c) => c).join('\n');
    expect(args.contains('tok-SECRET-9'), isFalse);
    expect(seen.toString().contains('tok-SECRET-9'), isFalse);
    expect(seen.isNotEmpty, isTrue);
  });

  test('두 번째 install은 폴더를 건드리지 않고 실패하며 첫 번째는 정상 완료', () async {
    final gate = Completer<void>();
    final client = _GatedClient(gate.future, [1, 2, 3]);
    final installer = make(client);
    final first = go(installer);
    await Future<void>.delayed(const Duration(milliseconds: 50));
    final second = await go(installer);
    expect((second as LinuxUpdateFailed).reason, 'download');
    expect(client.requests.length, 1);
    gate.complete();
    expect(await first, isA<LinuxUpdateDone>());
  });

  test('verify 단계 예외는 signature, pkexec는 부르지 않는다', () async {
    final calls = <String>[];
    Future<ProcessResult> boom(String exe, List<String> args) async {
      calls.add(exe);
      throw const ProcessException('openssl', []);
    }

    final r = await go(make(_FakeClient(200, [1, 2, 3]), run: boom));
    expect((r as LinuxUpdateFailed).reason, 'signature');
    expect(calls, ['openssl']);
    expect(dir.listSync(), isEmpty);
  });

  test('pkexec 단계 예외는 install', () async {
    Future<ProcessResult> boom(String exe, List<String> args) async {
      if (exe == 'pkexec') throw const ProcessException('pkexec', []);
      return ProcessResult(0, 0, '', '');
    }

    final r = await go(make(_FakeClient(200, [1, 2, 3]), run: boom));
    final f = r as LinuxUpdateFailed;
    expect(f.reason, 'install');
    expect(f.code, 0);
    expect(dir.listSync(), isEmpty);
  });

  test('기본 작업 폴더는 XDG_CACHE_HOME 또는 ~/.cache, 상대 경로는 무시', () {
    expect(
      defaultLinuxUpdateDir(env: {'XDG_CACHE_HOME': '/x/c', 'HOME': '/h'}),
      '/x/c/INNOGRID/update',
    );
    expect(
      defaultLinuxUpdateDir(env: {'HOME': '/h'}),
      '/h/.cache/INNOGRID/update',
    );
    expect(
      defaultLinuxUpdateDir(env: {'XDG_CACHE_HOME': 'rel', 'HOME': '/h'}),
      '/h/.cache/INNOGRID/update',
    );
  });

  test('작업 폴더 권한은 0700', () async {
    final seen = <String>[];
    Future<ProcessResult> spy(String exe, List<String> args) async {
      if (exe == 'pkexec') {
        seen.add(
          Process.runSync('stat', [
            '-c',
            '%a',
            dir.path,
          ]).stdout.toString().trim(),
        );
      }
      return runs.run(exe, args);
    }

    dir.createSync(recursive: true);
    Process.runSync('chmod', ['755', dir.path]);
    await go(make(_FakeClient(200, [1, 2, 3]), run: spy));
    expect(seen, ['700']);
  }, skip: !Platform.isLinux);

  group('실제 openssl (RFC 8032 테스트 벡터 2, 1바이트 메시지)', () {
    List<int> hex(String s) => [
      for (var i = 0; i < s.length; i += 2)
        int.parse(s.substring(i, i + 2), radix: 16),
    ];
    final goodSig = hex(
      '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da'
      '085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00',
    );
    final key = base64Encode(
      hex('3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c'),
    );

    Future<LinuxUpdateResult> verify(List<int> sig) {
      Future<ProcessResult> real(String exe, List<String> args) async {
        if (exe == 'pkexec') return ProcessResult(0, 126, '', '');
        return Process.run(exe, args);
      }

      return go(
        make(_FakeClient(200, const [0x72]), key: key, run: real),
        bytes: 1,
        sig: base64Encode(sig),
      );
    }

    test('올바른 서명은 통과(pkexec 단계까지 감)', () async {
      expect(await verify(goodSig), isA<LinuxUpdateCancelled>());
    });

    test('1바이트 바꾼 서명은 거부', () async {
      final bad = [...goodSig]..[0] ^= 1;
      final r = await verify(bad);
      expect((r as LinuxUpdateFailed).reason, 'signature');
    });
  }, skip: !Platform.isLinux);
}
