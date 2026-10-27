import 'dart:convert';
import 'dart:typed_data';
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
  var registered = <Map<String, Object?>>[];
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
    if (path == '/api/teams/chat/custom-reactions') return {'reactions': registered};
    if (path == '/api/teams/chat/search') {
      searches.add(query?['q']);
      return {'hits': [{'id': '1', 'chatId': 'c1', 'from': '김동료', 'snippet': '회의 몇 시죠?', 'createdAt': '2026-10-22T01:00:00Z'}, {'id': '7', 'chatId': 'old', 'from': '박옛날', 'snippet': '오래된 회의', 'createdAt': '2026-01-01T00:00:00Z'}]};
    }
    gets.add(query);
    return {'messages': query?['since'] == null ? msgs : msgs.where((m) => (m['createdAt'] as String).compareTo(query!['since']!) > 0).toList()};
  }

  final images = <String>[];
  @override
  Future<Uint8List> getBytes(String path) async { // 40×40 PNG
    images.add(path);
    return base64Decode('iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAIAAAADnC86AAAAMElEQVR4nO3NQQkAAAgEsOtkJzvZ1hKCn8H+S/W8iFgsFovFYrFYLBaLxWKxWHxnAdLIeOpVA63UAAAAAElFTkSuQmCC');
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

  testWidgets('본문 그림 — 중계 주소 그림은 받아 그리고(다시 그려도 한 번만 받음) 누르면 크게, 외부 주소는 [이미지] 글', (tester) async {
    final api = FakeApi();
    const path = '/api/teams/chat/image?chat=c1&message=1&content=aGM%3D';
    api.msgs = [
      {'id': '1', 'createdAt': '2026-10-22T01:00:00Z', 'from': {'id': 'u2', 'name': '김동료'}, 'text': '흐름 [이미지]', 'markdown': '흐름이 맞을까요?  \n![이미지]($path)', 'attachments': [], 'reactions': [
        {'type': 'custom', 'emoji': ':nepp:', 'image': '/api/teams/chat/image?chat=c1&message=1&content=bmVw', 'users': [{'id': 'u3', 'name': '박팀장'}, {'id': 'u4', 'name': '이대리'}]},
        {'type': 'custom', 'emoji': ':thankyou:', 'users': [{'id': 'u3', 'name': '박팀장'}]},
      ]},
      {'id': '2', 'createdAt': '2026-10-22T01:01:00Z', 'from': {'id': 'u2', 'name': '김동료'}, 'text': '[이미지]', 'markdown': '![이미지](https://evil.example/a.png)', 'attachments': []},
    ];
    await tester.pumpWidget(ProviderScope(overrides: [apiClientProvider.overrideWithValue(api)], child: const MaterialApp(home: Scaffold(body: TeamsChatPanel()))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('플랫폼팀'));
    await tester.pump();
    await tester.pump();
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 200))); // 그림 크기 읽기(실제 비동기)
    await tester.pumpAndSettle();
    final body = find.byWidgetPredicate((w) => w is TeamsImage && w.square == null);
    expect(body, findsOneWidget);
    expect(find.descendant(of: body, matching: find.byType(Image)), findsOneWidget);
    expect(tester.getSize(body), const Size(40, 44)); // 원래 크기(위아래 여백 2)
    // 사용자 정의 반응(넵) — 칩 안에 작은 그림 + 수, 누르기 없음·이름은 풀이에. 그림 주소가 없으면 이름(:thankyou:)
    final nepp = find.byWidgetPredicate((w) => w is TeamsImage && w.square == 16);
    expect(nepp, findsOneWidget);
    expect(tester.getSize(nepp), const Size(16, 16));
    expect(find.byTooltip(':nepp: · 박팀장, 이대리'), findsOneWidget);
    expect(find.text(':thankyou: 1'), findsOneWidget);
    expect(find.text('[이미지]', findRichText: true), findsOneWidget); // 외부 주소는 불러오지 않는다
    await tester.pump(const Duration(seconds: 5)); // 폴링으로 다시 그려도
    await tester.pumpAndSettle();
    expect(api.images.toSet(), {path, '/api/teams/chat/image?chat=c1&message=1&content=bmVw'});
    expect(api.images, hasLength(2));

    await tester.tap(body);
    await tester.pumpAndSettle();
    expect(find.byType(InteractiveViewer), findsOneWidget);
    await tester.tap(find.byType(InteractiveViewer));
    await tester.pumpAndSettle();
    expect(find.byType(InteractiveViewer), findsNothing);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('사용자 정의 반응(ID 있는 것) — 칩을 누르면 같이 붙이고(그림 유지), 고르기 창 구분선 아래에 등록부 + 이 대화에 보인 것', (tester) async {
    final api = FakeApi();
    const id = 'daebak;0-skr-d3-216f', img = '/api/teams/chat/image?chat=c1&message=1&content=ZGI%3D';
    resetRegisteredTeamsReactions();
    api.registered = [{'type': 'nepp;0-skr-d1-aa', 'emoji': ':nepp:', 'image': '/api/teams/chat/custom-reactions?name=nepp'}];
    api.msgs = [
      {'id': '1', 'createdAt': '2026-10-22T01:00:00Z', 'from': {'id': 'u2', 'name': '김동료'}, 'text': '좋네요', 'attachments': [], 'reactions': [{'type': id, 'emoji': ':daebak:', 'image': img, 'users': [{'id': 'u3', 'name': '박팀장'}]}]},
      {'id': '2', 'createdAt': '2026-10-22T01:01:00Z', 'from': {'id': 'u2', 'name': '김동료'}, 'text': '하나 더', 'attachments': []},
    ];
    await tester.pumpWidget(ProviderScope(overrides: [apiClientProvider.overrideWithValue(api)], child: const MaterialApp(home: Scaffold(body: TeamsChatPanel()))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('플랫폼팀'));
    await tester.pump();
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 200)));
    await tester.pumpAndSettle();
    expect(find.byTooltip(':daebak: · 박팀장'), findsOneWidget);
    await tester.tap(find.byTooltip(':daebak: · 박팀장'));
    await tester.pump();
    expect(api.reactions.last, {'chat': 'c1', 'message': '1', 'reaction': id, 'on': true});
    expect(find.byTooltip(':daebak: · 박팀장, 나'), findsOneWidget);
    expect(find.byWidgetPredicate((w) => w is TeamsImage && w.square == 16), findsOneWidget); // 붙인 뒤에도 그림

    await tester.tap(find.byIcon(Icons.add_reaction_outlined).first); // 두 번째 메시지(최신이 아래 — reverse 목록이라 먼저 만들어진다)
    await tester.pumpAndSettle();
    // 구분선 아래: 등록부(넵 — 이 방엔 없음) 먼저, 이 방에 보인 대박(등록 전)
    expect(find.byType(Divider), findsOneWidget);
    final cells = find.byWidgetPredicate((w) => w is TeamsImage && w.square == 20);
    expect(cells, findsNWidgets(2));
    expect(tester.widget<TeamsImage>(cells.first).label, ':nepp:');
    final cell = find.byWidgetPredicate((w) => w is TeamsImage && w.square == 20 && w.label == ':daebak:');
    await tester.tap(find.ancestor(of: cell, matching: find.byType(InkWell)).first);
    await tester.pumpAndSettle();
    expect(api.reactions.last, {'chat': 'c1', 'message': '2', 'reaction': id, 'on': true});
    expect(find.byTooltip(':daebak: · 나'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
}
