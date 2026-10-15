import 'dart:io';
import 'dart:math' as math;
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/client.dart';
import '../auth/session.dart';

/// 로그인했는지(떠 있는 이노봇 버튼 표시 조건). 테스트에서 override.
final innobotSignedInProvider = Provider<bool>((ref) => ref.watch(sessionProvider).asData?.value != null);

/// 계정 설정 user_settings.innobot_button(on|off, 빈 값 = on) — 떠 있는 이노봇 버튼 표시. 계정 단위라 모든 기기의 앱에 적용. 읽기 실패·로그아웃이면 표시.
final innobotButtonPrefProvider = AsyncNotifierProvider<InnobotButtonPref, bool>(InnobotButtonPref.new);

class InnobotButtonPref extends AsyncNotifier<bool> {
  @override
  Future<bool> build() async {
    if (!ref.watch(innobotSignedInProvider)) return true;
    try {
      final j = await ref.read(apiClientProvider).getJson('/api/users/settings', query: const {'key': 'innobot_button'});
      return !(j is Map && j['innobot_button'] == 'off');
    } catch (_) {
      return true;
    }
  }

  /// 바로 반영하고 서버에 저장. 실패하면 이전 값으로 되돌리고 false.
  Future<bool> set(bool on) async {
    final prev = state.value ?? true;
    state = AsyncData(on);
    try {
      await ref.read(apiClientProvider).putJson('/api/users/settings', {'key': 'innobot_button', 'value': on ? 'on' : 'off'});
      return true;
    } catch (_) {
      if (ref.mounted) state = AsyncData(prev);
      return false;
    }
  }
}

/// 열린 팝업(시트·대화상자·메뉴) 수 — 앱 전체 위에 떠 있는 버튼이 그 위를 덮지 않게 숨긴다. 내비게이터마다 InnobotPopupObserver를 하나씩 단다.
final innobotPopups = ValueNotifier<int>(0);

/// 하단 바 그룹 메뉴가 펼쳐져 있는지(TabShell이 갱신) — 펼친 항목을 가리지 않게 숨긴다.
final innobotFanOpen = ValueNotifier<bool>(false);

class InnobotPopupObserver extends NavigatorObserver {
  void _bump(Route<dynamic>? r, int d) {
    if (r is PopupRoute) innobotPopups.value = math.max(0, innobotPopups.value + d);
  }

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) => _bump(route, 1);
  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) => _bump(route, -1);
  @override
  void didRemove(Route<dynamic> route, Route<dynamic>? previousRoute) => _bump(route, -1);
  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) {
    _bump(oldRoute, -1);
    _bump(newRoute, 1);
  }
}

const _hiddenPaths = {'/splash', '/login', '/guest'};
const _tabPaths = ['/home', '/food', '/ladder', '/team', '/more'];

/// 하단 바가 있는 탭 화면인가(버튼을 바 위로 올린다).
bool isTabPath(String path) => _tabPaths.any((t) => path == t || path.startsWith('$t/'));

bool innobotOverlayVisible({required bool signedIn, required String path, required int popups, required bool fanOpen, required bool enabled, required bool available}) =>
    signedIn && available && enabled && popups == 0 && !fanOpen && !_hiddenPaths.contains(path);

/// Claude 열기 버튼은 데스크톱 홈에서만.
bool showsClaudeAt(String path, {bool? desktop}) => (desktop ?? (Platform.isMacOS || Platform.isWindows)) && path == '/home';
