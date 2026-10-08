import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/client.dart';
import 'release_check.dart';

/// 서버의 최신 릴리스(자기 플랫폼). 앱 프로세스당 1회. 실패는 null — 업데이트 안내는 부가 기능이라 오류 UI·로그 없음(토큰·URL을 찍지 않는다).
final releaseProvider = FutureProvider<ReleaseInfo?>((ref) async {
  // Desktop releases have their own distribution lifecycle.
  if (kIsWeb || (defaultTargetPlatform != TargetPlatform.android &&
      defaultTargetPlatform != TargetPlatform.iOS)) {
    return null;
  }
  try {
    final json = await ref.read(apiClientProvider).getJson('/api/mobile/release');
    return parseRelease(json, android: defaultTargetPlatform == TargetPlatform.android);
  } catch (_) {
    return null;
  }
});
