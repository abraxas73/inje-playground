import 'dart:convert';
import 'dart:typed_data';
import '../gw/gw_client.dart' show asStr;
import 'messenger_client.dart';
import 'messenger_models.dart';

String _s(Object? v) => asStr(v);

/// 대화 파일 경로(메신저 앱 CHAT_FILE_PATH_SEQ).
const _chatFilePathSeq = '800';

/// 파일 이름의 확장자(소문자, 점 없이).
String fileExt(String name) {
  final i = name.lastIndexOf('.');
  return i < 0 ? '' : name.substring(i + 1).toLowerCase();
}

/// 아마란스 메신저 기능 API — 모든 호출은 `MessengerClient`(P076 세션)로 서명·중계된다.
/// PID·요청 파라미터 출처: 메신저 번들 `src/dz/dzhttp.js`. companyInfo는 클라이언트가 붙인다(callCo).
class MessengerApi {
  MessengerApi(this.client);
  final MessengerClient client;

  // ── 1) 대화방·대화 ───────────────────────────────────────────────
  /// 대화방 목록(P077). timeStamp '0' = 최초.
  Future<List<MsgRoom>> rooms({String timeStamp = '0', int pageSize = 50}) async {
    final d = await client.callCo('P077', {'timeStamp': timeStamp, 'reqType': '1', 'reqSubType': 'N', 'searchType': 'A', 'pageSize': '$pageSize', 'isUserInfo': 'Y'});
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

  /// 파일·그림 보내기(P079 multipart, contentType 1). 메신저 앱처럼 그림은 30장까지 한 대화로, 그 밖의 파일은 한 개씩 따로 보낸다.
  Future<void> sendFiles({required String roomId, required List<({String name, Uint8List bytes})> files}) async {
    final images = [for (final f in files) if (msgImageExts.contains(fileExt(f.name))) f];
    final others = [for (final f in files) if (!msgImageExts.contains(fileExt(f.name))) f];
    final batches = [for (var i = 0; i < images.length; i += 30) images.sublist(i, i + 30 > images.length ? images.length : i + 30), for (final f in others) [f]];
    final me = (await client.ensureSession()).empName;
    for (final b in batches) {
      await client.upload('P079', {
        'roomId': roomId, 'empName': me, 'content': '', 'contentType': '1', 'emoticonId': '', 'link': null,
        'recvMentionEmpList': [], 'talkSecuYn': 'N', 'file': [], 'parentChatId': '',
      }, b, fields: const {'pathSeq': _chatFilePathSeq, 'forwardFileList': ''});
    }
  }

  /// 대화 첨부 미리보기 그림(P084 thum=Y). 실패하면 원본으로(그림만).
  Future<Uint8List> thumbnail(String chatId, String fileSn) async {
    try {
      return await client.getFile('P084', {'thum': 'Y', 'pathSeq': _chatFilePathSeq, 'moduleGbn': 'TALK', 'authKeyMap': jsonEncode({'chatId': chatId}), 'fileSn': fileSn});
    } catch (_) {
      return file(chatId, fileSn);
    }
  }

  /// 대화 첨부 원본(P084). 받은 바이트 그대로.
  Future<Uint8List> file(String chatId, String fileSn) => client.download('P084', {
        'authKeyMap': {'ShareType': 'N', 'chatId': chatId}, 'pathSeq': _chatFilePathSeq, 'fileSn': [fileSn], 'moduleGbn': 'TALK',
      });

  /// 대화 상대(나 제외 사번들)와의 방을 연다 — 1:1은 기존 방이 있으면 그 방(P190), 없으면 새로 만든다(P078).
  /// 그룹은 메신저 앱처럼 늘 새로 만들고 내가 방장. 돌려주는 값은 roomId.
  Future<String> openRoomWith(List<String> others) async {
    final me = (await client.ensureSession()).empSeq;
    final peers = [for (final e in others.toSet()) if (e.isNotEmpty && e != me) e];
    if (peers.isEmpty) throw MessengerException(-1, '대화 상대를 고르세요.');
    final single = peers.length == 1;
    final roomType = single ? '1' : '2';
    if (single) {
      final d = await client.callCo('P190', {'receiver': [{'empSeq': peers.first}, {'empSeq': me}], 'roomType': roomType});
      final id = d is Map ? _s(d['roomId']) : '';
      if (id.isNotEmpty) return id;
    }
    final d = await client.callCo('P078', {
      'roomType': roomType,
      'receiver': single
          ? [{'empSeq': peers.first}, {'empSeq': me}]
          : [for (final e in [...peers, me]) {'roomOwnerYn': e == me ? 'Y' : 'N', 'empSeq': e}],
      'projectId': '', 'roomTitle': '', 'roomLeaderEmpSeq': single ? '' : me, 'roomOption': '',
    });
    final id = d is Map ? _s(d['roomId']) : '';
    if (id.isEmpty) throw MessengerException(-1, '대화방을 만들지 못했습니다.');
    return id;
  }

  /// 읽음 처리(P342).
  Future<void> readChat({required String roomId, required String chatId}) =>
      client.callCo('P342', {'roomId': roomId, 'chatId': chatId});

  /// 방 입장(P087) — MQTT 구독 대상 등록용(실시간 단계에서 사용).
  Future<void> enterRoom(String roomId) => client.callCo('P087', {'roomId': roomId});

  /// empSeq → 이름 해석(P1471 SearchUserInfo). 대화방 제목·발신자 이름 표시용. 실패·빈 입력이면 빈 맵.
  /// 응답 배열 필드·키는 서버 구현에 따라 다를 수 있어 방어적으로 읽는다(userList/empList/list/최상위 배열, empSeq|emp_seq / empName|emp_name).
  Future<Map<String, String>> userNames(List<String> empSeqs) async {
    final uniq = empSeqs.where((e) => e.isNotEmpty).toSet().toList();
    if (uniq.isEmpty) return {};
    // 원본 메신저 reqSearchUserInfo의 실제 요청 본문은 {empSeqList, grouppingTp}뿐이다(groupSeq·searchTarget·page는 안 보냄).
    final dynamic d = await client.call('P1471', {'empSeqList': uniq, 'grouppingTp': ''});
    final list = d is List ? d : (d is Map ? (d['userList'] ?? d['empList'] ?? d['list'] ?? const []) : const []);
    final out = <String, String>{};
    if (list is List) {
      for (final e in list) {
        if (e is! Map) continue;
        final seq = _s(e['empSeq']).isNotEmpty ? _s(e['empSeq']) : _s(e['emp_seq']);
        final name = _s(e['empName']).isNotEmpty ? _s(e['empName']) : _s(e['emp_name']);
        if (seq.isNotEmpty && name.isNotEmpty) out[seq] = name;
      }
    }
    return out;
  }

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
