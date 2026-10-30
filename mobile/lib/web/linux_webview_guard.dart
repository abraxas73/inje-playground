// Linux WebView(WebKitGTK)는 Flutter 화면 위에 얹힌 네이티브 위젯이라 그 영역의 Flutter 위젯을 모두 가린다.
// 그래서 (1) 겹칠 수 있는 오버레이가 열려 있는 동안은 WebView를 트리에서 빼고(페이지 상태는 컨트롤러가 갖고 있다),
// (2) 떠 있는 버튼 자리는 웹 화면 오른쪽에 따로 비워 둔다.
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../assistant/assistant_session.dart';
import '../assistant/innobot_prefs.dart';
import '../favorites/favorites_panel.dart';
import '../notifications/notifications.dart';

final _overlayChanged = Listenable.merge([innobotPopups, innobotFanOpen, notifOpen, favoritesOpen]);

/// 웹 화면 영역에 Flutter 오버레이(팝업·이노봇 창·하단 그룹 메뉴·알림·즐겨찾기 패널)가 떠 있는가.
bool get flutterOverlayOpen => innobotPopups.value > 0 || innobotFanOpen.value || notifOpen.value || favoritesOpen.value;

/// 떠 있는 버튼(56px + 오른쪽 여백 14px + 테두리·그림자)이 차지하는 폭.
const linuxFabStripWidth = 80.0;

class LinuxWebViewGuard extends StatelessWidget {
  const LinuxWebViewGuard({super.key, required this.child, this.avoidFabs = false});
  final Widget child;

  /// 전체 화면 웹 화면이면 true — 떠 있는 버튼이 보이는 동안 오른쪽을 비운다.
  final bool avoidFabs;

  @override
  Widget build(BuildContext context) {
    // 다른 화면에 덮였거나(맨 위가 아님) 안 보이는 탭·화면이면 네이티브 뷰가 그 위에 남지 않게 뺀다
    final onTop = (ModalRoute.of(context)?.isCurrent ?? true) && TickerMode.valuesOf(context).enabled;
    return ListenableBuilder(
      listenable: _overlayChanged,
      builder: (_, _) => !onTop || flutterOverlayOpen
          ? const SizedBox.expand()
          : avoidFabs
          ? _FabStrip(child: child)
          : child,
    );
  }
}

class _FabStrip extends ConsumerWidget {
  const _FabStrip({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // InnobotOverlay가 버튼을 그리는 조건과 같다(팝업·메뉴가 열린 경우는 위에서 이미 WebView를 뺐다)
    final shown =
        ref.watch(innobotSignedInProvider) &&
        ref.watch(assistantAvailableProvider) &&
        (ref.watch(innobotButtonPrefProvider).value ?? true) &&
        !ref.watch(innobotFabsHiddenProvider);
    return Padding(padding: EdgeInsets.only(right: shown ? linuxFabStripWidth : 0), child: child);
  }
}
