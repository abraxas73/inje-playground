// 아마란스 응답 정제 — 순수 함수만(네트워크 없음). 필드 이름·의미의 출처는 inno-creed src/modules/*.rs.
import 'gw_client.dart' show asStr, asBool, asInt;

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
