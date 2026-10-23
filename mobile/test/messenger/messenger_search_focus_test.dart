import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/messenger/messenger_api.dart';
import 'package:playground/messenger/messenger_client.dart';
import 'package:playground/messenger/messenger_models.dart';
import 'package:playground/messenger/messenger_mqtt.dart';
import 'package:playground/messenger/messenger_provider.dart';
import 'package:playground/messenger/messenger_search_screen.dart';

MsgChat chat(String id, int ts, String text) => MsgChat.fromRow({'chatId': id, 'roomId': 'r1', 'sendEmpSeq': '9', 'content': text, 'contentType': '0', 'timeStamp': ts});

/// 최근 50건(c100~c51)에는 찾는 메시지(c7)가 없고, 그 이전 페이지에 있다.
class _Api extends MessengerApi {
  _Api() : super(MessengerClient(httpClient: MockClient((_) async => http.Response('{}', 404)), loadCreds: () async => null));
  final pages = <String>[];
  @override
  Future<List<MsgChat>> chats(String roomId, {String timeStamp = '0', int pageSize = 50}) async {
    pages.add(timeStamp);
    final end = timeStamp == '0' ? 100 : int.parse(timeStamp) - 1;
    return [for (var i = end; i > end - 50 && i > 0; i--) chat('c$i', i, i == 7 ? '찾는 메시지' : '대화 $i')];
  }
  @override
  Future<List<MsgRoom>> searchRooms(String word, {String timeStamp = '0', int pageSize = 30}) async => const [];
  @override
  Future<List<MsgChat>> searchChats(String word, {String roomId = '', String timeStamp = '0', int pageSize = 30}) async => [chat('c7', 7, '찾는 메시지')];
  @override
  Future<List<MsgRoom>> rooms({String timeStamp = '0', int pageSize = 50}) async => [MsgRoom.minimal('r1', title: '플랫폼팀 방')];
  @override
  Future<Map<String, String>> userNames(List<String> empSeqs) async => {'9': '홍길동'};
  @override
  Future<void> readChat({required String roomId, required String chatId}) async {}
}

void main() {
  testWidgets('검색: 첫 칸은 방 제목, 대화 내용을 누르면 그 방의 그 메시지로(이전 대화까지 이어 읽고 노랑 강조)', (tester) async {
    await tester.binding.setSurfaceSize(const Size(900, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final api = _Api();
    await tester.pumpWidget(ProviderScope(overrides: [
      messengerApiProvider.overrideWithValue(api),
      messengerMqttProvider.overrideWithValue(MessengerMqtt()),
    ], child: const MaterialApp(home: MessengerSearchScreen())));
    await tester.enterText(find.byType(TextField), '찾는');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(find.text('대화 내용 1'), findsOneWidget);
    expect(find.text('플랫폼팀 방'), findsOneWidget); // 첫 칸 = 방 제목
    await tester.tap(find.text('찾는 메시지'));
    await tester.pumpAndSettle();
    expect(api.pages, ['0', '51']); // 최근 50건에 없어 이전 페이지를 이어 읽음
    final hit = find.text('찾는 메시지');
    expect(hit, findsOneWidget);
    expect(tester.getRect(hit).overlaps(tester.getRect(find.byType(Scaffold))), isTrue); // 화면 안으로 옮겨짐
    final box = tester.widget<DecoratedBox>(find.ancestor(of: hit, matching: find.byType(DecoratedBox)).last);
    expect((box.decoration as BoxDecoration).color, const Color(0xFFFFE58F));
  });
}
