import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/release/desktop_update_host.dart';
import 'package:playground/release/desktop_updater.dart';
import 'package:playground/release/release_check.dart';
import 'desktop_updater_test.dart' show signedRelease, updateChannel;

void main() {
  testWidgets(
    'automatic strip is hidden for current, older, dev and unavailable releases',
    (tester) async {
      for (final (release, version) in [
        (signedRelease, '1.7.8'),
        (signedRelease, '1.7.9'),
        (signedRelease, 'dev'),
        (null, '1.7.7'),
      ]) {
        final updater = DesktopUpdater(
          platform: 'windows',
          currentVersion: version,
          account: () => 'a',
          loadRelease: () async => release,
          refreshToken: () async => 'token',
        );
        await updater.check(manual: false);
        await tester.pumpWidget(
          ProviderScope(
            key: UniqueKey(),
            overrides: [desktopUpdaterProvider.overrideWithValue(updater)],
            child: MaterialApp(
              builder: (_, child) => DesktopUpdateHost(child: child!),
              home: const Scaffold(),
            ),
          ),
        );
        expect(find.textContaining('업데이트가 필요합니다'), findsNothing);
        await tester.pumpWidget(const SizedBox.shrink());
        updater.dispose();
      }
    },
  );

  testWidgets(
    'legacy unsigned desktop releases cannot launch a browser installer',
    (tester) async {
      final calls = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(updateChannel, (call) async {
          calls.add(call);
          return null;
          });
      final updater = DesktopUpdater(
        platform: 'windows',
        currentVersion: '1.7.7',
        account: () => 'a',
        loadRelease: () async => const DesktopReleaseInfo(
          version: '1.7.8',
          url: 'https://storage.test/setup',
        ),
        refreshToken: () async => 'token',
      );
      await updater.check(manual: true);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [desktopUpdaterProvider.overrideWithValue(updater)],
          child: MaterialApp(
            builder: (_, child) => DesktopUpdateHost(child: child!),
            home: const Scaffold(),
          ),
        ),
      );
      expect(find.textContaining('서명이 준비되지'), findsOneWidget);
      expect(find.widgetWithText(TextButton, '업데이트'), findsNothing);
      expect(calls, isEmpty);
      await tester.pumpWidget(const SizedBox.shrink());
      updater.dispose();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(updateChannel, null);
    },
  );
}
