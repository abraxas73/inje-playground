import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../auth/guest_screen.dart';
import '../auth/login_screen.dart';
import '../auth/splash_screen.dart';
import '../more/more_screen.dart';
import '../web/web_screen.dart';
import '../features/food/food_screen.dart';
import '../features/home/home_screen.dart';
import '../features/ladder/history_screen.dart';
import '../features/ladder/ladder_screen.dart';
import '../features/team/history_screen.dart';
import '../features/team/team_screen.dart';
import '../gw/approvals_screen.dart';
import '../gw/attendance_screen.dart';
import '../gw/gw_connect_screen.dart';
import 'tab_shell.dart';

/// 하단 탭을 누를 때마다 1 증가 — 탭 화면(IndexedStack에 살아 있음)이 이걸 듣고 서버 데이터(내 팀 등)를 다시 불러온다.
class TabTap extends Notifier<int> {
  @override
  int build() => 0;
  void bump() => state++;
}

final tabTapProvider = NotifierProvider<TabTap, int>(TabTap.new);

GoRouter buildRouter({
  required Listenable refresh,
  required String? Function(BuildContext, GoRouterState) redirect,
}) => GoRouter(
  initialLocation: '/home',
  refreshListenable: refresh,
  redirect: redirect,
  routes: [
    GoRoute(path: '/splash', builder: (c, s) => const SplashScreen()),
    GoRoute(path: '/login', builder: (c, s) => const LoginScreen()),
    GoRoute(path: '/guest', builder: (c, s) => const GuestScreen()),
    GoRoute(
      path: '/web',
      builder: (c, s) => WebScreen(path: s.uri.queryParameters['path'] ?? '/'),
    ),
    GoRoute(path: '/gw/connect', builder: (c, s) => const GwConnectScreen()),
    GoRoute(path: '/gw/approvals', builder: (c, s) => const ApprovalsScreen()),
    GoRoute(path: '/gw/attendance', builder: (c, s) => const AttendanceScreen()),
    StatefulShellRoute.indexedStack(
      builder: (c, s, shell) => TabShell(shell: shell),
      branches: [
        StatefulShellBranch(
          routes: [
            GoRoute(path: '/home', builder: (c, s) => const HomeScreen()),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(path: '/food', builder: (c, s) => const FoodScreen()),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/ladder',
              builder: (c, s) => const LadderScreen(),
              routes: [
                GoRoute(
                  path: 'history',
                  builder: (c, s) => const LadderHistoryScreen(),
                ),
              ],
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/team',
              builder: (c, s) => const TeamScreen(),
              routes: [
                GoRoute(
                  path: 'history',
                  builder: (c, s) => const TeamHistoryScreen(),
                ),
              ],
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(path: '/more', builder: (c, s) => const MoreScreen()),
          ],
        ),
      ],
    ),
  ],
);
