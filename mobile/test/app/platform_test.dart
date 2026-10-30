import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/app/platform.dart';

void main() {
  tearDown(() => debugDefaultTargetPlatformOverride = null);

  test('플랫폼별 데스크톱·모바일 판별', () {
    const expected = {
      TargetPlatform.macOS: (true, false),
      TargetPlatform.windows: (true, false),
      TargetPlatform.iOS: (false, true),
      TargetPlatform.android: (false, true),
      TargetPlatform.linux: (true, false),
      TargetPlatform.fuchsia: (false, false),
    };
    for (final e in expected.entries) {
      debugDefaultTargetPlatformOverride = e.key;
      expect((isDesktopPlatform, isMobilePlatform), e.value, reason: e.key.name);
    }
  });

  test('Claude 데스크톱 앱이 있는 플랫폼은 macOS·Windows뿐(Linux용은 없다)', () {
    const expected = {
      TargetPlatform.macOS: true,
      TargetPlatform.windows: true,
      TargetPlatform.linux: false,
      TargetPlatform.iOS: false,
      TargetPlatform.android: false,
    };
    for (final e in expected.entries) {
      debugDefaultTargetPlatformOverride = e.key;
      expect(hasClaudeDesktopApp, e.value, reason: e.key.name);
    }
  });
}
