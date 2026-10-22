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

  testWidgets('넓은 창에서는 긴 메시지도 한 줄(줄바꿈 문자만 줄을 바꾼다)', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1800, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(ProviderScope(overrides: [
      messengerApiProvider.overrideWithValue(_Api()),
      messengerMqttProvider.overrideWithValue(MessengerMqtt()),
    ], child: MaterialApp(home: MessengerRoomScreen(room: MsgRoom.minimal('r1', title: '개발팀')))));
    await tester.pumpAndSettle();
    final one = tester.getSize(find.text('복사할 대화 본문입니다'));
    // 예전 고정 폭(280)이면 이 길이는 넘치지 않지만, 폭 제한 자체가 화면의 80%인지 확인
    final box = tester.widget<Container>(find.ancestor(of: find.text('복사할 대화 본문입니다'), matching: find.byType(Container)).first);
    expect(box.constraints?.maxWidth, greaterThan(1000));
    expect(one.height, lessThan(30)); // 한 줄
  });

  testWidgets('메시지를 Enter로 보낸 뒤에도 입력창에 포커스가 남는다(이어서 대화)', (tester) async {
    final api = _SendApi();
    await tester.pumpWidget(ProviderScope(overrides: [
      messengerApiProvider.overrideWithValue(api),
      messengerMqttProvider.overrideWithValue(MessengerMqtt()),
    ], child: MaterialApp(home: MessengerRoomScreen(room: MsgRoom.minimal('r1', title: '개발팀')))));
    await tester.pumpAndSettle();
    final field = find.byType(TextField);
    await tester.tap(field);
    await tester.enterText(field, '첫 메시지');
    await tester.testTextInput.receiveAction(TextInputAction.send);
    await tester.pumpAndSettle();
    expect(api.sent, ['첫 메시지']);
    expect(tester.widget<EditableText>(find.byType(EditableText)).focusNode.hasFocus, isTrue);
  });
}

class _SendApi extends _Api {
  final sent = <String>[];
  @override
  Future<void> sendChat({required String roomId, required String content, String? uuid}) async => sent.add(content);
}

