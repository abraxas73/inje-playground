import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/assistant/innobot_prefs.dart';
import 'package:playground/favorites/favorites_panel.dart';
import 'package:playground/notifications/notifications.dart';
import 'package:playground/web/linux_webview_guard.dart';

void main() {
  tearDown(() {
    innobotPopups.value = 0;
    innobotFanOpen.value = false;
    notifOpen.value = false;
    favoritesOpen.value = false;
  });

  Widget host() => const ProviderScope(
    child: Directionality(textDirection: TextDirection.ltr, child: LinuxWebViewGuard(child: Text('웹 화면'))),
  );

  testWidgets('Flutter 오버레이가 없으면 WebView 자리를 그대로 그린다', (tester) async {
    await tester.pumpWidget(host());
    expect(find.text('웹 화면'), findsOneWidget);
    expect(flutterOverlayOpen, isFalse);
  });

  testWidgets('팝업·하단 그룹 메뉴·알림·즐겨찾기 중 하나라도 열리면 WebView를 빼고, 닫히면 되돌린다', (tester) async {
    await tester.pumpWidget(host());
    final openers = <String, (void Function(), void Function())>{
      '팝업': (() => innobotPopups.value = 1, () => innobotPopups.value = 0),
      '하단 그룹 메뉴': (() => innobotFanOpen.value = true, () => innobotFanOpen.value = false),
      '알림 패널': (() => notifOpen.value = true, () => notifOpen.value = false),
      '즐겨찾기 패널': (() => favoritesOpen.value = true, () => favoritesOpen.value = false),
    };
    for (final e in openers.entries) {
      e.value.$1();
      await tester.pump();
      expect(find.text('웹 화면'), findsNothing, reason: '${e.key} 열림');
      e.value.$2();
      await tester.pump();
      expect(find.text('웹 화면'), findsOneWidget, reason: '${e.key} 닫힘');
    }
  });

  testWidgets('WebView가 있는 화면 위에 다른 화면이 쌓이면 WebView를 빼고, 그 화면을 닫으면 되돌린다', (tester) async {
    final nav = GlobalKey<NavigatorState>();
    await tester.pumpWidget(ProviderScope(
      child: MaterialApp(navigatorKey: nav, home: const Scaffold(body: LinuxWebViewGuard(child: Text('웹 화면')))),
    ));
    expect(find.text('웹 화면'), findsOneWidget);
    nav.currentState!.push(MaterialPageRoute<void>(builder: (_) => const Scaffold(body: Text('출퇴근'))));
    await tester.pumpAndSettle();
    expect(find.text('웹 화면', skipOffstage: false), findsNothing);
    nav.currentState!.pop();
    await tester.pumpAndSettle();
    expect(find.text('웹 화면'), findsOneWidget);
  });
}
