import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../auth/guest_screen.dart';
import '../auth/login_screen.dart';
import '../more/more_screen.dart';
import '../web/web_screen.dart';
import '../features/food/food_screen.dart';
import '../features/ladder/history_screen.dart';
import '../features/ladder/ladder_screen.dart';
import '../features/team/history_screen.dart';
import '../features/team/team_screen.dart';

GoRouter buildRouter({required Listenable refresh, required String? Function(BuildContext, GoRouterState) redirect}) => GoRouter(
      initialLocation: '/food',
      refreshListenable: refresh,
      redirect: redirect,
      routes: [
        GoRoute(path: '/login', builder: (c, s) => const LoginScreen()),
        GoRoute(path: '/guest', builder: (c, s) => const GuestScreen()),
        GoRoute(path: '/web', builder: (c, s) => WebScreen(path: s.uri.queryParameters['path'] ?? '/')),
        StatefulShellRoute.indexedStack(
          builder: (c, s, shell) => Scaffold(
            body: shell,
            bottomNavigationBar: NavigationBar(
              selectedIndex: shell.currentIndex,
              onDestinationSelected: (i) => shell.goBranch(i, initialLocation: i == shell.currentIndex),
              destinations: const [
                NavigationDestination(icon: Icon(Icons.restaurant), label: '뭐 먹지'),
                NavigationDestination(icon: Icon(Icons.stairs), label: '사다리'),
                NavigationDestination(icon: Icon(Icons.coffee), label: '커피 타임'),
                NavigationDestination(icon: Icon(Icons.more_horiz), label: '더보기'),
              ],
            ),
          ),
          branches: [
            StatefulShellBranch(routes: [GoRoute(path: '/food', builder: (c, s) => const FoodScreen())]),
            StatefulShellBranch(routes: [GoRoute(path: '/ladder', builder: (c, s) => const LadderScreen(), routes: [GoRoute(path: 'history', builder: (c, s) => const LadderHistoryScreen())])]),
            StatefulShellBranch(routes: [GoRoute(path: '/team', builder: (c, s) => const TeamScreen(), routes: [GoRoute(path: 'history', builder: (c, s) => const TeamHistoryScreen())])]),
            StatefulShellBranch(routes: [GoRoute(path: '/more', builder: (c, s) => const MoreScreen())]),
          ],
        ),
      ],
    );
