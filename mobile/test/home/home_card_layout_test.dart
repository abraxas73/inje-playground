import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/features/home/home_card_layout.dart';

void main() {
  testWidgets('짧은 열부터 채우고 숨긴 섹션은 빈 칸을 만들지 않는다', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1300, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    var taps = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: HomeCardLayout(
            children: [
              const SizedBox(key: ValueKey('first'), height: 100),
              const SizedBox(height: 300),
              const SizedBox(height: 200),
              const SizedBox.shrink(),
              SizedBox(
                height: 50,
                child: TextButton(
                  onPressed: () => taps++,
                  child: const Text('마지막 카드'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
    final last = find.text('마지막 카드');
    expect(tester.getCenter(last).dx, lessThan(430));
    expect(tester.getCenter(last).dy, closeTo(125, 1));
    await tester.tap(last);
    expect(taps, 1);
    expect(tester.takeException(), isNull);
  }, variant: TargetPlatformVariant({TargetPlatform.macOS}));

  testWidgets('리사이즈로 열 수가 바뀌어도 입력 상태가 유지되고 큰 글씨는 열을 줄인다', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1300, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    Widget screen(double scale) => MaterialApp(
      home: Scaffold(
        body: MediaQuery(
          data: MediaQueryData(textScaler: TextScaler.linear(scale)),
          child: const HomeCardLayout(
            children: [
              TextField(),
              SizedBox(height: 100),
              SizedBox(height: 100),
            ],
          ),
        ),
      ),
    );
    await tester.pumpWidget(screen(1));
    await tester.enterText(find.byType(TextField), '작성 중인 내용');
    await tester.binding.setSurfaceSize(const Size(700, 800));
    await tester.pumpAndSettle();
    expect(find.text('작성 중인 내용'), findsOneWidget);
    expect(tester.getSize(find.byType(TextField)).width, 700);
    await tester.binding.setSurfaceSize(const Size(1300, 800));
    await tester.pumpWidget(screen(2));
    expect(tester.getSize(find.byType(TextField)).width, 1300);
    expect(find.text('작성 중인 내용'), findsOneWidget);
    expect(tester.takeException(), isNull);
  }, variant: TargetPlatformVariant({TargetPlatform.macOS}));
}
