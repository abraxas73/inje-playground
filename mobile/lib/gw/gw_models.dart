// 아마란스 응답 정제 — 순수 함수만(네트워크 없음). 필드 이름·의미의 출처는 inno-creed src/modules/*.rs.
import 'gw_client.dart' show asStr, asBool, asInt;

/// 한국 시각. 기기 시간대와 무관하게 '오늘'을 정하는 기준(근태·일정·대기일수).
DateTime kstOf(DateTime t) => t.toUtc().add(const Duration(hours: 9));
DateTime kstNow() => kstOf(DateTime.now());

String ymd(DateTime d) => '${d.year}${d.month.toString().padLeft(2, '0')}${d.day.toString().padLeft(2, '0')}';
String ymdhm(DateTime d) => '${ymd(d)}${d.hour.toString().padLeft(2, '0')}${d.minute.toString().padLeft(2, '0')}';

/// 'YYYYMMDDHHmm' → 'HH:mm'. 형식이 다르면 원문.
String hm(String s) => s.length == 12 ? '${s.substring(8, 10)}:${s.substring(10, 12)}' : s;
String _digits(String s) => s.replaceAll(RegExp(r'\D'), '');
DateTime? _parseYmd(String s) {
  final d = _digits(s);
  if (d.length < 8) return null;
  return DateTime(int.parse(d.substring(0, 4)), int.parse(d.substring(4, 6)), int.parse(d.substring(6, 8)));
}

int? daysBetween(String ymd8, DateTime today) {
  final a = _parseYmd(ymd8);
  if (a == null) return null;
  return DateTime(today.year, today.month, today.day).difference(a).inDays;
}

