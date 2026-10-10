import 'package:flutter_test/flutter_test.dart';
import 'package:playground/gw/talk_alert_watcher.dart';
import 'package:playground/gw/talk_alerts.dart';

Map<String, dynamic> row({String id = 'a1', int t = 1788768172403, String read = '', String type = 'TALK'}) => {
  'alertId': id,
  'eventType': type,
  'eventSubType': 'TA001',
  'readDate': read,
  'createTime': t,
  'message': {'alertTitle': '[일반미팅룸] 김명진님의 알파멘션', 'alertContent': '|>@empseq="3060",name="강승억"@<| 메일 확인'},
  'data': '{"roomId":"g736Op8B8UMsNYcoPspr","chatId":"rUDkeqABS1S8-sNaN4Jy","senderName":"김명진","content":{"kr":"|>@empseq=\\"3060\\",name=\\"강승억\\"@<| |>@empseq=\\"3080\\",name=\\"유서봉\\"@<|   주기적 클라우드 기술 TF 회의 w/ NHN 메일 확인 해주세요."}}',
};

void main() {
  test('알림 행 → 방·보낸 사람·본문(멘션 표식은 @이름)·읽음·방 id', () {
    final a = GwTalkAlert.fromRow(row())!;
    expect(a.room, '일반미팅룸');
    expect(a.sender, '김명진');
    expect(a.text, '@강승억 @유서봉 주기적 클라우드 기술 TF 회의 w/ NHN 메일 확인 해주세요.');
    expect(a.read, false);
    expect(a.roomId, 'g736Op8B8UMsNYcoPspr');
    expect(a.chatId, 'rUDkeqABS1S8-sNaN4Jy');
    expect(a.at.millisecondsSinceEpoch, 1788768172403);
    expect(GwTalkAlert.fromRow(row(read: '20261007142356222'))!.read, true);
    expect(GwTalkAlert.fromRow(row(id: ''))?.alertId, isNull);
  });
  test('목록은 TALK만, alertList가 없으면 빈 목록', () {
    final list = GwTalkAlert.parseList({'alertList': [row(), row(id: 'm1', type: 'MAIL'), 'bad']});
    expect(list.map((a) => a.alertId), ['a1']);
    expect(GwTalkAlert.parseList(null), isEmpty);
  });
  test('제목에서 방·보낸 사람, data 없이도 동작', () {
    expect(talkRoom('[프로젝트룸] 홍길동님의 알파멘션'), '프로젝트룸');
    expect(talkSender('[프로젝트룸] 홍길동님의 알파멘션'), '홍길동');
    expect(stripTalkMentions('|>@empseq="1",name="가"@<|   안녕'), '@가 안녕');
    final a = GwTalkAlert.fromRow({...row(), 'data': 'not json'})!;
    expect(a.sender, '김명진');
    expect(a.text, '@강승억 메일 확인');
  });

  group('데스크탑 감시(TalkAlertWatcher)', () {
    test('첫 실행은 알림 없이 최신 시각을 기준으로, 이후 새 것만 오래된 순으로 알리고 기준을 올린다', () async {
      var seen = 0;
      final notified = <String>[];
      var list = [GwTalkAlert.fromRow(row(id: 'a2', t: 200))!, GwTalkAlert.fromRow(row(id: 'a1', t: 100))!];
      final w = TalkAlertWatcher(fetch: () async => list, notify: (a) async => notified.add(a.alertId), loadSeen: () async => seen, saveSeen: (t) async => seen = t);
      await w.tick();
      expect(notified, isEmpty);
      expect(seen, 200);
      list = [GwTalkAlert.fromRow(row(id: 'a4', t: 400))!, GwTalkAlert.fromRow(row(id: 'a3', t: 300))!, ...list];
      await w.tick();
      expect(notified, ['a3', 'a4']);
      expect(seen, 400);
      await w.tick();
      expect(notified, ['a3', 'a4']); // 같은 목록은 다시 알리지 않는다
    });
    test('조회 실패는 조용히 넘기고 기준을 바꾸지 않는다', () async {
      var seen = 150;
      final w = TalkAlertWatcher(fetch: () async => throw Exception('boom'), notify: (_) async => fail('알림 없어야 함'), loadSeen: () async => seen, saveSeen: (t) async => seen = t);
      await w.tick();
      expect(seen, 150);
    });
  });
}
