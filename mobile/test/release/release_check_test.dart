import 'package:flutter_test/flutter_test.dart';
import 'package:playground/config.dart';
import 'package:playground/release/release_check.dart';

void main() {
  const server = {
    'notes': 'n',
    'android': {'version': '1.1.0', 'build': 3, 'releasedAt': '2026-10-04T06:00:00Z', 'url': 'https://x/apk'},
    'ios': {'version': '1.1.0', 'build': '3', 'releasedAt': '2026-10-04T06:30:00Z', 'url': null},
  };
  test('자기 플랫폼 블록만 읽는다 — build는 정수·정수 문자열 모두, url 없으면 null', () {
    final a = parseRelease(server, android: true)!;
    expect((a.version, a.build, a.url), ('1.1.0', 3, 'https://x/apk'));
    final i = parseRelease(server, android: false)!;
    expect((i.version, i.build, i.url), ('1.1.0', 3, null));
  });
  test('블록이 없거나 형식이 틀리면 null', () {
    expect(parseRelease({'android': null, 'ios': null}, android: true), isNull);
    expect(parseRelease({'ios': {'version': '1.0.0', 'build': 0}}, android: false), isNull);
    expect(parseRelease({'ios': {'version': '', 'build': 2}}, android: false), isNull);
    expect(parseRelease({'ios': {'version': '1.0.0', 'build': 'x'}}, android: false), isNull);
    expect(parseRelease('nope', android: true), isNull);
    expect(parseRelease({'android': {'version': '1.0.0', 'build': 2}}, android: false), isNull, reason: 'iOS 블록 없음');
  });
  test('hasUpdate — 서버 빌드가 커야 하고, 앱 빌드 0(개발)은 항상 false', () {
    const r = ReleaseInfo(version: '1.1.0', build: 3);
    expect(hasUpdate(r, 2), isTrue);
    expect(hasUpdate(r, 3), isFalse);
    expect(hasUpdate(r, 4), isFalse);
    expect(hasUpdate(r, 0), isFalse);
    expect(hasUpdate(null, 2), isFalse);
  });
  test('versionLabel — 1.0.0 (1), 개발 빌드는 dev; Config 기본값은 dev/0', () {
    expect(versionLabel('1.0.0', 1), '1.0.0 (1)');
    expect(versionLabel('dev', 0), 'dev');
    expect((Config.appVersion, Config.appBuild), ('dev', 0));
  });
}
