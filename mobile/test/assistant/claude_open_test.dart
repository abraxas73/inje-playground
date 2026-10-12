import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/assistant/claude_open.dart';
import 'package:playground/assistant/innobot_button.dart';

void main() {
  group('findWindowsClaude', () {
    const env = {'LOCALAPPDATA': r'C:\Users\me\AppData\Local'};
    test('설치 경로의 claude.exe가 있으면 그 경로', () {
      expect(findWindowsClaude(env: env, exists: (p) => p == r'C:\Users\me\AppData\Local\AnthropicClaude\claude.exe'), r'C:\Users\me\AppData\Local\AnthropicClaude\claude.exe');
    });
    test('없으면 null — LOCALAPPDATA가 없어도 null', () {
      expect(findWindowsClaude(env: env, exists: (_) => false), isNull);
      expect(findWindowsClaude(env: const {}, exists: (_) => true), isNull);
    });
  });

  testWidgets('Claude 버튼은 데스크톱에서만 이노봇 위에 보이고, 누르면 열기 콜백', (tester) async {
    var opened = 0;
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: Stack(children: [ClaudeButton(onTap: () async => opened++)]))));
    expect(find.byTooltip('Claude 열기'), findsOneWidget);
    await tester.tap(find.byTooltip('Claude 열기'));
    expect(opened, 1);
    expect(InnobotButton.showsClaude, Platform.isMacOS || Platform.isWindows);
  });
}
