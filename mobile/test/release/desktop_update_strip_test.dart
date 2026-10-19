import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/release/release_check.dart';
import 'package:playground/release/release_provider.dart';
import 'package:playground/release/update_banner.dart';

Widget scope(DesktopReleaseInfo? release, Widget child) => ProviderScope(
  key: UniqueKey(),
  overrides: [desktopReleaseProvider.overrideWith((_) async => release)],
  child: MaterialApp(home: Scaffold(body: child)),
);

void main() {
  const latest = DesktopReleaseInfo(
    version: '1.7.3',
    url: 'https://storage.test/setup',
  );

  testWidgets('최신 데스크톱 설치본이 더 높으면 맨 위 띠에 정확한 버전과 업데이트 링크를 보인다', (tester) async {
    await tester.pumpWidget(
      scope(latest, const DesktopUpdateStrip(appVersion: '1.7.2')),
    );
    await tester.pumpAndSettle();
    expect(find.text('1.7.3 버전으로 업데이트가 필요합니다.'), findsOneWidget);
    expect(find.widgetWithText(TextButton, '업데이트'), findsOneWidget);
  });

  testWidgets('현재 버전이 같거나 더 높고 개발 빌드이거나 릴리스가 없으면 띠를 숨긴다', (tester) async {
    for (final (release, version) in [
      (latest, '1.7.3'),
      (latest, '1.7.4'),
      (latest, 'dev'),
      (null, '1.7.2'),
    ]) {
      await tester.pumpWidget(
        scope(release, DesktopUpdateStrip(appVersion: version)),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('업데이트가 필요합니다'), findsNothing, reason: version);
    }
  });

  testWidgets('업데이트를 누르면 만료될 수 있는 기존 URL 대신 서버에서 새 링크를 받아 연다', (tester) async {
    var calls = 0;
    final opened = <String>[];
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          desktopReleaseProvider.overrideWith(
            (_) async => DesktopReleaseInfo(
              version: '1.7.3',
              url: 'https://storage.test/${++calls}',
            ),
          ),
        ],
        child: MaterialApp(
          home: Scaffold(
            body: DesktopUpdateStrip(
              appVersion: '1.7.2',
              launch: (uri) async => opened.add(uri.toString()),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(calls, 1);
    await tester.tap(find.widgetWithText(TextButton, '업데이트'));
    await tester.pumpAndSettle();
    expect(opened, ['https://storage.test/2']);
  });
}
