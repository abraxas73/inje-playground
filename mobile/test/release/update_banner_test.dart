import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/release/release_check.dart';
import 'package:playground/release/release_provider.dart';
import 'package:playground/release/update_banner.dart';

/// 매번 새 ProviderScope(UniqueKey) — 같은 자리에서 다시 pump해도 이전 상태를 재사용하지 않게.
Widget scope(ReleaseInfo? r, Widget child) => ProviderScope(
      key: UniqueKey(),
      overrides: [releaseProvider.overrideWith((_) async => r)],
      child: MaterialApp(home: Scaffold(body: child)),
    );
const newer = ReleaseInfo(version: '1.1.0', build: 3, url: 'https://x/apk');

void main() {
  testWidgets('서버 빌드가 크면 배너와 업데이트 버튼', (tester) async {
    await tester.pumpWidget(scope(newer, const UpdateBanner(appBuild: 2)));
    await tester.pumpAndSettle();
    expect(find.text('새 버전 1.1.0이 있어요'), findsOneWidget);
    expect(find.widgetWithText(TextButton, '업데이트'), findsOneWidget);
  });
  testWidgets('같거나 낮거나, 개발 빌드(0)거나, 서버 응답이 없으면 안 보인다', (tester) async {
    for (final (r, b) in [(newer, 3), (newer, 4), (newer, 0), (null, 2)]) {
      await tester.pumpWidget(scope(r, UpdateBanner(appBuild: b)));
      await tester.pumpAndSettle();
      expect(find.textContaining('새 버전'), findsNothing, reason: 'build $b');
    }
  });
  testWidgets('링크가 없으면 웹 /apps 안내, 버튼 없음', (tester) async {
    await tester.pumpWidget(scope(const ReleaseInfo(version: '1.1.0', build: 3), const UpdateBanner(appBuild: 2)));
    await tester.pumpAndSettle();
    expect(find.textContaining('웹 /apps에서 받으세요'), findsOneWidget);
    expect(find.byType(TextButton), findsNothing);
  });
  testWidgets('더보기 버전 줄 — 1.0.0 (2) + 업데이트 버튼, 개발 빌드는 dev만', (tester) async {
    await tester.pumpWidget(scope(newer, const VersionTrailing(appVersion: '1.0.0', appBuild: 2)));
    await tester.pumpAndSettle();
    expect(find.text('1.0.0 (2)'), findsOneWidget);
    expect(find.widgetWithText(TextButton, '업데이트'), findsOneWidget);
    await tester.pumpWidget(scope(newer, const VersionTrailing(appVersion: 'dev', appBuild: 0)));
    await tester.pumpAndSettle();
    expect(find.text('dev'), findsOneWidget);
    expect(find.byType(TextButton), findsNothing);
  });
  testWidgets('[리뷰1] 업데이트 버튼은 캐시된 링크가 아니라 서버에서 새로 받은 링크를 연다(서명 URL 600초 만료 대비)', (tester) async {
    var n = 0;
    final opened = <String>[];
    await tester.pumpWidget(ProviderScope(
      key: UniqueKey(),
      overrides: [releaseProvider.overrideWith((_) async { n++; return ReleaseInfo(version: '1.1.0', build: 3, url: 'https://x/$n'); })],
      child: MaterialApp(home: Scaffold(body: Column(children: [
        UpdateBanner(appBuild: 2, launch: (u) async => opened.add(u.toString())),
        VersionTrailing(appVersion: '1.0.0', appBuild: 2, launch: (u) async => opened.add(u.toString())),
      ]))),
    ));
    await tester.pumpAndSettle();
    expect(n, 1, reason: '화면이 뜰 때 1회 확인');
    await tester.tap(find.widgetWithText(TextButton, '업데이트').first);
    await tester.pumpAndSettle();
    expect(opened, ['https://x/2'], reason: '누를 때 다시 받아 그 링크를 연다');
    await tester.tap(find.widgetWithText(TextButton, '업데이트').last);
    await tester.pumpAndSettle();
    expect(opened, ['https://x/2', 'https://x/3']);
  });
}
