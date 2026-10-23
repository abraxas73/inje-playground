import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/messenger/messenger_api.dart';
import 'package:playground/messenger/messenger_chat_screen.dart';
import 'package:playground/messenger/messenger_client.dart';
import 'package:playground/messenger/messenger_models.dart';
import 'package:playground/messenger/messenger_mqtt.dart';
import 'package:playground/messenger/messenger_new_chat_screen.dart';
import 'package:playground/messenger/messenger_provider.dart';

http.Response _json(Object o) => http.Response(jsonEncode(o), 200, headers: {'content-type': 'application/json'});

/// P190(기존 방)·P078(만들기)를 흉내 — calls에 (pid, body)를 남긴다.
(MessengerApi, List<(String, Map)>) _server({String existing = ''}) {
  final calls = <(String, Map)>[];
  final m = MockClient((r) async {
    final path = r.url.path;
    if (path == '/get_token/') return _json({'token': 't', 'cur_date': '20261023'});
    if (path == '/proxymgw/proxymgw01A01') {
      return _json({'resultCode': 0, 'resultData': {'protocolList': [for (final p in ['P076', 'P078', 'P190']) {'protocolId': p, 'protocolUrl': 'https://gw.innogrid.com/proxymgw/$p'}]}});
    }
    final env = jsonDecode(r.body) as Map;
    final pid = (env['header'] as Map)['pid'] as String;
    if (pid == 'P076') return _json({'resultCode': 0, 'resultData': {'token': 'T', 'hashKey': 'H', 'empSeq': 'me', 'companyList': []}});
    calls.add((pid, env['body'] as Map));
    return _json({'resultCode': 0, 'resultData': {'roomId': pid == 'P190' ? existing : 'new-room'}});
  });
  return (MessengerApi(MessengerClient(httpClient: m, loadCreds: () async => (id: 'u', pw: 'p'))), calls);
}

class _Api extends MessengerApi {
  _Api() : super(MessengerClient(httpClient: MockClient((_) async => http.Response('{}', 404)), loadCreds: () async => null));
  List<String>? opened;
  @override
  Future<String> openRoomWith(List<String> others) async {
    opened = others;
    return 'r9';
  }
  @override
  Future<List<MsgChat>> chats(String roomId, {String timeStamp = '0', int pageSize = 50}) async => const [];
}

void main() {
  test('1:1 — 기존 방이 있으면 그 방(P190만), 만들지 않는다', () async {
    final (api, calls) = _server(existing: 'old-room');
    expect(await api.openRoomWith(['p1']), 'old-room');
    expect([for (final c in calls) c.$1], ['P190']);
    expect(calls.first.$2['roomType'], '1');
    expect(calls.first.$2['receiver'], [{'empSeq': 'p1'}, {'empSeq': 'me'}]);
  });

  test('1:1 — 없으면 P078로 만든다(방장 없음)', () async {
    final (api, calls) = _server();
    expect(await api.openRoomWith(['p1', 'me']), 'new-room'); // 나는 상대에서 빠진다
    expect([for (final c in calls) c.$1], ['P190', 'P078']);
    final b = calls.last.$2;
    expect(b['roomType'], '1');
    expect(b['receiver'], [{'empSeq': 'p1'}, {'empSeq': 'me'}]);
    expect(b['roomLeaderEmpSeq'], '');
  });

  test('그룹 — 늘 새로(P078), 내가 방장', () async {
    final (api, calls) = _server(existing: 'x');
    expect(await api.openRoomWith(['p1', 'p2']), 'new-room');
    expect([for (final c in calls) c.$1], ['P078']);
    final b = calls.single.$2;
    expect(b['roomType'], '2');
    expect(b['roomLeaderEmpSeq'], 'me');
    expect(b['receiver'], [{'roomOwnerYn': 'N', 'empSeq': 'p1'}, {'roomOwnerYn': 'N', 'empSeq': 'p2'}, {'roomOwnerYn': 'Y', 'empSeq': 'me'}]);
  });

  testWidgets('새 대화: 이름으로 찾아 고르고 시작하면 그 방이 열린다', (tester) async {
    final api = _Api();
    await tester.pumpWidget(ProviderScope(overrides: [
      messengerApiProvider.overrideWithValue(api),
      messengerMqttProvider.overrideWithValue(MessengerMqtt()),
      msgRosterProvider.overrideWith((_) async => [
            (empSeq: '11', name: '박석현', dept: '플랫폼팀', duty: '책임'),
            (empSeq: '12', name: '김철수', dept: '영업팀', duty: ''),
          ]),
    ], child: const MaterialApp(home: MessengerNewChatScreen())));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), '석현');
    await tester.pumpAndSettle();
    expect(find.text('김철수'), findsNothing);
    await tester.tap(find.text('박석현'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('대화 시작'));
    await tester.pumpAndSettle();
    expect(api.opened, ['11']);
    expect(find.byType(MessengerRoomScreen), findsOneWidget);
    expect(tester.widget<MessengerRoomScreen>(find.byType(MessengerRoomScreen)).room.title, '박석현');
  });
}
