import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/api/client.dart';
import 'package:playground/app/theme.dart';
import 'package:playground/assistant/innobot_prefs.dart';
import 'package:playground/features/home/dashboard_templates.dart';
import '../assistant/chat_brain.dart' show BrainTokens;

void main() {
  testWidgets('템플릿: 목록(기본 먼저)·적용은 내 배치로 PUT·공유는 지금 배치로 POST·내 것만 지우기', (t) async {
    final calls = <(String, String, Object?)>[];
    final templates = [
      {'id': 'd', 'name': '기본 템플릿', 'owner': '강승억(AX)', 'mine': false, 'isDefault': true, 'tiles': [{'id': 'briefing', 'x': 0, 'y': 0, 'w': 8, 'h': 4}]},
      {'id': 'm', 'name': '내 배치', 'owner': '나', 'mine': true, 'isDefault': false, 'tiles': [{'id': 'mails', 'x': 0, 'y': 0, 'w': 6, 'h': 3}]},
    ];
    final client = MockClient((r) async {
      calls.add((r.method, r.url.path, r.body.isEmpty ? null : jsonDecode(r.body)));
      if (r.url.path.endsWith('/templates') && r.method == 'GET') return http.Response(jsonEncode({'templates': templates}), 200, headers: {'content-type': 'application/json; charset=utf-8'});
      if (r.url.path.endsWith('/home-dashboard') && r.method == 'GET') return http.Response('{"tiles":[{"id":"teams","x":0,"y":0,"w":6,"h":3}]}', 200);
      if (r.method == 'PUT') return http.Response(r.body, 200);
      return http.Response('{"ok":true}', 200);
    });
    final c = ProviderContainer(overrides: [
      apiClientProvider.overrideWithValue(ApiClient(httpClient: client, tokens: BrainTokens(), baseUrl: 'https://x.test', userAgent: 'UA')),
      innobotSignedInProvider.overrideWithValue(true),
    ]);
    addTearDown(c.dispose);
    await t.pumpWidget(UncontrolledProviderScope(container: c, child: MaterialApp(theme: appTheme(), home: Scaffold(body: Builder(builder: (ctx) => TextButton(onPressed: () => showDashboardTemplates(ctx), child: const Text('열기')))))));
    await t.tap(find.text('열기'));
    await t.pumpAndSettle();
    expect(find.text('기본 템플릿'), findsOneWidget);
    expect(find.text('기본'), findsOneWidget);
    expect(find.byTooltip('템플릿 지우기'), findsOneWidget); // 내 것만

    // 공유: 지금 배치(teams)를 이름과 함께 POST
    await t.tap(find.text('지금 배치 공유'));
    await t.pumpAndSettle();
    await t.enterText(find.byType(TextField), '영업용');
    await t.tap(find.widgetWithText(FilledButton, '공유'));
    await t.pumpAndSettle();
    final post = calls.firstWhere((x) => x.$1 == 'POST');
    expect(post.$3, {'name': '영업용', 'tiles': [{'id': 'teams', 'x': 0, 'y': 0, 'w': 6, 'h': 3}]});

    // 적용: 확인 후 기본 템플릿 배치로 PUT
    await t.tap(find.widgetWithText(TextButton, '적용').first);
    await t.pumpAndSettle();
    await t.tap(find.widgetWithText(FilledButton, '적용'));
    await t.pumpAndSettle();
    final put = calls.lastWhere((x) => x.$1 == 'PUT');
    expect(put.$3, {'tiles': [{'id': 'briefing', 'x': 0, 'y': 0, 'w': 8, 'h': 4}]});
    expect(find.text('홈 템플릿'), findsNothing); // 적용하면 닫힌다
  });
}
