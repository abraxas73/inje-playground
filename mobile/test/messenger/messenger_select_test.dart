import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/main.dart' show SelectAllText;
import 'package:playground/messenger/messenger_api.dart';
import 'package:playground/messenger/messenger_chat_screen.dart';
import 'package:playground/messenger/messenger_client.dart';
import 'package:playground/messenger/messenger_models.dart';
import 'package:playground/messenger/messenger_mqtt.dart';
import 'package:playground/messenger/messenger_provider.dart';

class _Api extends MessengerApi {
  _Api() : super(MessengerClient(httpClient: MockClient((_) async => http.Response('{}', 404)), loadCreds: () async => null));
  @override
  Future<List<MsgChat>> chats(String roomId, {String timeStamp = '0', int pageSize = 50}) async => [
        MsgChat.fromRow({'chatId': 'c1', 'roomId': roomId, 'sendEmpSeq': '9', 'content': '복사할 대화 본문입니다', 'contentType': '0', 'timeStamp': 1}),
      ];
  @override
  Future<Map<String, String>> userNames(List<String> empSeqs) async => {'9': '홍길동'};
  int reads = 0;
  @override
  Future<void> readChat({required String roomId, required String chatId}) async => reads++;
}

void main() {
  testWidgets('메신저 대화방: 끌어 선택한 글이 실시간 새로고침 뒤에도 복사된다(로딩 표시로 목록을 갈아 끼우지 않음)', (tester) async {
    String? copied;
    final api = _Api();
    final mqtt = MessengerMqtt();
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (c) async {
      if (c.method == 'Clipboard.setData') copied = (c.arguments as Map)['text'] as String?;
      return null;
    });
    await tester.pumpWidget(ProviderScope(overrides: [
      messengerApiProvider.overrideWithValue(api),
      messengerMqttProvider.overrideWithValue(mqtt),
    ], child: MaterialApp(builder: (c, child) => SelectAllText(child: child!), home: MessengerRoomScreen(room: MsgRoom.minimal('r1', title: '개발팀')))));
    await tester.pumpAndSettle();
    final f = find.text('복사할 대화 본문입니다');
    expect(f, findsOneWidget);
    final r = tester.getRect(f);
    final g = await tester.startGesture(r.centerLeft + const Offset(1, 0), kind: PointerDeviceKind.mouse);
    await tester.pump();
    await g.moveTo(r.centerRight - const Offset(1, 0));
    await tester.pump();
    await g.up();
    await tester.pumpAndSettle();
    // 선택한 상태에서 이 방 대화 신호가 와 새로고침
    mqtt.debugEmit(const MessengerMqttEvent(topic: 'x/Chat', type: '001', roomId: 'r1', empSeq: '', stateCode: '', raw: {}));
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsNothing); // 새로고침 중에도 기존 대화 유지
    await tester.pumpAndSettle();
    await tester.sendKeyDownEvent(LogicalKeyboardKey.metaLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyC);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.metaLeft);
    await tester.pumpAndSettle();
    expect(copied, '복사할 대화 본문입니다');
    expect(api.reads, 1); // 같은 마지막 대화면 새로고침해도 읽음 처리를 반복하지 않는다
  }, variant: TargetPlatformVariant.only(TargetPlatform.macOS));
}