String htmlToText(String html) {
  var s = html.replaceAll(RegExp(r'<(br|/p|/div|/li|/tr)\s*/?>', caseSensitive: false), ' ').replaceAll(RegExp(r'<[^>]+>'), '');
  const ent = {'&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'"};
  ent.forEach((k, v) => s = s.replaceAll(k, v));
  return s.replaceAll(RegExp(r'\s+'), ' ').trim();
}

/// 미결함 행(eap105A04 map.list[]). 대문자 컬럼명은 서버 그대로.
class PendingApproval {
  const PendingApproval({required this.docId, required this.formId, required this.title, required this.form, required this.drafter, required this.dept, required this.arrivedDt, required this.status, required this.unread, required this.fileCount});
  final String docId, formId, title, form, drafter, dept, arrivedDt, status;
  final bool unread;
  final int fileCount;
  int? waitingDays(DateTime today) => daysBetween(arrivedDt, today);
  factory PendingApproval.fromRow(Map r) => PendingApproval(
        docId: asStr(r['DOC_ID']), formId: asStr(r['FORM_ID']), title: asStr(r['DOC_TITLE']),
        form: asStr(r['FORM_NM']).isEmpty ? asStr(r['DRAFT_FORM_NM']) : asStr(r['FORM_NM']),
        drafter: asStr(r['USER_NM']), dept: asStr(r['DEPT_NM']), arrivedDt: _digits(asStr(r['ARRIVED_DT'])), status: asStr(r['DOC_STSNM']),
        unread: asStr(r['READYN']) == 'N', fileCount: asInt(r['FILE_CNT']));
}

/// 문서 상세(eap111A04). 본문은 평문 contentsWord 우선, 비면 docContents(HTML) 태그 제거.
class ApprovalDetail {
  const ApprovalDetail({required this.title, required this.form, required this.status, required this.drafter, required this.dept, required this.repDt, required this.attachCount, required this.currentApprover, required this.content});
  final String title, form, status, drafter, dept, repDt, currentApprover, content;
  final int attachCount;
  factory ApprovalDetail.fromData(Map d) {
    final word = asStr(d['contentsWord']).trim();
    return ApprovalDetail(
        title: asStr(d['docTitle']), form: asStr(d['formName']), status: asStr(d['docStsName']), drafter: asStr(d['empName']), dept: asStr(d['deptName']), repDt: asStr(d['repDt']),
        attachCount: asInt(d['attachCnt']), currentApprover: asStr(d['lineName']), content: word.isEmpty ? htmlToText(asStr(d['docContents'])) : word);
  }
}

/// getMenuCountInfo {menuNo: count} → 함 라벨.
Map<String, int> parseApprovalCounts(Map data) => {'pending': asInt(data['1001000']), 'approved': asInt(data['1001100']), 'reference': asInt(data['1001200']), 'sent': asInt(data['1000400'])};

/// 오늘 출퇴근(getTodayComeLeaveInfo). comeTm/leaveTm은 'YYYYMMDDHHmm', 미등록이면 ''(null도 ''로).
class Attendance {
  const Attendance({required this.workDt, required this.comeTm, required this.leaveTm, required this.holiday});
  final String workDt, comeTm, leaveTm;
  final bool holiday;
  bool get clockedIn => comeTm.isNotEmpty;
  bool get clockedOut => leaveTm.isNotEmpty;
  factory Attendance.fromData(String workDt, Map? d) => Attendance(workDt: workDt, comeTm: asStr(d?['comeTm']), leaveTm: asStr(d?['leaveTm']), holiday: asBool(d?['holidayYn']));
}

class PunchResult {
  const PunchResult({required this.ok, required this.already, required this.kind, required this.comeTm, required this.leaveTm, required this.verified, required this.note});
  final bool ok, already, verified;
  final String kind, comeTm, leaveTm, note;
}

/// 캘린더(sc111A02 resultList[]).
class GwCalendar {
  const GwCalendar({required this.mcalSeq, required this.title, required this.calType, required this.ownerEmpSeq, required this.color});
  final String mcalSeq, title, calType, ownerEmpSeq, color;
  bool get personal => calType == 'E';
  factory GwCalendar.fromRow(Map r) => GwCalendar(mcalSeq: asStr(r['mcalSeq']), title: asStr(r['calTitle']), calType: asStr(r['calType']), ownerEmpSeq: asStr(r['empSeq']), color: asStr(r['calColor']));
}

/// sc111A03의 calList. 빈 calType은 'E'로 보정(안 하면 그 캘린더 일정이 조회에서 빠진다 — 실측), adminYn은 조회용 'Y'.
List<Map<String, String>> calListFor(List<GwCalendar> cals) => [for (final c in cals) {'mcalSeq': c.mcalSeq, 'calType': c.calType.isEmpty ? 'E' : c.calType, 'adminYn': 'Y', 'color': c.color}];

/// 일정(sc111A03 resultList[]). delYn은 이름과 달리 "내 일정(참석자/작성자)" 플래그.
class GwEvent {
  const GwEvent({required this.schSeq, required this.title, required this.start, required this.end, required this.allDay, required this.calendar, required this.mcalSeq, required this.mine, required this.createName, required this.place});
  final String schSeq, title, start, end, calendar, mcalSeq, createName, place;
  final bool allDay, mine;
  factory GwEvent.fromRow(Map r) => GwEvent(
        schSeq: asStr(r['schSeq']), title: asStr(r['schTitle']), start: asStr(r['startDate']), end: asStr(r['endDate']), allDay: asBool(r['alldayYn']), calendar: asStr(r['calTitle']), mcalSeq: asStr(r['mcalSeq']),
        mine: asStr(r['delYn']) == 'Y', createName: asStr(r['createName']), place: asStr(r['schPlace']));
}

List<GwEvent> myEvents(List<GwEvent> all, List<GwCalendar> cals, String empSeq) {
  final personal = {for (final c in cals) if (c.personal && c.ownerEmpSeq == empSeq) c.mcalSeq};
  return [for (final e in all) if (e.mine || personal.contains(e.mcalSeq)) e];
}

class GwResource {
  const GwResource({required this.resSeq, required this.resName, required this.attrSeq, required this.attrName});
  final String resSeq, resName, attrSeq, attrName;
  factory GwResource.fromRow(Map r) => GwResource(resSeq: asStr(r['resSeq']), resName: asStr(r['resName']), attrSeq: asStr(r['attrSeq']), attrName: asStr(r['attrName']));
}

/// 회의실 예약(rs121A05 resultList[]). 원본 74필드 중 표시에 쓰는 것만.
class GwReservation {
  const GwReservation({required this.resSeq, required this.resName, required this.start, required this.end, required this.title, required this.display, required this.owner, required this.ownerEmpSeq, required this.attendees, required this.allDay});
  final String resSeq, resName, start, end, title, display, owner, ownerEmpSeq, attendees;
  final bool allDay;
  factory GwReservation.fromRow(Map r) {
    final owner = asStr(r['empName']), name = asStr(r['resName']);
    final disp = asStr(r['resTitleDisplay']);
    return GwReservation(resSeq: asStr(r['resSeq']), resName: name, start: asStr(r['resStartDate']), end: asStr(r['resEndDate']), title: asStr(r['reqText']), display: disp.isEmpty ? '[$owner] $name' : disp,
        owner: owner, ownerEmpSeq: asStr(r['empSeq']), attendees: asStr(r['resUserName']), allDay: asBool(r['alldayYn']));
  }
}

/// mail000A03 배열의 마지막 항목 = 계정 전체 집계. 없으면 0.
class MailSummary {
  const MailSummary({required this.unread, required this.toMe, required this.total});
  final int unread, toMe, total;
  static MailSummary fromCounts(List counts) {
    final last = counts.isEmpty ? null : counts.last;
    if (last is! Map) return const MailSummary(unread: 0, toMe: 0, total: 0);
    return MailSummary(unread: asInt(last['unreadCount']), toMe: asInt(last['toMeCount']), total: asInt(last['totalCount']));
  }
}

/// mail000A01 트리에서 이름(fullname/name, 대소문자 무시)이 맞는 메일함의 mboxSeq. 계정마다 값이 달라 상수 금지.
int? findMboxSeq(Object? node, String name) {
  if (node is Map) {
    if (node.containsKey('mboxSeq') && [node['fullname'], node['name']].any((v) => asStr(v).toLowerCase() == name.toLowerCase())) {
      return int.tryParse(asStr(node['mboxSeq']));
    }
    for (final v in node.values) {
      final r = findMboxSeq(v, name);
      if (r != null) return r;
    }
  } else if (node is List) {
    for (final v in node) {
      final r = findMboxSeq(v, name);
      if (r != null) return r;
    }
  }
  return null;
}

/// mail003A01 Records[] 항목. 본문은 열지 않는다(읽음 처리 부작용).
class MailItem {
  const MailItem({required this.muid, required this.subject, required this.fromName, required this.fromEmail, required this.date, required this.tooltip, required this.seen, required this.attach});
  final String muid, subject, fromName, fromEmail, date, tooltip;
  final bool seen, attach;
  factory MailItem.fromRow(Map r) => MailItem(
        muid: asStr(r['muid']), subject: asStr(r['subject']), fromName: asStr(r['fromAddrName']), fromEmail: asStr(r['fromAddrEmail']), date: asStr(r['rfc822date']), tooltip: asStr(r['tooltipDate']),
        seen: asBool(r['seen']), attach: asBool(r['attach']));
}

/// 서버 날짜 표기 정리: 'YYYY-MM-DD HH:MM:SS' → 초 제거, 숫자만 12~14자리면 'YYYY-MM-DD HH:MM', 그 외 원문.
String niceDate(String s) {
  final t = s.trim();
  final m = RegExp(r'^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})').firstMatch(t);
  if (m != null) return '${m.group(1)} ${m.group(2)}';
  final d = _digits(t);
  if (d.length >= 12 && d == t) return '${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)} ${d.substring(8, 10)}:${d.substring(10, 12)}';
  return t;
}

/// 게시글 목록 행(ViewBoardNewAndNoticeArtList articleList[]). 전 게시판 공지·새 글 집계.
class GwNotice {
  const GwNotice({required this.artSeqNo, required this.title, required this.board, required this.boardId, required this.writer, required this.dept, required this.writeDate, required this.readCnt, required this.fileCnt, required this.attachmentUid, required this.isNew, required this.read, required this.preview});
  final String artSeqNo, title, board, boardId, writer, dept, writeDate, attachmentUid, preview;
  final int readCnt, fileCnt;
  final bool isNew, read;
  factory GwNotice.fromRow(Map r) => GwNotice(
        artSeqNo: asStr(r['art_seq_no']), title: asStr(r['art_title']), board: asStr(r['cat_title']), boardId: asStr(r['cat_seq_no']), writer: asStr(r['mbr_nick']), dept: asStr(r['dept_name']),
        writeDate: niceDate(asStr(r['write_date'])), readCnt: asInt(r['read_cnt']), fileCnt: asInt(r['file_cnt']), attachmentUid: asStr(r['uid']),
        isNew: asStr(r['is_new_yn']) == 'Y', read: asStr(r['art_read_yn']) == 'Y', preview: htmlToText(asStr(r['art_content'])));
}

class GwComment {
  const GwComment({required this.writer, required this.writeDate, required this.content});
  final String writer, writeDate, content;
}

/// 게시글 상세(ViewPost). ⚠️ 호출하면 조회수가 오른다(실제 열람). 게시판명은 art가 아니라 board.cat_title.
class GwNoticeDetail {
  const GwNoticeDetail({required this.artSeqNo, required this.title, required this.board, required this.writer, required this.dept, required this.writeDate, required this.readCnt, required this.fileCnt, required this.content, required this.comments});
  final String artSeqNo, title, board, writer, dept, writeDate, content;
  final int readCnt, fileCnt;
  final List<GwComment> comments;
  factory GwNoticeDetail.fromData(Map d) {
    final art = d['art'] is Map ? d['art'] as Map : const {};
    final board = d['board'] is Map ? d['board'] as Map : const {};
    final remarks = (d['remarkList'] as List?) ?? const [];
    String firstOf(Map r, List<String> keys) => keys.map((k) => asStr(r[k])).firstWhere((v) => v.isNotEmpty, orElse: () => '');
    return GwNoticeDetail(
      artSeqNo: asStr(art['art_seq_no']), title: asStr(art['art_title']), board: asStr(board['cat_title']), writer: asStr(art['mbr_nick']), dept: asStr(art['dept_name']),
      writeDate: niceDate(asStr(art['write_date'])), readCnt: asInt(art['read_cnt']), fileCnt: asInt(art['file_cnt']), content: htmlToText(asStr(art['art_content'])),
      comments: [for (final r in remarks) if (r is Map) GwComment(writer: asStr(r['mbr_nick']), writeDate: niceDate(asStr(r['write_date'])), content: htmlToText(firstOf(r, ['remark_desc', 'remark_content', 'content', 'art_content'])))],
    );
  }
}
