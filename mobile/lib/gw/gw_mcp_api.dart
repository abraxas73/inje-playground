// mobile/lib/gw/gw_mcp_api.dart — Claude 커넥터(MCP)용 저수준 호출. inno-creed가 서버 원본 봉투를 그대로 내는 도구가 많아
// 기존 GwApi(슬림 모델, 이노봇이 씀)를 바꾸지 않고 원본 resultData를 돌려주는 호출만 모았다. 요청 본문은 inno-creed 캡처(test/mcp/fixtures/captured) 그대로.
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'gw_api.dart';
import 'gw_client.dart';
import 'gw_models.dart' show calListFor, findMboxSeq;

List<Map> _rows(dynamic d, [String key = 'resultList']) => ((d is Map ? d[key] : d) as List? ?? const []).whereType<Map>().toList();

final _rosterCache = Expando<(DateTime, List<Map>)>();
const _rosterTtl = Duration(minutes: 30);

extension GwMcpApi on GwApi {
  // ── 조직 ──
  /// gw102A01 전사 부서 트리(평면 treeList, 전체 펼침).
  Future<List<Map>> orgTree() async => _rows(await client.call('/gw/APIHandler/gw102A01', {
        'parentSeq': '0', 'popupType': 'main', 'selectedType': 'tree', 'isAllCompShow': false, 'compFilter': '', 'isTreeChecked': '', 'isTreeAllOpen': true, 'isPartYn': false,
      }), 'treeList');

  /// gw102A02 부서원 원본 행(그 부서 직속).
  Future<List<Map>> deptMembers(String deptId) async => _rows(await client.call('/gw/APIHandler/gw102A02', {
        'selectedId': deptId, 'orgGubun': 'd', 'popupType': 'main', 'selectedType': 'tree', 'searchDiv': 'all', 'searchText': '',
        'isBdayOption': '1', 'isJoinDayOption': '0', 'isOrganizationDisplayOption': '5|0|1|3|', 'isGridListDisplayOption': '0', 'isLoginIdOption': '1',
      }), '');

  /// 전사 명부 원본 행(30분 캐시) — 인원 있는 부서(d)만 동시 8개씩. 부서 하나 실패는 건너뛰고 그때는 캐시하지 않는다.
  Future<List<Map>> rosterRows() async {
    final hit = _rosterCache[client];
    if (hit != null && DateTime.now().difference(hit.$1) < _rosterTtl) return hit.$2;
    final depts = [for (final d in await orgTree()) if (asStr(d['orgGubun']) == 'd' && asInt(d['childUserCnt']) > 0) asStr(d['id'])];
    final seen = <String>{}, rows = <Map>[];
    var failed = 0;
    for (var i = 0; i < depts.length; i += 8) {
      final batch = depts.sublist(i, i + 8 > depts.length ? depts.length : i + 8);
      final lists = await Future.wait(batch.map((id) => deptMembers(id).catchError((Object e) {
            if (e is GwUnauthorized) throw e;
            failed++;
            return <Map>[];
          })));
      for (final list in lists) {
        for (final r in list) {
          if (asStr(r['empSeq']).isNotEmpty && seen.add(asStr(r['empSeq']))) rows.add(r);
        }
      }
    }
    if (rows.isEmpty) throw GwException(200, 0, '명부를 불러오지 못했습니다');
    if (failed == 0) _rosterCache[client] = (DateTime.now(), rows);
    return rows;
  }

  // ── 회의실·일정 ──
  Future<dynamic> resourcesRaw() async => client.call('/schres/rs121A01', {'companyInfo': await client.companyInfo(), 'searchText': '', 'attrUseYn': '', 'attrList': ['1', '3', 'ETC'], 'propList': [], 'langCode': 'kr'});

  /// rs121A05 기간 예약 원본 행. resSeqs가 비면 전 회의실.
  Future<List<Map>> reservationRows(String from8, String to8, {List<String> resSeqs = const []}) async {
    final seqs = resSeqs.isNotEmpty ? resSeqs : [for (final r in await resources()) r.resSeq];
    return _rows(await client.call('/schres/rs121A05', {
      'companyInfo': await client.companyInfo(), 'startDate': from8, 'endDate': to8, 'statusType': ['10', '20'], 'resList': [for (final s in seqs) {'resSeq': s}],
      'statusCode': '', 'searchType': '', 'sechType': '', 'menuAuth': 'USER', 'langCode': 'kr',
    }));
  }

