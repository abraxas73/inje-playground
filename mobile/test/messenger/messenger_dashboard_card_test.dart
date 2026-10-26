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
  var last = '안녕';
  var loads = 0;
  @override
  Future<List<MsgRoom>> rooms({String timeStamp = '0', int pageSize = 50}) async {
    loads++;
    return MsgRoom.parseList({'roomList': [{'roomId': 'r1', 'roomType': '1', 'roomTitle': '개발팀', 'lastChat': last, 'contentType': '0'}]});
  }
  @override
  Future<Map<String, String>> userNames(List<String> empSeqs) async => const {};
}

void main() {
  testWidgets('간략 위젯: 새 대화 신호(MQTT)가 오면 0.5초 묶어 목록을 다시 읽는다 — 다시 읽는 동안 스피너 없이 기존 목록 유지', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final api = _Api();
    final mqtt = MessengerMqtt();
    await tester.pumpWidget(ProviderScope(overrides: [
      messengerApiProvider.overrideWithValue(api),
      messengerMqttProvider.overrideWithValue(mqtt),
      pinnedAccountProvider.overrideWithValue('a@innogrid.com'),
    ], child: MaterialApp(home: Scaffold(body: MessengerDashboardCard(onMore: () {})))));
    await tester.pumpAndSettle();
    expect(find.textContaining('안녕'), findsOneWidget);
    expect(api.loads, 1);
    api.last = '새 메시지';
    const ev = MessengerMqttEvent(topic: 'x/Chat', type: '001', roomId: 'r1', empSeq: '', stateCode: '', raw: {});
    mqtt.debugEmit(ev);
    mqtt.debugEmit(ev); // 연속 신호는 한 번으로
    await tester.pump(const Duration(milliseconds: 600));
    expect(find.byType(CircularProgressIndicator), findsNothing);
    await tester.pumpAndSettle();
    expect(api.loads, 2);
    expect(find.textContaining('새 메시지'), findsOneWidget);
    mqtt.debugEmit(const MessengerMqttEvent(topic: 'x/State', type: '', roomId: '', empSeq: '9', stateCode: '1', raw: {})); // 접속 상태는 무시
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();
    expect(api.loads, 2);
  });
}
