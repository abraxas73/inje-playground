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
import '../gw/board_screen.dart';
import '../messenger/messenger_chat_screen.dart';
import '../messenger/messenger_models.dart';
import '../messenger/messenger_notes_screen.dart';
import '../messenger/messenger_attend_screen.dart';
import '../gw/gw_connect_screen.dart';
import '../gw/mail_screen.dart';
import '../gw/today_screen.dart';
import 'tab_shell.dart';
import '../assistant/innobot_prefs.dart';
import '../dooray/calendar_screen.dart';

/// 하단 탭을 누를 때마다 1 증가 — 탭 화면(IndexedStack에 살아 있음)이 이걸 듣고 서버 데이터(내 팀 등)를 다시 불러온다.
/// 하단 바 브랜치 인덱스(홈). 셸·홈 화면·홈 카드가 "홈 탭을 눌렀을 때만" 다시 수집하도록 공유한다.
const homeBranch = 0;

/// 하단 바에서 브랜치를 누를 때마다 seq가 오르고 branch에 누른 브랜치가 실린다 — 듣는 쪽은 자기 브랜치일 때만 반응한다.
class TabTap extends Notifier<({int seq, int branch})> {
  @override
  ({int seq, int branch}) build() => (seq: 0, branch: homeBranch);
  void bump(int branch) => state = (seq: state.seq + 1, branch: branch);
}

final tabTapProvider = NotifierProvider<TabTap, ({int seq, int branch})>(TabTap.new);

GoRouter buildRouter({
  required Listenable refresh,
  required String? Function(BuildContext, GoRouterState) redirect,
}) => GoRouter(
  initialLocation: '/home',
  observers: [InnobotPopupObserver()], // 시트·대화상자가 열리면 떠 있는 이노봇을 숨긴다(브랜치마다 하나씩)
  refreshListenable: refresh,
  redirect: redirect,
  routes: [
    GoRoute(path: '/splash', builder: (c, s) => const SplashScreen()),
    GoRoute(path: '/login', builder: (c, s) => const LoginScreen()),
    GoRoute(path: '/guest', builder: (c, s) => const GuestScreen()),
    // 아마란스 연결은 하단 바 틀 밖(루트 내비게이터) — 1.7.16에 틀 안으로 옮긴 뒤 iPhone(iOS 27)에서 입력칸 포커스 때 화면이 새로 그려졌다(2026-10-20)
    GoRoute(path: '/gw/connect', builder: (c, s) => const GwConnectScreen()),
    // 하단 바 틀: 탭 화면과 그 안에서 연 웹·아마란스·Dooray 화면 모두 같은 바 아래(push는 이 틀의 내비게이터에 쌓인다)
    ShellRoute(
      observers: [InnobotPopupObserver()],
      builder: (c, s, child) => TabShell(child: child),
      routes: [
    GoRoute(
      path: '/web',
      builder: (c, s) => WebScreen(path: s.uri.queryParameters['path'] ?? '/'),
    ),
    GoRoute(path: '/dooray/calendar', builder: (c, s) => const DoorayCalendarScreen()),
    GoRoute(path: '/gw/approvals', builder: (c, s) => const ApprovalsScreen()),
    GoRoute(path: '/gw/attendance', builder: (c, s) => const AttendanceScreen()),
    GoRoute(path: '/gw/today', builder: (c, s) => const TodayScreen()),
    GoRoute(path: '/gw/mail', builder: (c, s) => const MailScreen()),
    GoRoute(path: '/gw/board', builder: (c, s) => BoardScreen(initialArt: s.uri.queryParameters['art'])),
    GoRoute(path: '/gw/messenger', builder: (c, s) => const MessengerChatScreen()),
    GoRoute(path: '/gw/room', builder: (c, s) => MessengerRoomScreen(room: MsgRoom.minimal(s.uri.queryParameters['id'] ?? '', title: s.uri.queryParameters['title'] ?? '대화'))),
    GoRoute(path: '/gw/notes', builder: (c, s) => const MessengerNotesScreen()),
    GoRoute(path: '/gw/attend', builder: (c, s) => const MessengerAttendScreen()),
    StatefulShellRoute.indexedStack(
      builder: (c, s, shell) => TabShell.attach(shell),
      branches: [
        StatefulShellBranch(
          observers: [InnobotPopupObserver()],
          routes: [
            GoRoute(path: '/home', builder: (c, s) => const HomeScreen()),
          ],
        ),
        StatefulShellBranch(
          observers: [InnobotPopupObserver()],
          routes: [
            GoRoute(path: '/food', builder: (c, s) => const FoodScreen()),
          ],
        ),
        StatefulShellBranch(
          observers: [InnobotPopupObserver()],
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
          observers: [InnobotPopupObserver()],
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
          observers: [InnobotPopupObserver()],
          routes: [
            GoRoute(path: '/more', builder: (c, s) => const MoreScreen()),
          ],
        ),
      ],
    ),
      ],
    ),
  ],
);
