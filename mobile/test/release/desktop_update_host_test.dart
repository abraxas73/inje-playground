import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/release/desktop_update_host.dart';
import 'package:playground/release/desktop_updater.dart';
import 'desktop_updater_test.dart'
    show signedRelease, updateChannel, nativeStatus;

void main() {
  testWidgets(
    'global strip remains above a pushed route; one click starts install without another confirmation',
    (tester) async {
      final calls = <MethodCall>[];
      final updater = DesktopUpdater(
        platform: 'windows',
        currentVersion: '1.7.7',
        account: () => 'a',
        loadRelease: () async => signedRelease,
        refreshToken: () async => 'private-token',
        channel: updateChannel,
      );
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(updateChannel, (call) async {
          calls.add(call);
          return null;
          });
      final nav = GlobalKey<NavigatorState>();
      await updater.check(manual: false);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [desktopUpdaterProvider.overrideWithValue(updater)],
          child: MaterialApp(
            navigatorKey: nav,
            builder: (_, child) => DesktopUpdateHost(child: child!),
            home: const Scaffold(body: Text('업무')),
          ),
        ),
      );
      nav.currentState!.push(
        MaterialPageRoute<void>(
          builder: (_) => const Scaffold(body: Text('SharePoint 문서')),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('1.7.8'), findsOneWidget);
      expect(find.textContaining('자동 재시작'), findsOneWidget);
      expect(
        tester.getTopLeft(find.textContaining('1.7.8')).dy,
        lessThan(tester.getTopLeft(find.text('SharePoint 문서')).dy),
      );
      await tester.tap(find.widgetWithText(TextButton, '업데이트'));
      await tester.pump();
      await tester.pump();
      expect(calls.where((c) => c.method == 'install'), hasLength(1));
      expect(find.byType(AlertDialog), findsNothing);
      expect(find.text('업데이트 적용'), findsNothing);
      final install =
          calls.firstWhere((c) => c.method == 'install').arguments as Map;
      await nativeStatus({
        'phase': 'downloading',
        'version': '1.7.8',
        'sessionId': install['sessionId'],
        'progress': .5,
      });
      await tester.pump();
      expect(find.textContaining('50%'), findsOneWidget);
      await updater.cancelForSignOut();
      await tester.pumpWidget(const SizedBox.shrink());
      updater.dispose();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(updateChannel, null);
    },
  );
}
