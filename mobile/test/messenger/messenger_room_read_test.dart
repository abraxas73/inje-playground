import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/app/brand.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/messenger/messenger_api.dart';
import 'package:playground/messenger/messenger_chat_screen.dart';
import 'package:playground/messenger/messenger_client.dart';
import 'package:playground/messenger/messenger_models.dart';
import 'package:playground/messenger/messenger_mqtt.dart';
import 'package:playground/messenger/messenger_provider.dart';

class _Api extends MessengerApi {
  _Api() : super(MessengerClient(httpClient: MockClient((_) async => http.Response('{}', 404)), loadCreds: () async => null));
  final reads = <(String, String)>[];
  @override
  Future<List<MsgChat>> chats(String roomId, {String timeStamp = '0', int pageSize = 50}) async => [
        MsgChat.fromRow({'chatId': 'c2', 'roomId': roomId, 'sendEmpSeq': '9', 'content': '두 번째', 'contentType': '0', 'timeStamp': 2}),
        MsgChat.fromRow({'chatId': 'c1', 'roomId': roomId, 'sendEmpSeq': '9', 'content': '첫 번째', 'contentType': '0', 'timeStamp': 1}),
      ];
  @override
  Future<Map<String, String>> userNames(List<String> empSeqs) async => {'9': '홍길동'};
  @override
  Future<void> readChat({required String roomId, required String chatId}) async => reads.add((roomId, chatId));
}

void main() {
  testWidgets('대화방을 열면 가장 최신 대화까지 읽음 처리한다(안 읽음 배지가 사라지게)', (tester) async {
    final api = _Api();
    await tester.pumpWidget(ProviderScope(overrides: [
      messengerApiProvider.overrideWithValue(api),
      messengerMqttProvider.overrideWithValue(MessengerMqtt()),
    ], child: MaterialApp(home: MessengerRoomScreen(room: MsgRoom.minimal('r1', title: '개발팀')))));
    await tester.pumpAndSettle();
    expect(find.text('두 번째'), findsOneWidget);
    expect(api.reads, [('r1', 'c2')]); // 시간순 마지막(c2)
  });

  testWidgets('홈 위젯 안 대화방의 전체 화면 버튼 → 같은 방을 전체 화면으로, 위젯은 목록으로', (tester) async {
    await tester.pumpWidget(ProviderScope(overrides: [
      messengerApiProvider.overrideWithValue(_Api()),
      messengerMqttProvider.overrideWithValue(MessengerMqtt()),
    ], child: MaterialApp(home: Scaffold(body: WidgetChrome(child: Navigator(onGenerateInitialRoutes: (_, _) => [
      MaterialPageRoute(builder: (_) => const Text('목록')),
      MaterialPageRoute(builder: (_) => MessengerRoomScreen(room: MsgRoom.minimal('r1', title: '개발팀'))),
    ]))))));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('전체 화면'));
    await tester.pumpAndSettle();
    expect(find.text('두 번째'), findsOneWidget); // 전체 화면 방 하나만
    expect(find.byTooltip('전체 화면'), findsNothing); // 전체 화면에는 버튼 없음
    Navigator.of(tester.element(find.text('두 번째'))).pop();
    await tester.pumpAndSettle();
    expect(find.text('목록'), findsOneWidget);
  });
}
