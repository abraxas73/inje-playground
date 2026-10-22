import '../gw/gw_client.dart' show asStr, asInt;
import '../gw/talk_alerts.dart' show replaceTalkMentions, stripTalkMentions;

/// 아마란스 메신저 응답 정제 — 순수 함수(네트워크 없음). 필드 출처: 메신저 번들 렌더러
/// (`DZRoomCard.vue`·`DZChatItem.vue`·`roomInfo.js`)와 `dz/dzhttp.js`. 서버 값은 asStr/asInt로만 읽는다.
/// 일부 필드는 라이브 로그인 응답으로 최종 확인이 필요하다(주석으로 표시).

String _asStr(Object? v) => asStr(v);
int _asInt(Object? v) => asInt(v);

/// 대화방(P077/P326). roomType: 3=시스템, 7=나와의 대화, 그 외 1:1·그룹.
class MsgRoom {
  const MsgRoom({
    required this.roomId,
    required this.roomType,
    required this.title,
    required this.rawTitle,
    required this.lastChat,
    required this.lastChatTimeStamp,
    required this.unreadCount,
    required this.contentType,
    required this.alarmOn,
    required this.receiverSeqs,
    required this.receiverNames,
  });

  final String roomId, roomType, title, rawTitle, lastChat, contentType;
  final int lastChatTimeStamp, unreadCount;
  final bool alarmOn;
  final List<String> receiverSeqs;

  /// 방 응답에 참여자 이름이 함께 온 경우(empSeq → 이름). 없으면 비어 있고 외부 해석(P1471)을 쓴다.
  final Map<String, String> receiverNames;

  /// 제목: roomType7=나와의 대화 > roomTitle > 참여자 이름(나 제외, 방 자체 이름 우선 → 외부 names) > 기본 title.
  String titleWith(Map<String, String> names, String myEmpSeq) {
    if (roomType == '7') return '나와의 대화';
    if (rawTitle.isNotEmpty) return rawTitle;
    final others = receiverSeqs.where((s) => s != myEmpSeq).toList();
    final resolved = [
      for (final s in others)
        if ((receiverNames[s] ?? names[s] ?? '').isNotEmpty) (receiverNames[s] ?? names[s])!,
    ];
    if (resolved.isEmpty) return title;
    final shown = resolved.take(4).join(', ');
    return others.length > 4 ? '$shown …' : shown;
  }

  /// titleWith가 쓸, 아직 이름을 모르는 참여자 seq(외부 P1471로 해석할 대상).
  List<String> unresolvedSeqs(String myEmpSeq) =>
      [for (final s in receiverSeqs) if (s != myEmpSeq && (receiverNames[s] ?? '').isEmpty) s];

  DateTime? get lastAt => lastChatTimeStamp > 0 ? DateTime.fromMillisecondsSinceEpoch(lastChatTimeStamp) : null;

  /// contentType별 마지막 대화 미리보기(사다리·삭제·화상·파일 등은 치환).
  String get preview => switch (contentType) {
        '6' => '사다리게임: 결과를 확인하세요.',
        '7' => '삭제된 메시지입니다.',
        '8' || '11' => '화상회의',
        _ => stripTalkMentions(lastChat), // 멘션 표식 |>@empseq=…,name="X"@<| → @X
      };

  /// roomId만 아는 상태에서 대화방 화면을 열기 위한 최소 방(검색의 대화 결과 → 방 이동).
  static MsgRoom minimal(String roomId, {String title = '대화'}) => MsgRoom(
        roomId: roomId, roomType: '', title: title, rawTitle: '', lastChat: '', lastChatTimeStamp: 0,
        unreadCount: 0, contentType: '', alarmOn: true, receiverSeqs: const [], receiverNames: const {});

  static MsgRoom fromRow(Map r) {
    final rawReceiver = r['receiver'] ?? r['roomReceiver'];
    final seqs = <String>[];
    final rnames = <String, String>{};
    if (rawReceiver is List) {
      for (final x in rawReceiver) {
        final seq = x is Map ? _asStr(x['empSeq']) : _asStr(x);
        seqs.add(seq);
        if (x is Map && seq.isNotEmpty) {
          // isUserInfo=Y면 이름이 함께 올 수 있다(필드명은 구현마다 다름)
          final nm = [x['empName'], x['empNm'], x['name'], x['userName']].map(_asStr).firstWhere((s) => s.isNotEmpty, orElse: () => '');
          if (nm.isNotEmpty) rnames[seq] = nm;
        }
      }
    }
    final type = _asStr(r['roomType']);
    // 표시 제목: 나와의 대화 > roomTitle > (이름은 조직 캐시 필요 → 없으면 인원수)
    final rt = _asStr(r['roomTitle']);
    final title = type == '7'
        ? '나와의 대화'
        : (rt.isNotEmpty ? rt : (seqs.isEmpty ? '대화상대없음' : '${seqs.length}명 대화'));
    return MsgRoom(
      roomId: _asStr(r['roomId']),
      roomType: type,
      title: title,
      rawTitle: rt,
      lastChat: _asStr(r['lastChat']).isNotEmpty ? _asStr(r['lastChat']) : _asStr(r['content']),
      lastChatTimeStamp: _asInt(r['lastChatTimeStamp']) != 0 ? _asInt(r['lastChatTimeStamp']) : _asInt(r['timeStamp']),
      unreadCount: _asInt(r['unReadCount']),
      contentType: _asStr(r['contentType']),
      alarmOn: _asStr(r['roomAlarmYn']) != 'N',
      receiverSeqs: seqs,
      receiverNames: rnames,
    );
  }

