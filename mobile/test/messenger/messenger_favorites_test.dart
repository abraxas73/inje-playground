import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/features/home/pinned_widgets.dart';
import 'package:playground/messenger/messenger_api.dart';
import 'package:playground/messenger/messenger_chat_screen.dart';
import 'package:playground/messenger/messenger_client.dart';
import 'package:playground/messenger/messenger_models.dart';
import 'package:playground/messenger/messenger_mqtt.dart';
import 'package:playground/messenger/messenger_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _Api extends MessengerApi {
  _Api() : super(MessengerClient(httpClient: MockClient((_) async => http.Response('{}', 404)), loadCreds: () async => null));
  @override
  Future<List<MsgRoom>> rooms({String timeStamp = '0', int pageSize = 50}) async => MsgRoom.parseList({'roomList': [
        {'roomId': 'r1', 'roomType': '1', 'roomTitle': '개발팀', 'lastChat': '안녕', 'contentType': '0'},
        {'roomId': 'r2', 'roomType': '1', 'roomTitle': '영업팀', 'lastChat': '견적', 'contentType': '0'},
      ]});
  @override
  Future<List<MsgChat>> chats(String roomId, {String timeStamp = '0', int pageSize = 50}) async => const [];
  @override
  Future<Map<String, String>> userNames(List<String> empSeqs) async => const {};
  @override
  Future<List<MsgClientState>> clientStates(List<String> empSeqs) async => const [];
}

void main() {
  testWidgets('대화방 ☆로 즐겨찾기 → 목록 위 "즐겨찾기" 구역, 다시 누르면 해제(계정별 저장)', (tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(ProviderScope(overrides: [
      messengerApiProvider.overrideWithValue(_Api()),
      messengerMqttProvider.overrideWithValue(MessengerMqtt()),
      pinnedAccountProvider.overrideWithValue('a@innogrid.com'),
    ], child: const MaterialApp(home: MessengerChatScreen())));
    await tester.pumpAndSettle();
    expect(find.text('즐겨찾기'), findsNothing); // 즐겨찾기가 없으면 구역 없음
    await tester.tap(find.text('영업팀'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('즐겨찾기'));
    await tester.pumpAndSettle();
    expect(find.byTooltip('즐겨찾기 해제'), findsOneWidget);
    expect((await SharedPreferences.getInstance()).getStringList('messenger.favorites.a@innogrid.com'), ['r2']);
    await tester.tap(find.byTooltip('뒤로'));
    await tester.pumpAndSettle();
    expect(find.text('즐겨찾기'), findsOneWidget);
    expect(find.text('대화방'), findsOneWidget);
    expect(tester.getTopLeft(find.text('영업팀')).dy, lessThan(tester.getTopLeft(find.text('개발팀')).dy)); // 즐겨찾기 구역이 위
    await tester.tap(find.text('영업팀'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('즐겨찾기 해제'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('뒤로'));
    await tester.pumpAndSettle();
    expect(find.text('즐겨찾기'), findsNothing);
  });
}
