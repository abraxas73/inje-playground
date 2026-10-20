import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/gw/gw_api.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/gw/gw_connect_screen.dart';
import 'package:playground/gw/gw_gate.dart';
import 'fakes.dart';

http.Response ok(Object data) => http.Response.bytes(utf8.encode(jsonEncode({'resultCode': 0, 'resultData': data})), 200, headers: {'content-type': 'application/json; charset=utf-8'}) /* 한글 본문은 latin1 기본 인코딩에서 ArgumentError */;
const session = {'sessionInfo': {'ucUserInfo': {'compSeq': '10', 'deptSeq': '20', 'empName': '홍길동', 'emailAdd': 'hong', 'emailDomain': 'innogrid.com', 'erpEmpSeq': 'E', 'erpDeptSeq': 'D', 'erpCompSeq': 'C'}}};

void main() {
  test('verifyGwCookies: 쿠키 → gw050A02 검증 → 이름·이메일을 채운 크레덴셜', () async {
    final c = await verifyGwCookies('oAuthToken=g%7C7%7Cs; signKey=k', MockClient((_) async => ok(session)));
    expect((c.authToken, c.empName, c.email), ('g|7|s', '홍길동', 'hong@innogrid.com'));
    await expectLater(verifyGwCookies('nothing=1', MockClient((_) async => ok(session))), throwsA(isA<GwException>()));
    await expectLater(verifyGwCookies('oAuthToken=a; signKey=b', MockClient((_) async => http.Response('{}', 401))), throwsA(isA<GwUnauthorized>()));
  });
  testWidgets('연결 화면: 저장된 로그인 정보가 없으면 네이티브 입력칸 → 자동 입력 경로(WebView 입력칸을 누르지 않게)', (tester) async {
    FlutterSecureStorage.setMockInitialValues({});
    await tester.pumpWidget(gwScope(http: MockClient((_) async => ok(session)), child: GwConnectScreen(webView: () => const Text('WEBVIEW'))));
    await tester.pumpAndSettle();
    expect(find.text('아마란스 로그인'), findsOneWidget);
    expect(find.textContaining('자동 로그인 중'), findsNothing);
    await tester.tap(find.text('로그인'));
    await tester.pump();
    expect(find.textContaining('모두 입력하세요'), findsOneWidget); // 빈 값은 넘기지 않는다
    await tester.enterText(find.widgetWithText(TextField, '아이디'), 'me');
    await tester.enterText(find.widgetWithText(TextField, '비밀번호'), 'pw');
    await tester.tap(find.text('로그인'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.textContaining('자동 로그인 중'), findsOneWidget);
    expect(find.text('아마란스 로그인'), findsNothing);
  });
  testWidgets('연결 화면: 입력칸 대신 웹 화면에서 직접 로그인할 수도 있다', (tester) async {
    FlutterSecureStorage.setMockInitialValues({});
    await tester.pumpWidget(gwScope(http: MockClient((_) async => ok(session)), child: GwConnectScreen(webView: () => const Text('WEBVIEW'))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('아마란스 웹 화면에서 직접 로그인'));
    await tester.pumpAndSettle();
    expect(find.text('아마란스 로그인'), findsNothing);
    expect(find.textContaining('아마란스에 로그인'), findsOneWidget);
    expect(find.text('WEBVIEW'), findsOneWidget);
  });
  testWidgets('연결 화면: 저장된 로그인 정보가 있으면 WebView를 가리고 자동 로그인 패널', (tester) async {
    FlutterSecureStorage.setMockInitialValues({'gw.loginId': 'me', 'gw.loginPw': 'pw'});
    await tester.pumpWidget(gwScope(http: MockClient((_) async => ok(session)), child: GwConnectScreen(webView: () => const Text('WEBVIEW'))));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100)); // 진행 표시가 돌고 있어 settle은 안 된다
    expect(find.textContaining('자동 로그인 중'), findsOneWidget);
    expect(find.text('직접 로그인'), findsOneWidget); // 수동 전환 버튼
    await tester.tap(find.text('직접 로그인'));
    await tester.pumpAndSettle();
    expect(find.textContaining('자동 로그인 중'), findsNothing);
  });
  test('1초 감시는 앱이 가리고 자동 입력할 때만(사람이 입력하는 동안은 페이지 이동 신호로만 — iOS 27 키보드 닫힘)', () {
    expect(gwShouldPoll(auto: true, busy: false), isTrue);
    expect(gwShouldPoll(auto: false, busy: false), isFalse);
    expect(gwShouldPoll(auto: true, busy: true), isFalse);
  });
  testWidgets('GwGate: 미연결이면 연결 안내, 연결되면 builder', (tester) async {
    await tester.pumpWidget(gwScope(http: MockClient((_) async => ok(session)), child: GwGate(title: '미결 결재', builder: (_, api) => const Text('BODY'))));
    await tester.pumpAndSettle();
    expect(find.text('아마란스 연결하기'), findsOneWidget);
    expect(find.text('BODY'), findsNothing);
    await tester.pumpWidget(gwScope(creds: testCreds, http: MockClient((_) async => ok(session)), child: GwGate(title: '미결 결재', builder: (_, GwApi api) => const Text('BODY'))));
    await tester.pumpAndSettle();
    expect(find.text('BODY'), findsOneWidget);
  });
}