  /// resultData.roomList → 목록(서버 순서 유지).
  static List<MsgRoom> parseList(dynamic d) {
    final list = d is Map && d['roomList'] is List ? d['roomList'] as List : const [];
    return [for (final r in list) if (r is Map) fromRow(r)];
  }
}

/// 대화 한 건(P082). contentType: 0=텍스트, 7=삭제 등. sendEmpSeq로 내 메시지 여부 판단.
class MsgChat {
  const MsgChat({
    required this.chatId,
    required this.roomId,
    required this.sendEmpSeq,
    required this.content,
    required this.contentType,
    required this.timeStamp,
    required this.unReadUserCount,
  });

  final String chatId, roomId, sendEmpSeq, content, contentType;
  final int timeStamp, unReadUserCount;

  DateTime? get at => timeStamp > 0 ? DateTime.fromMillisecondsSinceEpoch(timeStamp) : null;
  bool get deleted => contentType == '7';

  /// 화면에 보일 본문 — 멘션 표식 |>@empseq=…,name="X"@<| 을 @X로 바꾼다.
  String get displayContent => replaceTalkMentions(content).trim(); // 줄바꿈 유지(목록 미리보기만 한 줄로 합침)

  static MsgChat fromRow(Map r) => MsgChat(
        chatId: _asStr(r['chatId']),
        roomId: _asStr(r['roomId']),
        sendEmpSeq: _asStr(r['sendEmpSeq']),
        content: _asStr(r['content']),
        contentType: _asStr(r['contentType']),
        timeStamp: _asInt(r['timeStamp']),
        unReadUserCount: _asInt(r['unReadUserCount']),
      );

  /// resultData.chatList → 목록(서버 순서 유지).
  static List<MsgChat> parseList(dynamic d) {
    final list = d is Map && d['chatList'] is List ? d['chatList'] as List : const [];
    return [for (final r in list) if (r is Map) fromRow(r)];
  }
}

/// 쪽지 한 건(P245). 목록 필드는 라이브 응답으로 최종 확인 필요(방어적 파싱).
class MsgNote {
  const MsgNote({required this.msgId, required this.title, required this.sender, required this.content, required this.recvDate, required this.read});
  final String msgId, title, sender, content, recvDate;
  final bool read;

  static MsgNote fromRow(Map r) => MsgNote(
        msgId: _asStr(r['msgId']),
        title: _asStr(r['msgTitle']).isNotEmpty ? _asStr(r['msgTitle']) : _asStr(r['title']),
        sender: _asStr(r['sendEmpName']).isNotEmpty ? _asStr(r['sendEmpName']) : _asStr(r['senderName']),
        content: _asStr(r['content']),
        recvDate: _asStr(r['recvDate']).isNotEmpty ? _asStr(r['recvDate']) : _asStr(r['sendDate']),
        read: _asStr(r['readYn']) == 'Y' || _asStr(r['recvDate']).isNotEmpty && _asStr(r['readDate']).isNotEmpty,
      );

  static List<MsgNote> parseList(dynamic d) {
    final list = d is Map && (d['msgList'] ?? d['postList'] ?? d['list']) is List ? (d['msgList'] ?? d['postList'] ?? d['list']) as List : const [];
    return [for (final r in list) if (r is Map) fromRow(r)];
  }
}

/// 오늘 근태 한 건(P1181). messengerYn='Y'이고 atNm 있는 건만 표시 대상.
class MsgAttend {
  const MsgAttend({required this.empSeq, required this.empName, required this.atName, required this.startTm, required this.endTm, required this.startTs, required this.endTs});
  final String empSeq, empName, atName, startTm, endTm;
  final int startTs, endTs;

