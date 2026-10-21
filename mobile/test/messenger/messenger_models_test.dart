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

  group('MsgAttend', () {
    test('messengerYn=Y·atNm 있는 건만, 시간대 유효 판정', () {
      final list = MsgAttend.parseList([
        {'empSeq': '7', 'empNm': '강승억', 'atNm': '연차', 'messengerYn': 'Y', 'startTimestamp': 100, 'endTimestamp': 200},
        {'empSeq': '8', 'empNm': '홍길동', 'atNm': '출장', 'messengerYn': 'N'}, // 제외
        {'empSeq': '9', 'empNm': '김', 'atNm': '', 'messengerYn': 'Y'}, // atNm 없음 제외
      ]);
      expect(list.length, 1);
      expect(list[0].atName, '연차');
      expect(list[0].activeAt(DateTime.fromMillisecondsSinceEpoch(150)), isTrue);
      expect(list[0].activeAt(DateTime.fromMillisecondsSinceEpoch(300)), isFalse);
    });
    test('attendList 키·배열 둘 다 받는다', () {
      expect(MsgAttend.parseList({'attendList': [{'empSeq': '1', 'empNm': 'a', 'atNm': '재택', 'messengerYn': 'Y'}]}).length, 1);
    });
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
    expect(MsgAttend.parseList({}), isEmpty);
  });

  test('멘션 표식은 @이름으로 보여 준다(본문·미리보기)', () {
    const raw = '|>@empseq="2146",name="김민철"@<| |>@empseq="2773",name="김홍진"@<| CSO 본부 중심으로 진행해 주세요.';
    final chat = MsgChat.fromRow({'chatId': '1', 'roomId': 'r', 'sendEmpSeq': '9', 'content': raw, 'contentType': '0', 'timeStamp': 1});
    expect(chat.displayContent, '@김민철 @김홍진 CSO 본부 중심으로 진행해 주세요.');
    final room = MsgRoom.minimal('r').copyPreview(raw);
    expect(room.preview, startsWith('@김민철 @김홍진'));
  });
}

extension on MsgRoom {
  // 테스트용: lastChat만 바꾼 사본(미리보기 확인).
  MsgRoom copyPreview(String lastChat) => MsgRoom(
        roomId: roomId, roomType: roomType, title: title, rawTitle: rawTitle,
        lastChat: lastChat, lastChatTimeStamp: lastChatTimeStamp, unreadCount: unreadCount,
        contentType: '0', alarmOn: true, receiverSeqs: receiverSeqs, receiverNames: receiverNames);
}
