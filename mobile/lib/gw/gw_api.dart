import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'gw_client.dart';
import 'gw_models.dart';

/// 기능별 호출. 요청 본문 값과 함정의 출처는 inno-creed(approval.rs·attendance.rs·calendar.rs·resource.rs·mail.rs).
class GwApi {
  /// 기본 시계는 KST — 기기 시간대가 달라도 '오늘'은 한국 날짜(근태 workDt·일정 날짜).
  GwApi(this.client, {DateTime Function()? now}) : _now = now ?? kstNow;
  final GwClient client;
  final DateTime Function() _now;
  final _cache = _GwCache();
  static const _calTtl = Duration(minutes: 10), _resTtl = Duration(minutes: 30);

  // ── 전자결재 ──
  Future<Map<String, int>> approvalCounts() async {
    final s = await client.session();
    final d = await client.call('/eap/api/getMenuCountInfo', {
      'deptSeq': s.deptSeq, 'userSe': 'USER|AT', 'compSeq': s.compSeq, 'bizSeq': s.compSeq, 'empSeq': client.creds().empSeq, 'groupSeq': client.creds().groupSeq, 'menuType': '', 'pageCode': 'EapSide',
    });
    return parseApprovalCounts(d is Map ? d : const {});
  }

  /// 미결함(eap105A04, eaBoxId 1000900 / menuNo 1001000). 서버 기본 기간이 좁아 최근 90일을 명시. 오래 기다린 순.
  Future<(int, List<PendingApproval>)> pendingApprovals({int pageSize = 50}) async {
    final today = _now();
    final d = await client.call('/eap/eap105A04', {
      'fDocSts': [], 'page': '1', 'pageSize': '$pageSize', 'eaBoxId': '1000900', 'nMenuID': '1001000', 'menuNo': '1001000', 'upperMenuNo': '1000900',
      'sfrDt': ymd(today.subtract(const Duration(days: 90))), 'stoDt': ymd(today), 'sFormId': ['0'], 'periodPicker': 'ARRIVED_DT', 'sortField': 'ARRIVED_DT', 'sortType': 'DESC',
      'docContentsData': {}, 'item': {}, 'useElasticSearch': true, 'useElasticSearch_new': true, 'pageCode': '',
    });
    final map = d is Map ? d['map'] : null;
    final list = (map is Map ? map['list'] : null) as List? ?? const [];
    final docs = [for (final r in list) if (r is Map) PendingApproval.fromRow(r)]..sort((a, b) => (b.waitingDays(today) ?? 0).compareTo(a.waitingDays(today) ?? 0));
    return (asInt(map is Map ? map['totalCount'] : null, docs.length), docs);
  }

  /// 문서 상세 — 열람 처리 없음(setReadYn N).
  Future<ApprovalDetail> approvalDetail(String docId, String formId) async {
    final d = await client.call('/eap/eap111A04', {
      'doc_id': docId, 'form_id': formId, 'bindType': 'V', 'p_doc_id': 0, 'doc_auth': '0', 'spDocId': '', 'setReadYn': 'N', 'commentReqYn': 'N', 'pageCode': 'UBA1100', 'docToken': '',
    });
    return ApprovalDetail.fromData(d is Map ? d : const {});
  }

  // ── 근태 ──
  static const _att = '/human/common/judgeTimeManagement';
  Future<Attendance> attendanceToday() async {
    final s = await client.session();
    final wd = ymd(_now());
    final d = await client.call('$_att/getTodayComeLeaveInfo', {'empCd': s.empCd, 'coCd': s.coCd, 'workDt': wd});
    return Attendance.fromData(wd, d is Map ? d : null);
  }

