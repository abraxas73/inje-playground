import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../assistant/innobot_prefs.dart';
import 'notifications.dart';

/// 앱 아이콘 배지 — 알림 센터 종의 안 읽은 수를 macOS Dock·Windows 작업 표시줄·iPhone 홈 화면 아이콘에도 띄운다.
/// Android는 런처 배지가 OS 알림 개수로만 붙어 숫자를 직접 정할 수 없다(제외).
const _channel = MethodChannel('com.innogrid.playground/badge');

bool get appBadgeSupported => !kIsWeb && const {TargetPlatform.macOS, TargetPlatform.windows, TargetPlatform.iOS}.contains(defaultTargetPlatform);

Future<void> setAppBadge(int n) async {
  if (!appBadgeSupported) return;
  try {
    await _channel.invokeMethod<void>('set', n < 0 ? 0 : n);
  } catch (_) {
    // 배지는 부가 기능 — 실패해도 앱 동작에는 영향 없음
  }
}

int? _shown;

/// main.dart builder에 한 번. 로그아웃(이노봇 레이어가 숨는 상태)이면 0으로 지운다.
class AppBadgeSync extends ConsumerWidget {
  const AppBadgeSync({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (appBadgeSupported) {
      final n = ref.watch(appBadgeCountProvider);
      if (n != _shown) {
        _shown = n; // 같은 수로 다시 그릴 때(화면 이동마다 builder가 다시 불림)는 네이티브를 부르지 않는다
        setAppBadge(n);
      }
    }
    return child;
  }
}

final appBadgeCountProvider = Provider<int>((ref) => ref.watch(innobotSignedInProvider) ? ref.watch(notifUnreadProvider) : 0);
