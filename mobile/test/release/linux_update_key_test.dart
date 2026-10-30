import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:playground/release/linux_update_key.dart';

const _rawKey = 'wjo0pJqYzJPCKdMg9nLwe9HfABRkLrerT+vtggDaqZs=';

void main() {
  test('raw 32바이트 키를 SPKI PEM으로 바꾼다', () {
    final pem = linuxUpdatePublicKeyPem(_rawKey);
    expect(pem, startsWith('-----BEGIN PUBLIC KEY-----'));
    expect(pem, endsWith('-----END PUBLIC KEY-----\n'));
  });

  test('openssl이 PEM을 읽는다', () async {
    final pem = linuxUpdatePublicKeyPem(_rawKey)!;
    final dir = Directory.systemTemp.createTempSync('linux_key_test');
    addTearDown(() => dir.deleteSync(recursive: true));
    final file = File('${dir.path}/key.pem')..writeAsStringSync(pem);
    final result = await Process.run('openssl', [
      'pkey',
      '-pubin',
      '-noout',
      '-in',
      file.path,
    ]);
    expect(result.exitCode, 0, reason: '${result.stderr}');
  }, skip: !Platform.isLinux);

  test('32바이트가 아니거나 base64가 아니면 null', () {
    expect(linuxUpdatePublicKeyPem('AAAA'), isNull);
    expect(linuxUpdatePublicKeyPem('!!not base64!!'), isNull);
    expect(linuxUpdatePublicKeyPem(''), isNull);
  });
}
