import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/client.dart';
import 'release_check.dart';
import '../app/platform.dart';

/// 서버의 최신 릴리스(자기 플랫폼). 앱 프로세스당 1회. 실패는 null — 업데이트 안내는 부가 기능이라 오류 UI·로그 없음(토큰·URL을 찍지 않는다).
final releaseProvider = FutureProvider<ReleaseInfo?>((ref) async {
  // Desktop releases have their own distribution lifecycle.
  if (!isMobilePlatform) {
    return null;
  }
  try {
    final json = await ref.read(apiClientProvider).getJson('/api/mobile/release');
    return parseRelease(json, android: defaultTargetPlatform == TargetPlatform.android);
  } catch (_) {
    return null;
  }
});

/// 서버에 게시된 자기 플랫폼의 macOS/Windows 설치본. 실패는 업데이트 띠를 숨긴다.
final desktopReleaseProvider = FutureProvider<DesktopReleaseInfo?>((ref) async {
  // Linux 설치본은 서버가 아직 게시하지 않는다(platform 값은 macos·windows만)
  if (!isDesktopPlatform || defaultTargetPlatform == TargetPlatform.linux) {
    return null;
  }
  try {
    final platform = defaultTargetPlatform == TargetPlatform.macOS
        ? 'macos'
        : 'windows';
    final json = await ref
        .read(apiClientProvider)
        .getJson('/api/desktop/release', query: {'platform': platform});
    return parseDesktopRelease(json);
  } catch (_) {
    return null;
  }
});
