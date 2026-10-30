import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/api/client.dart';
import 'package:playground/gw/gw_alerts.dart';
import 'package:playground/messenger/messenger_client.dart';
import 'package:playground/messenger/messenger_provider.dart';
import 'package:playground/notifications/gw_alerts_card.dart';
import '../assistant/chat_brain.dart' show BrainTokens;
import 'fakes.dart';

// 2026-10-29 실측 알림센터 행 모양(값은 줄임)
Map row(String id, String type, String sub, {String title = '', String content = '', String url = '', Object? data, int t = 1793238698825, String readDate = ''}) => {
      'alertId': id, 'eventType': type, 'eventSubType': sub, 'createTime': t, 'readDate': readDate, 'url': url,
      'message': {'alertTitle': title, 'alertContent': content}, 'data': data == null ? null : jsonEncode(data),
    };

final mail = row('a1', 'MAIL', 'MA001', title: '[메일] FW: 점검 FAQ', content: '보낸사람 : 박창원<cw@innogrid.com>', url: '/#/popup?{0}&{1}&callComp=UDAP006',
    data: {'senderName': '박창원', 'sendEmail': 'cw@innogrid.com', 'recvList': [{'muid': 111, 'empSeq': '2461'}, {'muid': 222, 'empSeq': '7'}]});
final approval = row('a2', 'EAPPROVAL', 'EA101', title: '[결재도착] 기안자:황세연', content: '[지출품의서] 자격증 취득지원', url: '/#/popup?callComp=UBAP002&MicroModuleCode=eap&docID=155488&formId=22',
    data: {'doc_id': '155488', 'title': '[지출품의서] 자격증 취득지원'}, t: 1793238698900);
final schedule = row('a3', 'SCHEDULE', 'SC001', title: '[일정등록] 현근주', content: '솔루션별 고도화 기능 논의(2026-11-05 15:00)', url: '/#/popup?MicroModuleCode=schres&callComp=UEAP011&schSeq=99457', data: {'schmSeq': '99457'});
final talk = row('a4', 'TALK', 'TA001', title: '[일반미팅룸] 김명진님의 알파멘션', data: {'senderName': '김명진', 'roomId': 'R1', 'content': {'kr': '|>@empseq="7",name="홍길동"@<| 메일 확인'}});

void main() {
  test('종류별 파싱: 결재는 문서로, 메일은 내 muid로, 일정은 그날 일정 화면, 멘션은 대화방', () {
    final list = GwAlert.parseList({'alertList': [mail, approval, schedule, talk, row('x', 'MAIL', 'MA001', readDate: '20261029')]}, myEmpSeq: '7');
    expect(list.map((a) => a.kind), [GwAlertKind.mail, GwAlertKind.approval, GwAlertKind.schedule, GwAlertKind.talk, GwAlertKind.mail]);
    expect(list.last.read, isTrue);
    expect(list[0].path, startsWith('/gw/mail/view?muid=222&subject=FW%3A%20%EC%A0%90%EA%B2%80%20FAQ'));
    expect(list[0].webUrl, 'https://gw.innogrid.com/#/'); // 자리표시자 남은 주소는 쓰지 않는다
    expect(list[1].path, startsWith('/gw/approval?doc=155488&form=22'));
    expect(list[2].path, '/gw/today?date=2026-11-05');
    expect(GwAlert.fromRow({...schedule, 'message': {'alertTitle': '[일정]', 'alertContent': '날짜 없음'}}, myEmpSeq: '7')!.path, '/gw/today');
    expect(list[2].webUrl, 'https://gw.innogrid.com/#/popup?MicroModuleCode=schres&callComp=UEAP011&schSeq=99457');
    expect(list[3].title, '김명진 · 일반미팅룸님의 멘션');
    expect(list[3].content, '@홍길동 메일 확인');
    expect(list[3].path, '/gw/room?id=R1&title=%EA%B9%80%EB%AA%85%EC%A7%84');
  });

  testWidgets('서버 읽음이 실패하면 알림이 목록·배지에 다시 보인다', (t) async {
    await _pumpCard(t, failRead: true, opened: []);
    await t.tap(find.text('[결재도착] 기안자:황세연'));
    await t.pumpAndSettle();
    expect(find.text('[결재도착] 기안자:황세연'), findsOneWidget);
    expect(find.text('아마란스 알림 317'), findsOneWidget);
  });

  testWidgets('알림 카드: 목록·배지는 서버 안 읽은 수, 메일 필터로 숨김, 누르면 그 화면 + 서버 읽음(event02A03)', (t) async {
    final opened = <String>[];
    final gwCalls = await _pumpCard(t, opened: opened);

    expect(find.text('아마란스 알림 317'), findsOneWidget);
    expect(find.text('[메일] FW: 점검 FAQ'), findsOneWidget);

    await t.tap(find.widgetWithText(FilterChip, '메일'));
    await t.pumpAndSettle();
    expect(find.text('[메일] FW: 점검 FAQ'), findsNothing);
    expect(find.text('아마란스 알림 2'), findsOneWidget); // 필터가 있으면 보이는 것만 센다

    await t.tap(find.text('[결재도착] 기안자:황세연'));
    await t.pumpAndSettle();
    expect(opened.single, startsWith('/gw/approval?doc=155488&form=22'));
    expect((gwCalls['/event/event02A03'] as Map)['body']['alertIds'], ['a2']);
    expect(find.text('[결재도착] 기안자:황세연'), findsNothing);
  });
}

Future<Map<String, Object?>> _pumpCard(WidgetTester t, {bool failRead = false, required List<String> opened}) async {
  final gwCalls = <String, Object?>{};
  final gw = MockClient((r) async {
      final body = r.body.isEmpty ? null : (r.headers['content-type'] ?? '').contains('json') ? jsonDecode(r.body) : r.body;
      gwCalls[r.url.path] = body;
      Object? data = switch (r.url.path) {
        '/gw/gw050A02' => {'sessionInfo': {'ucUserInfo': {'compSeq': '1', 'deptSeq': '2', 'emailAdd': 'hong', 'emailDomain': 'innogrid.com'}}},
        '/event/event02A01' => {'alertList': [mail, approval, schedule]},
        '/event/event02A12' => {'alertCnt': 317, 'mention': 0},
        _ => {},
      };
      if (failRead && r.url.path == '/event/event02A03') return http.Response('boom', 500);
      return http.Response(jsonEncode({'resultCode': 0, 'resultMsg': 'SUCCESS', 'resultData': data}), 200, headers: {'content-type': 'application/json; charset=utf-8'});
    });
    final api = ApiClient(httpClient: MockClient((r) async => http.Response('{"connected":false,"items":[]}', 200)), tokens: BrainTokens(), baseUrl: 'https://x.test', userAgent: 'UA');
    await t.binding.setSurfaceSize(const Size(500, 900));
    addTearDown(() => t.binding.setSurfaceSize(null));
    await t.pumpWidget(gwScope(creds: testCreds, http: gw, overrides: [
      apiClientProvider.overrideWithValue(api),
      messengerClientProvider.overrideWithValue(MessengerClient(httpClient: gw, loadCreds: () async => null)),
    ], child: Scaffold(body: SingleChildScrollView(child: GwAlertsCard(onOpenPath: opened.add)))));
  await t.pumpAndSettle();
  return gwCalls;
}
