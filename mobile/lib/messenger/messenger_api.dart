import 'messenger_client.dart';
import 'messenger_models.dart';

/// 아마란스 메신저 기능 API — 모든 호출은 `MessengerClient`(P076 세션)로 서명·중계된다.
/// PID·요청 파라미터 출처: 메신저 번들 `src/dz/dzhttp.js`. companyInfo는 클라이언트가 붙인다(callCo).
class MessengerApi {
  MessengerApi(this.client);
  final MessengerClient client;

  // ── 1) 대화방·대화 ───────────────────────────────────────────────
  /// 대화방 목록(P077). timeStamp '0' = 최초.
  Future<List<MsgRoom>> rooms({String timeStamp = '0', int pageSize = 50}) async {
    final d = await client.callCo('P077', {'timeStamp': timeStamp, 'reqType': '1', 'reqSubType': 'N', 'searchType': 'A', 'pageSize': '$pageSize', 'isUserInfo': 'N'});
    return MsgRoom.parseList(d);
  }

  /// 방 안 대화 목록(P082). 최신 pageSize건.
  Future<List<MsgChat>> chats(String roomId, {String timeStamp = '0', int pageSize = 50}) async {
    final d = await client.callCo('P082', {'roomId': roomId, 'timeStamp': timeStamp, 'reqType': '1', 'reqSubType': 'N', 'pageSize': '$pageSize'});
    return MsgChat.parseList(d);
  }

  /// 대화 보내기(P079). 텍스트만(contentType 0). uuid는 중복 전송 방지용.
  Future<void> sendChat({required String roomId, required String content, String? uuid}) =>
      client.callCo('P079', {'roomId': roomId, 'content': content, 'contentType': '0', 'emoticonId': '', 'link': null, 'recvMentionEmpList': [], 'talkSecuYn': 'N', 'file': [], 'uuid': uuid, 'parentChatId': ''});

  /// 읽음 처리(P342).
  Future<void> readChat({required String roomId, required String chatId}) =>
      client.callCo('P342', {'roomId': roomId, 'chatId': chatId});

  /// 방 입장(P087) — MQTT 구독 대상 등록용(실시간 단계에서 사용).
  Future<void> enterRoom(String roomId) => client.callCo('P087', {'roomId': roomId});

  // ── 3) 검색 ──────────────────────────────────────────────────────
  /// 방 이름으로 대화방 검색(P326).
  Future<List<MsgRoom>> searchRooms(String word, {String timeStamp = '0', int pageSize = 30}) async {
    final d = await client.callCo('P326', {'timeStamp': timeStamp, 'searchType': 'A', 'searchWord': word, 'pageSize': '$pageSize'});
    return MsgRoom.parseList(d);
  }

  /// 대화 내용 검색(P081). searchKind 2=내용.
  Future<List<MsgChat>> searchChats(String word, {String roomId = '', String timeStamp = '0', int pageSize = 30}) async {
    final d = await client.callCo('P081', {'timeStamp': timeStamp, 'roomId': roomId, 'searchKind': '2', 'searchType': 'A', 'searchWord': word, 'searchEmpSeq': <String>[], 'pageSize': '$pageSize'});
    return MsgChat.parseList(d);
  }

  // ── 4) 쪽지 ──────────────────────────────────────────────────────
  /// 받은 쪽지 목록(P245).
  Future<List<MsgNote>> notes({String timeStamp = '0', int pageSize = 20}) async {
    final d = await client.callCo('P245', {'timeStamp': timeStamp, 'reqType': '1', 'reqSubType': 'N', 'searchType': '', 'searchKind': '', 'searchWord': '', 'searchEmpSeq': <String>[], 'searchSupportText': '', 'pageSize': '$pageSize'});
    return MsgNote.parseList(d);
  }

  /// 쪽지 상세(P246).
  Future<Map> noteDetail(String msgId) async => (await client.callCo('P246', {'msgId': msgId})) as Map? ?? const {};

  /// 쪽지 보내기(P247).
  Future<void> sendNote({required List<String> recvEmpSeq, required String content, String secuYn = 'N'}) =>
      client.callCo('P247', {'recvEmpSeq': recvEmpSeq, 'content': content, 'contentType': '0', 'secuYn': secuYn, 'receiptYn': 'N', 'reserveDate': '', 'link': <String>[], 'linkMsgId': '', 'msgId': '', 'encryptionYn': 'N'});

  /// 쪽지 회수(P319).
  Future<void> cancelNote(String msgId) => client.callCo('P319', {'msgId': msgId});

  /// 안 읽은 쪽지 수(P244).
  Future<int> noteUnreadCount() async {
    final d = await client.callCo('P244', const {});
    if (d is Map) {
      final v = d['unReadCnt'] ?? d['count'] ?? d['unreadCount'];
      return v is num ? v.toInt() : int.tryParse('$v') ?? 0;
    }
    return 0;
  }

  // ── 6) 접속 상태 ─────────────────────────────────────────────────
  /// 동료 접속 상태(P322). 대상 사번 목록.
  Future<List<MsgClientState>> clientStates(List<String> empSeqs) async {
    final d = await client.callCo('P322', {'empSeqs': empSeqs});
    return MsgClientState.parseList(d);
  }

  // ── 7) 팀 근태 ───────────────────────────────────────────────────
  /// 오늘 전사 근태(P1181). messengerYn='Y'·atNm 있는 건만.
  Future<List<MsgAttend>> todayAttend() async {
    final sess = await client.ensureSession();
    final d = await client.call('P1181', {'groupSeq': sess.groupSeq, 'clientType': 'MESSENGER'});
    return MsgAttend.parseList(d);
  }

  // ── 8) 대화방 공지·파일함 ────────────────────────────────────────
  Future<List<MsgRoomNotice>> roomNotices(String roomId, {String timeStamp = '0', int pageSize = 30}) async {
    final d = await client.call('P595', {'roomId': roomId, 'timeStamp': timeStamp, 'pageSize': '$pageSize'});
    return MsgRoomNotice.parseList(d);
  }

  Future<List<MsgRoomFile>> roomFiles(String roomId, {String fileType = '', String timeStamp = '0', String searchWord = '', int pageSize = 30}) async {
    final d = await client.callCo('P1088', {'roomId': roomId, 'fileType': fileType, 'timeStamp': timeStamp, 'searchWord': searchWord, 'pageSize': '$pageSize'});
    return MsgRoomFile.parseList(d);
  }
}
