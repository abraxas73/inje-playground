import 'dart:convert';
import 'gw_api.dart';
import 'gw_client.dart' show asInt, asStr;
import 'talk_alerts.dart' show TimedAlert, stripTalkMentions, talkRoom, talkSender;

/// 아마란스 알림센터 전체(/event/event02A01, eventType 비움) — 메일·결재·일정·게시판·메신저 멘션 등.
/// 2026-10-29 실측(1주 200건): MAIL 141, SCHEDULE 31, EAPPROVAL 21, BOARD 6, KISS 1. 읽음은 /event/event02A03(웹 알림센터와 같은 서버 상태),
/// 안 읽은 건수 /event/event02A12, 모두 읽음 /event/event02A04(mentionYn ALERT).
enum GwAlertKind { mail, approval, schedule, board, talk, other }

const gwAlertKindLabels = {
  GwAlertKind.mail: '메일',
  GwAlertKind.approval: '결재',
  GwAlertKind.schedule: '일정',
  GwAlertKind.board: '게시판',
  GwAlertKind.talk: '멘션',
  GwAlertKind.other: '기타',
};

GwAlertKind gwAlertKind(String eventType) => switch (eventType) {
      'MAIL' => GwAlertKind.mail,
      'EAPPROVAL' => GwAlertKind.approval,
      'SCHEDULE' => GwAlertKind.schedule,
      'BOARD' => GwAlertKind.board,
      'TALK' => GwAlertKind.talk,
      _ => GwAlertKind.other,
    };

class GwAlert implements TimedAlert {
  const GwAlert({required this.alertId, required this.kind, required this.title, required this.content, required this.createTime, required this.read, required this.path, this.webUrl = ''});
  @override
  final String alertId;
  final String title, content;
  final GwAlertKind kind;
  @override
  final int createTime; // epoch ms
  final bool read;

  /// 앱 안 경로(결재 문서·메일 본문·대화방). 비면 [webUrl](그룹웨어 웹)로 연다.
  final String path;
  final String webUrl;

  DateTime get at => DateTime.fromMillisecondsSinceEpoch(createTime);

  /// myEmpSeq: 메일 알림의 수신자 목록에서 내 메일 번호(muid)를 고르는 데 쓴다.
  static GwAlert? fromRow(Object? r, {required String myEmpSeq, String gwBase = 'https://gw.innogrid.com'}) {
    if (r is! Map) return null;
    final id = asStr(r['alertId']);
    if (id.isEmpty) return null;
    final type = asStr(r['eventType']);
    final kind = gwAlertKind(type);
    final msg = r['message'] is Map ? r['message'] as Map : const {};
    Map data = const {};
    try {
      final d = r['data'];
      final decoded = d is String ? jsonDecode(d) : d;
      if (decoded is Map) data = decoded;
    } catch (_) {}
    var title = asStr(msg['alertTitle']).trim();
    var content = asStr(msg['alertContent']).replaceAll(RegExp(r'\s+'), ' ').trim();
    var path = '';
    switch (kind) {
      case GwAlertKind.approval:
        final doc = asStr(data['doc_id']);
        final form = RegExp(r'formId=(\d+)').firstMatch(asStr(r['url']))?.group(1) ?? '';
        if (doc.isNotEmpty && form.isNotEmpty) path = '/gw/approval?doc=$doc&form=$form&title=${Uri.encodeComponent(asStr(data['title']))}';
      case GwAlertKind.mail:
        final recv = data['recvList'] is List ? data['recvList'] as List : const [];
        final me = recv.whereType<Map>().where((x) => asStr(x['empSeq']) == myEmpSeq).firstOrNull;
        final muid = me == null ? '' : asStr(me['muid']);
        final subject = title.replaceFirst(RegExp(r'^\[메일\]\s*'), '');
        if (muid.isNotEmpty) path = '/gw/mail/view?muid=$muid&subject=${Uri.encodeComponent(subject)}&from=${Uri.encodeComponent(asStr(data['senderName']))}&email=${Uri.encodeComponent(asStr(data['sendEmail']))}';
      case GwAlertKind.talk:
        final content2 = data['content'] is Map ? asStr((data['content'] as Map)['kr']) : '';
        content = stripTalkMentions(content2.isNotEmpty ? content2 : content);
        final sender = asStr(data['senderName']).isNotEmpty ? asStr(data['senderName']) : talkSender(title);
        final room = talkRoom(title);
        title = '$sender${room.isEmpty ? '' : ' · $room'}님의 멘션';
        final roomId = asStr(data['roomId']);
        path = roomId.isEmpty ? '/gw/messenger' : '/gw/room?id=${Uri.encodeComponent(roomId)}&title=${Uri.encodeComponent(sender.isEmpty ? room : sender)}';
      default:
        break;
    }
    final url = asStr(r['url']);
    return GwAlert(
      alertId: id,
      kind: kind,
      title: title.isEmpty ? gwAlertKindLabels[kind]! : title,
      content: content,
      createTime: asInt(r['createTime']),
      read: asStr(r['readDate']).isNotEmpty,
      path: path,
      // 자리표시자({0})가 남은 주소는 웹에서도 못 연다 → 그룹웨어 첫 화면
      webUrl: url.startsWith('/#/') && !url.contains('{') ? '$gwBase$url' : '$gwBase/#/',
    );
  }

