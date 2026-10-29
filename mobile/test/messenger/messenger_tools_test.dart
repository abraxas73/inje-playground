import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/messenger/messenger_api.dart';
import 'package:playground/messenger/messenger_client.dart';
import 'package:playground/messenger/messenger_models.dart';
import 'package:playground/messenger/messenger_tools.dart';

class _Client extends MessengerClient {
  _Client() : super(httpClient: MockClient((_) async => http.Response('{}', 404)), loadCreds: () async => null);
  @override
  Future<MessengerSession> ensureSession() async => MessengerSession(
      token: 't', hashKey: 'h', loginId: 'me', groupSeq: 'g', empSeq: '1', companyInfo: const {}, mqtt: const {}, currentTime: 0);
}

class _Api extends MessengerApi {
  _Api() : super(_Client());
  final sent = <(String, String)>[];
  final opened = <List<String>>[];
  final reads = <String>[];
  @override
  Future<List<MsgRoom>> rooms({String timeStamp = '0', int pageSize = 50}) async => [
        MsgRoom.fromRow({'roomId': 'old', 'roomType': '1', 'receiver': [{'empSeq': '1'}, {'empSeq': '9'}], 'lastChat': '예전', 'lastChatTimeStamp': 1, 'unReadCount': 0}),
        MsgRoom.fromRow({'roomId': 'sys', 'roomType': '3', 'roomTitle': '알림', 'lastChatTimeStamp': 9}),
        MsgRoom.fromRow({'roomId': 'new', 'roomType': '2', 'roomTitle': '개발팀', 'lastChat': '회의 10시', 'lastChatTimeStamp': 5, 'unReadCount': 2}),
      ];
  @override
  Future<List<MsgChat>> chats(String roomId, {String timeStamp = '0', int pageSize = 50}) async => [
        MsgChat.fromRow({'chatId': 'c2', 'roomId': roomId, 'sendEmpSeq': '1', 'content': '네', 'contentType': '0', 'timeStamp': 2}),
        MsgChat.fromRow({'chatId': 'c1', 'roomId': roomId, 'sendEmpSeq': '9', 'content': '자료 보내 주세요', 'contentType': '0', 'timeStamp': 1}),
        MsgChat.fromRow({'chatId': 'c3', 'roomId': roomId, 'sendEmpSeq': '9', 'content': '비번은 1234', 'contentType': '0', 'timeStamp': 3, 'talkSecuYn': 'Y'}),
      ];
  @override
  Future<Map<String, String>> userNames(List<String> empSeqs) async => {for (final e in empSeqs) if (e == '9') e: '홍길동'};
  @override
  Future<void> readChat({required String roomId, required String chatId}) async => reads.add(chatId);
  @override
  Future<String> openRoomWith(List<String> others) async {
    opened.add(others);
    return 'r-new';
  }

  @override
  Future<void> sendChat({required String roomId, required String content, String? uuid}) async => sent.add((roomId, content));
}

void main() {
  test('대화방 목록: 시스템 방 빼고 최근 순, 상대 이름 제목, unread_only', () async {
    final t = MessengerTools(_Api());
    final r = await t.rooms();
    final rooms = r['rooms'] as List;
    expect([for (final x in rooms) (x as Map)['room_id']], ['new', 'old']);
    expect((rooms[1] as Map)['title'], '홍길동');
    expect((rooms[0] as Map)['unread'], 2);
    expect(((await t.rooms(unreadOnly: true))['rooms'] as List).length, 1);
  });

  test('대화 읽기: 시간순, 나/이름, 비밀대화 본문은 가리고 읽음 처리하지 않는다', () async {
    final api = _Api();
    final r = await MessengerTools(api).read('old');
    final msgs = [for (final m in r['messages'] as List) m as Map];
    expect([for (final m in msgs) m['chat_id']], ['c1', 'c2', 'c3']);
    expect(msgs[0]['from'], '홍길동');
    expect(msgs[1]['from'], '나');
    expect(msgs[2]['text'], isNot(contains('1234')));
    expect(api.reads, isEmpty);
  });

  test('보내기: room_id면 그 방, 없으면 상대와 방을 열고 보낸다. 확인용 대상 이름', () async {
    final api = _Api();
    final t = MessengerTools(api);
    expect(await t.target(roomId: 'new'), '개발팀');
    expect(await t.target(empSeqs: ['9']), '홍길동');
    await expectLater(t.target(roomId: 'nope'), throwsA(isA<MessengerException>()));
    await expectLater(t.target(empSeqs: ['777']), throwsA(isA<MessengerException>()));
    await t.send(roomId: 'new', text: '안녕하세요');
    await t.send(empSeqs: ['9'], text: '확인했습니다');
    expect(api.sent, [('new', '안녕하세요'), ('r-new', '확인했습니다')]);
    expect(api.opened, [['9']]);
    await expectLater(t.send(roomId: 'new', text: '  '), throwsA(isA<MessengerException>()));
  });
}
