import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/api/client.dart';
import 'package:playground/teams/teams_chat_panel.dart';

class FakeApi extends Fake implements ApiClient {
  final sent = <Object?>[];
  final gets = <Map<String, String>?>[];
  final searches = <String?>[];
  final reactions = <Object?>[];
  var listLoads = 0;
  var topic = '플랫폼팀';
  var msgs = <Map<String, Object?>>[
    {'id': '1', 'createdAt': '2026-10-22T01:00:00Z', 'from': {'id': 'u2', 'name': '김동료'}, 'text': '회의 몇 시죠?', 'attachments': []},
    {'id': '2', 'createdAt': '2026-10-22T01:01:00Z', 'from': {'id': 'me', 'name': '나'}, 'text': '3시요', 'attachments': [{'id': 'a', 'name': '안건.docx', 'url': 'https://x/a'}]},
  ];
  @override
  Future<dynamic> getJson(String path, {Map<String, String>? query}) async {
    if (path == '/api/teams/chat') {
      listLoads++;
      return {'connected': true, 'hasChatScope': true, 'meId': 'me', 'chats': [{'id': 'c1', 'type': 'group', 'topic': topic, 'members': ['김동료', '나'], 'lastUpdated': '2026-10-22T01:01:00Z'}]};
    }
    if (path == '/api/teams/chat/search') {
      searches.add(query?['q']);
      return {'hits': [{'id': '1', 'chatId': 'c1', 'from': '김동료', 'snippet': '회의 몇 시죠?', 'createdAt': '2026-10-22T01:00:00Z'}, {'id': '7', 'chatId': 'old', 'from': '박옛날', 'snippet': '오래된 회의', 'createdAt': '2026-01-01T00:00:00Z'}]};
    }
    gets.add(query);
    return {'messages': query?['since'] == null ? msgs : msgs.where((m) => (m['createdAt'] as String).compareTo(query!['since']!) > 0).toList()};
  }

  @override
  Future<dynamic> postJson(String path, [Object? body]) async {
    if (path == '/api/teams/chat/reaction') {
      reactions.add(body);
      return {'ok': true};
    }
    sent.add(body);
    msgs = [...msgs, {'id': '3', 'createdAt': '2026-10-22T01:02:00Z', 'from': {'id': 'me', 'name': '나'}, 'text': (body as Map)['text'], 'attachments': []}];
    return {'message': {}};
  }
}

