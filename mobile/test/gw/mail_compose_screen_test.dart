import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/gw/gw_api.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/gw/mail_compose.dart';
import 'package:playground/gw/mail_compose_screen.dart';
import 'fakes.dart';

http.Response _ok(Object? data) => http.Response.bytes(utf8.encode(jsonEncode({'resultCode': 0, 'resultData': data})), 200, headers: {'content-type': 'application/json; charset=utf-8'});

void main() {
  testWidgets('답장: 받는 사람·Re: 제목이 채워지고, 확인 뒤에만 보낸다', (tester) async {
    final paths = <String>[];
    Map? initReq;
    final client = MockClient((r) async {
      paths.add(r.url.path);
      return switch (r.url.path) {
        '/mail/mail014A01' => () {
            initReq = jsonDecode(r.body) as Map;
            return _ok({'email': 'me@innogrid.com', 'mailInfo': {'muid': '777', 'decodeMime': {'from': '김철수 <kim@innogrid.com>', 'subject': '주간 보고'}, 'mime': {'body': {'html': '<p>원문</p>'}}}});
          }(),
        '/mail/mail014A04' => _ok({'result': true}),
        _ => _ok({'sessionInfo': {'ucUserInfo': {'empName': '나', 'emailAdd': 'me', 'emailDomain': 'innogrid.com'}}}),
      };
    });
    final api = GwApi(GwClient(httpClient: client, creds: () => testCreds));
    await tester.pumpWidget(ProviderScope(
      overrides: [mailContactsProvider.overrideWith((_) async => const [])],
      child: MaterialApp(home: Builder(builder: (c) => TextButton(onPressed: () => Navigator.of(c).push(MaterialPageRoute(builder: (_) => MailComposeScreen(api: api, kind: MailKind.reply, muid: '777'))), child: const Text('열기')))),
    ));
    await tester.tap(find.text('열기'));
    await tester.pumpAndSettle();
    expect((initReq!['mailKind'], initReq!['uid'], initReq!['viewFlag']), ('re', '777', 'noRead'));
    expect(find.text('김철수 <kim@innogrid.com>'), findsOneWidget);
    expect(find.text('Re: 주간 보고'), findsOneWidget);
    expect(find.text('원본 메일이 본문 아래에 붙습니다.'), findsOneWidget);

    await tester.enterText(find.widgetWithText(TextField, '내용'), '확인했습니다');
    await tester.tap(find.text('보내기'));
    await tester.pumpAndSettle();
    expect(find.text('메일을 보낼까요?'), findsOneWidget);
    await tester.tap(find.text('취소'));
    await tester.pumpAndSettle();
    expect(paths.contains('/mail/mail014A04'), isFalse); // 취소하면 안 보낸다

    await tester.tap(find.text('보내기'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, '보내기').last);
    await tester.pumpAndSettle();
    expect(paths.where((p) => p == '/mail/mail014A04'), hasLength(1));
    expect(find.text('열기'), findsOneWidget); // 보내고 닫힘
  });
}
