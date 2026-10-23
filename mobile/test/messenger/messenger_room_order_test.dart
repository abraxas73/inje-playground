import 'package:flutter_test/flutter_test.dart';
import 'package:playground/messenger/messenger_chat_screen.dart';
import 'package:playground/messenger/messenger_models.dart';

MsgRoom room(String id, DateTime at, {int unread = 0}) => MsgRoom(
    roomId: id, roomType: '', title: id, rawTitle: id, lastChat: '', lastChatTimeStamp: at.millisecondsSinceEpoch, unreadCount: unread,
    contentType: '0', alarmOn: true, receiverSeqs: const [], receiverNames: const {});

void main() {
  // KST = UTC+9. 오늘 = 2026-10-23(KST)
  final now = DateTime.utc(2026, 10, 23, 3); // 12:00 KST
  test('대화방은 날짜까지 보고 최신이 위(시각만 보면 어제 23시가 오늘 9시보다 위로 갔다)', () {
    final rooms = [
      room('오늘 09:15', DateTime.utc(2026, 10, 23, 0, 15)),
      room('어제 23:40', DateTime.utc(2026, 10, 22, 14, 40), unread: 3),
      room('오늘 10:22', DateTime.utc(2026, 10, 23, 1, 22)),
      room('그제 11:00', DateTime.utc(2026, 10, 21, 2)),
    ];
    sortRoomsNewest(rooms);
    expect(rooms.map((r) => r.roomId), ['오늘 10:22', '오늘 09:15', '어제 23:40', '그제 11:00']);
  });
  test('목록 시각: 오늘 HH:mm · 어제 · 그 전 M/D (KST 기준)', () {
    expect(roomWhen(DateTime.utc(2026, 10, 23, 0, 15), now: now), '09:15');
    expect(roomWhen(DateTime.utc(2026, 10, 22, 14, 40), now: now), '어제'); // 22일 23:40 KST
    expect(roomWhen(DateTime.utc(2026, 10, 22, 15, 10), now: now), '00:10'); // 23일 00:10 KST = 오늘
    expect(roomWhen(DateTime.utc(2026, 10, 21, 2), now: now), '10/21');
  });
}