  /// rs121A06 예약 등록 — subscribers는 {groupSeq,compSeq,deptSeq,empSeq}(본인 먼저).
  Future<dynamic> reserveRaw({required String resSeq, required String title, required String start, required String end, required String desc, required List<Map<String, String>> subscribers}) async =>
      client.call('/schres/rs121A06', {
        'companyInfo': await client.companyInfo(), 'resSeq': resSeq, 'reqText': title, 'apprYn': 'N', 'alldayYn': 'N', 'startDate': start, 'endDate': end, 'descText': desc,
        'resSubscriberList': subscribers, 'uidList': '', 'repeatType': '10', 'repeatEndDay': '', 'langCode': 'kr',
      });

  Future<dynamic> reservationDetailRaw(String resSeq, int seqNum, String resIdx) async =>
      client.call('/schres/rs121A10', {'companyInfo': await client.companyInfo(), 'resSeq': resSeq, 'seqNum': seqNum, 'resIdx': resIdx, 'langCode': 'kr'});

  /// rs121A12 예약 수정 — 서버가 예약을 다시 발급할 수 있다(응답 seqNum·resIdx가 새 값). 본문 키는 캡처 그대로.
  Future<dynamic> updateReservationRaw(Map<String, Object?> fields) async => client.call('/schres/rs121A12', {'companyInfo': await client.companyInfo(), ...fields, 'uidList': '', 'langCode': 'kr'});

  Future<dynamic> calendarsRaw() async => client.call('/schres/sc111A02', {'companyInfo': await client.companyInfo(), 'calType': '', 'langCode': 'kr'});

  /// sc111A03 기간 일정 원본 행(전체 캘린더).
  Future<List<Map>> eventRowsRange(String from8, String to8) async {
    final cals = await calendars();
    return _rows(await client.call('/schres/sc111A03', {
      'companyInfo': await client.companyInfo(), 'startDate': from8, 'endDate': to8, 'mySchYn': 'N', 'calList': calListFor(cals), 'tcalList': [], 'acalList': [], 'searchEmpSeq': '', 'sortDate': 'Y', 'langCode': 'kr',
    }));
  }

  /// sc111A05 신규 등록. parts는 schPartEmpList 항목(주최 M 먼저).
  Future<dynamic> createEventRaw({required String title, required String mcalSeq, required String calType, required String start, required String end, required String contents, required List<Map<String, String>> parts}) async {
    final c = client.creds();
    return client.call('/schres/sc111A05', {
      'companyInfo': await client.companyInfo(), 'schSeq': '', 'schmSeq': '', 'schGbnCode': '10', 'schTitle': title, 'mcalSeq': mcalSeq, 'calType': calType, 'startDate': start, 'endDate': end,
      'gbnCode': 'E', 'repeatType': '10', 'repeatByDay': '', 'repeatEndDay': '', 'rangeCode': 'N', 'alarm_yn': 'Y', 'schAlarmList': [], 'contents': contents, 'myMemo': '', 'alldayYn': 'N', 'lunarYn': 'N',
      'inviterPartType': 'M', 'schPartEmpList': parts, 'schUserList': [], 'addressUserList': [], 'resList': [], 'reservedList': [], 'uidList': '', 'placeMapData': '{}', 'otherLinkList': [],
      'groupSeq': c.groupSeq, 'empSeq': c.empSeq, 'videoYn': 'N', 'videoTimeZone': 'Asia/Seoul', 'mailSend': 'N', 'langCode': 'kr',
    });
  }

  /// sc111A05 수정 모드(rangeCode UO) — 바뀌는 것은 itemList 항목만. 나머지 키는 캡처 그대로.
  Future<dynamic> updateEventRaw({required String schSeq, required String schmSeq, required String schGbnCode, required String videoYn, required List<Map<String, Object?>> items}) async {
    final c = client.creds();
    return client.call('/schres/sc111A05', {
      'companyInfo': await client.companyInfo(), 'schSeq': schSeq, 'schmSeq': schmSeq, 'schGbnCode': schGbnCode, 'rangeCode': 'UO', 'repeatType': '10', 'repeatByDay': '', 'repeatEndDay': '',
      'alarm_yn': 'N', 'alarmOnModify': false, 'itemList': items, 'groupSeq': c.groupSeq, 'empSeq': c.empSeq, 'videoYn': videoYn, 'videoTimeZone': 'Asia/Seoul', 'mailSend': 'N', 'langCode': 'kr',
    });
  }