  /// 지금 이 근태가 유효한 시간대인가(start ≤ now ≤ end).
  bool activeAt(DateTime now) {
    final t = now.millisecondsSinceEpoch;
    return (startTs == 0 || t >= startTs) && (endTs == 0 || t <= endTs);
  }

  static MsgAttend? fromRow(Map r) {
    if (_asStr(r['messengerYn']) != 'Y') return null;
    final nm = _asStr(r['atNm']);
    if (nm.isEmpty) return null;
    return MsgAttend(
      empSeq: _asStr(r['empSeq']),
      empName: _asStr(r['empNm']),
      atName: nm,
      startTm: _asStr(r['startTm']),
      endTm: _asStr(r['endTm']),
      startTs: _asInt(r['startTimestamp']),
      endTs: _asInt(r['endTimestamp']),
    );
  }

  /// resultData(attendList 또는 list/배열) → 목록.
  static List<MsgAttend> parseList(dynamic d) {
    final list = d is List ? d : (d is Map && (d['attendList'] ?? d['list']) is List ? (d['attendList'] ?? d['list']) as List : const []);
    return [for (final r in list) if (r is Map) ?fromRow(r)];
  }
}

/// 동료 접속 상태(P322). code: -1 오프라인 · 0 온라인 · 1 부재 · 2 바쁨 · 3 회의 · 4 통화 · 5 외근 · 6 휴가 · 7 재택.
/// (출처: 메신저 dzSymbols KEY_CLIENT_INFO_STATE_*, connect!='Y'면 오프라인.)
class MsgClientState {
  const MsgClientState({required this.empSeq, required this.code, required this.stateMsg});
  final String empSeq, code, stateMsg;

  bool get online => code == '0' || code == '6'; // 접속·휴가(접속 중)로 본다
  String get label => switch (code) {
        '0' => '접속', '1' => '부재', '2' => '다른 용무', '3' => '회의', '4' => '통화', '5' => '외근', '6' => '휴가', '7' => '재택', _ => '오프라인',
      };

  static MsgClientState fromRow(Map r) {
    final connect = _asStr(r['connect']);
    final raw = _asStr(r['clientState']).isNotEmpty ? _asStr(r['clientState']) : _asStr(r['state']);
    return MsgClientState(
      empSeq: _asStr(r['empSeq']),
      code: (connect.isNotEmpty && connect != 'Y') ? '-1' : (raw.isEmpty ? '-1' : raw),
      stateMsg: _asStr(r['stateMsg']),
    );
  }

  static List<MsgClientState> parseList(dynamic d) {
    final list = d is List ? d : (d is Map && (d['clientList'] ?? d['list']) is List ? (d['clientList'] ?? d['list']) as List : const []);
    return [for (final r in list) if (r is Map) fromRow(r)];
  }
}

/// 대화방 공지(P595).
class MsgRoomNotice {
  const MsgRoomNotice({required this.noticeId, required this.content, required this.empName, required this.timeStamp});
  final String noticeId, content, empName;
  final int timeStamp;

  static MsgRoomNotice fromRow(Map r) => MsgRoomNotice(
        noticeId: _asStr(r['noticeId']).isNotEmpty ? _asStr(r['noticeId']) : _asStr(r['roomNoticeId']),
        content: _asStr(r['content']).isNotEmpty ? _asStr(r['content']) : _asStr(r['noticeContent']),
        empName: _asStr(r['empName']),
        timeStamp: _asInt(r['timeStamp']),
      );

  static List<MsgRoomNotice> parseList(dynamic d) {
    final list = d is Map && (d['noticeList'] ?? d['list']) is List ? (d['noticeList'] ?? d['list']) as List : const [];
    return [for (final r in list) if (r is Map) fromRow(r)];
  }
}

/// 대화방 파일(P344/P1088).
class MsgRoomFile {
  const MsgRoomFile({required this.fileId, required this.name, required this.size, required this.empName, required this.timeStamp});
  final String fileId, name, empName;
  final int size, timeStamp;

  static MsgRoomFile fromRow(Map r) => MsgRoomFile(
        fileId: _asStr(r['fileId']).isNotEmpty ? _asStr(r['fileId']) : _asStr(r['atchFileId']),
        name: _asStr(r['fileName']).isNotEmpty ? _asStr(r['fileName']) : _asStr(r['orgFileName']),
        size: _asInt(r['fileSize']),
        empName: _asStr(r['empName']),
        timeStamp: _asInt(r['timeStamp']),
      );

  static List<MsgRoomFile> parseList(dynamic d) {
    final list = d is Map && (d['fileList'] ?? d['list']) is List ? (d['fileList'] ?? d['list']) as List : const [];
    return [for (final r in list) if (r is Map) fromRow(r)];
  }
}
