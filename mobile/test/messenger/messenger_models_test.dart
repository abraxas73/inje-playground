import 'package:flutter_test/flutter_test.dart';
import 'package:playground/messenger/messenger_models.dart';

void main() {
  group('MsgRoom', () {
    test('roomTitle·lastChat·unReadCount·receiver를 읽고, 나와의 대화는 제목 치환', () {
      final rooms = MsgRoom.parseList({'roomList': [
        {'roomId': 'r1', 'roomType': '1', 'roomTitle': '개발팀', 'lastChat': '회의합시다', 'lastChatTimeStamp': 1700000000000, 'unReadCount': 3, 'contentType': '0', 'roomAlarmYn': 'Y', 'receiver': [{'empSeq': '7'}, {'empSeq': '8'}]},
        {'roomId': 'r2', 'roomType': '7', 'content': '메모', 'timeStamp': 1700000001000, 'unReadCount': 0, 'contentType': '0'},
      ]});
      expect(rooms.length, 2);
      expect(rooms[0].title, '개발팀');
      expect(rooms[0].preview, '회의합시다');
      expect(rooms[0].unreadCount, 3);
      expect(rooms[0].receiverSeqs, ['7', '8']);
      expect(rooms[0].lastAt!.millisecondsSinceEpoch, 1700000000000);
      expect(rooms[1].title, '나와의 대화');
      expect(rooms[1].lastChat, '메모'); // content 폴백
    });
    test('제목 없으면 인원수, contentType별 미리보기 치환', () {
      final r = MsgRoom.fromRow({'roomId': 'x', 'roomType': '1', 'receiver': ['7', '8', '9'], 'contentType': '7'});
      expect(r.title, '3명 대화');
      expect(r.preview, '삭제된 메시지입니다.');
    });
    test('receiver에 이름이 함께 오면(isUserInfo=Y) 제목에 바로 쓴다', () {
      final r = MsgRoom.fromRow({'roomId': 'x', 'roomType': '1', 'receiver': [{'empSeq': '7', 'empName': '나'}, {'empSeq': '8', 'empName': '홍길동'}]});
      expect(r.receiverNames['8'], '홍길동');
      expect(r.titleWith(const {}, '7'), '홍길동'); // 외부 names 없이도 해석
      expect(r.unresolvedSeqs('7'), isEmpty); // 더 조회할 것 없음
    });
    test('titleWith: roomTitle 없으면 참여자 이름(나 제외), 7은 나와의 대화', () {
      final r = MsgRoom.fromRow({'roomId': 'x', 'roomType': '1', 'receiver': ['7', '8', '9']});
      expect(r.titleWith({'8': '홍길동', '9': '김철수'}, '7'), '홍길동, 김철수');
      final rt = MsgRoom.fromRow({'roomId': 'y', 'roomType': '1', 'roomTitle': '개발팀', 'receiver': ['8']});
      expect(rt.titleWith({'8': '홍길동'}, '7'), '개발팀'); // roomTitle 우선
      final me = MsgRoom.fromRow({'roomId': 'z', 'roomType': '7'});
      expect(me.titleWith(const {}, '7'), '나와의 대화');
      // 이름 못 찾으면 기본 제목 유지
      expect(MsgRoom.fromRow({'roomId': 'w', 'roomType': '1', 'receiver': ['8', '9']}).titleWith(const {}, '7'), '2명 대화');
    });
  });

  test('MsgChat: chatList 파싱 + 삭제/내 메시지 판별', () {
    final chats = MsgChat.parseList({'chatList': [
      {'chatId': 'c1', 'roomId': 'r1', 'sendEmpSeq': '7', 'content': '안녕', 'contentType': '0', 'timeStamp': 1700000000000, 'unReadUserCount': 2},
      {'chatId': 'c2', 'roomId': 'r1', 'sendEmpSeq': '8', 'content': '', 'contentType': '7', 'timeStamp': 1700000001000},
    ]});
    expect(chats[0].content, '안녕');
    expect(chats[0].sendEmpSeq, '7');
    expect(chats[1].deleted, isTrue);
  });

  test('MsgNote: 제목·보낸이 폴백 파싱', () {
    final notes = MsgNote.parseList({'msgList': [
      {'msgId': 'm1', 'msgTitle': '공지', 'sendEmpName': '관리자', 'recvDate': '20261021'},
    ]});
    expect(notes[0].title, '공지');
    expect(notes[0].sender, '관리자');
  });

  test('빈/비정상 응답은 빈 목록', () {
    expect(MsgRoom.parseList(null), isEmpty);
    expect(MsgChat.parseList({'chatList': 'x'}), isEmpty);
  });

  test('멘션 표식은 @이름으로 보여 준다(본문·미리보기)', () {
    const raw = '|>@empseq="2146",name="김민철"@<| |>@empseq="2773",name="김홍진"@<| CSO 본부 중심으로 진행해 주세요.';
    final chat = MsgChat.fromRow({'chatId': '1', 'roomId': 'r', 'sendEmpSeq': '9', 'content': raw, 'contentType': '0', 'timeStamp': 1});
    expect(chat.displayContent, '@김민철 @김홍진 CSO 본부 중심으로 진행해 주세요.');
    final room = MsgRoom.minimal('r').copyPreview(raw);
    expect(room.preview, startsWith('@김민철 @김홍진'));
  });

  test('대화 본문은 줄바꿈을 그대로 둔다(미리보기만 한 줄로)', () {
    const raw = '안내드립니다.\n1. 첫째\n2. 둘째 |>@empseq="1",name="홍길동"@<|';
    final chat = MsgChat.fromRow({'chatId': '1', 'roomId': 'r', 'sendEmpSeq': '9', 'content': raw, 'contentType': '0', 'timeStamp': 1});
    expect(chat.displayContent, '안내드립니다.\n1. 첫째\n2. 둘째 @홍길동');
    expect(MsgRoom.minimal('r').copyPreview(raw).preview, '안내드립니다. 1. 첫째 2. 둘째 @홍길동');
  });
}

extension on MsgRoom {
  // 테스트용: lastChat만 바꾼 사본(미리보기 확인).
  MsgRoom copyPreview(String lastChat) => MsgRoom(
        roomId: roomId, roomType: roomType, title: title, rawTitle: rawTitle,
        lastChat: lastChat, lastChatTimeStamp: lastChatTimeStamp, unreadCount: unreadCount,
        contentType: '0', alarmOn: true, receiverSeqs: receiverSeqs, receiverNames: receiverNames);
}