  /// 출근(attendFg 1)/퇴근(4) 기록. 기록 전 가드(이미 있으면 호출 안 함) → confirmApplicationStatus(정보성) → punch → read-back으로 판정.
  Future<PunchResult> punch({required bool clockIn}) async {
    final kind = clockIn ? '출근' : '퇴근';
    final before = await attendanceToday();
    final existing = clockIn ? before.comeTm : before.leaveTm;
    if (existing.isNotEmpty) {
      return PunchResult(ok: true, already: true, kind: kind, comeTm: before.comeTm, leaveTm: before.leaveTm, verified: true, note: '이미 $kind 기록(${hm(existing)})이 있어 다시 기록하지 않았습니다.');
    }
    final s = await client.session();
    try {
      await client.call('$_att/confirmApplicationStatus', {'empCd': s.empCd, 'deptCd': s.deptCd, 'coCd': s.coCd});
    } on GwException catch (_) {}
    // 기록 호출이 실패(타임아웃·resultCode≠0)해도 서버에는 찍혔을 수 있다 → 판정은 늘 read-back으로
    String? writeError;
    try {
      await client.call('$_att/getJudgeTimeManagement', {'type': 'WEB', 'judgeData': {'empCd': s.empCd, 'deptCd': s.deptCd, 'coCd': s.coCd, 'attendFg': clockIn ? '1' : '4'}});
    } on GwException catch (e) {
      writeError = e.message;
    }
    final after = await attendanceToday();
    final now = clockIn ? after.comeTm : after.leaveTm;
    final ok = now.isNotEmpty;
    final note = ok
        ? '$kind ${hm(now)} 기록됨'
        : (writeError == null ? '응답은 왔지만 반영이 확인되지 않았습니다. 아마란스에서 확인하세요.' : '기록하지 못했습니다: $writeError');
    return PunchResult(ok: ok, already: false, kind: kind, comeTm: after.comeTm, leaveTm: after.leaveTm, verified: ok, note: note);
  }
}

extension GwScheduleApi on GwApi {
  List<Map> _list(dynamic d) => ((d is Map ? d['resultList'] : null) as List? ?? const []).whereType<Map>().toList();

  Future<List<GwCalendar>> calendars() async {
    final c = _cache;
    if (c.cals != null && c.calsAt != null && _now().difference(c.calsAt!) < GwApi._calTtl) return c.cals!;
    final d = await client.call('/schres/sc111A02', {'companyInfo': await client.companyInfo(), 'calType': '', 'langCode': 'kr'});
    c.cals = [for (final r in _list(d)) GwCalendar.fromRow(r)];
    c.calsAt = _now();
    return c.cals!;
  }

  /// 하루치 일정 원본 행(sc111A03). createSeq(작성자) 등 모델에 없는 필드가 필요할 때(비서 삭제 소유권).
  Future<List<Map>> eventRows(DateTime day) async {
    final cals = await calendars();
    final d = await client.call('/schres/sc111A03', {
      'companyInfo': await client.companyInfo(), 'startDate': ymd(day), 'endDate': ymd(day), 'mySchYn': 'N', 'calList': calListFor(cals), 'tcalList': [], 'acalList': [], 'searchEmpSeq': '', 'sortDate': 'Y', 'langCode': 'kr',
    });
    return _list(d);
  }

  /// 하루치 일정(전체 캘린더). "내 것"만 보려면 myEvents(…).
  Future<List<GwEvent>> events(DateTime day) async => [for (final r in await eventRows(day)) GwEvent.fromRow(r)]..sort((a, b) => a.start.compareTo(b.start));

  Future<List<GwResource>> resources() async {
    final c = _cache;
    if (c.res != null && c.resAt != null && _now().difference(c.resAt!) < GwApi._resTtl) return c.res!;
    final d = await client.call('/schres/rs121A01', {'companyInfo': await client.companyInfo(), 'searchText': '', 'attrUseYn': '', 'attrList': ['1', '3', 'ETC'], 'propList': [], 'langCode': 'kr'});
    c.res = [for (final r in _list(d)) GwResource.fromRow(r)];
    c.resAt = _now();
    return c.res!;
  }

  /// 하루치 예약(전 회의실). 내 것은 ownerEmpSeq == creds.empSeq로 거른다.
  Future<List<GwReservation>> reservations(DateTime day) async {
    final rooms = await resources();
    final d = await client.call('/schres/rs121A05', {
      'companyInfo': await client.companyInfo(), 'startDate': ymd(day), 'endDate': ymd(day), 'statusType': ['10', '20'], 'resList': [for (final r in rooms) {'resSeq': r.resSeq}],
      'statusCode': '', 'searchType': '', 'sechType': '', 'menuAuth': 'USER', 'langCode': 'kr',
    });
    return [for (final r in _list(d)) GwReservation.fromRow(r)]..sort((a, b) => a.start.compareTo(b.start));
  }
}

