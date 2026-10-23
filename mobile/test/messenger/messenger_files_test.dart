import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/messenger/messenger_api.dart';
import 'package:playground/messenger/messenger_chat_screen.dart';
import 'package:playground/messenger/messenger_client.dart';
import 'package:playground/messenger/messenger_files.dart';
import 'package:playground/messenger/messenger_models.dart';
import 'package:playground/messenger/messenger_mqtt.dart';
import 'package:playground/messenger/messenger_provider.dart';

http.Response _json(Object o) => http.Response(jsonEncode(o), 200, headers: {'content-type': 'application/json'});

// 1×1 PNG
final _png = base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');

class _Api extends MessengerApi {
  _Api() : super(MessengerClient(httpClient: MockClient((_) async => http.Response('{}', 404)), loadCreds: () async => null));
  final sent = <List<String>>[];
  @override
  Future<List<MsgChat>> chats(String roomId, {String timeStamp = '0', int pageSize = 50}) async => [
        MsgChat.fromRow({'chatId': 'c1', 'roomId': roomId, 'sendEmpSeq': '9', 'content': '', 'contentType': '1', 'timeStamp': 1,
          'fileList': [{'fileSn': '0', 'originalFileName': '스크린샷', 'fileExtsn': 'png', 'fileSize': 70, 'fileWidth': 1, 'fileHeight': 1}]}),
        MsgChat.fromRow({'chatId': 'c2', 'roomId': roomId, 'sendEmpSeq': '9', 'content': '', 'contentType': '1', 'timeStamp': 2,
          'fileList': [{'fileSn': '0', 'originalFileName': '견적서', 'fileExtsn': 'pdf', 'fileSize': 2048}]}),
      ];
  @override
  Future<Map<String, String>> userNames(List<String> empSeqs) async => {'9': '홍길동'};
  @override
  Future<void> readChat({required String roomId, required String chatId}) async {}
  @override
  Future<Uint8List> thumbnail(String chatId, String fileSn) async => _png;
  @override
  Future<void> sendFiles({required String roomId, required List<MsgUpload> files}) async => sent.add([for (final f in files) f.name]);
}

Future<_Api> _open(WidgetTester tester, {List<MsgUpload> picked = const [], List<MsgUpload>? clip}) async {
  final api = _Api();
  await tester.pumpWidget(ProviderScope(overrides: [
    messengerApiProvider.overrideWithValue(api),
    messengerMqttProvider.overrideWithValue(MessengerMqtt()),
    msgFilePickerProvider.overrideWithValue(() async => picked),
    msgClipboardProvider.overrideWithValue(() async => clip),
  ], child: MaterialApp(home: MessengerRoomScreen(room: MsgRoom.minimal('r1', title: '방')))));
  await tester.pumpAndSettle();
  return api;
}