  static List<GwAlert> parseList(Object? resultData, {required String myEmpSeq}) {
    final list = resultData is Map && resultData['alertList'] is List ? resultData['alertList'] as List : const [];
    return [for (final r in list) ?fromRow(r, myEmpSeq: myEmpSeq)];
  }
}

extension GwAlertApi on GwApi {
  /// 안 읽은 알림(최근순). newYn Y = 안 읽은 것만(2026-10-29 실측), 그래도 읽은 건 한 번 더 거른다.
  Future<List<GwAlert>> alerts({int pageSize = 50}) async {
    final c = client.creds();
    final d = await client.call('/event/event02A01', {
      'header': {'groupSeq': c.groupSeq, 'empSeq': c.empSeq},
      'body': {'reqType': '2', 'reqSubType': 'N', 'pageSize': '$pageSize', 'newYn': 'Y', 'mentionYn': 'N', 'langCode': 'kr', 'eventType': '', 'searchType': 'received', 'timeStamp': DateTime.now().millisecondsSinceEpoch},
    });
    return GwAlert.parseList(d, myEmpSeq: c.empSeq).where((a) => !a.read).toList();
  }

  /// 안 읽은 알림 수(웹 알림센터 배지와 같은 값).
  Future<int> alertCount() async {
    final c = client.creds();
    final d = await client.call('/event/event02A12', {'header': {'groupSeq': c.groupSeq, 'empSeq': c.empSeq}, 'body': {'eventType': ''}});
    return d is Map ? asInt(d['alertCnt']) : 0;
  }

  /// 읽음 처리 — 그룹웨어 웹·아마란스 앱과 같은 서버 상태. bizSeq는 세션에 없어 비워도 된다(실측).
  Future<void> readAlerts(List<String> ids) async {
    if (ids.isEmpty) return;
    final c = client.creds();
    final s = await client.session();
    await client.call('/event/event02A03', {
      'header': {'groupSeq': c.groupSeq, 'empSeq': c.empSeq, 'pid': '', 'tid': ''},
      'body': {'companyInfo': {'compSeq': s.compSeq, 'bizSeq': '', 'deptSeq': s.deptSeq, 'emailAddr': s.emailAddr, 'emailDomain': s.emailDomain}, 'alertIds': ids},
    });
  }

  /// 모두 읽음(웹 알림 탭의 '모두 읽음').
  Future<void> readAllAlerts() async {
    final c = client.creds();
    await client.call('/event/event02A04', {'header': {'groupSeq': c.groupSeq, 'empSeq': c.empSeq}, 'body': {'mentionYn': 'ALERT', 'eventType': ''}});
  }
}
