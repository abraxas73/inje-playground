import 'dart:convert';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/gw/gw_api.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/gw/mail_compose.dart';
import 'package:playground/gw/mail_compose_screen.dart';
import 'package:playground/main.dart' show SelectAllText;
import 'fakes.dart';

void main() {
  testWidgets('받는 사람: 이름을 치면 명부 추천, 누르면 "이름 <주소>"로 들어가고 앞 사람은 남는다', (tester) async {
    final client = MockClient((r) async => http.Response.bytes(utf8.encode(jsonEncode({'resultCode': 0, 'resultData': {'sessionInfo': {'ucUserInfo': {'empName': '나', 'emailAdd': 'me', 'emailDomain': 'innogrid.com'}}}})), 200, headers: {'content-type': 'application/json; charset=utf-8'}));
    final api = GwApi(GwClient(httpClient: client, creds: () => testCreds));
    await tester.pumpWidget(ProviderScope(
      overrides: [mailContactsProvider.overrideWith((_) async => const [(name: '김철수', email: 'kim@innogrid.com', dept: '개발팀'), (name: '이영희', email: 'lee@innogrid.com', dept: '기획팀')])],
      child: MaterialApp(builder: (_, child) => SelectAllText(child: child!), home: MailComposeScreen(api: api, kind: MailKind.plain)), // 앱 전체 글자 선택(SelectAllText)처럼
    ));
    await tester.pumpAndSettle();
    final to = find.widgetWithText(TextField, '받는 사람');
    await tester.tap(to);
    await tester.enterText(to, '이영희 <lee@innogrid.com>, 김');
    const typed = '이영희 <lee@innogrid.com>, 김';
    tester.testTextInput.updateEditingValue(const TextEditingValue(text: typed, selection: TextSelection.collapsed(offset: typed.length), composing: TextRange(start: typed.length - 1, end: typed.length))); // '김'이 한글 입력기 조합 중
    await tester.pumpAndSettle();
    tester.testTextInput.log.clear();
    expect(find.text('김철수 · 개발팀'), findsOneWidget);
    await tester.tap(find.text('김철수 · 개발팀'), kind: PointerDeviceKind.mouse); // 데스크톱은 마우스 — 누르는 순간 칸 포커스가 빠지면 추천이 닫혀 선택이 안 됐다
    await tester.pump(); await tester.pump(const Duration(milliseconds: 300)); // 포커스가 돌아오면 macOS 커서가 계속 깜빡여 settle하지 않는다
    expect(tester.widget<TextField>(to).controller!.text, '이영희 <lee@innogrid.com>, 김철수 <kim@innogrid.com>, ');
    expect(tester.testTextInput.log.map((c) => c.method), contains('TextInput.clearClient')); // 입력 연결을 닫아 조합 중이던 '김'을 버린다
    expect(tester.widget<TextField>(to).focusNode!.hasFocus, isTrue); // 다음 사람을 바로 칠 수 있게 포커스는 돌아온다
    expect(find.text('김철수 · 개발팀'), findsNothing);
    final c = tester.widget<TextField>(to).controller!;
    expect(c.selection, TextSelection.collapsed(offset: c.text.length)); // 전체 선택이 아니라 끝에 커서 — 다음 글자가 앞 사람들을 지우지 않는다
  }, variant: TargetPlatformVariant.only(TargetPlatform.macOS));
}