void main() {
  test('대화 첨부: fileList를 읽고 그림은 확장자로 가른다, 지워진 파일 표시', () {
    final c = MsgChat.fromRow({'chatId': 'c', 'contentType': '1', 'fileDelYn': 'N', 'fileList': [
      {'fileSn': '0', 'originalFileName': 'a', 'fileExtsn': 'JPG', 'fileSize': 10, 'fileWidth': 300, 'fileHeight': 200},
      {'fileSn': '1', 'originalFileName': 'b.tar', 'fileExtsn': 'gz', 'fileSize': 5},
    ]});
    expect([for (final f in c.files) f.name], ['a.JPG', 'b.tar.gz']);
    expect([for (final f in c.files) f.isImage], [true, false]);
    expect(c.files.first.width, 300);
    expect(MsgChat.fromRow({'contentType': '1', 'fileDelYn': 'Y'}).fileExpired, isTrue);
    // 글 대화에 붙어 오는 빈 fileList·fileDelYn은 첨부가 아니다
    final text = MsgChat.fromRow({'contentType': '0', 'content': '안녕', 'fileDelYn': 'Y', 'fileList': [{'fileSn': '0'}]});
    expect(text.files, isEmpty);
    expect(text.fileExpired, isFalse);
    expect(MsgChat.fromRow({'contentType': '1', 'fileList': [{'fileSn': '0'}]}).files, isEmpty);
  });

  test('붙여넣은 그림 이름·형식(macOS PNG, Windows BMP)', () {
    expect(captureName(DateTime(2026, 10, 23, 9, 5, 7)), '20261023_09_05_07');
    expect(imageExtOf(_png), 'png');
    expect(imageExtOf(Uint8List.fromList([0x42, 0x4D, 0, 0])), 'bmp');
    expect(imageExtOf(Uint8List.fromList([0xFF, 0xD8, 0xFF])), 'jpg');
  });

  test('파일 보내기: P079 multipart — 그림은 한 대화로 묶고 그 밖의 파일은 하나씩, contentType 1·pathSeq 800', () async {
    final uploads = <http.Request>[];
    final server = MockClient((r) async {
      final path = r.url.path;
      if (path == '/get_token/') return _json({'token': 't', 'cur_date': '20261023'});
      if (path == '/proxymgw/proxymgw01A01') {
        return _json({'resultCode': 0, 'resultData': {'protocolList': [
          {'protocolId': 'P076', 'protocolUrl': 'https://gw.innogrid.com/proxymgw/login'},
          {'protocolId': 'P079', 'protocolUrl': 'https://gw.innogrid.com/proxymgw/send'},
        ]}});
      }
      if (path == '/proxymgw/login') return _json({'resultCode': 0, 'resultData': {'token': 'MTOK', 'hashKey': 'HK', 'empSeq': '7', 'empName': '강승억', 'companyList': []}});
      uploads.add(r);
      return _json({'resultCode': 0, 'resultData': {'chatId': 'n', 'file': []}});
    });
    final api = MessengerApi(MessengerClient(httpClient: server, loadCreds: () async => (id: 'u', pw: 'p')));
    final bytes = Uint8List.fromList([1, 2, 3]);
    await api.sendFiles(roomId: 'r1', files: [(name: 'a.png', bytes: bytes), (name: '문서.pdf', bytes: bytes), (name: 'b.JPG', bytes: bytes)]);
    expect(uploads, hasLength(2));
    final first = utf8.decode(uploads[0].bodyBytes, allowMalformed: true);
    expect(uploads[0].headers['content-type'], startsWith('multipart/form-data'));
    expect(uploads[0].headers['wehago-sign'], isNotEmpty);
    expect('name="file"'.allMatches(first).length, 2);
    expect(first, contains('filename="a.png"'));
    expect(first, contains('filename="b.JPG"'));
    expect(first, contains('name="pathSeq"\r\n\r\n800'));
    final envelope = jsonDecode(RegExp(r'name="body"\r\n(?:[^\r\n]+\r\n)*\r\n(.*?)\r\n--', dotAll: true).firstMatch(first)!.group(1)!) as Map;
    expect(envelope['header']['pid'], 'P079');
    expect(envelope['body']['contentType'], '1');
    expect(envelope['body']['roomId'], 'r1');
    expect(envelope['body']['empName'], '강승억');
    expect(envelope['body']['file'], isEmpty);
    expect('name="file"'.allMatches(utf8.decode(uploads[1].bodyBytes, allowMalformed: true)).length, 1);
  });

  testWidgets('대화방: 그림은 미리보기, 파일은 이름·크기로 보인다', (tester) async {
    await _open(tester);
    expect(find.byWidgetPredicate((w) => w is Image && w.image is MemoryImage), findsOneWidget);
    expect(find.text('견적서.pdf'), findsOneWidget);
    expect(find.text('2KB'), findsOneWidget);
  });

  testWidgets('📎 파일 고르기 → 확인 → 보내기', (tester) async {
    final api = await _open(tester, picked: [(name: '보고서.docx', bytes: Uint8List(4))]);
    await tester.tap(find.byTooltip('파일 보내기'));
    await tester.pumpAndSettle();
    expect(find.text('파일 1개 보내기'), findsOneWidget);
    await tester.tap(find.text('보내기'));
    await tester.pumpAndSettle();
    expect(api.sent, [['보고서.docx']]);
  });

  testWidgets('입력창에 그림 붙여넣기(Ctrl+V) → 미리보기 확인 → 보내기, 글자만 있으면 평소 붙여넣기', (tester) async {
    final api = await _open(tester, clip: [(name: '20261023_09_05_07.png', bytes: _png)]);
    await tester.tap(find.byType(TextField));
    await tester.pump();
    await tester.sendKeyDownEvent(LogicalKeyboardKey.control);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyV);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.control);
    await tester.pumpAndSettle();
    expect(find.text('그림 보내기'), findsOneWidget);
    await tester.tap(find.text('보내기'));
    await tester.pumpAndSettle();
    expect(api.sent, [['20261023_09_05_07.png']]);

    // 클립보드에 보낼 파일·그림이 없으면 글자 붙여넣기 그대로
    final api2 = await _open(tester);
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (c) async => c.method == 'Clipboard.getData' ? {'text': '안녕'} : null);
    await tester.tap(find.byType(TextField));
    await tester.pump();
    await tester.sendKeyDownEvent(LogicalKeyboardKey.control);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyV);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.control);
    await tester.pumpAndSettle();
    expect(find.text('그림 보내기'), findsNothing);
    expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, '안녕');
    expect(api2.sent, isEmpty);
  });
}
