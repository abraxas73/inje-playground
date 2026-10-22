import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/api/client.dart';
import 'package:playground/teams/teams_chat_panel.dart';

class FakeApi extends Fake implements ApiClient {
  final sent = <Object?>[];
  final gets = <Map<String, String>?>[];
  var msgs = <Map<String, Object?>>[
    {'id': '1', 'createdAt': '2026-10-22T01:00:00Z', 'from': {'id': 'u2', 'name': '김동료'}, 'text': '회의 몇 시죠?', 'attachments': []},
    {'id': '2', 'createdAt': '2026-10-22T01:01:00Z', 'from': {'id': 'me', 'name': '나'}, 'text': '3시요', 'attachments': [{'id': 'a', 'name': '안건.docx', 'url': 'https://x/a'}]},
  ];
  @override
  Future<dynamic> getJson(String path, {Map<String, String>? query}) async {
    if (path == '/api/teams/chat') {
      return {'connected': true, 'hasChatScope': true, 'meId': 'me', 'chats': [{'id': 'c1', 'type': 'group', 'topic': '플랫폼팀', 'lastUpdated': '2026-10-22T01:01:00Z'}]};
    }
    gets.add(query);
    return {'messages': query?['since'] == null ? msgs : msgs.where((m) => (m['createdAt'] as String).compareTo(query!['since']!) > 0).toList()};
  }

  @override
  Future<dynamic> postJson(String path, [Object? body]) async {
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
}
