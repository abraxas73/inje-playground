import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/gw/gw_api.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/gw/mail_compose.dart';
import 'package:playground/gw/mail_compose_screen.dart';
import 'package:playground/messenger/messenger_files.dart' show msgClipboardProvider;
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
    await tester.scrollUntilVisible(find.text('원본 메일이 본문 아래에 붙습니다.'), 200, scrollable: find.byType(Scrollable).first); // 첨부 줄·안내가 늘어 화면 아래로 밀렸다
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

  testWidgets('붙여넣기: 복사한 그림·파일은 첨부 칩으로 붙고 함께 올린다, 글자는 평소대로', (tester) async {
    final paths = <String>[];
    final client = MockClient((r) async {
      paths.add(r.url.path);
      return switch (r.url.path) {
        '/mail/mail014A01' => _ok({'email': 'me@innogrid.com'}),
        '/mail/mail014A06' => _ok({'list': [{'fileId': 'F1', 'originalFileName': '20261030_16_10_00.png', 'fileExtsn': 'png', 'fileSize': 3, 'filePath': '/x'}]}),
        '/mail/mail014A04' => _ok({'result': true}),
        _ => _ok({'sessionInfo': {'ucUserInfo': {'empName': '나', 'emailAdd': 'me', 'emailDomain': 'innogrid.com'}}}),
      };
    });
    final api = GwApi(GwClient(httpClient: client, creds: () => testCreds));
    List<({String name, Uint8List bytes})>? clip = [(name: '20261030_16_10_00.png', bytes: Uint8List.fromList([1, 2, 3]))];
    await tester.pumpWidget(ProviderScope(
      overrides: [mailContactsProvider.overrideWith((_) async => const []), msgClipboardProvider.overrideWithValue(() async => clip)],
      child: MaterialApp(home: MailComposeScreen(api: api, initialTo: 'kim@innogrid.com')),
    ));
    await tester.pumpAndSettle();
    expect(find.text('파일 첨부'), findsOneWidget);

    Future<void> paste() async {
      await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyV);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
      await tester.pumpAndSettle();
    }
    await tester.tap(find.widgetWithText(TextField, '내용'));
    await paste();
    expect(find.widgetWithText(InputChip, '20261030_16_10_00.png'), findsOneWidget);

    clip = null; // 글자만 있으면 첨부가 늘지 않는다
    await paste();
    expect(find.byType(InputChip), findsOneWidget);

    await tester.tap(find.text('보내기'));
    await tester.pumpAndSettle();
    expect(find.textContaining('첨부 1개'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, '보내기').last);
    await tester.pumpAndSettle();
    expect(paths, containsAllInOrder(['/mail/mail014A06', '/mail/mail014A04']));
  });
}
