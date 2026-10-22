import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/app/brand.dart';
import 'package:playground/app/theme.dart';

void main() {
  testWidgets('BrandHeader: onRefresh를 주면 새로고침 버튼이 생기고 누르면 호출', (tester) async {
    var n = 0;
    await tester.pumpWidget(MaterialApp(theme: appTheme(), home: Scaffold(appBar: BrandHeader(title: '메일', onRefresh: () => n++))));
    await tester.tap(find.byTooltip('새로고침'));
    expect(n, 1);
    await tester.pumpWidget(MaterialApp(theme: appTheme(), home: const Scaffold(appBar: BrandHeader(title: '메일'))));
    expect(find.byTooltip('새로고침'), findsNothing);
  });
}
