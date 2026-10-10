import 'dart:convert';
import 'gw_client.dart' show asInt, asStr;

/// 아마란스 알림센터(/event/event02A01)의 메신저 알림(eventType TALK) — 순수 모델·파싱.
/// 그룹웨어 알림에는 메신저 **알파멘션만** 올라오고 일반 채팅은 안 올라온다(2026-10-10 실측: 한 달 780건 중 TALK은 멘션 1건, mentionYn=N 조회 0건).
/// 본문의 멘션 표식 `|>@empseq="3060",name="강승억"@<|`은 `@강승억`으로 바꾼다. 토큰·세션 값은 담지 않는다.
class GwTalkAlert {
  const GwTalkAlert({required this.alertId, required this.room, required this.sender, required this.text, required this.createTime, required this.read, this.roomId = '', this.chatId = ''});
  final String alertId, room, sender, text, roomId, chatId;

  /// epoch ms(서버 createTime)
  final int createTime;
  final bool read;

  DateTime get at => DateTime.fromMillisecondsSinceEpoch(createTime);

  static GwTalkAlert? fromRow(dynamic r) {
    if (r is! Map) return null;
    final msg = r['message'] is Map ? r['message'] as Map : const {};
    final title = asStr(msg['alertTitle']);
    Map data = const {};
    try {
      final d = r['data'];
      final decoded = d is String ? jsonDecode(d) : d;
      if (decoded is Map) data = decoded;
    } catch (_) {}
    final content = data['content'] is Map ? asStr((data['content'] as Map)['kr']) : '';
    final text = stripTalkMentions(content.isNotEmpty ? content : asStr(msg['alertContent']));
    final id = asStr(r['alertId']);
    if (id.isEmpty) return null;
    return GwTalkAlert(
      alertId: id,
      room: talkRoom(title),
      sender: asStr(data['senderName']).isNotEmpty ? asStr(data['senderName']) : talkSender(title),
      text: text,
      createTime: asInt(r['createTime']),
      read: asStr(r['readDate']).isNotEmpty,
      roomId: asStr(data['roomId']),
      chatId: asStr(data['chatId']),
    );
  }

  /// resultData.alertList → 목록(최근순 유지). TALK이 아닌 항목은 뺀다(서버 필터가 바뀌어도 안전하게).
  static List<GwTalkAlert> parseList(dynamic resultData) {
    final list = resultData is Map && resultData['alertList'] is List ? resultData['alertList'] as List : const [];
    return [
      for (final r in list)
        if (r is Map && asStr(r['eventType']) == 'TALK') ?fromRow(r),
    ];
  }
}

final _mention = RegExp(r'\|>@empseq="[^"]*",name="([^"]*)"@<\|');

/// 멘션 표식 → @이름, 공백 정리
String stripTalkMentions(String s) => s.replaceAllMapped(_mention, (m) => '@${m[1]}').replaceAll(RegExp(r'\s+'), ' ').trim();

/// "[일반미팅룸] 김명진님의 알파멘션" → "일반미팅룸"
String talkRoom(String title) => RegExp(r'^\s*\[([^\]]+)\]').firstMatch(title)?.group(1)?.trim() ?? '';

/// "[일반미팅룸] 김명진님의 알파멘션" → "김명진"
String talkSender(String title) => RegExp(r'\]\s*(.+?)님의').firstMatch(title)?.group(1)?.trim() ?? '';