void main() {
  testWidgets('목록 → 대화방, 말풍선·첨부, 엔터로 보내고 포커스 유지, 5초 폴링은 since로', (tester) async {
    final api = FakeApi();
    await tester.pumpWidget(ProviderScope(
      overrides: [apiClientProvider.overrideWithValue(api)],
      child: const MaterialApp(home: Scaffold(body: TeamsChatPanel())),
    ));
    await tester.pumpAndSettle();
    expect(find.text('플랫폼팀'), findsOneWidget);

    await tester.tap(find.text('플랫폼팀'));
    await tester.pumpAndSettle();
    expect(find.text('회의 몇 시죠?'), findsOneWidget);
    expect(find.text('김동료'), findsOneWidget); // 상대만 이름
    expect(find.text('나'), findsNothing);
    expect(find.text('안건.docx'), findsOneWidget);

    await tester.enterText(find.byType(TextField), '확인했습니다');
    await tester.testTextInput.receiveAction(TextInputAction.send);
    await tester.pumpAndSettle();
    expect(api.sent, [{'chat': 'c1', 'text': '확인했습니다'}]);
    expect(find.text('확인했습니다'), findsOneWidget);
    expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, isEmpty);
    expect(FocusManager.instance.primaryFocus?.context?.findAncestorWidgetOfExactType<TextField>(), isNotNull);

    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();
    expect(api.gets.last?['since'], '2026-10-22T01:02:00.000Z');
    expect(find.text('확인했습니다'), findsOneWidget); // 중복 없음

    // 빈 채팅도 폴링으로 첫 메시지를 받는다
    await tester.tap(find.byTooltip('뒤로'));
    await tester.pumpAndSettle();
    api.msgs = [];
    await tester.tap(find.text('플랫폼팀'));
    await tester.pumpAndSettle();
    expect(find.text('대화가 없습니다'), findsOneWidget);
    api.msgs = [{'id': '9', 'createdAt': '2026-10-22T02:00:00Z', 'from': {'id': 'u2', 'name': '김동료'}, 'text': '첫 메시지', 'attachments': []}];
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();
    expect(find.text('첫 메시지'), findsOneWidget);

    // 화면을 떠나면 폴링 타이머도 끝난다
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('검색 — 메신저 검색과 같은 구성(대화방·대화 내용 두 묶음), 대화 내용을 누르면 그 메시지를 강조, 1자는 대화방만', (tester) async {
    final api = FakeApi();
    await tester.pumpWidget(ProviderScope(
      overrides: [apiClientProvider.overrideWithValue(api)],
      child: const MaterialApp(home: Scaffold(body: TeamsChatPanel())),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('검색'));
    await tester.pumpAndSettle();
    expect(find.text('검색어를 입력하세요'), findsOneWidget);

    await tester.enterText(find.byType(TextField), '김');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(api.searches, isEmpty); // 대화 내용은 2자부터
    expect(find.text('대화방 1'), findsOneWidget);

    await tester.enterText(find.byType(TextField), '회의');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(api.searches, ['회의']);
    expect(find.text('대화 내용 2'), findsOneWidget);
    expect(find.text('최근 50개 밖의 대화'), findsOneWidget);

    await tester.tap(find.text('회의 몇 시죠?'));
    await tester.pumpAndSettle();
    final focused = find.ancestor(of: find.text('회의 몇 시죠?'), matching: find.byWidgetPredicate((w) => w is DecoratedBox && w.decoration is BoxDecoration && (w.decoration as BoxDecoration).color == const Color(0xFFFFE58F)));
    expect(focused, findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('반응 — 묶음 표시(옛 like도 👍), 누르면 같이 붙이고 다시 누르면 뗌(원래 값으로), 단추로 골라 붙이기', (tester) async {
    final api = FakeApi();
    api.msgs = [
      {'id': '1', 'createdAt': '2026-10-22T01:00:00Z', 'from': {'id': 'u2', 'name': '김동료'}, 'text': '자료 올렸습니다', 'attachments': [], 'reactions': [{'type': 'like', 'emoji': '👍', 'users': [{'id': 'u3', 'name': '박팀장'}]}]},
    ];
    await tester.pumpWidget(ProviderScope(
      overrides: [apiClientProvider.overrideWithValue(api)],
      child: const MaterialApp(home: Scaffold(body: TeamsChatPanel())),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('플랫폼팀'));
    await tester.pumpAndSettle();
    expect(find.text('👍 1'), findsOneWidget);

    await tester.tap(find.text('👍 1'));
    await tester.pump();
    expect(find.text('👍 2'), findsOneWidget);
    expect(api.reactions.last, {'chat': 'c1', 'message': '1', 'reaction': 'like', 'on': true});

    await tester.tap(find.text('👍 2'));
    await tester.pump();
    expect(find.text('👍 1'), findsOneWidget);
    expect(api.reactions.last, {'chat': 'c1', 'message': '1', 'reaction': 'like', 'on': false});

    await tester.tap(find.byIcon(Icons.add_reaction_outlined));
    await tester.pumpAndSettle();
    await tester.tap(find.text('❤️'));
    await tester.pumpAndSettle();
    expect(find.text('❤️ 1'), findsOneWidget);
    expect(api.reactions.last, {'chat': 'c1', 'message': '1', 'reaction': '❤️', 'on': true});
  });

  testWidgets('대화방: 입력칸을 누르면 5초를 기다리지 않고 바로 새 메시지를 가져온다(방금 받은 직후라도)', (tester) async {
    final api = FakeApi();
    await tester.pumpWidget(ProviderScope(overrides: [apiClientProvider.overrideWithValue(api)], child: const MaterialApp(home: Scaffold(body: TeamsChatPanel()))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('플랫폼팀'));
    await tester.pumpAndSettle();
    await tester.pump(const Duration(seconds: 5)); // 방금 폴링으로 받음
    await tester.pumpAndSettle();
    final before = api.gets.length;
    api.msgs = [...api.msgs, {'id': '5', 'createdAt': '2026-10-22T01:05:00Z', 'from': {'id': 'u2', 'name': '김동료'}, 'text': '방금 온 답', 'attachments': []}];
    await tester.tap(find.byType(TextField));
    await tester.pump();
    await tester.pumpAndSettle();
    expect(api.gets.length, before + 1);
    expect(api.gets.last?['since'], isNotNull);
    expect(find.text('방금 온 답'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('목록: 30초마다 조용히 다시 읽는다(스피너 없이 바뀐 내용 반영)', (tester) async {
    final api = FakeApi();
    await tester.pumpWidget(ProviderScope(overrides: [apiClientProvider.overrideWithValue(api)], child: const MaterialApp(home: Scaffold(body: TeamsChatPanel()))));
    await tester.pumpAndSettle();
    expect(api.listLoads, 1);
    api.topic = '플랫폼팀(이름 바뀜)';
    await tester.pump(const Duration(seconds: 30));
    expect(find.byType(CircularProgressIndicator), findsNothing);
    await tester.pumpAndSettle();
    expect(api.listLoads, 2);
    expect(find.text('플랫폼팀(이름 바뀜)'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('원문 서식 — markdown이 있으면 굵게·목록으로 그리고, 없으면 text 평문', (tester) async {
    final api = FakeApi();
    api.msgs = [
      {'id': '1', 'createdAt': '2026-10-22T01:00:00Z', 'from': {'id': 'u2', 'name': '김동료'}, 'text': '방향 유지', 'markdown': '**방향**\n\n1. 유지\n2. 구축', 'attachments': []},
      {'id': '2', 'createdAt': '2026-10-22T01:01:00Z', 'from': {'id': 'u2', 'name': '김동료'}, 'text': '옛 서버 *그대로*', 'attachments': []},
    ];
    await tester.pumpWidget(ProviderScope(
      overrides: [apiClientProvider.overrideWithValue(api)],
      child: const MaterialApp(home: Scaffold(body: TeamsChatPanel())),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('플랫폼팀'));
    await tester.pumpAndSettle();
    expect(find.byType(MarkdownBody), findsOneWidget);
    final bold = tester.widgetList<RichText>(find.descendant(of: find.byType(MarkdownBody), matching: find.byType(RichText))).map((r) => r.text).whereType<TextSpan>().expand((t) => [t, ...?t.children?.whereType<TextSpan>()]);
    expect(bold.any((t) => t.toPlainText() == '방향' && t.style?.fontWeight == FontWeight.w700), isTrue);
    expect(find.text('유지', findRichText: true), findsOneWidget);
    expect(find.text('옛 서버 *그대로*'), findsOneWidget); // markdown 없으면 평문 그대로
    await tester.pumpWidget(const SizedBox());
  });
}