extension GwMailApi on GwApi {
  Future<MailSummary> mailSummary() async {
    final d = await client.call('/mail/mail000A03', const <String, Object>{});
    return MailSummary.fromCounts(d is List ? d : const []);
  }

  /// 받은메일함 최근 N통. INBOX seq는 계정마다 달라 mail000A01에서 이름으로 찾는다(세션 동안 캐시).
  Future<(int, List<MailItem>)> inbox({int pageSize = 20}) async {
    _cache.inboxSeq ??= findMboxSeq(await client.call('/mail/mail000A01', const <String, Object>{}), 'INBOX');
    final seq = _cache.inboxSeq;
    if (seq == null) throw GwException(200, 0, '받은메일함을 찾지 못했습니다');
    final d = await client.call('/mail/mail003A01', {'boxName': 'INBOX', 'mainApiCode': 'mail003A01', 'mboxSeq': seq, 'page': 1, 'pageSize': pageSize, 'sort': 'rfc822date', 'sortType': 'desc', 'listType': '', 'showType': '', 'seen': false});
    final recs = (d is Map ? d['Records'] : null) as List? ?? const [];
    return (asInt(d is Map ? d['TotalUnseenCount'] : null), [for (final r in recs) if (r is Map) MailItem.fromRow(r)]);
  }
}

extension GwBoardApi on GwApi {
  /// 전 게시판 공지·새 글 집계(최신순). search는 통합검색(제목·본문·작성자). companyInfo 불필요.
  Future<(int, List<GwNotice>)> notices({int page = 1, int pageSize = 20, String search = ''}) async {
    final d = await client.call('/board/APIHandler/ViewBoardNewAndNoticeArtList', {
      'adminPage': 'N', 'searchAuthType': 'U', 'searchTotal': search, 'searchTitle': '', 'searchNick': '', 'searchDesc': '', 'searchBoard': '', 'searchRemarkNo': '', 'searchEtcValue': '',
      'searchStartDate': '', 'searchEndDate': '', 'searchStartTerm': '', 'searchEndTerm': '', 'eventStatus': '', 'reserveStatus': '', 'counselingOk': '', 'searchMailFrom': '',
      'sort': 'write_date', 'project_id': null, 'page': page, 'pageSize': pageSize, 'sortType': 'desc', 'menuCode': 'UFA', 'pageCode': 'UFA1000', 'moduleCode': 'UF',
      'noticeYn': 'Y', 'apiName': 'ViewBoardNewAndNoticeArtList', 'use_list_art_content': 'Y',
    });
    final list = (d is Map ? d['articleList'] : null) as List? ?? const [];
    final items = [for (final r in list) if (r is Map) GwNotice.fromRow(r)];
    return (asInt(d is Map ? d['totalCnt'] : null, items.length), items);
  }

  /// 게시글 상세 — ⚠️ 조회수가 오른다(실제 열람). 사용자가 글을 눌렀을 때만 부른다.
  Future<GwNoticeDetail> notice(String artSeqNo) async {
    final d = await client.call('/board/APIHandler/ViewPost', {
      'art_seq_no': artSeqNo, 'adminPage': 'N', 'externalYn': 'N', 'menuCode': 'UFA', 'pageCode': 'UFA1000', 'moduleCode': 'UF', 'presentPassword': '', 'isPrint': 'N', 'searchParams': null,
    });
    return GwNoticeDetail.fromData(d is Map ? d : const {});
  }
}

/// 캘린더·회의실 목록·INBOX seq 캐시(앱 생명주기, GwApi 인스턴스마다).
class _GwCache {
  List<GwCalendar>? cals;
  DateTime? calsAt;
  List<GwResource>? res;
  DateTime? resAt;
  int? inboxSeq;
}

final gwApiProvider = Provider<GwApi?>((ref) {
  final c = ref.watch(gwClientProvider);
  return c == null ? null : GwApi(c);
});
