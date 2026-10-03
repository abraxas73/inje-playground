import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/app/theme.dart';

TextStyle? _labelStyle(WidgetTester t, String text) {
  final rich = t.widget<RichText>(find.descendant(of: find.widgetWithText(FilterChip, text), matching: find.byType(RichText)));
  return rich.text.style;
}

void main() {
  testWidgets('칩 라벨은 실제 색·크기로 그려진다 — 선택 안 됨은 네이비, 선택은 흰색(WidgetStateTextStyle은 copyWith에서 값이 사라져 보이지 않는 글자가 됨)', (tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: appTheme(),
      home: Scaffold(body: Wrap(children: [
        FilterChip(label: const Text('김민준'), selected: false, onSelected: (_) {}),
        FilterChip(label: const Text('이서연'), selected: true, onSelected: (_) {}),
      ])),
    ));
    final off = _labelStyle(tester, '김민준');
    final on = _labelStyle(tester, '이서연');
    expect(off?.color, Brand.navy);
    expect(off?.fontSize, 14);
    expect(on?.color, Colors.white);
    expect(on?.fontSize, 14);
  });
}