  // ── 근태 ──
  /// 기간 근태 원본 행(getWorkTimeStatusList) — 본인(ERP empCd)만.
  Future<List<Map>> attendancePeriodRows(String from8, String to8) async {
    final s = await client.session();
    return _rows(await client.call('/human/openapi/worktime/status/getWorkTimeStatusList', {'coCd': s.coCd, 'empCdList': [s.empCd], 'startDate': from8, 'endDate': to8}), '');
  }

  Future<Map> attendanceRaw(String workDt) async {
    final s = await client.session();
    final d = await client.call('/human/common/judgeTimeManagement/getTodayComeLeaveInfo', {'empCd': s.empCd, 'coCd': s.coCd, 'workDt': workDt});
    return d is Map ? d : const {};
  }

  // ── 메일 ──
  Future<dynamic> mailboxesRaw() => client.call('/mail/mail000A01', const <String, Object>{});
  Future<dynamic> mailCountsRaw() => client.call('/mail/mail000A03', const <String, Object>{});

  /// 이름(INBOX·DRAFTS…)으로 메일함을 찾아 mail003A01 원본 봉투. 메일함 seq는 계정마다 달라 상수 금지.
  Future<dynamic> mailListRaw(String boxName, {int pageSize = 20}) async => mailListAt(boxName, await mailboxSeq(boxName), pageSize: pageSize);

  Future<int> mailboxSeq(String boxName) async => findMboxSeq(await mailboxesRaw(), boxName) ?? (throw GwException(200, 0, '$boxName 메일함을 찾지 못했습니다'));

  Future<dynamic> mailListAt(String boxName, int seq, {int pageSize = 20}) =>
      client.call('/mail/mail003A01', {'boxName': boxName, 'mainApiCode': 'mail003A01', 'mboxSeq': seq, 'page': 1, 'pageSize': pageSize, 'sort': 'rfc822date', 'sortType': 'desc', 'listType': '', 'showType': '', 'seen': false});

  /// mail002A15 읽지 않음으로(받은메일함).
  Future<dynamic> mailMarkUnseen(String muid) => client.call('/mail/mail002A15', {'mbox': 'INBOX', 'type': 'unseen', 'uids': muid});

  /// mail002A05 휴지통으로(uids 콤마 구분).
  Future<dynamic> mailDelete(String uids) => client.call('/mail/mail002A05', {'boxName': '', 'mailKey': '', 'uids': uids});

  /// mail014A01 초안 모드 — 초안 본문·헤더·첨부 목록(mailInfo)과 새 작성 세션.
  Future<Map> draftInit(String muid) async {
    final d = await client.call('/mail/mail014A01', {'domainSeq': '', 'fromFlag': true, 'mailKind': 'draft', 'mailTo': '(Unknown)', 'mbox': 'DRAFTS', 'readType': '', 'uid': muid, 'viewFlag': 'noRead'});
    if (d is! Map) throw GwException(200, 0, '초안을 열지 못했습니다');
    return d;
  }

  /// mail002A07 발송한 초안 원본 삭제.
  Future<dynamic> draftDelete(int muid, String mailKey) => client.call('/mail/mail002A07', {'beforeMUID': muid, 'mailKey': mailKey});

  /// authKeyMap(메일 첨부 권한) — 키 순서 email·empSeq·muid(캡처 그대로).
  Future<String> mailAuthKey(String muid) async => jsonEncode({'email': (await client.session()).email, 'empSeq': client.creds().empSeq, 'muid': muid});

  /// mail014A08 첨부 정보(fileId·서버 파일명). condition은 초안 발송 때만 '99'(캡처 그대로).
  Future<Map> mailAttachInfo(String authKey, String fileSn, {bool forDraft = false}) async {
    final d = await client.callForm('/mail/mail014A08', {'moduleGbn': 'MAIL', 'authKeyMap': authKey, 'fileSn': fileSn, if (forDraft) 'condition': '99'});
    final f = _rows(d, 'list').firstOrNull;
    if (f == null) throw GwException(200, 0, '첨부 정보를 받지 못했습니다');
    return f;
  }

  /// ecm001A03 첨부 파일 바이트(mail014A08의 fileId).
  Future<List<int>> mailAttachBytes(String authKey, String fileId) => client.formBytes('/ecm/ecm001A03', {'moduleGbn': 'MAIL', 'authKeyMap': authKey, 'fileSn': fileId, 'condition': '99'});

  /// mail014A06 첨부 업로드(한 요청에 file[] 여러 개) → 업로드된 항목(list).
  Future<List<Map>> mailUpload(List<(String name, List<int> bytes)> files) async =>
      _rows(await client.callMultipartFiles('/mail/mail014A06', [for (final (n, b) in files) http.MultipartFile.fromBytes('file[]', b, filename: n)]), 'list');

