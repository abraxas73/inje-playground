// 라우터 골격 — 화면은 뒤 작업(인증·더보기·WebView·기능)에서 교체한다.
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

class StubScreen extends StatelessWidget {
  const StubScreen(this.title, {super.key});
  final String title;
  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: Text(title)), body: Center(child: Text(title)));
}

GoRouter buildRouter({required Listenable refresh, required String? Function(BuildContext, GoRouterState) redirect}) => GoRouter(
      initialLocation: '/food',
      refreshListenable: refresh,
      redirect: redirect,
      routes: [
        GoRoute(path: '/login', builder: (c, s) => const StubScreen('로그인')),
        GoRoute(path: '/guest', builder: (c, s) => const StubScreen('권한 안내')),
        GoRoute(path: '/web', builder: (c, s) => StubScreen('웹 ${s.uri.queryParameters['path'] ?? '/'}')),
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
            StatefulShellBranch(routes: [GoRoute(path: '/food', builder: (c, s) => const StubScreen('뭐 먹지'))]),
            StatefulShellBranch(routes: [GoRoute(path: '/ladder', builder: (c, s) => const StubScreen('사다리'))]),
            StatefulShellBranch(routes: [GoRoute(path: '/team', builder: (c, s) => const StubScreen('커피 타임'))]),
            StatefulShellBranch(routes: [GoRoute(path: '/more', builder: (c, s) => const StubScreen('더보기'))]),
          ],
        ),
      ],
    );
