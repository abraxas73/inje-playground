import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/gw/gw_api.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/gw/mail_compose_screen.dart';
import 'package:playground/messenger/messenger_api.dart';
import 'package:playground/messenger/messenger_chat_screen.dart';
import 'package:playground/messenger/messenger_client.dart';
import 'package:playground/messenger/messenger_models.dart';
import 'package:playground/messenger/messenger_mqtt.dart';
import 'package:playground/messenger/messenger_provider.dart';
import 'package:playground/web/app_actions.dart';
import '../gw/fakes.dart';

class _Api extends MessengerApi {
  _Api() : super(MessengerClient(httpClient: MockClient((_) async => http.Response('{}', 404)), loadCreds: () async => null));
  List<String>? opened;
  @override
  Future<String> openRoomWith(List<String> others) async {
    opened = others;
    return 'r1';
  }
  @override
  Future<List<MsgChat>> chats(String roomId, {String timeStamp = '0', int pageSize = 50}) async => const [];
}

Future<void> _run(WidgetTester tester, Uri uri, List<Override> overrides) async {
  await tester.pumpWidget(ProviderScope(
    key: UniqueKey(),
    overrides: overrides,
    child: MaterialApp(home: Scaffold(body: Consumer(builder: (c, ref, _) => TextButton(onPressed: () => handleAppAction(c, ref, uri), child: const Text('열기'))))),
  ));
  await tester.tap(find.text('열기'));
  await tester.pumpAndSettle();
}

void main() {
  final origin = Uri.parse('https://innocrew.innogrid.com');
  test('같은 사이트의 /app-action만 앱 요청', () {
    expect(isAppAction(Uri.parse('https://innocrew.innogrid.com/app-action?kind=mail'), origin), isTrue);
    expect(isAppAction(Uri.parse('https://evil.com/app-action?kind=mail'), origin), isFalse);
    expect(isAppAction(Uri.parse('https://innocrew.innogrid.com/org'), origin), isFalse);
  });

  testWidgets('messenger — 고른 사번으로 방을 열고 대화방 화면(여럿이면 "외 N명")', (tester) async {
    final api = _Api();
    await _run(tester, Uri.parse('https://innocrew.innogrid.com/app-action?kind=messenger&emp=11,12&names=박석현,김철수'), [
      messengerApiProvider.overrideWithValue(api),
      messengerMqttProvider.overrideWithValue(MessengerMqtt()),
    ]);
    expect(api.opened, ['11', '12']);
    expect(tester.widget<MessengerRoomScreen>(find.byType(MessengerRoomScreen)).room.title, '박석현 외 1명');
  });

  testWidgets('mail — 받는 사람을 채운 메일 쓰기, 아마란스 미연결이면 안내', (tester) async {
    final gw = GwApi(GwClient(httpClient: MockClient((_) async => http.Response.bytes(utf8.encode('{"resultCode":0,"resultData":{"email":"me@x.com","sessionInfo":{"ucUserInfo":{"empName":"나","emailAdd":"me","emailDomain":"x.com"}}}}'), 200, headers: {'content-type': 'application/json; charset=utf-8'})), creds: () => testCreds));
    await _run(tester, Uri.parse('https://innocrew.innogrid.com/app-action?kind=mail&to=a@x.com,b@x.com'), [
      gwApiProvider.overrideWithValue(gw),
      mailContactsProvider.overrideWith((_) async => const []),
    ]);
    expect(find.byType(MailComposeScreen), findsOneWidget);
    expect(find.text('a@x.com, b@x.com'), findsOneWidget);

    await _run(tester, Uri.parse('https://innocrew.innogrid.com/app-action?kind=mail&to=a@x.com'), [gwApiProvider.overrideWithValue(null)]);
    expect(find.textContaining('아마란스를 먼저 연결'), findsOneWidget);
  });
}
