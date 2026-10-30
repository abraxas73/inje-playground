import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/assistant/innobot_prefs.dart';
import 'package:playground/favorites/favorites.dart';
import 'package:playground/favorites/favorites_panel.dart';

void main() {
  tearDown(() => favoritesOpen.value = false);

  // 웹 화면 제목 옆 ☆(FavoriteStar)처럼 같은 즐겨찾기 목록을 보고 있는 위젯이 있을 때 패널을 연다
  testWidgets('같은 목록을 보는 위젯이 있어도 패널을 열 때 빌드 중 상태 변경 오류가 나지 않는다', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [innobotSignedInProvider.overrideWithValue(false)],
      child: MaterialApp(
        home: Scaffold(
          body: Column(children: [
            Consumer(builder: (_, ref, _) => Text('☆ ${ref.watch(appFavoritesProvider).value?.length ?? '-'}')),
            ValueListenableBuilder<bool>(
              valueListenable: favoritesOpen,
              builder: (_, open, _) => open ? FavoritesPanel(onOpenPath: (_) {}, onOpenUrl: (_) {}, maxHeight: 300) : const SizedBox.shrink(),
            ),
          ]),
        ),
      ),
    ));
    await tester.pumpAndSettle();
    favoritesOpen.value = true;
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.byType(FavoritesPanel), findsOneWidget);
  });
}
