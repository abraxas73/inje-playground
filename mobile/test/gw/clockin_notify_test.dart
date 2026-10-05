import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/api/client.dart';
import 'package:playground/gw/attendance_screen.dart';
import 'package:playground/gw/clockin_notify.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/gw/gw_creds.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'fakes.dart';
import 'screens_test.dart' show Routes, session;

class _Tokens implements TokenSource {
  @override Future<String?> accessToken() async => 't';
  @override Future<String?> refreshToken() async => 't';
  @override Future<void> onUnauthorized() async {}
}

const base = '/human/common/judgeTimeManagement';
Routes gw() => Routes({'/gw/gw050A02': [session], '$base/getTodayComeLeaveInfo': [{'comeTm': '', 'leaveTm': ''}, {'comeTm': '', 'leaveTm': ''}, {'comeTm': '202610050923', 'leaveTm': ''}, {'comeTm': '202610050923', 'leaveTm': ''}], '$base/confirmApplicationStatus': [{}], '$base/getJudgeTimeManagement': [{}]});

/// 앱 서버 가짜: Teams 채팅 목록·전송.
class App {
  final sent = <Map<String, dynamic>>[];
  ApiClient get client => ApiClient(httpClient: MockClient((r) async {
        final body = r.url.path == '/api/teams/chat'
            ? {'connected': true, 'hasChatScope': true, 'meId': 'me', 'chats': [{'id': 'c1', 'type': 'group', 'topic': '클라우드센터', 'members': [], 'webUrl': null, 'lastUpdated': null}, {'id': 'c2', 'type': 'oneOnOne', 'topic': '김민준', 'members': [], 'webUrl': null, 'lastUpdated': null}]}
            : r.url.path == '/api/teams/chat/messages'
                ? (() { sent.add(jsonDecode(r.body) as Map<String, dynamic>); return {'message': {'id': 'm'}}; })()
                : {'error': 'no'};
        return http.Response.bytes(utf8.encode(jsonEncode(body)), 200, headers: {'content-type': 'application/json; charset=utf-8'});
      }), tokens: _Tokens(), baseUrl: 'http://x', userAgent: 't');
}

Widget scope(Routes r, App app) => ProviderScope(
      key: UniqueKey(),
      overrides: [gwStoreProvider.overrideWithValue(FakeGwStore(testCreds)), gwHttpClientProvider.overrideWithValue(r.client), apiClientProvider.overrideWithValue(app.client)],
      child: const MaterialApp(home: AttendanceScreen()),
    );

void main() {
  test('clockInMessage — "9시 23분 출근했습니다." + 추가 문구(있으면 한 칸 띄워), 정각은 분 생략', () {
    expect(clockInMessage('202610050923', ''), '9시 23분 출근했습니다.');
    expect(clockInMessage('202610050923', '  오늘도 화이팅  '), '9시 23분 출근했습니다. 오늘도 화이팅');
    expect(clockInMessage('202610051000', ''), '10시 출근했습니다.');
    expect(clockInMessage('202610050805', ''), '8시 5분 출근했습니다.');
  });

  testWidgets('채팅방을 골라 두면: 출근 확인창에 "Teams에 알리기"가 켜져 있고, 추가 문구를 붙여 기록 후 그 채팅방에 보낸다', (tester) async {
    SharedPreferences.setMockInitialValues({'clockin.teams.chatId': 'c1', 'clockin.teams.topic': '클라우드센터', 'clockin.teams.enabled': true});
    final r = gw(), app = App();
    await tester.pumpWidget(scope(r, app));
    await tester.pumpAndSettle();
    await tester.tap(find.text('출근 기록'));
    await tester.pumpAndSettle();
    expect(find.textContaining('클라우드센터'), findsOneWidget);
    expect(tester.widget<Switch>(find.byType(Switch)).value, isTrue);
    await tester.enterText(find.byType(TextField), '오늘도 화이팅');
    await tester.tap(find.text('기록'));
    await tester.pumpAndSettle();
    expect(r.hits['$base/getJudgeTimeManagement'], 1);
    expect(app.sent, [{'chat': 'c1', 'text': '9시 23분 출근했습니다. 오늘도 화이팅'}]);
    expect(find.textContaining('클라우드센터에 알렸습니다'), findsOneWidget);
  });

  testWidgets('채팅방이 없으면 확인창에서 고를 수 있고(선택은 저장), 알리기를 끄면 보내지 않는다', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final r = gw(), app = App();
    await tester.pumpWidget(scope(r, app));
    await tester.pumpAndSettle();
    await tester.tap(find.text('출근 기록'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Teams 채팅방 고르기'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('김민준'));
    await tester.pumpAndSettle();
    expect(find.textContaining('김민준'), findsOneWidget);
    expect((await SharedPreferences.getInstance()).getString('clockin.teams.chatId'), 'c2');
    await tester.tap(find.byType(Switch)); // 끄기
    await tester.pumpAndSettle();
    await tester.tap(find.text('기록'));
    await tester.pumpAndSettle();
    expect(r.hits['$base/getJudgeTimeManagement'], 1);
    expect(app.sent, isEmpty);
    expect((await SharedPreferences.getInstance()).getBool('clockin.teams.enabled'), isFalse);
  });
}
