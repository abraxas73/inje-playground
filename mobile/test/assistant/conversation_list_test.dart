import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/api/client.dart';
import 'package:playground/assistant/conversation_list_sheet.dart';
import 'chat_brain.dart' show BrainTokens;

void main() {
  testWidgets('대화 목록 — 제목을 보여 주고 누르면 id를 돌려준다, 비면 안내', (t) async {
    var rows = [{'id': 'c1', 'title': '주간보고 초안', 'model': 'claude-sonnet-5-5', 'last_message_at': '2026-10-15T01:00:00Z'}];
    final api = ApiClient(httpClient: MockClient((r) async => http.Response.bytes(utf8.encode(jsonEncode({'conversations': rows})), 200, headers: {'content-type': 'application/json; charset=utf-8'})), tokens: BrainTokens(), baseUrl: 'https://x.test', userAgent: 'UA');
    String? picked;
    await t.pumpWidget(ProviderScope(overrides: [apiClientProvider.overrideWithValue(api)], child: MaterialApp(home: Builder(builder: (c) => TextButton(onPressed: () async => picked = await showConversationList(c), child: const Text('열기'))))));
    await t.tap(find.text('열기'));
    await t.pumpAndSettle();
    expect(find.text('주간보고 초안'), findsOneWidget);
    await t.tap(find.text('주간보고 초안'));
    await t.pumpAndSettle();
    expect(picked, 'c1');
    rows = [];
    await t.tap(find.text('열기'));
    await t.pumpAndSettle();
    expect(find.text('저장된 대화가 없습니다.'), findsOneWidget);
  });

  testWidgets('대화 메뉴 — 이름 바꾸기(PATCH)·삭제(확인 뒤 DELETE), 바꾼 뒤 목록을 다시 읽는다', (t) async {
    var rows = [{'id': 'c1', 'title': '주간보고 초안', 'last_message_at': '2026-10-15T01:00:00Z'}];
    final seen = <String>[];
    final api = ApiClient(httpClient: MockClient((r) async {
      if (r.method != 'GET') {
        seen.add('${r.method} ${r.url.path} ${r.body}');
        if (r.method == 'PATCH') rows = [{...rows.single, 'title': (jsonDecode(r.body) as Map)['title'] as String}];
        if (r.method == 'DELETE') rows = [];
        return http.Response('{"ok":true}', 200);
      }
      return http.Response.bytes(utf8.encode(jsonEncode({'conversations': rows})), 200, headers: {'content-type': 'application/json; charset=utf-8'});
    }), tokens: BrainTokens(), baseUrl: 'https://x.test', userAgent: 'UA');
    await t.pumpWidget(ProviderScope(overrides: [apiClientProvider.overrideWithValue(api)], child: MaterialApp(home: Builder(builder: (c) => TextButton(onPressed: () => showConversationList(c), child: const Text('열기'))))));
    await t.tap(find.text('열기'));
    await t.pumpAndSettle();
    await t.tap(find.byTooltip('대화 메뉴'));
    await t.pumpAndSettle();
    await t.tap(find.text('이름 바꾸기'));
    await t.pumpAndSettle();
    await t.enterText(find.byType(TextField), '  10월 주간보고  ');
    await t.tap(find.text('저장'));
    await t.pumpAndSettle();
    expect(seen.single, 'PATCH /api/chat/conversations/c1 {"title":"10월 주간보고"}');
    expect(find.text('10월 주간보고'), findsOneWidget);
    await t.tap(find.byTooltip('대화 메뉴'));
    await t.pumpAndSettle();
    await t.tap(find.text('삭제'));
    await t.pumpAndSettle();
    expect(find.textContaining('되돌릴 수 없습니다'), findsOneWidget);
    await t.tap(find.widgetWithText(FilledButton, '삭제'));
    await t.pumpAndSettle();
    expect(seen.last, startsWith('DELETE /api/chat/conversations/c1'));
    expect(find.text('저장된 대화가 없습니다.'), findsOneWidget);
  });
}