  /// mail002A01 원본 — ⚠️ 읽음 처리된다.
  Future<Map> mailReadRaw(String muid) async {
    final d = await client.call('/mail/mail002A01', {'uid': muid});
    return d is Map ? d : const {};
  }

  /// mail014A01 작성 폼(서명·세션키·그룹메일 옵션).
  Future<Map> composeInit() async {
    final d = await client.call('/mail/mail014A01', {'mainApiCode': 'mail014A01', 'mailKind': 'plain'});
    if (d is! Map) throw GwException(200, 0, '메일 작성 폼을 열지 못했습니다');
    return d;
  }

  // ── 결재 ──
  Future<Map> approvalCountsRaw() async {
    final s = await client.session();
    final c = client.creds();
    final d = await client.call('/eap/api/getMenuCountInfo', {
      'deptSeq': s.deptSeq, 'userSe': 'USER|AT', 'compSeq': s.compSeq, 'bizSeq': s.compSeq, 'empSeq': c.empSeq, 'groupSeq': c.groupSeq, 'menuType': '', 'pageCode': 'EapSide',
    });
    return d is Map ? d : const {};
  }

  /// eap111A04 원본 — 열람 처리 없음(setReadYn N).
  Future<Map> approvalDetailRaw(String docId, String formId) async {
    final d = await client.call('/eap/eap111A04', {
      'doc_id': docId, 'form_id': formId, 'bindType': 'V', 'p_doc_id': 0, 'doc_auth': '0', 'spDocId': '', 'setReadYn': 'N', 'commentReqYn': 'N', 'pageCode': 'UBA1100', 'docToken': '',
    });
    return d is Map ? d : const {};
  }

  // ── 게시판·검색 ──
  /// 전 게시판 공지·새 글. field: title/content/author, 그 외 통합검색. 날짜는 YYYY-MM-DD.
  Future<Map> noticeListRaw({int page = 1, int pageSize = 20, String search = '', String field = '', String start = '', String end = ''}) async {
    String on(String f) => field == f ? search : '';
    final d = await client.call('/board/APIHandler/ViewBoardNewAndNoticeArtList', {
      'adminPage': 'N', 'searchAuthType': 'U', 'searchTotal': const {'title', 'content', 'author'}.contains(field) ? '' : search, 'searchTitle': on('title'), 'searchNick': on('author'), 'searchDesc': on('content'),
      'searchBoard': '', 'searchRemarkNo': '', 'searchEtcValue': '', 'searchStartDate': start, 'searchEndDate': end, 'searchStartTerm': '', 'searchEndTerm': '', 'eventStatus': '', 'reserveStatus': '',
      'counselingOk': '', 'searchMailFrom': '', 'sort': 'write_date', 'project_id': null, 'page': page, 'pageSize': pageSize, 'sortType': 'desc', 'menuCode': 'UFA', 'pageCode': 'UFA1000', 'moduleCode': 'UF',
      'noticeYn': 'Y', 'apiName': 'ViewBoardNewAndNoticeArtList', 'use_list_art_content': 'Y',
    });
    return d is Map ? d : const {};
  }

  /// ViewPost 원본 — ⚠️ 조회수가 오른다.
  Future<Map> noticeRaw(String artSeqNo) async {
    final d = await client.call('/board/APIHandler/ViewPost', {
      'art_seq_no': artSeqNo, 'adminPage': 'N', 'externalYn': 'N', 'menuCode': 'UFA', 'pageCode': 'UFA1000', 'moduleCode': 'UF', 'presentPassword': '', 'isPrint': 'N', 'searchParams': null,
    });
    return d is Map ? d : const {};
  }

  /// gw018A02 통합검색 한 모듈(boardType 0 메일·6 결재·9 게시판·3 일정·13 자원·10 파일).
  Future<Map> searchRaw(String boardType, String query, {String from = '', String to = '', int limit = 10}) async {
    final d = await client.call('/gw/APIHandler/gw018A02', {
      'header': {},
      'body': {
        'tsearchKeyword': query, 'tsearchSubKeyword': '', 'boardType': boardType, 'fromDate': from, 'toDate': to, 'dateDiv': '', 'detailSearchYn': 'N', 'selectDiv': 'S', 'orderDiv': 'B',
        'syncTime': 'N', 'pageIndex': 1, 'hrSearchYn': 'N', 'hrEmpSeq': '', 'pageSize': limit, 'webMobileDiv': 'W',
      },
    });
    return d is Map ? d : const {};
  }
}
